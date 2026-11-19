import type { CliConfig } from './cliConfig';
import type { ResolvedCliOptions } from './cliOptions';

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
