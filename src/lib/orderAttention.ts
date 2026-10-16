// What a store owner needs to act on, in plain counts, for the Commerce dashboard. Email alerts need a verified sending domain, so until
// then the dashboard itself must show "you have orders waiting". Practice (test) orders never count.
export type OrderLike = { payment_status?: unknown; fulfillment_status?: unknown; is_test?: unknown };
export type OrderAttention = { awaitingPayment: number; toShip: number; total: number };

const finished = new Set(["ready_for_pickup", "shipped", "delivered", "cancelled", "refunded", "completed"]);

export function summarizeOrderAttention(data: unknown): OrderAttention {
  const orders = Array.isArray((data as { orders?: unknown } | null)?.orders) ? ((data as { orders: OrderLike[] }).orders) : [];
  let awaitingPayment = 0;
  let toShip = 0;
  let total = 0;
  for (const order of orders) {
    if (!order || typeof order !== "object" || order.is_test === true) continue;
    total += 1;
    const fulfillment = String(order.fulfillment_status ?? "").toLowerCase();
    if (finished.has(fulfillment)) continue;
    if (String(order.payment_status ?? "").toLowerCase() === "paid") toShip += 1;
    else awaitingPayment += 1;
  }
  return { awaitingPayment, toShip, total };
}

export function orderAttentionMessage(attention: OrderAttention): string {
  const parts: string[] = [];
  if (attention.awaitingPayment > 0) parts.push(`${attention.awaitingPayment} ${attention.awaitingPayment === 1 ? "order is" : "orders are"} waiting for you to confirm payment`);
  if (attention.toShip > 0) parts.push(`${attention.toShip} paid ${attention.toShip === 1 ? "order is" : "orders are"} ready to ship`);
  return parts.length ? `${parts.join(" and ")}.` : "No orders are waiting for you right now.";
}
