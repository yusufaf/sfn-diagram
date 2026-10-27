import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'tsdown';
import rootConfigs from '../tsdown.config';
import reactConfig from '../packages/sfn-diagram-react/tsdown.config';

// Left unset, tsdown derives the target from engines.node, so raising the Node floor
// (#285) would silently raise the syntax level of dist/. Core also runs in browsers,
// edge runtimes and the custom element, so the target is a language level instead.
describe('tsdown build target', () => {
    it('pins every core build entry to ES2022 rather than deriving it from engines.node', () => {
        const configs = rootConfigs as UserConfig[];
        expect(configs.length).toBeGreaterThan(0);
        for (const config of configs) {
            expect(config.target, JSON.stringify(config.entry)).toBe('es2022');
        }
    });

    it('pins the React wrapper build to the same target', () => {
        expect((reactConfig as UserConfig).target).toBe('es2022');
    });
});
