import { describe, it, expect } from 'vitest';
import {
    evaluateHclLiteral,
    isHclReference,
    parseHclBody,
    renderTemplateAsJson,
    renderTemplateText,
} from '../../src/terraform/hclExpression';
import { scanStandaloneTemplate, tokenizeHcl } from '../../src/terraform/hclLexer';

const evaluate = (source: string): { value: unknown; warnings: string[] } => {
    const tokens = tokenizeHcl({ source }).filter((token) => token.kind !== 'eof');
    return evaluateHclLiteral({ source, tokens });
};

const referenceCheck = (source: string): boolean =>
    isHclReference({ tokens: tokenizeHcl({ source }).filter((token) => token.kind !== 'eof') });

describe('parseHclBody', () => {
    it('separates attributes from blocks and keeps labels', () => {
        const body = parseHclBody({
            tokens: tokenizeHcl({
                source: 'name = "x"\nresource "aws_thing" "this" {\n  a = 1\n  nested {\n    b = [1,\n 2]\n  }\n}\n',
            }),
        });
        expect(body).toHaveLength(2);
        expect(body[0]).toMatchObject({ kind: 'attribute', name: 'name' });
        const block = body[1];
        if (block.kind !== 'block') throw new Error('expected block');
        expect(block).toMatchObject({ labels: ['aws_thing', 'this'], type: 'resource' });
        expect(block.body.map((item) => (item.kind === 'attribute' ? item.name : item.type))).toEqual([
            'a',
            'nested',
        ]);
        const nested = block.body[1];
        if (nested.kind !== 'block') throw new Error('expected nested block');
        const attribute = nested.body[0];
        if (attribute.kind !== 'attribute') throw new Error('expected attribute');
        expect(attribute.tokens.map((token) => token.text)).toEqual(['[', '1', ',', '\n', '2', ']']);
    });

    it('parses one-line blocks and unquoted labels', () => {
        const body = parseHclBody({ tokens: tokenizeHcl({ source: 'terraform { required_version = ">= 1" }\nlocals { a = 1 }' }) });
        expect(body.map((item) => item.kind)).toEqual(['block', 'block']);
    });

    it('throws on an unclosed block and on a stray closing brace', () => {
        expect(() => parseHclBody({ tokens: tokenizeHcl({ source: 'a {\n b = 1\n' }) })).toThrow(/line/);
        expect(() => parseHclBody({ tokens: tokenizeHcl({ source: '}\n' }) })).toThrow(/line 1/);
    });
});

describe('isHclReference', () => {
    it.each(['aws_lambda_function.x.arn', 'var.wait', 'local.m["k"]', 'aws_x.y[0].z', 'x'])(
        'accepts %s',
        (source) => {
            expect(referenceCheck(source)).toBe(true);
        },
    );

    it.each(['format("a", b)', 'a + b', 'a ? b : c', '1', '"s"', 'a.b(c)', ''])('rejects %s', (source) => {
        expect(referenceCheck(source)).toBe(false);
    });
});

