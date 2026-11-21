import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { Agent, createServer, request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import Ajv from 'ajv';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseServeQuery } from '../src/cli';
import type { CliConfig } from '../src/cliConfig';
import { LINT_OUTPUT_SCHEMA } from '../src/cliMcp';
import {
    MAX_BODY_BYTES,
    SERVE_HELP_TEXT,
    allowedHostHeaders,
    createServeServer,
    runServe,
    svgPixelSize,
    warningsHeaders,
} from '../src/cliServe';
import { extractAslFromTemplate } from '../src/cfn';
import { generateMermaid, generateSvg } from '../src/index';
import { createLayoutCache } from '../src/layout';

const fixtures = join(__dirname, 'fixtures');
const simpleText = readFileSync(join(fixtures, 'simple.asl.json'), 'utf-8');
const cdkSynthText = readFileSync(join(fixtures, 'cfn', 'cdk-synth.json'), 'utf-8');

interface StartParams {
    config?: CliConfig | null;
    host?: string;
    standalone?: boolean;
}

interface Started {
    base: string;
    server: Server;
}

async function start(params: StartParams = {}): Promise<Started> {
    const { config = null, host = '127.0.0.1', standalone = false } = params;
    const server = createServeServer({
        cache: createLayoutCache(),
        config,
        parseQuery: parseServeQuery,
        standalone,
        version: 'test',
    });
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const { port } = server.address() as AddressInfo;
    return { base: `http://127.0.0.1:${port}`, server };
}

