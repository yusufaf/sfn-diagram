import {
    COMMENT_GITLAB_CONFIG_FIELDS,
    CONFIG_FIELDS,
    type ConfigField,
    type JsonSchema,
} from './cliConfig';

/** Where the docs site serves the config schema; it follows `main`, not a release. */
export const CLI_CONFIG_SCHEMA_URL = 'https://sfn.yusufaf.dev/config.schema.json';

/** A config field's schema fragment with its description first, for editor hover text. */
function describedSchema(field: ConfigField): JsonSchema {
    return { description: field.description, ...field.schema };
}

/**
 * Build the JSON Schema (draft-07) for `sfn-diagram.config.*`.
 *
 * Derived from {@link CONFIG_FIELDS}, the table the CLI validates against, so the two
 * cannot list different fields. The committed `config.schema.json` is this output;
 * `pnpm run build:config-schema` regenerates it and `pnpm test` checks it is current.
 *
 * The schema is stricter than the CLI in one place on purpose: it rejects unknown
 * top-level keys so an editor flags a typo, while the CLI drops them so a field added by
 * a later release does not fail an older CLI.
 *
 * @returns The schema, as a plain JSON-serialisable object.
 *
 * @example
 * ```typescript
 * writeFileSync('config.schema.json', `${JSON.stringify(buildCliConfigSchema(), null, 2)}\n`);
 * ```
 */
export function buildCliConfigSchema(): JsonSchema {
    const fields: Record<string, ConfigField> = CONFIG_FIELDS;
    const commentGitlabProperties = Object.fromEntries(
        COMMENT_GITLAB_CONFIG_FIELDS.map((name) => [
            name,
            describedSchema(fields[name]),
        ]),
    );

    return {
        $id: CLI_CONFIG_SCHEMA_URL,
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        description:
            'Configuration for the sfn-diagram CLI. See https://sfn.yusufaf.dev/guides/cli/#configuration-file',
        properties: {
            $schema: {
                description: 'The JSON Schema this file follows, for editor completion.',
                type: 'string',
            },
            ...Object.fromEntries(
                Object.entries(fields).map(([name, field]) => [
                    name,
                    describedSchema(field),
                ]),
            ),
            commentGitlab: {
                anyOf: [
                    { type: 'null' },
                    {
                        additionalProperties: false,
                        properties: commentGitlabProperties,
                        type: 'object',
                    },
                ],
                description:
                    'Settings for `sfn-diagram comment gitlab`, which reads only this block.',
            },
        },
        title: 'sfn-diagram config',
        type: 'object',
    };
}
