// Type-checked by tests/formatNarrowing.test.ts, never executed. Each export
// typed with `Equals` compiles only while its two types are identical.
import type { DiagramOptions, IconPosition } from '../../src/index';
import type { CliConfig } from '../../src/cliConfig';

/** `true` only when the two types are identical, not merely assignable. */
export type Equals<Left, Right> =
    (<Probe>() => Probe extends Left ? 1 : 2) extends <Probe>() => Probe extends Right ? 1 : 2 ? true : false;

export const iconPositionMembers: Equals<IconPosition, 'left' | 'right' | 'top'> = true;
export const diagramOptionsUseIconPosition: Equals<NonNullable<DiagramOptions['iconPosition']>, IconPosition> = true;
export const cliConfigUsesIconPosition: Equals<NonNullable<CliConfig['iconPosition']>, IconPosition> = true;
