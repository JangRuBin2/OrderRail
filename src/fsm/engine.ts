/**
 * FSM Engine — the heart of OrderRail.
 *
 * dispatch() implements a 7-step flow combining:
 *   1. Distributed locking  (Redis / Redlock)   — prevents duplicate concurrent processing
 *   2. Transition validation (FSM table)          — rejects invalid state changes
 *   3. Guard evaluation      (business rules)     — e.g., idempotency checks
 *   4. Atomic DB update      (Prisma transaction) — status change + history record
 *   5. Optimistic locking    (version column)     — last-resort concurrency defense
 *   6. Post-commit actions   (side-effects)       — stock updates, timestamp stamps
 *   7. Lock release          (automatic via withOrderLock)
 */

import type { OrderEvent, OrderStatus, DispatchResult } from '@/types/order';
import {
  InvalidTransitionError,
  OptimisticLockError,
} from '@/types/order';
import { prisma } from '@/lib/prisma';
import { withOrderLock } from '@/lib/lock';
import { deleteIdempotencyKey } from '@/lib/idempotency';
import { resolveNextStatus } from './transitions';
import { runGuards } from './guards';
import { getActionForNextStatus } from './actions';

/**
 * Dispatches an event to an order's FSM.
 *
 * @param orderId - The Order.seqno (PK) as a number
 * @param event   - The event to dispatch
 * @returns       - DispatchResult with success flag, updated order snapshot, or error message
 */
export async function dispatch(
  orderId: number,
  event: OrderEvent
): Promise<DispatchResult> {
  const orderIdStr = String(orderId);

  try {
    return await withOrderLock(orderIdStr, async () => {
      // ── Step 1: Lock acquired (handled by withOrderLock) ───────────────────

      // ── Step 2: Load current order from DB ────────────────────────────────
      const order = await prisma.order.findUnique({
        where: { seqno: orderId },
        select: {
          seqno: true,
          orderStatus: true,
          version: true,
          paidAt: true,
          updatedAt: true,
        },
      });

      if (!order) {
        return {
          success: false,
          error: `Order ${orderId} not found`,
        };
      }

      const currentStatus = order.orderStatus as OrderStatus;

      // ── Step 3: Validate transition via FSM table ──────────────────────────
      const nextStatus = resolveNextStatus(currentStatus, event.type);
      if (!nextStatus) {
        throw new InvalidTransitionError(currentStatus, event.type);
      }

      // ── Step 4: Run guards (idempotency, business rules) ───────────────────
      await runGuards({ orderId, event });

      // ── Step 5: DB transaction — status update + history record ────────────
      // We use updateMany with a WHERE on version for optimistic locking.
      // updateMany returns { count: N } — if count === 0 another process
      // already bumped the version and we must retry.
      let updatedOrder: {
        seqno: number;
        orderStatus: OrderStatus;
        version: number;
        paidAt: Date | null;
        updatedAt: Date | null;
      } | null = null;

      try {
        const result = await prisma.$transaction(async (tx) => {
          // Build the data payload — include paidAt when transitioning to PAID
          const updateData: Record<string, unknown> = {
            orderStatus: nextStatus,
            version: { increment: 1 },
          };

          if (nextStatus === 'PAID') {
            updateData.paidAt = new Date();
            updateData.paymentDate = new Date();
          }

          // Optimistic lock: only update if version hasn't changed
          const updateResult = await tx.order.updateMany({
            where: {
              seqno: orderId,
              version: order.version,
            },
            data: updateData,
          });

          // ── Step 6: Detect optimistic lock failure ─────────────────────────
          if (updateResult.count === 0) {
            throw new OptimisticLockError(orderId);
          }

          // Insert status history record
          await tx.orderStatusHistory.create({
            data: {
              orderSeqno: orderId,
              pastStatus: currentStatus,
              currentStatus: nextStatus,
              eventType: event.type,
              eventPayload: event as object,
              result: 'SUCCESS',
            },
          });

          // Re-fetch the updated order to return a fresh snapshot
          const fresh = await tx.order.findUnique({
            where: { seqno: orderId },
            select: {
              seqno: true,
              orderStatus: true,
              version: true,
              paidAt: true,
              updatedAt: true,
            },
          });

          return fresh;
        });

        updatedOrder = result as typeof updatedOrder;
      } catch (txError) {
        // If the DB transaction fails AND we already consumed the idempotency
        // key in the guard, we need to roll it back so the caller can retry.
        if (event.type === 'PAYMENT_CONFIRMED') {
          await deleteIdempotencyKey(event.idempotencyKey).catch(() => {
            // Best-effort cleanup; log but don't mask the original error
            console.warn(
              '[FSM Engine] Failed to delete idempotency key after tx failure'
            );
          });
        }
        throw txError;
      }

      // ── Step 7: Run post-commit action ─────────────────────────────────────
      const action = getActionForNextStatus(nextStatus);
      if (action) {
        try {
          await action({
            orderId,
            event,
            previousStatus: currentStatus,
            nextStatus,
          });
        } catch (actionErr) {
          // Actions failing should NOT roll back the committed state transition.
          // Log the failure and (in production) enqueue a retry job.
          console.error(
            `[FSM Engine] Post-commit action for '${nextStatus}' failed:`,
            actionErr
          );
          // Return success but include a warning in the response
          return {
            success: true,
            order: updatedOrder ?? undefined,
            error: `Transition succeeded but post-commit action failed: ${(actionErr as Error).message}`,
          };
        }
      }

      // ── Lock released automatically by withOrderLock ───────────────────────
      return {
        success: true,
        order: updatedOrder ?? undefined,
      };
    });
  } catch (err) {
    if (
      err instanceof InvalidTransitionError ||
      err instanceof OptimisticLockError
    ) {
      return {
        success: false,
        error: err.message,
      };
    }

    // Re-throw unexpected errors (LockAcquisitionError, DB connection failures, etc.)
    // so the caller (API route) can handle them and return an appropriate HTTP status.
    throw err;
  }
}
