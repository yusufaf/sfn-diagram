import { stripBom } from '../utils/bom';

/** Deepest nesting of brackets and templates the lexer accepts, so hostile input fails cleanly. */
export const HCL_MAX_DEPTH = 256;

/** A syntax error in HCL source. Messages always name the line. */
export class HclSyntaxError extends Error {}

/** A construct that is valid Terraform but cannot be evaluated into ASL without Terraform. */
export class HclUnsupportedError extends Error {}

export type HclTokenKind = 'eof' | 'heredoc' | 'identifier' | 'newline' | 'number' | 'punct' | 'string';

/** One piece of a quoted string, heredoc or standalone template. */
export type TemplatePart =
    | { kind: 'directive'; line: number; source: string }
    | { kind: 'interpolation'; line: number; source: string; tokens: HclToken[] }
    | { kind: 'literal'; value: string };

/**
 * A lexical token. `start`/`end` index the source the token was lexed from; for tokens inside
 * an interpolation that is the interpolation's own trimmed `source`.
 */
export interface HclToken {
    end: number;
    kind: HclTokenKind;
    line: number;
    /** Decoded template parts, for `string` and `heredoc` tokens. */
    parts?: TemplatePart[];
    start: number;
    text: string;
}

/** Parameters for `tokenizeHcl`. */
export interface TokenizeHclParams {
    /** HCL native-syntax source text. */
    source: string;
}

/** Parameters for `scanStandaloneTemplate`. */
export interface ScanStandaloneTemplateParams {
    /** Template text with no quoting and no backslash escapes, as found in `.tf.json` strings. */
    text: string;
}

const IDENTIFIER = /[\p{ID_Start}_][\p{ID_Continue}-]*/uy;
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEREDOC_OPEN = /<<-?([\p{ID_Start}_][\p{ID_Continue}-]*)[ \t]*\r?\n/uy;
const THREE_CHAR_PUNCT = new Set(['...']);
const TWO_CHAR_PUNCT = new Set(['==', '!=', '<=', '>=', '&&', '||', '=>']);
const ONE_CHAR_PUNCT = '+-*/%<>!?:=.,()[]{}';
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' };

interface LexTokensResult {
    /** Offset of the closing `}` (or the `~` before it) within the lexer source; nested mode only. */
    innerEnd: number;
    tokens: HclToken[];
}

/** Single-pass lexer. Every character is visited once; nested templates recurse with a depth cap. */
class HclLexer {
    private depth: number;
    private line: number;
    private pos = 0;

    constructor(
        private readonly source: string,
        startLine: number,
        startDepth: number,
    ) {
        this.line = startLine;
        this.depth = startDepth;
    }

    /** Lexes the whole source as top-level HCL. */
    lexDocument(): HclToken[] {
        return this.lexTokens(false).tokens;
    }

    /** Scans the whole source as a template with no quotes and no escapes (heredoc body). */
    scanRawTemplate(): TemplatePart[] {
        return this.scanTemplate(false);
    }

    private fail(message: string, line = this.line): never {
        throw new HclSyntaxError(`${message} (line ${line})`);
    }

    private enter(): void {
        this.depth += 1;
        if (this.depth > HCL_MAX_DEPTH) {
            this.fail(`HCL is nested more than ${HCL_MAX_DEPTH} levels deep`);
        }
    }

    private leave(): void {
        this.depth = Math.max(0, this.depth - 1);
    }

    private makeToken(kind: HclTokenKind, start: number, end: number, line: number): HclToken {
        return { end, kind, line, start, text: this.source.slice(start, end) };
    }

