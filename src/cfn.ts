/**
 * @module
 *
 * Extract renderable ASL from a CloudFormation/SAM/CDK template (the
 * `sfn-diagram/cfn` subpath). Flattens `Fn::Join`/`Fn::Sub` and stubs
 * unresolved intrinsics with readable placeholders. Depends on `yaml`; kept
 * out of the core entry so `sfn-diagram` stays dependency-free.
 *
 * @example
 * ```typescript
 * import { extractAslFromTemplate } from 'sfn-diagram/cfn';
 * import { generateMermaid } from 'sfn-diagram';
 *
 * const { aslDefinition } = extractAslFromTemplate({ template: cdkSynthJson });
 * const { code } = generateMermaid({ aslDefinition });
 * ```
 */
export { extractAslFromTemplate } from './cfn/extract';
export type { ExtractAslFromTemplateParams, ExtractAslResult } from './types';
