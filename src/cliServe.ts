import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import type { CliConfig } from './cliConfig';
import { CliConfigError, loadCliConfig } from './cliConfig';
import type { ResolvedCliOptions } from './cliOptions';
import { handleRenderRequest } from './cliRender';
import type { RenderDefinitionInput } from './cliRender';
import { createLayoutCache } from './layout';
import type { LayoutCache } from './layout';
import type { DiagramFormat } from './types';
import { stripBom } from './utils/bom';

/** Parameters for a {@link ParseServeQuery} implementation. */
export interface ParseServeQueryParams {
    /** The server's config file, or `null` when there is none. */
    config: CliConfig | null;
    /** `render` accepts the render flags; `lint` only the flags that pick a definition. */
    mode: 'lint' | 'render';
    /** The request's query string. */
    query: URLSearchParams;
}

/** The options one request renders with, after its query, the config and the defaults. */
export interface ServeQuery {
    options: ResolvedCliOptions;
    resolveCfn: boolean;
    resource: string | null;
}

/** A parsed query, or the usage error to answer with a 400. */
export type ServeQueryResult = { kind: 'error'; message: string } | ({ kind: 'ok' } & ServeQuery);

/**
 * Turns a request's query string into render options. `cli.ts` implements it with its own
 * flag parser and passes it in, so the server cannot drift from the CLI and does not
 * import `cli.ts`.
 */
export type ParseServeQuery = (params: ParseServeQueryParams) => ServeQueryResult;

/** The port `sfn-diagram serve` listens on without `--port`. */
export const DEFAULT_SERVE_PORT = 8080;

/** The address `sfn-diagram serve` binds without `--host`: loopback only. */
export const DEFAULT_SERVE_HOST = '127.0.0.1';

/** The largest request body accepted; a bigger one gets a 413. */
export const MAX_BODY_BYTES: number = 2 * 1024 * 1024;

/**
 * How much of an oversized body is read and thrown away before the connection is cut.
 * Reading the rest lets an ordinary client see the 413 instead of a reset.
 */
const MAX_DISCARD_BYTES = 16 * 1024 * 1024;

/**
 * The largest PNG, in pixels, the server rasterizes (a 160 MB RGBA pixmap). The CLI has
 * no such limit; over HTTP a client could otherwise ask for one as large as memory.
 */
export const MAX_PNG_PIXELS = 40_000_000;

/** The longest `Sfn-Diagram-Warnings` value sent, so it fits a proxy's header buffer. */
const WARNINGS_HEADER_MAX = 2048;

/** How long shutdown waits for in-flight requests before closing every connection. */
const SHUTDOWN_GRACE_MS = 5000;

const CONTENT_TYPES: Record<DiagramFormat, string> = {
    html: 'text/html; charset=utf-8',
    mermaid: 'text/plain; charset=utf-8',
    png: 'image/png',
    svg: 'image/svg+xml; charset=utf-8',
};

const ROUTES: Readonly<Record<string, readonly string[]>> = {
    '/healthz': ['GET', 'HEAD'],
    '/lint': ['POST'],
    '/render': ['POST'],
};

/** Usage for `sfn-diagram serve --help`. */
export const SERVE_HELP_TEXT: string = `Usage: sfn-diagram serve [--port <n>] [--host <addr>] [--config <path>]

Render Step Functions diagrams over HTTP.

Options:
  --port <n>         Port to listen on (default: ${DEFAULT_SERVE_PORT}; 0 picks a free one)
  --host <addr>      Address to bind (default: ${DEFAULT_SERVE_HOST}). Use 0.0.0.0 in a
                     container, behind a trusted network or a reverse proxy: the server
                     has no authentication.
  --config <path>    Settings file applied under every request (default: search upward
                     from the working directory, as the CLI does)
  -h, --help         Show this help

Endpoints:
  POST /render?<query>   Body: ASL JSON, a CloudFormation/SAM/CDK template, or Terraform.
                         Returns the diagram (svg by default).
  POST /lint?<query>     Body as above. Returns {"diagnostics", "kind", "warnings"} as JSON.
  GET  /healthz          Returns {"status": "ok", "version"}.

Query parameters are the CLI's flags without the leading --, for example
  /render?format=mermaid&layout=LR&hide-catch
Flags that read or write files, reach AWS or change how the process runs are refused.

Examples:
  sfn-diagram serve --port 8080
  curl --data-binary @workflow.asl.json 'http://127.0.0.1:8080/render?format=svg' > workflow.svg

Guide: https://sfn.yusufaf.dev/guides/serve/
`;

