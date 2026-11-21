// "Email the customer" on the shop owner's Orders page. The store does not send customers any email by itself yet, so the owner needs a
// one-tap way to say "I got your payment" or "it shipped, here is the tracking number". This builds an ordinary email link that opens
// the owner's OWN mail app with the words already written; the owner reads it and presses send. Nothing is sent by the app.
import { emailOrderHref } from "./emailOrder.ts";

export type CustomerEmailInput = {
  email: string | null | undefined;
  customerName: string | null | undefined;
  orderNumber: string;
  status: string; // the saved fulfillment status: new, processing, ready_for_pickup, shipped, delivered, cancelled, refunded
  paid: boolean;
  tracking?: string | null;
  pickup?: boolean;
};
export type CustomerEmail = { href: string; label: string; subject: string; body: string };

const oneLine = (value: unknown, max: number): string => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

// The words for each situation. Short, friendly, and true whatever the shop sells.
export function customerEmailText(input: CustomerEmailInput): { label: string; subject: string; body: string } {
  const number = oneLine(input.orderNumber, 60);
  const name = oneLine(input.customerName, 80);
  const hello = name && name.toLowerCase() !== "customer" ? `Hi ${name},` : "Hi,";
  const tracking = oneLine(input.tracking, 120);
  const thanks = "Thank you for your order!";
  const write = (label: string, subject: string, lines: string[]) => ({ label, subject, body: [hello, "", ...lines].join("\n") });
  switch (input.status) {
    case "shipped":
      return write("Email: it shipped", `Your order ${number} has shipped`, [`Good news: your order ${number} is on its way.`, ...(tracking ? [`Tracking number: ${tracking}`] : []), "", thanks]);
    case "ready_for_pickup":
      return write("Email: ready for pickup", `Your order ${number} is ready for pickup`, [`Your order ${number} is ready for you to pick up.`, "", thanks]);
    case "delivered":
      return write("Email: say thanks", `Thank you for your order ${number}`, [`Your order ${number} has been delivered. I hope you love it.`, "", thanks]);
    case "cancelled":
    case "refunded":
      return write("Email the customer", `About your order ${number}`, [`I am writing about your order ${number}.`, ""]);
    default:
      if (input.paid) return write("Email: payment received", `We got your payment for order ${number}`, [`I received your payment for order ${number}. Thank you!`, input.pickup ? "I will email you when it is ready for pickup." : "I will email you when it is on its way.", ""]);
      return write("Email: payment reminder", `About your order ${number}`, [`Thank you for your order ${number}. I have not seen the payment arrive yet.`, "If you already paid, please reply with the name or account you paid from so I can find it.", ""]);
  }
}

// The finished link, or null when the order has no usable email address.
export function customerEmail(input: CustomerEmailInput): CustomerEmail | null {
  const text = customerEmailText(input);
  const href = emailOrderHref(input.email || "", text.subject, text.body);
  return href ? { href, ...text } : null;
}