    /**
     * Lexes tokens. In nested mode (inside `${ }` or `%{ }`) newlines are insignificant and the
     * first unmatched `}` (optionally preceded by `~`) ends the run.
     */
    private lexTokens(nested: boolean): LexTokensResult {
        const { source } = this;
        const tokens: HclToken[] = [];
        let braceDepth = 0;
        const startLine = this.line;

        while (this.pos < source.length) {
            const char = source[this.pos];

            if (char === ' ' || char === '\t' || char === '\r') {
                this.pos += 1;
                continue;
            }
            if (char === '\n') {
                if (!nested) tokens.push(this.makeToken('newline', this.pos, this.pos + 1, this.line));
                this.line += 1;
                this.pos += 1;
                continue;
            }
            if (char === '#' || (char === '/' && source[this.pos + 1] === '/')) {
                const newline = source.indexOf('\n', this.pos);
                this.pos = newline === -1 ? source.length : newline;
                continue;
            }
            if (char === '/' && source[this.pos + 1] === '*') {
                const close = source.indexOf('*/', this.pos + 2);
                if (close === -1) this.fail('Unterminated block comment');
                for (let index = this.pos; index < close; index += 1) {
                    if (source[index] === '\n') this.line += 1;
                }
                this.pos = close + 2;
                continue;
            }

            if (nested && braceDepth === 0) {
                if (char === '}') {
                    const innerEnd = this.pos;
                    this.pos += 1;
                    tokens.push(this.makeToken('eof', innerEnd, innerEnd, this.line));
                    return { innerEnd, tokens };
                }
                if (char === '~' && source[this.pos + 1] === '}') {
                    const innerEnd = this.pos;
                    this.pos += 2;
                    tokens.push(this.makeToken('eof', innerEnd, innerEnd, this.line));
                    return { innerEnd, tokens };
                }
            }

            if (char === '"') {
                tokens.push(this.readQuotedString());
                continue;
            }
            if (char === '<' && source[this.pos + 1] === '<') {
                HEREDOC_OPEN.lastIndex = this.pos;
                const match = HEREDOC_OPEN.exec(source);
                if (match) {
                    tokens.push(this.readHeredoc(match));
                    continue;
                }
            }

            IDENTIFIER.lastIndex = this.pos;
            const identifier = IDENTIFIER.exec(source);
            if (identifier) {
                tokens.push(this.makeToken('identifier', this.pos, this.pos + identifier[0].length, this.line));
                this.pos += identifier[0].length;
                continue;
            }
            NUMBER.lastIndex = this.pos;
            const number = NUMBER.exec(source);
            if (number) {
                tokens.push(this.makeToken('number', this.pos, this.pos + number[0].length, this.line));
                this.pos += number[0].length;
                continue;
            }

            const punctLength = this.punctLengthAt();
            if (punctLength === 0) this.fail(`Unexpected character '${char}'`);
            if ('([{'.includes(char)) {
                this.enter();
                if (char === '{') braceDepth += 1;
            } else if (')]}'.includes(char)) {
                this.leave();
                if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
            }
            tokens.push(this.makeToken('punct', this.pos, this.pos + punctLength, this.line));
            this.pos += punctLength;
        }

        if (nested) this.fail('Unterminated template sequence', startLine);
        tokens.push(this.makeToken('eof', source.length, source.length, this.line));
        return { innerEnd: source.length, tokens };
    }

    private punctLengthAt(): number {
        const { source } = this;
        if (THREE_CHAR_PUNCT.has(source.slice(this.pos, this.pos + 3))) return 3;
        if (TWO_CHAR_PUNCT.has(source.slice(this.pos, this.pos + 2))) return 2;
        return ONE_CHAR_PUNCT.includes(source[this.pos]) ? 1 : 0;
    }

    private readQuotedString(): HclToken {
        const start = this.pos;
        const line = this.line;
        this.pos += 1;
        const parts = this.scanTemplate(true);
        const token = this.makeToken('string', start, this.pos, line);
        token.parts = parts;
        return token;
    }

    private readHeredoc(match: RegExpExecArray): HclToken {
        const { source } = this;
        const start = this.pos;
        const line = this.line;
        const marker = match[1];
        const bodyStart = this.pos + match[0].length;
        const bodyLine = this.line + 1;

        let lineStart = bodyStart;
        let bodyEnd = -1;
        let markerLineEnd = source.length;
        while (lineStart <= source.length) {
            const newline = source.indexOf('\n', lineStart);
            const lineEnd = newline === -1 ? source.length : newline;
            if (source.slice(lineStart, lineEnd).trim() === marker) {
                bodyEnd = lineStart;
                markerLineEnd = lineEnd;
                break;
            }
            if (newline === -1) break;
            lineStart = newline + 1;
        }
        if (bodyEnd === -1) this.fail(`Unterminated heredoc <<${marker}`, line);

        const bodyLexer = new HclLexer(source.slice(bodyStart, bodyEnd), bodyLine, this.depth + 1);
        const parts = bodyLexer.scanRawTemplate();
        for (let index = this.pos; index < markerLineEnd; index += 1) {
            if (source[index] === '\n') this.line += 1;
        }
        this.pos = markerLineEnd;

        const token = this.makeToken('heredoc', start, markerLineEnd, line);
        token.parts = parts;
        return token;
    }