/** Parameters for {@link createServeServer}. */
export interface CreateServeServerParams {
    /** The layout cache shared by every request. */
    cache: LayoutCache;
    /** The server's config file, applied under every request. */
    config: CliConfig | null;
    /** Turns a query string into options; `cli.ts` passes its `parseServeQuery`. */
    parseQuery: ParseServeQuery;
    /** Whether this is the standalone binary, which cannot rasterize png. */
    standalone: boolean;
    /** The package version, reported by `GET /healthz`. */
    version: string;
}

interface SendJsonParams {
    body: unknown;
    headers?: Record<string, string>;
    response: ServerResponse;
    status: number;
}

function sendJson(params: SendJsonParams): void {
    const { body, headers = {}, response, status } = params;
    const text = `${JSON.stringify(body)}\n`;
    response.writeHead(status, {
        ...headers,
        'Content-Length': String(Buffer.byteLength(text)),
        'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(text);
}

interface SendErrorParams {
    headers?: Record<string, string>;
    message: string;
    response: ServerResponse;
    status: number;
    warnings: string[];
}

function sendError(params: SendErrorParams): void {
    const { headers, message, response, status, warnings } = params;
    sendJson({ body: { kind: 'error', message, warnings }, headers, response, status });
}

const BACKSLASH_U = `${String.fromCharCode(92)}u`;

/** JSON text with every code unit outside printable ASCII written as a `\uXXXX` escape. */
function asciiJson(value: unknown): string {
    const json = JSON.stringify(value);
    let out = '';
    for (let index = 0; index < json.length; index++) {
        const code = json.charCodeAt(index);
        out +=
            code < 0x20 || code > 0x7e
                ? BACKSLASH_U + code.toString(16).padStart(4, '0')
                : json[index];
    }
    return out;
}

/**
 * The warning headers for a render: `Sfn-Diagram-Warning-Count` with the total, and
 * `Sfn-Diagram-Warnings` with the distinct warnings as an ASCII-only JSON array of at
 * most {@link WARNINGS_HEADER_MAX} characters. When they do not all fit, the last entry
 * says how many were left out.
 *
 * @param warnings - The extraction warnings, repeats included
 *
 * @returns The headers to send; empty when there are no warnings.
 */
export function warningsHeaders(warnings: string[]): Record<string, string> {
    if (warnings.length === 0) return {};
    const distinct = [...new Set(warnings)];
    const tail = (left: number): string => `and ${left} more; POST /lint returns every warning`;

    let value = asciiJson(distinct);
    if (value.length > WARNINGS_HEADER_MAX) {
        const kept: string[] = [];
        for (const warning of distinct) {
            const left = distinct.length - kept.length - 1;
            if (asciiJson([...kept, warning, tail(left)]).length > WARNINGS_HEADER_MAX) break;
            kept.push(warning);
        }
        value = asciiJson([...kept, tail(distinct.length - kept.length)]);
    }
    return {
        'Sfn-Diagram-Warning-Count': String(warnings.length),
        'Sfn-Diagram-Warnings': value,
    };
}

/**
 * The root `width` and `height` of an SVG this package rendered.
 *
 * @param svg - The SVG text
 *
 * @returns The size in CSS pixels, or `null` when the root tag has none.
 */
export function svgPixelSize(svg: string): { height: number; width: number } | null {
    const match = /<svg\b[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(svg);
    if (match === null) return null;
    return { height: Number(match[2]), width: Number(match[1]) };
}

type ReadBodyResult = { kind: 'aborted' } | { kind: 'ok'; text: string } | { kind: 'tooLarge' };

interface ReadBodyParams {
    limit: number;
    request: IncomingMessage;
}

/**
 * Read a request body up to `limit` bytes. Past the limit it resolves `tooLarge` at once
 * and keeps reading and discarding, so the client can finish sending and read the 413;
 * past {@link MAX_DISCARD_BYTES} it cuts the connection.
 */
function readBody(params: ReadBodyParams): Promise<ReadBodyResult> {
    const { limit, request } = params;
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let tooLarge = false;
        let ended = false;
        const giveUp = (): void => {
            tooLarge = true;
            chunks.length = 0;
            resolve({ kind: 'tooLarge' });
        };
        // A client that disconnects mid-upload may not produce an 'error' (bun's
        // node:http, for one), so 'close' before 'end' settles the read too.
        request.on('close', () => {
            if (!ended && !tooLarge) resolve({ kind: 'aborted' });
        });

        const declared = Number(request.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) giveUp();

        request.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (tooLarge) {
                if (received > MAX_DISCARD_BYTES) request.destroy();
                return;
            }
            if (received > limit) {
                giveUp();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            ended = true;
            if (!tooLarge) {
                resolve({ kind: 'ok', text: stripBom(Buffer.concat(chunks).toString('utf-8')) });
            }
        });
        // An error on the request stream is the client going away, not a server fault.
        request.on('error', () => resolve({ kind: 'aborted' }));
    });
}

interface HandleParams extends CreateServeServerParams {
    request: IncomingMessage;
    response: ServerResponse;
}

