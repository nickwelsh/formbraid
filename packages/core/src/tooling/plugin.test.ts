// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { build, createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { ComponentMetadata, Integration } from './contracts.js';
import { inspectComponents, inspectComponentsEffect, inspectRegistries, RegistryInspectionError } from './inspect.js';
import { vitePlugin } from './plugin.js';

const directories: Array<string> = [];
const servers: Array<ViteDevServer> = [];

async function fixture(): Promise<{ root: string; integration: Integration }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'formbraid-vite-'));
    directories.push(root);
    await mkdir(path.join(root, 'app'), { recursive: true });
    await writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true }, include: ['*.ts'] }),
    );
    await writeFile(path.join(root, 'types.ts'), "export type Tone = 'quiet' | 'loud';");
    await writeFile(path.join(root, 'style.css'), 'input { color: blue; }');
    await writeFile(
        path.join(root, 'components.ts'),
        `
        import './style.css';
        import type { Tone } from './types';
        const browserOnly = window.localStorage;
        export function Input(_props: {label: string; tone?: Tone; limit: number}) { return browserOnly; }
    `,
    );
    await writeFile(
        path.join(root, 'registry.ts'),
        `
        import { Input } from './components';
        declare function defineConfig<T>(options: T): {Form: unknown};
        export const {Form} = defineConfig({components: {input: Input}});
    `,
    );
    await writeFile(path.join(root, 'index.html'), '<script type="module" src="/main.js"></script>');
    await writeFile(
        path.join(root, 'main.js'),
        "import { names } from './generated.js'; document.body.textContent = names;",
    );
    await writeFile(
        path.join(root, 'generate.mjs'),
        `
        import {readFileSync, writeFileSync, appendFileSync, mkdirSync} from 'node:fs';
        const metadata = JSON.parse(readFileSync('metadata.json', 'utf8'));
        if (metadata.version !== 1) process.exit(3);
        appendFileSync('receipts.jsonl', JSON.stringify(metadata) + '\\n');
        writeFileSync('generated.js', 'export const names = ' + JSON.stringify(Object.keys(metadata.fields).join(',')) + ';');
        mkdirSync('app/Enums', {recursive: true});
        writeFileSync('app/Enums/Field.php', '<?php // generated');
    `,
    );
    return {
        root,
        integration: {
            name: 'fixture',
            registry: pathToFileURL(path.join(root, 'registry.ts')),
            metadata: pathToFileURL(path.join(root, 'metadata.json')),
            command: [process.execPath, 'generate.mjs'],
            watch: ['app/**/*.php'],
            outputs: ['generated.js', 'app/Enums/Field.php'],
        },
    };
}

