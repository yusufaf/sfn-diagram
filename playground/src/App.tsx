import { useState } from 'react'
import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { Toolbar } from './components/Toolbar'
import { SAMPLES } from './samples'

type Format = 'mermaid' | 'svg'

export function App() {
    const [asl, setAsl] = useState(SAMPLES.helloWorld)
    const [format, setFormat] = useState<Format>('svg')
    const [layout, setLayout] = useState<LayoutDirection>('TB')
    const [theme, setTheme] = useState<ThemeOption>('light')

    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs-light'

    return (
        <div className="app" data-theme={theme}>
            <Toolbar
                format={format}
                layout={layout}
                onFormatChange={setFormat}
                onLayoutChange={setLayout}
                onSampleSelect={setAsl}
                onThemeChange={setTheme}
                theme={theme}
            />
            <div className="panes">
                <div className="editor-pane">
                    <Editor monacoTheme={monacoTheme} onChange={setAsl} value={asl} />
                </div>
                <div className="preview-pane">
                    <Preview asl={asl} format={format} layout={layout} theme={theme} />
                </div>
            </div>
        </div>
    )
}
