import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transitionTable, resolveNextStatus } from '../src/fsm/transitions';
import type { OrderStatus, OrderEventType } from '../src/types/order';
import {
  InvalidTransitionError,
  GuardFailedError,
} from '../src/types/order';

// ─── Transition Table Tests ───────────────────────────────────────────────────

describe('FSM Transition Table', () => {
  // All valid transitions as [from, event, to] tuples
  const validTransitions: [OrderStatus, OrderEventType, OrderStatus][] = [
    ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'PAID'],
    ['PENDING_PAYMENT', 'CANCEL', 'CANCELLED'],
    ['PAID', 'START_PREPARING', 'PREPARING'],
    ['PAID', 'CANCEL', 'CANCELLED'],
    ['PREPARING', 'SHIP', 'SHIPPING'],
    ['PREPARING', 'CANCEL', 'CANCELLED'],
    ['SHIPPING', 'CONFIRM_DELIVERY', 'DELIVERED'],
    ['DELIVERED', 'REQUEST_RETURN', 'RETURN_REQUESTED'],
    ['RETURN_REQUESTED', 'COMPLETE_RETURN', 'RETURNED'],
  ];

  it.each(validTransitions)(
    'allows %s + %s → %s',
    (from, event, expected) => {
      const next = resolveNextStatus(from, event);
      expect(next).toBe(expected);
    }
  );

  // Invalid transitions — events that should NOT be applicable
  const invalidTransitions: [OrderStatus, OrderEventType][] = [
    // Can't jump forward
    ['PENDING_PAYMENT', 'SHIP'],
    ['PENDING_PAYMENT', 'CONFIRM_DELIVERY'],
    ['PENDING_PAYMENT', 'REQUEST_RETURN'],
    ['PENDING_PAYMENT', 'COMPLETE_RETURN'],
    ['PAID', 'PAYMENT_CONFIRMED'],
    ['PAID', 'SHIP'],
    ['PAID', 'CONFIRM_DELIVERY'],
    ['PREPARING', 'PAYMENT_CONFIRMED'],
    ['PREPARING', 'CONFIRM_DELIVERY'],
    // Can't go backwards
    ['SHIPPING', 'CANCEL'],
    ['SHIPPING', 'START_PREPARING'],
    // Terminal states
    ['CANCELLED', 'PAYMENT_CONFIRMED'],
    ['CANCELLED', 'CANCEL'],
    ['CANCELLED', 'START_PREPARING'],
    ['RETURNED', 'COMPLETE_RETURN'],
    ['RETURNED', 'REQUEST_RETURN'],
    // DELIVERED can only REQUEST_RETURN — not be cancelled
    ['DELIVERED', 'CANCEL'],
    ['DELIVERED', 'CONFIRM_DELIVERY'],
  ];

  it.each(invalidTransitions)(
    'rejects %s + %s (returns undefined)',
    (from, event) => {
      const next = resolveNextStatus(from, event);
      expect(next).toBeUndefined();
    }
  );

  it('covers all defined statuses in the transition table', () => {
    const allStatuses: OrderStatus[] = [
      'PENDING_PAYMENT',
      'PAID',
      'PREPARING',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
      'RETURN_REQUESTED',
      'RETURNED',
    ];
    for (const status of allStatuses) {
      expect(transitionTable).toHaveProperty(status);
    }
  });

  it('CANCELLED and RETURNED have no outgoing transitions', () => {
    expect(Object.keys(transitionTable['CANCELLED'])).toHaveLength(0);
    expect(Object.keys(transitionTable['RETURNED'])).toHaveLength(0);
  });
});

// ─── Error Types Tests ────────────────────────────────────────────────────────

