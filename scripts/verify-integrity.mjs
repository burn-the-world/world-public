import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProtocolArtifacts } from '../app/scripts/compile.mjs'
import { createReleaseInput } from './verify-release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const inputs = JSON.parse(fs.readFileSync(path.join(root, 'contracts/inputs/FROZEN_FILES.json'), 'utf8'))
for (const [file, expected] of Object.entries(inputs)) {
  assert.equal(hash(path.join(root, 'contracts', file)), expected, `Pinned dependency changed: ${file}`)
}
const artifacts = loadProtocolArtifacts()
for (const name of Object.keys(artifacts)) {
  const canonical = hash(path.join(root, 'contracts/abi', `${name}.json`))
  for (const folder of ['app/src/abi', 'app/public/abi', 'app/public-mainnet/abi']) {
    assert.equal(hash(path.join(root, folder, `${name}.json`)), canonical, `ABI drift: ${folder}/${name}.json`)
  }
}
const release = createReleaseInput()
console.log(`PASS: ${Object.keys(inputs).length} pinned inputs; ${Object.keys(release.sources).length} release source units; integration fixtures and all four ABI copies.`)
