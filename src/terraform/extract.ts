import type { AslDefinition, ExtractAslFromTerraformParams, ExtractAslResult } from '../types';
import { parseAslSource } from '../AslParser';
import {
    evaluateHclLiteral,
    isHclReference,
    parseHclBody,
    renderTemplateAsJson,
    renderTemplateText,
    type HclBodyItem,
} from './hclExpression';
import {
    HclSyntaxError,
    HclUnsupportedError,
    scanStandaloneTemplate,
    tokenizeHcl,
    type HclToken,
    type TemplatePart,
} from './hclLexer';

/** The Terraform resource type that declares a Step Functions state machine. */
export const TERRAFORM_STATE_MACHINE_TYPE = 'aws_sfn_state_machine';

/** File extensions the CLI routes to the Terraform extractor, longest first. */
export const TERRAFORM_EXTENSIONS: readonly string[] = ['.tf.json', '.tf'];

/** Parameters for `isTerraformConfig`. */
export interface IsTerraformConfigParams {
    /** Candidate file contents. */
    source: string;
}

type DefinitionValue =
    | { kind: 'json'; value: unknown }
    | { kind: 'tokens'; source: string; tokens: HclToken[] };

interface Candidate {
    definition: DefinitionValue | undefined;
    name: string;
}

interface ResolvedDefinition {
    aslDefinition: AslDefinition;
    warnings: string[];
}

interface ResolveDefinitionExpressionParams {
    name: string;
    source: string;
    tokens: HclToken[];
}

interface ResolveDefinitionTemplateParams {
    name: string;
    parts: TemplatePart[];
}

const COMMENT_KEY = '//';
const HCL_RESOURCE_DECLARATION = new RegExp(`^[ \\t]*resource[ \\t]+"${TERRAFORM_STATE_MACHINE_TYPE}"`, 'm');
const MAX_QUOTED_SOURCE_LENGTH = 80;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Terraform JSON allows a block to be an object or an array of objects; flatten to the objects. */
function asObjects(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.filter(isPlainObject);
    return isPlainObject(value) ? [value] : [];
}

/**
 * Reports whether the text is a Terraform configuration that declares an
 * `aws_sfn_state_machine` resource, in HCL (`.tf`) or JSON (`.tf.json`) syntax. Used by the CLI
 * to route stdin and extensionless input.
 *
 * @param params - The candidate file contents.
 * @returns True when a state machine resource is declared.
 *
 * @example
 * ```typescript
 * isTerraformConfig({ source: 'resource "aws_sfn_state_machine" "m" {}' }); // true
 * ```
 */
export function isTerraformConfig(params: IsTerraformConfigParams): boolean {
    const { source } = params;
    if (!source.includes(TERRAFORM_STATE_MACHINE_TYPE)) return false;
    if (!source.trimStart().startsWith('{')) return HCL_RESOURCE_DECLARATION.test(source);
    try {
        const root: unknown = JSON.parse(source);
        return asObjects(isPlainObject(root) ? root.resource : undefined).some((body) =>
            asObjects(body[TERRAFORM_STATE_MACHINE_TYPE]).length > 0,
        );
    } catch {
        return false;
    }
}

const BYTE_ORDER_MARK = 0xfeff;

/** Drops a leading byte order mark so token offsets index the same text the extractor slices. */
function stripBom(text: string): string {
    return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}

function quoteLabel(name: string): string {
    return `${TERRAFORM_STATE_MACHINE_TYPE}.${name}`;
}

function hclCandidates(source: string): Candidate[] {
    const body = parseHclBody({ tokens: tokenizeHcl({ source }) });
    return body
        .filter(
            (item): item is Extract<HclBodyItem, { kind: 'block' }> =>
                item.kind === 'block' &&
                item.type === 'resource' &&
                item.labels.length === 2 &&
                item.labels[0] === TERRAFORM_STATE_MACHINE_TYPE,
        )
        .map((block) => {
            const attribute = block.body.find((item) => item.kind === 'attribute' && item.name === 'definition');
            return {
                definition:
                    attribute?.kind === 'attribute'
                        ? { kind: 'tokens', source, tokens: attribute.tokens }
                        : undefined,
                name: block.labels[1],
            };
        });
}

function jsonCandidates(root: Record<string, unknown>): Candidate[] {
    const candidates: Candidate[] = [];
    for (const resources of asObjects(root.resource)) {
        for (const byName of asObjects(resources[TERRAFORM_STATE_MACHINE_TYPE])) {
            for (const [name, bodies] of Object.entries(byName)) {
                if (name === COMMENT_KEY) continue;
                const [body] = asObjects(bodies);
                if (body === undefined) continue;
                candidates.push({
                    definition: 'definition' in body ? { kind: 'json', value: body.definition } : undefined,
                    name,
                });
            }
        }
    }
    return candidates;
}

