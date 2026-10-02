// Operator-only extension. All completed suffixes reconcile against pinned LAND storage.
import fs from 'node:fs/promises'
import testnet from '../config/networks/testnet.json'
import mainnet from '../config/networks/mainnet.json'
import { networkConfig } from '../src/config'
import { createWorldReader } from '../src/chain'
import { parseData, serializeData } from '../src/dataCodec'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import { syncLeaderboard, validateCheckpoint } from '../worker/leaderboardIndex'
const network = process.argv[2] ?? 'testnet'
if (!['mainnet', 'testnet'].includes(network)) throw new Error('Select a supported network')
const profile = network === 'mainnet' ? mainnet : testnet
const file = network === 'mainnet' ? 'public-mainnet/data/leaderboard-checkpoint.json' : 'public/data/leaderboard-checkpoint.json'
const original = validateCheckpoint(parseData(await fs.readFile(file, 'utf8')) as LeaderboardCheckpoint)
const config = networkConfig(profile, new URL('/rpc', profile.publicOrigin ?? 'https://world-bsc-mainnet.world-bsc-dapp-burn-v2.workers.dev').href)
if (original.identity.chainId !== config.chainId || original.identity.deployment.toLowerCase() !== config.deploymentAddress?.toLowerCase()) throw new Error('Checkpoint instance mismatch')
const reader = createWorldReader(config)
let checkpoint = original, target: bigint
do {
  const next = await syncLeaderboard(reader, checkpoint)
  checkpoint = next.checkpoint; target = next.target
  console.log(JSON.stringify({ verifiedThrough: String(checkpoint.head.blockNumber), target: String(target), suffixEvents: next.events }))
} while (checkpoint.head.blockNumber < target)
// No file change on a failed range. No raw logs or historical event arrays are published.
await fs.writeFile(file + '.tmp', serializeData(checkpoint) + '\n', 'utf8')
await fs.rename(file + '.tmp', file)
console.log(JSON.stringify({ verified: true, previous: String(original.head.blockNumber), checkpoint: String(checkpoint.head.blockNumber) }))
