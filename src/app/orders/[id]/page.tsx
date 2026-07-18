'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PREPARING'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

type EventType =
  | 'PAYMENT_CONFIRMED'
  | 'START_PREPARING'
  | 'SHIP'
  | 'CONFIRM_DELIVERY'
  | 'CANCEL'
  | 'REQUEST_RETURN'
  | 'COMPLETE_RETURN';

interface StatusHistoryEntry {
  seqno: number;
  orderSeqno: number;
  pastStatus: OrderStatus | null;
  currentStatus: OrderStatus;
  result: string | null;
  updatedUser: string | null;
  updatedAt: string;
  eventType: EventType | null;
  eventPayload: Record<string, unknown> | null;
}

interface Order {
  seqno: number;
  shopSeqno: number;
  orderNum: string | null;
  name: string | null;
  payKey: string | null;
  totalPayPrice: number | null;
  totalProductPrice: number | null;
  totalDiscountPrice: number | null;
  orderId: string | null;
  orderName: string | null;
  orderTel: string | null;
  orderEmail: string | null;
  deliveryName: string | null;
  deliveryTel: string | null;
  deliveryAddr1: string | null;
  deliveryAddr2: string | null;
  deliveryZip: string | null;
  deliveryComment: string | null;
  deliveryPrice: number | null;
  payType: string | null;
  orderStatus: OrderStatus;
  payStatus: string | null;
  version: number;
  paidAt: string | null;
  createdUser: string | null;
  createdAt: string;
  updatedUser: string | null;
  updatedAt: string;
  orderDate: string | null;
  paymentDate: string | null;
  orderDetails: unknown[];
  statusHistory: StatusHistoryEntry[];
}

interface ConcurrencyResult {
  index: number;
  success: boolean;
  orderStatus?: OrderStatus;
  version?: number;
  ms: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '결제대기',
  PAID: '결제완료',
  PREPARING: '준비중',
  SHIPPING: '배송중',
  DELIVERED: '배송완료',
  CANCELLED: '취소',
  RETURN_REQUESTED: '반품요청',
  RETURNED: '반품완료',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '#F59E0B',
  PAID: '#10B981',
  PREPARING: '#3B82F6',
  SHIPPING: '#8B5CF6',
  DELIVERED: '#06B6D4',
  CANCELLED: '#EF4444',
  RETURN_REQUESTED: '#F97316',
  RETURNED: '#6B7280',
};

const EVENT_COLORS: Record<EventType, string> = {
  PAYMENT_CONFIRMED: '#10B981',
  START_PREPARING: '#3B82F6',
  SHIP: '#8B5CF6',
  CONFIRM_DELIVERY: '#06B6D4',
  CANCEL: '#EF4444',
  REQUEST_RETURN: '#F97316',
  COMPLETE_RETURN: '#6B7280',
};

const EVENT_LABELS: Record<EventType, string> = {
  PAYMENT_CONFIRMED: '결제 확인',
  START_PREPARING: '준비 시작',
  SHIP: '배송 시작',
  CONFIRM_DELIVERY: '배송 완료',
  CANCEL: '주문 취소',
  REQUEST_RETURN: '반품 요청',
  COMPLETE_RETURN: '반품 완료',
};

const VALID_EVENTS: Record<OrderStatus, EventType[]> = {
  PENDING_PAYMENT: ['PAYMENT_CONFIRMED', 'CANCEL'],
  PAID: ['START_PREPARING', 'CANCEL'],
  PREPARING: ['SHIP', 'CANCEL'],
  SHIPPING: ['CONFIRM_DELIVERY'],
  DELIVERED: ['REQUEST_RETURN'],
  RETURN_REQUESTED: ['COMPLETE_RETURN'],
  CANCELLED: [],
  RETURNED: [],
};

const EVENTS_WITH_FIELDS: Partial<Record<EventType, { field: string; label: string; placeholder: string }>> = {
  PAYMENT_CONFIRMED: { field: 'idempotencyKey', label: '멱등 키 (idempotencyKey)', placeholder: 'key-' + Date.now() },
  SHIP: { field: 'trackingNumber', label: '운송장 번호 (trackingNumber)', placeholder: '1234567890' },
  CANCEL: { field: 'reason', label: '취소 사유', placeholder: '고객 요청' },
  REQUEST_RETURN: { field: 'reason', label: '반품 사유', placeholder: '상품 불량' },
};

