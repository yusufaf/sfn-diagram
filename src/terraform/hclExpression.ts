import {
    HCL_MAX_DEPTH,
    HclSyntaxError,
    HclUnsupportedError,
    type HclToken,
    type TemplatePart,
} from './hclLexer';

/** An attribute (`name = value`) or a block (`type "label" { ... }`) in an HCL body. */
export type HclBodyItem =
    | { kind: 'attribute'; line: number; name: string; tokens: HclToken[] }
    | { body: HclBodyItem[]; kind: 'block'; labels: string[]; line: number; type: string };

/** Parameters for `parseHclBody`. */
export interface ParseHclBodyParams {
    /** Tokens from `tokenizeHcl`. */
    tokens: HclToken[];
}

/** Parameters for `evaluateHclLiteral`. */
export interface EvaluateHclLiteralParams {
    /** The text `tokens` were lexed from; used to slice out unevaluated expressions. */
    source: string;
    /** Tokens of a single expression, such as the argument of `jsonencode(...)`. */
    tokens: HclToken[];
}

/** Result of `evaluateHclLiteral`. */
export interface EvaluateHclLiteralResult {
    /** The expression as plain data, with unevaluable parts replaced by `${...}` placeholder strings. */
    value: unknown;
    /** One entry per expression that only Terraform can evaluate (calls, operators, `for`). */
    warnings: string[];
}

/** Parameters for `renderTemplateAsJson`. */
export interface RenderTemplateAsJsonParams {
    /** Parts of a heredoc, quoted string or standalone template holding JSON text. */
    parts: TemplatePart[];
}

/** Result of `renderTemplateAsJson`. */
export interface RenderTemplateAsJsonResult {
    /** JSON text with every interpolation replaced by a `${...}` string placeholder. */
    text: string;
    /** One entry per interpolation that only Terraform can evaluate. */
    warnings: string[];
}

/** Parameters for `renderTemplateText`. */
export interface RenderTemplateTextParams {
    /** Template parts to flatten back into text. */
    parts: TemplatePart[];
}

/** Parameters for `isHclReference`. */
export interface IsHclReferenceParams {
    /** Tokens of one expression. */
    tokens: HclToken[];
}

const MAX_WARNING_EXPRESSION_LENGTH = 80;
const LITERAL_KEYWORDS = new Set(['false', 'null', 'true']);
const EXPRESSION_TERMINATORS = new Set([',', ')', ']', '}']);

function isPunct(token: HclToken | undefined, text: string): boolean {
    return token?.kind === 'punct' && token.text === text;
}

function significant(tokens: HclToken[]): HclToken[] {
    return tokens.filter((token) => token.kind !== 'eof' && token.kind !== 'newline');
}

function fail(message: string, line: number): never {
    throw new HclSyntaxError(`${message} (line ${line})`);
}

/**
 * Reports whether the tokens are a plain reference such as `aws_lambda_function.x.arn`,
 * `var.wait` or `local.map["key"]`: an identifier followed by `.name`, `.0` or `["literal"]`
 * steps. References have no computation, so a placeholder loses nothing; calls and operators do.
 *
 * @param params - Tokens of one expression.
 * @returns True when the expression is only a reference.
 *
 * @example
 * ```typescript
 * isHclReference({ tokens: tokenizeHcl({ source: 'var.wait' }) }); // true
 * ```
 */
export function isHclReference(params: IsHclReferenceParams): boolean {
    const tokens = significant(params.tokens);
    if (tokens.length === 0 || tokens[0].kind !== 'identifier' || LITERAL_KEYWORDS.has(tokens[0].text)) {
        return false;
    }
    let index = 1;
    while (index < tokens.length) {
        const next = tokens[index + 1];
        if (isPunct(tokens[index], '.') && (next?.kind === 'identifier' || next?.kind === 'number')) {
            index += 2;
        } else if (
            isPunct(tokens[index], '[') &&
            (next?.kind === 'number' || (next?.kind === 'string' && isLiteralOnly(next))) &&
            isPunct(tokens[index + 2], ']')
        ) {
            index += 3;
        } else {
            return false;
        }
    }
    return true;
}

function isLiteralOnly(token: HclToken): boolean {
    return (token.parts ?? []).every((part) => part.kind === 'literal');
}

function literalText(token: HclToken): string {
    return (token.parts ?? []).map((part) => (part.kind === 'literal' ? part.value : '')).join('');
}

interface BodyState {
    index: number;
    tokens: HclToken[];
}

function skipNewlines(state: BodyState): void {
    while (state.tokens[state.index]?.kind === 'newline') state.index += 1;
}

