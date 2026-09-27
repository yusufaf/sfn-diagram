import { describe, it, expect } from 'vitest';
import { formatSelectionHash, parseSelectionHash } from '../../src/renderers/viewer';

/**
 * The fragment grammar on its own. The round-trip through a real browser is in
 * `viewerRuntime.test.ts`; this pins the parsing a hand-edited URL runs into.
 */
describe('selection fragments', () => {
    it('round-trips a state and an edge', () => {
        for (const selection of [
            { id: 'ProcessOrder', kind: 'state' as const },
            { id: 'ProcessOrder->Ship', kind: 'edge' as const },
        ]) {
            expect(parseSelectionHash(formatSelectionHash(selection))).toEqual(selection);
        }
    });

    it('encodes an id so an edge arrow cannot break the fragment', () => {
        expect(formatSelectionHash({ id: 'A->B', kind: 'edge' })).toBe('#sfn=edge:A-%3EB');
        expect(formatSelectionHash({ id: 'Pay & Ship', kind: 'state' })).toBe(
            '#sfn=state:Pay%20%26%20Ship',
        );
    });

    it('round-trips an id with a colon in it, splitting on the first one only', () => {
        const selection = { id: 'arn:aws:states:::task', kind: 'state' as const };
        expect(parseSelectionHash(formatSelectionHash(selection))).toEqual(selection);
    });

    it('takes a fragment with or without its leading hash', () => {
        expect(parseSelectionHash('sfn=state:A')).toEqual({ id: 'A', kind: 'state' });
    });

    it('ignores every fragment that is not ours', () => {
        for (const hash of [
            '',
            '#',
            '#introduction',
            '#sfn=',
            '#sfn=state:',
            '#sfn=:ProcessOrder',
            '#sfn=node:ProcessOrder',
            '#sfn=stateProcessOrder',
        ]) {
            expect(parseSelectionHash(hash)).toBeNull();
        }
    });

    it('returns null rather than throwing on a mis-encoded id', () => {
        // What hand-editing the address bar produces.
        expect(parseSelectionHash('#sfn=state:%E0%A4%A')).toBeNull();
    });
});
