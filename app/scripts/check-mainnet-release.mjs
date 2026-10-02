// Read-only mainnet acceptance in local workerd. No real wallet or private RPC URL.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), runtime = createRequire(require.resolve('wrangler'))
const { Miniflare, Log, LogLevel, Response: RuntimeResponse } = runtime('miniflare'), { build } = runtime('esbuild')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('dist/network.json', 'utf8'))
assert.equal(config.name, 'world-bsc-mainnet'); assert.equal(config.vars.MAINNET_ENABLED, 'true')
assert.equal(manifest.chainId, 56); assert.equal(manifest.mainnetEnabled, true)
const origin = 'http://127.0.0.1:18882', publicRpc = 'https://world-bsc-mainnet.world-bsc-dapp-burn-v2.workers.dev/rpc'
const bundle = await build({ entryPoints: [config.main], alias: config.alias, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
const methods = new Set(); let upstreamCalls = 0, browser
const worker = new Miniflare({ host: '127.0.0.1', port: 18882, log: new Log(LogLevel.NONE), workers: [{ config: {
  name: config.name, compatibilityDate: config.compatibility_date,
  manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
  env: { ASSETS: { type: 'assets' }, WORLD_NETWORK: { type: 'text', value: 'mainnet' }, MAINNET_ENABLED: { type: 'text', value: 'true' },
    NODEREAL_MAINNET_RPC_URL: { type: 'text', value: 'https://bsc-mainnet.nodereal.io/v1/test-only-placeholder' } },
  assets: { directory: 'dist', hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first, notFoundHandling: config.assets.not_found_handling },
}, dev: { outboundService: { type: 'fetcher', handler: async request => {
  assert.equal(new URL(request.url).hostname, 'bsc-mainnet.nodereal.io')
  const body = await request.text(), input = JSON.parse(body)
  for (const call of Array.isArray(input) ? input : [input]) { assert(!/send|sign/i.test(call.method)); methods.add(call.method) }
  upstreamCalls++
  let response
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetch(publicRpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) }); break }
    catch { if (attempt === 2) throw new Error('Public read-only RPC unavailable') }
  }
  return new RuntimeResponse(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } })
} } } }] })
const decode = text => JSON.parse(text, (key, value) => value && typeof value === 'object' && '$worldBigint' in value ? BigInt(value.$worldBigint) : value)
try {
  await worker.ready
  const results = {}
  for (const path of ['world-snapshot', 'profiles', 'constants', 'leaderboard']) {
    const response = await fetch(`${origin}/api/${path}`)
    assert.equal(response.status, 200, path)
    results[path] = decode(await response.text())
  }
  assert.equal(results['world-snapshot'].lands.length, 50)
  assert.equal(Object.keys(results.profiles).length, 50)
  assert.equal(results['world-snapshot'].addresses.core.toLowerCase(), manifest.coreAddress.toLowerCase())
  assert.equal(results.leaderboard.chainId, 56)
  assert.equal(results.leaderboard.core.toLowerCase(), manifest.coreAddress.toLowerCase())
  const browserResults = []
  browser = await chromium.launch({ headless: true, channel: 'msedge' })
  for (const [device, viewport] of [['desktop', { width: 1440, height: 960 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const language of ['en', 'zh-CN']) {
      assert.equal((await page.goto(origin + '/?lang=' + language)).status(), 200)
      await page.waitForFunction(() => document.querySelector('.live-indicator .online'))
      assert.equal(await page.locator('[data-land-id]').count(), 50)
      assert.equal(await page.getByRole('heading', { name: 'Coming Soon' }).count(), 0)
      assert.equal(await page.locator('html').getAttribute('lang'), language)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
      fs.mkdirSync('test-results/screenshots', { recursive: true })
      await page.screenshot({ path: `test-results/screenshots/mainnet-live-${device}-${language}.png`, fullPage: true })
      browserResults.push({ device, language, LAND: 50, comingSoon: false })
    }
    assert.deepEqual(errors, []); await context.close()
  }
  const report = { readOnly: true, chainId: 56, sharedEndpoints: 4, LAND: 50, profiles: 50,
    indexedThroughBlock: String(results.leaderboard.indexedThroughBlock), leaders: results.leaderboard.leaders.length,
    upstreamCalls, methods: [...methods], browserResults, walletWrites: 0 }
  fs.writeFileSync('test-results/mainnet-release.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { await browser?.close(); await worker.dispose() }
