import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), runtime = createRequire(require.resolve('wrangler'))
const { Miniflare, Log, LogLevel } = runtime('miniflare'), { build } = runtime('esbuild')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'))
assert.equal(config.name, 'world-bsc-mainnet')
// Keep this rollback regression independent of the enabled production assets.
let assetsDirectory = 'dist'
if (JSON.parse(fs.readFileSync('config/networks/mainnet.json', 'utf8')).mainnetEnabled) {
  const { build: buildAssets } = await import('vite')
  assetsDirectory = 'work/mainnet-disabled-assets'
  await buildAssets({ plugins: [{ name: 'disabled-mainnet-test-fixture', enforce: 'pre', transform(source, id) {
    if (id.replaceAll('\\', '/').endsWith('/config/networks/mainnet.json')) {
      const { rpcHost, rpcSecretBinding, publicOrigin, ...profile } = JSON.parse(fs.readFileSync('config/networks/mainnet.json', 'utf8'))
      return JSON.stringify({ ...profile, mainnetEnabled: false })
    }
  } }], build: { outDir: assetsDirectory }, logLevel: 'silent' })
}
const bundle = await build({ entryPoints: [config.main], alias: config.alias, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
const worker = new Miniflare({ host: '127.0.0.1', port: 18881, log: new Log(LogLevel.NONE), workers: [{ config: {
  name: config.name, compatibilityDate: config.compatibility_date,
  manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
  env: { ASSETS: { type: 'assets' }, WORLD_NETWORK: { type: 'text', value: 'mainnet' }, MAINNET_ENABLED: { type: 'text', value: 'false' } },
  assets: { directory: assetsDirectory, hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first, notFoundHandling: config.assets.not_found_handling },
} }] })
let browser
try {
  await worker.ready
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' })
  fs.mkdirSync('test-results/screenshots', { recursive: true })
  const origin = 'http://127.0.0.1:18881', results = []
  for (const [device, viewport] of [['desktop', { width: 1440, height: 960 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'en-US' })
    await context.addInitScript(() => {
      window.__writeRequests = []
      window.ethereum = { request: async ({ method }) => {
        if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111']
        if (method === 'eth_chainId') return '0x38'
        window.__writeRequests.push(method); throw new Error('Disabled test wallet')
      } }
    })
    const page = await context.newPage(), worldReads = [], errors = []
    page.on('request', request => { if (/\/(?:api\/|rpc(?:$|\?))/.test(request.url())) worldReads.push(new URL(request.url()).pathname) })
    page.on('pageerror', error => errors.push(error.message))
    for (const language of ['en', 'zh-CN']) {
      const response = await page.goto(origin + '/?lang=' + language)
      assert.equal(response.status(), 200)
      await page.getByRole('heading', { name: 'Coming Soon' }).waitFor()
      assert.equal(await page.locator('.coming-soon-actions button:disabled').count(), 8)
      assert.equal(await page.locator('html').getAttribute('lang'), language)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      await page.screenshot({ path: `test-results/screenshots/mainnet-disabled-${device}-${language}.png`, fullPage: true })
      results.push({ device, language, status: 200, disabledActions: 8 })
    }
    assert.equal((await page.evaluate(() => window.__writeRequests)).length, 0)
    assert.equal(worldReads.length, 0); assert.deepEqual(errors, [])
    await context.close()
  }
  assert.equal((await fetch(origin + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId' }) })).status, 503)
  assert.equal((await fetch(origin + '/api/leaderboard')).status, 503)
  assert.equal((await fetch(origin + '/unconfigured/spa')).status, 200)
  fs.writeFileSync('test-results/mainnet-browser.json', JSON.stringify({ results, worldReads: 0, writeRequests: 0, secretsConfigured: false }, null, 2) + '\n')
  console.log('PASS: mainnet workerd preview, Desktop/Mobile, English/Chinese, 8 disabled actions, no world RPC or wallet writes, safe missing-secret responses.')
} finally { await browser?.close(); await worker.dispose() }
