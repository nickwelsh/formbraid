import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { Integration } from './contracts.js';
import { inspectComponents } from './inspect.js';

/** Vite is the sole metadata producer. Commands only consume the finished snapshot. */
export function vitePlugin({ integrations }: { readonly integrations: ReadonlyArray<Integration> }): Plugin {
    // oxlint-disable-next-line eslint/init-declarations -- Vite provides configuration before any generation hooks run.
    let config: ResolvedConfig;
    let server: ViteDevServer | undefined = undefined;
    let running: Promise<void> | undefined = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let initialized = false;
    let closed = false;
    const pending = new Set<Integration>();
    const inputs = new Map<Integration, Set<string>>();
    const children = new Set<ReturnType<typeof spawn>>();

    function matches(file: string, patterns: ReadonlyArray<string>): boolean {
        return patterns.some((pattern) => path.matchesGlob(file, path.resolve(config.root, pattern)));
    }

    async function run(integration: Integration): Promise<void> {
        const registry = fileURLToPath(integration.registry);
        const destination = fileURLToPath(integration.metadata);
        const metadata = inspectComponents(registry, config.root);
        const source = `${JSON.stringify(metadata, null, 2)}\n`;
        await mkdir(path.dirname(destination), { recursive: true });
        let previous: string | undefined = undefined;
        try {
            previous = await readFile(destination, 'utf8');
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error;
            }
        }
        if (previous !== source) {
            const temporary = `${destination}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, source);
                await rename(temporary, destination);
            } finally {
                await rm(temporary, { force: true });
            }
        }
        inputs.set(integration, new Set(metadata.inputs.map((file) => path.resolve(file))));
        server?.watcher.add(metadata.inputs);
        if (closed) {
            return;
        }
        // oxlint-disable-next-line promise/avoid-new -- Child process events must be adapted to the awaited Vite build lifecycle.
        await new Promise<void>((resolve, reject) => {
            const { command } = integration;
            const executable = typeof command === 'string' ? command : command[0];
            const args = typeof command === 'string' ? [] : command.slice(1);
            const child = spawn(executable, args, {
                cwd: config.root,
                shell: typeof command === 'string',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            children.add(child);
            let stderr = '';
            child.stdout.on('data', (data: Buffer) => config.logger.info(data.toString().trimEnd()));
            child.stderr.on('data', (data: Buffer) => {
                stderr = `${stderr}${data.toString()}`.slice(-16_384);
            });
            child.once('error', reject);
            child.once('close', (code, signal) => {
                children.delete(child);
                if (code === 0 || closed) {
                    resolve();
                } else {
                    reject(new Error(`${integration.name}: generation failed (${code ?? signal}).\n${stderr}`));
                }
            });
        });
    }

    async function drain(): Promise<void> {
        running ??= (async () => {
            try {
                while (pending.size > 0) {
                    if (closed) {
                        return;
                    }
                    const jobs = [...pending];
                    pending.clear();
                    for (const integration of jobs) {
                        // oxlint-disable-next-line eslint/no-await-in-loop -- Integrations may share metadata and output directories; commands must be serialized.
                        await run(integration);
                    }
                }
            } finally {
                running = undefined;
            }
        })();
        await running;
    }

    function changed(_event: string, filename: string): void {
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
        clearTimeout(timer);
        timer = setTimeout(() => {
            void regenerate();
        }, 60);
    }

    async function regenerate(): Promise<void> {
        try {
            await drain();
            server?.ws.send({ type: 'full-reload' });
        } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            config.logger.error(failure.message);
            server?.ws.send({
                type: 'error',
                err: { message: failure.message, stack: failure.stack ?? '', plugin: 'formbraid' },
            });
        }
    }

    function watchRoot(pattern: string): string {
        const prefix = pattern.split(/[?*[{]/u)[0] ?? '';
        return path.resolve(config.root, prefix.endsWith('/') ? prefix : path.dirname(prefix));
    }

    async function close(): Promise<void> {
        closed = true;
        clearTimeout(timer);
        server?.watcher.off('all', changed);
        for (const child of children) {
            child.kill('SIGTERM');
        }
        await running;
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
            await drain();
        },
        closeBundle: close,
    };
}
