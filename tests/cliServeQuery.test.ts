import { describe, expect, it } from 'vitest';
import { parseServeQuery } from '../src/cli';
import type { CliConfig } from '../src/cliConfig';
import { resolveCliOptions } from '../src/cliOptions';
import type { CliOptionSource } from '../src/cliOptions';
import type { ServeQueryResult } from '../src/cliServe';

interface RenderParams {
    config?: CliConfig | null;
    mode?: 'lint' | 'render';
    query: string;
}

function parse(params: RenderParams): ServeQueryResult {
    const { config = null, mode = 'render', query } = params;
    return parseServeQuery({ config, mode, query: new URLSearchParams(query) });
}

function expectOk(result: ServeQueryResult): Extract<ServeQueryResult, { kind: 'ok' }> {
    if (result.kind !== 'ok') throw new Error(`expected ok, got: ${result.message}`);
    return result;
}

function expectError(result: ServeQueryResult): string {
    if (result.kind !== 'error') throw new Error('expected an error');
    return result.message;
}

const ALL_NULL: CliOptionSource = {
    backgroundColor: null,
    catchHandling: null,
    catchLabelStyle: null,
    collapse: null,
    diagramDescription: null,
    diagramTitle: null,
    edgeStyle: null,
    format: null,
    iconPosition: null,
    iconSize: null,
    includeComments: null,
    includeRawState: null,
    layout: null,
    loadSystemFonts: null,
    nodeHeight: null,
    nodeSeparation: null,
    nodeWidth: null,
    padding: null,
    rankSeparation: null,
    redactFields: null,
    scale: null,
    showIcons: null,
    showStateTypes: null,
    showVariables: null,
    stylePreset: null,
    theme: null,
};

describe('parseServeQuery in render mode', () => {
    it('gives the CLI defaults for an empty query', () => {
        const result = expectOk(parse({ query: '' }));
        expect(result.options).toEqual(resolveCliOptions({ args: ALL_NULL, config: null }));
        expect(result.options.format).toBe('svg');
        expect(result.options.layout).toBe('TB');
        expect(result.options.theme).toBe('light');
        expect(result.resolveCfn).toBe(false);
        expect(result.resource).toBeNull();
    });

    it('maps value parameters onto their flags', () => {
        const { options } = expectOk(parse({ query: 'format=mermaid&layout=LR&theme=dark' }));
        expect(options.format).toBe('mermaid');
        expect(options.layout).toBe('LR');
        expect(options.theme).toBe('dark');
    });

    it('takes a switch with no value or with true', () => {
        expect(expectOk(parse({ query: 'hide-catch' })).options.catchHandling).toBe('hide');
        expect(expectOk(parse({ query: 'hide-catch=true' })).options.catchHandling).toBe('hide');
        expect(expectError(parse({ query: 'hide-catch=false' }))).toContain('hide-catch is a switch');
        expect(expectError(parse({ query: 'hide-catch&show-catch' }))).toContain('cannot be combined');
    });

    it('reads collapse as all, a list, or off', () => {
        expect(expectOk(parse({ query: 'collapse' })).options.collapse).toBe(true);
        expect(expectOk(parse({ query: 'collapse=' })).options.collapse).toBe(true);
        expect(expectOk(parse({ query: 'collapse=A,B' })).options.collapse).toEqual(['A', 'B']);
        expect(expectOk(parse({ query: 'no-collapse' })).options.collapse).toBe(false);
    });

    it('accumulates repeated redact-fields', () => {
        const { options } = expectOk(parse({ query: 'format=html&redact-fields=A&redact-fields=B,C' }));
        expect(options.redactFields).toEqual(['A', 'B', 'C']);
    });

    it.each([
        'output=x',
        'config=x.json',
        'diff=old.json',
        'execution=h.json',
        'from-aws=arn',
        'watch',
        'check',
        'load-system-fonts',
        'no-load-system-fonts',
        'out-dir=x',
        'help',
        '--layout=LR',
    ])('refuses %s', (query) => {
        expect(expectError(parse({ query }))).toContain('Unknown query parameter');
    });

    it('refuses a theme path without reading it', () => {
        const message = expectError(parse({ query: 'theme=./nope.json' }));
        expect(message).toContain('theme must be light, dark or auto');
        expect(message).not.toContain('ENOENT');
    });

    it('reports an invalid value in the CLI wording', () => {
        expect(expectError(parse({ query: 'layout=XX' }))).toContain('Invalid --layout');
    });

    it('refuses a flag that only another format reads', () => {
        expect(expectError(parse({ query: 'scale=2' }))).toContain('only applies to --format png');
        expect(expectError(parse({ query: 'no-raw-state' }))).toContain('--format html');
        expect(expectOk(parse({ query: 'format=png&scale=2' })).options.scale).toBe(2);
    });

    it('lets the query override the config file', () => {
        const config: CliConfig = { layout: 'LR' };
        expect(expectOk(parse({ config, query: '' })).options.layout).toBe('LR');
        expect(expectOk(parse({ config, query: 'layout=BT' })).options.layout).toBe('BT');
    });
});

describe('parseServeQuery in lint mode', () => {
    it('accepts the flags that pick a definition', () => {
        const result = expectOk(parse({ mode: 'lint', query: 'resolve-cfn&resource=Machine' }));
        expect(result.resolveCfn).toBe(true);
        expect(result.resource).toBe('Machine');
    });

    it.each(['layout=LR', 'format=png&scale=2'])('refuses render flags: %s', (query) => {
        expect(expectError(parse({ mode: 'lint', query }))).toContain('Unknown query parameter');
    });
});
