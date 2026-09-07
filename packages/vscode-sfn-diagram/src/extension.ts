import * as vscode from 'vscode'
import { ASL_CONTEXT_KEY, isAslDocument } from './aslDetection'
import { DiagramPanel } from './DiagramPanel'

const ASL_CONTEXT_UPDATE_DEBOUNCE_MS = 300

let lastAslContextValue: boolean | undefined

/**
 * Recomputes whether the given editor's document looks like an ASL definition and, if
 * the result changed, updates the `sfnDiagram.isAslDocument` context key used by the
 * `editor/title` menu's `when` clause.
 *
 * Does nothing when `editor` is `undefined` (for example while the preview webview has
 * focus) so the title-bar buttons do not flicker away from an already-open ASL tab.
 */
function updateAslContext(editor: vscode.TextEditor | undefined): void {
    if (editor === undefined) {
        return
    }

    const filename = editor.document.uri.path.split('/').pop() ?? ''
    const value = isAslDocument({ filename, text: editor.document.getText() })

    if (value === lastAslContextValue) {
        return
    }

    lastAslContextValue = value
    void vscode.commands.executeCommand('setContext', ASL_CONTEXT_KEY, value)
}

/** Reads a text document's content, preferring the active editor for the ASL definition. */
async function resolveAslContent(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor
    if (editor) {
        return editor.document.getText()
    }
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'ASL / JSON': ['json', 'asl'] },
        openLabel: 'Open',
        title: 'Select Step Functions definition',
    })
    if (!uris || uris.length === 0) {
        return undefined
    }
    const doc = await vscode.workspace.openTextDocument(uris[0])
    await vscode.window.showTextDocument(doc)
    return doc.getText()
}

export function activate(context: vscode.ExtensionContext) {
    updateAslContext(vscode.window.activeTextEditor)

    let aslContextUpdateTimer: ReturnType<typeof setTimeout> | undefined
    context.subscriptions.push({
        dispose: () => {
            if (aslContextUpdateTimer !== undefined) {
                clearTimeout(aslContextUpdateTimer)
            }
        },
    })

    const scheduleAslContextUpdate = (document: vscode.TextDocument): void => {
        const editor = vscode.window.activeTextEditor
        if (!editor || document !== editor.document) {
            return
        }
        if (aslContextUpdateTimer !== undefined) {
            clearTimeout(aslContextUpdateTimer)
        }
        // Re-reads activeTextEditor when the timer fires, rather than closing over `editor`,
        // so a tab switch during the debounce window updates the newly active editor instead
        // of overwriting its context with a stale computation for the one edited earlier.
        aslContextUpdateTimer = setTimeout(() => updateAslContext(vscode.window.activeTextEditor), ASL_CONTEXT_UPDATE_DEBOUNCE_MS)
    }

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => scheduleAslContextUpdate(document)))

    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.preview', async () => {
            const aslContent = await resolveAslContent()
            if (aslContent === undefined) {
                return
            }
            DiagramPanel.createOrShow(context.extensionUri, aslContent)
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.previewExecution', async () => {
            const aslContent = await resolveAslContent()
            if (aslContent === undefined) {
                return
            }
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'Execution history (JSON)': ['json'] },
                openLabel: 'Overlay execution',
                title: 'Select execution history',
            })
            if (!uris || uris.length === 0) {
                return
            }
            const bytes = await vscode.workspace.fs.readFile(uris[0])
            const history = new TextDecoder().decode(bytes)

            DiagramPanel.createOrShow(context.extensionUri, aslContent)
            DiagramPanel.currentPanel?.setHistory(history)
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.clearExecution', () => {
            DiagramPanel.currentPanel?.setHistory(undefined)
        })
    )

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            scheduleAslContextUpdate(event.document)

            if (!DiagramPanel.currentPanel) {
                return
            }
            const editor = vscode.window.activeTextEditor
            if (editor && event.document === editor.document) {
                DiagramPanel.currentPanel.update(editor.document.getText())
            }
        })
    )

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            updateAslContext(editor)

            if (editor && DiagramPanel.currentPanel) {
                DiagramPanel.currentPanel.syncActiveEditor(editor.document.getText())
            }
        })
    )
}

export function deactivate() {}
