import { describe, expect, it } from 'vitest'
import { ASL_FILENAME_PATTERN, MAX_SNIFF_LENGTH, isAslDocument, isAslFilename, looksLikeAslContent } from './aslDetection'

const VALID_ASL = '{"StartAt":"A","States":{"A":{"Type":"Succeed"}}}'

const PACKAGE_JSON_TEXT = `{
    "name": "some-package",
    "version": "1.0.0",
    "scripts": {
        "build": "tsc"
    }
}`

const TSCONFIG_TEXT = `{
    "compilerOptions": {
        "strict": true
    }
}`

const EXECUTION_HISTORY_TEXT = '{"events":[{"type":"ExecutionStarted"},{"type":"ExecutionSucceeded"}]}'

const CFN_TEMPLATE_TEXT = JSON.stringify({
    Resources: {
        StateMachine: {
            Properties: {
                Definition: {
                    StartAt: 'A',
                    States: { A: { Type: 'Succeed' } },
                },
            },
            Type: 'AWS::StepFunctions::StateMachine',
        },
    },
})

describe('ASL_FILENAME_PATTERN', () => {
    it('matches .asl.json case-insensitively', () => {
        expect(ASL_FILENAME_PATTERN.test('order.asl.json')).toBe(true)
        expect(ASL_FILENAME_PATTERN.test('ORDER.ASL.JSON')).toBe(true)
    })

    it('does not match plain .json', () => {
        expect(ASL_FILENAME_PATTERN.test('package.json')).toBe(false)
    })
})

describe('isAslFilename', () => {
    it('accepts a plain .asl.json filename', () => {
        expect(isAslFilename({ filename: 'order-processing.asl.json' })).toBe(true)
    })

    it('accepts an uppercase .asl.json filename', () => {
        expect(isAslFilename({ filename: 'ORDER.ASL.JSON' })).toBe(true)
    })

    it('accepts a full path ending in .asl.json', () => {
        expect(isAslFilename({ filename: '/repo/examples/order.asl.json' })).toBe(true)
    })

    it('accepts a plain .asl filename', () => {
        expect(isAslFilename({ filename: 'order.asl' })).toBe(true)
    })

    it('rejects package.json', () => {
        expect(isAslFilename({ filename: 'package.json' })).toBe(false)
    })

    it('rejects tsconfig.json', () => {
        expect(isAslFilename({ filename: 'tsconfig.json' })).toBe(false)
    })

    it('rejects a filename with a trailing extension after .asl.json', () => {
        expect(isAslFilename({ filename: 'order.asl.json.bak' })).toBe(false)
    })

    it('rejects a filename with no dot before asl', () => {
        expect(isAslFilename({ filename: 'asl.json' })).toBe(false)
    })

    it('rejects an empty filename', () => {
        expect(isAslFilename({ filename: '' })).toBe(false)
    })
})

describe('looksLikeAslContent', () => {
    it('accepts a minimal valid ASL document', () => {
        expect(looksLikeAslContent({ text: VALID_ASL })).toBe(true)
    })

    it('accepts States written before StartAt', () => {
        const text = '{"States":{"A":{"Type":"Succeed"}},"StartAt":"A"}'
        expect(looksLikeAslContent({ text })).toBe(true)
    })

    it('accepts valid ASL with leading whitespace and a BOM', () => {
        const text = `\uFEFF   ${VALID_ASL}`
        expect(looksLikeAslContent({ text })).toBe(true)
    })

    it('rejects real package.json text', () => {
        expect(looksLikeAslContent({ text: PACKAGE_JSON_TEXT })).toBe(false)
    })

    it('rejects real tsconfig.json text', () => {
        expect(looksLikeAslContent({ text: TSCONFIG_TEXT })).toBe(false)
    })

    it('rejects execution-history shaped JSON', () => {
        expect(looksLikeAslContent({ text: EXECUTION_HISTORY_TEXT })).toBe(false)
    })

    it('rejects a document that only mentions StartAt and States in prose', () => {
        const text = '{"Comment":"mentions StartAt and States"}'
        expect(looksLikeAslContent({ text })).toBe(false)
    })

    it('rejects ASL nested under a CloudFormation template', () => {
        expect(looksLikeAslContent({ text: CFN_TEMPLATE_TEXT })).toBe(false)
    })

    it('rejects a mid-typing partial document', () => {
        expect(looksLikeAslContent({ text: '{"StartAt":"A","States":{' })).toBe(false)
    })

    it('rejects an array at the top level', () => {
        expect(looksLikeAslContent({ text: '[{"StartAt":"A","States":{}}]' })).toBe(false)
    })

    it('rejects a non-string StartAt', () => {
        expect(looksLikeAslContent({ text: '{"StartAt":5,"States":{}}' })).toBe(false)
    })

    it('rejects an array States', () => {
        expect(looksLikeAslContent({ text: '{"StartAt":"A","States":[]}' })).toBe(false)
    })

    it('rejects a document missing States', () => {
        expect(looksLikeAslContent({ text: '{"StartAt":"A"}' })).toBe(false)
    })

    it('rejects a document missing StartAt', () => {
        expect(looksLikeAslContent({ text: '{"States":{}}' })).toBe(false)
    })

    it('rejects an empty string', () => {
        expect(looksLikeAslContent({ text: '' })).toBe(false)
    })

    it('rejects the literal null', () => {
        expect(looksLikeAslContent({ text: 'null' })).toBe(false)
    })

    it('rejects a bare JSON string', () => {
        expect(looksLikeAslContent({ text: '"StartAt"' })).toBe(false)
    })

    it('rejects JSONC with a comment even when the rest is valid ASL', () => {
        const text = `// a comment\n${VALID_ASL}`
        expect(looksLikeAslContent({ text })).toBe(false)
    })

    it('rejects valid ASL padded past MAX_SNIFF_LENGTH', () => {
        const padding = 'x'.repeat(MAX_SNIFF_LENGTH)
        const text = `{"Comment":"${padding}","StartAt":"A","States":{"A":{"Type":"Succeed"}}}`
        expect(looksLikeAslContent({ text })).toBe(false)
    })
})

describe('isAslDocument', () => {
    it('trusts the filename for a brand-new .asl.json file with garbage content', () => {
        expect(isAslDocument({ filename: 'new.asl.json', text: '{' })).toBe(true)
    })

    it('falls back to content sniffing for a plainly-named .json file', () => {
        expect(isAslDocument({ filename: 'statemachine.json', text: VALID_ASL })).toBe(true)
    })

    it('rejects package.json even though it is JSON', () => {
        expect(isAslDocument({ filename: 'package.json', text: PACKAGE_JSON_TEXT })).toBe(false)
    })

    it('rejects tsconfig.json', () => {
        expect(isAslDocument({ filename: 'tsconfig.json', text: TSCONFIG_TEXT })).toBe(false)
    })

    it('is name-agnostic for non-.json files containing valid ASL', () => {
        expect(isAslDocument({ filename: 'notes.txt', text: VALID_ASL })).toBe(true)
    })

    it('accepts a .asl file', () => {
        expect(isAslDocument({ filename: 'order.asl', text: VALID_ASL })).toBe(true)
    })
})
