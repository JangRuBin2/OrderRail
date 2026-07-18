import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrderRail',
  description: 'FSM-based order management with distributed locking',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <nav className="nav">
          <Link href="/" className="nav-logo">
            <span className="nav-logo-icon">🚄</span>
            OrderRail
          </Link>
          <ul className="nav-links">
            <li>
              <Link href="/" className="nav-link">
                주문 목록
              </Link>
            </li>
            <li>
              <Link href="/orders/new" className="nav-link">
                주문 생성
              </Link>
            </li>
          </ul>
        </nav>
        {children}
      </body>
    </html>
  );
}
