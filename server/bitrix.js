const DEAL_LIST_METHOD = "crm.deal.list.json";
const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

export function serviceEnv() {
  const proc = globalThis["process"];
  if (proc && typeof proc.env === "object" && proc.env) return proc.env;
  return {};
}

export function webhookConfigured(env = serviceEnv()) {
  const value = env[WEBHOOK_ENV];
  return typeof value === "string" && value.trim() !== "";
}

function field(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  return "";
}

function dealsFromPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.result)) {
    return null;
  }
  return payload.result.slice(0, 20).map((row) => ({
    id: field(row?.ID),
    title: field(row?.TITLE),
    stage: field(row?.STAGE_ID),
    assignee: field(row?.ASSIGNED_BY_ID),
  }));
}

export async function loadOformlenieDeals(env = serviceEnv(), fetchImpl = fetch) {
  if (!webhookConfigured(env)) {
    return { connected: false, deals: [] };
  }

  const base = env[WEBHOOK_ENV].trim();
  const endpoint = `${base.endsWith("/") ? base : `${base}/`}${DEAL_LIST_METHOD}`;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start: 0,
        limit: 20,
        select: ["ID", "TITLE", "STAGE_ID", "ASSIGNED_BY_ID"],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { connected: false, unavailable: true, deals: [] };
    }
    const deals = dealsFromPayload(await response.json());
    if (!deals) {
      return { connected: false, unavailable: true, deals: [] };
    }
    return { connected: true, deals };
  } catch {
    return { connected: false, unavailable: true, deals: [] };
  }
}