async function handle(params: HandleParams): Promise<void> {
    const { cache, config, parseQuery, request, response, standalone, version } = params;
    let url: URL;
    try {
        url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
        sendError({ message: 'Malformed request target', response, status: 400, warnings: [] });
        return;
    }
    const methods = ROUTES[url.pathname];
    if (methods === undefined) {
        sendError({
            message: `Not found: ${url.pathname}. Endpoints: POST /render, POST /lint, GET /healthz`,
            response,
            status: 404,
            warnings: [],
        });
        return;
    }
    const method = request.method ?? 'GET';
    if (!methods.includes(method)) {
        sendError({
            headers: { Allow: methods.join(', ') },
            message: `Method ${method} is not allowed on ${url.pathname}; use ${methods.join(' or ')}`,
            response,
            status: 405,
            warnings: [],
        });
        return;
    }
    if (url.pathname === '/healthz') {
        sendJson({ body: { status: 'ok', version }, response, status: 200 });
        return;
    }

    const body = await readBody({ limit: MAX_BODY_BYTES, request });
    if (body.kind === 'aborted') {
        response.destroy();
        return;
    }
    if (body.kind === 'tooLarge') {
        sendError({
            message: `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024} MiB (${MAX_BODY_BYTES} bytes)`,
            response,
            status: 413,
            warnings: [],
        });
        return;
    }

    const mode = url.pathname === '/lint' ? 'lint' : 'render';
    const parsed = parseQuery({ config, mode, query: url.searchParams });
    if (parsed.kind === 'error') {
        sendError({ message: parsed.message, response, status: 400, warnings: [] });
        return;
    }
    const { options, resolveCfn, resource } = parsed;
    const definition: RenderDefinitionInput = { path: null, resolveCfn, resource, source: body.text };

    if (mode === 'render' && options.format === 'png') {
        if (standalone) {
            sendError({
                message:
                    'format png is not available in the standalone binary: the native rasterizer ' +
                    'it needs cannot be bundled into a single-file executable. Use the Docker image, ' +
                    'or the npm package with @resvg/resvg-js installed.',
                response,
                status: 501,
                warnings: [],
            });
            return;
        }
        const probe = await handleRenderRequest({
            baseline: null,
            cache,
            definition,
            history: null,
            mode: 'render',
            options: { ...options, format: 'svg' },
        });
        if (probe.kind === 'error') {
            sendError({ message: probe.message, response, status: 422, warnings: probe.warnings });
            return;
        }
        const size = probe.kind === 'render' && typeof probe.output === 'string' ? svgPixelSize(probe.output) : null;
        // Fail closed: a diagram whose size cannot be read is not rasterized.
        if (size === null) {
            sendError({
                message: 'Could not measure the diagram to check it against the PNG size limit',
                response,
                status: 422,
                warnings: probe.warnings,
            });
            return;
        }
        const scale = options.scale ?? 1;
        const width = Math.ceil(size.width * scale);
        const height = Math.ceil(size.height * scale);
        if (width * height > MAX_PNG_PIXELS) {
            sendError({
                message:
                    `PNG would be ${width} x ${height} pixels, above this server's limit of ` +
                    `${MAX_PNG_PIXELS / 1_000_000} million; use a smaller scale or sizes, or format=svg`,
                response,
                status: 422,
                warnings: probe.warnings,
            });
            return;
        }
    }

    const result = await handleRenderRequest({ baseline: null, cache, definition, history: null, mode, options });
    if (result.kind === 'error') {
        sendError({ message: result.message, response, status: 422, warnings: result.warnings });
        return;
    }
    if (result.kind === 'lint') {
        sendJson({ body: result, response, status: 200 });
        return;
    }
    const output =
        typeof result.output === 'string'
            ? Buffer.from(result.output.endsWith('\n') ? result.output : `${result.output}\n`, 'utf-8')
            : result.output;
    response.writeHead(200, {
        ...warningsHeaders(result.warnings),
        'Content-Length': String(output.byteLength),
        'Content-Type': CONTENT_TYPES[options.format],
    });
    response.end(output);
}

/**
 * Build the `sfn-diagram serve` HTTP server, not yet listening.
 *
 * `POST /render` and `POST /lint` take the definition as the raw request body and the
 * CLI's flags (without `--`) as query parameters, and answer through the same render
 * service the CLI uses. `GET /healthz` reports the version. Every error is JSON
 * `{ kind: 'error', message, warnings }`: 400 for a bad query, 404 and 405 for a wrong
 * path or method, 413 for a body over {@link MAX_BODY_BYTES}, 422 when the definition
 * cannot be rendered, 501 for png in the standalone binary, 500 for anything unexpected.
 *
 * @param params - The shared cache, config, query parser, build flavour and version
 *
 * @returns The server; call `listen` on it.
 *
 * @example
 * ```ts
 * const server = createServeServer({
 *     cache: createLayoutCache(),
 *     config: null,
 *     parseQuery: parseServeQuery,
 *     standalone: false,
 *     version: '2.1.0',
 * });
 * server.listen(8080, '127.0.0.1');
 * ```
 */
