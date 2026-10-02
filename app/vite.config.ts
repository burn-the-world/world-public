import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

export default defineConfig(({ mode }) => {
  const network = mode === 'test' ? 'testnet' : process.env.WORLD_NETWORK ?? 'mainnet';
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('Unknown WORLD network');
  return {
  plugins: [{ name: 'public-network-manifest', enforce: 'pre', transform(source, id) {
    if (mode !== 'test' && id.replaceAll('\\', '/').endsWith(`/config/networks/${network}.json`)) {
      const { rpcHost, rpcSecretBinding, publicOrigin, ...profile } = JSON.parse(fs.readFileSync(`config/networks/${network}.json`, 'utf8'));
      return JSON.stringify(profile);
    }
  } }, react()],
  resolve: { alias: { '@world-network': path.resolve(`config/networks/${network}.json`) } },
  publicDir: network === 'mainnet' ? 'public-mainnet' : 'public',
  base: './',
  server: { host: '127.0.0.1', port: 5179, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: { origin: 'http://127.0.0.1:8787' } }, '/rpc': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: { origin: 'http://127.0.0.1:8787' } } } },
  preview: { host: '127.0.0.1', port: 4179, strictPort: true },
}; });
