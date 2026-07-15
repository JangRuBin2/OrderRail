import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { ApiResponse } from '@/types/order';

// ─── Request Schema ───────────────────────────────────────────────────────────

const CreateOrderSchema = z.object({
  shopSeqno: z.number().int().positive(),
  orderNum: z.string().max(100).optional(),
  name: z.string().max(256).optional(),
  orderId: z.string().max(100).optional(),
  orderName: z.string().max(100).optional(),
  orderTel: z.string().max(45).optional(),
  orderEmail: z.string().email().max(256).optional(),
  deliveryName: z.string().max(100).optional(),
  deliveryTel: z.string().max(45).optional(),
  deliveryAddr1: z.string().max(512).optional(),
  deliveryAddr2: z.string().max(512).optional(),
  deliveryZip: z.string().max(6).optional(),
  deliveryComment: z.string().max(512).optional(),
  deliveryPrice: z.number().int().nonnegative().optional(),
  totalProductPrice: z.number().int().nonnegative().optional(),
  totalDiscountPrice: z.number().int().nonnegative().optional().default(0),
  totalPayPrice: z.number().int().nonnegative().optional(),
  payType: z
    .enum(['PAY_TYPE_10', 'PAY_TYPE_20', 'PAY_TYPE_30', 'PAY_TYPE_40'])
    .optional(),
});

type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

// ─── POST /api/orders ─────────────────────────────────────────────────────────

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

  const parsed = CreateOrderSchema.safeParse(body);
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

  const data: CreateOrderInput = parsed.data;

  try {
    const order = await prisma.order.create({
      data: {
        shopSeqno: data.shopSeqno,
        orderNum: data.orderNum,
        name: data.name,
        orderId: data.orderId,
        orderName: data.orderName,
        orderTel: data.orderTel,
        orderEmail: data.orderEmail,
        deliveryName: data.deliveryName,
        deliveryTel: data.deliveryTel,
        deliveryAddr1: data.deliveryAddr1,
        deliveryAddr2: data.deliveryAddr2,
        deliveryZip: data.deliveryZip,
        deliveryComment: data.deliveryComment,
        deliveryPrice: data.deliveryPrice,
        totalProductPrice: data.totalProductPrice,
        totalDiscountPrice: data.totalDiscountPrice ?? 0,
        totalPayPrice: data.totalPayPrice,
        payType: data.payType ?? 'PAY_TYPE_10',
        orderStatus: 'PENDING_PAYMENT',
        version: 0,
        orderDate: new Date(),
      },
    });

    return NextResponse.json<ApiResponse>(
      { success: true, data: order },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/orders]', err);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to create order' },
      { status: 500 }
    );
  }
}
