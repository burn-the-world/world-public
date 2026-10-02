import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const network = process.argv[2] ?? 'mainnet'
assert(['mainnet', 'testnet'].includes(network), 'Select mainnet or testnet')
const publicDirectory = network === 'mainnet' ? 'public-mainnet' : 'public'
const buildDirectory = network === 'mainnet' ? 'dist' : 'dist-testnet'
const read = file => fs.readFileSync(path.join(root, file))
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const han = /\p{Script=Han}/u
const source = decode(read('src/App.tsx'))
const linked = [...new Set([...source.matchAll(/href="\.\/docs\/([^"?]+\.md)"/g)].map(match => publicDirectory + '/docs/' + match[1]))].sort()
assert(linked.length >= 2, 'No public Markdown links found')
assert(!source.includes("t('chineseDocument')"), 'Obsolete Chinese-document badge remains')
const inventory = fs.readdirSync(path.join(root, publicDirectory, 'docs')).filter(file => file.endsWith('.md')).sort().map(file => {
  const name = publicDirectory + '/docs/' + file, bytes = read(name), text = decode(bytes)
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${name}: BOM`)
  assert(!text.includes('\ufffd'), `${name}: replacement character`)
  if (linked.includes(name)) {
    assert(!han.test(text), `${name}: non-English public body`)
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue
      const target = path.resolve(root, path.dirname(name), match[1].split('#')[0])
      assert(target.startsWith(path.join(root, publicDirectory) + path.sep), `${name}: link outside public assets`)
      assert(fs.existsSync(target), `${name}: missing link ${match[1]}`)
      if (target.endsWith('.md')) assert(linked.includes(path.relative(root, target).replaceAll('\\', '/')), `${name}: links an unreviewed Markdown document`)
    }
  }
  return { file: name, bytes: bytes.length, sha256: sha256(bytes), utf8: true, bom: false, uiLinked: linked.includes(name), chinese: han.test(text) }
})
const zh = JSON.parse(decode(read('src/locales/zh-CN.json'))), en = JSON.parse(decode(read('src/locales/en.json')))
for (const key of ['copy123', 'copy124', 'copy125', 'copy126', 'copy127', 'copy128']) {
  assert(zh[key] === en[key] && !han.test(en[key]), `${key}: public link must use English in both locales`)
}
// Supplemental link labels remain bilingual; document bodies are English-only.
for (const key of ['copy136', 'copy149']) assert(zh[key] && en[key] && !han.test(en[key]), `${key}: missing bilingual link label`)
const http = []
if (process.env.WORLD_DOCS_ORIGIN) {
  for (const file of linked) {
    const urlPath = file.slice(publicDirectory.length)
    const response = await fetch(new URL(urlPath, process.env.WORLD_DOCS_ORIGIN), { headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8' } })
    const bytes = Buffer.from(await response.arrayBuffer()), type = response.headers.get('content-type')
    assert(response.status === 200, `${urlPath}: HTTP ${response.status}`)
    // Workers Static Assets serves Markdown directly; an absent disposition is normal.
    assert(/^text\/(?:plain|markdown)(?:\s*;|$)/i.test(type ?? ''), `${urlPath}: unexpected document Content-Type`)
    const charset = /charset\s*=\s*"?([^;"\s]+)/i.exec(type ?? '')?.[1]
    assert(!charset || /^utf-8$/i.test(charset), `${urlPath}: incompatible charset`)
    const disposition = response.headers.get('content-disposition')
    assert(!disposition || /^inline(?:\s*;|$)/i.test(disposition), `${urlPath}: forced download`)
    assert(bytes.equals(read(file)), `${urlPath}: source/HTTP bytes differ`)
    assert(bytes.equals(read(path.join(buildDirectory, file.slice(publicDirectory.length + 1)))), `${urlPath}: source/build bytes differ`)
    assert(!han.test(decode(bytes)), `${urlPath}: non-English response`)
    http.push({ path: urlPath, status: response.status, contentType: type, disposition: disposition ?? 'default', utf8: true, sourceAndDistByteMatch: true })
  }
}
const report = { checkedAt: new Date().toISOString(), network, inventory, linked, englishPublicDocuments: linked.length, unlinkedHistoricalDocuments: inventory.filter(item => !item.uiLinked).length, englishPrimaryDocCards: true, bilingualSupplementaryLinks: true, http }
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true })
fs.writeFileSync(path.join(root, `test-results/public-docs-audit-${network}.json`), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ network, utf8Documents: inventory.length, englishLinkedDocuments: linked.length, unlinkedHistoricalDocuments: report.unlinkedHistoricalDocuments, httpChecks: http.length }))
