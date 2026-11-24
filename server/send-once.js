import { controlMessages, deliverControlChat, loadOformlenieDeals, rememberSentSteps, serviceEnv, storeSentSteps, webhookConfigured } from "./bitrix.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";
let flight = null;

function liveBase(env) {
  if (!webhookConfigured(env)) return "";
  const base = env[WEBHOOK_ENV].trim();
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
  rememberSentSteps();
  const loaded = await loadOformlenieDeals({ [WEBHOOK_ENV]: base }, fetchImpl, now);
  const jobs = (Array.isArray(loaded.deals) ? loaded.deals : [])
    .map((deal) => ({
      id: deal.id,
      title: deal.title,
      report: deal.report || [],
      review: deal.review || [],
      offer: Boolean(deal.offer),
    }))
    .sort((left, right) => Number(Boolean(right.offer)) - Number(Boolean(left.offer)));
  const first = jobs.find((job) => controlMessages(job, now).length);
  const line = first ? controlMessages(first, now)[0] : "";
  const step = line.match(/Шаг:\s*(.+?)\.\s*Срок:/);
  const fix = line.match(/Исправьте:\s*(.*)$/);
  const due = line.match(/Срок:\s*(.+?)\.\s*Исправьте:/);
  const sent = await deliverControlChat(fetchImpl, base, first ? [{
    id: first.id,
    title: first.title,
    offer: true,
    report: [{
      title: step ? step[1] : "Шаг",
      status: "Не сделано",
      missing: fix ? fix[1] : line,
      due: due ? due[1] : "",
    }],
    review: [],
  }] : [], now);
  storeSentSteps();
  return { created: Boolean(sent.chatId), posted: sent.posted || 0, error: sent.error || "" };
}

export function resetSendFlight() {
  flight = null;
}

export function sendControlOnce(env = serviceEnv(), fetchImpl = fetch, now = new Date()) {
  if (!liveBase(env)) return Promise.resolve({ created: false, posted: 0, error: "" });
  if (!flight) flight = run(env, fetchImpl, now);
  return flight;
}