function readAttributeValue(state: BodyState): HclToken[] {
    const value: HclToken[] = [];
    let depth = 0;
    while (state.index < state.tokens.length) {
        const token = state.tokens[state.index];
        if (token.kind === 'eof') break;
        if (depth === 0 && (token.kind === 'newline' || isPunct(token, '}'))) break;
        if (token.kind === 'punct' && '([{'.includes(token.text)) depth += 1;
        if (token.kind === 'punct' && ')]}'.includes(token.text)) depth = Math.max(0, depth - 1);
        value.push(token);
        state.index += 1;
    }
    return value;
}

function readLabels(state: BodyState): string[] {
    const labels: string[] = [];
    while (true) {
        const token = state.tokens[state.index];
        if (token?.kind === 'identifier') {
            labels.push(token.text);
        } else if (token?.kind === 'string') {
            if (!isLiteralOnly(token)) fail('Block labels cannot contain interpolations', token.line);
            labels.push(literalText(token));
        } else {
            return labels;
        }
        state.index += 1;
    }
}

function parseBodyItems(state: BodyState, inBlock: boolean): HclBodyItem[] {
    const items: HclBodyItem[] = [];
    while (true) {
        skipNewlines(state);
        const token = state.tokens[state.index];
        if (token === undefined || token.kind === 'eof') {
            if (inBlock) fail('Unclosed block: expected }', token?.line ?? 1);
            return items;
        }
        if (isPunct(token, '}')) {
            if (!inBlock) fail("Unexpected '}'", token.line);
            state.index += 1;
            return items;
        }
        if (token.kind !== 'identifier') fail(`Unexpected '${token.text}'`, token.line);

        if (isPunct(state.tokens[state.index + 1], '=')) {
            state.index += 2;
            items.push({ kind: 'attribute', line: token.line, name: token.text, tokens: readAttributeValue(state) });
            continue;
        }

        state.index += 1;
        const labels = readLabels(state);
        if (!isPunct(state.tokens[state.index], '{')) {
            fail(`Expected '{' after block header '${token.text}'`, token.line);
        }
        state.index += 1;
        items.push({ body: parseBodyItems(state, true), kind: 'block', labels, line: token.line, type: token.text });
    }
}

/**
 * Groups top-level tokens into attributes and nested blocks. Attribute values are returned as
 * raw tokens (up to the newline or closing brace that ends them) for `evaluateHclLiteral`; this
 * does not interpret expressions.
 *
 * @param params - Tokens from `tokenizeHcl`.
 * @returns The body's items in source order.
 * @throws {HclSyntaxError} On an unclosed block, a stray `}` or a token that starts neither an
 * attribute nor a block. The message names the line.
 *
 * @example
 * ```typescript
 * parseHclBody({ tokens: tokenizeHcl({ source: 'resource "a" "b" { c = 1 }' }) });
 * ```
 */
export function parseHclBody(params: ParseHclBodyParams): HclBodyItem[] {
    return parseBodyItems({ index: 0, tokens: params.tokens }, false);
}

function truncate(text: string): string {
    return text.length > MAX_WARNING_EXPRESSION_LENGTH
        ? `${text.slice(0, MAX_WARNING_EXPRESSION_LENGTH - 3)}...`
        : text;
}

function warningFor(expression: string, line: number): string {
    return `Expression ${truncate(expression)} at line ${line} cannot be evaluated outside Terraform; left as a placeholder`;
}

function directiveError(source: string, line: number): HclUnsupportedError {
    return new HclUnsupportedError(
        `Template directive %{${truncate(source)}} at line ${line} is not supported; ` +
            `render the ASL it produces directly instead.`,
    );
}

/** Evaluates literal HCL expressions (objects, tuples, scalars) and placeholders for the rest. */
class LiteralEvaluator {
    readonly warnings: string[] = [];
    private index = 0;

    constructor(
        private readonly source: string,
        private readonly tokens: HclToken[],
    ) {}

    evaluate(): unknown {
        this.skipNewlines();
        if (this.atEnd()) fail('Expected a value', this.tokens[0]?.line ?? 1);
        const value = this.parseValue(0);
        this.skipNewlines();
        if (!this.atEnd()) fail(`Unexpected '${this.peek().text}'`, this.peek().line);
        return value;
    }

    private peek(offset = 0): HclToken {
        return this.tokens[this.index + offset] ?? { end: 0, kind: 'eof', line: this.tokens[this.tokens.length - 1]?.line ?? 1, start: 0, text: '' };
    }

    private atEnd(): boolean {
        return this.peek().kind === 'eof';
    }

    private skipNewlines(): void {
        while (this.peek().kind === 'newline') this.index += 1;
    }

    private atTerminator(): boolean {
        const token = this.peek();
        return (
            token.kind === 'eof' ||
            token.kind === 'newline' ||
            (token.kind === 'punct' && EXPRESSION_TERMINATORS.has(token.text))
        );
    }