export function createServeServer(params: CreateServeServerParams): Server {
    return createServer((request, response) => {
        handle({ ...params, request, response }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`sfn-diagram serve: ${request.method} ${request.url}: ${message}\n`);
            if (!response.headersSent && !response.destroyed) {
                sendError({ message: 'Internal server error', response, status: 500, warnings: [] });
            } else {
                response.destroy();
            }
        });
    });
}

/** Parameters for {@link runServe}. */
export interface RunServeParams {
    /** The arguments after `serve`. */
    argv: string[];
    /** Turns a query string into options; `cli.ts` passes its `parseServeQuery`. */
    parseQuery: ParseServeQuery;
    /** Stops the server like SIGINT does. Tests use it; Windows cannot send SIGTERM to a child. */
    signal?: AbortSignal;
    /** Whether this is the standalone binary, which cannot rasterize png. */
    standalone: boolean;
    /** The package version, reported by `GET /healthz`. */
    version: string;
}

/**
 * Run `sfn-diagram serve`: load the config file, listen, and serve until SIGINT, SIGTERM
 * or `signal` aborts. Shutdown stops accepting connections, gives in-flight requests
 * {@link SHUTDOWN_GRACE_MS} to finish, then closes whatever is left.
 *
 * @param params - The arguments after `serve`, the query parser, the build flavour and the version
 *
 * @returns The exit code: 0 after a clean shutdown or `--help`, 1 for a config file that
 *   cannot be loaded or an address that cannot be bound, 2 for a bad flag.
 *
 * @example
 * ```ts
 * process.exitCode = await runServe({
 *     argv: ['--port', '8080'],
 *     parseQuery: parseServeQuery,
 *     standalone: false,
 *     version: '2.1.0',
 * });
 * ```
 */
export async function runServe(params: RunServeParams): Promise<number> {
    const { argv, parseQuery, signal, standalone, version } = params;
    let values: { config?: string; help?: boolean; host?: string; port?: string };
    try {
        ({ values } = parseArgs({
            allowPositionals: false,
            args: argv,
            options: {
                config: { type: 'string' },
                help: { short: 'h', type: 'boolean' },
                host: { type: 'string' },
                port: { type: 'string' },
            },
            strict: true,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n\n${SERVE_HELP_TEXT}`);
        return 2;
    }
    if (values.help) {
        process.stdout.write(SERVE_HELP_TEXT);
        return 0;
    }

    const port = values.port === undefined ? DEFAULT_SERVE_PORT : Number(values.port);
    if ((values.port !== undefined && !/^\d+$/.test(values.port)) || port > 65535) {
        process.stderr.write(`Invalid --port: ${values.port}. Expected a whole number from 0 to 65535\n`);
        return 2;
    }
    const host = values.host ?? DEFAULT_SERVE_HOST;
    if (host.trim() === '') {
        process.stderr.write('Invalid --host: expected an address such as 127.0.0.1 or 0.0.0.0\n');
        return 2;
    }

    let loaded: { config: CliConfig; path: string } | null;
    try {
        loaded = loadCliConfig({
            explicitPath: values.config ?? null,
            onWarning: ({ message }) => {
                process.stderr.write(`${message}\n`);
            },
            startDir: process.cwd(),
        });
    } catch (error) {
        if (!(error instanceof CliConfigError)) throw error;
        process.stderr.write(`Error: ${error.message}\n`);
        return 1;
    }
    if (loaded !== null) {
        process.stderr.write(`sfn-diagram serve: read settings from ${loaded.path}\n`);
    }

    const server = createServeServer({
        cache: createLayoutCache(),
        config: loaded?.config ?? null,
        parseQuery,
        standalone,
        version,
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen({ host, port }, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: cannot listen on ${host}:${port}: ${message}\n`);
        return 1;
    }

    const address = server.address() as AddressInfo;
    const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
    process.stderr.write(`sfn-diagram serve: listening on http://${shownHost}:${address.port}\n`);

    let removeListeners = (): void => {};
    await new Promise<void>((resolve) => {
        const stop = (): void => resolve();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        signal?.addEventListener('abort', stop, { once: true });
        removeListeners = () => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            signal?.removeEventListener('abort', stop);
        };
        if (signal?.aborted) stop();
    });
    removeListeners();

    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();
    const grace = setTimeout(() => server.closeAllConnections?.(), SHUTDOWN_GRACE_MS);
    grace.unref();
    await closed;
    clearTimeout(grace);
    return 0;
}
