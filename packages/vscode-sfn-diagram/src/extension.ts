import * as vscode from 'vscode'
import { DiagramPanel } from './DiagramPanel'

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.preview', async () => {
            const editor = vscode.window.activeTextEditor
            if (editor) {
                DiagramPanel.createOrShow(context.extensionUri, editor.document.getText())
                return
            }
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'ASL / JSON': ['json', 'asl'] },
                openLabel: 'Open',
                title: 'Select Step Functions definition',
            })
            if (!uris || uris.length === 0) {
                return
            }
            const doc = await vscode.workspace.openTextDocument(uris[0])
            await vscode.window.showTextDocument(doc)
            DiagramPanel.createOrShow(context.extensionUri, doc.getText())
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
                DiagramPanel.currentPanel.update(editor.document.getText())
            }
        })
    )
}

export function deactivate() {}
