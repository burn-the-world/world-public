import fs from 'node:fs'
import path from 'node:path'
import { projectRoot } from './compile.mjs'
import { deployWorld, startAnvil, stopAnvil } from './anvil'

const envPath = path.join(projectRoot, '.env.local')
const marker = '# WORLD_BSC_V2_LOCAL_MANAGED: disposable local Anvil deployment'
if (fs.existsSync(envPath) && !fs.readFileSync(envPath, 'utf8').startsWith(marker)) {
  throw new Error('.env.local already contains user configuration. Move it aside before starting the local demo; it will not be overwritten.')
}
const port = Number(process.env.WORLD_LOCAL_PORT || 18559)
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('WORLD_LOCAL_PORT must be between 1024 and 65535')
const environment = await startAnvil(port)
const shutdown = async () => { await stopAnvil(environment.child); process.exit(0) }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
try {
  const deployment = await deployWorld(environment)
  const config = [
    marker,
    'VITE_CHAIN_ID=31359',
    `VITE_RPC_URL=${environment.rpcUrl}`,
    `VITE_DEPLOYMENT_ADDRESS=${deployment.deploymentAddress}`,
    `VITE_CORE_ADDRESS=${deployment.coreAddress}`,
    `VITE_TOKEN_ADDRESS=${deployment.tokenAddress}`,
    `VITE_PROFILE_ADDRESS=${deployment.profileAddress}`,
    'VITE_NATIVE_SYMBOL=BNB',
    'VITE_LOCAL_TEST_WALLET=true',
    `VITE_DEPLOYMENT_BLOCK=${deployment.deploymentBlock}`,
    'VITE_RECENT_BLOCK_WINDOW=5000',
    '',
  ].join('\n')
  fs.writeFileSync(envPath, config)
  fs.mkdirSync(path.join(projectRoot, 'test-results'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'test-results/local-deployment-v2.json'), JSON.stringify({
    localOnly: true, cleanWorld: true, rpcUrl: environment.rpcUrl, chainId: 31359,
    deploymentAddress: deployment.deploymentAddress, coreAddress: deployment.coreAddress,
    tokenAddress: deployment.tokenAddress, profileAddress: deployment.profileAddress, deploymentBlock: deployment.deploymentBlock.toString(),
    transactionHash: deployment.deploymentHash,
  }, null, 2) + '\n')
  console.log(`WORLD BSC Burn V2 local chain ready at ${environment.rpcUrl}; chain ID 31359. BNB is a disposable local test balance, not public BSC.`)
  console.log(`Deployment: ${deployment.deploymentAddress}\nCore: ${deployment.coreAddress}\nToken: ${deployment.tokenAddress}\nProfile: ${deployment.profileAddress}`)
  console.log('Wrote real deployment addresses to .env.local. Start Vite in a second terminal. Keep this terminal running; Ctrl+C stops this disposable chain.')
  console.log('Use only Anvil development wallets on this localhost chain. Browser code receives no private keys.')
} catch (error) {
  await stopAnvil(environment.child)
  throw error
}
