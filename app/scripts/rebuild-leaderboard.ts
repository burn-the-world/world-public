// Operator-only full replay. Never imported by the Worker or browser. Input evidence stays in ignored work/.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { zeroAddress } from 'viem'
import { reduceAggregate, validateCheckpoint } from '../worker/leaderboardIndex'
import assert from 'node:assert/strict'
import { keccak256, decodeEventLog, type Hex, type Abi } from 'viem'
import { coreAbi, tokenAbi, deploymentAbi } from '../src/abi'
import { parseData, serializeData } from '../src/dataCodec'
import { createWorldReader } from '../src/chain'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import testnet from '../config/networks/testnet.json'
import mainnet from '../config/networks/mainnet.json'
import { networkConfig } from '../src/config'

const network = process.argv[2] ?? 'testnet'
assert(['mainnet', 'testnet'].includes(network), 'Select an explicit supported network')
const profile = network === 'mainnet' ? mainnet : testnet
const file = network === 'mainnet' ? 'public-mainnet/data/leaderboard-checkpoint.json' : 'public/data/leaderboard-checkpoint.json'
const output = `work/${network}-reign-checkpoint-input.json`
const rpc = new URL('/rpc', profile.publicOrigin ?? 'https://world-bsc-mainnet.world-bsc-dapp-burn-v2.workers.dev').href
const bootstrap = createWorldReader(networkConfig(profile, rpc))
let identity: LeaderboardCheckpoint['identity']
if (fs.existsSync(file)) identity = (parseData(fs.readFileSync(file, 'utf8')) as LeaderboardCheckpoint).identity
else {
  assert.equal(network, 'mainnet', 'Existing testnet checkpoint required')
  const addresses = await bootstrap.resolveAddresses()
  const blockNumber = BigInt(profile.deploymentBlock!)
  const [genesis, block, factoryCode, coreCode] = await Promise.all([
    bootstrap.publicClient.getBlock({ blockNumber: 0n }), bootstrap.publicClient.getBlock({ blockNumber }),
    bootstrap.publicClient.getBytecode({ address: addresses.deployment!, blockNumber }),
    bootstrap.publicClient.getBytecode({ address: addresses.core, blockNumber }),
  ])
  assert(genesis.hash && block.hash && factoryCode && coreCode && addresses.deployment && addresses.profile)
  identity = { chainId: profile.chainId, deployment: addresses.deployment, core: addresses.core, token: addresses.token, profile: addresses.profile,
    genesisHash: genesis.hash, deploymentBlock: blockNumber, deploymentBlockHash: block.hash,
    factoryCodeHash: keccak256(factoryCode), coreCodeHash: keccak256(coreCode) }
}
assert.equal(identity.chainId, profile.chainId)
assert.equal(identity.deploymentBlock, BigInt(profile.deploymentBlock!))
assert.equal(identity.deployment.toLowerCase(), profile.deploymentAddress!.toLowerCase())
let id = 0
async function batch(items: { method: string; params: unknown[] }[]) {
  if (!items.length) return []
  const calls = items.map(item => ({ jsonrpc: '2.0', id: ++id, ...item }))
  let last = 'request'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(calls), signal: AbortSignal.timeout(25000) })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const values = await response.json() as any[]
      assert(Array.isArray(values))
      return calls.map(call => {
        const result = values.find(value => value.id === call.id)
        assert(result && !result.error, 'RPC result unavailable for ' + call.method)
        return result.result
      })
    } catch (error) { last = error instanceof Error ? error.message : 'request'; }
  }
  throw new Error('Read-only batch failed: ' + last)
}
const hex = (value: bigint) => '0x' + value.toString(16)
const [chainId, latestHex] = await batch([{ method: 'eth_chainId', params: [] }, { method: 'eth_blockNumber', params: [] }])
assert.equal(chainId, '0x' + profile.chainId.toString(16))
const target = BigInt(latestHex) - 12n
const [startBlock, headBlock, oldCode, currentCode] = await batch([
  { method: 'eth_getBlockByNumber', params: [hex(identity.deploymentBlock), false] },
  { method: 'eth_getBlockByNumber', params: [hex(target), false] },
  { method: 'eth_getCode', params: [identity.core, hex(identity.deploymentBlock)] },
  { method: 'eth_getCode', params: [identity.core, hex(target)] },
])
assert.equal(startBlock.hash, identity.deploymentBlockHash)
assert.equal(keccak256(oldCode), identity.coreCodeHash)
assert.equal(currentCode, oldCode)
const ranges: { from: bigint; to: bigint }[] = []
for (let from = identity.deploymentBlock; from <= target; from += 5000n) ranges.push({ from, to: from + 4999n < target ? from + 4999n : target })
const logs: any[] = []
for (let offset = 0; offset < ranges.length; offset += 10) {
  const slice = ranges.slice(offset, offset + 10)
  const result = await batch(slice.map(range => ({ method: 'eth_getLogs', params: [{ address: [identity.core, identity.token, identity.deployment], fromBlock: hex(range.from), toBlock: hex(range.to) }] })))
  result.forEach((values, i) => {
    assert(Array.isArray(values))
    for (const log of values) {
      assert(!log.removed && BigInt(log.blockNumber) >= slice[i].from && BigInt(log.blockNumber) <= slice[i].to)
      logs.push(log)
    }
  })
  console.log(JSON.stringify({ verifiedRangeThrough: String(slice.at(-1)!.to), totalLogs: logs.length }))
}
const blocks = new Map<string, any>([[startBlock.number, startBlock], [headBlock.number, headBlock]])
const missingBlocks = [...new Set(logs.map(log => log.blockNumber as string))].filter(n => !blocks.has(n))
for (let offset = 0; offset < missingBlocks.length; offset += 20) {
  const slice = missingBlocks.slice(offset, offset + 20)
  const result = await batch(slice.map(number => ({ method: 'eth_getBlockByNumber', params: [number, false] })))
  result.forEach((block, i) => { assert.equal(block.number, slice[i]); blocks.set(slice[i], block) })
}
const transactions = [...new Set(logs.map(log => log.transactionHash as string))]
const receipts: any[] = []
for (let offset = 0; offset < transactions.length; offset += 20) {
  const slice = transactions.slice(offset, offset + 20)
  const result = await batch(slice.map(hash => ({ method: 'eth_getTransactionReceipt', params: [hash] })))
  result.forEach((receipt, i) => { assert.equal(receipt.transactionHash, slice[i]); assert.equal(receipt.status, '0x1'); receipts.push(receipt) })
}
const events = logs.map(log => {
  assert.equal(blocks.get(log.blockNumber).hash, log.blockHash)
  const receipt = receipts.find(receipt => receipt.transactionHash === log.transactionHash)
  assert.equal(receipt.blockHash, log.blockHash)
  assert(receipt.logs.some((entry: any) => entry.logIndex === log.logIndex && entry.address === log.address && entry.data === log.data && JSON.stringify(entry.topics) === JSON.stringify(log.topics)))
  const address = log.address.toLowerCase()
  const abi = address === identity.core.toLowerCase() ? coreAbi : address === identity.token.toLowerCase() ? tokenAbi : deploymentAbi
  const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: true }) as unknown as { eventName: string; args: Record<string, unknown> }
  return { source: address === identity.core.toLowerCase() ? 'Core' : address === identity.token.toLowerCase() ? 'Token' : 'Deployment',
    ...decoded, blockNumber: BigInt(log.blockNumber), blockHash: log.blockHash, timestamp: BigInt(blocks.get(log.blockNumber).timestamp),
    transactionHash: log.transactionHash, transactionIndex: Number(BigInt(log.transactionIndex)), logIndex: Number(BigInt(log.logIndex)) }
}).sort((a, b) => a.blockNumber === b.blockNumber ? a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1)
assert.equal(new Set(events.map(event => `${event.blockNumber}:${event.logIndex}`)).size, events.length)
const reader = createWorldReader({ ...identity, deploymentAddress: identity.deployment, coreAddress: identity.core, tokenAddress: identity.token,
  profileAddress: identity.profile, rpcUrl: rpc, nativeSymbol: profile.nativeSymbol, recentBlockWindow: 5000n })
