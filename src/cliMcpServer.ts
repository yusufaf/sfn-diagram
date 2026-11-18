import { createInterface } from 'node:readline';

/**
 * The MCP protocol versions this server speaks, newest first. `initialize` echoes the
 * client's version when it is listed here and answers the first entry otherwise.
 *
 * All of them are the "legacy" handshake era (`initialize`, then
 * `notifications/initialized`). A client that probes for the newer era with
 * `server/discover` gets "method not found" and falls back to this handshake.
 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = [
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    '2024-11-05',
    '2024-10-07',
];

/** One block of a tool result's `content`. */
export type McpContent =
    | { text: string; type: 'text' }
    | { data: string; mimeType: string; type: 'image' };

/** What a tool's `call` resolves to: the MCP `CallToolResult`. */
export interface McpToolResult {
    content: McpContent[];
    /** True when the call failed; the content then says why, for the model to read. */
    isError?: boolean;
    /** Structured output; must match the tool's `outputSchema` when it has one. */
    structuredContent?: Record<string, unknown>;
}

/** The behaviour hints MCP clients show users or use to decide on confirmation. */
export interface McpToolAnnotations {
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
    readOnlyHint: boolean;
}

/** A tool definition and its handler. Everything but `call` is sent by `tools/list`. */
export interface McpTool {
    annotations: McpToolAnnotations;
    /**
     * Runs the tool. A rejection becomes an `isError` result carrying its message, so
     * input mistakes reach the model rather than failing the request.
     */
    call: (args: Record<string, unknown>) => Promise<McpToolResult>;
    description: string;
    /** A JSON Schema whose root is `{ type: 'object' }`. */
    inputSchema: Record<string, unknown>;
    name: string;
    /** A JSON Schema for `structuredContent`, root `{ type: 'object' }`, if any. */
    outputSchema?: Record<string, unknown>;
    title: string;
}

/** The `serverInfo` sent in the `initialize` result. */
export interface McpServerInfo {
    name: string;
    title: string;
    version: string;
}

/** Parameters for {@link createMcpMessageHandler}. */
export interface CreateMcpMessageHandlerParams {
    /** Guidance for the model, sent in the `initialize` result. */
    instructions: string;
    /** Who this server is, sent in the `initialize` result. */
    serverInfo: McpServerInfo;
    /** The tools `tools/list` advertises and `tools/call` dispatches to. */
    tools: McpTool[];
}

/** Parameters for {@link serveMcp}. */
export interface ServeMcpParams extends CreateMcpMessageHandlerParams {
    /** Newline-delimited JSON-RPC requests, usually `process.stdin`. */
    input: NodeJS.ReadableStream;
    /** Where responses go, one line each, usually `process.stdout`. */
    output: { write: (chunk: string) => unknown };
}

type RpcId = number | string | null;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is number | string {
    return typeof value === 'number' || typeof value === 'string';
}

function errorReply(params: {
    code: number;
    id: RpcId;
    message: string;
}): string {
    const { code, id, message } = params;
    return JSON.stringify({ error: { code, message }, id, jsonrpc: '2.0' });
}

function resultReply(params: { id: RpcId; result: unknown }): string {
    const { id, result } = params;
    return JSON.stringify({ id, jsonrpc: '2.0', result });
}

/**
 * Build the per-line request handler of a stdio MCP server.
 *
 * Kept free of any I/O so the protocol rules can be tested one message at a time;
 * {@link serveMcp} wires it to streams. Only the tools capability is offered: no
 * resources, prompts, logging, progress or cancellation. Requests are served before
 * `initialize` too, since refusing them would gain nothing.
 *
 * @param params - The server's identity, instructions and tools
 *
 * @returns A function that takes one line of input and resolves to the response line
 *   (without a trailing newline), or `null` when the line needs no response: a blank
 *   line, a notification, or a response from the client.
 *
 * @example
 * ```ts
 * const handle = createMcpMessageHandler({ instructions: '', serverInfo, tools });
 * await handle('{"jsonrpc":"2.0","id":1,"method":"ping"}');
 * // '{"id":1,"jsonrpc":"2.0","result":{}}'
 * ```
 */
