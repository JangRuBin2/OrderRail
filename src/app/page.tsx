'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PREPARING'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

interface Order {
  seqno: number;
  orderName: string | null;
  totalPayPrice: number | null;
  orderStatus: OrderStatus;
  version: number;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_LABELS: Record<OrderStatus | 'ALL', string> = {
  ALL: '전체',
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

const ALL_STATUSES: (OrderStatus | 'ALL')[] = [
  'ALL',
  'PENDING_PAYMENT',
  'PAID',
  'PREPARING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
];

function StatusBadge({ status }: { status: OrderStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="badge"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatPrice(n: number | null) {
  if (n == null) return <span className="muted">—</span>;
  return '₩' + n.toLocaleString('ko-KR');
}

export default function HomePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setError(null);
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (status) params.set('status', status);

      const res = await fetch(`/api/admin/orders?${params}`);
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? '주문 목록을 불러오는 데 실패했습니다.');
        return;
      }

      setOrders(json.data.orders);
      setPagination(json.data.pagination);
      setLastRefresh(new Date());
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    setLoading(true);
    fetchOrders();
  }, [fetchOrders]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchOrders();
    }, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchOrders]);

  function handleStatusChange(s: OrderStatus | 'ALL') {
    setStatus(s === 'ALL' ? '' : s);
    setPage(1);
  }

  return (
    <main className="page">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text)',
              marginBottom: '0.25rem',
            }}
          >
            주문 목록
          </h1>
          {pagination && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)' }}>
              전체{' '}
              <strong style={{ color: 'var(--text)' }}>
                {pagination.total}
              </strong>
              건
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
            마지막 갱신:{' '}
            {lastRefresh.toLocaleTimeString('ko-KR', { hour12: false })}
          </span>
          <button
            onClick={() => {
              setLoading(true);
              fetchOrders();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-2)',
              fontSize: '0.8rem',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color =
                'var(--text)';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--accent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color =
                'var(--text-2)';
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--border)';
            }}
          >
            ↻ 새로고침
          </button>
          <Link
            href="/orders/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 1rem',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.8rem',
              fontWeight: 600,
              transition: 'background 0.15s',
              textDecoration: 'none',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background =
                'var(--accent-h)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background =
                'var(--accent)';
            }}
          >
            + 주문 생성
          </Link>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          flexWrap: 'wrap',
          marginBottom: '1.25rem',
          padding: '0.5rem',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
        }}
      >
        {ALL_STATUSES.map((s) => {
          const isActive = s === 'ALL' ? status === '' : status === s;
          const color =
            s !== 'ALL' ? STATUS_COLORS[s as OrderStatus] : undefined;
          return (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '6px',
                border: isActive
                  ? `1px solid ${color ? color + '88' : 'var(--accent)'}`
                  : '1px solid transparent',
                background: isActive
                  ? color
                    ? color + '22'
                    : 'var(--bg-hover)'
                  : 'transparent',
                color: isActive
                  ? color ?? 'var(--accent-h)'
                  : 'var(--text-2)',
                fontSize: '0.8rem',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {STATUS_LABELS[s]}
              {s !== 'ALL' && color && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: color,
                    marginLeft: '0.4rem',
                    verticalAlign: 'middle',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '0.875rem 1rem',
            background: '#EF444420',
            border: '1px solid #EF444444',
            borderRadius: '8px',
            color: '#EF4444',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '4rem',
            color: 'var(--text-2)',
          }}
        >
          <span className="spinner" />
          불러오는 중...
        </div>
      ) : orders.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '5rem 2rem',
            color: 'var(--text-3)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            gap: '0.75rem',
          }}
        >
          <span style={{ fontSize: '2.5rem' }}>📦</span>
          <p style={{ fontSize: '1rem', fontWeight: 500 }}>주문이 없습니다</p>
          <p style={{ fontSize: '0.85rem' }}>
            선택한 필터에 해당하는 주문이 존재하지 않습니다.
          </p>
          <Link
            href="/orders/new"
            style={{
              marginTop: '0.5rem',
              padding: '0.5rem 1.25rem',
              background: 'var(--accent)',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            첫 주문 만들기
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>번호</th>
                <th>주문자</th>
                <th>총금액</th>
                <th>상태</th>
                <th>버전</th>
                <th>생성일시</th>
                <th>바로가기</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.seqno}>
                  <td>
                    <span className="mono" style={{ color: 'var(--text-2)' }}>
                      #{order.seqno}
                    </span>
                  </td>
                  <td>
                    {order.orderName ?? (
                      <span className="muted">이름 없음</span>
                    )}
                  </td>
                  <td>
                    <span className="mono">
                      {formatPrice(order.totalPayPrice)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={order.orderStatus} />
                  </td>
                  <td>
                    <span
                      className="mono"
                      style={{ color: 'var(--text-2)', fontSize: '0.8rem' }}
                    >
                      v{order.version}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-2)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatDate(order.createdAt)}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/orders/${order.seqno}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        padding: '0.3rem 0.7rem',
                        background: 'var(--bg-hover)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        color: 'var(--accent-h)',
                        fontSize: '0.8rem',
                        transition: 'all 0.15s',
                      }}
                    >
                      상세 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            marginTop: '1.5rem',
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              padding: '0.45rem 1rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: page <= 1 ? 'var(--text-3)' : 'var(--text-2)',
              fontSize: '0.85rem',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            ← 이전
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text)' }}>{pagination.page}</strong>{' '}
            / {pagination.totalPages}
          </span>
          <button
            onClick={() =>
              setPage((p) => Math.min(pagination.totalPages, p + 1))
            }
            disabled={page >= pagination.totalPages}
            style={{
              padding: '0.45rem 1rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color:
                page >= pagination.totalPages
                  ? 'var(--text-3)'
                  : 'var(--text-2)',
              fontSize: '0.85rem',
              cursor:
                page >= pagination.totalPages ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            다음 →
          </button>
        </div>
      )}
    </main>
  );
}