    private parseValue(depth: number): unknown {
        if (depth > HCL_MAX_DEPTH) fail(`Expression is nested more than ${HCL_MAX_DEPTH} levels deep`, this.peek().line);
        const start = this.index;
        const warningMark = this.warnings.length;
        const literal = this.tryLiteral(depth);
        if (literal && this.atTerminator()) return literal.value;
        this.index = start;
        this.warnings.length = warningMark;
        return this.consumeExpression();
    }

    private tryLiteral(depth: number): { value: unknown } | undefined {
        const token = this.peek();
        if (token.kind === 'string' || token.kind === 'heredoc') {
            this.index += 1;
            return { value: this.renderString(token) };
        }
        if (token.kind === 'number') {
            this.index += 1;
            return { value: Number(token.text) };
        }
        if (isPunct(token, '-') && this.peek(1).kind === 'number') {
            this.index += 2;
            return { value: -Number(this.tokens[this.index - 1].text) };
        }
        if (token.kind === 'identifier' && LITERAL_KEYWORDS.has(token.text)) {
            this.index += 1;
            return { value: token.text === 'null' ? null : token.text === 'true' };
        }
        if ((isPunct(token, '[') || isPunct(token, '{')) && !this.startsForExpression()) {
            return { value: isPunct(token, '[') ? this.parseTuple(depth) : this.parseObject(depth) };
        }
        return undefined;
    }

    private startsForExpression(): boolean {
        let offset = 1;
        while (this.peek(offset).kind === 'newline') offset += 1;
        return (
            this.peek(offset).kind === 'identifier' &&
            this.peek(offset).text === 'for' &&
            this.peek(offset + 1).kind === 'identifier'
        );
    }

    private renderString(token: HclToken): string {
        let text = '';
        for (const part of token.parts ?? []) {
            if (part.kind === 'literal') {
                text += part.value;
            } else if (part.kind === 'interpolation') {
                text += `\${${part.source}}`;
                if (!isHclReference({ tokens: part.tokens })) this.warnings.push(warningFor(part.source, part.line));
            } else {
                throw directiveError(part.source, part.line);
            }
        }
        return text;
    }

    private parseTuple(depth: number): unknown[] {
        const open = this.peek();
        this.index += 1;
        const items: unknown[] = [];
        while (true) {
            this.skipNewlines();
            if (this.atEnd()) fail('Unclosed [', open.line);
            if (isPunct(this.peek(), ']')) {
                this.index += 1;
                return items;
            }
            if (isPunct(this.peek(), ',')) {
                this.index += 1;
                continue;
            }
            items.push(this.parseValue(depth + 1));
            if (!this.atEnd() && (isPunct(this.peek(), '}') || isPunct(this.peek(), ')'))) {
                fail(`Unexpected '${this.peek().text}' in a tuple`, this.peek().line);
            }
        }
    }

    private parseObject(depth: number): Record<string, unknown> {
        const open = this.peek();
        this.index += 1;
        const entries: [string, unknown][] = [];
        while (true) {
            this.skipNewlines();
            while (isPunct(this.peek(), ',')) {
                this.index += 1;
                this.skipNewlines();
            }
            if (this.atEnd()) fail('Unclosed {', open.line);
            if (isPunct(this.peek(), '}')) {
                this.index += 1;
                return Object.fromEntries(entries);
            }
            const key = this.parseKey();
            const separator = this.peek();
            if (!isPunct(separator, '=') && !isPunct(separator, ':')) {
                fail("Expected '=' or ':' after an object key", separator.line);
            }
            this.index += 1;
            entries.push([key, this.parseValue(depth + 1)]);
            if (!this.atEnd() && (isPunct(this.peek(), ']') || isPunct(this.peek(), ')'))) {
                fail(`Unexpected '${this.peek().text}' in an object`, this.peek().line);
            }
        }
    }

    private parseKey(): string {
        const start = this.index;
        let depth = 0;
        while (!this.atEnd()) {
            const token = this.peek();
            if (token.kind === 'newline') fail('Expected an object key followed by = or :', token.line);
            if (depth === 0 && (isPunct(token, '=') || isPunct(token, ':'))) break;
            if (depth === 0 && isPunct(token, '}')) fail('Expected = or : after an object key', token.line);
            if (token.kind === 'punct' && '([{'.includes(token.text)) depth += 1;
            if (token.kind === 'punct' && ')]}'.includes(token.text)) depth = Math.max(0, depth - 1);
            this.index += 1;
        }
        const keyTokens = this.tokens.slice(start, this.index);
        if (keyTokens.length === 1) {
            const [only] = keyTokens;
            if (only.kind === 'identifier' || only.kind === 'number') return only.text;
            if (only.kind === 'string') return this.renderString(only);
        }
        return this.placeholderFor(keyTokens);
    }

