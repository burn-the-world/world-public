// Real local workerd + Anvil check. The outbound test fixture never contacts NodeReal.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createWalletClient, http, parseUnits, type EIP1193Provider } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { startAnvil, stopAnvil, deployWorld, LOCAL_MNEMONIC } from './anvil'
import { createWorldReader, executeWorldAction } from '../src/chain'
import { createSharedWorld } from '../src/sharedWorld'
import { readLiveView, readLiveProfile } from '../src/liveView'
import { serializeData } from '../src/dataCodec'
import { freshLeaderboardFixture } from './leaderboard-fixture'
import { syncLeaderboard } from '../worker/leaderboardIndex'

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler'))
const { Miniflare, Log, LogLevel, Response: RuntimeResponse } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const originalFetch = globalThis.fetch
let browserHttp = 0, projectRpc: string[] = [], upstreamHttp = 0, walletRpc: string[] = []
const times: number[] = []
let cacheOutcomes: Record<string, number> = {}
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.startsWith('http://127.0.0.1:18878')) browserHttp++
  const start = performance.now(); const result = await originalFetch(input, init)
  if (url.startsWith('http://127.0.0.1:18878')) { times.push(performance.now() - start); const outcome = result.headers.get('x-world-cache'); if (outcome) cacheOutcomes[outcome] = (cacheOutcomes[outcome] ?? 0) + 1 }
  return result
}
const config = JSON.parse(fs.readFileSync('wrangler.testnet.jsonc', 'utf8'))
const bundle = await build({ entryPoints: [config.main], alias: { '@world-network': './config/networks/testnet.json' }, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
const environment = await startAnvil(18578, 31360)
const origin = 'http://127.0.0.1:18878'
let worker: any
const report: Record<string, unknown> = { chain: 'Isolated Anvil 31360', runtime: 'workerd/Miniflare', checks: [] }
const checks = report.checks as string[]
try {
  const deployed = await deployWorld(environment)
  const account = mnemonicToAccount(LOCAL_MNEMONIC)
  const localWallet = createWalletClient({ account, chain: environment.chain, transport: http(environment.rpcUrl) })
  const { multicall3Bytecode } = require(path.join(path.dirname(require.resolve('viem')), 'constants/contracts.js'))
  const multicallReceipt = await environment.client.waitForTransactionReceipt({ hash: await localWallet.deployContract({ abi: [], bytecode: multicall3Bytecode }) })
  const multicallAddress = multicallReceipt.contractAddress!
  const direct = createWorldReader({ chainId: 31360, rpcUrl: environment.rpcUrl, nativeSymbol: 'BNB',
    deploymentAddress: deployed.deploymentAddress, deploymentBlock: deployed.deploymentBlock, multicallAddress })
  const wallet = createWalletClient({ account, chain: environment.chain, transport: http(environment.rpcUrl) })
  const amount = parseUnits('100', 18)
  await executeWorldAction(direct, wallet, account.address, { kind: 'buy', amount, quotedCost: await direct.quoteBuy(amount) }, () => {})
  await executeWorldAction(direct, wallet, account.address, { kind: 'approve', amount: parseUnits('10', 18) }, () => {})
  const before = await direct.readLand(1)
  await executeWorldAction(direct, wallet, account.address, { kind: 'attack', id: 1, amount: parseUnits('10', 18), expectedEpoch: before.epoch,
    expectedResistanceRaw: before.resistanceRaw, expectedLastResistanceUpdate: before.lastResistanceUpdate }, () => {})
  await executeWorldAction(direct, wallet, account.address, { kind: 'profile', id: 1, expectedEpoch: 1n, name: 'Worker fixture' }, () => {})
  await environment.client.request({ method: 'anvil_mine', params: ['0x14'] } as never)
  const fresh = await freshLeaderboardFixture(direct)
  const localCheckpoint = (await syncLeaderboard(direct, fresh)).checkpoint
  const assetDirectory = path.resolve('work/worker-assets')
  fs.mkdirSync(assetDirectory, { recursive: true }); fs.cpSync(path.resolve('dist-testnet'), assetDirectory, { recursive: true })
  fs.mkdirSync(path.join(assetDirectory, 'data'), { recursive: true })
  fs.writeFileSync(path.join(assetDirectory, 'data/leaderboard-checkpoint.json'), serializeData(localCheckpoint))
  const runtimeConfig = (secret: boolean) => ({ host: '127.0.0.1', port: 18878, log: new Log(LogLevel.NONE), workers: [{ config: {
    name: config.name, compatibilityDate: config.compatibility_date,
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
    env: { ASSETS: { type: 'assets' }, LOCAL_WORLD_FIXTURE: { type: 'text', value: serializeData(direct.config) }, ...(secret ? { NODEREAL_RPC_URL: { type: 'text', value: 'https://bsc-testnet.nodereal.io/v1/test-only-placeholder' } } : {}) },
    assets: { directory: assetDirectory, hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first,
      notFoundHandling: config.assets.not_found_handling },
  }, dev: { outboundService: { type: 'fetcher', handler: async (request: Request) => {
    assert.equal(new URL(request.url).hostname, 'bsc-testnet.nodereal.io')
    const body = await request.text(); const parsed = JSON.parse(body)
    upstreamHttp++; projectRpc.push(...(Array.isArray(parsed) ? parsed : [parsed]).map(item => item.method))
    const response = await originalFetch(environment.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    return new RuntimeResponse(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } })
  } } } }] })
  worker = new Miniflare(runtimeConfig(false))
  await worker.ready
  const rpc = (body: unknown, method = 'POST') => fetch(origin + '/rpc', { method, headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })
  const request = { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
  assert.equal((await rpc(request)).status, 503)
  assert.equal((await fetch(origin)).status, 200)
  assert.equal((await fetch(origin + '/unmatched/spa-route')).status, 200)
  checks.push('Missing secret: /rpc returns 503; ASSETS and SPA fallback remain 200')
  await worker.dispose()
  worker = new Miniflare(runtimeConfig(true))
  await worker.ready
  assert.equal((await (await rpc(request)).json()).result, '0x7a80')
  assert.equal((await rpc(request, 'GET')).status, 405)
  assert.equal((await rpc({ ...request, method: 'eth_sendRawTransaction' })).status, 403)
  const batch = Array.from({ length: 50 }, (_, id) => ({ ...request, id }))
  const batchResult = await (await rpc(batch)).json()
  assert.equal(batchResult.length, 50)
  assert(batchResult.every((item: any) => item.result === '0x7a80'))
  checks.push('Single and 50-request batch succeed; GET and transaction submission rejected')
  const reader = createWorldReader({ chainId: 31360, rpcUrl: origin + '/rpc', nativeSymbol: 'BNB',
    deploymentAddress: deployed.deploymentAddress, deploymentBlock: deployed.deploymentBlock, multicallAddress })
  const start = performance.now()
  const snapshot = await reader.readSnapshot(account.address)
  const profiles = await reader.readProfiles(snapshot)
  assert.equal(snapshot.lands.length, 50)
  assert.equal(profiles[1].name, 'Worker fixture')
  assert.equal(snapshot.totalSupply, parseUnits('90', 18))
  assert.deepEqual(snapshot, await direct.readSnapshot(account.address))
  report.landProfileReadMs = Math.round(performance.now() - start)
  checks.push('Actual 50 LAND + valid Profile equal direct pinned chain state through Worker')
  const historical = await reader.publicClient.readContract({ address: deployed.coreAddress, abi: deployed.artifacts.WorldCoreBSCV2.abi,
    functionName: 'lands', args: [1n], blockNumber: deployed.deploymentBlock })
  assert.equal((historical as any)[0], '0x0000000000000000000000000000000000000000')
  const logs = await reader.publicClient.getLogs({ address: deployed.coreAddress, fromBlock: deployed.deploymentBlock, toBlock: snapshot.blockNumber })
  assert(logs.length > 0)
  checks.push('Historical eth_call and eth_getLogs return real isolated chain data')
  for (const name of ['V2_UI_RULES.md', 'V2_CONTRACT_INTEGRATION.md', 'REIGN_PERFORMANCE.md', 'WORLD_WHITEPAPER_V1.0_DRAFT.md']) {
    const response = await fetch(origin + '/docs/' + name)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(response.headers.get('content-disposition'), 'inline')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert(bytes.equals(fs.readFileSync(path.join('public/docs', name))))
    assert(!/\p{Script=Han}/u.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  }
  checks.push('Four public English documents: HTTP 200, UTF-8, inline, exact source bytes')
  const measurements: Record<string, unknown> = {}
  async function measure(name: string, work: () => Promise<unknown>) {
    browserHttp = 0; upstreamHttp = 0; projectRpc = []; walletRpc = []; times.length = 0; cacheOutcomes = {}
    const start = performance.now(); await work(); const duration = performance.now() - start
    const ordered = [...times].sort((a, b) => a - b)
    measurements[name] = { browserHttp, upstreamHttp, projectRpc: projectRpc.length, walletRpc: walletRpc.length, cacheOutcomes: { ...cacheOutcomes }, nodeRealCU: null,
      methods: Object.fromEntries([...new Set(projectRpc)].map(method => [method, projectRpc.filter(item => item === method).length])),
      walletMethods: Object.fromEntries([...new Set(walletRpc)].map(method => [method, walletRpc.filter(item => item === method).length])),
      elapsedMs: Math.round(duration), medianMs: Math.round(ordered[Math.floor(ordered.length / 2)] ?? 0),
      p95Ms: Math.round(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * .95) - 1)] ?? 0) }
  }
  const readerConfig = { ...direct.config, rpcUrl: origin + '/rpc' }
  const provider = { request: async (input: any) => {
    walletRpc.push(input.method)
    const response = await originalFetch(environment.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...input }) })
    const value = await response.json(); if (value.error) throw new Error('Isolated wallet read failure'); return value.result
  } } as EIP1193Provider
  let selectedProvider: EIP1193Provider | undefined = provider
  const nextReader = createWorldReader(readerConfig, { walletProvider: () => selectedProvider })
  const shared = createSharedWorld(origin, nextReader)
  let sharedState: any
  await measure('disconnectedCold50', async () => { sharedState = await shared.snapshot(); await Promise.all([shared.profiles(sharedState), shared.constants()]) })
  const disconnectedWarm = createSharedWorld(origin, nextReader)
  await measure('disconnectedWarm50', async () => { const s = await disconnectedWarm.snapshot(); await Promise.all([disconnectedWarm.profiles(s), disconnectedWarm.constants()]) })
  const warm = createSharedWorld(origin, nextReader)
  await measure('connectedWarm50', async () => { sharedState = await warm.snapshot(); await Promise.all([warm.profiles(sharedState), warm.constants(), readLiveView(nextReader, sharedState, account.address)]) })
  await measure('navigationReturn', () => Promise.all([warm.snapshot(), warm.profiles(sharedState), warm.constants()]))
  await measure('selectedLand', async () => {
    const view = await readLiveView(nextReader, sharedState, account.address, 1)
    assert.equal(view.lands[0].epoch, 1n); assert.equal((await readLiveProfile(nextReader, view, 1)).name, 'Worker fixture')
  })
  await measure('leaderboardCold', async () => {
    const value = await shared.leaderboard(); assert.equal(value.data!.leaders[0].landId, 1)
    assert.equal(value.data!.leaders[0].controllerBurnAtoms, parseUnits('10', 18))
    // Allow workerd waitUntil to finish before ending the cold cost window.
    await new Promise(resolve => setTimeout(resolve, 1500))
  })
  await measure('leaderboardWarm20', async () => {
    for (let i = 0; i < 20; i++) {
      const result = await createSharedWorld(origin, nextReader).leaderboard()
      assert(result.data); assert(result.stale === false)
    }
  })
  assert.equal((measurements['leaderboardWarm20'] as any).projectRpc, 0)
  assert.equal((await fetch(origin + '/api/history')).status, 404)
  assert.equal((await fetch(origin + '/api/reigns')).status, 404)
  const amount2 = parseUnits('20', 18)
  await measure('buy', async () => {
    const receipt = await executeWorldAction(nextReader, wallet, account.address, { kind: 'buy', amount: amount2, quotedCost: await nextReader.quoteBuy(amount2) })
    assert.equal(receipt.status, 'success')
    const view = await readLiveView(nextReader, sharedState, account.address, undefined, true)
    assert.equal(view.wallet!.balance, parseUnits('110', 18))
  })
  await executeWorldAction(nextReader, wallet, account.address, { kind: 'approve', amount: parseUnits('5', 18) })
  await measure('attack', async () => {
    const land = await nextReader.readLand(2)
    const receipt = await executeWorldAction(nextReader, wallet, account.address, { kind: 'attack', id: 2, amount: parseUnits('1',18),
      expectedEpoch: land.epoch, expectedResistanceRaw: land.resistanceRaw, expectedLastResistanceUpdate: land.lastResistanceUpdate })
    const view = await readLiveView(nextReader, sharedState, account.address, 2, true)
    assert.equal(view.lands[1].controller, account.address)
  })
  await measure('defend', async () => {
    const land = await nextReader.readLand(2)
    const receipt = await executeWorldAction(nextReader, wallet, account.address, { kind: 'defend', id: 2, amount: parseUnits('1',18),
      expectedEpoch: land.epoch, expectedResistanceRaw: land.resistanceRaw, expectedLastResistanceUpdate: land.lastResistanceUpdate })
    assert.equal(receipt.status, 'success'); await readLiveView(nextReader, sharedState, account.address, 2)
  })
  await executeWorldAction(nextReader, wallet, account.address, { kind: 'settle', id: 2 })
  await measure('claim', async () => {
    const receipt = await executeWorldAction(nextReader, wallet, account.address, { kind: 'withdraw' })
    assert.equal(receipt.status, 'success'); await readLiveView(nextReader, sharedState, account.address)
  })
  selectedProvider = { request: async () => { throw new Error('Unavailable wallet read') } } as unknown as EIP1193Provider
  await measure('walletFailureFallback', async () => { const view = await readLiveView(nextReader, sharedState, account.address, 2); assert.equal(view.lands[1].epoch, 1n) })
  assert.equal((measurements['buy'] as any).projectRpc, 0)
  assert.equal((measurements['attack'] as any).projectRpc, 0)
  assert.equal((measurements['navigationReturn'] as any).browserHttp, 0)
  assert.equal((measurements['leaderboardWarm20'] as any).projectRpc, 0)
  const repeated: number[] = []
  for (let i = 0; i < 10; i++) {
    const start = performance.now(); const sharedAgain = createSharedWorld(origin, nextReader)
    const s = await sharedAgain.snapshot(); await Promise.all([sharedAgain.profiles(s), sharedAgain.constants()]); repeated.push(performance.now() - start)
  }
  const sorted = repeated.sort((a, b) => a - b)
  await new Promise(resolve => setTimeout(resolve, 5500))
  await measure('worldRefreshMiss', async () => { const next = createSharedWorld(origin, nextReader); const s = await next.snapshot(); await Promise.all([next.profiles(s), next.constants()]) })
  await worker.dispose()
  worker = new Miniflare(runtimeConfig(true)); await worker.ready
  selectedProvider = provider
  const coldReader = createWorldReader(readerConfig, { walletProvider: () => selectedProvider })
  const connectedCold = createSharedWorld(origin, coldReader)
  await measure('connectedCold50', async () => {
    const s = await connectedCold.snapshot()
    await Promise.all([connectedCold.profiles(s), connectedCold.constants(), readLiveView(coldReader, s, account.address)])
  })
  // A fresh Worker verifies the upstream chain once before the original 17 reads.
  assert.equal((measurements['connectedCold50'] as any).projectRpc, 18)
  await measure('leaderboard20IncludingCold', async () => {
    const first = await createSharedWorld(origin, coldReader).leaderboard()
    assert(first.data)
    await new Promise(resolve => setTimeout(resolve, 1500))
    for (let i = 1; i < 20; i++) {
      const value = await createSharedWorld(origin, coldReader).leaderboard()
      assert(value.data); assert.equal(value.stale, false)
    }
  })
  assert.equal((measurements['leaderboard20IncludingCold'] as any).cacheOutcomes.HIT, 19)
  report.warm50Latency = { samples: sorted.length, medianMs: Math.round(sorted[5]), p95Ms: Math.round(sorted[9]) }
  report.measurements = measurements
  report.costScope = 'Local outbound proxy counts only; no public NodeReal requests or Dashboard CU measured.'
  report.leaderboardPayloadBytes = Buffer.byteLength(await (await fetch(origin + '/api/leaderboard')).text())
  checks.push('Shared cache, wallet Multicall, Buy/Attack/Defend/settle/Withdraw, no history delta, shared 20-user leaderboard, navigation dedupe and wallet failure fallback')
  globalThis.fetch = originalFetch
  report.pass = true
  console.log(JSON.stringify({ pass: true, checks: checks.length, landProfileReadMs: report.landProfileReadMs }))
} finally {
  await worker?.dispose()
  await stopAnvil(environment.child)
  fs.mkdirSync('test-results', { recursive: true })
  fs.writeFileSync('test-results/worker-check.json', JSON.stringify(report, null, 2) + '\n')
}
