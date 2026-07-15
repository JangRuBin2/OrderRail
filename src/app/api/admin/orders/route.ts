import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { ApiResponse } from '@/types/order';

// ─── Query Schema ─────────────────────────────────────────────────────────────

const OrderStatusEnum = z.enum([
  'PENDING_PAYMENT',
  'PAID',
  'PREPARING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
]);

const AdminOrderQuerySchema = z.object({
  status: OrderStatusEnum.optional(),
  shopSeqno: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.enum(['createdAt', 'updatedAt', 'orderDate']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ─── GET /api/admin/orders ───────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const rawQuery = {
    status: searchParams.get('status') ?? undefined,
    shopSeqno: searchParams.get('shopSeqno') ?? undefined,
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    orderBy: searchParams.get('orderBy') ?? undefined,
    order: searchParams.get('order') ?? undefined,
  };

  // Remove undefined keys
  const cleanQuery = Object.fromEntries(
    Object.entries(rawQuery).filter(([, v]) => v !== undefined)
  );

  const parsed = AdminOrderQuerySchema.safeParse(cleanQuery);
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

  const { status, shopSeqno, page, limit, orderBy, order } = parsed.data;
  const skip = (page - 1) * limit;

  try {
    const where = {
      ...(status ? { orderStatus: status } : {}),
      ...(shopSeqno ? { shopSeqno } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { [orderBy]: order },
        skip,
        take: limit,
        include: {
          _count: {
            select: { orderDetails: true },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('[GET /api/admin/orders]', err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}
