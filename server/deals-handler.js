import { loadOformlenieDeals, serviceEnv } from "./bitrix.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

export function envForRequest(context) {
  const env = { ...serviceEnv() };
  const sources = [context?.env, context];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const value = source[WEBHOOK_ENV];
    if (typeof value === "string" && value.trim()) {
      env[WEBHOOK_ENV] = value;
      break;
    }
  }
  return env;
}

export async function GET(_request, context) {
  try {
    const body = await loadOformlenieDeals(envForRequest(context));
    return Response.json(body, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { connected: false, deals: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
