import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const wranglerRequire = createRequire(require.resolve('wrangler'))
const { Miniflare, Log, LogLevel } = wranglerRequire('miniflare')
const { build } = wranglerRequire('esbuild')


// Same workerd/Miniflare runtime and asset configuration used by Wrangler dev.
// Inject the secret in memory; never pass it as a CLI --var or write .dev.vars.
export async function startPreview(port = 8787, assetsDirectory) {
  const network = process.env.WORLD_NETWORK ?? 'mainnet'
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('Invalid network')
  const secret = network === 'mainnet' ? 'NODEREAL_MAINNET_RPC_URL' : 'NODEREAL_RPC_URL'
  if (!process.env[secret]) throw new Error('Set the selected runtime secret in the process environment first')
  const config = JSON.parse(readFileSync(network === 'mainnet' ? 'wrangler.jsonc' : 'wrangler.testnet.jsonc', 'utf8'))
  const bundle = await build({ entryPoints: [config.main], alias: config.alias, bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' })
  const mf = new Miniflare({ host: '127.0.0.1', port, log: new Log(LogLevel.NONE),
    workers: [{ config: {
      name: config.name, compatibilityDate: config.compatibility_date,
      manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle.outputFiles[0].text } } },
      env: { ASSETS: { type: 'assets' }, WORLD_NETWORK: { type: 'text', value: network }, MAINNET_ENABLED: { type: 'text', value: config.vars.MAINNET_ENABLED }, [secret]: { type: 'text', value: process.env[secret] } },
      assets: { directory: assetsDirectory || config.assets.directory, hasUserWorker: true,
        runWorkerFirst: config.assets.run_worker_first, notFoundHandling: config.assets.not_found_handling },
    } }] })
  try { await mf.ready; return mf } catch { await mf.dispose(); throw new Error('Local Worker initialization failed') }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPreview().then(mf => {
    console.log('Local Worker preview ready: http://127.0.0.1:8787 (secret hidden)')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await mf.dispose(); process.exit(0) })
  }).catch(() => { console.error('Local Worker preview failed; credential details suppressed'); process.exitCode = 1 })
}
