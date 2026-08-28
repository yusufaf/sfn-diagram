import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateMermaid, generateSvg } from '../src/index';
import type { AslDefinition } from '../src/types';

const repoRoot = join(__dirname, '..');

/** A fenced code block lifted out of a Markdown document. */
interface CodeBlock {
    /** Info string after the opening fence, e.g. `ts`. */
    language: string;
    /** Block body, without the fences. */
    source: string;
}

/**
 * Collect fenced code blocks from a Markdown document.
 *
 * @param params - Extraction parameters.
 * @param params.languages - Info strings to keep, e.g. `['ts', 'typescript']`.
 * @param params.markdown - Raw Markdown source.
 * @returns Every fenced block whose info string is in `languages`.
 */
function collectCodeBlocks(params: { languages: string[]; markdown: string }): CodeBlock[] {
    const { languages, markdown } = params;
    const blocks: CodeBlock[] = [];

    for (const match of markdown.matchAll(/```(\w+)\r?\n([\s\S]*?)```/g)) {
        const language = match[1].toLowerCase();
        if (languages.includes(language)) {
            blocks.push({ language, source: match[2] });
        }
    }

    return blocks;
}

/**
 * Read a documentation file relative to the repository root.
 *
 * @param relativePath - Path from the repo root, e.g. `'README.md'`.
 * @returns The file's UTF-8 contents.
 */
function readDoc(relativePath: string): string {
    return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

/**
 * Documented call shapes are easy to get wrong by hand, and both the README and
 * AGENTS.md shipped an invented `{ asl, options }` form that never existed — the
 * real params are flat (`GenerateSvgParams extends DiagramOptions`). These tests
 * pin the shape so a reader-facing example cannot drift from the signature again.
 */
describe('documentation examples', () => {
    const docs = ['README.md', 'AGENTS.md'];

    describe.each(docs)('%s', (doc) => {
        const markdown = readDoc(doc);
        const blocks = collectCodeBlocks({
            languages: ['ts', 'tsx', 'typescript'],
            markdown,
        });

        it('contains at least one TypeScript example', () => {
            expect(blocks.length).toBeGreaterThan(0);
        });

        it('never nests diagram options under an `options` key', () => {
            for (const block of blocks) {
                expect(block.source).not.toMatch(/^\s*options:\s*\{/m);
            }
        });

        it('names the definition `aslDefinition`, not `asl`', () => {
            for (const block of blocks) {
                expect(block.source).not.toMatch(/^\s*asl:\s/m);
            }
        });
    });

    it('the README quick-start call actually runs', () => {
        // Mirrors the README snippet exactly; if the documented shape stops
        // matching the signature, this stops compiling or throws.
        const aslDefinition: AslDefinition = {
            StartAt: 'Hello',
            States: {
                Hello: { Type: 'Pass', Next: 'World' },
                World: { Type: 'Succeed' },
            },
        };

        const { svg } = generateSvg({ aslDefinition, layout: 'TB', theme: 'light' });

        expect(svg).toContain('<svg');
        expect(svg).toContain('Hello');
    });

    it('the AGENTS.md calling-convention example actually runs', () => {
        const aslDefinition: AslDefinition = {
            StartAt: 'Only',
            States: { Only: { Type: 'Succeed' } },
        };

        const { svg } = generateSvg({
            aslDefinition,
            edgeStyle: 'curved',
            layout: 'LR',
            theme: 'dark',
        });

        expect(svg).toContain('<svg');
    });

    it('generateMermaid takes the same flat shape', () => {
        const aslDefinition: AslDefinition = {
            StartAt: 'Only',
            States: { Only: { Type: 'Succeed' } },
        };

        const { code } = generateMermaid({ aslDefinition, layout: 'TB' });

        expect(code).toContain('stateDiagram-v2');
    });
});
