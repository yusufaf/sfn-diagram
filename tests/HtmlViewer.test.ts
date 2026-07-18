import { describe, it, expect } from 'vitest';
import { generateHtml } from '../src';

const asl = { StartAt: 'A', States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } } };

describe('generateHtml', () => {
    it('returns a self-contained HTML document embedding the SVG', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.html).toContain('<!DOCTYPE html>');
        expect(result.html).toContain('<svg');
        // No external references — excludes the SVG xmlns namespace URI, which is a
        // fixed identifier (never fetched over the network), not an external reference.
        expect(result.html).not.toMatch(/https?:\/\/(?!www\.w3\.org\/)/);
    });

    it('includes the pan/zoom controller and toolbar', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.html).toContain('data-sfn-zoom'); // toolbar hook
        expect(result.html).toContain('wheel'); // zoom handler wired
    });

    it('reports dimensions and metadata matching the SVG', () => {
        const result = generateHtml({ aslDefinition: asl });
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        expect(result.metadata.nodeCount).toBe(2);
    });
});
