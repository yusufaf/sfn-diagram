import { useEffect, useState } from 'react'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { Editor } from './Editor'
import { Preview } from './Preview'
import { Toolbar } from './Toolbar'
import type { Mode } from './Toolbar'
import { SAMPLE_HISTORIES, SAMPLES } from './samples'
import type { SampleKey } from './samples'

type Format = 'mermaid' | 'svg'

/**
 * Read the theme Starlight has applied to the document.
 *
 * @returns The active theme, defaulting to `'light'` before hydration or when
 *   the document is unavailable.
 */
function readStarlightTheme(): ThemeOption {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function App() {
    const [asl, setAsl] = useState(SAMPLES.helloWorld)
    const [history, setHistory] = useState(SAMPLE_HISTORIES.helloWorld)
    const [format, setFormat] = useState<Format>('svg')
    const [layout, setLayout] = useState<LayoutDirection>('TB')
    const [mode, setMode] = useState<Mode>('definition')
    const [theme, setTheme] = useState<ThemeOption>(readStarlightTheme)

    // Starlight stamps its theme on <html data-theme>. Seed from it and follow
    // later changes, so switching the site theme also moves the diagram and the
    // editor rather than only the surrounding chrome. The Theme select still
    // overrides this for the current session.
    useEffect(() => {
        const root = document.documentElement
        const observer = new MutationObserver(() => setTheme(readStarlightTheme()))
        observer.observe(root, { attributeFilter: ['data-theme'], attributes: true })
        return () => observer.disconnect()
    }, [])

    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs-light'

    // Selecting a sample loads both its definition and its matching execution
    // history so the overlay mode works without further editing.
    const handleSampleSelect = (key: SampleKey) => {
        setAsl(SAMPLES[key])
        setHistory(SAMPLE_HISTORIES[key])
    }

    return (
        <div className="app" data-theme={theme}>
            <Toolbar
                format={format}
                layout={layout}
                mode={mode}
                onFormatChange={setFormat}
                onLayoutChange={setLayout}
                onModeChange={setMode}
                onSampleSelect={handleSampleSelect}
                onThemeChange={setTheme}
                theme={theme}
            />
            <div className="panes">
                <div className="editor-pane">
                    {mode === 'execution' ? (
                        <div className="editor-split">
                            <div className="editor-section">
                                <div className="editor-label">Definition (ASL)</div>
                                <div className="editor-body">
                                    <Editor monacoTheme={monacoTheme} onChange={setAsl} value={asl} />
                                </div>
                            </div>
                            <div className="editor-section">
                                <div className="editor-label">Execution history</div>
                                <div className="editor-body">
                                    <Editor
                                        monacoTheme={monacoTheme}
                                        onChange={setHistory}
                                        value={history}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <Editor monacoTheme={monacoTheme} onChange={setAsl} value={asl} />
                    )}
                </div>
                <div className="preview-pane">
                    <Preview
                        asl={asl}
                        format={format}
                        history={mode === 'execution' ? history : undefined}
                        layout={layout}
                        theme={theme}
                    />
                </div>
            </div>
        </div>
    )
}
