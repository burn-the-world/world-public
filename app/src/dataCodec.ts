/** Exact integer wire format, shared by public snapshots and operator checkpoints. */
export function serializeData(value: unknown): string {
  return JSON.stringify(value, (_, value) => typeof value === 'bigint' ? { $worldBigint: value.toString() } : value)
}
export function parseData(text: string): unknown {
  return JSON.parse(text, (_, value) => {
    if (value && typeof value === 'object' && '$worldBigint' in value) {
      if (Object.keys(value).length !== 1 || !/^\d+$/.test(value.$worldBigint)) throw new Error('Invalid integer encoding')
      return BigInt(value.$worldBigint)
    }
    return value
  })
}
