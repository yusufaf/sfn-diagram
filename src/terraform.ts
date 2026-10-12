/**
 * @module
 *
 * Extract renderable ASL from a Terraform `aws_sfn_state_machine` resource (the
 * `sfn-diagram/terraform` subpath). Reads HCL (`.tf`) and JSON (`.tf.json`): heredoc and quoted
 * JSON definitions, and `jsonencode({...})` of literals. Values only Terraform can compute become
 * `${...}` placeholders. `templatefile()`, `file()`, `local.*` references and `module` blocks are
 * not evaluated. Has no dependencies and runs in Node, browsers and edge runtimes.
 *
 * @example
 * ```typescript
 * import { extractAslFromTerraform } from 'sfn-diagram/terraform';
 * import { generateMermaid } from 'sfn-diagram';
 *
 * const { aslDefinition } = extractAslFromTerraform({ config: mainTfSource });
 * const { code } = generateMermaid({ aslDefinition });
 * ```
 */
export { extractAslFromTerraform } from './terraform/extract';
export type { ExtractAslFromTerraformParams, ExtractAslResult } from './types';
