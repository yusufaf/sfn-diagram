import type { CreateLayoutCacheParams, LayoutCache } from 'sfn-diagram'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramPanel } from './DiagramPanel'
import { DEFAULT_SETTINGS } from './settings'
import { createFakePanel, type FakePanel } from './testing/fakeWebviewPanel'

const mocked = vi.hoisted(() => ({ caches: [] as LayoutCache[], panel: undefined as unknown }))

vi.mock('vscode', () => ({
    ViewColumn: { Two: 2 },
    window: { activeTextEditor: undefined, createWebviewPanel: () => mocked.panel },
}))

vi.mock('sfn-diagram', async (importOriginal) => {
    const actual = await importOriginal<typeof import('sfn-diagram')>()
    return {
        ...actual,
        createLayoutCache: (params?: CreateLayoutCacheParams) => {
            const cache = actual.createLayoutCache(params)
            mocked.caches.push(cache)
            return cache
        },
    }
})

const parallelAsl = (comment: string) =>
    JSON.stringify({
        Comment: comment,
        StartAt: 'FanOut',
        States: {
            FanOut: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Branch1', States: { Branch1: { Type: 'Pass', End: true } } },
                    { StartAt: 'Branch2', States: { Branch2: { Type: 'Pass', End: true } } },
                ],
                Next: 'Done',
            },
            Done: { Type: 'Succeed' },
        },
    })

const containerlessAsl = (comment: string) =>
    JSON.stringify({
        Comment: comment,
        StartAt: 'A',
        States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } },
    })

const namedStateAsl = (stateName: string) =>
    JSON.stringify({
        StartAt: stateName,
        States: { [stateName]: { Type: 'Pass', Next: 'Done' }, Done: { Type: 'Succeed' } },
    })

const DOCUMENT_URI = 'file:///w/flow.asl.json'

let fake: FakePanel

function open(aslContent: string): void {
    DiagramPanel.createOrShow({ aslContent, colorScheme: 'dark', documentUri: DOCUMENT_URI, settings: DEFAULT_SETTINGS })
}

function edit(aslContent: string): void {
    DiagramPanel.currentPanel!.scheduleRefresh(aslContent)
    vi.runOnlyPendingTimers()
}

function typeWithoutWaiting(aslContent: string): void {
    DiagramPanel.currentPanel!.scheduleRefresh(aslContent)
}

describe('DiagramPanel edits', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fake = createFakePanel()
        mocked.panel = fake.panel
    })

    afterEach(() => {
        DiagramPanel.currentPanel?.dispose()
        vi.useRealTimers()
    })

    it('patches every edit to a container diagram in place, keeping per-container collapse', () => {
        open(parallelAsl('v1'))
        edit(parallelAsl('v2'))
        edit(parallelAsl('v3'))

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(2)
        for (const post of fake.posts) {
            expect(post.command).toBe('updateContent')
            expect(post.relayoutModel).toBeDefined()
        }
    })

    it('keeps patching when an edit removes the containers and a later one restores them', () => {
        open(parallelAsl('v1'))
        edit(containerlessAsl('v2'))
        edit(parallelAsl('v3'))

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(2)
    })

    it('re-renders the whole document when an edit gives a containerless diagram its first container', () => {
        open(containerlessAsl('v1'))
        edit(parallelAsl('v2'))

        expect(fake.htmls).toHaveLength(2)
        expect(fake.posts).toHaveLength(0)
    })
})

describe('DiagramPanel settings changes', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fake = createFakePanel()
        mocked.panel = fake.panel
    })

    afterEach(() => {
        DiagramPanel.currentPanel?.dispose()
        vi.useRealTimers()
    })

    it('renders the edit in progress when a setting changes before the debounce fires', () => {
        open(namedStateAsl('BeforeTyping'))
        typeWithoutWaiting(namedStateAsl('TypedState'))
        DiagramPanel.currentPanel!.applySettings({
            colorScheme: 'dark',
            settings: { ...DEFAULT_SETTINGS, showIcons: true },
        })
        vi.runOnlyPendingTimers()

        expect(fake.htmls).toHaveLength(2)
        expect(fake.htmls[fake.htmls.length - 1]).toContain('TypedState')
        expect(fake.htmls[fake.htmls.length - 1]).not.toContain('BeforeTyping')
        expect(fake.posts).toHaveLength(0)
    })

    it('renders the edit in progress when the color theme changes before the debounce fires', () => {
        open(namedStateAsl('BeforeTyping'))
        typeWithoutWaiting(namedStateAsl('TypedState'))
        DiagramPanel.currentPanel!.applySettings({ colorScheme: 'light', settings: DEFAULT_SETTINGS })
        vi.runOnlyPendingTimers()

        expect(fake.htmls).toHaveLength(2)
        expect(fake.htmls[fake.htmls.length - 1]).toContain('TypedState')
        expect(fake.htmls[fake.htmls.length - 1]).not.toContain('BeforeTyping')
        expect(fake.posts).toHaveLength(0)
    })
})

