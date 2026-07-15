/**
 * Naver Commerce Webhook Handler
 *
 * Naver sends webhook events when payment status changes.
 * We map Naver event types to OrderRail FSM events and dispatch them.
 *
 * Expected payload shape:
 * {
 *   eventType: string,        // Naver event type (e.g. "PAYMENT_CONFIRMED")
 *   orderId: number,          // Our internal Order.seqno
 *   idempotencyKey: string,   // Unique per payment attempt (e.g. Naver paymentId)
 *   payload: object           // Full raw webhook data from Naver
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dispatch } from '@/fsm/engine';
import type { ApiResponse, OrderEvent } from '@/types/order';
import { GuardFailedError, LockAcquisitionError } from '@/types/order';

// ─── Schema ───────────────────────────────────────────────────────────────────

const NaverWebhookSchema = z.object({
  eventType: z.string().min(1),
  orderId: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.unknown()).optional().default({}),
});

type NaverEventType = string;

// ─── Naver → FSM Event Mapping ────────────────────────────────────────────────

function mapNaverEventToFsmEvent(
  eventType: NaverEventType,
  idempotencyKey: string,
  payload: Record<string, unknown>
): OrderEvent | null {
  switch (eventType) {
    case 'PAYMENT_CONFIRMED':
    case 'NAVER_PAYMENT_CONFIRMED':
      return { type: 'PAYMENT_CONFIRMED', idempotencyKey };

    case 'ORDER_CANCELLED':
    case 'NAVER_ORDER_CANCELLED':
      return {
        type: 'CANCEL',
        reason: (payload.cancelReason as string) ?? 'Cancelled via Naver',
      };

    case 'DELIVERY_STARTED':
    case 'NAVER_DELIVERY_STARTED':
      return {
        type: 'SHIP',
        trackingNumber:
          (payload.trackingNumber as string) ?? String(payload.invoiceNumber ?? ''),
      };

    case 'DELIVERY_COMPLETED':
    case 'NAVER_DELIVERY_COMPLETED':
      return { type: 'CONFIRM_DELIVERY' };

    case 'RETURN_REQUESTED':
    case 'NAVER_RETURN_REQUESTED':
      return {
        type: 'REQUEST_RETURN',
        reason: (payload.returnReason as string) ?? 'Return requested via Naver',
      };

    case 'RETURN_COMPLETED':
    case 'NAVER_RETURN_COMPLETED':
      return { type: 'COMPLETE_RETURN' };

    default:
      return null;
  }
}

// ─── POST /api/webhooks/naver ─────────────────────────────────────────────────

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

  const parsed = NaverWebhookSchema.safeParse(body);
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

  const fsmEvent = mapNaverEventToFsmEvent(eventType, idempotencyKey, payload);
  if (!fsmEvent) {
    // Unknown event type — acknowledge but don't process
    return NextResponse.json<ApiResponse>({
      success: true,
      data: { message: `Unhandled Naver event type: ${eventType}` },
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
      // Idempotency / guard failure — 200 OK to prevent Naver from retrying
      // (duplicate webhook; already processed)
      return NextResponse.json<ApiResponse>({
        success: true,
        data: { message: `Event skipped: ${err.message}` },
      });
    }

    if (err instanceof LockAcquisitionError) {
      // Retry-able — ask Naver to retry
      return NextResponse.json<ApiResponse>(
        { success: false, error: err.message },
        { status: 503 }
      );
    }

    console.error('[POST /api/webhooks/naver]', err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
