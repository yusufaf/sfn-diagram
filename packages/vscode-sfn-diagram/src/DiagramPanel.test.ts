import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramPanel } from './DiagramPanel'
import { DEFAULT_SETTINGS } from './settings'

const mocked = vi.hoisted(() => ({ panel: undefined as unknown }))

vi.mock('vscode', () => ({
    ViewColumn: { Two: 2 },
    window: { activeTextEditor: undefined, createWebviewPanel: () => mocked.panel },
}))

interface FakePanel {
    /** Every document assigned to `webview.html`, i.e. one per full render. */
    htmls: string[]
    panel: unknown
    /** Every message posted to the webview, i.e. one per patch. */
    posts: Array<{ command: string; relayoutModel?: unknown }>
}

function createFakePanel(): FakePanel {
    const htmls: string[] = []
    const posts: FakePanel['posts'] = []
    const registration = () => ({ dispose() {} })
    const panel = {
        dispose() {},
        onDidChangeViewState: registration,
        onDidDispose: registration,
        reveal() {},
        visible: true,
        webview: {
            cspSource: 'vscode-resource:',
            set html(value: string) {
                htmls.push(value)
            },
            onDidReceiveMessage: registration,
            postMessage: (message: FakePanel['posts'][number]) => {
                posts.push(message)
                return Promise.resolve(true)
            },
        },
    }
    return { htmls, panel, posts }
}

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

let fake: FakePanel

function open(aslContent: string): void {
    DiagramPanel.createOrShow({ aslContent, colorScheme: 'dark', settings: DEFAULT_SETTINGS })
}

function edit(aslContent: string): void {
    DiagramPanel.currentPanel!.scheduleRefresh(aslContent)
    vi.runOnlyPendingTimers()
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