async function stop(server: Server): Promise<void> {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('sfn-diagram serve over HTTP', () => {
    let base: string;
    let server: Server;

    beforeAll(async () => {
        ({ base, server } = await start());
    });

    afterAll(async () => {
        await stop(server);
    });

    const post = (path: string, body: string | Buffer): Promise<Response> =>
        fetch(`${base}${path}`, { body, method: 'POST' });

    it('answers /healthz for GET and HEAD', async () => {
        const get = await fetch(`${base}/healthz`);
        expect(get.status).toBe(200);
        expect(await get.json()).toEqual({ status: 'ok', version: 'test' });
        const head = await fetch(`${base}/healthz`, { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
    });

    it('renders svg by default, with the CLI trailing newline', async () => {
        const response = await post('/render', simpleText);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
        const body = await response.text();
        expect(body).toBe(`${generateSvg({ aslDefinition: simpleText }).svg}\n`);
        expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
        expect(response.headers.get('sfn-diagram-warnings')).toBeNull();
    });

    it('renders mermaid as text/plain', async () => {
        const response = await post('/render?format=mermaid', simpleText);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        const code = generateMermaid({ aslDefinition: simpleText }).code;
        expect(await response.text()).toBe(code.endsWith('\n') ? code : `${code}\n`);
    });

    it('renders html', async () => {
        const response = await post('/render?format=html', simpleText);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(await response.text()).toMatch(/^<!DOCTYPE html>/);
    });

    it('renders png', async () => {
        const response = await post('/render?format=png', simpleText);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });

    it('renders a CloudFormation template with no warning headers', async () => {
        const response = await post('/render', cdkSynthText);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
        expect(response.headers.get('sfn-diagram-warning-count')).toBeNull();
    });

    it('reports extraction warnings in headers', async () => {
        const template = JSON.stringify({
            Resources: {
                Machine: {
                    Properties: {
                        Definition: {
                            StartAt: 'A',
                            States: { A: { End: true, Resource: { 'Fn::ImportValue': 'Fn' }, Type: 'Task' } },
                        },
                    },
                    Type: 'AWS::StepFunctions::StateMachine',
                },
            },
        });
        expect(extractAslFromTemplate({ template }).warnings.length).toBeGreaterThan(0);

        const response = await post('/render', template);
        expect(response.status).toBe(200);
        expect(Number(response.headers.get('sfn-diagram-warning-count'))).toBeGreaterThanOrEqual(1);
        const warnings = JSON.parse(response.headers.get('sfn-diagram-warnings') ?? '[]') as string[];
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]).toContain('Fn::ImportValue');
    });

    it('answers a definition it cannot read with 422', async () => {
        const response = await post('/render', '{not json');
        expect(response.status).toBe(422);
        const body = (await response.json()) as { kind: string; message: string };
        expect(body.kind).toBe('error');
        expect(body.message.length).toBeGreaterThan(0);
    });

    it('answers a bad query with 400', async () => {
        const output = await post('/render?output=x', simpleText);
        expect(output.status).toBe(400);
        expect(((await output.json()) as { message: string }).message).toContain('Unknown query parameter');
        expect((await post('/render?theme=/etc/passwd', simpleText)).status).toBe(400);
    });

    it('answers a body over the limit with 413 and keeps the connection', async () => {
        const justOver = await post('/render', Buffer.alloc(MAX_BODY_BYTES + 1, 0x20));
        expect(justOver.status).toBe(413);
        expect(justOver.headers.get('connection')).not.toBe('close');
        const huge = await post('/render', Buffer.alloc(10 * 1024 * 1024, 0x20));
        expect(huge.status).toBe(413);
    });

    it('answers a malformed request target with 400', async () => {
        const { port } = server.address() as AddressInfo;
        const raw = await new Promise<string>((resolveRaw, reject) => {
            const socket = connect(port, '127.0.0.1', () => {
                socket.end(`GET //[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
            });
            let data = '';
            socket.on('data', (chunk) => (data += chunk.toString()));
            socket.on('end', () => resolveRaw(data));
            socket.on('error', reject);
        });
        expect(raw.startsWith('HTTP/1.1 400')).toBe(true);
        expect(raw).toContain('Malformed request target');
    });

    it('survives a client that disconnects mid-upload', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const { port } = server.address() as AddressInfo;
            await new Promise<void>((resolveSent) => {
                const socket = connect(port, '127.0.0.1', () => {
                    const head = `POST /render HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 1000\r\n\r\n`;
                    socket.write(`${head}{"StartAt"`, () => {
                        socket.destroy();
                        resolveSent();
                    });
                });
            });
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
            expect((await fetch(`${base}/healthz`)).status).toBe(200);
            expect(stderr).not.toHaveBeenCalled();
        } finally {
            stderr.mockRestore();
        }
    });

    it('answers a wrong method with 405 and a wrong path with 404', async () => {
        const wrongMethod = await fetch(`${base}/render`);
        expect(wrongMethod.status).toBe(405);
        expect(wrongMethod.headers.get('allow')).toBe('POST');
        expect((await fetch(`${base}/`)).status).toBe(404);
    });

    it('lints with the --check-format json entry shape', async () => {
        const validateLint = new Ajv().compile(LINT_OUTPUT_SCHEMA);
        const definition = JSON.stringify({ StartAt: 'A', States: { A: { Next: 'Missing', Type: 'Pass' } } });
        const response = await post('/lint', definition);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        const body = (await response.json()) as { diagnostics: unknown[]; kind: string };
        expect(body.kind).toBe('lint');
        expect(body.diagnostics.length).toBeGreaterThan(0);
        expect(validateLint(body)).toBe(true);
        expect((await post('/lint?layout=LR', definition)).status).toBe(400);
    });

    it('strips a byte order mark', async () => {
        const response = await post('/render', `${String.fromCharCode(0xfeff)}${simpleText}`);
        expect(response.status).toBe(200);
    });

    it('refuses a png over the pixel budget before rasterizing', async () => {
        const response = await post('/render?format=png&padding=20000', simpleText);
        expect(response.status).toBe(422);
        expect(((await response.json()) as { message: string }).message).toContain(
            "above this server's limit",
        );
        const scaled = await post('/render?format=png&scale=4', simpleText);
        expect(scaled.status).toBe(200);
    });
});

describe('text in a definition cannot make the server fetch a URL', () => {
    let bait: Server;
    let hits = 0;
    let baitHref = '';
    let base: string;
    let server: Server;

    beforeAll(async () => {
        bait = createServer((_request, response) => {
            hits += 1;
            response.end('TOP-SECRET');
        });
        await new Promise<void>((resolve) => bait.listen(0, '127.0.0.1', resolve));
        baitHref = `href="http://127.0.0.1:${(bait.address() as AddressInfo).port}/x"`;
        ({ base, server } = await start());
    });

    afterAll(async () => {
        await stop(server);
        await new Promise<void>((resolve) => bait.close(() => resolve()));
    });

    it.each(['format=html', 'format=html&show-icons', 'format=png&show-icons'])('%s', async (query) => {
        const name = `Step ${baitHref}`;
        const definition = JSON.stringify({
            StartAt: name,
            States: { [name]: { Comment: `See ${baitHref}`, End: true, Type: 'Pass' } },
        });
        const title = encodeURIComponent(`Title ${baitHref}`);
        const response = await fetch(`${base}/render?${query}&diagram-title=${title}`, {
            body: definition,
            method: 'POST',
        });
        expect(response.status).toBe(200);
        const body = Buffer.from(await response.arrayBuffer()).toString('latin1');
        expect(hits).toBe(0);
        expect(body).not.toContain(Buffer.from('TOP-SECRET').toString('base64'));
    });
});

describe('server options', () => {
    it('applies the config file under every request', async () => {
        const { base, server } = await start({ config: { layout: 'LR' } });
        try {
            const response = await fetch(`${base}/render`, { body: simpleText, method: 'POST' });
            expect(await response.text()).toBe(`${generateSvg({ aslDefinition: simpleText, layout: 'LR' }).svg}\n`);
        } finally {
            await stop(server);
        }
    });

    it('refuses png in the standalone binary with 501', async () => {
        const { base, server } = await start({ standalone: true });
        try {
            const response = await fetch(`${base}/render?format=png`, { body: simpleText, method: 'POST' });
            expect(response.status).toBe(501);
            expect(((await response.json()) as { message: string }).message).toContain('standalone binary');
        } finally {
            await stop(server);
        }
    });
});

interface RawRequestParams {
    body?: string;
    headers: Record<string, string>;
    method: string;
    path: string;
    port: number;
}

interface RawResponse {
    body: string;
    status: number;
}

/** A request through `node:http`, which sends the `Host` given; `fetch` ignores one. */
function rawRequest(params: RawRequestParams): Promise<RawResponse> {
    const { body, headers, method, path, port } = params;
    return new Promise((resolve, reject) => {
        const request = httpRequest({ agent: false, headers, host: '127.0.0.1', method, path, port }, (response) => {
            let text = '';
            response.on('data', (chunk: Buffer) => (text += chunk.toString()));
            response.on('end', () => resolve({ body: text, status: response.statusCode ?? 0 }));
            response.on('error', reject);
        });
        request.on('error', reject);
        request.end(body);
    });
}

/** Write `text` on a raw socket and collect everything until the server closes it. */
function rawExchange(port: number, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => socket.end(text));
        let data = '';
        socket.on('data', (chunk) => (data += chunk.toString()));
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
    });
}

describe('request checks on a loopback bind', () => {
    let base: string;
    let port: number;
    let server: Server;

    beforeAll(async () => {
        ({ base, server } = await start());
        ({ port } = server.address() as AddressInfo);
    });

    afterAll(async () => {
        await stop(server);
    });

    it('refuses a foreign Host on every route with 403', async () => {
        const render = await rawRequest({
            body: simpleText,
            headers: { Host: 'evil.example' },
            method: 'POST',
            path: '/render',
            port,
        });
        expect(render.status).toBe(403);
        const error = JSON.parse(render.body) as { kind: string; message: string };
        expect(error.kind).toBe('error');
        expect(error.message).toContain('"evil.example"');
        expect(error.message).toContain(`localhost:${port}`);

        const health = await rawRequest({ headers: { Host: 'evil.example' }, method: 'GET', path: '/healthz', port });
        expect(health.status).toBe(403);
    });

    it('refuses a foreign name on the right port and a loopback name on the wrong port', async () => {
        for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', 'localhost']) {
            const response = await rawRequest({ headers: { Host: host }, method: 'GET', path: '/healthz', port });
            expect(response.status, host).toBe(403);
        }
    });

    it('answers every loopback name with the port, in any case', async () => {
        for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `LOCALHOST:${port}`]) {
            const response = await rawRequest({ headers: { Host: host }, method: 'GET', path: '/healthz', port });
            expect(response.status, host).toBe(200);
        }
    });

    it('refuses a request with no Host', async () => {
        const raw = await rawExchange(port, 'GET /healthz HTTP/1.0\r\n\r\n');
        expect(raw.startsWith('HTTP/1.1 403')).toBe(true);
    });

    it('refuses any Origin with 403', async () => {
        for (const origin of ['https://evil.example', 'null', `http://127.0.0.1:${port}`]) {
            const response = await fetch(`${base}/render`, {
                body: simpleText,
                headers: { Origin: origin },
                method: 'POST',
            });
            expect(response.status, origin).toBe(403);
            const error = (await response.json()) as { message: string };
            expect(error.message, origin).toContain('Origin');
        }
    });

    it('answers a client that sends neither, as curl does', async () => {
        const response = await fetch(`${base}/render`, { body: simpleText, method: 'POST' });
        expect(response.status).toBe(200);
    });

    it('keeps refusing on an open connection after close() starts', async () => {
        const own = await start();
        const ownPort = (own.server.address() as AddressInfo).port;
        try {
            const half = Math.floor(simpleText.length / 2);
            const seen = once(own.server, 'request');
            const raw = new Promise<string>((resolve, reject) => {
                const socket = connect(ownPort, '127.0.0.1', () => {
                    socket.write(
                        `POST /lint HTTP/1.1\r\nHost: 127.0.0.1:${ownPort}\r\nContent-Length: ${Buffer.byteLength(simpleText)}\r\n\r\n${simpleText.slice(0, half)}`,
                    );
                    seen.then(() => {
                        own.server.close();
                        socket.end(
                            `${simpleText.slice(half)}GET /healthz HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`,
                        );
                    }, reject);
                });
                let data = '';
                socket.on('data', (chunk) => (data += chunk.toString()));
                socket.on('end', () => resolve(data));
                socket.on('error', reject);
            });
            const statuses = [...(await raw).matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => match[1]);
            expect(statuses).toEqual(['200', '403']);
        } finally {
            own.server.closeAllConnections();
        }
    });
});

describe('request checks on a non-loopback bind', () => {
    it('stays off, so a reverse proxy can rewrite Host', async () => {
        const { base, server } = await start({ host: '0.0.0.0' });
        const { port } = server.address() as AddressInfo;
        try {
            const foreignHost = await rawRequest({
                body: simpleText,
                headers: { Host: 'evil.example' },
                method: 'POST',
                path: '/render',
                port,
            });
            expect(foreignHost.status).toBe(200);
            const withOrigin = await fetch(`${base}/render`, {
                body: simpleText,
                headers: { Origin: 'https://evil.example' },
                method: 'POST',
            });
            expect(withOrigin.status).toBe(200);
        } finally {
            await stop(server);
        }
    });
});

describe('allowedHostHeaders', () => {
    const loopbackNames = ['127.0.0.1:8080', 'localhost:8080', '[::1]:8080'];

    it('allows the loopback names with the port on 127.0.0.1 and ::1', () => {
        expect(allowedHostHeaders({ address: '127.0.0.1', family: 'IPv4', port: 8080 })).toEqual(new Set(loopbackNames));
        expect(allowedHostHeaders({ address: '::1', family: 'IPv6', port: 8080 })).toEqual(new Set(loopbackNames));
    });

    it('also allows the bound address itself', () => {
        expect(allowedHostHeaders({ address: '127.0.0.2', family: 'IPv4', port: 8080 })).toEqual(
            new Set([...loopbackNames, '127.0.0.2:8080']),
        );
        expect(allowedHostHeaders({ address: '::ffff:127.0.0.1', family: 'IPv6', port: 8080 })).toEqual(
            new Set([...loopbackNames, '[::ffff:127.0.0.1]:8080']),
        );
    });

    it('allows the bare names on port 80', () => {
        expect(allowedHostHeaders({ address: '127.0.0.1', family: 'IPv4', port: 80 })).toEqual(
            new Set(['127.0.0.1:80', 'localhost:80', '[::1]:80', '127.0.0.1', 'localhost', '[::1]']),
        );
    });

    it('is null for any other bind', () => {
        expect(allowedHostHeaders({ address: '0.0.0.0', family: 'IPv4', port: 8080 })).toBeNull();
        expect(allowedHostHeaders({ address: '::', family: 'IPv6', port: 8080 })).toBeNull();
        expect(allowedHostHeaders({ address: '192.168.1.5', family: 'IPv4', port: 8080 })).toBeNull();
        expect(allowedHostHeaders('/tmp/serve.sock')).toBeNull();
        expect(allowedHostHeaders(null)).toBeNull();
    });
});

describe('warningsHeaders', () => {
    it('is empty with no warnings', () => {
        expect(warningsHeaders([])).toEqual({});
    });

    it('escapes everything outside printable ASCII and round-trips', () => {
        const warning = `caf${String.fromCharCode(0xe9)} line\nnext ${String.fromCharCode(0x2028)} end`;
        const value = warningsHeaders([warning])['Sfn-Diagram-Warnings'];
        expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
        expect(JSON.parse(value)).toEqual([warning]);
    });

    it('dedupes but counts every warning', () => {
        const headers = warningsHeaders(['a', 'a', 'b']);
        expect(headers['Sfn-Diagram-Warning-Count']).toBe('3');
        expect(JSON.parse(headers['Sfn-Diagram-Warnings'])).toEqual(['a', 'b']);
    });

    it('caps the value and says how many were left out', () => {
        const warnings = Array.from({ length: 200 }, (_, index) => `warning ${String(index).padStart(3, '0')} `.padEnd(50, 'x'));
        const headers = warningsHeaders(warnings);
        expect(headers['Sfn-Diagram-Warnings'].length).toBeLessThanOrEqual(2048);
        expect(headers['Sfn-Diagram-Warning-Count']).toBe('200');
        const list = JSON.parse(headers['Sfn-Diagram-Warnings']) as string[];
        const last = list[list.length - 1];
        expect(last).toMatch(/^and \d+ more; POST \/lint returns every warning$/);
        expect(Number(/^and (\d+)/.exec(last)?.[1]) + list.length - 1).toBe(200);
    });
});

describe('svgPixelSize', () => {
    it('reads the root size', () => {
        expect(svgPixelSize('<svg width="120.5" height="80" xmlns="http://www.w3.org/2000/svg">')).toEqual({
            height: 80,
            width: 120.5,
        });
        expect(svgPixelSize('<g/>')).toBeNull();
    });
});

describe('runServe', () => {
    let stderr = '';
    let stdout = '';

    beforeAll(() => {
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderr += String(chunk);
            return true;
        });
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdout += String(chunk);
            return true;
        });
    });

    afterEach(() => {
        stderr = '';
        stdout = '';
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    async function waitForListening(): Promise<string> {
        for (let attempt = 0; attempt < 200; attempt++) {
            const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
            if (match) return match[1];
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`server never listened: ${stderr}`);
    }

    it('listens, serves and stops on abort', async () => {
        const controller = new AbortController();
        const done = runServe({
            argv: ['--port', '0'],
            parseQuery: parseServeQuery,
            signal: controller.signal,
            standalone: false,
            version: 'test',
        });
        const base = await waitForListening();
        expect((await fetch(`${base}/healthz`)).status).toBe(200);
        controller.abort();
        expect(await done).toBe(0);
    });

    it('closes a held keep-alive connection on shutdown', { timeout: 10_000 }, async () => {
        const controller = new AbortController();
        const done = runServe({
            argv: ['--port', '0'],
            parseQuery: parseServeQuery,
            signal: controller.signal,
            standalone: false,
            version: 'test',
        });
        const base = await waitForListening();
        const agent = new Agent({ keepAlive: true });
        await new Promise<void>((resolve, reject) => {
            httpRequest(`${base}/healthz`, { agent }, (response) => {
                response.resume();
                response.on('end', resolve);
            })
                .on('error', reject)
                .end();
        });
        controller.abort();
        expect(await done).toBe(0);
        agent.destroy();
    });

    it.each([
        [['--port', '70000'], 2],
        [['--port', 'abc'], 2],
        [['--port', '1e3'], 2],
        [['--port', '0x50'], 2],
        [['--bogus'], 2],
        [['--config', 'missing-serve-config.json'], 1],
    ])('exits with the right code for %j', async (argv, code) => {
        expect(await runServe({ argv, parseQuery: parseServeQuery, standalone: false, version: 'test' })).toBe(code);
    });

    it('prints help', async () => {
        expect(await runServe({ argv: ['--help'], parseQuery: parseServeQuery, standalone: false, version: 'test' })).toBe(0);
        expect(stdout).toBe(SERVE_HELP_TEXT);
    });

    it('reports a port it cannot bind', async () => {
        const taken = createServer();
        await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
        const { port } = taken.address() as AddressInfo;
        try {
            const code = await runServe({
                argv: ['--port', String(port)],
                parseQuery: parseServeQuery,
                standalone: false,
                version: 'test',
            });
            expect(code).toBe(1);
            expect(stderr).toContain('cannot listen');
        } finally {
            await new Promise<void>((resolve) => taken.close(() => resolve()));
        }
    });
});
