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

const NO_DATA = "Нет данных";
const DONE = "Сделано";
const NOT_DONE = "Не сделано";
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
  "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08",
  "2026-02-23", "2026-03-08", "2026-05-01", "2026-05-09",
  "2026-06-12", "2026-11-04",
]);

export function organizationName(title) {
  const text = field(title).replace(/\s+/g, " ");
  if (!text) return "";
  const prefix = /^(?:индивидуальный\s+предприниматель|и\s*\.?\s*п\s*\.?)\s+/i;
  if (!prefix.test(text)) return text;
  const rest = text.replace(prefix, "").trim();
  return rest ? `ИП ${rest}` : "ИП";
}

function labelText(entry) {
  const sources = [entry?.LIST_COLUMN_LABEL, entry?.EDIT_FORM_LABEL, entry?.LIST_FILTER_LABEL];
  for (const source of sources) {
    if (typeof source === "string" && source.trim()) return source.trim();
    if (source && typeof source === "object") {
      const ru = source.ru || source.RU;
      if (typeof ru === "string" && ru.trim()) return ru.trim();
    }
  }
  return "";
}

function displayValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (value && typeof value === "object" && (typeof value.VALUE === "string" || typeof value.VALUE === "number")) {
    return String(value.VALUE).trim();
  }
  return "";
}

function formatDay(value) {
  const match = field(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function periodText(custom, begin, close) {
  const labeled = displayValue(custom);
  if (labeled) return labeled;
  const start = formatDay(begin);
  const end = formatDay(close);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

function fieldByLabel(definitions, needles) {
  const rows = (Array.isArray(definitions) ? definitions : []).map((entry) => ({
    name: field(entry?.FIELD_NAME),
    label: labelText(entry).toLowerCase(),
  })).filter((entry) => entry.name && entry.label);
  for (const needle of needles) {
    const exact = rows.find((entry) => entry.label === needle);
    if (exact) return exact.name;
  }
  for (const needle of needles) {
    const partial = rows.find((entry) => entry.label.includes(needle));
    if (partial) return partial.name;
  }
  return "";
}

function parseBitrixDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.trim().replace(" ", "T");
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) text += "+03:00";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function moscowParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    key: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    weekday: get("weekday"),
  };
}

function atMoscowHour(dayKey, hour) {
  return new Date(`${dayKey}T${String(hour).padStart(2, "0")}:00:00+03:00`);
}

function addDays(dayKey, count) {
  const date = atMoscowHour(dayKey, 12);
  date.setUTCDate(date.getUTCDate() + count);
  return moscowParts(date).key;
}

function isDayOff(dayKey, weekday) {
  return weekday === "Sat" || weekday === "Sun" || HOLIDAYS.has(dayKey);
}

export function dayZeroDeadline(created) {
  const parsed = parseBitrixDate(created);
  if (!parsed) return null;
  let cursor = parsed;
  for (let step = 0; step < 21; step += 1) {
    const parts = moscowParts(cursor);
    if (!isDayOff(parts.key, parts.weekday) && parts.hour < 18) {
      return atMoscowHour(parts.key, 18);
    }
    const nextKey = addDays(parts.key, 1);
    cursor = atMoscowHour(nextKey, 9);
  }
  return null;
}

function stageIsNew(stageId, stageName) {
  const id = field(stageId).toUpperCase();
  if (!id && !field(stageName)) return null;
  if (id === "NEW" || id.endsWith(":NEW")) return true;
  const name = field(stageName).toLowerCase();
  return name === "новая" || name === "новый";
}

export function acceptanceStatus({ created, stageId, stageName, assignee, now }) {
  const fresh = stageIsNew(stageId, stageName);
  const named = field(assignee);
  if (fresh === null) return NO_DATA;
  const deadline = dayZeroDeadline(created);
  if (!deadline) return NO_DATA;
  const accepted = Boolean(named) && fresh === false;
  if (accepted) return DONE;
  if (now > deadline) return NOT_DONE;
  return NO_DATA;
}

function personName(user) {
  return [field(user?.NAME), field(user?.LAST_NAME)].filter(Boolean).join(" ");
}

function dealsFromPayload(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.result)) {
    return null;
  }
  return payload.result.slice(0, 20);
}

function endpointFor(base, method) {
  return `${base.endsWith("/") ? base : `${base}/`}${method}`;
}

async function postResult(fetchImpl, endpoint, body) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return { ok: false, result: null };
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || payload.error) return { ok: false, result: null };
  return { ok: true, result: payload.result ?? null };
}

function stageNames(result) {
  const names = new Map();
  if (!Array.isArray(result)) return names;
  for (const row of result) {
    const entity = field(row?.ENTITY_ID);
    if (entity !== "DEAL_STAGE" && !entity.startsWith("DEAL_STAGE_")) continue;
    const id = field(row?.STATUS_ID);
    const name = field(row?.NAME);
    if (id && name) names.set(id, name);
  }
  return names;
}

function usersById(result) {
  const names = new Map();
  if (!Array.isArray(result)) return names;
  for (const row of result) {
    const id = field(row?.ID);
    const name = personName(row);
    if (id && name) names.set(id, name);
  }
  return names;
}

