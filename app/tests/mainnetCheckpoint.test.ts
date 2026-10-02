import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import mainnet from '../config/networks/mainnet.json'
import { parseData } from '../src/dataCodec'
import type { LeaderboardCheckpoint } from '../src/leaderboard'
import { leaderboardSnapshot, validateLeaderboard } from '../src/leaderboard'
import { validateCheckpoint } from '../worker/leaderboardIndex'

describe('verified mainnet leaderboard bootstrap', () => {
  it('contains the mainnet instance and a fully verified prefix', () => {
    const checkpoint = validateCheckpoint(parseData(fs.readFileSync('public-mainnet/data/leaderboard-checkpoint.json', 'utf8')) as LeaderboardCheckpoint)
    expect(checkpoint.identity.chainId).toBe(56)
    for (const [key, field] of [['deployment', 'deploymentAddress'], ['core', 'coreAddress'], ['token', 'tokenAddress'], ['profile', 'profileAddress']] as const)
      expect(checkpoint.identity[key].toLowerCase()).toBe(mainnet[field].toLowerCase())
    expect(checkpoint.identity.deploymentBlock).toBe(125288896n)
    expect(checkpoint.head.blockNumber).toBeGreaterThanOrEqual(checkpoint.identity.deploymentBlock)
    expect(checkpoint.lands).toHaveLength(50)
    expect(checkpoint.provenance?.verifiedFromBlock).toBe('125288896')
    expect(checkpoint.provenance?.sourceBlock).toBe(String(checkpoint.head.blockNumber))
    expect(checkpoint.provenance?.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    validateLeaderboard(leaderboardSnapshot(checkpoint), 56, mainnet.coreAddress)
  })
  it('keeps mainnet public ABI copies byte-identical and public docs network-specific', () => {
    for (const name of ['WorldDeploymentBSCV2', 'WorldTokenBSCV2', 'WorldCoreBSCV2', 'WorldLandProfileBSCV2'])
      expect(fs.readFileSync(`public-mainnet/abi/${name}.json`).equals(fs.readFileSync(`../contracts/abi/${name}.json`))).toBe(true)
    for (const file of ['V2_UI_RULES.md', 'V2_CONTRACT_INTEGRATION.md', 'REIGN_PERFORMANCE.md', 'WORLD_WHITEPAPER_V1.0_DRAFT.md']) {
      const bytes = fs.readFileSync(`public-mainnet/docs/${file}`)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false)
      expect(text).not.toMatch(/[\u3400-\u9fff]|133830577|0xB0272c944BCC22553cF9869B30f3418be535C3df/)
    }
  })
})