const names = ['WORLD_PRICE', 'TOKEN_UNIT', 'B', 'W']
const calls = names.map(functionName => ({ address: identity.core, abi: coreAbi, functionName }))
const [constantsBirth, constantsHead, currentLands] = await Promise.all([
  reader.publicMany(calls, identity.deploymentBlock), reader.publicMany(calls, target),
  reader.publicMany(Array.from({ length: 50 }, (_, i) => ({ address: identity.core, abi: coreAbi, functionName: 'lands', args: [BigInt(i + 1)] })), target)
])
assert.deepEqual(constantsBirth, constantsHead)
const owners = [...new Set(events.filter(e => e.source === 'Core' && e.eventName === 'Earned').map(e => String(e.args.beneficiary).toLowerCase()))]
const claimable = await reader.publicMany(owners.map(owner => ({ address: identity.core, abi: coreAbi, functionName: 'claimable', args: [owner] })), target)
const headRecheck = (await batch([{ method: 'eth_getBlockByNumber', params: [hex(target), false] }]))[0]
assert.equal(headRecheck.hash, headBlock.hash)
const result = { identity, target, targetHash: headBlock.hash, timestamp: BigInt(headBlock.timestamp), latestObserved: BigInt(latestHex),
  ranges, verifiedReceipts: receipts.map(receipt => ({ hash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, status: receipt.status })),
  events, constants: Object.fromEntries(names.map((name, i) => [name, constantsHead[i]])), currentLands,
  claimableForReconciliationOnly: Object.fromEntries(owners.map((owner, i) => [owner, claimable[i]])) }
