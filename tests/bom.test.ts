import { describe, expect, it } from 'vitest';
import { stripBom } from '../src/utils/bom';

const BOM = String.fromCharCode(0xfeff);

describe('stripBom', () => {
    it('drops one leading byte order mark', () => {
        expect(stripBom(`${BOM}{"a":1}`)).toBe('{"a":1}');
    });

    it('leaves text without one unchanged', () => {
        expect(stripBom('{"a":1}')).toBe('{"a":1}');
        expect(stripBom('')).toBe('');
    });

    it('handles a byte order mark on its own', () => {
        expect(stripBom(BOM)).toBe('');
    });

    it('drops only the first one, and never one past the start', () => {
        expect(stripBom(`${BOM}${BOM}x`)).toBe(`${BOM}x`);
        expect(stripBom(`x${BOM}`)).toBe(`x${BOM}`);
    });
});
