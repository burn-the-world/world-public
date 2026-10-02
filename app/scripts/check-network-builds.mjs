import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { renderWhitepaper, excludeCanonicalWhitepaper, whitepaperPath } from './whitepaper.ts'
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const main = read('config/networks/mainnet.json'), test = read('config/networks/testnet.json')
const addresses = ['deploymentAddress', 'coreAddress', 'tokenAddress', 'profileAddress']
const m = read('dist/network.json'), t = read('dist-testnet/network.json')
assert.equal(m.chainId, 56); assert.equal(m.mainnetEnabled, true); assert.equal(m.deploymentBlock, '125288896')
assert.equal(t.chainId, 97); assert.equal(t.deploymentBlock, '133830577')
for (const key of addresses) { assert.equal(m[key], main[key]); assert.equal(t[key], test[key]) }
function files(folder) { return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]) }
const forbidden = addresses.map(key => test[key].toLowerCase()).concat('133830577', 'bsc-testnet.nodereal.io', 'bsc-testnet-dataseed.bnbchain.org')
const canonicalWhitepaper = await renderWhitepaper(fs.readFileSync(whitepaperPath, 'utf8'))
let documentAssets = 0
for (const file of files('dist').concat(files('.wrangler/dry-run'))) {
  let source = fs.readFileSync(file).toString()
  if (/^WhitepaperPage-.*\.js$/.test(path.basename(file))) {
    source = await excludeCanonicalWhitepaper(source, canonicalWhitepaper)
    ++documentAssets
  }
  const text = source.toLowerCase()
  for (const value of forbidden) assert(!text.includes(value), `Testnet identity leaked into mainnet artifact: ${file}`)
  if (file.startsWith('dist')) assert(!text.includes('nodereal_rpc_url') && !text.includes('nodereal_mainnet_rpc_url'), `Runtime binding leaked into browser artifact: ${file}`)
}
assert.equal(documentAssets, 1, 'Missing isolated canonical whitepaper asset')
const forbiddenInTestnet = addresses.map(key => main[key].toLowerCase()).concat('125288896', 'bsc-mainnet.nodereal.io')
for (const file of files('dist-testnet')) {
  const text = fs.readFileSync(file).toString().toLowerCase()
  for (const value of forbiddenInTestnet) assert(!text.includes(value), `Mainnet identity leaked into testnet assets: ${file}`)
}
assert.equal(read('wrangler.jsonc').name, 'world-bsc-mainnet')
assert.equal(read('wrangler.jsonc').vars.MAINNET_ENABLED, 'true')
assert.equal(read('wrangler.testnet.jsonc').name, 'world-bsc-v2')
assert.equal(main.rpcSecretBinding, 'NODEREAL_MAINNET_RPC_URL')
assert.equal(test.rpcSecretBinding, 'NODEREAL_RPC_URL')
console.log('PASS: 56 verified deployment enabled; 97 exact frozen instance; isolated browser and Worker artifacts; separate runtime bindings.')