describe('Error Types', () => {
  it('InvalidTransitionError has correct name and message', () => {
    const err = new InvalidTransitionError('CANCELLED', 'PAYMENT_CONFIRMED');
    expect(err.name).toBe('InvalidTransitionError');
    expect(err.message).toContain('CANCELLED');
    expect(err.message).toContain('PAYMENT_CONFIRMED');
    expect(err).toBeInstanceOf(Error);
  });

  it('GuardFailedError has correct name and message', () => {
    const err = new GuardFailedError('key already used', 'PAYMENT_CONFIRMED');
    expect(err.name).toBe('GuardFailedError');
    expect(err.message).toContain('key already used');
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── Engine Dispatch (mocked) Tests ──────────────────────────────────────────

// We mock the external dependencies so we can test the engine logic without
// a real DB or Redis.

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    order: { findUnique: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../src/lib/lock', () => ({
  withOrderLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../src/lib/idempotency', () => ({
  ensureIdempotent: vi.fn(async () => true),
  deleteIdempotencyKey: vi.fn(async () => {}),
}));

vi.mock('../src/fsm/actions', () => ({
  getActionForNextStatus: vi.fn(() => undefined),
}));

describe('FSM Engine dispatch (mocked)', () => {
  // Import after mocks are set up
  let dispatch: typeof import('../src/fsm/engine').dispatch;
  let prisma: typeof import('../src/lib/prisma').prisma;
  let ensureIdempotent: typeof import('../src/lib/idempotency').ensureIdempotent;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import after resetting modules so mocks are applied fresh
    const engineMod = await import('../src/fsm/engine');
    const prismaMod = await import('../src/lib/prisma');
    const idempotencyMod = await import('../src/lib/idempotency');

    dispatch = engineMod.dispatch;
    prisma = prismaMod.prisma;
    ensureIdempotent = idempotencyMod.ensureIdempotent;
  });

  it('returns error when order is not found', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null);

    const result = await dispatch(999, { type: 'START_PREPARING' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error for invalid transition', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      seqno: 1,
      orderStatus: 'CANCELLED',
      version: 0,
      paidAt: null,
      updatedAt: null,
    } as any);

    const result = await dispatch(1, { type: 'PAYMENT_CONFIRMED', idempotencyKey: 'key-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid transition');
  });

  it('succeeds on a valid transition with mocked DB', async () => {
    const mockOrder = {
      seqno: 1,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    } as any;

    const updatedOrder = {
      seqno: 1,
      orderStatus: 'PAID',
      version: 1,
      paidAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder);

    // Mock $transaction to simulate a successful DB transaction
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: unknown) => {
      // Simulate the transaction callback — return the updated order
      const txMock = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue(updatedOrder),
        },
        orderStatusHistory: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      return (fn as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });

    const result = await dispatch(1, {
      type: 'PAYMENT_CONFIRMED',
      idempotencyKey: 'unique-key-1',
    });

    expect(result.success).toBe(true);
    expect(result.order?.orderStatus).toBe('PAID');
    expect(result.order?.version).toBe(1);
  });

  it('returns error when optimistic lock fails (0 rows updated)', async () => {
    const mockOrder = {
      seqno: 2,
      orderStatus: 'PAID',
      version: 5,
      paidAt: new Date(),
      updatedAt: new Date(),
    } as any;

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder);

    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: unknown) => {
      const txMock = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // conflict!
          findUnique: vi.fn(),
        },
        orderStatusHistory: {
          create: vi.fn(),
        },
      };
      return (fn as (tx: typeof txMock) => Promise<unknown>)(txMock);
    });

    const result = await dispatch(2, { type: 'START_PREPARING' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Optimistic lock conflict');
  });

  it('rejects duplicate idempotency key', async () => {
    const mockOrder = {
      seqno: 3,
      orderStatus: 'PENDING_PAYMENT',
      version: 0,
      paidAt: null,
      updatedAt: null,
    } as any;

    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder);
    // Override ensureIdempotent to return false (already used)
    vi.mocked(ensureIdempotent).mockResolvedValueOnce(false);

    let threw = false;
    let thrownError: Error | null = null;
    try {
      await dispatch(3, {
        type: 'PAYMENT_CONFIRMED',
        idempotencyKey: 'duplicate-key',
      });
    } catch (err) {
      threw = true;
      thrownError = err as Error;
    }

    // GuardFailedError is thrown and propagates out of dispatch
    expect(threw).toBe(true);
    expect(thrownError?.name).toBe('GuardFailedError');
  });
});
