import { parse as parseYaml } from 'yaml';
import type { CollectionTag, ScalarTag } from 'yaml';

/** Parameters for {@link parseTemplate}. */
export interface ParseTemplateParams {
    /** Input format. 'auto' (default) sniffs JSON vs YAML. */
    format?: 'auto' | 'json' | 'yaml';
    /** Raw template string, or an already-parsed template object. */
    template: string | Record<string, unknown>;
}

/**
 * CloudFormation short-form YAML tags, mapped to the JSON long form the rest of
 * the pipeline understands. `!Ref x` becomes `{ Ref: 'x' }`; every `Fn::*` tag
 * becomes `{ 'Fn::Name': value }`.
 */
const CFN_TAG_NAMES: string[] = [
    'Ref',
    'Base64',
    'Cidr',
    'FindInMap',
    'GetAtt',
    'GetAZs',
    'ImportValue',
    'Join',
    'Select',
    'Split',
    'Sub',
    'Transform',
    'And',
    'Equals',
    'If',
    'Not',
    'Or',
    'Condition',
];

function longFormKey(tagName: string): string {
    return tagName === 'Ref' || tagName === 'Condition' ? tagName : `Fn::${tagName}`;
}

function buildCfnTags(): Array<CollectionTag | ScalarTag> {
    const tags: Array<CollectionTag | ScalarTag> = [];

    for (const tagName of CFN_TAG_NAMES) {
        const toLongForm = (value: unknown): Record<string, unknown> => {
            // GetAtt in short form is a dotted string ("Role.Arn"); expand to an array.
            if (tagName === 'GetAtt' && typeof value === 'string') {
                return { 'Fn::GetAtt': value.split('.') };
            }
            return { [longFormKey(tagName)]: value };
        };

        tags.push({
            identify: () => false,
            resolve: (value: string) => toLongForm(value),
            tag: `!${tagName}`,
        } as ScalarTag);

        tags.push({
            collection: 'seq',
            identify: () => false,
            resolve: (value: { toJSON(): unknown }) => toLongForm(value.toJSON()),
            tag: `!${tagName}`,
        } as unknown as CollectionTag);

        tags.push({
            collection: 'map',
            identify: () => false,
            resolve: (value: { toJSON(): unknown }) => toLongForm(value.toJSON()),
            tag: `!${tagName}`,
        } as unknown as CollectionTag);
    }

    return tags;
}

const CFN_TAGS: Array<CollectionTag | ScalarTag> = buildCfnTags();

function looksLikeJson(text: string): boolean {
    return text.trimStart().startsWith('{');
}

/**
 * Parses a CloudFormation/SAM/CDK template into a plain object.
 *
 * JSON is parsed with `JSON.parse`; YAML is parsed with CloudFormation
 * short-form intrinsic tags normalized to their JSON long form, so downstream
 * code only has to understand `{ Ref: ... }` / `{ 'Fn::Sub': ... }` shapes.
 *
 * @param params - Template source and optional explicit format.
 * @returns The parsed template object.
 *
 * @example
 * ```typescript
 * const template = parseTemplate({ template: yamlSource, format: 'yaml' });
 * ```
 */
export function parseTemplate(params: ParseTemplateParams): Record<string, unknown> {
    const { format = 'auto', template } = params;

    if (typeof template !== 'string') {
        return template;
    }

    const useJson = format === 'json' || (format === 'auto' && looksLikeJson(template));
    if (useJson) {
        return JSON.parse(template) as Record<string, unknown>;
    }

    return parseYaml(template, { customTags: CFN_TAGS }) as Record<string, unknown>;
}
