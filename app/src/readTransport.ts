import { custom, type EIP1193Provider, type Transport } from 'viem'

// This transport is never used to sign or submit a transaction.
const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getLogs', 'eth_getTransactionReceipt',
  'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_feeHistory'])
export type WalletReadEvent = { kind: 'call' | 'success' | 'rejected'; method: string }
  | { kind: 'fallback'; reason: 'no_wallet' | 'wrong_chain' | 'unavailable' | 'timeout' | 'context_changed' }
export function walletReadTransport(chainId: number, provider: () => EIP1193Provider | undefined,
  fallback: (request: { method: string; params?: unknown }) => Promise<unknown>, timeoutMs = 2000, observe?: (event: WalletReadEvent) => void): Transport {
  const pending = new Map<string, Promise<unknown>>()
  return custom({ request: (request: { method: string; params?: unknown }) => {
    if (!reads.has(request.method)) return Promise.reject(new Error('Read-only transport'))
    const key = JSON.stringify(request)
    const existing = pending.get(key)
    if (existing) return existing
    const result = (async () => {
      const wallet = provider()
      let reason: Extract<WalletReadEvent, { kind: 'fallback' }>['reason'] = 'no_wallet'
      if (wallet) {
        try {
          const bounded = async (input: { method: string; params?: unknown }) => {
            observe?.({ kind: 'call', method: input.method })
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              return await Promise.race([wallet.request(input as never), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Wallet read timed out')), timeoutMs)
              })])
            } finally { clearTimeout(timer) }
          }
          const selected = await bounded({ method: 'eth_chainId' })
          if (Number(selected) === chainId && wallet === provider()) {
            const value = request.method === 'eth_chainId' ? selected : await bounded(request)
            if (wallet !== provider()) throw new Error('Wallet context changed')
            observe?.({ kind: 'success', method: request.method })
            return value
          }
          reason = wallet !== provider() ? 'context_changed' : 'wrong_chain'
        } catch (error) {
          const e = error as { code?: number; message?: string }
          // A completed EVM rejection is a business result, not a broken provider.
          // Preserve it instead of spending quota repeating an invalid preflight.
          if (e.code === 3 || /execution reverted|insufficient funds|VM Exception.*revert/i.test(e.message ?? '')) {
            observe?.({ kind: 'rejected', method: request.method }); throw error
          }
          reason = e.message === 'Wallet read timed out' ? 'timeout' : e.message === 'Wallet context changed' ? 'context_changed' : 'unavailable'
          /* An unsupported/unavailable wallet read can use the fixed public RPC. */
        }
      }
      observe?.({ kind: 'fallback', reason })
      return fallback(request)
    })()
    pending.set(key, result)
    void result.finally(() => { if (pending.get(key) === result) pending.delete(key) }).catch(() => {})
    return result
  } }, { retryCount: 0 })
}

/** Lifecycle cache. Failed reads are never cached; concurrent consumers share one request. */
export function createReadCache(now = Date.now) {
  const entries = new Map<string, { expires: number; value?: unknown; pending?: Promise<unknown> }>()
  return {
    read<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
      const old = entries.get(key)
      if (old?.pending) return old.pending as Promise<T>
      if (old && old.expires > now()) return Promise.resolve(old.value as T)
      const entry: { expires: number; value?: unknown; pending?: Promise<T> } = { expires: 0 }
      const pending = load().then(value => { entry.value = value; entry.expires = now() + ttl; entry.pending = undefined; return value })
        .catch(error => { if (entries.get(key) === entry) entries.delete(key); throw error })
      entry.pending = pending; entries.set(key, entry)
      return pending
    },
    clear() { entries.clear() },
  }
}