describe('evaluateHclLiteral', () => {
    it('evaluates objects, tuples and every scalar form', () => {
        const { value, warnings } = evaluate(
            '{\n  StartAt = "A"\n  "Wait 5" : [1, -2, 3.5, 2e3,\n true, false, null]\n  States = { A = { Type = "Pass", End = true } },\n}',
        );
        expect(value).toEqual({
            StartAt: 'A',
            'Wait 5': [1, -2, 3.5, 2000, true, false, null],
            States: { A: { Type: 'Pass', End: true } },
        });
        expect(warnings).toEqual([]);
    });

    it('preserves key order and keeps __proto__ as an own property', () => {
        const { value } = evaluate('{ b = 1, a = 2, "__proto__" = 3 }') as { value: Record<string, unknown> };
        expect(Object.keys(value)).toEqual(['b', 'a', '__proto__']);
        expect(Object.hasOwn(value, '__proto__')).toBe(true);
    });

    it('turns a reference into a placeholder without a warning', () => {
        const { value, warnings } = evaluate('{ Resource = aws_lambda_function.charge.arn }');
        expect(value).toEqual({ Resource: '${aws_lambda_function.charge.arn}' });
        expect(warnings).toEqual([]);
    });

    it('turns a reference interpolation inside a string into a placeholder without a warning', () => {
        const { value, warnings } = evaluate('{ Resource = "arn:${var.region}:fn" }');
        expect(value).toEqual({ Resource: 'arn:${var.region}:fn' });
        expect(warnings).toEqual([]);
    });

    it.each([
        ['a call', '{ A = format("%s-fn", var.env) }', 'format("%s-fn", var.env)'],
        ['a conditional', '{ A = var.on ? 1 : 2 }', 'var.on ? 1 : 2'],
        ['a for expression', '{ A = [for x in var.xs : x] }', '[for x in var.xs : x]'],
        ['arithmetic', '{ A = 1 + 2 }', '1 + 2'],
        ['an interpolated call', '{ A = "x-${upper(var.y)}" }', 'upper(var.y)'],
    ])('placeholders %s and warns once', (_label, source, expression) => {
        const { value, warnings } = evaluate(source);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(expression);
        expect(warnings[0]).toContain('line 1');
        const text = JSON.stringify(value);
        expect(text).toContain('${');
    });

    it('placeholders a computed key and warns', () => {
        const { value, warnings } = evaluate('{ (var.k) = 1 }');
        expect(value).toEqual({ '${(var.k)}': 1 });
        expect(warnings).toHaveLength(1);
    });

    it('keeps a literal followed by more tokens as one placeholder', () => {
        const { value, warnings } = evaluate('[ {a = 1}[0], 2 ]');
        expect(value).toEqual(['${{a = 1}[0]}', 2]);
        expect(warnings).toHaveLength(1);
    });

    it('truncates long expressions in warnings but not in placeholders', () => {
        const long = `format("${'x'.repeat(200)}")`;
        const { value, warnings } = evaluate(`[${long}]`);
        expect(value).toEqual(['${' + long + '}']);
        expect(warnings[0].length).toBeLessThan(250);
        expect(warnings[0]).toContain('...');
    });

    it('throws on a template directive inside a string', () => {
        expect(() => evaluate('{ A = "%{ if x }y%{ endif }" }')).toThrow(/directive/);
    });

    it('reports the line of a warning', () => {
        const { warnings } = evaluate('{\n  A = 1\n  B = f(x)\n}');
        expect(warnings[0]).toContain('line 3');
    });

    it('throws when the value never closes', () => {
        expect(() => evaluate('{ A = 1')).toThrow(/line 1/);
    });
});

describe('renderTemplateAsJson', () => {
    it('escapes an interpolation inside a JSON string', () => {
        const { text } = renderTemplateAsJson({
            parts: scanStandaloneTemplate({ text: '{"Resource": "${aws_lambda_function.x.arn}"}' }),
        });
        expect(JSON.parse(text)).toEqual({ Resource: '${aws_lambda_function.x.arn}' });
    });

    it('escapes quotes produced by a placeholder inside a string', () => {
        const { text, warnings } = renderTemplateAsJson({
            parts: scanStandaloneTemplate({ text: '{"a": "${jsonencode("x")}"}' }),
        });
        expect(JSON.parse(text)).toEqual({ a: '${jsonencode("x")}' });
        expect(warnings).toHaveLength(1);
    });

    it('quotes an interpolation outside a string so the JSON stays valid', () => {
        const { text } = renderTemplateAsJson({
            parts: scanStandaloneTemplate({ text: '{"Seconds": ${var.wait}}' }),
        });
        expect(JSON.parse(text)).toEqual({ Seconds: '${var.wait}' });
    });

    it('does not leave string state on an escaped quote', () => {
        const { text } = renderTemplateAsJson({
            parts: scanStandaloneTemplate({ text: '{"a": "x\\"y ${var.z}", "b": ${var.w}}' }),
        });
        expect(JSON.parse(text)).toEqual({ a: 'x"y ${var.z}', b: '${var.w}' });
    });

    it('throws on a template directive', () => {
        expect(() =>
            renderTemplateAsJson({ parts: scanStandaloneTemplate({ text: '%{ if x }1%{ endif }' }) }),
        ).toThrow(/directive/);
    });
});

describe('renderTemplateText', () => {
    it('keeps literals and writes interpolations back as ${source}', () => {
        expect(renderTemplateText({ parts: scanStandaloneTemplate({ text: '${path.module}/a.json' }) })).toBe(
            '${path.module}/a.json',
        );
    });
});
