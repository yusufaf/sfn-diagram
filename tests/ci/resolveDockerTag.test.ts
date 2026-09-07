import { describe, expect, it } from 'vitest';
import { resolveDockerTag } from '../../scripts/resolve-docker-tag.mjs';

describe('resolveDockerTag', () => {
    it('resolves a current sfn-diagram-v<semver> tag', () => {
        expect(resolveDockerTag({ tag: 'sfn-diagram-v1.6.1' })).toEqual({
            major: '1',
            minor: '1.6',
            version: '1.6.1',
        });
    });

    it('resolves a legacy no-hyphen v<semver> tag', () => {
        expect(resolveDockerTag({ tag: 'v0.4.1' })).toEqual({
            major: '0',
            minor: '0.4',
            version: '0.4.1',
        });
    });

    // Regression for #127: this tag was stripped down to "scode-sfn-diagram-v0.1.1"
    // and pushed to ghcr.io before the post-push verification caught it.
    it('rejects a vscode-sfn-diagram-v* tag', () => {
        expect(() => resolveDockerTag({ tag: 'vscode-sfn-diagram-v0.1.1' })).toThrow(
            /unrecognized tag/,
        );
    });

    it('rejects a sfn-diagram-react-v* tag', () => {
        expect(() => resolveDockerTag({ tag: 'sfn-diagram-react-v0.4.0' })).toThrow(
            /unrecognized tag/,
        );
    });

    it('rejects a github-action-sfn-diagram-v* tag', () => {
        expect(() =>
            resolveDockerTag({ tag: 'github-action-sfn-diagram-v1.4.0' }),
        ).toThrow(/unrecognized tag/);
    });

    it('rejects a sfn-diagram-v tag whose remainder is not a semver', () => {
        expect(() => resolveDockerTag({ tag: 'sfn-diagram-vnot-a-version' })).toThrow(
            /not a semver/,
        );
    });
});
