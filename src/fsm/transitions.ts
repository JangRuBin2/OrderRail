import type { OrderEventType, OrderStatus } from '@/types/order';

/**
 * Finite State Machine transition table.
 *
 * Structure: transitionTable[currentStatus][eventType] = nextStatus
 *
 * If an entry is missing for a given (status, event) pair it means the
 * transition is not allowed and the engine will throw InvalidTransitionError.
 */
export const transitionTable: Record<
  OrderStatus,
  Partial<Record<OrderEventType, OrderStatus>>
> = {
  PENDING_PAYMENT: {
    PAYMENT_CONFIRMED: 'PAID',
    CANCEL: 'CANCELLED',
  },

  PAID: {
    START_PREPARING: 'PREPARING',
    CANCEL: 'CANCELLED',
  },

  PREPARING: {
    SHIP: 'SHIPPING',
    CANCEL: 'CANCELLED',
  },

  SHIPPING: {
    CONFIRM_DELIVERY: 'DELIVERED',
  },

  DELIVERED: {
    REQUEST_RETURN: 'RETURN_REQUESTED',
  },

  RETURN_REQUESTED: {
    COMPLETE_RETURN: 'RETURNED',
  },

  // Terminal states — no further transitions allowed
  CANCELLED: {},
  RETURNED: {},
};

/**
 * Resolves the next state for a given (currentStatus, eventType) pair.
 *
 * @returns The next OrderStatus, or `undefined` if the transition is not defined.
 */
export function resolveNextStatus(
  currentStatus: OrderStatus,
  eventType: OrderEventType
): OrderStatus | undefined {
  return transitionTable[currentStatus]?.[eventType];
}
