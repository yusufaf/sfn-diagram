import * as vscode from 'vscode'
import { DiagramPanel } from './DiagramPanel'

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
            if (editor && DiagramPanel.currentPanel) {
                DiagramPanel.currentPanel.syncActiveEditor(editor.document.getText())
            }
        })
    )
}

export function deactivate() {}
