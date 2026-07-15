import type { Metadata } from 'next';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
