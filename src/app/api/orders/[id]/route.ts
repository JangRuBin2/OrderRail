import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ApiResponse } from '@/types/order';

// ─── GET /api/orders/[id] ─────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
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

  try {
    const order = await prisma.order.findUnique({
      where: { seqno: orderId },
      include: {
        orderDetails: true,
        statusHistory: {
          orderBy: { seqno: 'desc' },
          take: 10,
        },
      },
    });

    if (!order) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: `Order ${orderId} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse>({ success: true, data: order });
  } catch (err) {
    console.error(`[GET /api/orders/${orderId}]`, err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}
