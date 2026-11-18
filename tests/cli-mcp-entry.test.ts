import { spawn } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// These tests spawn the built bin, so they need dist/bin.js. The build runs before
// tests in CI; locally, `pnpm run build` first or they are skipped.
const binPath = resolve(__dirname, '..', 'dist', 'bin.js');
const fixtures = join(__dirname, 'fixtures');
const simpleText = readFileSync(join(fixtures, 'simple.asl.json'), 'utf-8');
const withLegacyText = JSON.stringify({
    ...JSON.parse(simpleText),
    States: {
        ...JSON.parse(simpleText).States,
        Legacy: { End: true, Type: 'Pass' },
    },
});

interface ConnectParams {
    auto: boolean;
}

describe.skipIf(!existsSync(binPath))('sfn-diagram mcp over stdio', () => {
    let workDir: string;
    const clients: Client[] = [];

    beforeAll(() => {
        workDir = mkdtempSync(join(tmpdir(), 'sfn-mcp-entry-'));
        copyFileSync(
            join(fixtures, 'simple.asl.json'),
            join(workDir, 'simple.asl.json'),
        );
    });

    afterAll(async () => {
        await Promise.all(clients.map((client) => client.close()));
        rmSync(workDir, { force: true, recursive: true });
    });

    async function connect({ auto }: ConnectParams): Promise<Client> {
        const transport = new StdioClientTransport({
            args: [binPath, 'mcp'],
            command: process.execPath,
            cwd: workDir,
            stderr: 'pipe',
        });
        const client = new Client(
            { name: 'sfn-diagram-test', version: '0' },
            auto ? { versionNegotiation: { mode: 'auto' } } : {},
        );
        await client.connect(transport);
        clients.push(client);
        return client;
    }

    it(
        'serves the three tools to the official SDK client',
        { timeout: 60_000 },
        async () => {
            const client = await connect({ auto: false });
            expect(client.getServerVersion()?.name).toBe('sfn-diagram');

            const { tools } = await client.listTools();
            expect(tools.map((tool) => tool.name)).toEqual([
                'render',
                'diff',
                'lint',
            ]);

            const render = await client.callTool({
                arguments: { format: 'mermaid', path: 'simple.asl.json' },
                name: 'render',
            });
            expect(render.isError).toBeFalsy();
            const renderContent = render.content as {
                text: string;
                type: string;
            }[];
            expect(renderContent[0].text.startsWith('stateDiagram')).toBe(true);
            expect(render.structuredContent).toBeUndefined();

            // The client validates structuredContent against lint's outputSchema here.
            const lint = await client.callTool({
                arguments: { path: 'simple.asl.json' },
                name: 'lint',
            });
            expect(lint.isError).toBeFalsy();
            expect((lint.structuredContent as { kind: string }).kind).toBe(
                'lint',
            );

            const diff = await client.callTool({
                arguments: {
                    baseline: simpleText,
                    format: 'mermaid',
                    source: withLegacyText,
                },
                name: 'diff',
            });
            const diffContent = diff.content as {
                text: string;
                type: string;
            }[];
            const summary = JSON.parse(
                diffContent[diffContent.length - 1].text,
            ) as {
                diff: { added: string[] };
            };
            expect(summary.diff.added).toEqual(['Legacy']);
        },
    );

    // This proves only that a probing client still connects; any reply to its
    // server/discover probe, or none, makes it fall back. The -32601 answer itself is
    // pinned in tests/cliMcpServer.test.ts.
    it(
        'auto-negotiating clients still connect',
        { timeout: 60_000 },
        async () => {
            const client = await connect({ auto: true });
            const { tools } = await client.listTools();
            expect(tools).toHaveLength(3);
        },
    );

    // The SDK client skips stdout lines that are not JSON, so it cannot catch a stray
    // write. Read the raw stream instead.
    it(
        'writes nothing to stdout but one JSON-RPC line per request',
        { timeout: 60_000 },
        async () => {
            const requests = [
                {
                    method: 'initialize',
                    params: {
                        capabilities: {},
                        clientInfo: { name: 't', version: '0' },
                        protocolVersion: '2025-11-25',
                    },
                },
                { method: 'tools/list' },
                {
                    method: 'tools/call',
                    params: {
                        arguments: {
                            format: 'mermaid',
                            path: 'simple.asl.json',
                        },
                        name: 'render',
                    },
                },
                {
                    method: 'tools/call',
                    params: {
                        arguments: { format: 'svg', path: 'simple.asl.json' },
                        name: 'render',
                    },
                },
                {
                    method: 'tools/call',
                    params: {
                        arguments: {
                            format: 'html',
                            outputPath: 'out.html',
                            path: 'simple.asl.json',
                        },
                        name: 'render',
                    },
                },
                {
                    method: 'tools/call',
                    params: {
                        arguments: {
                            baseline: simpleText,
                            format: 'mermaid',
                            source: withLegacyText,
                        },
                        name: 'diff',
                    },
                },
                {
                    method: 'tools/call',
                    params: {
                        arguments: { path: 'simple.asl.json' },
                        name: 'lint',
                    },
                },
            ];
            const child = spawn(process.execPath, [binPath, 'mcp'], {
                cwd: workDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            child.stdout.setEncoding('utf-8');
            child.stdout.on('data', (chunk: string) => {
                stdout += chunk;
            });
            child.stderr.resume();
            const exited = new Promise<number | null>((resolveExit) =>
                child.on('close', resolveExit),
            );
            child.stdin.end(
                requests
                    .map((request, index) =>
                        JSON.stringify({
                            id: index + 1,
                            jsonrpc: '2.0',
                            ...request,
                        }),
                    )
                    .join('\n') + '\n',
            );
            expect(await exited).toBe(0);

            const lines = stdout.split('\n');
            expect(lines.pop()).toBe('');
            expect(lines).toHaveLength(requests.length);
            const replies = lines.map(
                (line) =>
                    JSON.parse(line) as {
                        error?: unknown;
                        id: number;
                        jsonrpc: string;
                    },
            );
            for (const reply of replies) {
                expect(reply.jsonrpc).toBe('2.0');
                expect(reply.error).toBeUndefined();
            }
            expect(replies.map((reply) => reply.id)).toEqual([
                1, 2, 3, 4, 5, 6, 7,
            ]);
            expect(existsSync(join(workDir, 'out.html'))).toBe(true);
        },
    );
});
