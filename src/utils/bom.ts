const BYTE_ORDER_MARK = 0xfeff;

/**
 * Drops a leading UTF-8 byte order mark. Windows editors write one, as do Windows
 * PowerShell 5.1's `Out-File -Encoding utf8` and PowerShell 7's `-Encoding utf8BOM`.
 * `readFileSync(path, 'utf-8')` and the GitHub contents API keep it, and `JSON.parse`
 * rejects it. No JSON or YAML document starts with U+FEFF as content, so stripping it
 * never changes a valid input.
 */
export function stripBom(text: string): string {
    return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}
