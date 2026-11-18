import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
    MCP_PROTOCOL_VERSIONS,
    createMcpMessageHandler,
    serveMcp,
    type McpTool,
} from '../src/cliMcpServer';

const echoTool: McpTool = {
    annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
    },
    call: async (args) => ({
        content: [{ text: JSON.stringify(args), type: 'text' }],
    }),
    description: 'Echoes its arguments.',
    inputSchema: { properties: {}, type: 'object' },
    name: 'echo',
    title: 'Echo',
};

const throwingTool: McpTool = {
    ...echoTool,
    call: async () => {
        throw new Error('tool exploded');
    },
    name: 'boom',
};

const multilineTool: McpTool = {
    ...echoTool,
    call: async () => ({
        content: [{ text: 'line one\nline two\r\nline three', type: 'text' }],
    }),
    name: 'multiline',
};

const handle = createMcpMessageHandler({
    instructions: 'Test instructions.',
    serverInfo: { name: 'test-server', title: 'Test', version: '1.2.3' },
    tools: [echoTool, throwingTool, multilineTool],
});

interface RpcReply {
    error?: { code: number; message: string };
    id: number | string | null;
    jsonrpc: string;
    result?: Record<string, unknown>;
}

/** Sends one request object and parses the reply, failing when there is none. */
async function request(message: unknown): Promise<RpcReply> {
    const reply = await handle(JSON.stringify(message));
    expect(reply).not.toBeNull();
    return JSON.parse(reply as string) as RpcReply;
}

describe('createMcpMessageHandler: initialize', () => {
    it('echoes a supported protocol version', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                capabilities: {},
                clientInfo: { name: 'client', version: '0' },
                protocolVersion: '2025-06-18',
            },
        });
        expect(reply.id).toBe(1);
        expect(reply.result).toMatchObject({
            capabilities: { tools: { listChanged: false } },
            instructions: 'Test instructions.',
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'test-server', version: '1.2.3' },
        });
    });

    it('answers its latest version for an unknown one', async () => {
        const reply = await request({
            id: 2,
            jsonrpc: '2.0',
            method: 'initialize',
            params: { protocolVersion: '1999-01-01' },
        });
        expect(reply.result?.protocolVersion).toBe('2025-11-25');
        expect(MCP_PROTOCOL_VERSIONS[0]).toBe('2025-11-25');
    });

    it('accepts the oldest SDK-supported version', async () => {
        const reply = await request({
            id: 3,
            jsonrpc: '2.0',
            method: 'initialize',
            params: { protocolVersion: '2024-10-07' },
        });
        expect(reply.result?.protocolVersion).toBe('2024-10-07');
    });
});

describe('createMcpMessageHandler: ping and tools/list', () => {
    it('answers ping for numeric and string ids', async () => {
        const numeric = await request({
            id: 7,
            jsonrpc: '2.0',
            method: 'ping',
        });
        expect(numeric).toEqual({ id: 7, jsonrpc: '2.0', result: {} });
        const text = await request({
            id: 'abc',
            jsonrpc: '2.0',
            method: 'ping',
        });
        expect(text).toEqual({ id: 'abc', jsonrpc: '2.0', result: {} });
    });

    it('lists tool definitions without their handlers', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/list',
        });
        const tools = reply.result?.tools as Record<string, unknown>[];
        expect(tools.map((tool) => tool.name)).toEqual([
            'echo',
            'boom',
            'multiline',
        ]);
        for (const tool of tools) {
            expect(tool).not.toHaveProperty('call');
            expect(tool).toHaveProperty('inputSchema');
        }
    });
});

