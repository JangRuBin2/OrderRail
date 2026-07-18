'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface CreateOrderBody {
  shopSeqno: number;
  orderName?: string;
  orderTel?: string;
  orderEmail?: string;
  deliveryName?: string;
  deliveryAddr1?: string;
  deliveryAddr2?: string;
  deliveryZip?: string;
  deliveryComment?: string;
  totalPayPrice?: number;
  totalDiscountPrice?: number;
  deliveryPrice?: number;
  payType?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.85rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '0.875rem',
  outline: 'none',
  transition: 'border-color 0.15s',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--text-2)',
  marginBottom: '0.4rem',
  letterSpacing: '0.02em',
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {required && (
          <span style={{ color: '#EF4444', marginLeft: '0.25rem' }}>*</span>
        )}
      </label>
      {children}
    </div>
  );
}

export default function NewOrderPage() {
  const router = useRouter();

  const [shopSeqno, setShopSeqno] = useState('1');
  const [orderName, setOrderName] = useState('');
  const [orderTel, setOrderTel] = useState('');
  const [orderEmail, setOrderEmail] = useState('');
  const [deliveryName, setDeliveryName] = useState('');
  const [deliveryAddr1, setDeliveryAddr1] = useState('');
  const [deliveryAddr2, setDeliveryAddr2] = useState('');
  const [deliveryZip, setDeliveryZip] = useState('');
  const [deliveryComment, setDeliveryComment] = useState('');
  const [totalPayPrice, setTotalPayPrice] = useState('');
  const [totalDiscountPrice, setTotalDiscountPrice] = useState('');
  const [deliveryPrice, setDeliveryPrice] = useState('');
  const [payType, setPayType] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFocusStyle = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
    (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px var(--accent)22';
  };
  const handleBlurStyle = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const n = parseInt(shopSeqno, 10);
    if (isNaN(n) || n < 1) {
      setError('shopSeqno는 유효한 양의 정수여야 합니다.');
      return;
    }

    const body: CreateOrderBody = { shopSeqno: n };
    if (orderName.trim()) body.orderName = orderName.trim();
    if (orderTel.trim()) body.orderTel = orderTel.trim();
    if (orderEmail.trim()) body.orderEmail = orderEmail.trim();
    if (deliveryName.trim()) body.deliveryName = deliveryName.trim();
    if (deliveryAddr1.trim()) body.deliveryAddr1 = deliveryAddr1.trim();
    if (deliveryAddr2.trim()) body.deliveryAddr2 = deliveryAddr2.trim();
    if (deliveryZip.trim()) body.deliveryZip = deliveryZip.trim();
    if (deliveryComment.trim()) body.deliveryComment = deliveryComment.trim();
    if (totalPayPrice.trim()) body.totalPayPrice = parseInt(totalPayPrice, 10);
    if (totalDiscountPrice.trim())
      body.totalDiscountPrice = parseInt(totalDiscountPrice, 10);
    if (deliveryPrice.trim()) body.deliveryPrice = parseInt(deliveryPrice, 10);
    if (payType) body.payType = payType;

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error ?? '주문 생성에 실패했습니다.');
        return;
      }

      router.push(`/orders/${json.data.seqno}`);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 720 }}>
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
        <Link href="/" style={{ color: 'var(--text-2)', textDecoration: 'none' }}>
          주문 목록
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--text)' }}>주문 생성</span>
      </div>

      <h1
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          marginBottom: '0.5rem',
          color: 'var(--text)',
        }}
      >
        새 주문 생성
      </h1>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--text-2)',
          marginBottom: '2rem',
        }}
      >
        주문을 생성하면 상태가{' '}
        <span
          style={{
            background: '#F59E0B22',
            color: '#F59E0B',
            padding: '0.1rem 0.4rem',
            borderRadius: '4px',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}
        >
          PENDING_PAYMENT
        </span>
        으로 시작됩니다.
      </p>

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
            marginBottom: '1.5rem',
          }}
        >
          ⚠ {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Shop Info */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
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
            <span style={{ color: 'var(--accent)' }}>01</span> 쇼핑몰 정보
          </h2>
          <Field label="쇼핑몰 번호 (shopSeqno)" required>
            <input
              type="number"
              value={shopSeqno}
              onChange={(e) => setShopSeqno(e.target.value)}
              min="1"
              required
              style={inputStyle}
              onFocus={handleFocusStyle}
              onBlur={handleBlurStyle}
            />
          </Field>
        </div>

        {/* Order Info */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
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
            <span style={{ color: 'var(--accent)' }}>02</span> 주문자 정보
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '1rem',
            }}
          >
            <Field label="주문자명 (orderName)">
              <input
                type="text"
                value={orderName}
                onChange={(e) => setOrderName(e.target.value)}
                placeholder="홍길동"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="연락처 (orderTel)">
              <input
                type="text"
                value={orderTel}
                onChange={(e) => setOrderTel(e.target.value)}
                placeholder="010-0000-0000"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="이메일 (orderEmail)">
              <input
                type="email"
                value={orderEmail}
                onChange={(e) => setOrderEmail(e.target.value)}
                placeholder="user@example.com"
                style={{ ...inputStyle, gridColumn: '1 / -1' }}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
          </div>
        </div>

        {/* Delivery Info */}
        <div className="card" style={{ marginBottom: '1.25rem' }}>
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
            <span style={{ color: 'var(--accent)' }}>03</span> 배송 정보
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
              }}
            >
              <Field label="수령인 (deliveryName)">
                <input
                  type="text"
                  value={deliveryName}
                  onChange={(e) => setDeliveryName(e.target.value)}
                  placeholder="홍길동"
                  style={inputStyle}
                  onFocus={handleFocusStyle}
                  onBlur={handleBlurStyle}
                />
              </Field>
              <Field label="우편번호 (deliveryZip)">
                <input
                  type="text"
                  value={deliveryZip}
                  onChange={(e) => setDeliveryZip(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  style={inputStyle}
                  onFocus={handleFocusStyle}
                  onBlur={handleBlurStyle}
                />
              </Field>
            </div>
            <Field label="주소 (deliveryAddr1)">
              <input
                type="text"
                value={deliveryAddr1}
                onChange={(e) => setDeliveryAddr1(e.target.value)}
                placeholder="주소"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="상세주소 (deliveryAddr2)">
              <input
                type="text"
                value={deliveryAddr2}
                onChange={(e) => setDeliveryAddr2(e.target.value)}
                placeholder="상세주소"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="배송 메모 (deliveryComment)">
              <input
                type="text"
                value={deliveryComment}
                onChange={(e) => setDeliveryComment(e.target.value)}
                placeholder="문 앞에 놔주세요"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
          </div>
        </div>

        {/* Payment Info */}
        <div className="card" style={{ marginBottom: '2rem' }}>
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
            <span style={{ color: 'var(--accent)' }}>04</span> 결제 정보
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            <Field label="결제금액 (totalPayPrice)">
              <input
                type="number"
                value={totalPayPrice}
                onChange={(e) => setTotalPayPrice(e.target.value)}
                placeholder="0"
                min="0"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="할인금액 (totalDiscountPrice)">
              <input
                type="number"
                value={totalDiscountPrice}
                onChange={(e) => setTotalDiscountPrice(e.target.value)}
                placeholder="0"
                min="0"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
            <Field label="배송비 (deliveryPrice)">
              <input
                type="number"
                value={deliveryPrice}
                onChange={(e) => setDeliveryPrice(e.target.value)}
                placeholder="0"
                min="0"
                style={inputStyle}
                onFocus={handleFocusStyle}
                onBlur={handleBlurStyle}
              />
            </Field>
          </div>
          <Field label="결제수단 (payType)">
            <select
              value={payType}
              onChange={(e) => setPayType(e.target.value)}
              style={{
                ...inputStyle,
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238892a4' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.75rem center',
                paddingRight: '2rem',
              }}
              onFocus={handleFocusStyle}
              onBlur={handleBlurStyle}
            >
              <option value="">선택하지 않음</option>
              <option value="PAY_TYPE_10">신용카드</option>
              <option value="PAY_TYPE_20">계좌이체</option>
              <option value="PAY_TYPE_30">가상계좌</option>
              <option value="PAY_TYPE_40">무통장입금</option>
            </select>
          </Field>
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <Link
            href="/"
            style={{
              padding: '0.65rem 1.5rem',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-2)',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: '0.65rem 2rem',
              background: submitting ? 'var(--text-3)' : 'var(--accent)',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              transition: 'background 0.15s',
            }}
          >
            {submitting ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                생성 중...
              </>
            ) : (
              '주문 생성'
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
