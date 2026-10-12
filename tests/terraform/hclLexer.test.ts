import { describe, it, expect } from 'vitest';
import {
    HclSyntaxError,
    scanStandaloneTemplate,
    tokenizeHcl,
    type TemplatePart,
} from '../../src/terraform/hclLexer';

const textsOf = (source: string): string[] =>
    tokenizeHcl({ source })
        .filter((token) => token.kind !== 'eof')
        .map((token) => token.text);

const kindsOf = (source: string): string[] =>
    tokenizeHcl({ source })
        .filter((token) => token.kind !== 'eof')
        .map((token) => token.kind);

const partsOf = (source: string): TemplatePart[] => {
    const [token] = tokenizeHcl({ source });
    return token.parts ?? [];
};

describe('tokenizeHcl', () => {
    it('lexes identifiers, including hyphens and unicode', () => {
        expect(textsOf('my-name _x café')).toEqual(['my-name', '_x', 'café']);
        expect(kindsOf('my-name _x café')).toEqual(['identifier', 'identifier', 'identifier']);
    });

    it('lexes numbers and punctuation', () => {
        expect(textsOf('1 1.5 2e-3 => ... == != <= >= && || ? : . , ( ) [ ] { }')).toEqual([
            '1', '1.5', '2e-3', '=>', '...', '==', '!=', '<=', '>=', '&&', '||', '?', ':', '.', ',', '(', ')', '[', ']', '{', '}',
        ]);
        expect(kindsOf('1 1.5 2e-3 =>')).toEqual(['number', 'number', 'number', 'punct']);
    });

    it('skips all three comment styles but keeps the newline after a line comment', () => {
        const source = 'a # one\nb // two\nc /* three\nfour */ d';
        expect(kindsOf(source)).toEqual([
            'identifier', 'newline', 'identifier', 'newline', 'identifier', 'identifier',
        ]);
    });

    it('tracks line numbers across comments and heredocs', () => {
        const tokens = tokenizeHcl({ source: 'a\n/* x\ny */ b\nc = <<EOF\nbody\nEOF\nd' });
        const lineOf = (text: string): number | undefined =>
            tokens.find((token) => token.text === text)?.line;
        expect(lineOf('a')).toBe(1);
        expect(lineOf('b')).toBe(3);
        expect(lineOf('c')).toBe(4);
        expect(lineOf('d')).toBe(7);
    });

    it('decodes quoted-string escapes', () => {
        const parts = partsOf('"a\\nb\\"c\\\\d\\u00e9\\U0001F600"');
        expect(parts).toEqual([{ kind: 'literal', value: 'a\nb"c\\dé😀' }]);
    });

    it('treats $${ and %%{ as literals', () => {
        expect(partsOf('"$${x} %%{y}"')).toEqual([{ kind: 'literal', value: '${x} %{y}' }]);
    });

    it('keeps a brace inside a nested string within an interpolation', () => {
        const parts = partsOf('"${foo("}")}"');
        expect(parts).toHaveLength(1);
        expect(parts[0]).toMatchObject({ kind: 'interpolation', source: 'foo("}")' });
    });

    it('trims strip markers from interpolation source', () => {
        const parts = partsOf('"${~ x ~}"');
        expect(parts[0]).toMatchObject({ kind: 'interpolation', source: 'x' });
    });

    it('records interpolation tokens relative to the interpolation source', () => {
        const part = partsOf('"a ${ foo.bar }"').find((entry) => entry.kind === 'interpolation');
        if (part?.kind !== 'interpolation') throw new Error('expected interpolation');
        const [first] = part.tokens;
        expect(part.source.slice(first.start, first.end)).toBe('foo');
    });

    it('lexes a heredoc and an indented <<- heredoc', () => {
        const plain = tokenizeHcl({ source: 'x = <<EOF\n{"a": 1}\nEOF\n' });
        expect(plain.map((token) => token.kind)).toEqual([
            'identifier', 'punct', 'heredoc', 'newline', 'eof',
        ]);
        expect(plain[2].parts).toEqual([{ kind: 'literal', value: '{"a": 1}\n' }]);

        const indented = tokenizeHcl({ source: 'x = <<-EOT\n    {"a": 1}\n    EOT\n' });
        expect(indented[2].kind).toBe('heredoc');
        expect(indented[2].parts).toEqual([{ kind: 'literal', value: '    {"a": 1}\n' }]);
    });

    it('lexes a heredoc with CRLF line endings', () => {
        const tokens = tokenizeHcl({ source: 'x = <<EOF\r\n{"a": 1}\r\nEOF\r\n' });
        expect(tokens[2].kind).toBe('heredoc');
        expect(tokens.map((token) => token.kind)).toContain('newline');
    });

    it('throws on an unterminated heredoc, string or block comment, with the line', () => {
        expect(() => tokenizeHcl({ source: 'x = <<EOF\nnever ends\n' })).toThrow(/line 1/);
        expect(() => tokenizeHcl({ source: 'a\n"never ends' })).toThrow(/line 2/);
        expect(() => tokenizeHcl({ source: 'a\n/* never ends' })).toThrow(HclSyntaxError);
    });

    it('throws on a raw newline inside a quoted string', () => {
        expect(() => tokenizeHcl({ source: '"a\nb"' })).toThrow(/line 1/);
    });

    it('throws on a character that is not part of HCL', () => {
        expect(() => tokenizeHcl({ source: 'a\n@' })).toThrow(/line 2/);
    });

    it('lexes a %{ directive without throwing, string-aware', () => {
        const plain = partsOf('"%{ if x }a%{ endif }"');
        expect(plain.map((part) => part.kind)).toEqual(['directive', 'literal', 'directive']);
        const quoted = partsOf('"%{ for x in ["}"] }"');
        expect(quoted).toHaveLength(1);
        expect(quoted[0]).toMatchObject({ kind: 'directive' });
    });

    it('throws on an unterminated %{ in a heredoc and in a quoted string', () => {
        expect(() => tokenizeHcl({ source: 'x = <<EOF\n%{ if true\nEOF\n' })).toThrow(HclSyntaxError);
        expect(() => tokenizeHcl({ source: 'x = "%{ if true"' })).toThrow(/line 1/);
    });

    it('throws a depth error, not a RangeError, for deeply nested brackets', () => {
        expect(() => tokenizeHcl({ source: '['.repeat(300) })).toThrow(/nested more than 256/);
    });

    it('throws a depth error for deeply nested interpolations', () => {
        const source = '"${' + '"${'.repeat(300) + 'x' + '}"'.repeat(300) + '}"';
        expect(() => tokenizeHcl({ source })).toThrow(/nested more than 256/);
    });

    it('strips a leading BOM', () => {
        expect(textsOf(`${String.fromCharCode(0xfeff)}a = 1`)).toEqual(['a', '=', '1']);
    });
});

describe('scanStandaloneTemplate', () => {
    it('applies no backslash escapes and splits interpolations', () => {
        const parts = scanStandaloneTemplate({ text: '{"a": "\\n${var.x}"}' });
        expect(parts).toMatchObject([
            { kind: 'literal', value: '{"a": "\\n' },
            { kind: 'interpolation', source: 'var.x' },
            { kind: 'literal', value: '"}' },
        ]);
    });

    it('treats $${ as a literal and allows raw newlines', () => {
        expect(scanStandaloneTemplate({ text: 'a\n$${b}' })).toEqual([
            { kind: 'literal', value: 'a\n${b}' },
        ]);
    });

    it('throws on an unterminated interpolation', () => {
        expect(() => scanStandaloneTemplate({ text: 'a ${b' })).toThrow(HclSyntaxError);
    });
});
