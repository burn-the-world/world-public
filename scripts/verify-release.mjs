import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireApp = createRequire(path.join(root, 'app/package.json'))
const solc = requireApp('solc')
const { keccak256 } = requireApp('viem')
const names = ['WorldTokenBSCV2', 'WorldCoreBSCV2', 'WorldLandProfileBSCV2', 'WorldDeploymentBSCV2']
export const RELEASE_COMPILER = '0.8.30+commit.73712a01'
export const RELEASE_BYTES = 18_749
export const RELEASE_SHA256 = '0a9f615a012e810d49123b7d27ab3cd5c25087e0a9e62306f29552486eb5ddeb'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const bundle = path.join(root, 'app/tests/fixtures/contracts')
let cached
const orderedAbi = abi => [...abi].sort((a, b) =>
  `${a.type}:${a.name ?? ''}:${JSON.stringify(a.inputs ?? [])}`.localeCompare(
    `${b.type}:${b.name ?? ''}:${JSON.stringify(b.inputs ?? [])}`))

export function readDeploymentInput() {
  const text = fs.readFileSync(path.join(root, 'contracts/release/testnet-deployment-input.hex'), 'utf8').trim()
  assert.match(text, /^0x[0-9a-f]+$/i, 'Invalid deployment input fixture')
  assert.equal(text.length % 2, 0, 'Truncated deployment input fixture')
  const bytes = Buffer.from(text.slice(2), 'hex')
  assert.equal(bytes.length, RELEASE_BYTES, 'Deployment input length changed')
  assert.equal(sha256(bytes), RELEASE_SHA256, 'Deployment input hash changed')
  return bytes
}

export function verifyCreationBytecode(bytecode) {
  assert.match(bytecode, /^0x[0-9a-f]+$/i, 'Invalid release bytecode')
  assert.equal(bytecode.length % 2, 0, 'Truncated release bytecode')
  const bytes = Buffer.from(bytecode.slice(2), 'hex')
  const reference = readDeploymentInput()
  assert.equal(bytes.length, RELEASE_BYTES, 'Release creation length differs from testnet')
  assert.equal(sha256(bytes), RELEASE_SHA256, 'Release creation SHA256 differs from testnet')
  assert(bytes.equals(reference), 'Release creation bytes differ from testnet deployment input')
  return { bytes: bytes.length, sha256: sha256(bytes), keccak256: keccak256(bytecode), exactMatch: true }
}

export function createReleaseInput() {
  const config = fs.readFileSync(path.join(root, 'contracts/foundry.toml'), 'utf8')
  const defaultProfile = config.split('[profile.default]')[1]?.split(/\n\[/)[0]
  assert(defaultProfile, 'Missing default Foundry profile')
  const setting = name => defaultProfile.match(new RegExp('^' + name + '\\s*=\\s*([^\\r\\n#]+)', 'm'))?.[1].trim()
  assert.equal(setting('solc_version'), '"0.8.30"', 'Foundry compiler must remain 0.8.30')
  assert.equal(setting('evm_version'), '"prague"', 'Foundry EVM target must be Prague')
  assert.equal(setting('optimizer'), 'true', 'Foundry optimizer must remain enabled')
  assert.equal(setting('optimizer_runs'), '200', 'Foundry optimizer runs must remain 200')
  assert.equal(setting('via_ir') ?? 'false', 'false', 'Foundry viaIR must remain disabled')
  assert.equal(solc.version().split('.Emscripten')[0], RELEASE_COMPILER, 'Incorrect release compiler build')

  // Keep Foundry remappings unchanged. Source unit names here reproduce the
  // actual Remix deployment; their file bytes come from the pinned repository.
  const original = readJson(path.join(bundle, 'artifacts/WorldDeploymentBSCV2.json')).metadata
  const sources = {}
  for (const [file, entry] of Object.entries(original.sources)) {
    assert(file.startsWith('src/') || file.startsWith('lib/openzeppelin-contracts/contracts/'), 'Unexpected release source path')
    const bytes = fs.readFileSync(path.join(root, 'contracts', file))
    assert.equal(keccak256(bytes), entry.keccak256, `Release source content changed: ${file}`)
    const identifier = file.replace(/^lib\/openzeppelin-contracts\/contracts\//, '@openzeppelin/contracts/')
    sources[identifier] = { content: bytes.toString('utf8') }
  }
  assert.equal(Object.keys(sources).length, 18, 'Release requires the verified 18 source units')
  return {
    language: 'Solidity', sources,
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'prague', viaIR: false,
      metadata: { bytecodeHash: 'ipfs' }, remappings: [],
      outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object',
        'evm.deployedBytecode.immutableReferences', 'evm.methodIdentifiers'] } },
    },
  }
}

