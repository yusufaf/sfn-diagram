// Type-checked by tests/formatNarrowing.test.ts with `isolatedDeclarations`
// off, never executed. Each probed call is exported unannotated, so `typeof`
// is the overload's inferred result (the export also keeps no-unused-vars
// quiet). Each export typed with `Equals` compiles only while its two types
// are identical.
import { generateDiagram, generateFromAwsResponse } from '../../src/index';
import type {
    AslDefinition,
    DiagramFormat,
    DiagramOptions,
    GenerateDiagramParams,
    HtmlOutput,
    IconPosition,
    MermaidOutput,
    SfnDiagramGenerator,
    SvgOutput,
} from '../../src/index';
import type { CliConfig } from '../../src/cliConfig';

/** `true` only when the two types are identical, not merely assignable. */
export type Equals<Left, Right> =
    (<Probe>() => Probe extends Left ? 1 : 2) extends <Probe>() => Probe extends Right ? 1 : 2 ? true : false;
type AnyOutput = HtmlOutput | MermaidOutput | SvgOutput;

declare const aslDefinition: AslDefinition;
declare const anyFormat: DiagramFormat;
declare const svgOrMermaid: 'mermaid' | 'svg';
declare const params: GenerateDiagramParams;
declare const generator: SfnDiagramGenerator;
const response = { definition: '{}' };

export const omittedFormat = generateDiagram({ aslDefinition });
export const omittedFormatIsAnyOutput: Equals<typeof omittedFormat, AnyOutput> = true;
export const undefinedFormat = generateDiagram({ aslDefinition, format: undefined });
export const undefinedFormatIsAnyOutput: Equals<typeof undefinedFormat, AnyOutput> = true;
export const svgFormat = generateDiagram({ aslDefinition, format: 'svg' });
export const svgFormatIsSvgOutput: Equals<typeof svgFormat, SvgOutput> = true;
export const mermaidFormat = generateDiagram({ aslDefinition, format: 'mermaid' });
export const mermaidFormatIsMermaidOutput: Equals<typeof mermaidFormat, MermaidOutput> = true;
export const htmlFormat = generateDiagram({ aslDefinition, format: 'html' });
export const htmlFormatIsHtmlOutput: Equals<typeof htmlFormat, HtmlOutput> = true;
export const pngFormat = generateDiagram({ aslDefinition, format: 'png' });
export const pngFormatIsAnyOutput: Equals<typeof pngFormat, AnyOutput> = true;
export const variableFormat = generateDiagram({ aslDefinition, format: anyFormat });
export const variableFormatIsAnyOutput: Equals<typeof variableFormat, AnyOutput> = true;
export const literalUnionFormat = generateDiagram({ aslDefinition, format: svgOrMermaid });
export const literalUnionFormatIsAnyOutput: Equals<typeof literalUnionFormat, AnyOutput> = true;
export const paramsVariable = generateDiagram(params);
export const paramsVariableIsAnyOutput: Equals<typeof paramsVariable, AnyOutput> = true;

export const awsOmittedFormat = generateFromAwsResponse({ response });
export const awsOmittedFormatIsAnyOutput: Equals<typeof awsOmittedFormat, AnyOutput> = true;
export const awsSvg = generateFromAwsResponse({ response, format: 'svg' });
export const awsSvgIsSvgOutput: Equals<typeof awsSvg, SvgOutput> = true;
export const awsMermaid = generateFromAwsResponse({ response, format: 'mermaid' });
export const awsMermaidIsMermaidOutput: Equals<typeof awsMermaid, MermaidOutput> = true;
export const awsHtml = generateFromAwsResponse({ response, format: 'html' });
export const awsHtmlIsHtmlOutput: Equals<typeof awsHtml, HtmlOutput> = true;
export const awsPng = generateFromAwsResponse({ response, format: 'png' });
export const awsPngIsAnyOutput: Equals<typeof awsPng, AnyOutput> = true;
export const awsVariableFormat = generateFromAwsResponse({ response, format: anyFormat });
export const awsVariableFormatIsAnyOutput: Equals<typeof awsVariableFormat, AnyOutput> = true;

export const generatorOmittedFormat = generator.generate({ aslDefinition });
export const generatorOmittedFormatIsAnyOutput: Equals<typeof generatorOmittedFormat, AnyOutput> = true;
export const generatorSvg = generator.generate({ aslDefinition, format: 'svg' });
export const generatorSvgIsSvgOutput: Equals<typeof generatorSvg, SvgOutput> = true;
export const generatorMermaid = generator.generate({ aslDefinition, format: 'mermaid' });
export const generatorMermaidIsMermaidOutput: Equals<typeof generatorMermaid, MermaidOutput> = true;
export const generatorHtml = generator.generate({ aslDefinition, format: 'html' });
export const generatorHtmlIsHtmlOutput: Equals<typeof generatorHtml, HtmlOutput> = true;
export const generatorVariableFormat = generator.generate({ aslDefinition, format: anyFormat });
export const generatorVariableFormatIsAnyOutput: Equals<typeof generatorVariableFormat, AnyOutput> = true;

export const iconPositionMembers: Equals<IconPosition, 'left' | 'right' | 'top'> = true;
export const diagramOptionsUseIconPosition: Equals<NonNullable<DiagramOptions['iconPosition']>, IconPosition> = true;
export const cliConfigUsesIconPosition: Equals<NonNullable<CliConfig['iconPosition']>, IconPosition> = true;
