import { openRakovChannel, webhookConfigured } from "./bitrix.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";
let flight = null;

function literalWebhook() {
  try {
    const value = process.env.BITRIX_WEBHOOK_URL;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function liveBase(env) {
  const source = env || { [WEBHOOK_ENV]: literalWebhook() };
  if (!webhookConfigured(source)) return "";
  const base = source[WEBHOOK_ENV].trim();
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (!host || host.endsWith(".invalid")) return "";
    return base;
  } catch {
    return "";
  }
}

async function run(env, fetchImpl, now) {
  const base = liveBase(env);
  if (!base) return { created: false, posted: 0, error: "" };
  return openRakovChannel(fetchImpl, base, now);
}

export function resetSendFlight() {
  flight = null;
}

export function sendControlOnce(env = null, fetchImpl = fetch, now = new Date()) {
  if (!liveBase(env)) return Promise.resolve({ created: false, posted: 0, error: "" });
  if (!flight) flight = run(env, fetchImpl, now);
  return flight;
}
