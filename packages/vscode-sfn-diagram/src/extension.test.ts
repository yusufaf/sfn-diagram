import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { DiagramPanel } from './DiagramPanel'
import { activate } from './extension'
import { createFakePanel, type FakePanel } from './testing/fakeWebviewPanel'

type Listener = (event: unknown) => void

const mocked = vi.hoisted(() => ({
    activeTextEditor: undefined as unknown,
    commands: new Map<string, () => unknown>(),
    listeners: {} as { activeEditor?: (editor: unknown) => void; textChange?: (event: unknown) => void },
    panel: undefined as unknown,
}))

vi.mock('vscode', () => {
    const registration = () => ({ dispose() {} })
    return {
        ViewColumn: { Two: 2 },
        commands: {
            executeCommand: () => Promise.resolve(),
            registerCommand: (id: string, callback: () => unknown) => {
                mocked.commands.set(id, callback)
                return registration()
            },
        },
        window: {
            get activeTextEditor() {
                return mocked.activeTextEditor
            },
            activeColorTheme: { kind: 2 },
            createWebviewPanel: () => mocked.panel,
            onDidChangeActiveColorTheme: registration,
            onDidChangeActiveTextEditor: (listener: Listener) => {
                mocked.listeners.activeEditor = listener
                return registration()
            },
        },
        workspace: {
            getConfiguration: () => ({ get: () => undefined }),
            onDidChangeConfiguration: registration,
            onDidChangeTextDocument: (listener: Listener) => {
                mocked.listeners.textChange = listener
                return registration()
            },
            onDidOpenTextDocument: registration,
            onDidSaveTextDocument: registration,
        },
    }
})

interface FakeDocument {
    getText(): string
    text: string
    uri: { path: string; toString(): string }
}

interface FakeEditor {
    document: FakeDocument
    viewColumn: number
}

const namedStateAsl = (stateName: string) =>
    JSON.stringify({
        StartAt: stateName,
        States: { [stateName]: { Type: 'Pass', Next: 'Done' }, Done: { Type: 'Succeed' } },
    })

function fakeEditor(path: string, text: string): FakeEditor {
    const document: FakeDocument = {
        getText() {
            return document.text
        },
        text,
        uri: { path, toString: () => `file://${path}` },
    }
    return { document, viewColumn: 1 }
}

async function previewFrom(editor: FakeEditor): Promise<void> {
    mocked.activeTextEditor = editor
    await mocked.commands.get('sfn-diagram.preview')!()
}

function focus(editor: FakeEditor): void {
    mocked.activeTextEditor = editor
    mocked.listeners.activeEditor!(editor)
}

function type(editor: FakeEditor, text: string): void {
    editor.document.text = text
    mocked.listeners.textChange!({ document: editor.document })
}

let fake: FakePanel
let context: { subscriptions: Array<{ dispose(): void }> }
let flowEditor: FakeEditor
let readmeEditor: FakeEditor

describe('preview and the active editor', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fake = createFakePanel()
        mocked.panel = fake.panel
        mocked.commands.clear()
        mocked.listeners = {}
        context = { subscriptions: [] }
        activate(context as unknown as vscode.ExtensionContext)
        flowEditor = fakeEditor('/w/flow.asl.json', namedStateAsl('FlowState'))
        readmeEditor = fakeEditor('/w/README.md', '# Hello')
    })

    afterEach(() => {
        DiagramPanel.currentPanel?.dispose()
        for (const subscription of context.subscriptions) {
            subscription.dispose()
        }
        mocked.activeTextEditor = undefined
        vi.useRealTimers()
    })

    it('leaves the diagram alone when a non-ASL file takes focus', async () => {
        await previewFrom(flowEditor)
        focus(readmeEditor)

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(0)
    })

    it('ignores edits to a non-ASL file', async () => {
        await previewFrom(flowEditor)
        focus(readmeEditor)
        type(readmeEditor, '# Hello world')
        vi.runOnlyPendingTimers()

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(0)
    })

    it('keeps the diagram when focus returns to the previewed file', async () => {
        await previewFrom(flowEditor)
        focus(readmeEditor)
        focus(flowEditor)

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(0)
    })

    it('switches to another ASL file when it takes focus', async () => {
        await previewFrom(flowEditor)
        focus(fakeEditor('/w/other.asl.json', namedStateAsl('OtherState')))

        expect(fake.htmls).toHaveLength(2)
        expect(fake.htmls[fake.htmls.length - 1]).toContain('OtherState')
    })

    it('switches to a plainly named JSON file whose content is ASL', async () => {
        await previewFrom(flowEditor)
        focus(fakeEditor('/w/statemachine.json', namedStateAsl('SniffedState')))

        expect(fake.htmls).toHaveLength(2)
        expect(fake.htmls[fake.htmls.length - 1]).toContain('SniffedState')
    })

    it('keeps reporting parse errors while the previewed file is mid-edit', async () => {
        const plainJsonEditor = fakeEditor('/w/statemachine.json', namedStateAsl('A'))
        await previewFrom(plainJsonEditor)
        type(plainJsonEditor, '{"StartAt": "A", "States": {')
        vi.runOnlyPendingTimers()

        expect(fake.posts[0]?.command).toBe('renderError')
    })

    it('refreshes the previewed file when it is edited while another file has focus', async () => {
        await previewFrom(flowEditor)
        focus(readmeEditor)
        type(flowEditor, namedStateAsl('EditedState'))
        vi.runOnlyPendingTimers()

        expect(fake.htmls).toHaveLength(1)
        expect(fake.posts).toHaveLength(1)
        expect(fake.posts[0].command).toBe('updateContent')
    })
})