export function compileRelease() {
  const input = createReleaseInput()
  const inputHash = sha256(JSON.stringify(input))
  if (cached?.inputHash === inputHash) {
    verifyCreationBytecode(cached.contracts.WorldDeploymentBSCV2.bytecode)
    return cached
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input)))
  const errors = (output.errors ?? []).filter(error => error.severity === 'error')
  assert.equal(errors.length, 0, errors.map(error => error.formattedMessage).join('\n'))
  const contracts = {}, hashes = {}
  for (const name of names) {
    const compiled = output.contracts[`src/${name}.sol`][name]
    const frozen = readJson(path.join(bundle, 'artifacts', `${name}.json`))
    // solc and Foundry order ABI entries differently. Compare every complete
    // entry, then retain the original public ABI order in the release artifact.
    assert.deepEqual(orderedAbi(compiled.abi), orderedAbi(frozen.abi), `Release ABI changed: ${name}`)
    assert.deepEqual(compiled.evm.methodIdentifiers, frozen.methodIdentifiers, `Release function selectors changed: ${name}`)
    const metadata = JSON.parse(compiled.metadata)
    assert.equal(metadata.compiler.version, RELEASE_COMPILER)
    assert.equal(metadata.settings.evmVersion, 'prague')
    contracts[name] = {
      abi: frozen.abi, bytecode: '0x' + compiled.evm.bytecode.object,
      deployedBytecode: '0x' + compiled.evm.deployedBytecode.object,
      immutableReferences: compiled.evm.deployedBytecode.immutableReferences ?? {},
      metadata: compiled.metadata, methodIdentifiers: compiled.evm.methodIdentifiers,
    }
    const digest = hex => {
      const bytes = Buffer.from(hex.slice(2), 'hex')
      return { bytes: bytes.length, sha256: sha256(bytes), keccak256: keccak256(hex) }
    }
    hashes[name] = { creation: digest(contracts[name].bytecode), runtimeTemplate: digest(contracts[name].deployedBytecode) }
  }
  const creation = verifyCreationBytecode(contracts.WorldDeploymentBSCV2.bytecode)
  cached = {
    inputHash, input, contracts,
    report: {
      compiler: RELEASE_COMPILER, evmVersion: 'prague', optimizer: true, runs: 200, viaIR: false,
      sourceUnits: Object.keys(input.sources), abiAndSelectorsUnchanged: true,
      reference: { chainId: 97, block: 133830577,
        transaction: '0xd3e609f84f6dfbc9222b2557d17e383eb5a5223531620b2f6f394b80913ac2c5' },
      deploymentCreation: creation, hashes,
    },
  }
  return cached
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = compileRelease()
  if (process.argv.includes('--write')) {
    const destination = path.join(root, 'contracts/out/release')
    fs.mkdirSync(destination, { recursive: true })
    for (const [name, artifact] of Object.entries(result.contracts)) {
      fs.writeFileSync(path.join(destination, `${name}.json`), JSON.stringify(artifact, null, 2) + '\n')
    }
    fs.writeFileSync(path.join(destination, 'compiler-input.json'), JSON.stringify(result.input, null, 2) + '\n')
    fs.writeFileSync(path.join(destination, 'verification.json'), JSON.stringify(result.report, null, 2) + '\n')
  }
  console.log(JSON.stringify(result.report, null, 2))
}
