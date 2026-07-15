/**
 * Cafe24 Webhook Handler
 *
 * Cafe24 sends webhook events (called "event hooks") when order status changes.
 * We map Cafe24 event types to OrderRail FSM events and dispatch them.
 *
 * Expected payload shape:
 * {
 *   eventType: string,        // Cafe24 event type (e.g. "order_paid")
 *   orderId: number,          // Our internal Order.seqno
 *   idempotencyKey: string,   // Unique per event (e.g. Cafe24 order_id + event combo)
 *   payload: object           // Full raw webhook data from Cafe24
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dispatch } from '@/fsm/engine';
import type { ApiResponse, OrderEvent } from '@/types/order';
import { GuardFailedError, LockAcquisitionError } from '@/types/order';

// ─── Schema ───────────────────────────────────────────────────────────────────

const Cafe24WebhookSchema = z.object({
  eventType: z.string().min(1),
  orderId: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
});

type Cafe24EventType = string;

// ─── Cafe24 → FSM Event Mapping ───────────────────────────────────────────────

function mapCafe24EventToFsmEvent(
  eventType: Cafe24EventType,
  idempotencyKey: string,
  payload: Record<string, unknown>
): OrderEvent | null {
  // Cafe24 uses snake_case event names in their webhook system
  switch (eventType) {
    case 'order_paid':
    case 'payment_confirmed':
      return { type: 'PAYMENT_CONFIRMED', idempotencyKey };

    case 'order_cancelled':
    case 'order_cancel_completed':
      return {
        type: 'CANCEL',
        reason: (payload.cancel_reason as string) ?? 'Cancelled via Cafe24',
      };

    case 'shipping_started':
    case 'order_shipped':
      return {
        type: 'SHIP',
        trackingNumber:
          (payload.tracking_no as string) ?? (payload.invoice_no as string) ?? '',
      };

    case 'delivery_completed':
    case 'order_delivered':
      return { type: 'CONFIRM_DELIVERY' };

    case 'return_requested':
    case 'order_return_requested':
      return {
        type: 'REQUEST_RETURN',
        reason: (payload.return_reason as string) ?? 'Return requested via Cafe24',
      };

    case 'return_completed':
    case 'order_return_completed':
      return { type: 'COMPLETE_RETURN' };

    default:
      return null;
  }
}

// ─── POST /api/webhooks/cafe24 ────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const parsed = Cafe24WebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', '),
      },
      { status: 422 }
    );
  }

  const { eventType, orderId, idempotencyKey, payload } = parsed.data;

  const fsmEvent = mapCafe24EventToFsmEvent(eventType, idempotencyKey, payload);
  if (!fsmEvent) {
    // Unknown event type — acknowledge but don't process
    return NextResponse.json<ApiResponse>({
      success: true,
      data: { message: `Unhandled Cafe24 event type: ${eventType}` },
    });
  }

  try {
    const result = await dispatch(orderId, fsmEvent);

    if (!result.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: result.error },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        message: `Event '${fsmEvent.type}' processed successfully`,
        order: result.order,
      },
    });
  } catch (err) {
    if (err instanceof GuardFailedError) {
      // Idempotency / guard failure — 200 OK to prevent Cafe24 from retrying
      return NextResponse.json<ApiResponse>({
        success: true,
        data: { message: `Event skipped: ${err.message}` },
      });
    }

    if (err instanceof LockAcquisitionError) {
      // Retry-able — ask Cafe24 to retry
      return NextResponse.json<ApiResponse>(
        { success: false, error: err.message },
        { status: 503 }
      );
    }

    console.error('[POST /api/webhooks/cafe24]', err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
