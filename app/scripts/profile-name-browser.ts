/** Production-bundle Profile acceptance on an isolated localhost chain. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createWalletClient, http, parseUnits, encodeFunctionData } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, deployWorld, LOCAL_MNEMONIC } from './anvil'
import { freshLeaderboardFixture } from './leaderboard-fixture'
import { syncLeaderboard } from '../worker/leaderboardIndex'
import { leaderboardSnapshot } from '../src/leaderboard'
import { serializeData } from '../src/dataCodec'
import { createWorldReader, executeWorldAction } from '../src/chain'

const baseline = process.argv.includes('--baseline')
const label = baseline ? 'before' : 'after', output = `test-results/profile-name-${label}.json`
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const env = await startAnvil(18581)
let browser: any, debugPage: any, server: ReturnType<typeof createServer> | undefined
const report: any = { scope: 'Local Anvil + production assets; upstream counts are local proxy counts, not public NodeReal CU', samples: [], checks: [], receipts: [] }
const save = () => fs.writeFileSync(output, JSON.stringify(report, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))
fs.mkdirSync('test-results/screenshots', { recursive: true })
try {
  const d = await deployWorld(env), a = mnemonicToAccount(LOCAL_MNEMONIC)
  const wallet = createWalletClient({ account: a, chain: env.chain, transport: http(env.rpcUrl) })
  const reader = createWorldReader({ chainId: 31359, rpcUrl: env.rpcUrl, nativeSymbol: 'BNB', deploymentAddress: d.deploymentAddress, deploymentBlock: d.deploymentBlock, recentBlockWindow: 5000n })
  const buy = parseUnits('100', 18)
  await executeWorldAction(reader, wallet, a.address, { kind: 'buy', amount: buy, quotedCost: await reader.quoteBuy(buy) })
  await executeWorldAction(reader, wallet, a.address, { kind: 'approve', amount: buy })
  const legacyLogo = 'https://profile-assets.example/legacy.svg', legacyWebsite = 'https://legacy.example/land'
  for (const id of [1, 7]) {
    const land = await reader.readLand(id)
    await executeWorldAction(reader, wallet, a.address, { kind: 'attack', id, expectedEpoch: land.epoch, expectedResistanceRaw: land.resistanceRaw, expectedLastResistanceUpdate: land.lastResistanceUpdate, amount: parseUnits('1', 18) })
    const hash = await wallet.writeContract({ address: d.profileAddress, abi: d.artifacts.WorldLandProfileBSCV2.abi, functionName: 'setProfile', args: [BigInt(id), 1n, id === 1 ? 'Crown Fixture' : 'Rabbit Hole', legacyLogo + '?land=' + id, legacyWebsite] })
    await env.client.waitForTransactionReceipt({ hash })
  }
  // A real ended reign and a second LIVE epoch must coexist in the production UI.
  const seven = await reader.readLand(7)
  await executeWorldAction(reader, wallet, a.address, { kind: 'attack', id: 7, expectedEpoch: seven.epoch,
    expectedResistanceRaw: seven.resistanceRaw, expectedLastResistanceUpdate: seven.lastResistanceUpdate, amount: parseUnits('2', 18) })
  await wallet.writeContract({ address: d.profileAddress, abi: d.artifacts.WorldLandProfileBSCV2.abi, functionName: 'setProfile',
    args: [7n, 2n, 'Rabbit Hole', legacyLogo + '?land=7', legacyWebsite] }).then(hash => env.client.waitForTransactionReceipt({ hash }))
  await env.client.request({ method: 'anvil_mine', params: ['0x14'] } as never)
  const leaderboard = leaderboardSnapshot((await syncLeaderboard(reader, await freshLeaderboardFixture(reader))).checkpoint)
  let leaderboardHttp = 0
  const folder = path.resolve(`work/profile-name-${label}`)
  const origin = 'http://127.0.0.1:5192'
  // A before measurement must use assets captured before editing, not rebuild new code.
  if (baseline) assert(fs.existsSync(folder + '/index.html'), 'Capture the baseline assets before changing source')
  else {
    const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', folder], { stdio: 'inherit', env: { ...process.env,
      VITE_CHAIN_ID: '31359', VITE_RPC_URL: origin + '/rpc', VITE_NATIVE_SYMBOL: 'BNB', VITE_DEPLOYMENT_ADDRESS: d.deploymentAddress,
      VITE_CORE_ADDRESS: d.coreAddress, VITE_TOKEN_ADDRESS: d.tokenAddress, VITE_PROFILE_ADDRESS: d.profileAddress, VITE_DEPLOYMENT_BLOCK: String(d.deploymentBlock), VITE_LOCAL_TEST_WALLET: 'false' } })
    assert.equal(build.status, 0)
  }
  let counts = { http: 0, rpc: 0, profileCalls: 0, profileHttp: 0, upstreamHttp: 0 }
  const selector = encodeFunctionData({ abi: d.artifacts.WorldLandProfileBSCV2.abi, functionName: 'getCurrentProfile', args: [1n] }).slice(2, 10)
  server = createServer(async (req, res) => {
    if (req.url === '/api/leaderboard') { leaderboardHttp++; res.setHeader('content-type', 'application/json'); res.setHeader('x-world-stale', 'false'); res.end(serializeData(leaderboard)); return }
    if (req.url === '/rpc' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), parsed = JSON.parse(body), items = Array.isArray(parsed) ? parsed : [parsed]
      counts.http++; counts.upstreamHttp++; counts.rpc += items.length
      let profileCalls = 0
      for (const item of items) if (item.method === 'eth_call') profileCalls += String(item.params?.[0]?.data || '').split(selector).length - 1
      counts.profileCalls += profileCalls; if (profileCalls) counts.profileHttp++
      try { const r = await fetch(env.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); res.setHeader('content-type', 'application/json'); res.end(await r.text()) }
      catch { res.statusCode = 503; res.end('{}') }
      return
    }
    const url = new URL(req.url || '/', origin), file = path.resolve(folder, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/plain; charset=utf-8'); res.end(fs.readFileSync(file))
  })
  await new Promise<void>(resolve => server!.listen(5192, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  async function context(withWallet = false) {
    const c = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1040 } })
    let images = 0
    await c.route('https://profile-assets.example/**', async (r: any) => { images++; await r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>' }) })
    // Pass plain JavaScript so tsx's function-name helpers cannot leak into the browser.
    if (withWallet) await c.addInitScript({ content: `(() => {
      const rpc = ${JSON.stringify(origin + '/rpc')}, account = ${JSON.stringify(a.address)};
      let authorized = false; const listeners = new Map(); let serial = 0
      window.ethereum = { on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn) }, removeListener: (event, fn) => listeners.get(event)?.delete(fn), request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') authorized = true
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return authorized ? [account] : []
        if (method === 'eth_chainId') return '0x7a7f'
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++serial, method, params }) }); const data = await r.json()
        if (data.error) throw Object.assign(new Error(data.error.message), { code: data.error.code }); return data.result
      } }
    })()` })
    return { c, images: () => images }
  }
  for (let i = 0; i < 5; i++) {
    const ctx = await context(), p = await ctx.c.newPage(); counts = { http: 0, rpc: 0, profileCalls: 0, profileHttp: 0, upstreamHttp: 0 }
    await p.goto(origin + '/?lang=en'); await p.waitForFunction(() => performance.getEntriesByName('world:profiles-ready').length > 0)
    await p.waitForTimeout(150)
    report.samples.push({ ...counts, externalImageHttp: ctx.images(), ...(await p.evaluate(() => ({ mapMs: performance.getEntriesByName('world:snapshot-ready')[0].startTime, profilesMs: performance.getEntriesByName('world:profiles-ready')[0].startTime }))) })
    assert.equal(await p.locator('[data-land-id]').count(), 50)
    await ctx.c.close()
  }
  report.bundle = fs.readdirSync(folder + '/assets').filter(x => x.endsWith('.js')).map(x => ({ name: x, bytes: fs.statSync(folder + '/assets/' + x).size }))
  if (!baseline) {
    const ctx = await context(true), page = await ctx.c.newPage(); debugPage = page; page.setDefaultTimeout(20000)
    const ready = () => page.waitForFunction(() => performance.getEntriesByName('world:profiles-ready').length > 0 && !document.querySelector('.status-dot.loading'))
    await page.goto(origin + '/?lang=en'); await ready(); await page.getByRole('button', { name: 'Connect Wallet', exact: true }).click()
    await page.waitForSelector('.wallet-connected'); await ready()
    await page.getByLabel('Find LAND', { exact: true }).fill('1'); await page.getByRole('button', { name: 'Go to LAND', exact: true }).click()
    await page.getByRole('tab', { name: 'LAND Name', exact: true }).click()
    assert.equal(await page.locator('.profile-form input').count(), 1)
    assert.equal(await page.locator('#profile-logo,#profile-website,img,.wm-canvas image').count(), 0)
    const saveName = async (name: string, buttonName = 'Save') => {
      await page.locator('#profile-name').fill(name); const old = await page.locator('.notice.status').innerText().catch(() => '')
      await page.locator('.profile-form').getByRole('button', { name: buttonName, exact: true }).click()
      await page.waitForFunction((previous: string) => { const s = document.querySelector('.notice.status')?.textContent; return s && s !== previous && /0x[0-9a-f]{64}/i.test(s) && !document.querySelector('.status-dot.loading') }, old)
      const tx = (await page.locator('.notice.status').innerText()).match(/0x[0-9a-f]{64}/i)![0]
      const receipt = await env.client.getTransactionReceipt({ hash: tx }); assert.equal(receipt.status, 'success'); report.receipts.push({ action: 'name', hash: tx })
      const raw = await env.client.readContract({ address: d.profileAddress, abi: d.artifacts.WorldLandProfileBSCV2.abi, functionName: 'getCurrentProfile', args: [1n] }) as any
      assert.equal(raw[3], name); assert.equal(raw[4], legacyLogo + '?land=1'); assert.equal(raw[5], legacyWebsite)
    }
    await saveName('Rabbit Hole'); report.checks.push('Real name save preserves legacy image and website')
    await page.screenshot({ path: 'test-results/screenshots/profile-name-desktop-en.png', fullPage: true })
    await saveName(''); assert.equal(await page.locator('.land-detail h2').innerText(), 'LAND #1'); report.checks.push('Empty name falls back to LAND #1 without clearing legacy fields')
    const oldLand = await reader.readLand(1)
    await executeWorldAction(reader, wallet, a.address, { kind: 'attack', id: 1, expectedEpoch: oldLand.epoch, expectedResistanceRaw: oldLand.resistanceRaw, expectedLastResistanceUpdate: oldLand.lastResistanceUpdate, amount: parseUnits('2', 18) })
    await page.getByRole('button', { name: 'Refresh World', exact: true }).click(); await ready()
    await page.waitForFunction(() => document.querySelector('.land-meta div:nth-child(2) dd')?.textContent === '2')
    await saveName('After Epoch'); report.checks.push('Self takeover: recover hidden old fields from canonical ProfileUpdated events')
    await page.getByRole('button', { name: '中文', exact: true }).click(); await saveName('兔子洞', '保存')
    await page.waitForFunction(() => document.querySelector('.land-detail h2')?.textContent === '兔子洞')
    await page.screenshot({ path: 'test-results/screenshots/profile-name-desktop-zh.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    for (const language of ['zh-CN', 'en']) {
      await page.getByRole('button', { name: language === 'en' ? 'EN' : '中文', exact: true }).click()
      await page.locator('#profile-name').scrollIntoViewIfNeeded(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `test-results/screenshots/profile-name-mobile-${language}.png` })
    }
    report.checks.push('Desktop/Mobile and zh-CN/en name-only editor; no overflow')
    await page.getByRole('button', { name: 'Close LAND Details', exact: true }).click()
    await page.getByRole('button', { name: 'Show All 50 LAND', exact: true }).click()
    assert.equal(await page.locator('#land-directory button').count(), 50); assert.equal(await page.locator('#land-directory img,#land-directory a,.wm-canvas image').count(), 0)
    assert.match(await page.locator('#land-directory button').nth(6).innerText(), /#7\s+Rabbit Hole\s+0x/i)
    assert.match(await page.locator('#land-directory button').nth(22).innerText(), /#23\s+LAND #23\s+Unclaimed/)
    await page.locator('#land-directory button').nth(6).click()
    assert.equal(await page.locator('#land-directory button').nth(6).getAttribute('aria-pressed'), 'true')
    await page.waitForFunction(() => document.querySelector('.land-detail h2')?.textContent === 'Rabbit Hole')
    await page.getByRole('button', { name: 'Close LAND Details', exact: true }).click()
    assert.equal(ctx.images(), 0); report.checks.push('Map, list and detail make zero external Profile image requests')
    await page.screenshot({ path: 'test-results/screenshots/profile-name-mobile-map.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1040 })
    assert.equal(await page.locator('.main-nav').getByRole('button', { name: 'History', exact: true }).count(), 0)
    await page.locator('.main-nav').getByRole('button', { name: 'Leaderboard', exact: true }).click()
    await page.waitForSelector('.ranking-list')
    assert.equal(await page.locator('.ranking-categories').count(), 0)
    assert.equal(await page.locator('#leaderboard-title').innerText(), 'RETURN LEADERBOARD')
    assert.equal(await page.locator('.ranking-row').count(), 3)
    assert.equal(await page.locator('.reign-status.final').count(), 1)
    assert.equal(await page.locator('.reign-status.live').count(), 2)
    assert.match(await page.locator('.ranking-row').filter({ has: page.locator('.reign-status.final') }).innerText(), /LAND #7/)
    assert.match(await page.locator('.ranking-value').first().innerText(), /×$/)
    for (const [language, width] of [['en', 1440], ['zh-CN', 1440], ['en', 390], ['zh-CN', 390]] as const) {
      await page.getByRole('button', { name: language === 'en' ? 'EN' : '中文', exact: true }).click()
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1040 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: `test-results/screenshots/leaderboard-${width === 390 ? 'mobile' : 'desktop'}-${language}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    await page.locator('.main-nav').getByRole('button', { name: 'World', exact: true }).click()
    await page.locator('.main-nav').getByRole('button', { name: 'Leaderboard', exact: true }).click()
    assert.equal(leaderboardHttp, 1); report.checks.push('Real chain Return Leaderboard: distinct self epochs, LIVE/FINAL, zh/en, Desktop/Mobile, no History and navigation uses one cached request')
    await ctx.c.close()
  }
  report.passed = true; save(); console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  if (debugPage && !debugPage.isClosed()) {
    await debugPage.screenshot({ path: 'test-results/screenshots/profile-name-debug.png', fullPage: true }).catch(() => {})
    report.uiFailure = await debugPage.locator('.notice-stack').innerText().catch(() => '')
  }
  save(); throw error
}
finally { await browser?.close(); await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); await stopAnvil(env.child) }