describe('createMcpMessageHandler: tools/call', () => {
    it('refuses an unknown tool with -32602', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'nope' },
        });
        expect(reply.error?.code).toBe(-32602);
        expect(reply.error?.message).toContain('nope');
    });

    it('refuses arguments that are not an object with -32602', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { arguments: [], name: 'echo' },
        });
        expect(reply.error?.code).toBe(-32602);
    });

    it('passes the arguments through and returns the result', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { arguments: { answer: 42 }, name: 'echo' },
        });
        expect(reply.result).toEqual({
            content: [{ text: '{"answer":42}', type: 'text' }],
        });
    });

    it('calls with an empty object when arguments are absent', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'echo' },
        });
        expect(reply.result).toEqual({
            content: [{ text: '{}', type: 'text' }],
        });
    });

    it('turns a throwing handler into an isError result', async () => {
        const reply = await request({
            id: 1,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'boom' },
        });
        expect(reply.result).toEqual({
            content: [{ text: 'tool exploded', type: 'text' }],
            isError: true,
        });
    });
});

describe('createMcpMessageHandler: other methods and notifications', () => {
    it('answers an unknown method with -32601', async () => {
        const reply = await request({
            id: 9,
            jsonrpc: '2.0',
            method: 'resources/list',
        });
        expect(reply.id).toBe(9);
        expect(reply.error?.code).toBe(-32601);
    });

    it('answers server/discover with -32601 so clients fall back', async () => {
        const reply = await request({
            id: 10,
            jsonrpc: '2.0',
            method: 'server/discover',
        });
        expect(reply.error?.code).toBe(-32601);
    });

    it('sends nothing for notifications', async () => {
        expect(
            await handle(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized',
                }),
            ),
        ).toBeNull();
        expect(
            await handle(
                JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/whatever',
                }),
            ),
        ).toBeNull();
    });

    it('sends nothing for a client response or a blank line', async () => {
        expect(
            await handle(JSON.stringify({ id: 4, jsonrpc: '2.0', result: {} })),
        ).toBeNull();
        expect(await handle('   ')).toBeNull();
    });
});

describe('createMcpMessageHandler: malformed messages', () => {
    it('answers invalid JSON with -32700 and a null id', async () => {
        const reply = JSON.parse((await handle('{')) as string) as RpcReply;
        expect(reply.id).toBeNull();
        expect(reply.error?.code).toBe(-32700);
    });

    it('refuses a batch with -32600', async () => {
        const reply = await request([
            { id: 1, jsonrpc: '2.0', method: 'ping' },
        ]);
        expect(reply.id).toBeNull();
        expect(reply.error?.code).toBe(-32600);
    });

    it('refuses a message without jsonrpc 2.0, echoing its id', async () => {
        const reply = await request({ id: 5, method: 'ping' });
        expect(reply.id).toBe(5);
        expect(reply.error?.code).toBe(-32600);
    });

    it('refuses an id that is neither a string nor a number', async () => {
        const reply = await request({
            id: { x: 1 },
            jsonrpc: '2.0',
            method: 'ping',
        });
        expect(reply.id).toBeNull();
        expect(reply.error?.code).toBe(-32600);
    });
});

describe('serveMcp', () => {
    it('answers each line in order, one line per message', async () => {
        const input = new PassThrough();
        const chunks: string[] = [];
        const served = serveMcp({
            input,
            instructions: '',
            output: { write: (chunk: string) => chunks.push(chunk) },
            serverInfo: { name: 'test-server', title: 'Test', version: '1' },
            tools: [multilineTool],
        });
        input.write(
            `${JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'ping' })}\r\n`,
        );
        input.write(
            `${JSON.stringify({ id: 2, jsonrpc: '2.0', method: 'tools/call', params: { name: 'multiline' } })}\r\n`,
        );
        input.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
        );
        input.end();
        await served;

        const written = chunks.join('');
        expect(written.endsWith('\n')).toBe(true);
        const lines = written.split('\n').slice(0, -1);
        expect(lines).toHaveLength(2);
        const replies = lines.map((line) => JSON.parse(line) as RpcReply);
        expect(replies.map((reply) => reply.id)).toEqual([1, 2]);
        expect((replies[1].result?.content as { text: string }[])[0].text).toBe(
            'line one\nline two\r\nline three',
        );
        // One write per message, so a reader never sees half a line.
        expect(chunks).toHaveLength(2);
    });
});
