import type { OrderEvent } from '@/types/order';
import { GuardFailedError } from '@/types/order';
import { ensureIdempotent } from '@/lib/idempotency';

/**
 * Guard context passed to each guard function.
 * Guards receive the current order's DB row plus the incoming event.
 */
export interface GuardContext {
  orderId: number;
  event: OrderEvent;
}

/**
 * A guard is an async predicate that throws GuardFailedError when the
 * transition should be blocked, and resolves normally when it should proceed.
 */
export type Guard = (ctx: GuardContext) => Promise<void>;

// ─── Individual Guards ────────────────────────────────────────────────────────

/**
 * PAYMENT_CONFIRMED guard: ensures the payment idempotency key has not been
 * processed before.  Uses Redis SET NX so the check-and-mark is atomic.
 *
 * If this guard passes (first time), the key is consumed.  If the DB
 * transaction later fails, the caller is responsible for deleting the key
 * (see engine.ts) to allow retries.
 */
export async function guardPaymentConfirmed(ctx: GuardContext): Promise<void> {
  if (ctx.event.type !== 'PAYMENT_CONFIRMED') return;

  const { idempotencyKey } = ctx.event;

  if (!idempotencyKey || idempotencyKey.trim() === '') {
    throw new GuardFailedError(
      'idempotencyKey is required for PAYMENT_CONFIRMED',
      'PAYMENT_CONFIRMED'
    );
  }

  const isFirst = await ensureIdempotent(idempotencyKey);
  if (!isFirst) {
    throw new GuardFailedError(
      `Payment with idempotencyKey '${idempotencyKey}' has already been processed`,
      'PAYMENT_CONFIRMED'
    );
  }
}

/**
 * SHIP guard: ensures a tracking number is provided.
 */
export async function guardShip(ctx: GuardContext): Promise<void> {
  if (ctx.event.type !== 'SHIP') return;

  const { trackingNumber } = ctx.event;
  if (!trackingNumber || trackingNumber.trim() === '') {
    throw new GuardFailedError(
      'trackingNumber is required for SHIP event',
      'SHIP'
    );
  }
}

/**
 * CANCEL guard: ensures a cancellation reason is provided.
 */
export async function guardCancel(ctx: GuardContext): Promise<void> {
  if (ctx.event.type !== 'CANCEL') return;

  const { reason } = ctx.event;
  if (!reason || reason.trim() === '') {
    throw new GuardFailedError('reason is required for CANCEL event', 'CANCEL');
  }
}

/**
 * REQUEST_RETURN guard: ensures a return reason is provided.
 */
export async function guardRequestReturn(ctx: GuardContext): Promise<void> {
  if (ctx.event.type !== 'REQUEST_RETURN') return;

  const { reason } = ctx.event;
  if (!reason || reason.trim() === '') {
    throw new GuardFailedError(
      'reason is required for REQUEST_RETURN event',
      'REQUEST_RETURN'
    );
  }
}

// ─── Guard Registry ───────────────────────────────────────────────────────────

/**
 * Returns the list of guards to run for a given event type.
 * Guards are executed sequentially — the first failure short-circuits.
 */
export function getGuardsForEvent(event: OrderEvent): Guard[] {
  switch (event.type) {
    case 'PAYMENT_CONFIRMED':
      return [guardPaymentConfirmed];
    case 'SHIP':
      return [guardShip];
    case 'CANCEL':
      return [guardCancel];
    case 'REQUEST_RETURN':
      return [guardRequestReturn];
    default:
      return [];
  }
}

/**
 * Run all guards for the given event.  Throws GuardFailedError on first failure.
 */
export async function runGuards(ctx: GuardContext): Promise<void> {
  const guards = getGuardsForEvent(ctx.event);
  for (const guard of guards) {
    await guard(ctx);
  }
}
