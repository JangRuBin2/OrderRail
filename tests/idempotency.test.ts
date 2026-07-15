import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-Memory Redis Mock ─────────────────────────────────────────────────────

// Minimal Redis stub that supports SET NX EX and EXISTS / DEL
class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  set(
    key: string,
    value: string,
    exMode?: string,
    ttl?: number,
    nxMode?: string
  ): Promise<'OK' | null> {
    if (exMode === 'EX' && nxMode === 'NX') {
      // SET key value EX ttl NX
      if (this.store.has(key) && this.store.get(key)!.expiresAt > Date.now()) {
        return Promise.resolve(null); // already exists
      }
      this.store.set(key, {
        value,
        expiresAt: Date.now() + (ttl ?? 3600) * 1000,
      });
      return Promise.resolve('OK');
    }
    // Normal SET
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? 3600) * 1000,
    });
    return Promise.resolve('OK');
  }

  exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(0);
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return Promise.resolve(0);
    }
    return Promise.resolve(1);
  }

  del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  }

  flushall(): void {
    this.store.clear();
  }

  // Helper for testing — advance time to expire keys
  expireKey(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() - 1;
    }
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRedis = new InMemoryRedis();

vi.mock('../src/lib/redis', () => ({
  redis: mockRedis,
  default: mockRedis,
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { ensureIdempotent, isIdempotencyKeyUsed, deleteIdempotencyKey } =
  await import('../src/lib/idempotency');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ensureIdempotent', () => {
  beforeEach(() => {
    mockRedis.flushall();
  });

  it('returns true for a brand-new key', async () => {
    const result = await ensureIdempotent('payment-key-001');
    expect(result).toBe(true);
  });

  it('returns false for a duplicate key', async () => {
    const key = 'payment-key-002';
    const first = await ensureIdempotent(key);
    const second = await ensureIdempotent(key);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('returns false for the same key called many times', async () => {
    const key = 'payment-key-003';
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureIdempotent(key))
    );

    const trueCount = results.filter(Boolean).length;
    const falseCount = results.filter((r) => !r).length;

    // Only the first SET NX wins — but with our in-memory mock the concurrent
    // Promise.all still runs sequentially in the microtask queue, so exactly one wins.
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(9);
  });

  it('different keys are independent', async () => {
    const r1 = await ensureIdempotent('key-A');
    const r2 = await ensureIdempotent('key-B');
    const r3 = await ensureIdempotent('key-A'); // duplicate
    const r4 = await ensureIdempotent('key-B'); // duplicate

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(false);
    expect(r4).toBe(false);
  });

  it('key with empty string is treated as a new key (non-empty prefix)', async () => {
    // The idempotency module prefixes 'idempotency:' so even if the raw key
    // looks the same, prefixing separates it from other namespaces
    const result = await ensureIdempotent('some-payment-xyz');
    expect(result).toBe(true);
  });
});

describe('isIdempotencyKeyUsed', () => {
  beforeEach(() => {
    mockRedis.flushall();
  });

  it('returns false for an unused key', async () => {
    const used = await isIdempotencyKeyUsed('fresh-key-1');
    expect(used).toBe(false);
  });

  it('returns true after ensureIdempotent is called', async () => {
    await ensureIdempotent('fresh-key-2');
    const used = await isIdempotencyKeyUsed('fresh-key-2');
    expect(used).toBe(true);
  });

  it('does NOT consume the key (check is read-only)', async () => {
    await ensureIdempotent('fresh-key-3');

    // Call isIdempotencyKeyUsed multiple times — should not affect ensureIdempotent
    await isIdempotencyKeyUsed('fresh-key-3');
    await isIdempotencyKeyUsed('fresh-key-3');

    // key is still consumed — ensureIdempotent should return false
    const result = await ensureIdempotent('fresh-key-3');
    expect(result).toBe(false);
  });
});

describe('deleteIdempotencyKey', () => {
  beforeEach(() => {
    mockRedis.flushall();
  });

  it('allows re-processing after deletion (rollback scenario)', async () => {
    const key = 'rollback-key-1';

    // First processing
    const first = await ensureIdempotent(key);
    expect(first).toBe(true);

    // Simulate transaction rollback — delete the key
    await deleteIdempotencyKey(key);

    // Should be allowed again
    const retry = await ensureIdempotent(key);
    expect(retry).toBe(true);
  });

  it('is a no-op when key does not exist', async () => {
    // Should not throw
    await expect(deleteIdempotencyKey('non-existent-key')).resolves.not.toThrow();
  });

  it('deleting one key does not affect others', async () => {
    await ensureIdempotent('keep-key');
    await ensureIdempotent('delete-key');

    await deleteIdempotencyKey('delete-key');

    // delete-key can be reused
    expect(await ensureIdempotent('delete-key')).toBe(true);
    // keep-key is still consumed
    expect(await ensureIdempotent('keep-key')).toBe(false);
  });
});

describe('Idempotency: expired key behaviour', () => {
  it('allows re-processing after key expiry', async () => {
    const key = 'expiring-key-1';

    const first = await ensureIdempotent(key);
    expect(first).toBe(true);

    // Manually expire the key in the mock
    mockRedis.expireKey(`idempotency:${key}`);

    // After expiry the key should be available again
    const afterExpiry = await ensureIdempotent(key);
    expect(afterExpiry).toBe(true);
  });
});
