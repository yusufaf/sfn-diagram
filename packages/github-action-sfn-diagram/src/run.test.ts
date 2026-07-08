import * as core from '@actions/core'
import * as github from '@actions/github'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AslDefinition } from 'sfn-diagram'
import {
    formatStateList,
    isAslDefinition,
    matchesPatterns,
    parseAsl,
    run,
} from './run.js'

vi.mock('@actions/core', () => ({
    getInput: vi.fn(),
    info: vi.fn(),
    setFailed: vi.fn(),
}))

vi.mock('@actions/github', () => ({
    getOctokit: vi.fn(),
    context: {
        payload: {} as Record<string, unknown>,
        repo: { owner: 'acme', repo: 'workflows' },
    },
}))

const MARKER = '<!-- sfn-diagram-action:sfn-diagram-preview-->'
const BASE_SHA = 'base-sha'
const HEAD_SHA = 'head-sha'
const PR_NUMBER = 42

const beforeAsl: AslDefinition = {
    StartAt: 'ValidateOrder',
    States: {
        ValidateOrder: { Type: 'Pass', Next: 'CheckStock' },
        CheckStock: {
            Type: 'Choice',
            Choices: [{ Variable: '$.inStock', BooleanEquals: true, Next: 'ChargePayment' }],
            Default: 'CancelOrder',
        },
        ChargePayment: { Type: 'Task', Resource: 'arn:aws:lambda:::function:charge-v1', Next: 'ShipOrder' },
        ShipOrder: { Type: 'Task', Resource: 'arn:aws:lambda:::function:ship', Next: 'OrderComplete' },
        CancelOrder: { Type: 'Fail', Error: 'OutOfStock' },
        OrderComplete: { Type: 'Succeed' },
    },
}

// FraudCheck added, ChargePayment + CheckStock modified, CancelOrder removed.
const afterAsl: AslDefinition = {
    StartAt: 'ValidateOrder',
    States: {
        ValidateOrder: { Type: 'Pass', Next: 'CheckStock' },
        CheckStock: {
            Type: 'Choice',
            Choices: [{ Variable: '$.inStock', BooleanEquals: true, Next: 'ChargePayment' }],
            Default: 'OrderComplete',
        },
        ChargePayment: { Type: 'Task', Resource: 'arn:aws:lambda:::function:charge-v2', Next: 'FraudCheck' },
        FraudCheck: { Type: 'Task', Resource: 'arn:aws:lambda:::function:fraud', Next: 'ShipOrder' },
        ShipOrder: { Type: 'Task', Resource: 'arn:aws:lambda:::function:ship', Next: 'OrderComplete' },
        OrderComplete: { Type: 'Succeed' },
    },
}

const encode = (asl: AslDefinition): string =>
    Buffer.from(JSON.stringify(asl)).toString('base64')

const fileResponse = (asl: AslDefinition) => ({
    data: { type: 'file', content: encode(asl) },
})

interface OctokitStubParams {
    /** ASL served for each git ref, keyed by sha. Missing sha → 404 (returns null). */
    contentByRef?: Record<string, AslDefinition>
    /** Existing PR comments returned by listComments. */
    existingComments?: { body: string; id: number }[]
    /** Files returned by pulls.listFiles. */
    files?: { filename: string; status: string }[]
}

function makeOctokit(params: OctokitStubParams = {}) {
    const { contentByRef = {}, existingComments = [], files = [] } = params
    return {
        rest: {
            issues: {
                createComment: vi.fn().mockResolvedValue({}),
                listComments: vi.fn().mockResolvedValue({ data: existingComments }),
                updateComment: vi.fn().mockResolvedValue({}),
            },
            pulls: {
                listFiles: vi.fn().mockResolvedValue({ data: files }),
            },
            repos: {
                getContent: vi.fn().mockImplementation(async ({ ref }: { ref: string }) => {
                    const asl = contentByRef[ref]
                    if (!asl) throw new Error('404 not found')
                    return fileResponse(asl)
                }),
            },
        },
    }
}

type OctokitStub = ReturnType<typeof makeOctokit>

function useOctokit(stub: OctokitStub): void {
    vi.mocked(github.getOctokit).mockReturnValue(stub as unknown as ReturnType<typeof github.getOctokit>)
}

function setPullRequest(): void {
    github.context.payload = {
        pull_request: {
            base: { sha: BASE_SHA },
            head: { sha: HEAD_SHA },
            number: PR_NUMBER,
        },
    }
}

const createdBody = (stub: OctokitStub): string =>
    stub.rest.issues.createComment.mock.calls[0][0].body as string

beforeEach(() => {
    vi.clearAllMocks()
    github.context.payload = {}
    vi.mocked(core.getInput).mockImplementation((name: string) =>
        name === 'github-token' ? 'test-token' : '',
    )
})

describe('matchesPatterns', () => {
    const patterns = ['**/*.asl.json', '**/*.asl']

    it('matches nested ASL files', () => {
        expect(matchesPatterns('workflows/order.asl.json', patterns)).toBe(true)
        expect(matchesPatterns('deep/nested/state.asl', patterns)).toBe(true)
    })

    it('matches a top-level ASL file via matchBase', () => {
        expect(matchesPatterns('order.asl.json', patterns)).toBe(true)
    })

    it('rejects non-ASL files', () => {
        expect(matchesPatterns('README.md', patterns)).toBe(false)
        expect(matchesPatterns('src/order.ts', patterns)).toBe(false)
    })
})

