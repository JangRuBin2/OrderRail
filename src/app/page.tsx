export default function HomePage() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>OrderRail</h1>
      <p>FSM-based order management API with distributed locking.</p>
      <ul>
        <li>POST /api/orders — Create order</li>
        <li>GET /api/orders/[id] — Get order</li>
        <li>POST /api/orders/[id]/events — Dispatch FSM event</li>
        <li>GET /api/orders/[id]/history — Status history</li>
        <li>GET /api/admin/orders — List orders (admin)</li>
        <li>POST /api/webhooks/naver — Naver webhook</li>
        <li>POST /api/webhooks/cafe24 — Cafe24 webhook</li>
      </ul>
    </main>
  );
}
