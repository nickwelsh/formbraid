// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { build, createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { ComponentMetadata, Integration } from './contracts.js';
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
        await mkdir(path.join(root, 'app/Modules/Todos/Requests'), { recursive: true });
        await writeFile(path.join(root, 'app/Modules/Todos/Requests/Store.php'), '<?php // input');
        await until(async () => {
            const lines = await receipts(root);
            return lines.length >= 2;
        });
        await writeFile(path.join(root, 'types.ts'), "export type Tone = 'quiet' | 'loud' | 'urgent';");
        await until(async () => {
            const lines = await receipts(root);
            return JSON.stringify(lines.at(-1)).includes('urgent');
        });
        const lines = await receipts(root);
        await delay(400);
        await expect(receipts(root)).resolves.toHaveLength(lines.length);
    }, 30_000);

    it('fails the build when an integration command fails', async () => {
        expect.hasAssertions();
        const { root, integration } = await fixture();
        await expect(
            build({
                root,
                configFile: false,
                logLevel: 'silent',
                plugins: [
                    vitePlugin({
                        integrations: [{ ...integration, command: [process.execPath, '-e', 'process.exit(7)'] }],
                    }),
                ],
            }),
        ).rejects.toThrow('generation failed (7)');
    }, 30_000);
});
