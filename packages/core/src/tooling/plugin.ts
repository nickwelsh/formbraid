import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from '@effect/platform-node-shared';
import { Cause, Effect, FileSystem, Layer, ManagedRuntime, Semaphore, Stream } from 'effect';
import type { Fiber } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { Integration } from './contracts.js';
import { inspectComponentsEffect } from './inspect.js';

/** Vite is the sole metadata producer. Commands only consume the finished snapshot. */
export function vitePlugin({ integrations }: { readonly integrations: ReadonlyArray<Integration> }): Plugin {
    // oxlint-disable-next-line eslint/init-declarations -- Vite provides configuration before any generation hooks run.
    let config: ResolvedConfig;
    let server: ViteDevServer | undefined = undefined;
    let debounce: Fiber.Fiber<void> | undefined = undefined;
    let initialized = false;
    let closed = false;
    const pending = new Set<Integration>();
    const inputs = new Map<Integration, Set<string>>();
    const serial = Semaphore.makeUnsafe(1);
    const runtime = ManagedRuntime.make(
        Layer.provideMerge(NodeChildProcessSpawner.layer, Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    );

    function matches(file: string, patterns: ReadonlyArray<string>): boolean {
        return patterns.some((pattern) => path.matchesGlob(file, path.resolve(config.root, pattern)));
    }

    const run = Effect.fnUntraced(function* run(integration: Integration) {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const registry = fileURLToPath(integration.registry);
        const destination = fileURLToPath(integration.metadata);
        const metadata = yield* inspectComponentsEffect(registry, config.root);
        const source = `${JSON.stringify(metadata, null, 2)}\n`;
        yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
        const previous = yield* fs
            .readFileString(destination)
            .pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.void));
        if (previous !== source) {
            yield* Effect.scoped(
                Effect.gen(function* writeMetadata() {
                    const temporary = yield* fs.makeTempFileScoped({
                        directory: path.dirname(destination),
                        prefix: `${path.basename(destination)}.`,
                    });
                    yield* fs.writeFileString(temporary, source);
                    yield* fs.rename(temporary, destination);
                }),
            );
        }
        inputs.set(integration, new Set(metadata.inputs.map((file) => path.resolve(file))));
        server?.watcher.add(metadata.inputs);
        const { command } = integration;
        const executable = typeof command === 'string' ? command : command[0];
        const args = typeof command === 'string' ? [] : command.slice(1);
        const child = yield* spawner.spawn(
            ChildProcess.make(executable, args, {
                cwd: config.root,
                shell: typeof command === 'string',
                stdin: 'ignore',
                forceKillAfter: '2 seconds',
            }),
        );
        const [, stderr, code] = yield* Effect.all(
            [
                child.stdout.pipe(
                    Stream.decodeText(),
                    Stream.runForEach((chunk) => Effect.sync(() => config.logger.info(chunk.trimEnd()))),
                ),
                child.stderr.pipe(
                    Stream.decodeText(),
                    Stream.runFold(
                        () => '',
                        (tail, chunk) => `${tail}${chunk}`.slice(-16_384),
                    ),
                ),
                child.exitCode,
            ],
            { concurrency: 'unbounded' },
        );
        if (code !== 0) {
            return yield* Effect.fail(new Error(`${integration.name}: generation failed (${code}).\n${stderr}`));
        }
        return yield* Effect.void;
    }, Effect.scoped);

    const drain = Effect.gen(function* drain() {
        while (pending.size > 0) {
            const jobs = [...pending];
            pending.clear();
            for (const integration of jobs) {
                if (closed) {
                    return;
                }
                yield* run(integration);
            }
        }
    }).pipe(serial.withPermits(1));

    const regenerate = drain.pipe(
        Effect.tap(() => Effect.sync(() => server?.ws.send({ type: 'full-reload' }))),
        Effect.catchCause((cause) =>
            Effect.sync(() => {
                if (closed) {
                    return;
                }
                const error = Cause.squash(cause);
                const failure = error instanceof Error ? error : new Error(String(error));
                config.logger.error(failure.message);
                server?.ws.send({
                    type: 'error',
                    err: { message: failure.message, stack: failure.stack ?? '', plugin: 'formbraid' },
                });
            }),
        ),
    );

    function changed(_event: string, filename: string): void {
        if (closed) {
            return;
        }
        const file = path.resolve(filename);
        if (
            integrations.some(
                (integration) =>
                    file === fileURLToPath(integration.metadata) ||
                    file.startsWith(`${fileURLToPath(integration.metadata)}.`) ||
                    matches(file, integration.outputs),
            )
        ) {
            return;
        }
        for (const integration of integrations) {
            if (
                file === fileURLToPath(integration.registry) ||
                inputs.get(integration)?.has(file) === true ||
                matches(file, integration.watch)
            ) {
                pending.add(integration);
            }
        }
        if (pending.size === 0) {
            return;
        }
        debounce?.interruptUnsafe();
        debounce = runtime.runFork(
            Effect.sleep(60).pipe(
                Effect.tap(() =>
                    Effect.sync(() => {
                        runtime.runFork(regenerate);
                    }),
                ),
            ),
        );
    }

    function watchRoot(pattern: string): string {
        const prefix = pattern.split(/[?*[{]/u)[0] ?? '';
        return path.resolve(config.root, prefix.endsWith('/') ? prefix : path.dirname(prefix));
    }

    async function close(): Promise<void> {
        closed = true;
        server?.watcher.off('all', changed);
        pending.clear();
        await runtime.dispose();
    }

    return {
        name: 'formbraid',
        enforce: 'pre',
        configResolved(resolved) {
            config = resolved;
            const destinations = new Map<string, string>();
            const names = new Set<string>();
            for (const integration of integrations) {
                if (names.has(integration.name)) {
                    throw new Error(`Duplicate Formbraid integration: ${integration.name}.`);
                }
                names.add(integration.name);
                const target = fileURLToPath(integration.metadata);
                const registry = fileURLToPath(integration.registry);
                if (destinations.has(target) && destinations.get(target) !== registry) {
                    throw new Error(`Conflicting metadata destination: ${target}.`);
                }
                destinations.set(target, registry);
            }
        },
        configureServer(devServer) {
            server = devServer;
            server.watcher.on('all', changed);
            for (const integration of integrations) {
                const roots = integration.watch.map(watchRoot);
                server.watcher.add([fileURLToPath(integration.registry), ...roots]);
            }
        },
        async buildStart() {
            if (server !== undefined && initialized) {
                return;
            }
            initialized = true;
            for (const integration of integrations) {
                pending.add(integration);
            }
            await runtime.runPromise(drain);
        },
        closeBundle: close,
    };
}
