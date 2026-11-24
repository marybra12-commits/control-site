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
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    let payload = null;
    if (response && typeof response.json === "function") {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    const error = field(payload?.error);
    if (!response?.ok || !payload || typeof payload !== "object" || error) {
      return { ok: false, result: null, error };
    }
    return { ok: true, result: payload.result ?? null, next: payload.next, error: "" };
  } catch {
    return { ok: false, result: null };
  }
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

const PIPELINES = new Map([
  ["оформление якарты/аналитика", "oformlenie"],
  ["карты поддержка", "podderzhka"],
]);

export function pipelineSection(name) {
  const text = field(name).toLowerCase().replaceAll("ё", "е").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  return PIPELINES.get(text) || "";
}

function normalizedTitle(title) {
  return field(title).toLowerCase().replaceAll("ё", "е");
}

const RAKOV_MAPS = "https://yandex.ru/maps/-/CXSSVWPY";

export function mapsLinkForDeal(title, found) {
  const link = field(found);
  if (isRakovDeal(title)) return RAKOV_MAPS;
  if (isMapsUrl(link)) return link;
  if (isDiskUrl(link)) return "";
  return link;
}

function isRakovDeal(title) {
  const text = normalizedTitle(title);
  return text.includes("раков") && text.includes("двор");
}

function isProofClient(title) {
  const text = normalizedTitle(title);
  return text.includes("островок надежды магазин продуктов") || isRakovDeal(title);
}

function isNamedDeal(title) {
  return isRakovDeal(title);
}

function offerForDeal(title) {
  const text = normalizedTitle(title);
  if (text.includes("автосделка") && isRakovDeal(title)) return "/kp-rakovy-dvor.html";
  return "";
}

function categoryName(rows, id) {
  const row = (Array.isArray(rows) ? rows : []).find((item) => field(item?.ID) === id);
  return field(row?.NAME);
}

function funnelForCategory(name) {
  const exact = pipelineSection(name);
  if (exact) return exact;
  const text = normalizedTitle(name);
  if (text.includes("поддерж")) return "podderzhka";
  return "oformlenie";
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

const LINK_NEEDLES = ["профиль", "яндекс", "yandex", "карт", "2гис", "2gis", "maps", "ссылка", "сайт"];

function extractHttpUrls(value) {
  const texts = [];
  const visit = (item) => {
    if (typeof item === "string" || typeof item === "number") {
      const text = String(item).trim();
      if (text) texts.push(text);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === "object") {
      for (const key of ["VALUE", "value", "url", "URL", "href", "HREF", "link", "LINK"]) {
        if (item[key] != null) visit(item[key]);
      }
    }
  };
  visit(value);
  const found = [];
  for (const text of texts) {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (const match of matches) {
      try {
        const url = new URL(match.replace(/[),.;]+$/g, ""));
        if (url.protocol === "http:" || url.protocol === "https:") found.push(url.href);
      } catch {
        // A value that is not a URL stays empty.
      }
    }
  }
  return [...new Set(found)];
}

function usableProfileUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("bitrix24") || parsed.pathname.toLowerCase().includes("/rest/")) return false;
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isDiskUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "yadi.sk" || host.endsWith(".yadi.sk") || host.includes("disk.yandex");
  } catch {
    return false;
  }
}

function isMapsUrl(url) {
  if (isDiskUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const yandex = host === "ya.ru" || host.endsWith(".ya.ru") || /(^|\.)yandex\.(ru|com|by|kz|uz)$/.test(host);
    const gis = host === "2gis.ru" || host.endsWith(".2gis.ru") || host.endsWith(".2gis.kz") || host.endsWith(".2gis.by");
    if (yandex) return path.includes("/maps") || path.includes("/profile");
    if (gis) return path.includes("/firm") || path.includes("/geo");
    return false;
  } catch {
    return false;
  }
}

function linkEntries(row, definitions) {
  const known = labeledFields(definitions).filter((entry) => entry.name && entry.name !== "COMMENTS" && entry.name !== "TITLE");
  const seen = new Set(known.map((entry) => entry.name));
  const extras = Object.keys(row || {})
    .filter((name) => name.startsWith("UF_") && !seen.has(name))
    .map((name) => ({ name, label: "", type: "" }));
  return [...known, ...extras];
}

function dealProfileLink(row, definitions) {
  const ranked = [];
  for (const value of Object.values(row || {})) {
    const maps = extractHttpUrls(value).filter(usableProfileUrl).find(isMapsUrl);
    if (maps) ranked.push({ rank: 0, url: maps });
  }
  for (const entry of linkEntries(row, definitions)) {
    const labelRank = LINK_NEEDLES.findIndex((needle) => entry.label.includes(needle));
    const urlType = entry.type === "url";
    if (labelRank === -1 && !urlType) continue;
    const other = extractHttpUrls(row?.[entry.name]).filter(usableProfileUrl).find((url) => !isMapsUrl(url) && !isDiskUrl(url));
    if (!other) continue;
    ranked.push({ rank: labelRank === -1 ? LINK_NEEDLES.length + 2 : labelRank + 1, url: other });
  }
  ranked.sort((left, right) => left.rank - right.rank);
  return ranked[0]?.url || "";
}

function dealAddress(row, names) {
  const labeled = firstValue(row, names);
  if (labeled) return labeled;
  for (const [key, value] of Object.entries(row || {})) {
    if (!key.startsWith("UF_") || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const text = displayValue(value);
    if (text && (value.ADDRESS_1 || value.CITY || value.address_1)) return text;
  }
  return "";
}

function linkSelectNames(definitions) {
  return labeledFields(definitions).filter((entry) => {
    if (!entry.name || entry.name === "COMMENTS" || entry.name === "TITLE") return false;
    if (entry.type === "url") return true;
    if (LINK_NEEDLES.some((needle) => entry.label.includes(needle))) return true;
    return entry.name.startsWith("UF_") && (entry.type === "string" || entry.type === "");
  }).map((entry) => entry.name);
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

const PILOT_CHECKS = [
  ...STARTER_CHECKS,
  { code: "AM-D0-3", title: "Бриф" },
  { code: "AM-D0-4", title: "Где общаться" },
  { code: "AM-W1-4", title: "Материалы и ТЗ дизайнеру" },
];

function dayKey(value) {
  const parsed = parseBitrixDate(value);
  return parsed ? moscowParts(parsed).key : "";
}

function finishByText(created) {
  const key = dayKey(created);
  if (!key) return "";
  return formatDay(addDays(key, 29));
}

function daysAfter(created, now) {
  const start = dayKey(created);
  const end = moscowParts(now).key;
  if (!start || !end) return null;
  const from = atMoscowHour(start, 12).getTime();
  const to = atMoscowHour(end, 12).getTime();
  return Math.round((to - from) / 86400000);
}

function messageChunks(row) {
  const chunks = [];
  const take = (item) => {
    if (typeof item === "string" || typeof item === "number") {
      const text = String(item).replace(/\s+/g, " ").trim();
      if (text) chunks.push(text);
      return;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of ["text", "TEXT", "message", "MESSAGE", "caption", "DESCRIPTION"]) {
        if (item[key] != null && item[key] !== item) take(item[key]);
      }
    }
  };
  take(row?.text);
  take(row?.message);
  take(row?.MESSAGE);
  take(row?.params);
  take(row?.PARAMS);
  take(row?.DESCRIPTION);
  take(row?.PROVIDER_PARAMS);
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function messageText(row) {
  return messageChunks(row).toLowerCase().replaceAll("ё", "е");
}

function messageDate(row) {
  return field(row?.date || row?.DATE || row?.DATE_CREATE || row?.dateCreate);
}

function messageAuthor(row) {
  return field(row?.author_id ?? row?.authorId ?? row?.AUTHOR_ID ?? row?.senderid ?? row?.senderId ?? row?.SENDER_ID);
}

function chatRows(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return [result];
  return [];
}

function chatIdFrom(result) {
  for (const row of chatRows(result)) {
    const id = field(row?.CHAT_ID || row?.chatId || row?.chat_id);
    if (id) return id;
  }
  return "";
}

function sessionIdFrom(result) {
  for (const row of chatRows(result)) {
    const id = field(row?.SESSION_ID || row?.sessionId || row?.ASSOCIATED_ENTITY_ID);
    if (id) return id;
  }
  return "";
}

function channelProof(result) {
  const rows = Array.isArray(result) ? result : result && typeof result === "object" ? [result] : [];
  for (const row of rows) {
    const text = [row?.CONNECTOR_ID, row?.CONNECTOR_TITLE, row?.entity_id, row?.ENTITY_ID].map(field).join(" ").toLowerCase();
    if (text.includes("whatsapp")) return "Линия открыта в WhatsApp.";
    if (text.includes("telegram")) return "Линия открыта в Telegram.";
    if (text.includes("max")) return "Линия открыта в Max.";
  }
  return "";
}

function messageList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.messages)) return result.messages;
  if (Array.isArray(result?.MESSAGES)) return result.MESSAGES;
  const map = result?.message || result?.MESSAGE;
  if (map && typeof map === "object" && !Array.isArray(map)) return Object.values(map);
  return [];
}