export function createMcpMessageHandler(
    params: CreateMcpMessageHandlerParams,
): (line: string) => Promise<string | null> {
    const { instructions, serverInfo, tools } = params;
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const definitions = tools.map((tool) => {
        const definition: Partial<McpTool> = { ...tool };
        delete definition.call;
        return definition;
    });

    return async (line) => {
        if (line.trim() === '') return null;

        let message: unknown;
        try {
            message = JSON.parse(line);
        } catch {
            return errorReply({
                code: PARSE_ERROR,
                id: null,
                message: 'Parse error',
            });
        }
        if (Array.isArray(message)) {
            return errorReply({
                code: INVALID_REQUEST,
                id: null,
                message: 'Batch requests are not supported',
            });
        }
        if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
            const id =
                isPlainObject(message) && isRpcId(message.id)
                    ? message.id
                    : null;
            return errorReply({
                code: INVALID_REQUEST,
                id,
                message: 'Invalid request: expected a JSON-RPC 2.0 object',
            });
        }
        if (typeof message.method !== 'string') {
            if ('result' in message || 'error' in message) return null;
            return errorReply({
                code: INVALID_REQUEST,
                id: isRpcId(message.id) ? message.id : null,
                message: 'Invalid request: missing method',
            });
        }
        if (!('id' in message)) return null;
        if (!isRpcId(message.id)) {
            return errorReply({
                code: INVALID_REQUEST,
                id: null,
                message: 'Invalid request: id must be a string or a number',
            });
        }

        const { id, method } = message;
        const requestParams = isPlainObject(message.params)
            ? message.params
            : {};
        switch (method) {
            case 'initialize': {
                const requested = requestParams.protocolVersion;
                const protocolVersion =
                    typeof requested === 'string' &&
                    MCP_PROTOCOL_VERSIONS.includes(requested)
                        ? requested
                        : MCP_PROTOCOL_VERSIONS[0];
                return resultReply({
                    id,
                    result: {
                        capabilities: { tools: { listChanged: false } },
                        instructions,
                        protocolVersion,
                        serverInfo,
                    },
                });
            }
            case 'ping':
                return resultReply({ id, result: {} });
            case 'tools/list':
                return resultReply({ id, result: { tools: definitions } });
            case 'tools/call': {
                const name = requestParams.name;
                const tool =
                    typeof name === 'string'
                        ? toolsByName.get(name)
                        : undefined;
                if (tool === undefined) {
                    return errorReply({
                        code: INVALID_PARAMS,
                        id,
                        message: `Unknown tool: ${String(name)}`,
                    });
                }
                const toolArguments = requestParams.arguments ?? {};
                if (!isPlainObject(toolArguments)) {
                    return errorReply({
                        code: INVALID_PARAMS,
                        id,
                        message: 'Invalid params: arguments must be an object',
                    });
                }
                try {
                    return resultReply({
                        id,
                        result: await tool.call(toolArguments),
                    });
                } catch (error) {
                    return resultReply({
                        id,
                        result: {
                            content: [
                                {
                                    text:
                                        error instanceof Error
                                            ? error.message
                                            : String(error),
                                    type: 'text',
                                },
                            ],
                            isError: true,
                        },
                    });
                }
            }
            default:
                return errorReply({
                    code: METHOD_NOT_FOUND,
                    id,
                    message: `Method not found: ${method}`,
                });
        }
    };
}

/**
 * Serve MCP over newline-delimited JSON-RPC until `input` ends.
 *
 * Requests are handled one at a time in arrival order, and each response is written
 * with a single `write`, so the output is always whole lines. `JSON.stringify` escapes
 * newlines inside strings, which keeps every message on one line.
 *
 * @param params - The streams, plus the server's identity, instructions and tools
 *
 * @returns A promise that resolves once `input` has ended and every response is written.
 *
 * @example
 * ```ts
 * await serveMcp({
 *     input: process.stdin,
 *     instructions: 'Renders diagrams.',
 *     output: process.stdout,
 *     serverInfo: { name: 'sfn-diagram', title: 'sfn-diagram', version: '2.1.0' },
 *     tools,
 * });
 * ```
 */
export async function serveMcp(params: ServeMcpParams): Promise<void> {
    const { input, output, ...handlerParams } = params;
    const handle = createMcpMessageHandler(handlerParams);
    const lines = createInterface({ crlfDelay: Infinity, input });
    for await (const line of lines) {
        const response = await handle(line);
        if (response !== null) output.write(`${response}\n`);
    }
}
