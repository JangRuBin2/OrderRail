import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { dispatch } from '@/fsm/engine';
import type { ApiResponse, OrderEvent } from '@/types/order';
import { GuardFailedError, LockAcquisitionError } from '@/types/order';

// ─── Request Schema ───────────────────────────────────────────────────────────

// Discriminated union schema for all possible events
const OrderEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PAYMENT_CONFIRMED'),
    idempotencyKey: z.string().min(1),
  }),
  z.object({
    type: z.literal('START_PREPARING'),
  }),
  z.object({
    type: z.literal('SHIP'),
    trackingNumber: z.string().min(1),
  }),
  z.object({
    type: z.literal('CONFIRM_DELIVERY'),
  }),
  z.object({
    type: z.literal('CANCEL'),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal('REQUEST_RETURN'),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal('COMPLETE_RETURN'),
  }),
]);

// ─── POST /api/orders/[id]/events ────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const orderId = parseInt(id, 10);

  if (isNaN(orderId) || orderId <= 0) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Invalid order id' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const parsed = OrderEventSchema.safeParse(body);
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

  const event = parsed.data as OrderEvent;

  try {
    const result = await dispatch(orderId, event);

    if (!result.success) {
      // Invalid transition or optimistic lock conflict
      return NextResponse.json<ApiResponse>(
        { success: false, error: result.error },
        { status: 409 }
      );
    }

    return NextResponse.json<ApiResponse>(
      { success: true, data: result.order },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof GuardFailedError) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: err.message },
        { status: 409 }
      );
    }

    if (err instanceof LockAcquisitionError) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: err.message },
        { status: 503 }
      );
    }

    console.error(`[POST /api/orders/${orderId}/events]`, err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
