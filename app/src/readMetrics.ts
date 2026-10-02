import type { WalletReadEvent } from './readTransport'

// Bounded counters only. No addresses, request bodies, URLs or errors are retained.
// This object stays in browser memory and is never sent to a telemetry endpoint.
export function createReadMetrics() {
  let startedAt = Date.now()
  let walletCalls = 0, walletSuccess = 0, walletFallback = 0, walletRejected = 0
  let http = 0, rpcHttp = 0, sharedHttp = 0, failedHttp = 0, totalMs = 0, longestMs = 0
  const cache = { HIT: 0, MISS: 0, COALESCED: 0, STALE: 0, BOOTSTRAP: 0 }
  const methods: Record<string, number> = {}, fallbackReasons: Record<string, number> = {}
  return {
    wallet(event: WalletReadEvent) {
      if (event.kind === 'call') { ++walletCalls; methods[event.method] = (methods[event.method] ?? 0) + 1 }
      if (event.kind === 'success') ++walletSuccess
      if (event.kind === 'rejected') ++walletRejected
      if (event.kind === 'fallback') { ++walletFallback; fallbackReasons[event.reason] = (fallbackReasons[event.reason] ?? 0) + 1 }
    },
    fetch(request: typeof fetch = fetch): typeof fetch {
      return async (input, init) => {
        ++http
        // Only a fixed endpoint class survives this local variable.
        const path = new URL(input instanceof Request ? input.url : String(input), 'https://internal.invalid').pathname
        if (path === '/rpc') ++rpcHttp
        else if (path.startsWith('/api/')) ++sharedHttp
        const start = performance.now()
        try {
          const response = await request(input, init)
          if (!response.ok) ++failedHttp
          const hit = response.headers.get('x-world-cache')
          if (hit === 'HIT' || hit === 'MISS' || hit === 'COALESCED' || hit === 'STALE' || hit === 'BOOTSTRAP') ++cache[hit]
          return response
        } catch (error) { ++failedHttp; throw error }
        finally { const elapsed = performance.now() - start; totalMs += elapsed; longestMs = Math.max(longestMs, elapsed) }
      }
    },
    snapshot() {
      return { startedAt, wallet: { calls: walletCalls, success: walletSuccess, fallback: walletFallback,
        rejected: walletRejected, methods: { ...methods }, fallbackReasons: { ...fallbackReasons } },
        browser: { http, rpcHttp, sharedHttp, failedHttp, totalMs, longestMs, cache: { ...cache } } }
    },
    reset() {
      startedAt = Date.now(); walletCalls = walletSuccess = walletFallback = walletRejected = 0
      http = rpcHttp = sharedHttp = failedHttp = totalMs = longestMs = 0
      cache.HIT = cache.MISS = cache.COALESCED = cache.STALE = cache.BOOTSTRAP = 0
      for (const key of Object.keys(methods)) delete methods[key]
      for (const key of Object.keys(fallbackReasons)) delete fallbackReasons[key]
    },
  }
}
