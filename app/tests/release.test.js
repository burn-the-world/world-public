import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileRelease, createReleaseInput, readDeploymentInput, verifyCreationBytecode,
  RELEASE_BYTES, RELEASE_SHA256 } from '../../scripts/verify-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('verified Prague release', () => {
  it('retains the actual source identifiers and explicit audited compiler settings', () => {
    const input = createReleaseInput()
    expect(Object.keys(input.sources)).toHaveLength(18)
    expect(Object.keys(input.sources).filter(key => key.startsWith('@openzeppelin/contracts/'))).toHaveLength(10)
    expect(Object.keys(input.sources).some(key => key.startsWith('lib/'))).toBe(false)
    expect(input.settings).toMatchObject({ evmVersion: 'prague', viaIR: false,
      optimizer: { enabled: true, runs: 200 }, metadata: { bytecodeHash: 'ipfs' }, remappings: [] })
  })

  it('compiles all four contracts with unchanged ABI, selectors, events and errors', () => {
    const release = compileRelease()
    for (const [name, artifact] of Object.entries(release.contracts)) {
      const original = JSON.parse(fs.readFileSync(path.join(root, 'app/tests/fixtures/contracts/artifacts', name + '.json'), 'utf8'))
      expect(artifact.abi).toEqual(original.abi)
      expect(artifact.methodIdentifiers).toEqual(original.methodIdentifiers)
      expect(JSON.parse(artifact.metadata).settings.evmVersion).toBe('prague')
    }
  }, 30_000)

  it('matches the complete 18,749-byte chain input including metadata', () => {
    const release = compileRelease()
    expect(Buffer.from(release.contracts.WorldDeploymentBSCV2.bytecode.slice(2), 'hex')).toEqual(readDeploymentInput())
    expect(release.report.deploymentCreation).toMatchObject({ bytes: RELEASE_BYTES, sha256: RELEASE_SHA256, exactMatch: true })
  }, 30_000)

  it('rejects a metadata-only byte change instead of masking metadata', () => {
    const input = readDeploymentInput()
    input[input.length - 20] ^= 1
    expect(() => verifyCreationBytecode('0x' + input.toString('hex'))).toThrow('SHA256 differs')
  })

  it('rejects truncated creation input', () => {
    expect(() => verifyCreationBytecode('0x' + readDeploymentInput().subarray(0, -1).toString('hex'))).toThrow('length differs')
  })
})
