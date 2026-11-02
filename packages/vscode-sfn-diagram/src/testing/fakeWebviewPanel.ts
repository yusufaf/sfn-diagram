export interface FakePanel {
    /** Every document assigned to `webview.html`, i.e. one per full render. */
    htmls: string[]
    panel: unknown
    /** Every message posted to the webview, i.e. one per patch. */
    posts: Array<{ command: string; relayoutModel?: unknown }>
}

export function createFakePanel(): FakePanel {
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
