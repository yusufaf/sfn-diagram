#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateMermaid, generateSvg } from './index';
import { exportPng } from './png';
import type { DiagramFormat, LayoutDirection, ThemeOption } from './types';

export interface CliArgs {
    format: DiagramFormat;
    hideCatch: boolean;
    input: string | null;
    layout: LayoutDirection;
    output: string | null;
    showHelp: boolean;
    showVersion: boolean;
    theme: ThemeOption;
}

const HELP_TEXT = `sfn-diagram — generate diagrams from AWS Step Functions ASL definitions

Usage:
  sfn-diagram <input> [options]
  sfn-diagram - [options]            (read ASL from stdin)

Options:
  --format <svg|mermaid|png>   Output format (default: svg)
  -o, --output <path>          Output file path (required for png; stdout otherwise)
  --theme <light|dark>         Color theme for SVG/PNG (default: light)
  --layout <TB|LR|RL|BT>       Graph layout direction (default: TB)
  --hide-catch                 Drop error-handler (Catch) branches from the diagram
  -h, --help                   Show this help and exit
  -v, --version                Show version and exit

Examples:
  sfn-diagram state.asl.json --format svg -o diagram.svg
  sfn-diagram state.asl.json --format mermaid > diagram.mmd
  cat state.asl.json | sfn-diagram - --format png -o diagram.png
`;

export function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        format: 'svg',
        hideCatch: false,
        input: null,
        layout: 'TB',
        output: null,
        showHelp: false,
        showVersion: false,
        theme: 'light',
    };

    const validFormats: DiagramFormat[] = ['svg', 'mermaid', 'png'];
    const validLayouts: LayoutDirection[] = ['TB', 'LR', 'RL', 'BT'];
    const validThemes = ['light', 'dark'] as const;

    const expectValue = (flag: string, value: string | undefined): string => {
        if (value === undefined) {
            throw new CliError(`Flag ${flag} requires a value`, 2);
        }
        return value;
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];

        if (arg === '-h' || arg === '--help') {
            args.showHelp = true;
            continue;
        }
        if (arg === '-v' || arg === '--version') {
            args.showVersion = true;
            continue;
        }
        if (arg === '--format') {
            const value = expectValue(arg, argv[++index]);
            if (!validFormats.includes(value as DiagramFormat)) {
                throw new CliError(
                    `Invalid --format: ${value}. Expected one of: ${validFormats.join(', ')}`,
                    2
                );
            }
            args.format = value as DiagramFormat;
            continue;
        }
        if (arg === '-o' || arg === '--output') {
            args.output = expectValue(arg, argv[++index]);
            continue;
        }
        if (arg === '--theme') {
            const value = expectValue(arg, argv[++index]);
            if (!validThemes.includes(value as 'light' | 'dark')) {
                throw new CliError(
                    `Invalid --theme: ${value}. Expected one of: ${validThemes.join(', ')}`,
                    2
                );
            }
            args.theme = value as ThemeOption;
            continue;
        }
        if (arg === '--layout') {
            const value = expectValue(arg, argv[++index]);
            if (!validLayouts.includes(value as LayoutDirection)) {
                throw new CliError(
                    `Invalid --layout: ${value}. Expected one of: ${validLayouts.join(', ')}`,
                    2
                );
            }
            args.layout = value as LayoutDirection;
            continue;
        }
        if (arg === '--hide-catch') {
            args.hideCatch = true;
            continue;
        }
        if (arg.startsWith('--') || (arg.startsWith('-') && arg !== '-')) {
            throw new CliError(`Unknown flag: ${arg}`, 2);
        }
        if (args.input !== null) {
            throw new CliError(`Unexpected positional argument: ${arg}`, 2);
        }
        args.input = arg;
    }

    return args;
}

export class CliError extends Error {
    constructor(
        message: string,
        public exitCode: number
    ) {
        super(message);
    }
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function readPackageVersion(): string {
    try {
        const url = new URL('../package.json', import.meta.url);
        const packageJson = JSON.parse(readFileSync(url, 'utf-8')) as { version: string };
        return packageJson.version;
    } catch {
        return 'unknown';
    }
}

async function loadAsl(input: string | null): Promise<string> {
    if (input === null || input === '-') {
        return readStdin();
    }
    return readFileSync(resolve(input), 'utf-8');
}

export async function run(argv: string[]): Promise<number> {
    let args: CliArgs;
    try {
        args = parseArgs(argv);
    } catch (error) {
        if (error instanceof CliError) {
            process.stderr.write(`${error.message}\n\n${HELP_TEXT}`);
            return error.exitCode;
        }
        throw error;
    }

    if (args.showHelp) {
        process.stdout.write(HELP_TEXT);
        return 0;
    }
    if (args.showVersion) {
        process.stdout.write(`${readPackageVersion()}\n`);
        return 0;
    }

    if (args.format === 'png' && !args.output) {
        process.stderr.write('--output is required when --format is png\n');
        return 1;
    }

    let aslSource: string;
    try {
        aslSource = await loadAsl(args.input);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to read input: ${message}\n`);
        return 1;
    }

    try {
        if (args.format === 'mermaid') {
            const result = generateMermaid({
                aslDefinition: aslSource,
                catchHandling: args.hideCatch ? 'hide' : 'show',
            });
            writeOutput(result.code, args.output);
            return 0;
        }

        if (args.format === 'svg') {
            const result = generateSvg({
                aslDefinition: aslSource,
                catchHandling: args.hideCatch ? 'hide' : 'show',
                layout: args.layout,
                theme: args.theme,
            });
            writeOutput(result.svg, args.output);
            return 0;
        }

        const result = await exportPng({
            aslDefinition: aslSource,
            catchHandling: args.hideCatch ? 'hide' : 'show',
            layout: args.layout,
            theme: args.theme,
        });
        writeFileSync(resolve(args.output as string), result.buffer);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        return 1;
    }
}

function writeOutput(content: string, outputPath: string | null): void {
    if (outputPath) {
        writeFileSync(resolve(outputPath), content, 'utf-8');
    } else {
        process.stdout.write(content);
        if (!content.endsWith('\n')) {
            process.stdout.write('\n');
        }
    }
}

// Only execute when invoked directly as the `sfn-diagram` bin, not when
// imported (e.g. by tests). The CLI is built ESM-only (see tsdown.config.ts),
// so comparing this module's URL to the invoked script is safe.
const invokedDirectly =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    void run(process.argv.slice(2)).then((code) => {
        process.exit(code);
    });
}
