import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const bundleRoot = path.resolve(projectRoot, 'tests', 'fixtures', 'contracts')
const names = ['WorldTokenBSCV2', 'WorldCoreBSCV2', 'WorldLandProfileBSCV2', 'WorldDeploymentBSCV2']
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** Validate the pinned local integration fixtures. This never compiles Solidity. */
export function loadProtocolArtifacts() {
  const checksums = readJson(path.join(bundleRoot, 'SHA256SUMS.json'))
  for (const [file, expected] of Object.entries(checksums)) {
    const bytes = fs.readFileSync(path.join(bundleRoot, file))
    if (sha256(bytes) !== expected) throw new Error(`Contract fixture integrity failed: ${file}`)
  }
  const artifacts = {}
  for (const name of names) {
    const abi = readJson(path.join(projectRoot, '..', 'contracts', 'abi', `${name}.json`))
    const artifact = readJson(path.join(bundleRoot, 'artifacts', `${name}.json`))
    if (JSON.stringify(abi) !== JSON.stringify(artifact.abi)) throw new Error(`V2 ABI does not match compiled artifact: ${name}`)
    if (!/^0x[0-9a-f]+$/i.test(artifact.bytecode?.object ?? '')) throw new Error(`Invalid V2 creation bytecode: ${name}`)
    artifacts[name] = { abi, bytecode: artifact.bytecode.object, deployedBytecode: artifact.deployedBytecode.object,
      immutableReferences: artifact.deployedBytecode.immutableReferences ?? {} }
  }
  return artifacts
}

export function loadParticipantFixture() {
  loadProtocolArtifacts()
  return readJson(path.join(bundleRoot, 'fixtures/BSCV2Participant.json'))
}

export const compileContracts = loadProtocolArtifacts
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = loadProtocolArtifacts()
  console.log(`PASS: validated ${Object.keys(artifacts).length} V2 ABI/artifact pairs and pinned integration fixtures. No Solidity compilation.`)
}
