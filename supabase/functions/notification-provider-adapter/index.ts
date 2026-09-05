type JsonRecord = Record<string, unknown>;

type NotificationRequest = {
  idempotency_key: string;
  channel: string;
  recipient_reference: string;
  subject: string;
  body: string;
};

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function environmentSecret(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function parseRequest(value: unknown): NotificationRequest {
  const body = record(value);
  const idempotencyKey = cleanText(body.idempotency_key, 200);
  const channel = cleanText(body.channel, 24).toLowerCase();
  const recipientReference = cleanText(body.recipient_reference, 254).toLowerCase();
  const subject = cleanText(body.subject, 300);
  const notificationBody = cleanText(body.body, 20_000);

  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(idempotencyKey)) {
    throw new Error("Notification idempotency key is invalid.");
  }
  if (channel !== "email") throw new Error("The configured notification provider supports email only.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientReference)) {
    throw new Error("Notification recipient email is invalid.");
  }
  if (!subject || !notificationBody) throw new Error("Notification subject and body are required.");

  return {
    idempotency_key: idempotencyKey,
    channel,
    recipient_reference: recipientReference,
    subject,
    body: notificationBody,
  };
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ ok: false, error: "Method not allowed." }, 405);

  const adapterToken = environmentSecret("NXQ_NOTIFICATION_ADAPTER_TOKEN");
  const authorization = request.headers.get("Authorization") || "";
  const presentedToken = authorization.replace(/^Bearer\s+/i, "");
  if (!adapterToken || !authorization.startsWith("Bearer ") || !(await constantTimeEqual(presentedToken, adapterToken))) {
    return response({ ok: false, error: "Unauthorized." }, 401);
  }

  const resendApiKey = environmentSecret("NXQ_RESEND_API_KEY");
  const fromEmail = environmentSecret("NXQ_NOTIFICATION_FROM_EMAIL");
  if (!resendApiKey || !fromEmail) {
    return response({ ok: false, configured: false, error: "Resend notification provider is not configured." }, 503);
  }
  if (fromEmail.length > 320 || /[\r\n]/.test(fromEmail)) {
    return response({ ok: false, configured: false, error: "Notification sender identity is invalid." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return response({ ok: false, error: "Request body is too large." }, 413);
  }

  let notification: NotificationRequest;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 32_768) return response({ ok: false, error: "Request body is too large." }, 413);
    notification = parseRequest(JSON.parse(rawBody) as unknown);
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof SyntaxError ? "Invalid JSON body." : error instanceof Error ? error.message : "Invalid notification request.",
    }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
        "Idempotency-Key": notification.idempotency_key,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notification.recipient_reference],
        subject: notification.subject,
        text: notification.body,
      }),
      signal: controller.signal,
    });

    const providerText = await providerResponse.text();
    if (providerText.length > 32_768) throw new Error("Notification provider response exceeded the safety limit.");
    let providerBody: JsonRecord = {};
    try { providerBody = providerText ? record(JSON.parse(providerText) as unknown) : {}; }
    catch { providerBody = {}; }

    if (!providerResponse.ok) {
      return response({
        ok: false,
        error: `Notification provider returned HTTP ${providerResponse.status}.`,
        provider_status: providerResponse.status,
        idempotency_key: notification.idempotency_key,
        secret_values_returned: false,
      }, providerResponse.status === 429 ? 429 : 502);
    }

    const providerMessageId = cleanText(providerBody.id, 200);
    if (!providerMessageId) throw new Error("Notification provider returned no message id.");

    return response({
      ok: true,
      status: "accepted",
      provider_message_id: providerMessageId,
      idempotency_key: notification.idempotency_key,
      provider: "resend",
      secret_values_returned: false,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return response({
      ok: false,
      error: timedOut ? "Notification provider request timed out." : error instanceof Error ? error.message : "Notification provider request failed.",
      idempotency_key: notification.idempotency_key,
      secret_values_returned: false,
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
