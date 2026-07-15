// ─── Order Status ─────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PREPARING'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

// ─── Order Events ─────────────────────────────────────────────────────────────

export type OrderEvent =
  | { type: 'PAYMENT_CONFIRMED'; idempotencyKey: string }
  | { type: 'START_PREPARING' }
  | { type: 'SHIP'; trackingNumber: string }
  | { type: 'CONFIRM_DELIVERY' }
  | { type: 'CANCEL'; reason: string }
  | { type: 'REQUEST_RETURN'; reason: string }
  | { type: 'COMPLETE_RETURN' };

export type OrderEventType = OrderEvent['type'];

// ─── API Response Envelope ────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Dispatch Result ──────────────────────────────────────────────────────────

export interface DispatchResult {
  success: boolean;
  order?: {
    seqno: number;
    orderStatus: OrderStatus;
    version: number;
    paidAt?: Date | null;
    updatedAt?: Date | null;
  };
  error?: string;
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    public readonly currentStatus: OrderStatus,
    public readonly eventType: OrderEventType
  ) {
    super(
      `Invalid transition: cannot apply event '${eventType}' to order in status '${currentStatus}'`
    );
    this.name = 'InvalidTransitionError';
  }
}

export class GuardFailedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly eventType?: OrderEventType
  ) {
    super(`Guard failed${eventType ? ` for event '${eventType}'` : ''}: ${reason}`);
    this.name = 'GuardFailedError';
  }
}

export class OptimisticLockError extends Error {
  constructor(public readonly orderId: number) {
    super(
      `Optimistic lock conflict: order ${orderId} was modified concurrently. Please retry.`
    );
    this.name = 'OptimisticLockError';
  }
}

export class LockAcquisitionError extends Error {
  constructor(public readonly orderId: string) {
    super(
      `Failed to acquire distributed lock for order ${orderId}. Too many concurrent requests.`
    );
    this.name = 'LockAcquisitionError';
  }
}
