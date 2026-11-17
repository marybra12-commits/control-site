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
  if (value && typeof value === "object") {
    if (typeof value.VALUE === "string" || typeof value.VALUE === "number") return String(value.VALUE).trim();
    const parts = ["ADDRESS_1", "ADDRESS_2", "CITY", "REGION", "PROVINCE", "POSTAL_CODE"].map((key) => field(value[key])).filter(Boolean);
    if (parts.length) return parts.join(", ");
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
  return { ok: true, result: payload.result ?? null, next: payload.next };
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

export function pipelineSection(name) {
  const text = field(name).toLowerCase().replaceAll("ё", "е");
  if (text.includes("оформлен")) return "oformlenie";
  if (text.includes("поддерж")) return "podderzhka";
  return "";
}

function pipelinesFromCategories(result) {
  if (!Array.isArray(result)) return [];
  const pipelines = [];
  for (const row of result) {
    const id = field(row?.ID);
    const section = pipelineSection(row?.NAME);
    if (!id || !section || pipelines.some((item) => item.id === id)) continue;
    pipelines.push({ id, section });
  }
  return pipelines;
}

function catalogFields(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  return Object.entries(result).map(([name, meta]) => ({
    FIELD_NAME: name,
    USER_TYPE_ID: meta?.type,
    LIST_COLUMN_LABEL: meta?.listLabel || meta?.title,
    EDIT_FORM_LABEL: meta?.formLabel || meta?.title,
  }));
}

function labeledFields(definitions) {
  return (Array.isArray(definitions) ? definitions : []).map((entry) => ({
    name: field(entry?.FIELD_NAME),
    label: labelText(entry).toLowerCase().replaceAll("ё", "е"),
    type: field(entry?.USER_TYPE_ID).toLowerCase(),
  })).filter((entry) => entry.name);
}

function fieldsByNeedles(definitions, needles, types) {
  const ranked = [];
  for (const entry of labeledFields(definitions)) {
    const typeRank = types.includes(entry.type) ? 0 : 1;
    const labelRank = needles.findIndex((needle) => entry.label.includes(needle));
    if (labelRank === -1 && typeRank === 1) continue;
    ranked.push({ name: entry.name, rank: labelRank === -1 ? needles.length + typeRank : labelRank });
  }
  ranked.sort((left, right) => left.rank - right.rank);
  return [...new Set(ranked.map((entry) => entry.name))];
}

function firstValue(row, names) {
  for (const name of names) {
    const value = displayValue(row?.[name]);
    if (value) return value;
  }
  return "";
}

function isActiveDeal(row, stageName) {
  const semantic = field(row?.STAGE_SEMANTIC_ID).toUpperCase();
  if (semantic === "S" || semantic === "F") return false;
  const stageId = field(row?.STAGE_ID).toUpperCase();
  if (stageId === "WON" || stageId === "LOSE" || stageId.endsWith(":WON") || stageId.endsWith(":LOSE")) return false;
  const name = field(stageName).toLowerCase();
  if (name.includes("успешно") || name.includes("проигран")) return false;
  return semantic === "" || semantic === "P";
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

async function listActiveDeals(fetchImpl, base, categoryId, select) {
  const rows = [];
  let start = 0;
  for (let page = 0; page < 3; page += 1) {
    const listed = await postResult(fetchImpl, endpointFor(base, DEAL_LIST_METHOD), {
      start,
      filter: { CATEGORY_ID: categoryId, STAGE_SEMANTIC_ID: "P" },
      select,
      order: { DATE_CREATE: "DESC" },
    });
    if (!listed.ok || !Array.isArray(listed.result)) return { ok: false, rows };
    rows.push(...listed.result);
    if (typeof listed.next !== "number") break;
    start = listed.next;
  }
  return { ok: true, rows };
}

export async function loadOformlenieDeals(env = serviceEnv(), fetchImpl = fetch, now = new Date()) {
  if (!webhookConfigured(env)) {
    return { connected: false, deals: [] };
  }

  const base = env[WEBHOOK_ENV].trim();

  try {
    const [definitions, catalog, categories, defaultCategory] = await Promise.all([
      postResult(fetchImpl, endpointFor(base, "crm.deal.userfield.list.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.deal.fields.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.dealcategory.list.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.dealcategory.default.get.json"), {}),
    ]);
    if (!categories.ok) return { connected: false, unavailable: true, deals: [] };

    const categoryRows = Array.isArray(categories.result) ? [...categories.result] : [];
    const fallback = defaultCategory.result;
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) categoryRows.push(fallback);
    const pipelines = pipelinesFromCategories(categoryRows);
    const fields = [
      ...(Array.isArray(definitions.result) ? definitions.result : []),
      ...catalogFields(catalog.result),
    ];
    const periodField = fieldByLabel(fields, ["период"]);
    const linkFields = fieldsByNeedles(fields, ["профиль", "яндекс", "карт", "ссылка", "сайт"], ["url"]);
    const addressFields = fieldsByNeedles(fields, ["адрес"], ["address"]);
    const select = [...new Set([
      "ID",
      "TITLE",
      "CATEGORY_ID",
      "STAGE_ID",
      "STAGE_SEMANTIC_ID",
      "ASSIGNED_BY_ID",
      "DATE_CREATE",
      "BEGINDATE",
      "CLOSEDATE",
      periodField,
      ...linkFields,
      ...addressFields,
    ].filter(Boolean))];

    const listed = await Promise.all(pipelines.map(async (pipeline) => {
      const page = await listActiveDeals(fetchImpl, base, pipeline.id, select);
      return { pipeline, ...page };
    }));
    if (pipelines.length > 0 && listed.every((page) => !page.ok)) {
      return { connected: false, unavailable: true, deals: [] };
    }

    const rows = [];
    for (const page of listed) {
      if (!page.ok) continue;
      for (const row of page.rows) {
        const categoryId = field(row?.CATEGORY_ID) || page.pipeline.id;
        if (categoryId !== page.pipeline.id) continue;
        rows.push({ row, funnel: page.pipeline.section });
      }
    }

    const assigneeIds = [...new Set(rows.map((item) => field(item.row?.ASSIGNED_BY_ID)).filter(Boolean))];
    const [statuses, users] = await Promise.all([
      postResult(fetchImpl, endpointFor(base, "crm.status.list.json"), {}),
      assigneeIds.length
        ? postResult(fetchImpl, endpointFor(base, "user.get.json"), { filter: { ID: assigneeIds } })
        : Promise.resolve({ ok: true, result: [] }),
    ]);
    const stages = stageNames(statuses.result);
    const people = usersById(users.result);
    const supportLoad = new Map();
    for (const item of rows) {
      const assigneeId = field(item.row?.ASSIGNED_BY_ID);
      if (!assigneeId || item.funnel !== "podderzhka") continue;
      supportLoad.set(assigneeId, (supportLoad.get(assigneeId) ?? 0) + 1);
    }

    const deals = [];
    for (const item of rows) {
      const row = item.row;
      const stageId = field(row?.STAGE_ID);
      const stageName = stages.get(stageId) ?? "";
      if (!isActiveDeal(row, stageName)) continue;
      const assigneeId = field(row?.ASSIGNED_BY_ID);
      const marks = dealMarks({
        created: row?.DATE_CREATE,
        stageId,
        stageName,
        assignee: assigneeId,
        funnel: item.funnel,
        supportLoad: supportLoad.get(assigneeId) ?? 0,
        now,
      });
      deals.push({
        id: field(row?.ID),
        title: organizationName(row?.TITLE),
        period: present(periodText(periodField ? row?.[periodField] : "", row?.BEGINDATE, row?.CLOSEDATE)),
        link: present(firstValue(row, linkFields)),
        address: present(firstValue(row, addressFields)),
        assignee: present(people.get(assigneeId) ?? ""),
        stage: present(stageName),
        funnel: item.funnel,
        marks,
        checks: STARTER_CHECKS.map((check) => ({
          code: check.code,
          title: check.title,
          status: marks[check.code] || NO_DATA,
        })),
      });
    }
    return { connected: true, deals };
  } catch {
    return { connected: false, unavailable: true, deals: [] };
  }
}
