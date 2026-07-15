import Redis from 'ioredis';
import Redlock from 'redlock';
import { LockAcquisitionError } from '@/types/order';

// Redlock requires its own Redis connection(s) — do NOT share with the
// application Redis client because Redlock uses blocking WAIT semantics.

function createRedlockClient(): Redlock {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  // For a single-node Redis setup one client is sufficient.
  // In a multi-node / Redis Cluster setup you would pass multiple clients.
  const lockRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: 0, // Redlock manages its own retries
    enableReadyCheck: false,
    lazyConnect: false,
  });

  lockRedis.on('error', (err: Error) => {
    console.error('[Redlock Redis] connection error:', err.message);
  });

  return new Redlock([lockRedis], {
    // The expected clock drift; for a single node this is effectively 0.
    driftFactor: 0.01,
    // How many times to retry before giving up
    retryCount: 3,
    // Milliseconds between retries
    retryDelay: 200,
    // Random jitter to add on top of retryDelay (ms)
    retryJitter: 100,
    // Minimum remaining TTL on the lock before Redlock considers it expired
    automaticExtensionThreshold: 500,
  });
}

const globalForRedlock = globalThis as unknown as {
  redlock: Redlock | undefined;
};

export const redlock: Redlock =
  globalForRedlock.redlock ?? createRedlockClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedlock.redlock = redlock;
}

/**
 * Acquires a distributed Redis lock scoped to a single order and executes
 * the provided callback within that lock.  The lock is automatically released
 * when the callback resolves or rejects.
 *
 * @param orderId - The numeric order primary key (seqno)
 * @param fn      - Async work to perform while holding the lock
 * @returns       - Whatever `fn` returns
 * @throws LockAcquisitionError when the lock cannot be acquired after retries
 */
export async function withOrderLock<T>(
  orderId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = `lock:order:${orderId}`;
  // TTL of 5 seconds — long enough for a DB round-trip but short enough to
  // avoid stuck locks if the process crashes.
  const ttl = 5_000;

  let lock;
  try {
    lock = await redlock.acquire([lockKey], ttl);
  } catch (err) {
    throw new LockAcquisitionError(orderId);
  }

  try {
    return await fn();
  } finally {
    try {
      await lock.release();
    } catch (releaseErr) {
      // Releasing can fail if the lock already expired (e.g., slow operation).
      // This is safe to ignore — the TTL will expire the key automatically.
      console.warn('[Redlock] lock release failed (TTL expired?):', releaseErr);
    }
  }
}
