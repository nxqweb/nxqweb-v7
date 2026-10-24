// What a store owner needs to act on, in plain counts, for the Commerce dashboard. Email alerts need a verified sending domain, so until
// then the dashboard itself must show "you have orders waiting". Practice (test) orders never count. Only the exact states below count, so
// a failed, refunded or cancelled order never tells the owner to act. Payment states come from the database: test_pending, pending, paid,
// failed, refunded, partially_refunded. Fulfillment: new, processing, ready_for_pickup, shipped, delivered, cancelled, refunded.
export type OrderLike = { payment_status?: unknown; fulfillment_status?: unknown; is_test?: unknown };
export type OrderAttention = { awaitingPayment: number; toShip: number; total: number };

const openFulfillment = new Set(["new", "processing"]);

export function summarizeOrderAttention(data: unknown): OrderAttention {
  const orders = Array.isArray((data as { orders?: unknown } | null)?.orders) ? ((data as { orders: OrderLike[] }).orders) : [];
  let awaitingPayment = 0;
  let toShip = 0;
  let total = 0;
  for (const order of orders) {
    if (!order || typeof order !== "object" || order.is_test === true) continue;
    total += 1;
    const fulfillment = String(order.fulfillment_status ?? "").toLowerCase();
    const payment = String(order.payment_status ?? "").toLowerCase();
    if (!openFulfillment.has(fulfillment)) continue;
    if (payment === "pending") awaitingPayment += 1;
    else if (payment === "paid") toShip += 1;
  }
  return { awaitingPayment, toShip, total };
}

export function orderAttentionMessage(attention: OrderAttention): string {
  const parts: string[] = [];
  if (attention.awaitingPayment > 0) parts.push(`${attention.awaitingPayment} ${attention.awaitingPayment === 1 ? "order is" : "orders are"} waiting for you to confirm payment`);
  if (attention.toShip > 0) parts.push(`${attention.toShip} paid ${attention.toShip === 1 ? "order is" : "orders are"} ready to ship`);
  return parts.length ? `${parts.join(" and ")}.` : "No orders are waiting for you right now.";
}
