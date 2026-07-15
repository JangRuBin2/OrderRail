import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory order store ────────────────────────────────────────────────────

interface InMemoryOrder {
  seqno: number;
  orderStatus: string;
  version: number;
  paidAt: Date | null;
  updatedAt: Date | null;
}

function makeOrderStore(initial: InMemoryOrder) {
  let order: InMemoryOrder = { ...initial };

  return {
    getOrder: () => ({ ...order }),
    /**
     * Attempts an optimistic update.
     * Returns true if the version matched (update succeeded), false otherwise.
     */
    tryUpdate: (expectedVersion: number, nextStatus: string): boolean => {
      if (order.version !== expectedVersion) return false;
      order = {
        ...order,
        orderStatus: nextStatus,
        version: order.version + 1,
        updatedAt: new Date(),
        ...(nextStatus === 'PAID' ? { paidAt: new Date() } : {}),
      };
      return true;
    },
  };
}

// ─── In-memory lock ────────────────────────────────────────────────────────────

function makeInMemoryLock() {
  let locked = false;
  const queue: Array<() => void> = [];

  return {
    acquire: (): Promise<() => void> => {
      return new Promise((resolve) => {
        const tryAcquire = () => {
          if (!locked) {
            locked = true;
            resolve(() => {
              locked = false;
              const next = queue.shift();
              if (next) next();
            });
          } else {
            queue.push(tryAcquire);
          }
        };
        tryAcquire();
      });
    },
  };
}

// ─── Stub dispatch factory ────────────────────────────────────────────────────

/**
 * Creates a minimal stub dispatch function that mirrors the engine's logic
 * using in-memory state.  This lets us test the concurrency properties
 * without touching Redis or PostgreSQL.
 */
function makeStubDispatch(
  store: ReturnType<typeof makeOrderStore>,
  lock: ReturnType<typeof makeInMemoryLock>,
  transitionFn: (status: string, event: string) => string | undefined
) {
  return async function dispatch(
    orderId: number,
    event: { type: string; idempotencyKey?: string }
  ): Promise<{ success: boolean; order?: InMemoryOrder; error?: string }> {
    const release = await lock.acquire();
    try {
      // Load
      const order = store.getOrder();

      // Validate transition
      const nextStatus = transitionFn(order.orderStatus, event.type);
      if (!nextStatus) {
        return {
          success: false,
          error: `Invalid transition: ${order.orderStatus} + ${event.type}`,
        };
      }

      // Simulate async work (e.g., DB round-trip)
      await new Promise((r) => setTimeout(r, 10));

      // Optimistic update
      const updated = store.tryUpdate(order.version, nextStatus);
      if (!updated) {
        return {
          success: false,
          error: `Optimistic lock conflict: order ${orderId} was modified concurrently`,
        };
      }

      return { success: true, order: store.getOrder() };
    } finally {
      release();
    }
  };
}

// ─── Transition stubs ─────────────────────────────────────────────────────────

