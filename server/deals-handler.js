import { loadOformlenieDeals, serviceEnv } from "./bitrix.js";
import { postReadyOnce, sendControlOnce } from "./send-once.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

function asWebhook(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function fromSource(source) {
  if (!source || (typeof source !== "object" && typeof source !== "function")) return "";
  try {
    return asWebhook(source[WEBHOOK_ENV]);
  } catch {
    return "";
  }
}

// Static member access. The published host injects this secret for this expression.
export function literalWebhook() {
  try {
    return asWebhook(process.env.BITRIX_WEBHOOK_URL);
  } catch {
    return "";
  }
}

export function envForRequest(context, configured) {
  const value = asWebhook(configured)
    || literalWebhook()
    || fromSource(serviceEnv())
    || fromSource(context?.env)
    || fromSource(context)
    || fromSource(globalThis.env);
  if (!value) return {};
  return { [WEBHOOK_ENV]: value };
}

function publicBitrix(sent) {
  const reply = sent?.bitrix;
  if (!reply || typeof reply !== "object") return null;
  const error = String(reply.error || "").replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim();
  const chatId = String(reply.chatId || "").replace(/https?:\/\/\S+/gi, "").replace(/^chat/i, "").trim();
  const method = String(reply.method || "").replace(/https?:\/\/\S+/gi, "").trim();
  if (!method) return null;
  return { method, ok: Boolean(reply.ok), error, chatId };
}

export async function GET(_request, context, configured) {
  const env = envForRequest(context, configured);
  let body;
  try {
    body = await loadOformlenieDeals(env);
  } catch {
    body = { connected: false, unavailable: true, deals: [] };
  }
  const payload = {
    ...body,
    deals: Array.isArray(body?.deals) ? body.deals : [],
  };
  try {
    const bitrix = publicBitrix(await sendControlOnce(env));
    if (bitrix) payload.bitrix = bitrix;
  } catch {
    payload.bitrix = { method: "im.message.add", ok: false, error: "Bitrix не ответил", chatId: "" };
  }
  try {
    const review = publicBitrix(await postReadyOnce(env, payload.deals));
    if (review) payload.bitrix = review;
  } catch {
    // The deal list is already built. A review post cannot replace it.
  }
  return Response.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}
