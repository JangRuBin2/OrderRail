import type { OrderEvent, OrderStatus } from '@/types/order';
import { prisma } from '@/lib/prisma';

/**
 * Action context passed to each action function.
 */
export interface ActionContext {
  orderId: number;
  event: OrderEvent;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
}

/**
 * An action is an async side-effect that runs AFTER the DB transition has been
 * committed.  Actions should be idempotent — if they fail the order is already
 * in the new state; the action may be retried externally (e.g., via BullMQ).
 */
export type Action = (ctx: ActionContext) => Promise<void>;

// ─── Individual Actions ───────────────────────────────────────────────────────

/**
 * On entering PAID: record the payment timestamp on the order row.
 * Note: paidAt is also set inside the engine's DB transaction; this action
 * exists as a hook point for additional side-effects (e.g., sending a receipt).
 */
export async function actionOnPaid(ctx: ActionContext): Promise<void> {
  // paidAt is already set in the atomic DB transaction inside engine.ts.
  // This action can be extended to, for example, enqueue a receipt email job.
  console.info(
    `[FSM Action] Order ${ctx.orderId} paid. Side-effects complete.`
  );
}

/**
 * On entering PREPARING: decrement stock for each OrderDetail SKU.
 * Uses a transaction to ensure all-or-nothing stock updates.
 */
export async function actionOnPreparing(ctx: ActionContext): Promise<void> {
  // Fetch all order details for this order
  const details = await prisma.orderDetail.findMany({
    where: { orderSeqno: ctx.orderId },
    select: { orderSku: true, quantity: true },
  });

  // Decrement stock for each SKU that has a valid quantity
  const updates = details
    .filter((d) => d.orderSku && d.quantity && d.quantity > 0)
    .map((d) =>
      prisma.productSku.updateMany({
        where: { sku: d.orderSku! },
        data: {
          stock: { decrement: d.quantity! },
          orderCnt: { increment: d.quantity! },
        },
      })
    );

  if (updates.length > 0) {
    await prisma.$transaction(updates);
    console.info(
      `[FSM Action] Order ${ctx.orderId}: decremented stock for ${updates.length} SKU(s).`
    );
  }
}

/**
 * On entering SHIPPING: record the tracking number on each OrderDetail.
 */
export async function actionOnShipping(ctx: ActionContext): Promise<void> {
  if (ctx.event.type !== 'SHIP') return;

  const { trackingNumber } = ctx.event;
  await prisma.orderDetail.updateMany({
    where: { orderSeqno: ctx.orderId },
    data: { deliveryNum: trackingNumber, departedAt: new Date() },
  });

  console.info(
    `[FSM Action] Order ${ctx.orderId}: tracking number '${trackingNumber}' recorded.`
  );
}

/**
 * On entering DELIVERED: stamp deliveredAt on each OrderDetail.
 */
export async function actionOnDelivered(ctx: ActionContext): Promise<void> {
  await prisma.orderDetail.updateMany({
    where: { orderSeqno: ctx.orderId },
    data: { deliveredAt: new Date() },
  });

  console.info(
    `[FSM Action] Order ${ctx.orderId}: delivery confirmed, deliveredAt stamped.`
  );
}

/**
 * On entering CANCELLED: restore stock if we were past PREPARING.
 */
export async function actionOnCancelled(ctx: ActionContext): Promise<void> {
  // Only restore stock if items were already reserved (PREPARING or beyond)
  const stockWasReserved: OrderStatus[] = ['PREPARING', 'SHIPPING'];
  if (!stockWasReserved.includes(ctx.previousStatus)) return;

  const details = await prisma.orderDetail.findMany({
    where: { orderSeqno: ctx.orderId },
    select: { orderSku: true, quantity: true },
  });

  const updates = details
    .filter((d) => d.orderSku && d.quantity && d.quantity > 0)
    .map((d) =>
      prisma.productSku.updateMany({
        where: { sku: d.orderSku! },
        data: {
          stock: { increment: d.quantity! },
          orderCnt: { decrement: d.quantity! },
        },
      })
    );

  if (updates.length > 0) {
    await prisma.$transaction(updates);
    console.info(
      `[FSM Action] Order ${ctx.orderId}: stock restored after cancellation.`
    );
  }
}

/**
 * On entering RETURNED: restore stock and stamp processedAt.
 */
export async function actionOnReturned(ctx: ActionContext): Promise<void> {
  const details = await prisma.orderDetail.findMany({
    where: { orderSeqno: ctx.orderId },
    select: { orderSku: true, quantity: true },
  });

  const updates = details
    .filter((d) => d.orderSku && d.quantity && d.quantity > 0)
    .map((d) =>
      prisma.productSku.updateMany({
        where: { sku: d.orderSku! },
        data: {
          stock: { increment: d.quantity! },
        },
      })
    );

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  await prisma.orderDetail.updateMany({
    where: { orderSeqno: ctx.orderId },
    data: { processedAt: new Date() },
  });

  console.info(
    `[FSM Action] Order ${ctx.orderId}: return processed, stock restored.`
  );
}

// ─── Action Registry ──────────────────────────────────────────────────────────

/**
 * Returns the action to run when entering `nextStatus`.
 * Returns undefined if no action is needed.
 */
export function getActionForNextStatus(nextStatus: OrderStatus): Action | undefined {
  switch (nextStatus) {
    case 'PAID':
      return actionOnPaid;
    case 'PREPARING':
      return actionOnPreparing;
    case 'SHIPPING':
      return actionOnShipping;
    case 'DELIVERED':
      return actionOnDelivered;
    case 'CANCELLED':
      return actionOnCancelled;
    case 'RETURNED':
      return actionOnReturned;
    default:
      return undefined;
  }
}