function publicImage(value) {
  const url = field(value);
  if (!/^https?:\/\//i.test(url)) return "";
  if (url.toLowerCase().includes("/rest/")) return "";
  return url;
}

function shotFrom(message) {
  const files = [
    ...(Array.isArray(message?.files) ? message.files : []),
    ...(Array.isArray(message?.FILES) ? message.FILES : []),
  ];
  for (const file of files) {
    const url = publicImage(file?.url || file?.URL || file?.link);
    const kind = field(file?.type || file?.TYPE).toLowerCase();
    if (url && (kind.includes("image") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))) return url;
  }
  return "";
}

function proven(proof, image = "") {
  const text = field(proof);
  const shot = publicImage(image);
  if (!text && !shot) return null;
  return { proof: text, image: shot };
}

const STEP_DUE_DAY = {
  "PM-1": 0,
  "AM-D0-1": 0,
  "AM-D0-2": 0,
  "AM-D0-3": 0,
  "AM-D0-4": 0,
  "AM-W1-1": 6,
  "AM-W1-2": 6,
  "AM-W1-3": 6,
  "AM-W1-4": 6,
  "AM-W1-5": 6,
  "AM-W2-1": 13,
  "AM-W2-2": 13,
  "AM-W2-3": 13,
  "AM-W3-1": 20,
  "AM-W3-2": 20,
  "AM-W3-3": 20,
  "AM-W3-4": 20,
  "PM-4": 29,
  "PM-5": 29,
  "PM-6": 29,
  "PM-7": 29,
  "PM-8": 29,
  "PM-9": 29,
  "AM-W4-2": 29,
  "AM-W4-3": 29,
};

function dayZeroKey(created) {
  const deadline = dayZeroDeadline(created);
  return deadline ? moscowParts(deadline).key : "";
}

function hasProof(mark) {
  return Boolean(field(mark?.proof) || publicImage(mark?.image));
}

export function lateMap(created, marks, now) {
  const start = dayZeroKey(created);
  if (!start) return {};
  const late = {};
  for (const [code, offset] of Object.entries(STEP_DUE_DAY)) {
    if (hasProof(marks?.[code])) continue;
    const dueKey = addDays(start, offset);
    if (now > atMoscowHour(dueKey, 18)) late[code] = formatDay(dueKey);
  }
  return late;
}

export function stageFitFor(stageName, created, now) {
  const stage = field(stageName);
  const start = dayZeroKey(created);
  const lowered = stage.toLowerCase().replaceAll("ё", "е");
  const isNew = !stage || lowered === "новая" || lowered === "новый";
  const isReview = lowered.includes("провер");
  const isFinish = /окончан|соглас|сдан|заверш/.test(lowered);
  if (!start) return { state: stage ? "wrong" : "missing", stage, expected: "взято в работу" };
  const pastStart = now > atMoscowHour(start, 18);
  const pastReview = now > atMoscowHour(addDays(start, 20), 18);
  const pastFinish = now > atMoscowHour(addDays(start, 29), 18);
  if (!pastStart) return { state: stage ? "right" : "missing", stage, expected: "взято в работу" };
  if (!pastReview) {
    if (isNew) return { state: stage ? "wrong" : "missing", stage, expected: "взято в работу" };
    return { state: "right", stage, expected: "взято в работу" };
  }
  if (!pastFinish) {
    if (isReview || isFinish) return { state: "right", stage, expected: "на проверке" };
    return { state: stage ? "wrong" : "missing", stage, expected: "на проверке" };
  }
  if (isFinish) return { state: "right", stage, expected: "окончание" };
  return { state: stage ? "wrong" : "missing", stage, expected: "окончание" };
}

function taskRows(result) {
  const tasks = result?.tasks ?? result?.items ?? result;
  if (Array.isArray(tasks)) return tasks;
  if (tasks && typeof tasks === "object") return Object.values(tasks);
  return [];
}

function checklistAssignee(point, taskAssignee) {
  const members = point?.MEMBERS ?? point?.members;
  const rows = Array.isArray(members) ? members : [];
  const chosen = rows.find((member) => field(member?.TYPE ?? member?.type).toUpperCase() === "A") || rows[0];
  return field(chosen?.NAME ?? chosen?.name) || taskAssignee || "";
}

const PROFILE_GROUP = "настроить профиль по сделке";
const PROFILE_ITEMS = [
  ["Геолокация и вход", 6],
  ["Шапка профиля", 6],
  ["Оформление (обложка, логотип, карточки товаров)", 20],
  ["Фото по разделам", 13],
  ["Внешние ссылки", 6],
  ["Товары в витрину до 20 шт.", 13],
  ["Новости 5 шт.", 20],
  ["Ответы на отзывы", 13],
  ["QR-код", null],
  ["Лента сторис", 20],
  ["SEO фото", null],
];

