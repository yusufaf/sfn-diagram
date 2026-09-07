import * as vscode from 'vscode'
import { isAslFileName } from './asl'
import { DiagramPanel } from './DiagramPanel'
import { CONFIG_SECTION, resolveColorScheme, resolveSettings } from './settings'
import type { ResolvedTheme, SfnDiagramSettings } from './settings'

/** Reads the extension's current settings from VS Code configuration. */
function readSettings(): SfnDiagramSettings {
    return resolveSettings({ configuration: vscode.workspace.getConfiguration(CONFIG_SECTION) })
}

/** Reads the current VS Code color scheme (light or dark). */
function readColorScheme(): ResolvedTheme {
    return resolveColorScheme({ colorThemeKind: vscode.window.activeColorTheme.kind })
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
    context.subscriptions.push(
        vscode.commands.registerCommand('sfn-diagram.preview', async () => {
            const aslContent = await resolveAslContent()
            if (aslContent === undefined) {
                return
            }
            DiagramPanel.createOrShow({ aslContent, colorScheme: readColorScheme(), settings: readSettings() })
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

            DiagramPanel.createOrShow({ aslContent, colorScheme: readColorScheme(), settings: readSettings() })
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

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            const settings = readSettings()
            if (!settings.autoPreview) {
                return
            }
            // Skip virtual document schemes (e.g. `git:`, `output:`) so diffs and other
            // read-only copies of an ASL file don't trigger a preview of their own.
            if (document.uri.scheme !== 'file') {
                return
            }
            if (!isAslFileName({ fileName: document.fileName })) {
                return
            }
            DiagramPanel.createOrShow({
                aslContent: document.getText(),
                colorScheme: readColorScheme(),
                preserveFocus: true,
                settings,
            })
        })
    )
}

export function deactivate() {}