function present(value) {
  return value || NO_DATA;
}

function funnelsByCategory(result) {
  const map = new Map();
  if (!Array.isArray(result)) return map;
  for (const row of result) {
    const id = field(row?.ID);
    const name = field(row?.NAME).toLowerCase();
    if (!id) continue;
    if (name.includes("оформ")) map.set(id, "oformlenie");
    else if (name.includes("поддерж")) map.set(id, "podderzhka");
    else map.set(id, "other");
  }
  return map;
}

function dealMarks({ created, stageId, stageName, assignee, funnel, supportLoad, now }) {
  const acceptance = acceptanceStatus({ created, stageId, stageName, assignee, now });
  const deadline = dayZeroDeadline(created);
  const overdueEmpty = !field(assignee) && deadline && now > deadline;
  const marks = {};
  if (funnel !== "podderzhka") marks["AM-D0-1"] = acceptance;
  if (funnel !== "oformlenie") marks["SP-D0-1"] = acceptance;
  if (funnel !== "podderzhka") marks["PM-1"] = overdueEmpty ? NOT_DONE : NO_DATA;
  if (funnel !== "oformlenie") {
    marks["PM-2"] = supportLoad > 40 || overdueEmpty ? NOT_DONE : NO_DATA;
  }
  return marks;
}

const STARTER_CHECKS = [
  { code: "AM-D0-1", title: "Принять карточку" },
  { code: "AM-D0-2", title: "Приветствие" },
  { code: "AM-W1-1", title: "Доступ или новая точка" },
];

export async function loadOformlenieDeals(env = serviceEnv(), fetchImpl = fetch, now = new Date()) {
  if (!webhookConfigured(env)) {
    return { connected: false, deals: [] };
  }

  const base = env[WEBHOOK_ENV].trim();

  try {
    const definitions = await postResult(fetchImpl, endpointFor(base, "crm.deal.userfield.list.json"), {});
    const fields = Array.isArray(definitions.result) ? definitions.result : [];
    const periodField = fieldByLabel(fields, ["период"]);
    const linkField = fieldByLabel(fields, ["ссылка", "сайт"]);
    const addressField = fieldByLabel(fields, ["адрес"]);
    const select = [
      "ID",
      "TITLE",
      "CATEGORY_ID",
      "STAGE_ID",
      "ASSIGNED_BY_ID",
      "DATE_CREATE",
      "BEGINDATE",
      "CLOSEDATE",
      ...[periodField, linkField, addressField].filter(Boolean),
    ];

    const listed = await postResult(fetchImpl, endpointFor(base, DEAL_LIST_METHOD), {
      start: 0,
      limit: 20,
      select,
    });
    const rows = dealsFromPayload({ result: listed.result });
    if (!listed.ok || !rows) {
      return { connected: false, unavailable: true, deals: [] };
    }

    const assigneeIds = [...new Set(rows.map((row) => field(row?.ASSIGNED_BY_ID)).filter(Boolean))];
    const [statuses, users, categories] = await Promise.all([
      postResult(fetchImpl, endpointFor(base, "crm.status.list.json"), {}),
      assigneeIds.length
        ? postResult(fetchImpl, endpointFor(base, "user.get.json"), { filter: { ID: assigneeIds } })
        : Promise.resolve({ ok: true, result: [] }),
      postResult(fetchImpl, endpointFor(base, "crm.dealcategory.list.json"), {}),
    ]);
    const stages = stageNames(statuses.result);
    const people = usersById(users.result);
    const funnels = funnelsByCategory(categories.result);
    const supportLoad = new Map();
    for (const row of rows) {
      const assigneeId = field(row?.ASSIGNED_BY_ID);
      if (!assigneeId || funnels.get(field(row?.CATEGORY_ID)) !== "podderzhka") continue;
      supportLoad.set(assigneeId, (supportLoad.get(assigneeId) ?? 0) + 1);
    }

    const deals = rows.map((row) => {
      const assigneeId = field(row?.ASSIGNED_BY_ID);
      const stageId = field(row?.STAGE_ID);
      const funnel = funnels.get(field(row?.CATEGORY_ID)) ?? "other";
      const marks = dealMarks({
        created: row?.DATE_CREATE,
        stageId,
        stageName: stages.get(stageId) ?? "",
        assignee: assigneeId,
        funnel,
        supportLoad: supportLoad.get(assigneeId) ?? 0,
        now,
      });
      return {
        id: field(row?.ID),
        title: organizationName(row?.TITLE),
        period: present(periodText(periodField ? row?.[periodField] : "", row?.BEGINDATE, row?.CLOSEDATE)),
        link: present(displayValue(linkField ? row?.[linkField] : "")),
        address: present(displayValue(addressField ? row?.[addressField] : "")),
        assignee: present(people.get(assigneeId) ?? ""),
        stage: present(stages.get(stageId) ?? ""),
        funnel,
        marks,
        checks: STARTER_CHECKS.map((check) => ({
          code: check.code,
          title: check.title,
          status: marks[check.code] || NO_DATA,
        })),
      };
    });
    return { connected: true, deals };
  } catch {
    return { connected: false, unavailable: true, deals: [] };
  }
}