    /**
     * Scans template text from the current position. Quoted: decodes escapes and stops after the
     * closing `"`. Unquoted: stops at the end of the source, with no escapes.
     */
    private scanTemplate(quoted: boolean): TemplatePart[] {
        const { source } = this;
        const startLine = this.line;
        const parts: TemplatePart[] = [];
        let literal = '';
        const flush = (): void => {
            if (literal !== '') parts.push({ kind: 'literal', value: literal });
            literal = '';
        };

        while (true) {
            if (this.pos >= source.length) {
                if (quoted) this.fail('Unterminated string', startLine);
                break;
            }
            const char = source[this.pos];

            if (quoted && char === '"') {
                this.pos += 1;
                break;
            }
            if (quoted && char === '\n') this.fail('Unterminated string: line breaks are not allowed in quoted strings');
            if (quoted && char === '\\') {
                literal += this.readEscape();
                continue;
            }
            if ((char === '$' || char === '%') && source[this.pos + 1] === char && source[this.pos + 2] === '{') {
                literal += `${char}{`;
                this.pos += 3;
                continue;
            }
            if ((char === '$' || char === '%') && source[this.pos + 1] === '{') {
                flush();
                parts.push(this.readSequence(char === '$'));
                continue;
            }

            if (char === '\n') this.line += 1;
            literal += char;
            this.pos += 1;
        }
        flush();
        return parts;
    }

    private readEscape(): string {
        const { source } = this;
        const next = source[this.pos + 1];
        if (next !== undefined && next in SIMPLE_ESCAPES) {
            this.pos += 2;
            return SIMPLE_ESCAPES[next];
        }
        if (next === 'u' || next === 'U') {
            const digits = next === 'u' ? 4 : 8;
            const hex = source.slice(this.pos + 2, this.pos + 2 + digits);
            const codePoint = Number.parseInt(hex, 16);
            if (hex.length !== digits || !/^[0-9a-fA-F]+$/.test(hex) || codePoint > 0x10ffff) {
                this.fail(`Invalid \\${next} escape sequence`);
            }
            this.pos += 2 + digits;
            return String.fromCodePoint(codePoint);
        }
        return this.fail(`Invalid escape sequence '\\${next ?? ''}'`);
    }

    /** Reads `${ ... }` (interpolation) or `%{ ... }` (directive) starting at the `$`/`%`. */
    private readSequence(isInterpolation: boolean): TemplatePart {
        const { source } = this;
        const line = this.line;
        this.pos += 2;
        if (source[this.pos] === '~') this.pos += 1;
        const innerStart = this.pos;

        this.enter();
        const { innerEnd, tokens } = this.lexTokens(true);
        this.leave();

        const raw = source.slice(innerStart, innerEnd);
        const leading = raw.length - raw.trimStart().length;
        const text = raw.trim();
        if (!isInterpolation) return { kind: 'directive', line, source: text };

        const base = innerStart + leading;
        for (const token of tokens) {
            token.start -= base;
            token.end -= base;
        }
        return { kind: 'interpolation', line, source: text, tokens };
    }
}

/**
 * Lexes HCL native-syntax source into tokens. Comments are dropped, newlines kept (they end
 * attributes), and quoted strings and heredocs are decoded into template parts. Runs in linear
 * time; nesting deeper than 256 levels throws instead of exhausting the stack.
 *
 * @param params - The source text.
 * @returns Tokens ending with a single `eof` token.
 * @throws {HclSyntaxError} On unterminated strings, heredocs, comments or `%{`/`${` sequences,
 * invalid escapes, characters outside HCL, or excessive nesting. The message names the line.
 *
 * @example
 * ```typescript
 * tokenizeHcl({ source: 'a = 1' }).map((token) => token.text); // ['a', '=', '1', '']
 * ```
 */
export function tokenizeHcl(params: TokenizeHclParams): HclToken[] {
    return new HclLexer(stripBom(params.source), 1, 0).lexDocument();
}

/**
 * Splits a standalone template (a `.tf.json` string value, where JSON has already decoded
 * escapes) into literal, interpolation and directive parts. Only `$${` and `%%{` are escapes.
 *
 * @param params - The template text.
 * @returns The template parts in order.
 * @throws {HclSyntaxError} On an unterminated `${` or `%{` sequence.
 *
 * @example
 * ```typescript
 * scanStandaloneTemplate({ text: 'a ${b}' }); // [literal 'a ', interpolation 'b']
 * ```
 */
export function scanStandaloneTemplate(params: ScanStandaloneTemplateParams): TemplatePart[] {
    return new HclLexer(params.text, 1, 0).scanRawTemplate();
}
