import type { LayoutDirection, ThemeOption } from 'sfn-diagram'
import { SAMPLE_KEYS, SAMPLE_LABELS } from '../samples'
import type { SampleKey } from '../samples'

export type Mode = 'definition' | 'execution'

interface ToolbarProps {
    format: 'mermaid' | 'svg'
    layout: LayoutDirection
    mode: Mode
    onFormatChange: (format: 'mermaid' | 'svg') => void
    onLayoutChange: (layout: LayoutDirection) => void
    onModeChange: (mode: Mode) => void
    onSampleSelect: (key: SampleKey) => void
    onThemeChange: (theme: ThemeOption) => void
    theme: ThemeOption
}

export function Toolbar({
    format,
    layout,
    mode,
    onFormatChange,
    onLayoutChange,
    onModeChange,
    onSampleSelect,
    onThemeChange,
    theme,
}: ToolbarProps) {
    return (
        <div className="toolbar">
            <span className="toolbar-title">sfn-diagram</span>

            <label className="toolbar-group">
                Sample:
                <select onChange={(e) => onSampleSelect(e.target.value as SampleKey)}>
                    {SAMPLE_KEYS.map((key) => (
                        <option key={key} value={key}>
                            {SAMPLE_LABELS[key]}
                        </option>
                    ))}
                </select>
            </label>

            <label className="toolbar-group">
                Mode:
                <select onChange={(e) => onModeChange(e.target.value as Mode)} value={mode}>
                    <option value="definition">Definition</option>
                    <option value="execution">Execution overlay</option>
                </select>
            </label>

            <label className="toolbar-group">
                Theme:
                <select onChange={(e) => onThemeChange(e.target.value as ThemeOption)} value={theme as string}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                </select>
            </label>

            <label className="toolbar-group">
                Layout:
                <select
                    onChange={(e) => onLayoutChange(e.target.value as LayoutDirection)}
                    value={layout}
                >
                    <option value="TB">Top → Bottom</option>
                    <option value="LR">Left → Right</option>
                    <option value="RL">Right → Left</option>
                    <option value="BT">Bottom → Top</option>
                </select>
            </label>

            <label className="toolbar-group">
                Format:
                <select
                    onChange={(e) => onFormatChange(e.target.value as 'mermaid' | 'svg')}
                    value={format}
                >
                    <option value="svg">SVG</option>
                    <option value="mermaid">Mermaid</option>
                </select>
            </label>
        </div>
    )
}