async function receipts(root: string): Promise<Array<ComponentMetadata>> {
    try {
        const source = await readFile(path.join(root, 'receipts.jsonl'), 'utf8');
        return (
            source
                .trim()
                .split('\n')
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This file is produced only by the fixture command; tests assert its inspected contents.
                .map((line) => JSON.parse(line) as ComponentMetadata)
        );
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function until(check: () => Promise<boolean>): Promise<void> {
    await expect.poll(check, { timeout: 15_000, interval: 50 }).toBe(true);
}

describe('vite-owned component metadata', () => {
    afterEach(async () => {
        await Promise.all(servers.splice(0).map(async (server) => await server.close()));
        await Promise.all(
            directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
        );
    });

    it('inspects browser-only modules and finishes generation before the application build', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        await build({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin({ integrations: [integration] })],
        });
        const [metadata] = await receipts(root);
        expect(Effect.runSync(inspectComponentsEffect('registry.ts', root))).toStrictEqual(metadata);
        expect(metadata?.fields['input']?.props['limit']).toStrictEqual({ required: true, type: { kind: 'number' } });
        expect(metadata?.fields['input']?.props['tone']).toStrictEqual({
            required: false,
            type: {
                kind: 'union',
                alternatives: [
                    { kind: 'literal', value: 'quiet' },
                    { kind: 'literal', value: 'loud' },
                ],
            },
        });
        await expect(readFile(path.join(root, 'generated.js'), 'utf8')).resolves.toContain('"input"');
        await expect(readFile(path.join(root, 'dist/index.html'), 'utf8')).resolves.toContain('assets/');
    }, 30_000);

    it('exposes recoverable inspection failures without changing synchronous inspector errors', async () => {
        expect.hasAssertions();
        const { root } = await fixture();
        await writeFile(path.join(root, 'registry.ts'), 'export {};');
        const error = Effect.runSync(Effect.flip(inspectComponentsEffect('registry.ts', root)));
        expect(error).toBeInstanceOf(RegistryInspectionError);
        expect(error).toMatchObject({
            _tag: 'RegistryInspectionError',
            module: 'registry.ts',
            root,
            cause: new Error('registry.ts does not export default.'),
        });
        expect(error.message).toContain('registry.ts does not export default.');
        expect(() => inspectComponents('registry.ts', root)).toThrow(new Error('registry.ts does not export default.'));
        expect(() => inspectRegistries('registry.ts', root)).toThrow(new Error('registry.ts does not export default.'));
    }, 30_000);

    it('reports inspection context and skips generation when the compiler configuration is malformed', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        await writeFile(path.join(root, 'tsconfig.json'), '{');
        await expect(
            build({
                root,
                configFile: false,
                logLevel: 'silent',
                plugins: [vitePlugin({ integrations: [integration] })],
            }),
        ).rejects.toThrow(`Cannot inspect registry ${path.join(root, 'registry.ts')} (root: ${root}):`);
        await expect(receipts(root)).resolves.toHaveLength(0);
        await expect(readdir(root)).resolves.not.toContain('metadata.json');
    }, 30_000);

    it('watches new module directories and imported prop types without looping on generated enums', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        const server = await createServer({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin({ integrations: [integration] })],
            server: { host: '127.0.0.1', port: 0 },
        });
        servers.push(server);
        await server.listen();
        await until(async () => {
            const lines = await receipts(root);
            return lines.length > 0;
        });
        await delay(150);
        const metadataBefore = await stat(path.join(root, 'metadata.json'));
        await mkdir(path.join(root, 'app/Modules/Todos/Requests'), { recursive: true });
        await writeFile(path.join(root, 'app/Modules/Todos/Requests/Store.php'), '<?php // input');
        await until(async () => {
            const lines = await receipts(root);
            return lines.length >= 2;
        });
        const metadataAfter = await stat(path.join(root, 'metadata.json'));
        expect(metadataAfter.mtimeMs).toBe(metadataBefore.mtimeMs);
        await writeFile(path.join(root, 'types.ts'), "export type Tone = 'quiet' | 'loud' | 'urgent';");
        await until(async () => {
            const lines = await receipts(root);
            return JSON.stringify(lines.at(-1)).includes('urgent');
        });
        const lines = await receipts(root);
        await delay(400);
        await expect(receipts(root)).resolves.toHaveLength(lines.length);
        const files = await readdir(root);
        expect(files.filter((file) => file.startsWith('metadata.json.'))).toStrictEqual([]);
    }, 30_000);

    it('fails the build with stderr after draining both output streams', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        await expect(
            build({
                root,
                configFile: false,
                logLevel: 'silent',
                plugins: [
                    vitePlugin({
                        integrations: [
                            {
                                ...integration,
                                command: [
                                    process.execPath,
                                    '-e',
                                    "process.stdout.write('x'.repeat(131072)); process.stderr.write('y'.repeat(20000) + 'failure detail'); process.exitCode = 7;",
                                ],
                            },
                        ],
                    }),
                ],
            }),
        ).rejects.toThrow(/generation failed \(7\)\.\ny+failure detail/u);
    }, 30_000);

    it('serializes integrations sharing metadata and preserves shell command support', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        await writeFile(
            path.join(root, 'serial.mjs'),
            `
            import { appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
            import { setTimeout } from 'node:timers/promises';
            const lock = openSync('generation.lock', 'wx');
            const name = process.argv[2];
            appendFileSync('order.txt', name + ':start\\n');
            await setTimeout(40);
            await import('./generate.mjs');
            appendFileSync('order.txt', name + ':end\\n');
            closeSync(lock);
            unlinkSync('generation.lock');
        `,
        );
        await build({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [
                vitePlugin({
                    integrations: [
                        { ...integration, name: 'first', command: [process.execPath, 'serial.mjs', 'first'] },
                        { ...integration, name: 'second', command: `"${process.execPath}" serial.mjs second` },
                    ],
                }),
            ],
        });
        await expect(readFile(path.join(root, 'order.txt'), 'utf8')).resolves.toBe(
            'first:start\nfirst:end\nsecond:start\nsecond:end\n',
        );
    }, 30_000);

    it('queues changes during generation without interrupting the active command', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        const server = await createServer({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin({ integrations: [integration] })],
            server: { host: '127.0.0.1', port: 0 },
        });
        servers.push(server);
        await server.listen();
        await until(async () => {
            const lines = await receipts(root);
            return lines.length === 1;
        });
        const generator = await readFile(path.join(root, 'generate.mjs'), 'utf8');
        await writeFile(path.join(root, 'original.mjs'), generator);
        await writeFile(
            path.join(root, 'generate.mjs'),
            `
            import { appendFileSync, existsSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
            import { setTimeout } from 'node:timers/promises';
            const lock = openSync('generation.lock', 'wx');
            appendFileSync('order.txt', 'start\\n');
            writeFileSync('ready', '');
            while (!existsSync('released')) await setTimeout(10);
            await import('./original.mjs');
            appendFileSync('order.txt', 'end\\n');
            closeSync(lock);
            unlinkSync('generation.lock');
        `,
        );
        await writeFile(path.join(root, 'app/Trigger.php'), '<?php // regenerate');
        await until(async () => {
            const files = await readdir(root);
            return files.includes('ready');
        });
        await writeFile(path.join(root, 'types.ts'), "export type Tone = 'quiet' | 'loud' | 'urgent';");
        await delay(200);
        await writeFile(path.join(root, 'released'), '');
        await until(async () => {
            const lines = await receipts(root);
            return lines.length >= 3;
        });
        await until(async () => {
            const order = await readFile(path.join(root, 'order.txt'), 'utf8');
            return order === 'start\nend\nstart\nend\n';
        });
        const lines = await receipts(root);
        expect(JSON.stringify(lines.at(-1))).toContain('urgent');
    }, 30_000);

    it('closes active generation even when the command ignores SIGTERM', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        const server = await createServer({
            root,
            configFile: false,
            logLevel: 'silent',
            plugins: [vitePlugin({ integrations: [integration] })],
            server: { host: '127.0.0.1', port: 0 },
        });
        servers.push(server);
        await server.listen();
        await until(async () => {
            const lines = await receipts(root);
            return lines.length > 0;
        });
        await writeFile(
            path.join(root, 'generate.mjs'),
            `
            import { writeFileSync } from 'node:fs';
            process.on('SIGTERM', () => {});
            writeFileSync('active.pid', String(process.pid));
            setInterval(() => {}, 1000);
        `,
        );
        await writeFile(path.join(root, 'app/Trigger.php'), '<?php // regenerate');
        await until(async () => {
            try {
                return Number(await readFile(path.join(root, 'active.pid'), 'utf8')) > 0;
            } catch {
                return false;
            }
        });
        const pid = Number(await readFile(path.join(root, 'active.pid'), 'utf8'));
        await server.close();
        expect(() => process.kill(pid, 0)).toThrow('ESRCH');
        await expect(receipts(root)).resolves.toHaveLength(1);
        const files = await readdir(root);
        expect(files.filter((file) => file.startsWith('metadata.json.'))).toStrictEqual([]);
    }, 30_000);
});
