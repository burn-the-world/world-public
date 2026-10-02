import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { createPublicClient, createWalletClient, defineChain, http, type Address } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { loadProtocolArtifacts } from './compile.mjs'

// Public, disposable Anvil development mnemonic. Never used by browser code.
export const LOCAL_MNEMONIC = 'test test test test test test test test test test test junk'

export async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', () => reject(new Error(`Port ${port} is already occupied. Refusing to reuse or reset an existing chain.`)))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()))
  })
}

export async function startAnvil(port = 18559, chainId = 31359) {
  if (![31359, 31360].includes(chainId)) throw new Error('Only disposable WORLD V2 local chain IDs 31359 / 31360 are supported by this helper')
  await assertPortFree(port)
  const binary = process.env.ANVIL_BIN || 'anvil'
  const child = spawn(binary, [
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', String(chainId),
    '--hardfork', 'cancun', '--mnemonic', LOCAL_MNEMONIC, '--silent',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostic = ''
  child.stdout?.on('data', (data) => { diagnostic += String(data) })
  child.stderr?.on('data', (data) => { diagnostic += String(data) })
  let startupError: Error | undefined
  child.on('error', (error) => { startupError = error })
  const rpcUrl = `http://127.0.0.1:${port}`
  const chain = defineChain({ id: chainId, name: 'WORLD BSC Burn V2 · Local Anvil', nativeCurrency: { name: 'Local test BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } })
  const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 0, timeout: 1500 }), pollingInterval: 50 })
  for (let attempts = 0; attempts < 80; attempts++) {
    if (startupError) throw new Error(`Could not start Anvil. Install Foundry or set ANVIL_BIN. ${startupError.message}`)
    if (child.exitCode !== null) throw new Error(`Anvil exited: ${diagnostic}`)
    try {
      if (await client.getChainId() === chainId) return { child, client, chain, rpcUrl, diagnostic: () => diagnostic }
    } catch { /* Wait until the child accepts local RPC requests. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  child.kill()
  throw new Error(`Anvil did not start in time: ${diagnostic}`)
}

export async function stopAnvil(child: ChildProcess) {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
    setTimeout(resolve, 3000).unref()
  })
}

export async function deployWorld(environment: Awaited<ReturnType<typeof startAnvil>>) {
  if (![31359, 31360].includes(await environment.client.getChainId()) || !environment.rpcUrl.startsWith('http://127.0.0.1:')) {
    throw new Error('Deployment helper is restricted to the disposable localhost chain')
  }
  const artifacts = loadProtocolArtifacts()
  const account = mnemonicToAccount(LOCAL_MNEMONIC, { addressIndex: 0 })
  const wallet = createWalletClient({ account, chain: environment.chain, transport: http(environment.rpcUrl) })
  const hash = await wallet.deployContract({ abi: artifacts.WorldDeploymentBSCV2.abi, bytecode: artifacts.WorldDeploymentBSCV2.bytecode })
  const receipt = await environment.client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('WorldDeploymentBSCV2 failed')
  const deploymentAddress = receipt.contractAddress
  const [coreAddress, tokenAddress, profileAddress] = await Promise.all([
    environment.client.readContract({ address: deploymentAddress, abi: artifacts.WorldDeploymentBSCV2.abi, functionName: 'core' }),
    environment.client.readContract({ address: deploymentAddress, abi: artifacts.WorldDeploymentBSCV2.abi, functionName: 'token' }),
    environment.client.readContract({ address: deploymentAddress, abi: artifacts.WorldDeploymentBSCV2.abi, functionName: 'profile' }),
  ])
  return { artifacts, deploymentAddress, coreAddress: coreAddress as Address, tokenAddress: tokenAddress as Address, profileAddress: profileAddress as Address, deploymentBlock: receipt.blockNumber, deploymentHash: hash }
}