fs.mkdirSync('work', { recursive: true })
fs.writeFileSync(output, serializeData(result) + '\n', 'utf8')
console.log(JSON.stringify({ passed: true, from: String(identity.deploymentBlock), through: String(target), ranges: ranges.length,
  receipts: receipts.length, events: events.reduce((counts, e) => ({ ...counts, [e.eventName]: (counts[e.eventName] || 0) + 1 }), {} as Record<string, number>) }))

assert.equal(constantsHead[0], 10n ** 12n)
assert.equal(constantsHead[1], 10n ** 18n)
assert.equal(constantsHead[2], 1n << 96n)
assert.equal(constantsHead[3], 65n)
const rawInput = serializeData(result) + '\n'
fs.mkdirSync('work', { recursive: true })
fs.writeFileSync(output, rawInput, 'utf8')
const relevant = events.filter(e => e.source === 'Core' && ['Taken', 'Earned', 'AttackProgress', 'Defended'].includes(e.eventName))
assert(relevant.every(e => e.blockNumber > identity.deploymentBlock))
const blank: LeaderboardCheckpoint = {
  version: 3, identity, head: { blockNumber: identity.deploymentBlock, blockHash: startBlock.hash, timestamp: BigInt(startBlock.timestamp) },
  globalJ: 0n, worldPrice: constantsHead[0] as bigint, tokenUnit: constantsHead[1] as bigint,
  rewardDenominator: (constantsHead[2] as bigint) * (constantsHead[3] as bigint), reigns: [],
  lands: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, controller: zeroAddress, epoch: 0n, startedAt: 0n, j: 0n, resistanceRaw: 0n, lastResistanceUpdate: 0n })),
}
const next = reduceAggregate(blank, relevant, { blockNumber: target, blockHash: headBlock.hash, timestamp: BigInt(headBlock.timestamp) })
next.lands.forEach((land, i) => {
  const [controller, raw, lastUpdate, epoch, j] = currentLands[i] as [Hex, bigint, bigint, bigint, bigint]
  assert.equal(land.controller.toLowerCase(), controller.toLowerCase()); assert.equal(land.epoch, epoch); assert.equal(land.j, j)
  assert.equal(land.resistanceRaw, raw); assert.equal(land.lastResistanceUpdate, lastUpdate)
})
// Independently corroborate every WAR burn with Token Transfer-to-zero in the same receipt.
const used = new Set<string>()
for (const e of relevant.filter(e => e.eventName !== 'Earned')) {
  const actor = String(e.args.newController ?? e.args.attacker ?? e.args.supporter).toLowerCase()
  const burn = events.find(t => t.source === 'Token' && t.eventName === 'Transfer' && t.transactionHash === e.transactionHash
    && String(t.args.from).toLowerCase() === actor && String(t.args.to).toLowerCase() === zeroAddress
    && t.args.value === e.args.amount && t.logIndex < e.logIndex && !used.has(t.transactionHash + ':' + t.logIndex))
  assert(burn, 'WAR burn missing'); used.add(burn.transactionHash + ':' + burn.logIndex)
}
for (const owner of owners) {
  const credit = next.reigns.filter(r => r.controller.toLowerCase() === owner).reduce((sum, r) => sum + r.earnedScaled, 0n)
  const withdrawn = events.filter(e => e.eventName === 'Withdrawn' && String(e.args.beneficiary).toLowerCase() === owner)
    .reduce((sum, e) => sum + (e.args.amountWei as bigint), 0n)
  assert.equal(credit, (result.claimableForReconciliationOnly[owner] as bigint) + withdrawn * next.rewardDenominator)
}
next.provenance = { sourceSha256: createHash('sha256').update(rawInput).digest('hex'), sourceBlock: String(target),
  verifiedFromBlock: String(identity.deploymentBlock), method: 'Full contiguous event replay; receipt and Token burn corroboration; canonical hashes; 50 LAND storage; aggregate credit conservation' }
validateCheckpoint(next)
// Atomic replacement only after all proof checks pass.
fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
fs.writeFileSync(file + '.tmp', serializeData(next) + '\n', 'utf8')
fs.renameSync(file + '.tmp', file)
console.log(JSON.stringify({ checkpoint: String(target), reigns: next.reigns.length, verified: true }))
