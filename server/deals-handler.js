import { loadOformlenieDeals, serviceEnv } from "./bitrix.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

function readNamed(source) {
  if (!source || (typeof source !== "object" && typeof source !== "function")) return "";
  try {
    const value = source[WEBHOOK_ENV];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function envForRequest(context) {
  const live = serviceEnv();
  const value = readNamed(live) || readNamed(context?.env) || readNamed(context) || readNamed(globalThis.env);
  if (!value) return live;
  if (readNamed(live) === value) return live;
  return { ...live, [WEBHOOK_ENV]: value };
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