describe('DiagramPanel active editor sync', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fake = createFakePanel()
        mocked.panel = fake.panel
    })

    afterEach(() => {
        DiagramPanel.currentPanel?.dispose()
        vi.useRealTimers()
    })

    it('keeps the execution overlay when the previewed file regains focus mid-edit', () => {
        open(namedStateAsl('BeforeTyping'))
        DiagramPanel.currentPanel!.setHistory('{"events":[]}')
        typeWithoutWaiting(namedStateAsl('TypedState'))
        DiagramPanel.currentPanel!.syncActiveEditor({ aslContent: namedStateAsl('TypedState'), documentUri: DOCUMENT_URI })

        expect(DiagramPanel.currentPanel!.hasHistory()).toBe(true)
        expect(fake.htmls).toHaveLength(2)

        vi.runOnlyPendingTimers()

        expect(fake.htmls[fake.htmls.length - 1]).toContain('TypedState')
    })

    it('patches a pending edit in place when the previewed file regains focus mid-edit', () => {
        open(namedStateAsl('BeforeTyping'))
        typeWithoutWaiting(namedStateAsl('TypedState'))
        DiagramPanel.currentPanel!.syncActiveEditor({ aslContent: namedStateAsl('TypedState'), documentUri: DOCUMENT_URI })

        expect(fake.htmls).toHaveLength(1)

        vi.runOnlyPendingTimers()

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(1)
        expect(fake.posts[0].command).toBe('updateContent')
    })

    it('does not re-render when the previewed file regains focus unchanged', () => {
        open(namedStateAsl('Same'))
        DiagramPanel.currentPanel!.syncActiveEditor({ aslContent: namedStateAsl('Same'), documentUri: DOCUMENT_URI })

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(0)
    })

    it('drops the execution overlay when another file takes over the preview', () => {
        open(namedStateAsl('BeforeTyping'))
        DiagramPanel.currentPanel!.setHistory('{"events":[]}')
        DiagramPanel.currentPanel!.syncActiveEditor({
            aslContent: namedStateAsl('OtherState'),
            documentUri: 'file:///w/other.asl.json',
        })

        expect(DiagramPanel.currentPanel!.hasHistory()).toBe(false)
        expect(DiagramPanel.currentPanel!.documentUri).toBe('file:///w/other.asl.json')
        expect(fake.htmls[fake.htmls.length - 1]).toContain('OtherState')
    })
})

describe('DiagramPanel layout cache', () => {
    const panelCache = () => mocked.caches[0]

    beforeEach(() => {
        vi.useFakeTimers()
        fake = createFakePanel()
        mocked.panel = fake.panel
        mocked.caches.length = 0
    })

    afterEach(() => {
        DiagramPanel.currentPanel?.dispose()
        vi.useRealTimers()
    })

    it('reuses the layout when the color theme changes on an unchanged definition', () => {
        open(parallelAsl('v1'))
        DiagramPanel.currentPanel!.applySettings({ colorScheme: 'light', settings: DEFAULT_SETTINGS })

        expect(fake.htmls).toHaveLength(2)
        expect(panelCache().stats()).toEqual({ entries: 1, hits: 1, misses: 1 })
    })

    it('reuses the layout for an edit that leaves the graph unchanged', () => {
        open(parallelAsl('v1'))
        edit(parallelAsl('v2'))

        expect(fake.posts).toHaveLength(1)
        expect(panelCache().stats()).toEqual({ entries: 1, hits: 1, misses: 1 })
    })

    it('lays out a full-render fallback only once', () => {
        open(containerlessAsl('v1'))
        edit(parallelAsl('v2'))

        expect(fake.htmls).toHaveLength(2)
        expect(panelCache().stats()).toEqual({ entries: 2, hits: 1, misses: 2 })
    })

    it('reuses the plain layout when an execution overlay is cleared', () => {
        open(namedStateAsl('A'))
        DiagramPanel.currentPanel!.setHistory('{"events":[]}')
        const before = panelCache().stats()
        DiagramPanel.currentPanel!.setHistory(undefined)

        expect(panelCache().stats().hits).toBe(before.hits + 1)
        expect(panelCache().stats().misses).toBe(before.misses)
    })

    it('keeps one cache for the life of the panel', () => {
        open(parallelAsl('v1'))
        open(parallelAsl('v1'))

        expect(mocked.caches).toHaveLength(1)
        expect(panelCache().stats()).toEqual({ entries: 1, hits: 2, misses: 1 })
    })

    it('clears the cache when the panel is disposed', () => {
        open(parallelAsl('v1'))
        DiagramPanel.currentPanel!.dispose()

        expect(mocked.caches[0].stats().entries).toBe(0)

        open(parallelAsl('v1'))

        expect(mocked.caches).toHaveLength(2)
    })
})