function trimNewlines(tokens: HclToken[]): HclToken[] {
    let start = 0;
    let end = tokens.length;
    while (start < end && (tokens[start].kind === 'newline' || tokens[start].kind === 'eof')) start += 1;
    while (end > start && (tokens[end - 1].kind === 'newline' || tokens[end - 1].kind === 'eof')) end -= 1;
    return tokens.slice(start, end);
}

function closingParenIndex(tokens: HclToken[], openIndex: number): number {
    let depth = 0;
    for (let index = openIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.kind !== 'punct') continue;
        if ('([{'.includes(token.text)) depth += 1;
        if (')]}'.includes(token.text)) depth -= 1;
        if (depth === 0) return index;
    }
    return -1;
}

function assertPlainObject(params: { name: string; value: unknown }): AslDefinition {
    if (!isPlainObject(params.value)) {
        throw new Error(`${quoteLabel(params.name)}: definition does not render to a JSON object`);
    }
    return params.value as unknown as AslDefinition;
}

/**
 * HCL's "template interpolation unwrapping": a template that is exactly one `${...}` (ignoring
 * whitespace, such as a heredoc's trailing newline) evaluates to the expression itself, not to
 * text. Any other template is JSON text with placeholders.
 */
function resolveDefinitionTemplate(params: ResolveDefinitionTemplateParams): ResolvedDefinition {
    const { name, parts } = params;
    const interpolations = parts.filter((part) => part.kind === 'interpolation');
    const onlyWhitespaceAround = parts.every(
        (part) => part.kind === 'interpolation' || (part.kind === 'literal' && part.value.trim() === ''),
    );
    if (interpolations.length === 1 && onlyWhitespaceAround) {
        const [only] = interpolations;
        return resolveDefinitionExpression({ name, source: only.source, tokens: only.tokens });
    }
    const { text, warnings } = renderTemplateAsJson({ parts });
    const aslDefinition = assertPlainObject({ name, value: parseAslSource({ source: text }) });
    return { aslDefinition, warnings };
}

function resolveDefinitionExpression(params: ResolveDefinitionExpressionParams): ResolvedDefinition {
    const { name, source } = params;
    const tokens = trimNewlines(params.tokens);
    const label = quoteLabel(name);
    const [first, second] = tokens;
    const last = tokens[tokens.length - 1];
    const expression = first === undefined ? '' : source.slice(first.start, last.end);

    if (tokens.length === 1 && (first.kind === 'string' || first.kind === 'heredoc')) {
        return resolveDefinitionTemplate({ name, parts: first.parts ?? [] });
    }

    const isCall = first?.kind === 'identifier' && second?.kind === 'punct' && second.text === '(' &&
        closingParenIndex(tokens, 1) === tokens.length - 1;

    if (isCall && first.text === 'jsonencode') {
        const { value, warnings } = evaluateHclLiteral({ source, tokens: tokens.slice(2, -1) });
        if (!isPlainObject(value)) {
            throw new Error(
                `${label}: jsonencode(...) at line ${first.line} does not wrap an object literal, ` +
                    `so the definition cannot be read. Pass jsonencode({...}) with the states written out, or render the ASL file directly.`,
            );
        }
        return { aslDefinition: value as unknown as AslDefinition, warnings };
    }

    if (isCall && (first.text === 'templatefile' || first.text === 'file')) {
        const argument = tokens[2];
        const next = tokens[3];
        const path =
            (argument?.kind === 'string' || argument?.kind === 'heredoc') &&
            next?.kind === 'punct' &&
            (next.text === ',' || next.text === ')')
                ? ` ('${renderTemplateText({ parts: argument.parts ?? [] })}')`
                : '';
        throw new Error(
            `${label}: ${first.text}()${path} reads the definition from a file when Terraform runs, ` +
                `which cannot be evaluated here. Render that ASL file directly with sfn-diagram instead ` +
                `(\${...} placeholders inside its JSON strings are fine; elsewhere they are not valid JSON).`,
        );
    }

    if (isHclReference({ tokens })) {
        throw new Error(
            `${label}: definition is the reference ${expression}, which only Terraform can evaluate. ` +
                `Inline it as a heredoc or jsonencode({...}), or render the ASL file it comes from.`,
        );
    }

    const shown =
        expression.length > MAX_QUOTED_SOURCE_LENGTH
            ? `${expression.slice(0, MAX_QUOTED_SOURCE_LENGTH - 3)}...`
            : expression;
    throw new Error(
        `${label}: definition ${shown ? `'${shown}' ` : ''}is not a supported form. ` +
            `Use a heredoc, a quoted string of JSON, or jsonencode({...}).`,
    );
}

