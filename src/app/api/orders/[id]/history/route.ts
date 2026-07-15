import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ApiResponse } from '@/types/order';

// ─── GET /api/orders/[id]/history ────────────────────────────────────────────

export async function GET(
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

  // Support optional pagination via query params
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
  const skip = (page - 1) * limit;

  try {
    // Verify order exists
    const orderExists = await prisma.order.findUnique({
      where: { seqno: orderId },
      select: { seqno: true },
    });

    if (!orderExists) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: `Order ${orderId} not found` },
        { status: 404 }
      );
    }

    const [history, total] = await Promise.all([
      prisma.orderStatusHistory.findMany({
        where: { orderSeqno: orderId },
        orderBy: { seqno: 'desc' },
        skip,
        take: limit,
      }),
      prisma.orderStatusHistory.count({
        where: { orderSeqno: orderId },
      }),
    ]);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        history,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error(`[GET /api/orders/${orderId}/history]`, err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch order history' },
      { status: 500 }
    );
  }
}
