// @vitest-environment node
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { IncomingMessage, request } from 'node:http';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

interface Context {
    text: (body: string, status: number) => Response;
}

type Middleware = (context: Context, next: () => Promise<void>) => Response | Promise<Response | undefined>;

interface App {
    fetch: (request: Request) => Response | Promise<Response>;
    use: (path: string, middleware: Middleware) => void;
}

interface HonoModule {
    Hono: new () => App;
}
interface AdapterModule {
    createAdaptorServer: (options: { fetch: App['fetch']; overrideGlobalObjects: boolean }) => Server;
}
interface StaticModule {
    serveStatic: (options: { root: string; allowPercentInPath: boolean }) => Middleware;
}

function isHonoModule(value: unknown): value is HonoModule {
    return typeof value === 'object' && value !== null && 'Hono' in value && typeof value.Hono === 'function';
}
function isAdapterModule(value: unknown): value is AdapterModule {
    return (
        typeof value === 'object' &&
        value !== null &&
        'createAdaptorServer' in value &&
        typeof value.createAdaptorServer === 'function'
    );
}
function isStaticModule(value: unknown): value is StaticModule {
    return (
        typeof value === 'object' && value !== null && 'serveStatic' in value && typeof value.serveStatic === 'function'
    );
}

let root: string | null = null;
let server: Server | null = null;
vi.setConfig({ testTimeout: 10_000 });

async function requestPath(requestTarget: string) {
    const address = server?.address();
    if (address === null || address === undefined || typeof address === 'string') {
        throw new Error('Regression server is not listening');
    }
    // Unlike fetch/new URL, node:http preserves the raw request target under test.
    const outgoing = request({ host: '127.0.0.1', port: address.port, path: requestTarget, agent: false });
    outgoing.setTimeout(2000, () => {
        outgoing.destroy(new Error('Regression request timed out'));
    });
    const response = once(outgoing, 'response');
    outgoing.end();
    const responseArguments: Array<unknown> = await response;
    const [incoming] = responseArguments;
    if (!(incoming instanceof IncomingMessage)) {
        throw new Error('Missing HTTP response');
    }
    incoming.setEncoding('utf8');
    let body = '';
    for await (const chunk of incoming) {
        if (typeof chunk !== 'string') {
            throw new TypeError('Expected a text response');
        }
        body += chunk;
    }
    return { status: incoming.statusCode, body };
}

describe('the documentation Node adapter security regressions', () => {
    beforeAll(async () => {
        // Resolve the adapter Waku actually consumes, without adding a separate direct
        // dependency that could hide a vulnerable transitive copy used by the docs.
        const docsRequire = createRequire(new URL('../apps/docs/package.json', import.meta.url));
        const wakuRequire = createRequire(docsRequire.resolve('waku/package.json'));
        const hono: unknown = wakuRequire('hono');
        const adapter: unknown = wakuRequire('@hono/node-server');
        const staticMiddleware: unknown = wakuRequire('@hono/node-server/serve-static');
        if (!isHonoModule(hono) || !isAdapterModule(adapter) || !isStaticModule(staticMiddleware)) {
            throw new Error('Unexpected Waku adapter exports');
        }
        root = mkdtempSync(path.join(tmpdir(), 'formbraid-node-adapter-'));
        mkdirSync(path.join(root, 'static/admin'), { recursive: true });
        writeFileSync(path.join(root, 'static/admin/secret.txt'), 'protected fixture');
        writeFileSync(path.join(root, 'static/readme.txt'), 'public fixture');
        writeFileSync(path.join(root, 'static/100%.txt'), 'literal percent fixture');
        const app = new hono.Hono();
        app.use('/static/admin/*', (context) => context.text('Unauthorized', 401));
        app.use('/static/*', staticMiddleware.serveStatic({ root, allowPercentInPath: true }));
        app.use('/public', (context) => context.text('public', 200));
        server = adapter.createAdaptorServer({ fetch: app.fetch, overrideGlobalObjects: false });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
    });

    afterAll(async () => {
        try {
            await server?.[Symbol.asyncDispose]();
        } finally {
            if (root !== null) {
                rmSync(root, { recursive: true, force: true });
            }
        }
    });

    // GHSA-jpvv-r467-5p4w: raw backslashes must not become path separators.
    it.each([String.raw`/public\..\static/admin/secret.txt`, String.raw`/public\anything`])(
        'rejects raw path backslashes: %s',
        async (url) => {
            expect.assertions(2);
            const response = await requestPath(url);
            expect(response.status).toBe(400);
            expect(response.body).not.toContain('protected fixture');
        },
    );

    it('still permits a backslash in the query string', async () => {
        expect.assertions(1);
        await expect(requestPath(String.raw`/public?next=\static\admin`)).resolves.toStrictEqual({
            status: 200,
            body: 'public',
        });
    });

    // GHSA-fj57-4f93-cfw6: allowing percent filenames must not introduce a
    // second decode that turns an unprotected route into a protected file path.
    it.each(['/static/%%36%31dmin/secret.txt', '/static/%6%31dmin/secret.txt', '/static/%%361dmin/secret.txt'])(
        'does not serve protected files through a second decode: %s',
        async (url) => {
            expect.assertions(2);
            const response = await requestPath(url);
            expect(response.status).toBe(404);
            expect(response.body).not.toContain('protected fixture');
        },
    );

    it.each(['/static/admin/secret.txt', '/static/%61dmin/secret.txt'])(
        'retains the authorization control: %s',
        async (url) => {
            expect.assertions(1);
            await expect(requestPath(url)).resolves.toStrictEqual({ status: 401, body: 'Unauthorized' });
        },
    );

    it.each([
        ['/static/readme.txt', 'public fixture'],
        ['/static/100%25.txt', 'literal percent fixture'],
    ])('still serves legitimate static paths: %s', async (url, body) => {
        expect.assertions(1);
        await expect(requestPath(url)).resolves.toStrictEqual({ status: 200, body });
    });
});
