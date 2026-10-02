import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { documentLink, renderWhitepaper, whitepaperPath, excludeCanonicalWhitepaper } from '../scripts/whitepaper'
import WhitepaperPage from '../src/WhitepaperPage'

const markdown = readFileSync(whitepaperPath, 'utf8')
describe('Published whitepaper', () => {
  it('renders the canonical source title and all protocol sections', async () => {
    const html = await renderWhitepaper(markdown)
    expect(html).toContain('<h1 id="world">WORLD</h1>')
    expect(html).toContain('An Autonomous On-Chain Territorial Economy')
    expect(html).toContain('Whitepaper v1.0')
    expect(html.match(/<h2 /g)).toHaveLength(15)
    expect(html).toContain('The rules are fixed. The outcomes are not.')
  })
  it('renders mathematical expressions as accessible MathML and typeset HTML', async () => {
    const html = await renderWhitepaper(markdown)
    expect(html.match(/class="katex-display"/g)).toHaveLength(5)
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"')
    expect(html).not.toContain('katex-error')
  })
  it('preserves tables, code and a readable Mermaid source without a remote renderer', async () => {
    const html = await renderWhitepaper(markdown)
    expect(html.match(/<table>/g)).toHaveLength(7)
    expect(html).toContain('language-mermaid')
    expect(html).toContain('quoteBuy(q)')
    expect(html).not.toMatch(/<script|<iframe|<img/)
  })
  it('resolves document links to the public source repository', () => {
    expect(documentLink('../contracts/src/WorldCoreBSCV2.sol')).toBe('https://github.com/burn-the-world/world-public/blob/main/contracts/src/WorldCoreBSCV2.sol')
    expect(documentLink('deployment.md')).toBe('https://github.com/burn-the-world/world-public/blob/main/docs/deployment.md')
    expect(documentLink('../app/config/networks/mainnet.json')).toContain('/blob/main/app/config/networks/mainnet.json')
    expect(documentLink('#world')).toBe('#world')
  })
  it('does not render source HTML or allow executable link schemes', async () => {
    expect(documentLink('javascript:void(0)')).toBe('')
    expect(documentLink('data:text/html,test')).toBe('')
    expect(await renderWhitepaper('<iframe src="https://example.com"></iframe>\n\n![image](https://example.com/image.png)')).not.toMatch(/<iframe|<img/)
  })
  it('opens external citations without granting opener access', async () => {
    const html = await renderWhitepaper('[Source](https://github.com/burn-the-world/world-public)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
  it('renders an English page with source and return links, without wallet controls', () => {
    const html = renderToStaticMarkup(<WhitepaperPage/>)
    expect(html).toContain('lang="en"')
    expect(html).toContain('View source on GitHub')
    expect(html).toContain('href="/"')
    expect(html).not.toMatch(/wallet-button|buy-amount|war-amount/)
  })
  it('keeps the three documentation entry points without changing existing URLs', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('href="./docs/V2_UI_RULES.md"')
    expect(app).toContain('href="./docs/V2_CONTRACT_INTEGRATION.md"')
    expect(app).toContain('href="/whitepaper"')
  })
  it('excludes only exact document data from network checks, never executable settings', async () => {
    const html = await renderWhitepaper(markdown)
    const code = `const article=${JSON.stringify(html)}; const deploymentBlock=133830577;`
    expect(await excludeCanonicalWhitepaper(code, html)).toBe('const article=""; const deploymentBlock=133830577;')
    await expect(excludeCanonicalWhitepaper(`const article=${JSON.stringify(html+'altered')};`, html)).rejects.toThrow()
    await expect(excludeCanonicalWhitepaper(`const a=${JSON.stringify(html)},b=${JSON.stringify(html)};`, html)).rejects.toThrow()
  })
})
