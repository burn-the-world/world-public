import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import type { Plugin } from 'vite'

export const whitepaperSourceUrl = 'https://github.com/burn-the-world/world-public/blob/main/docs/WHITEPAPER.md'
export const whitepaperPath = fileURLToPath(new URL('../../docs/WHITEPAPER.md', import.meta.url))
type Node = { type: string; tagName?: string; value?: string; url?: string; properties?: Record<string, unknown>; children?: Node[] }
const walk = (node: Node, visit: (node: Node) => void) => { visit(node); node.children?.forEach(child => walk(child, visit)) }
const content = (node: Node): string => node.value ?? node.children?.map(content).join('') ?? ''

export function documentLink(url: string): string {
  if (url.startsWith('#')) return url
  const target = new URL(url, whitepaperSourceUrl)
  return ['https:', 'http:'].includes(target.protocol) ? target.href : ''
}

export async function renderWhitepaper(markdown: string): Promise<string> {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    .use(() => (tree: Node) => walk(tree, node => {
      if ((node.type === 'link' || node.type === 'definition') && node.url) node.url = documentLink(node.url)
      // No remote images or raw HTML are needed by this source document.
      if (node.type === 'image' || node.type === 'imageReference') { node.type = 'text'; node.value = ''; delete node.children }
    }))
    .use(remarkRehype)
    .use(rehypeKatex, { trust: false, strict: 'error' })
    .use(() => (tree: Node) => {
      const ids = new Map<string, number>()
      walk(tree, node => {
        if (/^h[1-6]$/.test(node.tagName ?? '')) {
          const slug = content(node).toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
          const count = ids.get(slug) ?? 0; ids.set(slug, count + 1)
          node.properties = { ...node.properties, id: count ? `${slug}-${count}` : slug }
        }
        if (node.tagName === 'a' && String(node.properties?.href ?? '').startsWith('http')) {
          node.properties = { ...node.properties, target: '_blank', rel: 'noopener noreferrer' }
        }
      })
    }).use(rehypeStringify)
  const result = await processor.process(markdown)
  if (result.messages.length) throw new Error('Invalid whitepaper mathematical notation')
  return String(result)
}

// Network validation treats only the exact compiled document literal as prose.
// References in executable code, other strings, or altered document content still fail.
export async function excludeCanonicalWhitepaper(source: string, html: string): Promise<string> {
  const ts = await import('typescript')
  const ast = ts.createSourceFile('asset.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const matches: { start: number; end: number }[] = []
  const visit = (node: import('typescript').Node) => {
    if (ts.isStringLiteralLike(node) && node.text === html) matches.push({ start: node.getStart(ast), end: node.end })
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (matches.length !== 1) throw new Error('Whitepaper asset does not contain exactly one canonical document')
  const { start, end } = matches[0]
  return source.slice(0, start) + '""' + source.slice(end)
}

export function whitepaperPlugin(): Plugin {
  const id = 'virtual:world-whitepaper', resolved = '\0' + id
  return {
    name: 'world-whitepaper',
    resolveId(source) { if (source === id) return resolved },
    async load(source) {
      if (source !== resolved) return
      this.addWatchFile(whitepaperPath)
      const markdown = await fs.readFile(whitepaperPath, 'utf8')
      return `export default ${JSON.stringify(await renderWhitepaper(markdown))};`
    },
    handleHotUpdate(ctx) {
      if (path.resolve(ctx.file) === whitepaperPath) ctx.server.ws.send({ type: 'full-reload' })
    },
  }
}