const PAY_TYPE_LABELS: Record<string, string> = {
  PAY_TYPE_10: '신용카드',
  PAY_TYPE_20: '계좌이체',
  PAY_TYPE_30: '가상계좌',
  PAY_TYPE_40: '무통장입금',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status, large }: { status: OrderStatus; large?: boolean }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="badge"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
        fontSize: large ? '1rem' : undefined,
        padding: large ? '0.4rem 1rem' : undefined,
        borderRadius: large ? '8px' : undefined,
      }}
    >
      <span
        style={{
          width: large ? 8 : 6,
          height: large ? 8 : 6,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {STATUS_LABELS[status]}
      {large && (
        <span style={{ fontSize: '0.7em', opacity: 0.7, marginLeft: '0.3rem' }}>
          ({status})
        </span>
      )}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

function NullField({ value }: { value: string | null }) {
  if (!value) return <span className="muted">설정 안됨</span>;
  return <span>{value}</span>;
}

function generateIdempotencyKey() {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Inline input style ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontSize: '0.85rem',
  outline: 'none',
};

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: string; title: string }) {
  return (
    <h2
      style={{
        fontSize: '0.85rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-2)',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <span style={{ color: 'var(--accent)' }}>{num}</span> {title}
    </h2>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OrderDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // FSM event panel state
  const [eventFields, setEventFields] = useState<Record<EventType, string>>({} as Record<EventType, string>);
  const [dispatching, setDispatching] = useState<EventType | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);

  // Concurrency lab state
  const [concurrencyEvent, setConcurrencyEvent] = useState<EventType | ''>('');
  const [concurrencyField, setConcurrencyField] = useState('');
  const [concurrencyCount, setConcurrencyCount] = useState(3);
  const [useSharedKey, setUseSharedKey] = useState(true);
  const [concurrencyResults, setConcurrencyResults] = useState<ConcurrencyResult[] | null>(null);
  const [concurrencyRunning, setConcurrencyRunning] = useState(false);

  // History expand state
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());

  const fetchOrder = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`/api/orders/${id}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? '주문 정보를 불러오는 데 실패했습니다.');
        return;
      }
      setOrder(json.data);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // When order changes, reset concurrency event if no longer valid
  useEffect(() => {
    if (!order) return;
    const valid = VALID_EVENTS[order.orderStatus];
    if (concurrencyEvent && !valid.includes(concurrencyEvent as EventType)) {
      setConcurrencyEvent('');
      setConcurrencyField('');
    }
  }, [order, concurrencyEvent]);

  // ── FSM Dispatch ─────────────────────────────────────────────────────────────

  async function dispatchEvent(eventType: EventType) {
    if (!order) return;
    setDispatching(eventType);
    setDispatchError(null);
    setDispatchSuccess(null);

    const fieldDef = EVENTS_WITH_FIELDS[eventType];
    const fieldValue = fieldDef ? (eventFields[eventType] ?? '').trim() : '';

    if (fieldDef && !fieldValue) {
      setDispatchError(`${fieldDef.label}을(를) 입력해주세요.`);
      setDispatching(null);
      return;
    }

    let body: Record<string, unknown> = { type: eventType };
    if (eventType === 'PAYMENT_CONFIRMED') body.idempotencyKey = fieldValue;
    if (eventType === 'SHIP') body.trackingNumber = fieldValue;
    if (eventType === 'CANCEL') body.reason = fieldValue;
    if (eventType === 'REQUEST_RETURN') body.reason = fieldValue;

    try {
      const res = await fetch(`/api/orders/${id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setDispatchError(json.error ?? '이벤트 처리에 실패했습니다.');
        return;
      }
      setDispatchSuccess(`${EVENT_LABELS[eventType]} 이벤트가 성공적으로 처리되었습니다.`);
      // Clear the field after success
      if (fieldDef) {
        setEventFields((prev) => ({ ...prev, [eventType]: '' }));
      }
      await fetchOrder();
    } catch {
      setDispatchError('네트워크 오류가 발생했습니다.');
    } finally {
      setDispatching(null);
    }
  }

  // ── Concurrency Lab ───────────────────────────────────────────────────────────

  async function fireConcurrent() {
    if (!order || !concurrencyEvent) return;
    setConcurrencyRunning(true);
    setConcurrencyResults(null);

    const fieldDef = EVENTS_WITH_FIELDS[concurrencyEvent as EventType];
    const sharedKey = useSharedKey && concurrencyEvent === 'PAYMENT_CONFIRMED'
      ? (concurrencyField.trim() || generateIdempotencyKey())
      : concurrencyField.trim();

    const requests = Array.from({ length: concurrencyCount }, (_, i) => {
      let body: Record<string, unknown> = { type: concurrencyEvent };
      if (concurrencyEvent === 'PAYMENT_CONFIRMED') {
        body.idempotencyKey = useSharedKey ? sharedKey : generateIdempotencyKey();
      } else if (concurrencyEvent === 'SHIP') {
        body.trackingNumber = concurrencyField.trim() || `TRACK-${i + 1}`;
      } else if (concurrencyEvent === 'CANCEL') {
        body.reason = concurrencyField.trim() || '동시성 테스트';
      } else if (concurrencyEvent === 'REQUEST_RETURN') {
        body.reason = concurrencyField.trim() || '동시성 테스트';
      }
      return { index: i + 1, body };
    });

    const results = await Promise.allSettled(
      requests.map(async ({ index, body }) => {
        const start = performance.now();
        const res = await fetch(`/api/orders/${id}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        const ms = Math.round(performance.now() - start);
        return { index, json, ms };
      })
    );

    const parsed: ConcurrencyResult[] = results.map((r) => {
      if (r.status === 'fulfilled') {
        const { index, json, ms } = r.value;
        return {
          index,
          success: json.success,
          orderStatus: json.data?.orderStatus,
          version: json.data?.version,
          ms,
          error: json.success ? undefined : (json.error ?? '알 수 없는 오류'),
        };
      } else {
        return {
          index: 0,
          success: false,
          ms: 0,
          error: String(r.reason),
        };
      }
    });

    setConcurrencyResults(parsed);
    setConcurrencyRunning(false);
    await fetchOrder();
  }

  // ── History toggle ─────────────────────────────────────────────────────────

  function toggleHistory(seqno: number) {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(seqno)) next.delete(seqno);
      else next.add(seqno);
      return next;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="page">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '6rem',
            color: 'var(--text-2)',
          }}
        >
          <span className="spinner" />
          주문 정보 불러오는 중...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <div
          style={{
            padding: '1.25rem',
            background: '#EF444420',
            border: '1px solid #EF444444',
            borderRadius: '10px',
            color: '#EF4444',
          }}
        >
          ⚠ {error}
        </div>
        <Link href="/" style={{ display: 'inline-block', marginTop: '1rem', color: 'var(--accent-h)' }}>
          ← 목록으로
        </Link>
      </main>
    );
  }

  if (!order) return null;

  const validEvents = VALID_EVENTS[order.orderStatus];
  const concurrencyValidEvents = VALID_EVENTS[order.orderStatus];

  return (
    <main className="page">
      {/* Breadcrumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          fontSize: '0.875rem',
          color: 'var(--text-3)',
        }}
      >
        <Link href="/" style={{ color: 'var(--text-2)' }}>
          주문 목록
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>주문 #{order.seqno}</span>
      </div>

      {/* Page Title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.75rem',
          gap: '1rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text)',
              marginBottom: '0.35rem',
            }}
          >
            주문 #{order.seqno}
          </h1>
          {order.orderName && (
            <p style={{ color: 'var(--text-2)', fontSize: '0.95rem' }}>
              {order.orderName}
            </p>
          )}
        </div>
        <StatusBadge status={order.orderStatus} large />
      </div>

      {/* ── Section 1: Order Info ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <SectionHeader num="01" title="주문 정보" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {[
            { label: '주문번호', value: order.orderNum },
            { label: '주문자', value: order.orderName },
            { label: '연락처', value: order.orderTel },
            { label: '이메일', value: order.orderEmail },
            {
              label: '배송지',
              value: [order.deliveryAddr1, order.deliveryAddr2]
                .filter(Boolean)
                .join(' ') || null,
            },
            {
              label: '결제금액',
              value: order.totalPayPrice != null
                ? '₩' + order.totalPayPrice.toLocaleString('ko-KR')
                : null,
            },
            {
              label: '결제방식',
              value: order.payType ? (PAY_TYPE_LABELS[order.payType] ?? order.payType) : null,
            },
            {
              label: '현재상태',
              custom: <StatusBadge status={order.orderStatus} />,
            },
            {
              label: '버전',
              value: String(order.version),
              mono: true,
            },
            {
              label: '결제일시',
              value: formatDate(order.paidAt),
            },
            {
              label: '생성일시',
              value: formatDate(order.createdAt),
            },
            {
              label: '수정일시',
              value: formatDate(order.updatedAt),
            },
          ].map(({ label, value, custom, mono }) => (
            <div key={label}>
              <div
                style={{
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-3)',
                  marginBottom: '0.3rem',
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--text)',
                  fontFamily: mono ? 'JetBrains Mono, Fira Code, monospace' : undefined,
                }}
              >
                {custom ?? <NullField value={value ?? null} />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2: FSM Event Panel ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <SectionHeader num="02" title="FSM 이벤트 패널" />

        {/* Success/Error banners */}
        {dispatchSuccess && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: '#10B98120',
              border: '1px solid #10B98144',
              borderRadius: '8px',
              color: '#10B981',
              fontSize: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            ✓ {dispatchSuccess}
          </div>
        )}
        {dispatchError && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: '#EF444420',
              border: '1px solid #EF444444',
              borderRadius: '8px',
              color: '#EF4444',
              fontSize: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            ⚠ {dispatchError}
          </div>
        )}

        {validEvents.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-3)',
              background: 'var(--bg)',
              borderRadius: '8px',
              border: '1px dashed var(--border)',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔒</div>
            <p>이 상태에서는 더 이상 처리할 수 없는 최종 상태입니다.</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              ({order.orderStatus})
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {validEvents.map((eventType) => {
              const color = EVENT_COLORS[eventType];
              const fieldDef = EVENTS_WITH_FIELDS[eventType];
              const isDispatching = dispatching === eventType;
              const fieldValue = eventFields[eventType] ?? '';

              return (
                <div
                  key={eventType}
                  style={{
                    padding: '1rem',
                    background: `${color}0d`,
                    border: `1px solid ${color}33`,
                    borderRadius: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: color,
                          marginBottom: '0.35rem',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {eventType}
                      </div>
                      {fieldDef && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <label
                            style={{
                              display: 'block',
                              fontSize: '0.75rem',
                              color: 'var(--text-2)',
                              marginBottom: '0.3rem',
                              fontWeight: 600,
                            }}
                          >
                            {fieldDef.label}
                            <span style={{ color: '#EF4444', marginLeft: 2 }}>*</span>
                          </label>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                              type="text"
                              value={fieldValue}
                              onChange={(e) =>
                                setEventFields((prev) => ({
                                  ...prev,
                                  [eventType]: e.target.value,
                                }))
                              }
                              placeholder={fieldDef.placeholder}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            {eventType === 'PAYMENT_CONFIRMED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEventFields((prev) => ({
                                    ...prev,
                                    [eventType]: generateIdempotencyKey(),
                                  }))
                                }
                                style={{
                                  padding: '0.5rem 0.75rem',
                                  background: 'var(--bg-hover)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '6px',
                                  color: 'var(--text-2)',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                자동생성
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => dispatchEvent(eventType)}
                      disabled={!!dispatching}
                      style={{
                        padding: '0.5rem 1.25rem',
                        background: isDispatching ? 'var(--text-3)' : color,
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: dispatching ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        alignSelf: 'flex-start',
                        transition: 'opacity 0.15s',
                        opacity: dispatching && !isDispatching ? 0.5 : 1,
                      }}
                    >
                      {isDispatching ? (
                        <>
                          <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} />
                          처리 중...
                        </>
                      ) : (
                        EVENT_LABELS[eventType]
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 3: Concurrency Lab ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <SectionHeader num="03" title="⚡ 동시성 테스트" />

        {concurrencyValidEvents.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-3)',
              background: 'var(--bg)',
              borderRadius: '8px',
              border: '1px dashed var(--border)',
            }}
          >
            <p>이 상태에서는 동시성 테스트를 수행할 수 없습니다.</p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                marginBottom: '1rem',
              }}
            >
              {/* Event selector */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--text-2)',
                    marginBottom: '0.4rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  이벤트 선택
                </label>
                <select
                  value={concurrencyEvent}
                  onChange={(e) => {
                    setConcurrencyEvent(e.target.value as EventType | '');
                    setConcurrencyField('');
                  }}
                  style={{
                    ...inputStyle,
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238892a4' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    paddingRight: '2rem',
                  }}
                >
                  <option value="">-- 이벤트 선택 --</option>
                  {concurrencyValidEvents.map((ev) => (
                    <option key={ev} value={ev}>
                      {ev} — {EVENT_LABELS[ev]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Extra field */}
              <div>
                {concurrencyEvent && EVENTS_WITH_FIELDS[concurrencyEvent as EventType] ? (
                  <>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        color: 'var(--text-2)',
                        marginBottom: '0.4rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {EVENTS_WITH_FIELDS[concurrencyEvent as EventType]?.label}
                    </label>
                    <input
                      type="text"
                      value={concurrencyField}
                      onChange={(e) => setConcurrencyField(e.target.value)}
                      placeholder={
                        concurrencyEvent === 'PAYMENT_CONFIRMED'
                          ? useSharedKey
                            ? '비워두면 자동 생성'
                            : '비워두면 각자 고유 키 생성'
                          : EVENTS_WITH_FIELDS[concurrencyEvent as EventType]?.placeholder
                      }
                      style={inputStyle}
                    />
                  </>
                ) : (
                  <div style={{ height: '100%' }} />
                )}
              </div>
            </div>

            {/* Shared key toggle for PAYMENT_CONFIRMED */}
            {concurrencyEvent === 'PAYMENT_CONFIRMED' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              >
                <input
                  type="checkbox"
                  id="sharedKey"
                  checked={useSharedKey}
                  onChange={(e) => setUseSharedKey(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <label
                  htmlFor="sharedKey"
                  style={{ fontSize: '0.85rem', color: 'var(--text-2)', cursor: 'pointer' }}
                >
                  동일 idempotencyKey 사용 (체크 해제 시 각 요청마다 고유 키)
                </label>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    background: useSharedKey ? '#10B98122' : '#F59E0B22',
                    color: useSharedKey ? '#10B981' : '#F59E0B',
                    borderRadius: '999px',
                    border: `1px solid ${useSharedKey ? '#10B98144' : '#F59E0B44'}`,
                  }}
                >
                  {useSharedKey ? '멱등성 보장 → 1개만 성공 예상' : '각자 고유 키 → 충돌 가능'}
                </span>
              </div>
            )}

            {/* Count + Fire button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '0.8rem', color: 'var(--text-2)', fontWeight: 600 }}>
                동시 요청 수:
              </span>
              {[2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setConcurrencyCount(n)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    background: concurrencyCount === n ? 'var(--accent)' : 'var(--bg-hover)',
                    border: `1px solid ${concurrencyCount === n ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '6px',
                    color: concurrencyCount === n ? '#fff' : 'var(--text-2)',
                    fontSize: '0.85rem',
                    fontWeight: concurrencyCount === n ? 700 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {n}
                </button>
              ))}

              <button
                onClick={fireConcurrent}
                disabled={!concurrencyEvent || concurrencyRunning}
                style={{
                  marginLeft: 'auto',
                  padding: '0.55rem 1.75rem',
                  background:
                    !concurrencyEvent || concurrencyRunning
                      ? 'var(--text-3)'
                      : 'linear-gradient(135deg, #6366f1, #8B5CF6)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: !concurrencyEvent || concurrencyRunning ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: concurrencyEvent && !concurrencyRunning
                    ? '0 0 20px #6366f144'
                    : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {concurrencyRunning ? (
                  <>
                    <span className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff' }} />
                    발사 중...
                  </>
                ) : (
                  <>⚡ 동시 발사 ({concurrencyCount}개)</>
                )}
              </button>
            </div>

            {/* Results */}
            {concurrencyResults && (
              <div style={{ marginTop: '1.25rem' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem',
                  }}
                >
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-2)' }}>
                    결과
                  </h3>
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem' }}>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>
                      ✅ {concurrencyResults.filter((r) => r.success).length}개 성공
                    </span>
                    <span style={{ color: '#EF4444', fontWeight: 600 }}>
                      ❌ {concurrencyResults.filter((r) => !r.success).length}개 실패
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  {concurrencyResults.map((r) => (
                    <div
                      key={r.index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2rem 1.5rem 1fr auto auto',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.6rem 0.875rem',
                        background: r.success ? '#10B98110' : '#EF444410',
                        borderBottom: '1px solid var(--border)',
                        fontSize: '0.82rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-3)', fontFamily: 'monospace' }}>
                        #{r.index}
                      </span>
                      <span>{r.success ? '✅' : '❌'}</span>
                      <span style={{ color: r.success ? 'var(--text)' : '#EF4444' }}>
                        {r.success ? (
                          <>
                            {r.orderStatus && (
                              <StatusBadge status={r.orderStatus} />
                            )}
                            {r.version != null && (
                              <span
                                style={{
                                  marginLeft: '0.5rem',
                                  color: 'var(--text-2)',
                                  fontFamily: 'monospace',
                                }}
                              >
                                v{r.version}
                              </span>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: '0.8em' }}>{r.error}</span>
                        )}
                      </span>
                      <span
                        style={{
                          color: 'var(--text-3)',
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                          textAlign: 'right',
                        }}
                      >
                        {r.ms}ms
                      </span>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    fontSize: '0.85rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: 'var(--text-2)' }}>요약:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>
                    {concurrencyResults.filter((r) => r.success).length}개 성공
                    {' / '}
                    {concurrencyResults.filter((r) => !r.success).length}개 실패
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>
                    평균 응답:{' '}
                    {Math.round(
                      concurrencyResults.reduce((a, r) => a + r.ms, 0) /
                      concurrencyResults.length
                    )}
                    ms
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>
                    최대: {Math.max(...concurrencyResults.map((r) => r.ms))}ms
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>
                    최소: {Math.min(...concurrencyResults.map((r) => r.ms))}ms
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Section 4: Status History ─────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader num="04" title="상태 변경 이력" />

        {order.statusHistory.length === 0 ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-3)',
              background: 'var(--bg)',
              borderRadius: '8px',
              border: '1px dashed var(--border)',
            }}
          >
            <p>아직 상태 변경 이력이 없습니다.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[...order.statusHistory].reverse().map((entry) => {
              const isExpanded = expandedHistory.has(entry.seqno);
              const hasPayload =
                entry.eventPayload &&
                Object.keys(entry.eventPayload).length > 0;

              return (
                <div
                  key={entry.seqno}
                  style={{
                    padding: '1rem',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* From status */}
                    {entry.pastStatus ? (
                      <StatusBadge status={entry.pastStatus} />
                    ) : (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-3)',
                          padding: '0.2rem 0.5rem',
                          border: '1px dashed var(--border)',
                          borderRadius: '999px',
                        }}
                      >
                        신규
                      </span>
                    )}

                    {/* Arrow + event */}
                    <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>→</span>
                    {entry.eventType && (
                      <span
                        style={{
                          fontSize: '0.73rem',
                          fontFamily: 'monospace',
                          color: EVENT_COLORS[entry.eventType] ?? 'var(--accent-h)',
                          background: `${EVENT_COLORS[entry.eventType] ?? 'var(--accent)'}18`,
                          border: `1px solid ${EVENT_COLORS[entry.eventType] ?? 'var(--accent)'}33`,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        {entry.eventType}
                      </span>
                    )}
                    <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>→</span>

                    {/* To status */}
                    <StatusBadge status={entry.currentStatus} />

                    {/* Time */}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: '0.75rem',
                        color: 'var(--text-3)',
                        whiteSpace: 'nowrap',
                      }}
                      title={formatDate(entry.updatedAt) ?? ''}
                    >
                      {timeAgo(entry.updatedAt)}
                    </span>

                    {/* Payload toggle */}
                    {hasPayload && (
                      <button
                        onClick={() => toggleHistory(entry.seqno)}
                        style={{
                          padding: '0.15rem 0.5rem',
                          background: 'var(--bg-hover)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: 'var(--text-2)',
                          fontSize: '0.7rem',
                          cursor: 'pointer',
                        }}
                      >
                        {isExpanded ? '▲ 닫기' : '▼ 페이로드'}
                      </button>
                    )}
                  </div>

                  {/* Payload JSON */}
                  {isExpanded && hasPayload && (
                    <pre
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.75rem',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        color: 'var(--accent-h)',
                        overflow: 'auto',
                        fontFamily: 'JetBrains Mono, Fira Code, monospace',
                        lineHeight: 1.5,
                      }}
                    >
                      {JSON.stringify(entry.eventPayload, null, 2)}
                    </pre>
                  )}

                  {/* Result if present */}
                  {entry.result && (
                    <div
                      style={{
                        marginTop: '0.5rem',
                        fontSize: '0.75rem',
                        color: 'var(--text-3)',
                        fontFamily: 'monospace',
                      }}
                    >
                      result: {entry.result}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
