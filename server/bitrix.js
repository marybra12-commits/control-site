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

function isProofClient(title) {
  const text = normalizedTitle(title);
  return text.includes("островок надежды магазин продуктов") || text.includes("раковый двор");
}

function isNamedDeal(title) {
  return normalizedTitle(title).includes("раковый двор");
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

function messageText(row) {
  return [row?.text, row?.message, row?.MESSAGE].map((item) => field(item).toLowerCase().replaceAll("ё", "е")).join(" ");
}

function messageDate(row) {
  return field(row?.date || row?.DATE || row?.DATE_CREATE);
}

function chatIdFrom(result) {
  const rows = Array.isArray(result) ? result : result && typeof result === "object" ? [result] : [];
  for (const row of rows) {
    const id = field(row?.CHAT_ID || row?.chatId);
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

async function bitrixChecklist(fetchImpl, base, dealId, people) {
  try {
    const listed = await postResult(fetchImpl, endpointFor(base, "tasks.task.list.json"), {
      filter: { UF_CRM_TASK: `D_${dealId}` },
      select: ["ID", "TITLE", "RESPONSIBLE_ID"],
    });
    if (!listed.ok) return null;
    const tasks = taskRows(listed.result).slice(0, 3);
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
        if (items.length >= 40) break;
        const title = field(point?.TITLE ?? point?.title);
        if (!title || title.toLowerCase().includes("/rest/")) continue;
        const parent = field(point?.PARENT_ID ?? point?.parentId);
        const closed = field(point?.IS_COMPLETE ?? point?.isComplete).toUpperCase() === "Y";
        items.push({
          title,
          root: parent === "0",
          state: closed ? "closed" : "open",
          assignee: checklistAssignee(point, taskAssignee) || NO_DATA,
        });
      }
    }
    if (!items.length) return readFailed ? null : [];
    const leaves = items.filter((item) => !item.root);
    const shown = leaves.length ? leaves : items;
    return shown.map(({ title, state, assignee }) => ({ title, state, assignee }));
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
  return NO_DATA;
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

export function readDialog(messages, operatorIds) {
  const empty = { clientTone: NO_DATA, replies: NO_DATA, managerTone: NO_DATA };
  if (!operatorIds || operatorIds.size === 0) return empty;
  const clientDates = [];
  const clientTexts = [];
  const managerTexts = [];
  for (const message of messages) {
    const author = field(message?.author_id ?? message?.authorId ?? message?.AUTHOR_ID);
    if (!author || author === "0") continue;
    const text = messageText(message);
    if (operatorIds.has(author)) {
      if (text) managerTexts.push(text);
      continue;
    }
    if (text) clientTexts.push(text);
    const when = messageDate(message);
    if (when) clientDates.push(when);
  }
  return {
    clientTone: toneLabel(clientTexts),
    replies: replyPattern(clientDates),
    managerTone: toneLabel(managerTexts),
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

async function proofFromDialog(fetchImpl, base, dealId, now, assigneeId) {
  const notes = {
    brief: NO_DATA,
    marks: {},
    dialog: { clientTone: NO_DATA, replies: NO_DATA, managerTone: NO_DATA },
  };
  try {
    const chat = await postResult(fetchImpl, endpointFor(base, "imopenlines.crm.chat.get.json"), {
      CRM_ENTITY_TYPE: "DEAL",
      CRM_ENTITY: dealId,
    });
    const channel = proven(channelProof(chat.result));
    if (channel) notes.marks["AM-D0-4"] = channel;
    const chatId = chatIdFrom(chat.result);
    if (!chatId) return notes;
    const history = await postResult(fetchImpl, endpointFor(base, "im.dialog.messages.get.json"), {
      DIALOG_ID: `chat${chatId}`,
      LIMIT: 50,
    });
    const messages = messageList(history.result);
    notes.dialog = readDialog(messages, operatorIdsFrom(chat.result, assigneeId));
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

async function findNamedDeals(fetchImpl, base, select) {
  const filters = [{ "%TITLE": "Раковый двор" }, { TITLE: "%Раковый двор%" }];
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
      "COMMENTS",
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
    for (const row of await findNamedDeals(fetchImpl, base, select)) {
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

    const deals = [];
    for (const item of rows) {
      const row = item.row;
      const stageId = field(row?.STAGE_ID);
      const stageName = stages.get(stageId) ?? "";
      const named = isNamedDeal(row?.TITLE);
      if (!named && !isActiveDeal(row, stageName)) continue;
      const assigneeId = field(row?.ASSIGNED_BY_ID);
      const proof = isProofClient(row?.TITLE) && (item.funnel === "oformlenie" || named);
      const marks = {};
      let brief = "";
      let finishBy = "";
      let talk = null;
      if (proof) {
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
        const dialog = await proofFromDialog(fetchImpl, base, field(row?.ID), now, assigneeId);
        Object.assign(marks, dialog.marks);
        brief = dialog.brief;
        talk = dialog.dialog;
      }
      const late = proof ? lateMap(row?.DATE_CREATE, marks, now) : null;
      const stageFit = proof ? stageFitFor(stageName, row?.DATE_CREATE, now) : null;
      const checklist = proof ? await bitrixChecklist(fetchImpl, base, field(row?.ID), people) : null;
      deals.push({
        id: field(row?.ID),
        title: organizationName(row?.TITLE),
        period: present(periodText(periodField ? row?.[periodField] : "", row?.BEGINDATE, row?.CLOSEDATE)),
        link: present(firstValue(row, linkFields)),
        address: present(firstValue(row, addressFields)),
        assignee: present(people.get(assigneeId) ?? ""),
        stage: present(stageName),
        funnel: item.funnel,
        ...(item.pipeline ? { pipeline: item.pipeline } : {}),
        ...(finishBy ? { finishBy } : {}),
        ...(brief ? { brief } : {}),
        ...(proof ? { pilot: true, late, stageFit, checklist, dialog: talk } : {}),
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
    }
    deals.sort((left, right) => Number(isProofClient(right.title)) - Number(isProofClient(left.title)));
    return { connected: true, deals };
  } catch {
    return { connected: false, unavailable: true, deals: [] };
  }
}