    private consumeExpression(): string {
        const start = this.index;
        let depth = 0;
        while (!this.atEnd()) {
            const token = this.peek();
            if (depth === 0 && (token.kind === 'newline' || (token.kind === 'punct' && EXPRESSION_TERMINATORS.has(token.text)))) {
                break;
            }
            if (token.kind === 'punct' && '([{'.includes(token.text)) depth += 1;
            if (token.kind === 'punct' && ')]}'.includes(token.text)) depth = Math.max(0, depth - 1);
            this.index += 1;
        }
        if (this.index === start) fail(`Expected a value, found '${this.peek().text}'`, this.peek().line);
        return this.placeholderFor(this.tokens.slice(start, this.index));
    }

    private placeholderFor(expressionTokens: HclToken[]): string {
        const first = expressionTokens[0];
        const last = expressionTokens[expressionTokens.length - 1];
        const expression = this.source.slice(first.start, last.end);
        if (!isHclReference({ tokens: expressionTokens })) this.warnings.push(warningFor(expression, first.line));
        return `\${${expression}}`;
    }
}

/**
 * Evaluates one HCL expression made of object, tuple, string, number, bool and null literals,
 * such as the argument of `jsonencode(...)`. Anything Terraform would have to compute is kept as
 * a `${expression}` placeholder string: plain references (`aws_lambda_function.x.arn`) silently,
 * calls, operators, conditionals and `for` expressions with a warning. Object keys keep source
 * order. Linear in the number of tokens.
 *
 * @param params - The expression's tokens and the source they were lexed from.
 * @returns The value and any warnings.
 * @throws {HclSyntaxError} On unclosed brackets, a missing key separator or excess nesting.
 * @throws {HclUnsupportedError} On a `%{ }` template directive inside a string.
 *
 * @example
 * ```typescript
 * const source = '{ A = aws_lambda_function.x.arn }';
 * evaluateHclLiteral({ source, tokens: tokenizeHcl({ source }) }).value;
 * // { A: '${aws_lambda_function.x.arn}' }
 * ```
 */
export function evaluateHclLiteral(params: EvaluateHclLiteralParams): EvaluateHclLiteralResult {
    const evaluator = new LiteralEvaluator(params.source, params.tokens);
    const value = evaluator.evaluate();
    return { value, warnings: evaluator.warnings };
}

/**
 * Flattens template parts back into text: literals as-is, interpolations as `${source}` and
 * directives as `%{source}`. No JSON awareness, no warnings.
 *
 * @param params - Template parts.
 * @returns The text.
 *
 * @example
 * ```typescript
 * renderTemplateText({ parts: scanStandaloneTemplate({ text: '${path.module}/a.json' }) });
 * // '${path.module}/a.json'
 * ```
 */
export function renderTemplateText(params: RenderTemplateTextParams): string {
    return params.parts
        .map((part) => {
            if (part.kind === 'literal') return part.value;
            return part.kind === 'interpolation' ? `\${${part.source}}` : `%{${part.source}}`;
        })
        .join('');
}

/**
 * Turns a template that holds JSON text (a heredoc or string `definition`) into valid JSON by
 * replacing each `${...}` interpolation with a string placeholder. Inside a JSON string the
 * placeholder is escaped; elsewhere (`"Seconds": ${var.wait}`) it becomes a quoted string.
 *
 * @param params - Template parts.
 * @returns The JSON text and any warnings.
 * @throws {HclUnsupportedError} On a `%{ }` template directive.
 *
 * @example
 * ```typescript
 * renderTemplateAsJson({ parts: scanStandaloneTemplate({ text: '{"n": ${var.n}}' }) }).text;
 * // '{"n": "${var.n}"}'
 * ```
 */
export function renderTemplateAsJson(params: RenderTemplateAsJsonParams): RenderTemplateAsJsonResult {
    const warnings: string[] = [];
    const chunks: string[] = [];
    let inString = false;
    let escaped = false;

    for (const part of params.parts) {
        if (part.kind === 'literal') {
            for (const char of part.value) {
                if (inString) {
                    if (escaped) escaped = false;
                    else if (char === '\\') escaped = true;
                    else if (char === '"') inString = false;
                } else if (char === '"') {
                    inString = true;
                }
            }
            chunks.push(part.value);
        } else if (part.kind === 'interpolation') {
            const placeholder = JSON.stringify(`\${${part.source}}`);
            chunks.push(inString ? placeholder.slice(1, -1) : placeholder);
            if (!isHclReference({ tokens: part.tokens })) warnings.push(warningFor(part.source, part.line));
        } else {
            throw directiveError(part.source, part.line);
        }
    }
    return { text: chunks.join(''), warnings };
}
