export type PaymentProviderName = "manual" | "paypal" | "stripe";

export type PaymentActivationInput = {
  clientId: string;
  clientName: string;
  monthlyPrice: number;
};

export type PaymentActivationResult = {
  ok: boolean;
  provider: PaymentProviderName;
  status: "active" | "pending" | "failed";
  message: string;
  externalPaymentId?: string;
};

export type PaymentProvider = {
  name: PaymentProviderName;
  label: string;
  isConfigured: boolean;
  activateSubscription: (
    input: PaymentActivationInput
  ) => Promise<PaymentActivationResult>;
};

export const manualPaymentProvider: PaymentProvider = {
  name: "manual",
  label: "Manual payment mode",
  isConfigured: true,
  async activateSubscription(input) {
    return {
      ok: true,
      provider: "manual",
      status: "active",
      message: `${input.clientName} subscription activated manually.`,
    };
  },
};

export const paypalPaymentProvider: PaymentProvider = {
  name: "paypal",
  label: "PayPal (legacy)",
  isConfigured: false,
  async activateSubscription() {
    return {
      ok: false,
      provider: "paypal",
      status: "pending",
      message:
        "PayPal is retained only for legacy records. New online billing is prepared for Stripe.",
    };
  },
};

export const stripePaymentProvider: PaymentProvider = {
  name: "stripe",
  label: "Stripe",
  isConfigured: false,
  async activateSubscription() {
    return {
      ok: false,
      provider: "stripe",
      status: "pending",
      message:
        "Stripe is safely disabled. Add Stripe keys, price IDs, a verified webhook, and explicit owner activation later.",
    };
  },
};

export const paymentProviders: Record<PaymentProviderName, PaymentProvider> = {
  manual: manualPaymentProvider,
  paypal: paypalPaymentProvider,
  stripe: stripePaymentProvider,
};

export function getPaymentProvider(providerName: PaymentProviderName) {
  return paymentProviders[providerName];
}