function looseTitle(value) {
  return normalizedTitle(value).replace(/\s+/g, " ").replace(/[«»"()]/g, "");
}

function titlesMatch(left, right) {
  const a = looseTitle(left);
  const b = looseTitle(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

export function profileReport(items) {
  const rows = Array.isArray(items) ? items : [];
  const groupIds = new Set(rows.filter((item) => looseTitle(item?.title).includes(PROFILE_GROUP)).map((item) => field(item?.id)));
  const grouped = rows.filter((item) => groupIds.has(field(item?.parentId)));
  const pool = grouped.length ? grouped : rows.filter((item) => !looseTitle(item?.title).includes(PROFILE_GROUP));
  return PROFILE_ITEMS.map(([title]) => {
    const found = pool.find((item) => titlesMatch(item?.title, title));
    if (!found) return { title, status: NO_DATA };
    if (found.state === "closed") {
      return {
        title,
        state: "closed",
        status: DONE,
        assignee: found.assignee || NO_DATA,
        proof: "Пункт закрыт в чек-листе «Настроить профиль по сделке».",
      };
    }
    return {
      title,
      state: "open",
      status: NOT_DONE,
      assignee: found.assignee || NO_DATA,
    };
  });
}

const CONTROL_POINTS = [
  { key: "place", title: "Геолокация и вход", due: 6 },
  { key: "head", title: "Шапка профиля", due: 6 },
  { key: "design", title: "Оформление", due: 20 },
  { key: "photos", title: "Фото по разделам", due: 13 },
  { key: "links", title: "Внешние ссылки", due: 6 },
  { key: "goods", title: "Товары в витрине", due: 13 },
  { key: "news", title: "Новости", due: 20 },
  { key: "reviews", title: "Ответы на отзывы", due: 13 },
  { key: "qr", title: "QR-код", due: null },
  { key: "stories", title: "Лента сторис", due: 20 },
  { key: "seo", title: "SEO фото", due: null },
];

function countNear(html, key) {
  const patterns = [
    new RegExp(`"${key}"\\s*:\\s*\\{\\s*"count"\\s*:\\s*(\\d+)`, "i"),
    new RegExp(`"${key}Count"\\s*:\\s*(\\d+)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1]);
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // A broken block is not a profile fact.
    }
  }
  return blocks;
}

function metaContent(source, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1].replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  }
  return "";
}

function outsideYandex(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !host.includes("yandex") && !host.endsWith("ya.ru");
  } catch {
    return false;
  }
}

function mapsBusiness(data) {
  let found = null;
  const visit = (value) => {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (field(value.fullAddress) && (field(value.shortTitle) || field(value.title) || value.photos)) {
      found = value;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(data);
  return found;
}

function goodsInCard(card) {
  const cats = card?.fullObjects?.categories;
  if (!Array.isArray(cats)) return null;
  let total = 0;
  for (const cat of cats) {
    const items = cat?.categoryItems;
    if (Array.isArray(items)) total += items.length;
  }
  return total > 0 ? total : null;
}

function showcasePrice(price) {
  if (!price || typeof price !== "object") return "";
  if (Number(price.value) === 1 && field(price.currency).toUpperCase() === "RUB") return "1 ₽";
  return field(price.text);
}

function newsTitle(item) {
  const raw = field(item?.contentShort || item?.text || item?.title);
  if (!raw) return "";
  const split = raw.split(/\s{2,}/);
  return (split[0] || raw).replace(/\s+/g, " ").trim();
}

function moscowLongDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1000000000000) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
  }).format(new Date(number));
}

function shownAddress(fromDeal, fromMaps) {
  const maps = field(fromMaps);
  const deal = field(fromDeal);
  if (/,\s*(улица|ул\.|проспект|переулок|шоссе|площадь)/i.test(maps)) return maps;
  return deal || maps;
}

function tabCount(source, label) {
  const match = source.match(new RegExp(`aria-label="${label}([^"]*)"`, "i"));
  if (!match) return null;
  const count = match[1].match(/(\d+)/);
  return count ? Number(count[1]) : null;
}

export function parseMapsProfile(html) {
  const source = typeof html === "string" ? html.slice(0, 1500000) : "";
  const blocks = jsonLdBlocks(source);
  const schema = blocks.find((block) => {
    const type = field(block?.["@type"]).toLowerCase();
    return type.includes("localbusiness") || type.includes("organization") || type.includes("place");
  }) || {};
  const schemaAddress = schema.address && typeof schema.address === "object" ? schema.address : {};
  let card = null;
  const state = source.match(/<script[^>]*class=["']state-view["'][^>]*>([\s\S]*?)<\/script>/i);
  if (state?.[1]) {
    try {
      card = mapsBusiness(JSON.parse(state[1]));
    } catch {
      card = null;
    }
  }
  const title = (source.match(/<title>([^<]+)<\/title>/i)?.[1] || "")
    .replace(/\s+[—-]\s+Яндекс.*$/i, "")
    .split(",")[0]
    .trim();
  const name = field(card?.shortTitle) || field(card?.title) || field(schema.name) || metaContent(source, "og:title") || title;
  const addressText = field(card?.fullAddress)
    || field(schemaAddress.streetAddress)
    || ( `${metaContent(source, "og:description")} ${metaContent(source, "description")}`.match(/(?:ул\.|улица|проспект|пр-т|набереж\w+|переулок|шоссе)[^.]{0,80}/i)?.[0] || "").trim();
  const photoItems = Array.isArray(card?.photos?.items) ? card.photos.items : [];
  const photoAlts = photoItems.map((item) => field(item?.alt)).filter(Boolean);
  const photos = Number.isFinite(card?.photos?.count) ? card.photos.count : (photoItems.length ? photoItems.length : countNear(source, "photos"));
  const tabPhotos = tabCount(source, "Фото");
  const photoCount = photos !== null && photos !== undefined ? photos : tabPhotos;
  const reviews = Number.isFinite(card?.ratingData?.reviewCount) ? card.ratingData.reviewCount : countNear(source, "reviews") ?? tabCount(source, "Отзывы");
  const sample = Array.isArray(card?.reviewResults?.reviews) ? card.reviewResults.reviews : [];
  const answered = sample.filter((item) => field(item?.businessComment?.text)).length;
  const reviewAnswers = sample.length ? answered : countNear(source, "reviewAnswers");
  const links = [
    ...(Array.isArray(card?.urls) ? card.urls : []),
    ...(Array.isArray(card?.socialLinks) ? card.socialLinks.map((item) => item?.href) : []),
    field(schema.url),
  ].map(field).filter(outsideYandex);
  const tabsSeen = /tabs-select-view__title|aria-label="(?:Фото|Отзывы|Обзор)/i.test(source);
  const goodsTab = tabCount(source, "Товары");
  const menuTab = tabCount(source, "Меню");
  const newsTab = tabCount(source, "Новости");
  const storiesTab = tabCount(source, "Истории");
  const goodsListed = goodsInCard(card);
  const productRows = Array.isArray(card?.advert?.products) ? card.advert.products : [];
  const goodsNames = productRows.map((item) => field(item?.title)).filter(Boolean);
  const goodsPrices = productRows.map((item) => showcasePrice(item?.price)).filter(Boolean);
  const goodsDescribed = productRows.length > 0
    ? productRows.some((item) => field(item?.description) || field(item?.shortDescription) || field(item?.fullDescription))
    : null;
  const newsRows = Array.isArray(card?.eventsPreviews?.items) ? card.eventsPreviews.items : [];
  const newsTitles = newsRows.map(newsTitle).filter(Boolean);
  const newsDays = [...new Set(newsRows.map((item) => moscowLongDay(item?.publicationTime)).filter(Boolean))];
  const eventCount = Number(card?.eventsPreviews?.count);
  const goodsTabPresent = /aria-label="(?:Товары|Меню)/i.test(source);
  const newsTabPresent = /aria-label="Новости/i.test(source);
  const countedGoods = countNear(source, "goods");
  const countedPosts = countNear(source, "posts");
  const goods = goodsNames.length
    || goodsListed
    || (goodsTab > 0 ? goodsTab : null)
    || (countedGoods > 0 ? countedGoods : null)
    || (goodsTabPresent ? null : (countedGoods === 0 || (tabsSeen && !goodsTabPresent) ? 0 : null));
  const posts = newsTitles.length
    || (Number.isFinite(eventCount) && eventCount > 0 ? eventCount : null)
    || (newsTab > 0 ? newsTab : null)
    || (countedPosts > 0 ? countedPosts : null)
    || (newsTabPresent ? null : (countedPosts === 0 || (tabsSeen && !newsTabPresent) ? 0 : null));
  const stories = countNear(source, "stories") ?? (card && typeof card.hasStories === "boolean"
    ? (card.hasStories ? 1 : 0)
    : (tabsSeen ? (storiesTab ?? 0) : null));
  const logo = Boolean(card?.businessImages?.logo);
  const images = (Array.isArray(schema.image) ? schema.image.length : schema.image ? 1 : 0) + (logo ? 1 : 0) + (photoCount > 0 ? 1 : 0);
  const opened = Boolean(card || name || addressText || photoCount !== null || reviews !== null);
  return {
    readable: opened,
    opened,
    name: Boolean(name),
    profileName: name,
    addressText,
    address: Boolean(addressText),
    entrance: card
      ? ((Array.isArray(card.entrances) && card.entrances.length > 0)
        || (Array.isArray(card.features) && card.features.some((item) => /street_entrance|^entrance$/.test(field(item?.id)) && item?.value)))
      : /"entrances"\s*:\s*\[\s*\{/.test(source),
    coords: Array.isArray(card?.coordinates) || Boolean(schema.geo) || /"coordinates"\s*:/.test(source),
    images,
    logo,
    alts: photoAlts.length || (card ? 0 : [...source.matchAll(/<img\b[^>]*\balt=["']([^"']+)["']/gi)].length),
    photoAlts,
    photos: photoCount,
    photoSections: photoAlts.some((alt) => !/,\s*фото$/.test(alt)) || (!card && /"photoSections"\s*:\s*\[/.test(source)),
    externalLinks: links.length,
    goods,
    goodsNames,
    goodsPrices,
    goodsDescribed,
    goodsButton: /Посмотреть все товары и услуги/.test(source),
    goodsPresent: goodsTabPresent || goodsNames.length > 0 || (typeof goods === "number" && goods > 0),
    posts,
    newsTitles,
    newsDate: newsDays.length === 1 ? newsDays[0] : newsDays.join(", "),
    newsPresent: newsTabPresent || newsTitles.length > 0 || (typeof posts === "number" && posts > 0),
    sites: links,
    reviewReplies: sample.map((item) => field(item?.businessComment?.text).replace(/\s+/g, " ")).filter(Boolean),
    stories,
    reviews,
    reviewAnswers,
    sampledReviews: sample.length,
  };
}

function allowedMapsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const yandex = host === "ya.ru" || host.endsWith(".ya.ru") || host === "yandex.ru" || host.endsWith(".yandex.ru") || host === "yandex.com" || host.endsWith(".yandex.com") || host === "yandex.by" || host.endsWith(".yandex.by") || host === "yandex.kz" || host.endsWith(".yandex.kz");
    const path = url.pathname.toLowerCase();
    return url.protocol === "https:" && yandex && (path.includes("/maps") || path.includes("/profile"));
  } catch {
    return false;
  }
}

async function fetchMapsHtml(fetchImpl, link) {
  if (!allowedMapsUrl(link)) return null;
  try {
    const response = await fetchImpl(link, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response?.ok || (response.url && !allowedMapsUrl(response.url))) return null;
    const html = typeof response.text === "function" ? await response.text() : "";
    if (!html) return null;
    return { html, finalUrl: response.url || link };
  } catch {
    return null;
  }
}

async function readMapsProfile(fetchImpl, link) {
  const page = await fetchMapsHtml(fetchImpl, link);
  if (!page) return null;
  const profile = parseMapsProfile(page.html);
  return profile.opened ? profile : null;
}

function goodsProof(profile) {
  const names = Array.isArray(profile.goodsNames) ? profile.goodsNames.filter(Boolean).slice(0, 3) : [];
  if (!names.length) {
    if (profile.goods > 0) return `На Картах в витрине ${profile.goods} товаров.`;
    return "На Картах есть витрина товаров.";
  }
  const quoted = names.map((name) => `«${name}»`).join(", ");
  const price = Array.isArray(profile.goodsPrices) && profile.goodsPrices[0] ? `, цена ${profile.goodsPrices[0]}` : "";
  const button = profile.goodsButton ? ", кнопка «Посмотреть все товары и услуги»" : "";
  return `На витрине есть товары: ${quoted}${price}${button}.`;
}

function newsProof(profile) {
  const titles = Array.isArray(profile.newsTitles) ? profile.newsTitles.filter(Boolean) : [];
  const count = profile.posts > 0 ? profile.posts : titles.length;
  if (!titles.length) {
    if (count > 0) return `На Картах ${count} новостей.`;
    return "На Картах есть новости.";
  }
  const shown = titles.slice(0, 2).map((title) => `«${title}»`).join(" и ");
  const when = profile.newsDate ? ` от ${profile.newsDate}` : "";
  return `На Картах ${count} новостей${when}, в том числе ${shown}.`;
}

function factFor(profile, key) {
  if (!profile) return { state: "unknown", missing: "", proof: "" };
  if (key === "place") {
    const where = profile.addressText ? `: ${profile.addressText}` : "";
    if (profile.coords || profile.entrance) return { state: "yes", missing: "Нет", proof: `На Картах есть точка и адрес${where}.` };
    if (profile.address) return { state: "no", missing: `Адрес на Картах есть${where}. Точки на карте нет.`, proof: "" };
    return { state: "no", missing: "На Картах нет точки.", proof: "" };
  }
  if (key === "head") {
    if (profile.name) return { state: "yes", missing: "Нет", proof: `На Картах в шапке: ${profile.profileName || "название есть"}.` };
    return { state: "no", missing: "На Картах нет названия в шапке.", proof: "" };
  }
  if (key === "design") {
    if (profile.logo && profile.photos > 0) return { state: "yes", missing: "Нет", proof: "На Картах есть логотип и фото." };
    if (profile.images > 1) return { state: "yes", missing: "Нет", proof: "На Картах есть обложка и картинки." };
    if (profile.logo || profile.images === 1 || profile.photos > 0) return { state: "no", missing: "На Картах есть часть оформления, обложка и логотип вместе не видны.", proof: "" };
    return { state: "no", missing: "На Картах не видно обложки и логотипа.", proof: "" };
  }
  if (key === "photos") {
    if (profile.photos > 0) return { state: "yes", missing: "Нет", proof: `На Картах ${profile.photos} фото.` };
    if (profile.photos === 0) return { state: "no", missing: "На Картах нет фото.", proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  if (key === "links") {
    if (profile.externalLinks > 0) return { state: "yes", missing: "Нет", proof: "На Картах есть внешняя ссылка." };
    return { state: "no", missing: "На Картах нет внешней ссылки.", proof: "" };
  }
  if (key === "goods") {
    if (profile.goods > 0 || profile.goodsPresent) return { state: "yes", missing: "Нет", proof: goodsProof(profile) };
    if (profile.goods === 0) return { state: "no", missing: "На Картах нет товаров в витрине.", proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  if (key === "news") {
    if (profile.posts > 0 || profile.newsPresent) return { state: "yes", missing: "Нет", proof: newsProof(profile) };
    if (profile.posts === 0) return { state: "no", missing: "На Картах нет новостей.", proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  if (key === "reviews") {
    if (profile.reviews === 0) return { state: "yes", missing: "Нет", proof: "На Картах нет отзывов, отвечать не на что." };
    if (profile.sampledReviews > 0 && profile.reviewAnswers < profile.sampledReviews) {
      return { state: "no", missing: "На Картах есть отзывы без ответа.", proof: "" };
    }
    if (profile.sampledReviews > 0 && profile.reviewAnswers >= profile.sampledReviews) {
      const extra = profile.reviews > profile.sampledReviews ? ` На Картах ${profile.reviews} отзывов.` : "";
      return { state: "yes", missing: "Нет", proof: `В открытых отзывах на Картах есть ответ компании.${extra}` };
    }
    if (profile.reviews > 0 && profile.reviewAnswers === 0) return { state: "no", missing: "На Картах есть отзывы без ответа.", proof: "" };
    if (profile.reviewAnswers !== null && profile.reviews !== null && profile.reviewAnswers >= profile.reviews && profile.reviews > 0) {
      return { state: "yes", missing: "Нет", proof: "На отзывы на Картах есть ответы." };
    }
    if (profile.reviews > 0) return { state: "unknown", missing: `На Картах ${profile.reviews} отзывов. Ответы компании в этой выгрузке не видны.`, proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  if (key === "stories") {
    if (profile.stories > 0) return { state: "yes", missing: "Нет", proof: "На Картах есть сторис." };
    if (profile.stories === 0) return { state: "no", missing: "На Картах нет сторис.", proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  if (key === "seo") {
    if (profile.fileSeo) return { state: "yes", missing: "Нет", proof: "Ключевые слова записаны в файлы фото в Lightroom, не в видимую подпись на Картах." };
    const template = profile.photoAlts.length > 0 && profile.photoAlts.every(templateCaption);
    if (profile.alts > 0 && !template) return { state: "yes", missing: "Нет", proof: "У фото на Картах есть свои подписи." };
    if (template) return { state: "no", missing: "Подписи фото на Картах шаблонные, это не SEO.", proof: "" };
    if ((profile.images > 0 || profile.photos > 0) && profile.alts === 0) return { state: "no", missing: "У фото на Картах нет подписей.", proof: "" };
    return { state: "unknown", missing: "", proof: "" };
  }
  return { state: "unknown", missing: "", proof: "" };
}

function dealSite(row, definitions, mapsLink) {
  for (const entry of linkEntries(row, definitions)) {
    const site = extractHttpUrls(row?.[entry.name]).filter(usableProfileUrl).find((url) => url !== mapsLink && !isMapsUrl(url) && !isDiskUrl(url));
    if (site) return site;
  }
  return "";
}

function heardLine(heard, key) {
  const said = heard && heard[key];
  if (!said) return "";
  return " В переписке это уже звучало, на Картах не видно.";
}

function dealFact(pointKey, deal) {
  if (pointKey === "place" && deal.address) return `В сделке указан адрес: ${deal.address}.`;
  if (pointKey === "links" && deal.site) return `В сделке указан сайт: ${deal.site}.`;
  return "";
}

function chatFact(pointKey, heard) {
  const key = pointKey === "design" ? "cover" : pointKey === "photos" ? "photo" : pointKey;
  if (!heard?.[key]) return "";
  return "В переписке Wazzup это уже есть.";
}

export function controlBrief({ maps, created, now, heard, replies, deal = {} }) {
  const start = dayZeroKey(created);
  const slow = typeof replies === "string" && (replies.includes("реже") || replies.includes("пауза"));
  const opened = Boolean(maps?.opened || maps?.readable);
  const rows = CONTROL_POINTS.map((point) => {
    const fact = factFor(opened ? { ...maps, fileSeo: Boolean(deal.fileSeo) } : null, point.key);
    const fromDeal = dealFact(point.key, deal);
    const fromChat = chatFact(point.key, heard);
    const dueKey = start && typeof point.due === "number" ? addDays(start, point.due) : "";
    const due = dueKey ? formatDay(dueKey) : "";
    const late = Boolean(dueKey && now > atMoscowHour(dueKey, 18));
    const pause = slow ? " Клиент отвечает с паузами." : "";
    if (fact.state === "yes" && fact.proof) {
      const inFiles = point.key === "seo" && deal.fileSeo;
      return {
        title: point.title,
        stuck: "Нет",
        missing: "Нет",
        status: DONE,
        state: "closed",
        proof: fact.proof,
        say: inFiles ? "Ничего не говорить: ключевые слова в файлах фото." : "Ничего не говорить: на Картах это есть.",
        why: inFiles ? "Ключевые слова записаны в Lightroom, не в подпись на Картах." : "На Картах это видно.",
      };
    }
    if (fromChat) {
      return {
        title: point.title,
        stuck: "Нет",
        missing: "Нет",
        status: DONE,
        state: "closed",
        proof: fromChat,
        say: "Ничего не говорить: в переписке это есть.",
        why: fromChat,
      };
    }
    if (fact.state !== "no" && fromDeal) {
      const proof = [fromDeal, fromChat].filter(Boolean).join(" ");
      return {
        title: point.title,
        stuck: "Нет",
        missing: "Нет",
        status: DONE,
        state: "closed",
        proof,
        say: "Ничего не говорить: след уже есть.",
        why: proof,
      };
    }
    if (fact.state === "no") {
      const missing = fromDeal ? `${fact.missing} ${fromDeal}` : fact.missing;
      const chat = fromChat ? ` ${fromChat} На Картах этого нет.` : "";
      const who = deal.assignee || "Менеджеру";
      const when = due ? (late ? ` Срок был ${due}.` : ` Срок ${due}.`) : "";
      return {
        title: point.title,
        stuck: point.title,
        missing,
        status: NOT_DONE,
        state: "open",
        due,
        say: `${who}: ${fact.missing}${when}`,
        why: `${late && due ? `Срок ${due} прошёл, на Картах этого нет.` : due ? "Срок ещё не вышел." : "На Картах этого нет."}${chat}${pause}`,
      };
    }
    const known = [fact.missing, fromDeal].filter((line) => line && line !== NO_DATA);
    if (!opened && !deal.link && !known.length) {
      return {
        title: point.title,
        stuck: NO_DATA,
        missing: NO_DATA,
        say: "В сделке нет ссылки на Карты.",
        why: NO_DATA,
      };
    }
    const gap = known[0] || (deal.link ? "На странице этого пункта нет." : "В выгрузке Карт этого поля нет.");
    return {
      title: point.title,
      stuck: point.title,
      missing: gap,
      say: gap,
      why: fromChat || gap,
    };
  });
  rows.sort((left, right) => Number(right.status === NOT_DONE) - Number(left.status === NOT_DONE));
  return rows;
}

function finishDay(created) {
  const start = dayZeroKey(created);
  if (!start) return "";
  return formatDay(addDays(start, 29));
}

function templateCaption(alt) {
  return /,\s*(фото|photo)$/i.test(field(alt));
}

export function reviewFindings(profile, context = {}) {
  if (!profile?.opened && !profile?.readable) return [];
  const findings = [];
  const finish = finishDay(context.created);
  const names = Array.isArray(profile.goodsNames) ? profile.goodsNames.filter(Boolean) : [];
  const prices = Array.isArray(profile.goodsPrices) ? profile.goodsPrices.filter(Boolean) : [];
  const placeholderPrice = prices.length > 0 && prices.every((price) => price === "1 ₽" || /^1\s*р/i.test(price));
  if (names.length && placeholderPrice && profile.goodsDescribed !== true) {
    const shown = names.slice(0, 3).map((name) => `«${name}»`).join(", ");
    findings.push({
      place: `Витрина, ${shown}`,
      wrong: "1 ₽",
      change: "Цена из прайса. Полное описание и короткое описание у этой позиции.",
      regulation: true,
      deadline: finish,
    });
  }
  const alts = Array.isArray(profile.photoAlts) ? profile.photoAlts.filter(Boolean) : [];
  if (alts.length > 0 && alts.every(templateCaption)) {
    const count = profile.photos || alts.length;
    findings.push({
      place: `Видимая подпись, ${count} кадров`,
      wrong: alts[0],
      change: "Напишите, что снято на этом кадре.",
      regulation: false,
      deadline: finish,
    });
  }
  return findings;
}

export function controlMessages(job, now = new Date()) {
  const title = field(job?.title) || "Сделка";
  const report = Array.isArray(job?.report) ? job.report : [];
  const findings = Array.isArray(job?.review) ? job.review : [];
  const finish = finishDay(job?.created);
  const start = dayZeroKey(job?.created);
  const pmOpen = !start || now > atMoscowHour(addDays(start, 29), 18);
  const lines = [];
  for (const item of report) {
    if (item?.status !== NOT_DONE) continue;
    const fix = field(item.missing || item.say);
    if (!fix || fix === NO_DATA) continue;
    if (item.title === "SEO фото" && isRakovDeal(title) && /не SEO/.test(fix)) continue;
    const deadline = field(item.due) || finish || "в чек-листе даты нет";
    lines.push(`${title}. Шаг: ${item.title}. Срок: ${deadline}. Исправьте: ${fix}`);
  }
  for (const finding of findings) {
    if (!finding?.regulation || !pmOpen) continue;
    const place = field(finding.place);
    const change = field(finding.change);
    if (!place || !change) continue;
    if (lines.some((line) => /SEO фото|Подписи фото/.test(line) && /фото/i.test(place))) continue;
    const deadline = field(finding.deadline) || finish || "день 29";
    lines.push(`${title}. Шаг: ${place}. Срок: ${deadline}. Исправьте: ${change}`);
  }
  return lines;
}

const postedChatLines = new Set();
const postedComments = new Set();
let controlChatId = "";

export function resetControlChatState() {
  postedChatLines.clear();
  postedComments.clear();
  controlChatId = "";
}

function controlChatIdFrom(result) {
  if (typeof result === "number" || typeof result === "string") return field(result);
  if (result && typeof result === "object") return field(result.ID ?? result.id ?? result.CHAT_ID ?? result.chatId);
  return "";
}

function isMaria(user) {
  return field(user?.NAME).toLowerCase() === "мария" && field(user?.LAST_NAME).toLowerCase().startsWith("браг");
}

async function findMaria(fetchImpl, base) {
  const listed = await postResult(fetchImpl, endpointFor(base, "user.get.json"), {
    filter: { NAME: "Мария", LAST_NAME: "Брага", ACTIVE: true },
  });
  if (!listed.ok) return { id: "", missing: listed.error ? "user.get" : "" };
  const rows = Array.isArray(listed.result) ? listed.result : [];
  const maria = rows.find(isMaria);
  return { id: maria ? field(maria.ID) : "", missing: "" };
}

async function ensureControlChat(fetchImpl, base, mariaId) {
  if (controlChatId) return { id: controlChatId, missing: "" };
  const created = await postResult(fetchImpl, endpointFor(base, "im.chat.add.json"), {
    TYPE: "CHAT",
    TITLE: "Система контроля",
    USERS: [Number(mariaId) || mariaId],
    ENTITY_TYPE: "CONTROL_SITE",
    ENTITY_ID: `maria-${mariaId}`,
  });
  const id = controlChatIdFrom(created.result);
  if (created.ok && id) {
    controlChatId = id;
    return { id, missing: "" };
  }
  return { id: "", missing: created.error ? "im.chat.add" : "" };
}

function commentText(row) {
  return messageText({ text: field(row?.COMMENT ?? row?.comment ?? row?.TEXT) });
}

async function postDealComment(fetchImpl, base, dealId, line) {
  const key = `${dealId}|${line}`;
  if (postedComments.has(key)) return "";
  const sent = await postResult(fetchImpl, endpointFor(base, "crm.timeline.comment.add.json"), {
    fields: {
      ENTITY_ID: Number(dealId) || dealId,
      ENTITY_TYPE: "deal",
      COMMENT: line,
    },
  });
  if (!sent.ok) return sent.error ? "crm.timeline.comment.add" : "";
  postedComments.add(key);
  return "";
}

export async function deliverControlChat(fetchImpl, base, jobs, now = new Date()) {
  const ordered = [...(Array.isArray(jobs) ? jobs : [])].sort((left, right) => Number(Boolean(right?.offer)) - Number(Boolean(left?.offer)));
  const pending = [];
  for (const job of ordered) {
    for (const line of controlMessages(job, now)) {
      const key = `${field(job?.id)}|${line}`;
      pending.push({ key, id: field(job?.id), line });
    }
  }
  if (!pending.length) return { posted: 0, missing: "" };
  const failures = [];
  const note = (method) => {
    if (method && !failures.includes(method)) failures.push(method);
  };
  const maria = await findMaria(fetchImpl, base);
  note(maria.missing);
  const chat = maria.id ? await ensureControlChat(fetchImpl, base, maria.id) : { id: "", missing: "" };
  note(chat.missing);
  const seen = new Set();
  if (chat.id) {
    const history = await postResult(fetchImpl, endpointFor(base, "im.dialog.messages.get.json"), {
      DIALOG_ID: `chat${chat.id}`,
      LIMIT: 100,
    });
    for (const row of messageList(history.result)) seen.add(messageText(row));
  }
  let posted = 0;
  for (const item of pending) {
    if (!postedChatLines.has(item.key)) {
      if (!chat.id) {
        // The chat method is already recorded. The deal comment still goes out.
      } else if (seen.has(messageText({ text: item.line }))) {
        postedChatLines.add(item.key);
      } else {
        const sent = await postResult(fetchImpl, endpointFor(base, "im.message.add.json"), {
          DIALOG_ID: `chat${chat.id}`,
          MESSAGE: item.line,
        });
        if (!sent.ok) note(sent.error ? "im.message.add" : "");
        else {
          postedChatLines.add(item.key);
          seen.add(messageText({ text: item.line }));
          posted += 1;
        }
      }
    }
    if (item.id) note(await postDealComment(fetchImpl, base, item.id, item.line));
  }
  return { posted, missing: failures.join(", ") };
}

export function managerRows(items, created, now) {
  const start = dayZeroKey(created);
  return (Array.isArray(items) ? items : []).map((item) => {
    const offset = PROFILE_ITEMS.find(([title]) => title === item.title)?.[1];
    const dueKey = start && typeof offset === "number" ? addDays(start, offset) : "";
    const due = dueKey ? formatDay(dueKey) : "";
    const late = Boolean(dueKey && now > atMoscowHour(dueKey, 18) && item.state !== "closed");
    if (item.status === NO_DATA) {
      return {
        ...item,
        stuck: NO_DATA,
        overdue: NO_DATA,
        say: NO_DATA,
        why: "В чек-листе Битрикса этого пункта нет.",
      };
    }
    if (item.state === "closed" && item.proof) {
      return { ...item, stuck: "Нет", overdue: "Нет", due, say: "Ничего не говорить: пункт закрыт.", why: "Пункт закрыт в чек-листе." };
    }
    if (typeof offset !== "number") {
      return { ...item, stuck: "Да", overdue: NO_DATA, say: `Пункт «${item.title}» открыт. Срока в регламенте нет.`, why: NO_DATA };
    }
    if (late) {
      return { ...item, stuck: "Да", overdue: due, due, say: `Закройте «${item.title}». Срок был ${due}.`, why: `Пункт открыт, срок ${due} прошёл.` };
    }
    return { ...item, stuck: "Да", overdue: "Нет", due, say: `Пункт «${item.title}» ещё открыт. Срок ${due}.`, why: "Срок ещё не вышел." };
  });
}

async function bitrixChecklist(fetchImpl, base, dealId, people) {
  try {
    const listed = await postResult(fetchImpl, endpointFor(base, "tasks.task.list.json"), {
      filter: { UF_CRM_TASK: `D_${dealId}` },
      select: ["ID", "TITLE", "RESPONSIBLE_ID"],
    });
    if (!listed.ok) return null;
    const tasks = taskRows(listed.result).slice(0, 8);
    if (!tasks.length) return [];
    const items = [];
    let readFailed = false;
    for (const task of tasks) {
      const taskId = field(task?.id ?? task?.ID);
      if (!taskId) continue;
      const taskAssignee = people.get(field(task?.responsibleId ?? task?.RESPONSIBLE_ID)) || "";
      const points = await postResult(fetchImpl, endpointFor(base, "task.checklistitem.getlist.json"), {
        TASKID: Number(taskId) || taskId,
        ORDER: { SORT_INDEX: "asc" },
      });
      if (!points.ok || !Array.isArray(points.result)) {
        readFailed = true;
        continue;
      }
      for (const point of points.result) {
        if (items.length >= 80) break;
        const title = field(point?.TITLE ?? point?.title);
        if (!title || title.toLowerCase().includes("/rest/")) continue;
        const parent = field(point?.PARENT_ID ?? point?.parentId);
        const closed = field(point?.IS_COMPLETE ?? point?.isComplete).toUpperCase() === "Y";
        items.push({
          id: field(point?.ID ?? point?.id),
          parentId: parent,
          title,
          root: parent === "0" || parent === "",
          state: closed ? "closed" : "open",
          assignee: checklistAssignee(point, taskAssignee) || NO_DATA,
        });
      }
    }
    if (!items.length) return readFailed ? null : [];
    return items;
  } catch {
    return null;
  }
}

const RUDE = ["дурак", "идиот", "ужасн", "бесите", "обман", "хам", "позор", "верните деньги"];
const CALM = ["спасибо", "благодар", "пожалуйста", "добрый день", "добрый вечер", "здравствуйте"];

function toneLabel(texts) {
  if (!texts.length) return NO_DATA;
  const blob = texts.join(" ");
  if (RUDE.some((word) => blob.includes(word))) return "резкий";
  if (CALM.some((word) => blob.includes(word))) return "спокойный";
  return "нейтральный";
}

function dayGap(fromKey, toKey) {
  const from = atMoscowHour(fromKey, 12).getTime();
  const to = atMoscowHour(toKey, 12).getTime();
  return Math.round((to - from) / 86400000);
}

function replyPattern(dates) {
  const keys = [...new Set(dates.map((value) => dayKey(value)).filter(Boolean))].sort();
  if (!keys.length) return NO_DATA;
  if (keys.length === 1) return "одно сообщение клиента, регулярность не видна";
  let max = 0;
  for (let index = 1; index < keys.length; index += 1) {
    max = Math.max(max, dayGap(keys[index - 1], keys[index]));
  }
  if (max <= 3) return "отвечает в пределах трёх дней";
  if (max <= 7) return `пауза между ответами до ${max} дней`;
  return "ответы реже раза в неделю";
}

const TOPIC_LABELS = [
  ["макет", "макет"],
  ["бриф", "бриф"],
  ["фото", "фото"],
  ["отзыв", "отзывы"],
  ["сторис", "сторис"],
  ["новост", "новости"],
  ["витрин", "витрину"],
  ["товар", "товары"],
  ["сайт", "сайт"],
  ["ссылк", "ссылки"],
  ["оплат", "оплату"],
  ["счет", "оплату"],
  ["счёт", "оплату"],
  ["кьюар", "QR"],
  ["qr", "QR"],
  ["логотип", "оформление"],
  ["обложк", "оформление"],
  ["оформлен", "оформление"],
  ["адрес", "адрес"],
  ["геолок", "точку на карте"],
];

function topicLine(turns) {
  const blob = turns.map((turn) => turn.folded).join(" ");
  const found = [];
  for (const [needle, label] of TOPIC_LABELS) {
    if (blob.includes(needle) && !found.includes(label)) found.push(label);
  }
  if (!found.length) return NO_DATA;
  if (found.length === 1) return `Говорили про ${found[0]}.`;
  const last = found[found.length - 1];
  return `Говорили про ${found.slice(0, -1).join(", ")} и ${last}.`;
}

function askRank(text) {
  if (text.includes("?")) return 2;
  if (/(когда|где|как|сколько|почему|зачем|можно|какой|какая|какие|подскажите|пришлите|пришли)/.test(text)) return 2;
  if (/(жду|нужно|надо)/.test(text)) return 1;
  return 0;
}

function unansweredLine(turns) {
  if (!turns.length) return NO_DATA;
  let lastManager = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "manager") lastManager = index;
  });
  const pending = [];
  for (const turn of turns.slice(lastManager + 1)) {
    if (turn.role !== "client" || askRank(turn.folded) === 0) continue;
    if (!pending.includes(turn.plain)) pending.push(turn.plain);
  }
  if (!pending.length) return "Неотвеченных вопросов нет.";
  const line = pending.slice(-2).join(". ");
  return line.length > 180 ? `${line.slice(0, 177)}…` : line;
}

export function readDialog(messages, operatorIds) {
  const operators = operatorIds instanceof Set ? operatorIds : new Set();
  const clientDates = [];
  const clientTexts = [];
  const managerTexts = [];
  const turns = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const author = messageAuthor(message);
    const folded = messageText(message).trim();
    const plain = messageChunks(message).trim();
    const system = field(message?.system ?? message?.SYSTEM).toUpperCase() === "Y";
    if (system || !folded || !author || folded.includes("/rest/")) continue;
    const isManager = author !== "0" && (operators.size === 0 || operators.has(author));
    const when = messageDate(message);
    turns.push({ role: isManager ? "manager" : "client", folded, plain, date: when, index: turns.length });
    if (isManager) {
      managerTexts.push(folded);
      continue;
    }
    clientTexts.push(folded);
    if (when) clientDates.push(when);
  }
  turns.sort((left, right) => {
    if (left.date && right.date && left.date !== right.date) return left.date < right.date ? -1 : 1;
    return left.index - right.index;
  });
  return {
    clientTone: toneLabel(clientTexts),
    replies: replyPattern(clientDates),
    managerTone: toneLabel(managerTexts),
    about: topicLine(turns),
    unanswered: unansweredLine(turns),
  };
}

function operatorIdsFrom(result, assigneeId) {
  const ids = new Set();
  const assignee = field(assigneeId);
  if (assignee) ids.add(assignee);
  const rows = Array.isArray(result) ? result : result && typeof result === "object" ? [result] : [];
  for (const row of rows) {
    const single = field(row?.OPERATOR_ID || row?.operatorId);
    if (single) ids.add(single);
    const lists = [row?.OPERATORS, row?.operators];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const id = field(item?.ID ?? item?.id ?? item);
        if (id) ids.add(id);
      }
    }
  }
  ids.delete("");
  return ids;
}

function activityRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function paramsOf(row) {
  const params = row?.PROVIDER_PARAMS || row?.PROVIDER_DATA || row?.providerParams;
  if (typeof params === "string") {
    try {
      const parsed = JSON.parse(params);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return params && typeof params === "object" ? params : {};
}

async function findOpenLine(fetchImpl, base, dealId) {
  const chat = await postResult(fetchImpl, endpointFor(base, "imopenlines.crm.chat.get.json"), {
    CRM_ENTITY_TYPE: "deal",
    CRM_ENTITY: dealId,
  });
  if (chatIdFrom(chat.result) || sessionIdFrom(chat.result)) return chat.result;
  const listed = await postResult(fetchImpl, endpointFor(base, "crm.activity.list.json"), {
    filter: { OWNER_TYPE_ID: 2, OWNER_ID: dealId, PROVIDER_ID: "IMOPENLINES_SESSION" },
    select: ["ID", "ASSOCIATED_ENTITY_ID", "PROVIDER_PARAMS", "PROVIDER_DATA"],
    order: { ID: "DESC" },
  });
  for (const activity of activityRows(listed.result)) {
    const params = paramsOf(activity);
    const chatId = field(params.CHAT_ID || params.chatId);
    const sessionId = field(activity?.ASSOCIATED_ENTITY_ID) || field(params.SESSION_ID);
    if (!chatId && !sessionId) continue;
    return {
      CHAT_ID: chatId,
      SESSION_ID: sessionId,
      CONNECTOR_ID: field(params.CONNECTOR_ID || params.connectorId),
      OPERATOR_ID: field(params.OPERATOR_ID || params.operatorId),
    };
  }
  return null;
}

function heardFrom(messages) {
  const blob = (Array.isArray(messages) ? messages : []).map((message) => messageText(message)).join(" ");
  return {
    place: blob.includes("адрес") || blob.includes("геолок") || blob.includes("точка"),
    head: blob.includes("шапк") || blob.includes("название"),
    cover: blob.includes("обложк") || blob.includes("логотип"),
    stories: blob.includes("сторис"),
    photo: blob.includes("фото"),
    links: blob.includes("ссылк") || blob.includes("сайт"),
    goods: blob.includes("товар") || blob.includes("витрин"),
    news: blob.includes("новост"),
    reviews: blob.includes("отзыв"),
    seo: blob.includes("seo") || blob.includes("подпис"),
    qr: blob.includes("qr") || blob.includes("кьюар") || blob.includes("qr-код") || blob.includes("куар"),
  };
}

async function wazzupMessages(fetchImpl, base, dealId, assigneeId) {
  const listed = await postResult(fetchImpl, endpointFor(base, "crm.activity.list.json"), {
    filter: { OWNER_TYPE_ID: 2, OWNER_ID: dealId },
    select: ["ID", "PROVIDER_ID", "SUBJECT", "DESCRIPTION", "DIRECTION", "CREATED"],
    order: { ID: "DESC" },
  });
  const messages = [];
  for (const activity of activityRows(listed.result).slice(0, 100)) {
    const blob = [activity?.PROVIDER_ID, activity?.SUBJECT].map(field).join(" ").toLowerCase();
    if (!blob.includes("wazzup")) continue;
    const text = field(activity?.DESCRIPTION).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text.toLowerCase().includes("/rest/")) continue;
    const outgoing = field(activity?.DIRECTION) === "2";
    messages.push({
      text,
      author_id: outgoing ? (assigneeId || "1") : "0",
      date: field(activity?.CREATED),
    });
  }
  return messages;
}

async function lineMessages(fetchImpl, base, line) {
  const sessionId = sessionIdFrom(line);
  if (sessionId) {
    const history = await postResult(fetchImpl, endpointFor(base, "imopenlines.session.history.get.json"), {
      SESSION_ID: sessionId,
      LIMIT: 100,
    });
    const messages = messageList(history.result);
    if (messages.length) return messages;
  }
  const chatId = chatIdFrom(line);
  if (!chatId) return [];
  const history = await postResult(fetchImpl, endpointFor(base, "im.dialog.messages.get.json"), {
    DIALOG_ID: `chat${chatId}`,
    LIMIT: 100,
  });
  return messageList(history.result);
}

async function proofFromDialog(fetchImpl, base, dealId, now, assigneeId, row) {
  const notes = {
    brief: NO_DATA,
    marks: {},
    dialog: { clientTone: NO_DATA, replies: NO_DATA, managerTone: NO_DATA },
  };
  try {
    const line = await findOpenLine(fetchImpl, base, dealId, row);
    const channel = proven(channelProof(line));
    if (channel) notes.marks["AM-D0-4"] = channel;
    const seen = new Set();
    const messages = [];
    for (const message of [
      ...await lineMessages(fetchImpl, base, line),
      ...await wazzupMessages(fetchImpl, base, dealId, assigneeId),
    ]) {
      const key = `${messageText(message)}|${messageDate(message)}`;
      if (!messageText(message) || seen.has(key)) continue;
      seen.add(key);
      messages.push(message);
    }
    notes.dialog = readDialog(messages, operatorIdsFrom(line, assigneeId));
    notes.heard = heardFrom(messages);
    let briefAt = "";
    let briefShot = "";
    for (const message of messages) {
      const text = messageText(message);
      const sent = messageDate(message);
      const shot = shotFrom(message);
      if (!briefAt && (text.includes("1faipqlsdtturke79hrfeyfkel1afonn-sv-juoztjgqqv29-sii_tig") || text.includes("заполните бриф"))) {
        briefAt = sent;
        briefShot = shot;
      }
      if (text.includes("менеджер по оформлению") || text.includes("оформлением вашего профиля")) {
        const phrase = text.includes("менеджер по оформлению") ? "менеджер по оформлению" : "оформлением вашего профиля";
        const mark = proven(`В переписке написано «${phrase}».`, shot);
        if (mark) notes.marks["AM-D0-2"] = mark;
      }
      const asksCode = text.includes("код") && (text.includes("смс") || text.includes("номер"));
      if (asksCode || text.includes("создадим новую точку") || text.includes("мини-экскурсия")) {
        const mark = proven(asksCode ? "В переписке запрошен код на номер." : "В переписке есть инструкция для новой точки.", shot);
        if (mark) notes.marks["AM-W1-1"] = mark;
      }
      if (text.includes("max") && text.includes("whatsapp") && text.includes("telegram")) {
        const mark = proven("В одном сообщении названы Max, WhatsApp и Telegram.", shot);
        if (mark) notes.marks["AM-D0-4"] = mark;
      }
    }
    if (briefAt) {
      const passed = daysAfter(briefAt, now);
      const when = formatDay(briefAt) || NO_DATA;
      notes.brief = passed !== null && passed >= 3
        ? `отправлен ${when}, 3 дня прошли`
        : `отправлен ${when}, 3 дня ещё не прошли`;
      const mark = proven(`Бриф ${notes.brief}.`, briefShot);
      if (mark) notes.marks["AM-D0-3"] = mark;
    }
  } catch {
    return notes;
  }
  return notes;
}

async function listActiveDeals(fetchImpl, base, categoryId, select) {
  const rows = [];
  let start = 0;
  for (let page = 0; page < 3; page += 1) {
    const listed = await postResult(fetchImpl, endpointFor(base, DEAL_LIST_METHOD), {
      start,
      filter: { CATEGORY_ID: categoryId, CLOSED: "N" },
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

async function readDeal(fetchImpl, base, id) {
  const got = await postResult(fetchImpl, endpointFor(base, "crm.deal.get.json"), { id });
  if (!got.ok || !got.result || typeof got.result !== "object" || Array.isArray(got.result)) return null;
  return got.result;
}

async function findNamedDeals(fetchImpl, base, select) {
  const filters = [{ "%TITLE": "Раковой" }, { "%TITLE": "Раковый" }, { "%TITLE": "Раков" }];
  for (const filter of filters) {
    const listed = await postResult(fetchImpl, endpointFor(base, DEAL_LIST_METHOD), {
      filter,
      select,
      order: { DATE_CREATE: "DESC" },
    });
    if (!listed.ok || !Array.isArray(listed.result)) continue;
    const found = listed.result.filter((row) => isNamedDeal(row?.TITLE));
    if (found.length) return found;
  }
  return [];
}

export async function loadOformlenieDeals(env = serviceEnv(), fetchImpl = fetch, now = new Date()) {
  if (!webhookConfigured(env)) {
    return { connected: false, deals: [] };
  }

  const base = env[WEBHOOK_ENV].trim();

  try {
    const started = Date.now();
    const [definitions, catalog, categoriesFirst, defaultCategory] = await Promise.all([
      postResult(fetchImpl, endpointFor(base, "crm.deal.userfield.list.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.deal.fields.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.dealcategory.list.json"), {}),
      postResult(fetchImpl, endpointFor(base, "crm.dealcategory.default.get.json"), {}),
    ]);
    const categories = categoriesFirst.ok
      ? categoriesFirst
      : await postResult(fetchImpl, endpointFor(base, "crm.dealcategory.list.json"), {});
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
    const linkFields = fieldsByNeedles(fields, LINK_NEEDLES, ["url"]);
    const addressFields = fieldsByNeedles(fields, ["адрес"], ["address"]);
    const select = [...new Set([
      "ID",
      "TITLE",
      "CATEGORY_ID",
      "STAGE_ID",
      "STAGE_SEMANTIC_ID",
      "ASSIGNED_BY_ID",
      "CONTACT_ID",
      "COMPANY_ID",
      "DATE_CREATE",
      "BEGINDATE",
      "CLOSEDATE",
      "COMMENTS",
      periodField,
      ...linkSelectNames(fields),
      ...addressFields,
    ].filter(Boolean))];

    const shortSelect = [
      "ID", "TITLE", "CATEGORY_ID", "STAGE_ID", "STAGE_SEMANTIC_ID", "ASSIGNED_BY_ID",
      "CONTACT_ID", "COMPANY_ID", "DATE_CREATE", "BEGINDATE", "CLOSEDATE", "COMMENTS",
    ];
    const listed = await Promise.all(pipelines.map(async (pipeline) => {
      let page = await listActiveDeals(fetchImpl, base, pipeline.id, select);
      if (!page.ok) page = await listActiveDeals(fetchImpl, base, pipeline.id, shortSelect);
      return { pipeline, ...page };
    }));

    const rows = [];
    const seen = new Set();
    for (const page of listed) {
      if (!page.ok) continue;
      for (const row of page.rows) {
        const categoryId = field(row?.CATEGORY_ID) || page.pipeline.id;
        if (categoryId !== page.pipeline.id) continue;
        const id = field(row?.ID);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({ row, funnel: page.pipeline.section, pipeline: categoryName(categoryRows, categoryId) });
      }
    }
    const namedRows = await findNamedDeals(fetchImpl, base, select);
    const namedFallback = namedRows.length ? namedRows : await findNamedDeals(fetchImpl, base, shortSelect);
    if (pipelines.length > 0 && listed.every((page) => !page.ok) && !namedFallback.length) {
      return { connected: false, unavailable: true, deals: [] };
    }
    for (const row of namedFallback) {
      const id = field(row?.ID);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const categoryId = field(row?.CATEGORY_ID);
      const pipeline = categoryName(categoryRows, categoryId);
      rows.push({ row, funnel: funnelForCategory(pipeline), pipeline });
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

    const built = new Map();
    const chatJobs = [];
    const rank = (title) => {
      if (offerForDeal(title)) return 0;
      if (isNamedDeal(title)) return 1;
      if (isProofClient(title)) return 2;
      return 3;
    };
    const ordered = [...rows].sort((left, right) => rank(left.row?.TITLE) - rank(right.row?.TITLE));
    for (const item of ordered) {
    try {
      let row = item.row;
      const stageId = field(row?.STAGE_ID);
      const stageName = stages.get(stageId) ?? "";
      const named = isNamedDeal(row?.TITLE);
      if (!named && !isActiveDeal(row, stageName)) continue;
      if (named) {
        const full = await readDeal(fetchImpl, base, field(row?.ID));
        if (full) row = { ...row, ...full };
      }
      const assigneeId = field(row?.ASSIGNED_BY_ID);
      const proof = isProofClient(row?.TITLE) && (item.funnel === "oformlenie" || named);
      const marks = {};
      let brief = "";
      let finishBy = "";
      let talk = null;
      let heard = null;
      const heavy = Date.now() - started < 18000;
      if (proof && heavy) {
        finishBy = finishByText(row?.DATE_CREATE);
        const stageIsNew = field(stageName).toLowerCase() === "новая" || field(stageName).toLowerCase() === "новый";
        const person = people.get(assigneeId) ?? "";
        if (person && stageName && !stageIsNew) {
          const mark = proven(`Стадия «${stageName}», ответственная ${person}.`);
          if (mark) marks["AM-D0-1"] = mark;
        }
        if (field(row?.COMMENTS).toLowerCase().includes("тз")) {
          const mark = proven("В комментарии карточки есть ТЗ.");
          if (mark) marks["AM-W1-4"] = mark;
        }
        const dialog = await proofFromDialog(fetchImpl, base, field(row?.ID), now, assigneeId, row);
        Object.assign(marks, dialog.marks);
        brief = dialog.brief;
        talk = dialog.dialog;
        heard = dialog.heard || null;
      }
      const late = proof ? lateMap(row?.DATE_CREATE, marks, now) : null;
      const stageFit = proof ? stageFitFor(stageName, row?.DATE_CREATE, now) : null;
      const fullList = proof && heavy ? await bitrixChecklist(fetchImpl, base, field(row?.ID), people) : null;
      const leaves = Array.isArray(fullList) ? fullList.filter((point) => !point.root) : fullList;
      const visible = Array.isArray(leaves) && leaves.length ? leaves : fullList;
      const checklist = Array.isArray(visible)
        ? visible.map(({ title, state, assignee }) => ({ title, state, assignee }))
        : visible;
      const profileLink = mapsLinkForDeal(row?.TITLE, dealProfileLink(row, fields) || firstValue(row, linkFields));
      const maps = named && heavy ? await readMapsProfile(fetchImpl, profileLink) : null;
      const site = named ? dealSite(row, fields, profileLink) : "";
      const address = shownAddress(dealAddress(row, addressFields), maps?.addressText);
      const report = named ? controlBrief({
        maps,
        created: row?.DATE_CREATE,
        now,
        heard,
        replies: talk?.replies,
        deal: { address, site, link: profileLink, assignee: people.get(assigneeId) || "", fileSeo: isRakovDeal(row?.TITLE) },
      }) : null;
      const review = named && maps ? reviewFindings(maps, { created: row?.DATE_CREATE, now }) : [];
      if (named && report) {
        chatJobs.push({
          id: field(row?.ID),
          title: organizationName(row?.TITLE),
          created: row?.DATE_CREATE,
          report,
          review,
          offer: Boolean(offerForDeal(row?.TITLE)),
        });
      }
      built.set(field(row?.ID), {
        id: field(row?.ID),
        title: organizationName(row?.TITLE),
        period: present(periodText(periodField ? row?.[periodField] : "", row?.BEGINDATE, row?.CLOSEDATE)),
        link: present(profileLink),
        address: present(address),
        assignee: present(people.get(assigneeId) ?? ""),
        stage: present(stageName),
        funnel: item.funnel,
        ...(item.pipeline ? { pipeline: item.pipeline } : {}),
        ...(finishBy ? { finishBy } : {}),
        ...(brief ? { brief } : {}),
        ...(proof ? { pilot: true, late, stageFit, checklist, dialog: talk } : {}),
        ...(offerForDeal(row?.TITLE) ? { offer: "/kp-rakovy-dvor.html" } : {}),
        ...(report ? { report } : {}),
        ...(review.length ? { review } : {}),
        marks,
        checks: (proof ? PILOT_CHECKS : STARTER_CHECKS).map((check) => {
          const mark = marks[check.code];
          const proof = field(mark?.proof);
          const image = publicImage(mark?.image);
          return {
            code: check.code,
            title: check.title,
            status: proof || image ? DONE : NO_DATA,
            ...(proof ? { proof } : {}),
            ...(image ? { image } : {}),
          };
        }),
      });
    } catch {
      const title = organizationName(item.row?.TITLE);
      if (!title) continue;
      built.set(field(item.row?.ID), {
        id: field(item.row?.ID),
        title,
        period: NO_DATA,
        link: present(mapsLinkForDeal(item.row?.TITLE, "")),
        address: NO_DATA,
        assignee: NO_DATA,
        stage: NO_DATA,
        funnel: item.funnel,
        ...(item.pipeline ? { pipeline: item.pipeline } : {}),
        ...(offerForDeal(item.row?.TITLE) ? { offer: "/kp-rakovy-dvor.html" } : {}),
      });
    }
    }
    const deals = [];
    for (const item of rows) {
      const deal = built.get(field(item.row?.ID));
      if (deal && !deals.some((existing) => existing.id === deal.id)) deals.push(deal);
    }
    deals.sort((left, right) => Number(isProofClient(right.title)) - Number(isProofClient(left.title)));
    let chat = { posted: 0, missing: "" };
    try {
      chat = await deliverControlChat(fetchImpl, base, chatJobs, now);
    } catch {
      chat = { posted: 0, missing: "" };
    }
    return {
      connected: true,
      deals,
      ...(chat.missing ? { chat: { posted: chat.posted, missing: chat.missing } } : {}),
    };
  } catch {
    return { connected: false, unavailable: true, deals: [] };
  }
}
