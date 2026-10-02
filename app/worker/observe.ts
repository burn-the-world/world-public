// Low-cardinality structured logs for existing Cloudflare Workers observability.
// Never accept a request, URL, RPC parameters, address, hash or raw error here.
export const sharedResources = ['world-snapshot', 'profiles', 'constants', 'leaderboard'] as const
export function observeCache(resource: string, cache: 'HIT' | 'MISS' | 'COALESCED' | 'STALE' | 'BOOTSTRAP', status: number, latencyMs: number) {
  if (!(sharedResources as readonly string[]).includes(resource)) return
  console.log({ event: 'world_cache', resource, cache, status, latencyMs: Math.round(latencyMs) })
}
export function observeUpstream(rpcCalls: number, status: number, latencyMs: number) {
  console.log({ event: 'world_upstream', httpRequests: 1, rpcCalls, status, latencyMs: Math.round(latencyMs) })
}
export function observeLeaderboard(checkpoint: bigint, through: bigint, target: bigint, events: number, complete: boolean, latencyMs: number) {
  console.log({ event: 'world_leaderboard', checkpoint: checkpoint.toString(), indexedThroughBlock: through.toString(), target: target.toString(),
    blocksScanned: (through - checkpoint).toString(), events, complete, latencyMs: Math.round(latencyMs) })
}
