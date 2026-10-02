// Fresh local-only world for browser-i18n.cjs. Never changes .env files.
import fs from 'node:fs'
import { startAnvil, deployWorld, stopAnvil } from './anvil'
import { createServer } from 'vite'
const environment = await startAnvil(18575)
try {
  const deployment = await deployWorld(environment)
  Object.assign(process.env, {
    VITE_CHAIN_ID: '31359', VITE_RPC_URL: environment.rpcUrl, VITE_NATIVE_SYMBOL: 'BNB',
    VITE_DEPLOYMENT_ADDRESS: deployment.deploymentAddress, VITE_CORE_ADDRESS: deployment.coreAddress,
    VITE_TOKEN_ADDRESS: deployment.tokenAddress, VITE_PROFILE_ADDRESS: deployment.profileAddress,
    VITE_DEPLOYMENT_BLOCK: String(deployment.deploymentBlock), VITE_LOCAL_TEST_WALLET: 'true', VITE_RECENT_BLOCK_WINDOW: '5000',
  })
  fs.mkdirSync('work', { recursive: true })
  const snapshot = await environment.client.request({ method: 'evm_snapshot' } as never)
  fs.writeFileSync('work/i18n-local.json', JSON.stringify({ rpcUrl: environment.rpcUrl, chainId: 31359,
    deploymentAddress: deployment.deploymentAddress, coreAddress: deployment.coreAddress,
    tokenAddress: deployment.tokenAddress, profileAddress: deployment.profileAddress,
    deploymentBlock: String(deployment.deploymentBlock), transactionHash: deployment.deploymentHash, snapshot }))
  const server = await createServer({ server: { host: '127.0.0.1', port: 5181, strictPort: true } })
  await server.listen()
  console.log('Bilingual UI test world ready at http://127.0.0.1:5181 (local-only chain 31359).')
  const close = async () => { await server.close(); await stopAnvil(environment.child); process.exit() }
  process.on('SIGTERM', close); process.on('SIGINT', close)
} catch (error) { await stopAnvil(environment.child); throw error }