function resolveCandidate(candidate: Candidate): ResolvedDefinition {
    const { definition, name } = candidate;
    if (definition === undefined) {
        throw new Error(`${quoteLabel(name)} has no definition argument.`);
    }
    try {
        if (definition.kind === 'tokens') {
            return resolveDefinitionExpression({ name, source: definition.source, tokens: definition.tokens });
        }
        if (typeof definition.value !== 'string') {
            throw new Error(`${quoteLabel(name)}: definition must be a string in .tf.json.`);
        }
        return resolveDefinitionTemplate({ name, parts: scanStandaloneTemplate({ text: definition.value }) });
    } catch (error) {
        if (error instanceof HclUnsupportedError) {
            throw new Error(`${quoteLabel(name)}: ${error.message}`, { cause: error });
        }
        throw error;
    }
}

function parseJsonConfig(config: string | Record<string, unknown>): Record<string, unknown> {
    if (typeof config !== 'string') return config;
    try {
        const parsed: unknown = JSON.parse(config);
        if (isPlainObject(parsed)) return parsed;
    } catch (error) {
        throw new Error(
            `Terraform configuration is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
    throw new Error('Terraform configuration is not valid JSON: expected an object at the top level.');
}

/**
 * Recovers a renderable ASL definition from a Terraform configuration.
 *
 * Finds the `aws_sfn_state_machine` resource (disambiguated with `resourceId` when there is more
 * than one) in HCL (`.tf`) or JSON (`.tf.json`) syntax and reads its `definition`: a heredoc, a
 * quoted string of JSON, or `jsonencode({...})` of literals. Values only Terraform can compute
 * (resource attributes, variables, function calls) become `${...}` placeholder strings; calls and
 * operators also add a warning. `templatefile()`, `file()`, references such as `local.x`, `%{ }`
 * template directives and `module` blocks cannot be evaluated and throw with a message saying
 * what to do instead.
 *
 * @param params - Terraform source, optional format, optional resource name.
 * @returns The extracted ASL definition, the resource name used, and any warnings.
 * @throws If no state machine is found, the choice is ambiguous, the definition is in an
 * unsupported form, or the HCL has a syntax error.
 *
 * @example
 * ```typescript
 * const { aslDefinition } = extractAslFromTerraform({ config: mainTfSource });
 * ```
 */
export function extractAslFromTerraform(params: ExtractAslFromTerraformParams): ExtractAslResult {
    const { config, format = 'auto', resourceId } = params;

    const useJson =
        format === 'json' ||
        (format === 'auto' && (typeof config === 'object' || config.trimStart().startsWith('{')));
    if (typeof config === 'object' && !useJson) {
        throw new Error('An already-parsed Terraform configuration can only be read as JSON.');
    }

    try {
        const candidates = useJson
            ? jsonCandidates(parseJsonConfig(config))
            : hclCandidates(stripBom(config as string));
        if (candidates.length === 0) {
            throw new Error(
                `Configuration contains no ${TERRAFORM_STATE_MACHINE_TYPE} resource. ` +
                    `(module, data and locals blocks are not read; a state machine defined through a module must be rendered from its ASL file.)`,
            );
        }

        const names = candidates.map((candidate) => candidate.name);
        const wanted = resourceId?.startsWith(`${TERRAFORM_STATE_MACHINE_TYPE}.`)
            ? resourceId.slice(TERRAFORM_STATE_MACHINE_TYPE.length + 1)
            : resourceId;
        let chosen: Candidate | undefined;
        if (wanted) {
            chosen = candidates.find((candidate) => candidate.name === wanted);
            if (!chosen) {
                throw new Error(
                    `Resource '${resourceId}' is not an ${TERRAFORM_STATE_MACHINE_TYPE} resource. Found: ${names.join(', ')}.`,
                );
            }
        } else if (candidates.length === 1) {
            chosen = candidates[0];
        } else {
            throw new Error(
                `Configuration has multiple state machines (${names.join(', ')}). ` +
                    `Pass resourceId (or --resource) to choose one.`,
            );
        }

        const { aslDefinition, warnings } = resolveCandidate(chosen);
        return { aslDefinition, resourceId: chosen.name, warnings };
    } catch (error) {
        if (error instanceof HclSyntaxError) {
            throw new Error(`Terraform syntax error: ${error.message}`, { cause: error });
        }
        throw error;
    }
}