describe('parseAsl / isAslDefinition', () => {
    it('parses a valid ASL definition', () => {
        const parsed = parseAsl(JSON.stringify(beforeAsl))
        expect(parsed?.StartAt).toBe('ValidateOrder')
    })

    it('returns null for invalid JSON', () => {
        expect(parseAsl('{ not json')).toBeNull()
    })

    it('returns null for JSON that is not an ASL definition', () => {
        expect(parseAsl('{"foo":"bar"}')).toBeNull()
        expect(parseAsl('[1,2,3]')).toBeNull()
    })

    it('recognises the ASL shape', () => {
        expect(isAslDefinition({ StartAt: 'A', States: {} })).toBe(true)
        expect(isAslDefinition({ StartAt: 'A' })).toBe(false)
        expect(isAslDefinition({ StartAt: 5, States: {} })).toBe(false)
        expect(isAslDefinition(null)).toBe(false)
    })
})

describe('formatStateList', () => {
    it('wraps each name in backticks and comma-joins', () => {
        expect(formatStateList(['A', 'B'])).toBe('`A`, `B`')
    })

    it('returns an empty string for no names', () => {
        expect(formatStateList([])).toBe('')
    })
})

describe('run', () => {
    it('skips when the event is not a pull request', async () => {
        await run()
        expect(core.info).toHaveBeenCalledWith('Not a pull_request event — skipping')
        expect(github.getOctokit).not.toHaveBeenCalled()
    })

    it('skips when no changed files match the ASL globs', async () => {
        setPullRequest()
        const stub = makeOctokit({ files: [{ filename: 'src/app.ts', status: 'modified' }] })
        useOctokit(stub)

        await run()

        expect(core.info).toHaveBeenCalledWith('No ASL files changed in this PR')
        expect(stub.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it('ignores unchanged ASL files', async () => {
        setPullRequest()
        const stub = makeOctokit({
            files: [{ filename: 'flows/order.asl.json', status: 'unchanged' }],
        })
        useOctokit(stub)

        await run()

        expect(core.info).toHaveBeenCalledWith('No ASL files changed in this PR')
        expect(stub.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it('renders a plain diagram for an added file', async () => {
        setPullRequest()
        const stub = makeOctokit({
            contentByRef: { [HEAD_SHA]: afterAsl },
            files: [{ filename: 'flows/new.asl.json', status: 'added' }],
        })
        useOctokit(stub)

        await run()

        expect(stub.rest.issues.createComment).toHaveBeenCalledTimes(1)
        const body = createdBody(stub)
        expect(body).toContain(MARKER)
        expect(body).toContain('✨ **New file**')
        expect(body).toContain('```mermaid')
        // A plain (non-diff) diagram is collapsed, not `<details open>`.
        expect(body).toContain('<details>')
        expect(body).not.toContain('diffAdded')
    })

    it('renders the before-diagram for a deleted file', async () => {
        setPullRequest()
        const stub = makeOctokit({
            contentByRef: { [BASE_SHA]: beforeAsl },
            files: [{ filename: 'flows/gone.asl.json', status: 'removed' }],
        })
        useOctokit(stub)

        await run()

        const body = createdBody(stub)
        expect(body).toContain('⚠️ **File deleted**')
        expect(body).toContain('Before diagram')
        expect(body).toContain('```mermaid')
    })

    it('highlights added, modified, and removed states for a changed file', async () => {
        setPullRequest()
        const stub = makeOctokit({
            contentByRef: { [BASE_SHA]: beforeAsl, [HEAD_SHA]: afterAsl },
            files: [{ filename: 'flows/order.asl.json', status: 'modified' }],
        })
        useOctokit(stub)

        await run()

        const body = createdBody(stub)
        // Change-summary table
        expect(body).toContain('➕ Added')
        expect(body).toContain('`FraudCheck`')
        expect(body).toContain('✏️ Modified')
        expect(body).toContain('`ChargePayment`')
        expect(body).toContain('❌ Removed')
        expect(body).toContain('`CancelOrder`')
        // Highlighted Mermaid diagram, expanded by default
        expect(body).toContain('<details open>')
        expect(body).toContain('classDef diffAdded')
        expect(body).toContain('class FraudCheck diffAdded')
        expect(body).toContain('class CancelOrder diffRemoved')
    })

    it('updates the existing comment instead of creating a new one', async () => {
        setPullRequest()
        const stub = makeOctokit({
            contentByRef: { [HEAD_SHA]: afterAsl },
            existingComments: [{ body: `${MARKER}\nold content`, id: 999 }],
            files: [{ filename: 'flows/new.asl.json', status: 'added' }],
        })
        useOctokit(stub)

        await run()

        expect(stub.rest.issues.updateComment).toHaveBeenCalledTimes(1)
        expect(stub.rest.issues.updateComment.mock.calls[0][0].comment_id).toBe(999)
        expect(stub.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it('uses a custom comment-tag in the marker', async () => {
        setPullRequest()
        vi.mocked(core.getInput).mockImplementation((name: string) => {
            if (name === 'github-token') return 'test-token'
            if (name === 'comment-tag') return 'my-preview'
            return ''
        })
        const stub = makeOctokit({
            contentByRef: { [HEAD_SHA]: afterAsl },
            files: [{ filename: 'flows/new.asl.json', status: 'added' }],
        })
        useOctokit(stub)

        await run()

        expect(createdBody(stub)).toContain('<!-- sfn-diagram-action:my-preview-->')
    })
})
