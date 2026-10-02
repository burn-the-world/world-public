import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const network = process.argv[2] ?? 'mainnet'
if (!['mainnet', 'testnet'].includes(network)) throw new Error('Unknown WORLD network')
const profile = JSON.parse(readFileSync(`config/networks/${network}.json`, 'utf8'))
const worker = JSON.parse(readFileSync(network === 'mainnet' ? 'wrangler.jsonc' : 'wrangler.testnet.jsonc', 'utf8'))
if (worker.vars.WORLD_NETWORK !== network || worker.name !== (network === 'mainnet' ? 'world-bsc-mainnet' : 'world-bsc-v2')
  || (network === 'mainnet' && worker.vars.MAINNET_ENABLED !== String(profile.mainnetEnabled))) throw new Error('Worker/build network configuration mismatch')
// The selected manifest cannot be overridden by legacy Vite environment files.
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--base=/', ...(network === 'testnet' ? ['--outDir=dist-testnet'] : [])], {
  stdio: 'inherit', env: { ...process.env, WORLD_NETWORK: network, VITE_LOCAL_TEST_WALLET: 'false' },
})
if (result.error) { console.error('Unable to start the Workers assets build'); process.exit(1) }
if (result.status === 0) {
  const { rpcHost, rpcSecretBinding, publicOrigin, ...publicProfile } = profile
  writeFileSync(`${network === 'testnet' ? 'dist-testnet' : 'dist'}/network.json`, JSON.stringify(publicProfile, null, 2) + '\n', 'utf8')
}
process.exit(result.status ?? 1)
