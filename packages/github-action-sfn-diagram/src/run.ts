import * as core from '@actions/core'
import * as github from '@actions/github'
import { minimatch } from 'minimatch'
import { generateDiff, generateMermaid } from 'sfn-diagram'
import type { AslDefinition, ThemeOption } from 'sfn-diagram'

const COMMENT_PREFIX = '<!-- sfn-diagram-action:'

interface GetFileAtRefParams {
    octokit: ReturnType<typeof github.getOctokit>
    owner: string
    path: string
    ref: string
    repo: string
}

function isAslDefinition(obj: unknown): obj is AslDefinition {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'StartAt' in obj &&
        'States' in obj &&
        typeof (obj as Record<string, unknown>).StartAt === 'string'
    )
}

function parseAsl(content: string): AslDefinition | null {
    try {
        const parsed: unknown = JSON.parse(content)
        return isAslDefinition(parsed) ? parsed : null
    } catch {
        return null
    }
}

async function getFileAtRef(params: GetFileAtRefParams): Promise<string | null> {
    const { octokit, owner, path, ref, repo } = params
    try {
        const response = await octokit.rest.repos.getContent({ owner, path, ref, repo })
        const data = response.data
        if (Array.isArray(data) || data.type !== 'file') return null
        return Buffer.from(data.content, 'base64').toString('utf-8')
    } catch {
        return null
    }
}

function matchesPatterns(filepath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => minimatch(filepath, pattern, { matchBase: true }))
}

function formatStateList(names: string[]): string {
    return names.map((name) => `\`${name}\``).join(', ')
}

export async function run(): Promise<void> {
    const token = core.getInput('github-token', { required: true })
    const aslGlobRaw = core.getInput('asl-glob') || '**/*.asl.json,**/*.asl'
    const commentTag = core.getInput('comment-tag') || 'sfn-diagram-preview'
    const themeInput = core.getInput('theme') || 'light'
    const theme = (themeInput === 'dark' ? 'dark' : 'light') as ThemeOption

    const patterns = aslGlobRaw.split(',').map((pattern) => pattern.trim())
    const { context } = github

    if (!context.payload.pull_request) {
        core.info('Not a pull_request event — skipping')
        return
    }

    const pr = context.payload.pull_request as {
        base: { sha: string }
        head: { sha: string }
        number: number
    }

    const owner = context.repo.owner
    const repo = context.repo.repo
    const pullNumber = pr.number
    const baseSha = pr.base.sha
    const headSha = pr.head.sha

    const octokit = github.getOctokit(token)

    const { data: changedFiles } = await octokit.rest.pulls.listFiles({
        owner,
        pull_number: pullNumber,
        repo,
    })

    const aslFiles = changedFiles.filter(
        (file) => file.status !== 'unchanged' && matchesPatterns(file.filename, patterns),
    )

    if (aslFiles.length === 0) {
        core.info('No ASL files changed in this PR')
        return
    }

    const sections: string[] = []

    for (const file of aslFiles) {
        const { filename, status } = file

        const beforeContent =
            status === 'added'
                ? null
                : await getFileAtRef({ octokit, owner, path: filename, ref: baseSha, repo })

        const afterContent =
            status === 'removed'
                ? null
                : await getFileAtRef({ octokit, owner, path: filename, ref: headSha, repo })

        const beforeAsl = beforeContent ? parseAsl(beforeContent) : null
        const afterAsl = afterContent ? parseAsl(afterContent) : null

        if (!beforeAsl && !afterAsl) {
            core.info(`Skipping ${filename}: not a valid ASL definition`)
            continue
        }

        let section = `### \`${filename}\`\n\n`

        if (!afterAsl && beforeAsl) {
            section += '> ⚠️ **File deleted**\n\n'
            const { code } = generateMermaid({ aslDefinition: beforeAsl })
            section += `<details>\n<summary>📊 Before diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`
        } else if (afterAsl && !beforeAsl) {
            section += '> ✨ **New file**\n\n'
            const { code } = generateMermaid({ aslDefinition: afterAsl })
            section += `<details>\n<summary>📊 Diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`
        } else if (afterAsl && beforeAsl) {
            const diff = generateDiff({ after: afterAsl, before: beforeAsl, theme })
            const { added, modified, removed, unchanged } = diff.metadata

            const rows: string[] = []
            if (added.length > 0) rows.push(`| ➕ Added | ${formatStateList(added)} |`)
            if (modified.length > 0) rows.push(`| ✏️ Modified | ${formatStateList(modified)} |`)
            if (removed.length > 0) rows.push(`| ❌ Removed | ${formatStateList(removed)} |`)
            if (rows.length === 0) {
                rows.push(`| ✅ No changes | ${unchanged.length} state${unchanged.length !== 1 ? 's' : ''} unchanged |`)
            }

            section += `| | States |\n|---|---|\n${rows.join('\n')}\n\n`

            const { code } = generateMermaid({ aslDefinition: afterAsl })
            section += `<details>\n<summary>📊 Current diagram</summary>\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n</details>\n`
        }

        sections.push(section)
    }

    if (sections.length === 0) {
        core.info('No valid ASL definitions found in changed files')
        return
    }

    const marker = `${COMMENT_PREFIX}${commentTag}-->`
    const body = [
        marker,
        '## 🔀 Step Functions Diagram Changes',
        '',
        sections.join('\n---\n\n'),
        '',
        '*Generated by [sfn-diagram](https://github.com/yusufaf/sfn-diagram)*',
    ].join('\n')

    const { data: existingComments } = await octokit.rest.issues.listComments({
        issue_number: pullNumber,
        owner,
        repo,
    })

    const existing = existingComments.find((comment) => comment.body?.startsWith(marker))

    if (existing) {
        await octokit.rest.issues.updateComment({
            body,
            comment_id: existing.id,
            owner,
            repo,
        })
        core.info(`Updated existing PR comment #${existing.id}`)
    } else {
        await octokit.rest.issues.createComment({
            body,
            issue_number: pullNumber,
            owner,
            repo,
        })
        core.info('Created new PR comment')
    }
}
