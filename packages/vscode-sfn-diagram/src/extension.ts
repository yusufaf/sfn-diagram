import * as vscode from 'vscode'
import { DiagramPanel } from './DiagramPanel'

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.preview', () => {
            const editor = vscode.window.activeTextEditor
            if (!editor) {
                vscode.window.showErrorMessage('Step Functions Diagram: no active editor')
                return
            }
            DiagramPanel.createOrShow(context.extensionUri, editor.document.getText())
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
