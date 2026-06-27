import MonacoEditor from '@monaco-editor/react'

interface EditorProps {
    monacoTheme: string
    onChange: (value: string) => void
    value: string
}

export function Editor({ monacoTheme, onChange, value }: EditorProps) {
    return (
        <MonacoEditor
            height="100%"
            language="json"
            loading={<div className="editor-loading">Loading editor…</div>}
            onChange={(val) => onChange(val ?? '')}
            options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
            }}
            theme={monacoTheme}
            value={value}
        />
    )
}