const simpleTransition = (status: string, event: string): string | undefined => {
  const table: Record<string, Record<string, string>> = {
    PENDING_PAYMENT: {
      PAYMENT_CONFIRMED: 'PAID',
      CANCEL: 'CANCELLED',
    },
    PAID: {
      START_PREPARING: 'PREPARING',
      CANCEL: 'CANCELLED',
    },
    PREPARING: {
      SHIP: 'SHIPPING',
    },
  };
  return table[status]?.[event];
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Concurrency: distributed lock serialises requests', () => {
  it('only one concurrent PAYMENT_CONFIRMED succeeds, rest get lock-serialised result', async () => {
    const store = makeOrderStore({
      seqno: 1,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    });
    const lock = makeInMemoryLock();
    const dispatch = makeStubDispatch(store, lock, simpleTransition);

    // Fire 5 concurrent PAYMENT_CONFIRMED events
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        dispatch(1, { type: 'PAYMENT_CONFIRMED', idempotencyKey: 'key-1' })
      )
    );

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    // Exactly one should succeed — the lock serialises them so the first
    // succeeds; the remaining 4 see PAID status and fail the transition.
    // (In our stub the lock is mutex, so they run sequentially — first gets
    // PENDING_PAYMENT→PAID, subsequent ones see PAID + PAYMENT_CONFIRMED = invalid)
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);
    expect(failures[0].error).toContain('Invalid transition');

    // Final state should be PAID with version 1
    const finalOrder = store.getOrder();
    expect(finalOrder.orderStatus).toBe('PAID');
    expect(finalOrder.version).toBe(1);
  });

  it('sequential valid transitions work correctly', async () => {
    const store = makeOrderStore({
      seqno: 2,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    });
    const lock = makeInMemoryLock();
    const dispatch = makeStubDispatch(store, lock, simpleTransition);

    const r1 = await dispatch(2, { type: 'PAYMENT_CONFIRMED' });
    expect(r1.success).toBe(true);
    expect(r1.order?.orderStatus).toBe('PAID');
    expect(r1.order?.version).toBe(1);

    const r2 = await dispatch(2, { type: 'START_PREPARING' });
    expect(r2.success).toBe(true);
    expect(r2.order?.orderStatus).toBe('PREPARING');
    expect(r2.order?.version).toBe(2);

    const r3 = await dispatch(2, { type: 'SHIP' });
    expect(r3.success).toBe(true);
    expect(r3.order?.orderStatus).toBe('SHIPPING');
    expect(r3.order?.version).toBe(3);
  });

  it('all-concurrent invalid transitions all fail', async () => {
    const store = makeOrderStore({
      seqno: 3,
      orderStatus: 'CANCELLED',
      version: 2,
      paidAt: null,
      updatedAt: null,
    });
    const lock = makeInMemoryLock();
    const dispatch = makeStubDispatch(store, lock, simpleTransition);

    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        dispatch(3, { type: 'PAYMENT_CONFIRMED' })
      )
    );

    expect(results.every((r) => !r.success)).toBe(true);
    // State unchanged
    expect(store.getOrder().version).toBe(2);
  });
});

describe('Concurrency: optimistic locking without distributed lock', () => {
  /**
   * This tests the optimistic lock in isolation — simulates what would happen
   * if two processes bypassed the distributed lock and tried to update
   * simultaneously.  Only the one whose expectedVersion matches wins.
   */
  it('detects stale version and rejects second writer', async () => {
    const store = makeOrderStore({
      seqno: 4,
      orderStatus: 'PAID',
      version: 3,
      paidAt: new Date(),
      updatedAt: null,
    });

    // Simulate two processes reading the same state simultaneously
    const version = store.getOrder().version;

    // Process A updates successfully
    const aSuccess = store.tryUpdate(version, 'PREPARING');
    expect(aSuccess).toBe(true);
    expect(store.getOrder().version).toBe(4);

    // Process B tries to update with the SAME (now stale) version
    const bSuccess = store.tryUpdate(version, 'PREPARING');
    expect(bSuccess).toBe(false); // rejected — version was already incremented

    // Version should still be 4 (not 5)
    expect(store.getOrder().version).toBe(4);
    expect(store.getOrder().orderStatus).toBe('PREPARING');
  });

  it('concurrent writers — only one wins', async () => {
    const store = makeOrderStore({
      seqno: 5,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    });

    // All 10 concurrent "processes" read version=0 at the same time
    const snapshotVersion = store.getOrder().version;

    const results = Array.from({ length: 10 }, () =>
      store.tryUpdate(snapshotVersion, 'PAID')
    );

    const wins = results.filter(Boolean);
    const losses = results.filter((r) => !r);

    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(9);
    expect(store.getOrder().version).toBe(1);
  });
});

describe('Concurrency: different orders do not interfere', () => {
  it('concurrent events on different orders succeed independently', async () => {
    // Create two independent order stores
    const store1 = makeOrderStore({
      seqno: 10,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    });
    const store2 = makeOrderStore({
      seqno: 11,
      orderStatus: 'PAID',
      version: 1,
      paidAt: new Date(),
      updatedAt: null,
    });

    const lock1 = makeInMemoryLock();
    const lock2 = makeInMemoryLock();

    const dispatch1 = makeStubDispatch(store1, lock1, simpleTransition);
    const dispatch2 = makeStubDispatch(store2, lock2, simpleTransition);

    // Fire concurrently on different orders
    const [r1, r2] = await Promise.all([
      dispatch1(10, { type: 'PAYMENT_CONFIRMED' }),
      dispatch2(11, { type: 'START_PREPARING' }),
    ]);

    expect(r1.success).toBe(true);
    expect(r1.order?.orderStatus).toBe('PAID');

    expect(r2.success).toBe(true);
    expect(r2.order?.orderStatus).toBe('PREPARING');
  });
});
