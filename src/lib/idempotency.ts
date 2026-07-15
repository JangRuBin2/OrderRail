import { redis } from '@/lib/redis';

const IDEMPOTENCY_TTL_SECONDS = 3600; // 1 hour

/**
 * Ensures a given idempotency key is only processed once within the TTL window.
 *
 * Uses Redis SET NX EX so the operation is atomic — even under concurrent
 * requests only one will receive `true` (first-time) and the rest `false`.
 *
 * @param key - Unique idempotency key supplied by the caller (e.g., PG webhook's paymentKey)
 * @returns `true` if this is the FIRST time we've seen this key (proceed),
 *          `false` if the key already exists (duplicate — skip processing)
 */
export async function ensureIdempotent(key: string): Promise<boolean> {
  const redisKey = `idempotency:${key}`;

  // SET key value NX EX seconds
  // Returns "OK" if key was set (first time), null if key already existed
  const result = await redis.set(
    redisKey,
    '1',
    'EX',
    IDEMPOTENCY_TTL_SECONDS,
    'NX'
  );

  return result === 'OK';
}

/**
 * Checks whether an idempotency key exists without consuming it.
 * Useful for inspection / debugging.
 */
export async function isIdempotencyKeyUsed(key: string): Promise<boolean> {
  const redisKey = `idempotency:${key}`;
  const exists = await redis.exists(redisKey);
  return exists === 1;
}

/**
 * Deletes an idempotency key (e.g., when rolling back a failed transaction).
 * Use with care — this allows the same key to be reprocessed.
 */
export async function deleteIdempotencyKey(key: string): Promise<void> {
  const redisKey = `idempotency:${key}`;
  await redis.del(redisKey);
}
