import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Context7 silently skips any field over its limit
// (https://context7.com/schema/context7.json), so a long rule would just vanish.
const config = JSON.parse(
    readFileSync(join(__dirname, '..', 'context7.json'), 'utf8'),
) as {
    description: string;
    projectTitle: string;
    rules: string[];
};

describe('context7.json', () => {
    it('stays within the limits Context7 enforces', () => {
        expect(config.projectTitle.length).toBeLessThanOrEqual(100);
        expect(config.description.length).toBeLessThanOrEqual(500);
        expect(config.rules.length).toBeLessThanOrEqual(50);
        for (const rule of config.rules) {
            expect(rule.length, rule).toBeLessThanOrEqual(255);
        }
    });
});
