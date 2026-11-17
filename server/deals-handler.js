import { loadOformlenieDeals, serviceEnv } from "./bitrix.js";

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

export async function GET(_request, context, configured) {
  try {
    const body = await loadOformlenieDeals(envForRequest(context, configured));
    return Response.json(body, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { connected: false, unavailable: true, deals: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
