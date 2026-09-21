import { describe, it, expect } from 'vitest';
import { AslSyntaxError, AslValidationError, parseAslSource } from '../src/AslParser';
import type { AslDefinition } from '../src/types';

const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', End: true } } };

describe('parseAslSource', () => {
    it('returns an object source unchanged', () => {
        expect(parseAslSource({ source: asl })).toBe(asl);
    });

    it('parses a JSON string source', () => {
        expect(parseAslSource({ source: JSON.stringify(asl) })).toEqual(asl);
    });

    it('throws AslSyntaxError for a malformed string', () => {
        expect(() => parseAslSource({ source: '{not json' })).toThrow(AslSyntaxError);
        expect(() => parseAslSource({ source: '{not json' })).toThrow('ASL definition is not valid JSON');
    });

    it('keeps the raw JSON.parse failure as cause', () => {
        let caught: unknown;
        try {
            parseAslSource({ source: '{not json' });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AslSyntaxError);
        const syntaxError = caught as AslSyntaxError;
        expect(syntaxError.name).toBe('AslSyntaxError');
        expect(syntaxError.cause).toBeInstanceOf(SyntaxError);
        expect(syntaxError.message).toContain((syntaxError.cause as SyntaxError).message);
    });
});

describe('AslSyntaxError', () => {
    const error = new AslSyntaxError('bad');

    it('is a SyntaxError, so existing catch sites keep working', () => {
        expect(error instanceof SyntaxError).toBe(true);
        expect(error instanceof Error).toBe(true);
    });

    it('is also an AslValidationError', () => {
        expect(error instanceof AslValidationError).toBe(true);
    });

    it('does not make a structural AslValidationError a SyntaxError', () => {
        const validationError = new AslValidationError('bad shape');
        expect(validationError instanceof AslValidationError).toBe(true);
        expect(validationError instanceof SyntaxError).toBe(false);
    });

    it('does not leak into subclasses of AslValidationError', () => {
        class CustomValidationError extends AslValidationError {}
        expect(error instanceof CustomValidationError).toBe(false);
        expect(new CustomValidationError('x') instanceof CustomValidationError).toBe(true);
        expect(new CustomValidationError('x') instanceof AslValidationError).toBe(true);
    });
});
