import { describe, expect, it } from 'vitest';
import { generateSvg } from '../src';
import type { AslDefinition } from '../src/types';

const parallelAsl: AslDefinition = {
    StartAt: 'FanOut',
    States: {
        FanOut: {
            Type: 'Parallel',
            Branches: [
                { StartAt: 'Branch1', States: { Branch1: { Type: 'Task', Resource: 'arn:b1', End: true } } },
                { StartAt: 'Branch2', States: { Branch2: { Type: 'Task', Resource: 'arn:b2', End: true } } },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

/** The markup of one control, from its opening tag to the end of its group. */
function controlMarkup(svg: string, stateId: string): string {
    const match = svg.match(
        new RegExp(`<g[^>]*data-sfn-collapse-target="${stateId}"[^>]*>[\\s\\S]*?</g>`),
    );
    expect(match, `control for ${stateId}`).not.toBeNull();
    return match![0];
}

describe('collapseControls', () => {
    it('is off by default, so static SVG carries no controls', () => {
        const { svg } = generateSvg({ aslDefinition: parallelAsl });
        expect(svg).not.toContain('data-sfn-collapse-target');
        expect(svg).toBe(generateSvg({ aslDefinition: parallelAsl, collapseControls: false }).svg);
    });

    it('draws a keyboard-reachable collapse control in an open container header', () => {
        const { svg } = generateSvg({ aslDefinition: parallelAsl, collapseControls: true });
        const control = controlMarkup(svg, 'FanOut');

        expect(control).toContain('data-sfn-collapse-action="collapse"');
        expect(control).toContain('role="button"');
        expect(control).toContain('tabindex="0"');
        expect(control).toContain('aria-label="Collapse FanOut"');
        expect(control).toContain('<title>Collapse</title>');
        // The control is drawn last of all, above the edge hit areas that can cross a
        // container's header band, rather than inside the container's own group.
        expect(svg.indexOf('data-state-id="FanOut"')).toBeLessThan(svg.indexOf(control));
        expect(svg.indexOf('class="collapse-controls"')).toBeLessThan(svg.indexOf(control));
        expect(svg.lastIndexOf('class="nodes"')).toBeLessThan(svg.indexOf('class="collapse-controls"'));
        // Plain states get none.
        expect(svg).not.toContain('data-sfn-collapse-target="Done"');
    });

    it('draws an expand control on a collapsed placeholder', () => {
        const { svg } = generateSvg({
            aslDefinition: parallelAsl,
            collapse: ['FanOut'],
            collapseControls: true,
        });
        const control = controlMarkup(svg, 'FanOut');

        expect(control).toContain('data-sfn-collapse-action="expand"');
        expect(control).toContain('aria-label="Expand FanOut"');
        expect(control).toContain('<title>Expand</title>');
        expect(svg).not.toContain('data-sfn-collapse-action="collapse"');
    });

    it('reserves header room for the control so a long container name is not drawn under it', () => {
        const longName = 'A container whose name runs the whole width of its header band';
        const asl: AslDefinition = {
            StartAt: longName,
            States: {
                [longName]: parallelAsl.States.FanOut,
                Done: { Type: 'Succeed' },
            },
        };
        const plain = generateSvg({ aslDefinition: asl });
        const withControls = generateSvg({ aslDefinition: asl, collapseControls: true });

        expect(withControls.width).toBeGreaterThan(plain.width);
    });
});
