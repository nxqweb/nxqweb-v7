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
  label: "PayPal",
  isConfigured: false,
  async activateSubscription() {
    return {
      ok: false,
      provider: "paypal",
      status: "pending",
      message:
        "PayPal is not connected yet. Add PayPal API keys later to enable automatic subscription activation.",
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
        "Stripe is not connected yet. Add Stripe API keys later to enable automatic subscription activation.",
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
