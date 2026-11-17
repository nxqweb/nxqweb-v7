import { createPortal } from "react-dom";
import type { PackingSlipData } from "../lib/packingSlip";

// The printed packing slip. It is in the page but hidden; while printing (body.printing-slip) it is the ONLY thing on the paper
// (styles in src/styles/plan-forms.css). Everything is ordinary text elements, so nothing a shopper typed can become HTML.
export function PackingSlip({ slip, formatMoney }: { slip: PackingSlipData; formatMoney: (amount: number) => string }) {
  return createPortal(
    <div className="packing-slip" data-testid="packing-slip" aria-hidden="true">
      <h1>Packing slip</h1>
      <p className="packing-slip-order">Order <strong>{slip.orderNumber}</strong>{slip.placed ? ` · ${slip.placed}` : ""}</p>
      <h2>{slip.heading}</h2>
      <address>{slip.to.map((line, index) => <span key={index}>{line}<br /></span>)}</address>
      {slip.phone ? <p>Phone: {slip.phone}</p> : null}
      <h2>In this order ({slip.itemCount} {slip.itemCount === 1 ? "item" : "items"})</h2>
      <table>
        <tbody>
          {slip.items.map((item, index) => <tr key={index}><td className="packing-slip-box">☐</td><td className="packing-slip-qty">{item.quantity} ×</td><td>{item.name}</td></tr>)}
        </tbody>
      </table>
      {slip.note ? <><h2>Customer's note</h2><p className="packing-slip-note">{slip.note}</p></> : null}
      <table className="packing-slip-totals">
        <tbody>{slip.totals.map((row) => <tr key={row.label}><td>{row.label}</td><td>{formatMoney(row.amount)}</td></tr>)}</tbody>
      </table>
      <p className="packing-slip-thanks">Thank you for your order!</p>
    </div>,
    document.body,
  );
}
