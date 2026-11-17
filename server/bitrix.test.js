import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceStatus, controlBrief, loadOformlenieDeals, organizationName, parseMapsProfile, pipelineSection, readDialog, webhookConfigured } from "./bitrix.js";

test("missing or blank webhook stays disconnected and does not call Bitrix", async () => {
  assert.equal(webhookConfigured({}), false);
  assert.equal(webhookConfigured({ BITRIX_WEBHOOK_URL: "" }), false);
  assert.equal(webhookConfigured({ BITRIX_WEBHOOK_URL: "   " }), false);

  let called = false;
  const result = await loadOformlenieDeals({ BITRIX_WEBHOOK_URL: "" }, async () => {
    called = true;
    throw new Error("should not be called");
  });

  assert.equal(called, false);
  assert.deepEqual(result, { connected: false, deals: [] });
});

test("an ИП title keeps the short form and the name already written", () => {
  assert.equal(organizationName("ИП Иванова Анна"), "ИП Иванова Анна");
  assert.equal(organizationName("Индивидуальный предприниматель Иванова Анна"), "ИП Иванова Анна");
  assert.equal(organizationName("ООО Ромашка"), "ООО Ромашка");
});

test("acceptance uses the funnel and does not call a missing chat step failed", () => {
  const later = new Date("2026-11-20T12:00:00+03:00");
  assert.equal(acceptanceStatus({
    created: "2026-11-16T11:00:00+03:00",
    stageId: "C2:WON",
    stageName: "Успех",
    assignee: "4",
    now: later,
  }), "Сделано");
  assert.equal(acceptanceStatus({
    created: "2026-11-16T11:00:00+03:00",
    stageId: "C2:NEW",
    stageName: "Новая",
    assignee: "",
    now: later,
  }), "Не сделано");
  assert.equal(acceptanceStatus({
    created: "",
    stageId: "C2:NEW",
    stageName: "Новая",
    assignee: "",
    now: later,
  }), "Нет данных");
});

test("only the named Bitrix pipelines open a tab", () => {
  assert.equal(pipelineSection("Оформление ЯКарты/Аналитика"), "oformlenie");
  assert.equal(pipelineSection("Карты поддержка"), "podderzhka");
  assert.equal(pipelineSection("Оформление"), "");
  assert.equal(pipelineSection("Поддержка"), "");
  assert.equal(pipelineSection("Продажи"), "");
});

test("each funnel keeps its active deals and drops a won card", async () => {
  const calls = [];
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder" },
    async (url, options) => {
      calls.push({ url, options });
      if (String(url).startsWith("https://yandex.ru/maps/")) {
        const html = `<script type="application/ld+json">{"@type":"LocalBusiness","name":"Раковый двор","address":{"streetAddress":"Набережная, 4"},"geo":{"latitude":1,"longitude":2},"image":["https://yandex.ru/cover.jpg","https://yandex.ru/logo.jpg"],"url":"https://example.invalid/site"}</script>"photos":{"count":3}"photoSections":[]"goods":{"count":0}"posts":{"count":1}"stories":{"count":0}"reviews":{"count":2}"reviewAnswers":{"count":0}"entrances":[{"coordinates":[1,2]}]`;
        return {
          ok: true,
          url,
          async text() {
            return html;
          },
        };
      }
      const method = String(url).split("/").pop();
      const body = JSON.parse(options.body || "{}");
      const payloads = {
        "crm.deal.userfield.list.json": [
          { FIELD_NAME: "UF_PERIOD", LIST_COLUMN_LABEL: { ru: "Период" } },
          { FIELD_NAME: "UF_LINK", EDIT_FORM_LABEL: { ru: "Ссылка" } },
          { FIELD_NAME: "UF_ADDRESS", LIST_COLUMN_LABEL: "Адрес точки" },
          { FIELD_NAME: "UF_MAPS", USER_TYPE_ID: "string", LIST_COLUMN_LABEL: "Организация" },
          { FIELD_NAME: "UF_NOTE", USER_TYPE_ID: "string", LIST_COLUMN_LABEL: "Заметка" },
        ],
        "crm.dealcategory.list.json": [
          { ID: "2", NAME: "Оформление ЯКарты/Аналитика" },
          { ID: "5", NAME: "Карты поддержка" },
          { ID: "9", NAME: "Продажи" },
        ],
        "crm.status.list.json": [
          { ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:PREPARATION", NAME: "В работе" },
          { ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:START", NAME: "Начало оформления" },
          { ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:WON", NAME: "Успешно реализовано" },
          { ENTITY_ID: "DEAL_STAGE_5", STATUS_ID: "C5:EXECUTING", NAME: "Сопровождение" },
        ],
        "user.get.json": [
          { ID: 4, NAME: "Анна", LAST_NAME: "Смирнова" },
          { ID: 8, NAME: "Ольга", LAST_NAME: "Воробьева" },
        ],
        "tasks.task.list.json": {
          tasks: [{ id: "50", title: "Оформление", responsibleId: "9" }],
        },
        "task.checklistitem.getlist.json": [
          { TITLE: "Витрина", PARENT_ID: "1", IS_COMPLETE: "Y", MEMBERS: [{ TYPE: "A", NAME: "Ольга Воробьева" }] },
          { TITLE: "Фото", PARENT_ID: "1", IS_COMPLETE: "N", MEMBERS: [] },
          { TITLE: "Список", PARENT_ID: "0", IS_COMPLETE: "N", MEMBERS: [] },
        ],
      };
      let resultRows = payloads[method] ?? [];
      if (method === "crm.deal.list.json") {
        const titleFilter = body.filter?.["%TITLE"] || body.filter?.TITLE || "";
        if (titleFilter) {
          resultRows = [{
            ID: 44,
            TITLE: "Раковый двор на набережной",
            CATEGORY_ID: "9",
            STAGE_ID: "C9:WON",
            STAGE_SEMANTIC_ID: "S",
            ASSIGNED_BY_ID: 4,
            DATE_CREATE: "2026-08-01T10:00:00+03:00",
          }];
        } else {
          const category = String(body.filter?.CATEGORY_ID ?? "");
          if (category === "2") {
          resultRows = [
            {
              ID: 7,
              TITLE: "  Индивидуальный предприниматель Иванова Анна  ",
              CATEGORY_ID: "2",
              STAGE_ID: "C2:PREPARATION",
              STAGE_SEMANTIC_ID: "P",
              ASSIGNED_BY_ID: 4,
              DATE_CREATE: "2026-11-16T11:00:00+03:00",
              UF_PERIOD: "ноябрь",
              UF_LINK: "https://example.invalid/card",
              UF_ADDRESS: "Невский, 1",
            },
            {
              ID: 21,
              TITLE: "Островок надежды магазин продуктов",
              CATEGORY_ID: "2",
              STAGE_ID: "C2:START",
              STAGE_SEMANTIC_ID: "P",
              CLOSED: "N",
              ASSIGNED_BY_ID: 8,
              DATE_CREATE: "2026-01-23T10:00:00+03:00",
              UF_LINK: "https://example.invalid/maps",
              UF_ADDRESS: "Рынок, 2",
            },
            {
              ID: 31,
              TITLE: "Автосделка Раковой Двор Оформление+3Д",
              CATEGORY_ID: "2",
              STAGE_ID: "C2:PREPARATION",
              STAGE_SEMANTIC_ID: "P",
              ASSIGNED_BY_ID: 8,
              DATE_CREATE: "2026-11-10T10:00:00+03:00",
            },
            {
              ID: 11,
              TITLE: "Договор на 3 Профиля по 15000",
              CATEGORY_ID: "2",
              STAGE_ID: "C2:WON",
              STAGE_SEMANTIC_ID: "S",
              ASSIGNED_BY_ID: 4,
            },
          ];
        } else if (category === "5") {
          resultRows = [
            {
              ID: 12,
              TITLE: "Кафе Волна",
              CATEGORY_ID: "5",
              STAGE_ID: "C5:EXECUTING",
              STAGE_SEMANTIC_ID: "P",
              ASSIGNED_BY_ID: 4,
              DATE_CREATE: "2026-11-02T11:00:00+03:00",
              UF_NOTE: "https://example.invalid/not-the-profile",
            },
            {
              ID: 13,
              TITLE: "Магазин электрики (поддержка 1 год)",
              CATEGORY_ID: "5",
              STAGE_ID: "C5:WON",
              STAGE_SEMANTIC_ID: "S",
              ASSIGNED_BY_ID: 4,
            },
          ];
          } else {
            resultRows = [];
          }
        }
      }
      if (method === "crm.deal.get.json" && String(body.id) === "31") {
        resultRows = {
          ID: 31,
          UF_HIDDEN_MAP: { url: "https://yandex.ru/maps/org/rakovy-dvor/42" },
          UF_DISK: "https://disk.yandex.ru/d/not-the-profile",
          UF_HIDDEN_ADDRESS: { ADDRESS_1: "Набережная, 4", CITY: "Санкт-Петербург" },
          UF_PERIOD: "ноябрь",
        };
      }
      if (method === "tasks.task.list.json") {
        const crm = String(body.filter?.UF_CRM_TASK || "");
        resultRows = crm === "D_31"
          ? { tasks: [{ id: "61", title: "Оформление", responsibleId: "8" }] }
          : { tasks: [{ id: "50", title: "Оформление", responsibleId: "9" }] };
      }
      if (method === "task.checklistitem.getlist.json" && String(body.TASKID) === "61") {
        const open = (id, title) => ({ ID: id, TITLE: title, PARENT_ID: "10", IS_COMPLETE: "N" });
        resultRows = [
          { ID: "10", TITLE: "Настроить профиль по сделке", PARENT_ID: "0", IS_COMPLETE: "N" },
          open("11", "Геолокация и вход"),
          { ID: "12", TITLE: "Шапка профиля", PARENT_ID: "10", IS_COMPLETE: "Y", MEMBERS: [{ TYPE: "A", NAME: "Лиана" }] },
          open("13", "Оформление (обложка, логотип, карточки товаров)"),
          open("14", "Фото по разделам"),
          open("15", "Внешние ссылки"),
          open("16", "Товары в витрину до 20 шт."),
          open("17", "Новости 5 шт."),
          open("18", "Ответы на отзывы"),
          open("19", "QR-код"),
          open("20", "Лента сторис"),
        ];
      }
      if (method === "imopenlines.crm.chat.get.json" && String(body.CRM_ENTITY) === "21") {
        resultRows = { CHAT_ID: "77", CONNECTOR_ID: "whatsapp" };
      }
      if (method === "imopenlines.crm.chat.get.json" && String(body.CRM_ENTITY) === "31") {
        resultRows = [];
      }
      if (method === "crm.activity.list.json" && String(body.filter?.OWNER_ID) === "31") {
        resultRows = [{
          ID: "9",
          ASSOCIATED_ENTITY_ID: "88",
          PROVIDER_PARAMS: { CHAT_ID: "88", CONNECTOR_ID: "wazzup_whatsapp", OPERATOR_ID: "8" },
        }];
      }
      if (method === "imopenlines.session.history.get.json" && String(body.SESSION_ID) === "88") {
        resultRows = {
          message: {
            1: { senderid: "8", text: "Здравствуйте, я менеджер по оформлению", date: "2026-11-10T11:00:00+03:00" },
            2: { senderid: "0", text: "Спасибо, добрый день", date: "2026-11-10T15:00:00+03:00" },
            3: { senderid: "0", text: "Пожалуйста, жду макет", date: "2026-11-12T12:00:00+03:00" },
          },
        };
      }
      if (method === "im.dialog.messages.get.json") {
        resultRows = String(body.DIALOG_ID) === "chat88"
          ? {
            messages: [
              { author_id: "8", text: "Здравствуйте, я менеджер по оформлению", date: "2026-11-10T11:00:00+03:00" },
              { author_id: "15", text: "Спасибо, добрый день", date: "2026-11-10T15:00:00+03:00" },
              { author_id: "15", text: "Пожалуйста, жду макет", date: "2026-11-12T12:00:00+03:00" },
            ],
          }
          : {
            messages: [
              {
                text: "Добрый день, заполните бриф по ссылке",
                date: "2026-01-23T12:00:00+03:00",
                files: [{ type: "image", url: "https://example.invalid/brief.png" }],
              },
            ],
          };
      }
      return {
        ok: true,
        async json() {
          return { result: resultRows };
        },
      };
    },
    new Date("2026-11-20T12:00:00+03:00"),
  );

  const dealCall = calls.find((call) => {
    if (!String(call.url).endsWith("/crm.deal.list.json")) return false;
    return JSON.parse(call.options.body).filter.CATEGORY_ID === "2";
  });
  assert.equal(dealCall.options.method, "POST");
  assert.equal(JSON.parse(dealCall.options.body).filter.CLOSED, "N");
  assert.deepEqual(JSON.parse(dealCall.options.body).select, [
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
    "UF_PERIOD",
    "UF_LINK",
    "UF_ADDRESS",
    "UF_MAPS",
    "UF_NOTE",
  ]);
  assert.equal(result.connected, true);
  assert.deepEqual(result.deals.map((deal) => deal.title), [
    "Островок надежды магазин продуктов",
    "Автосделка Раковой Двор Оформление+3Д",
    "Раковый двор на набережной",
    "ИП Иванова Анна",
    "Кафе Волна",
  ]);
  const ostrovok = result.deals[0];
  assert.equal(ostrovok.funnel, "oformlenie");
  assert.equal(ostrovok.stage, "Начало оформления");
  assert.equal(ostrovok.assignee, "Ольга Воробьева");
  assert.equal(ostrovok.finishBy, "21.02.2026");
  assert.equal(ostrovok.brief, "отправлен 23.01.2026, 3 дня прошли");
  const accepted = ostrovok.checks.find((check) => check.code === "AM-D0-1");
  const briefStep = ostrovok.checks.find((check) => check.code === "AM-D0-3");
  assert.equal(accepted.status, "Сделано");
  assert.equal(accepted.proof, "Стадия «Начало оформления», ответственная Ольга Воробьева.");
  assert.equal(briefStep.status, "Сделано");
  assert.equal(briefStep.proof, "Бриф отправлен 23.01.2026, 3 дня прошли.");
  assert.equal(briefStep.image, "https://example.invalid/brief.png");
  assert.equal(ostrovok.checks.find((check) => check.code === "AM-D0-2").status, "Нет данных");
  assert.equal(ostrovok.late["AM-D0-2"], "23.01.2026");
  assert.equal(ostrovok.late["AM-D0-1"], undefined);
  assert.equal(ostrovok.late["AM-D0-3"], undefined);
  assert.equal(ostrovok.stageFit.state, "wrong");
  assert.equal(ostrovok.stageFit.stage, "Начало оформления");
  assert.equal(ostrovok.stageFit.expected, "окончание");
  assert.deepEqual(ostrovok.checklist, [
    { title: "Витрина", state: "closed", assignee: "Ольга Воробьева" },
    { title: "Фото", state: "open", assignee: "Нет данных" },
  ]);
  assert.equal(ostrovok.checks.every((check) => check.status !== "Сделано" || check.proof || check.image), true);
  assert.deepEqual(ostrovok.dialog, {
    clientTone: "Нет данных",
    replies: "Нет данных",
    managerTone: "Нет данных",
    about: "Нет данных",
    unanswered: "Нет данных",
  });
  const rakovy = result.deals.find((deal) => deal.title === "Автосделка Раковой Двор Оформление+3Д");
  assert.equal(rakovy.link, "https://yandex.ru/maps/-/CXSKA-pK");
  assert.equal(JSON.stringify(rakovy).includes("disk.yandex"), false);
  assert.equal(rakovy.address, "Набережная, 4, Санкт-Петербург");
  assert.equal(rakovy.period, "ноябрь");
  assert.equal(rakovy.assignee, "Ольга Воробьева");
  assert.equal(rakovy.stage, "В работе");
  assert.equal(rakovy.pilot, true);
  assert.equal(rakovy.stage, "В работе");
  assert.equal(rakovy.stageFit.state, "right");
  assert.equal(rakovy.stageFit.expected, "взято в работу");
  assert.equal(rakovy.dialog.clientTone, "спокойный");
  assert.equal(rakovy.dialog.replies, "отвечает в пределах трёх дней");
  assert.equal(rakovy.dialog.managerTone, "спокойный");
  assert.equal(rakovy.dialog.about.includes("оформление"), true);
  assert.equal(rakovy.dialog.about.includes("макет"), true);
  assert.equal(rakovy.dialog.unanswered.toLowerCase().includes("жду макет"), true);
  assert.equal(rakovy.offer, "/kp-rakovy-dvor.html");
  assert.equal(result.deals.find((deal) => deal.title === "Раковый двор на набережной").offer, undefined);
  assert.equal(rakovy.checklist.find((item) => item.title === "Шапка профиля").state, "closed");
  assert.equal(rakovy.checklist.find((item) => item.title === "Геолокация и вход").state, "open");
  assert.equal(rakovy.checklist.some((item) => item.title === "Настроить профиль по сделке"), false);
  const shore = result.deals.find((deal) => deal.title === "Раковый двор на набережной");
  assert.equal(shore.funnel, "oformlenie");
  assert.equal(shore.pipeline, "Продажи");
  assert.equal(shore.pilot, true);
  assert.ok(calls.some((call) => {
    if (!String(call.url).endsWith("/crm.deal.list.json")) return false;
    return JSON.parse(call.options.body).filter["%TITLE"] === "Раковой";
  }));
  const ivanova = result.deals.find((deal) => deal.title === "ИП Иванова Анна");
  assert.equal(ivanova.link, "https://example.invalid/card");
  assert.equal(ivanova.pilot, undefined);
  assert.equal(ivanova.late, undefined);
  assert.equal(ivanova.checklist, undefined);
  assert.equal(ivanova.funnel, "oformlenie");
  assert.equal(ivanova.stage, "В работе");
  assert.equal(ivanova.checks.find((check) => check.code === "AM-D0-1").status, "Нет данных");
  assert.equal(result.deals.find((deal) => deal.title === "Кафе Волна").funnel, "podderzhka");
  assert.equal(result.deals.find((deal) => deal.title === "Кафе Волна").link, "Нет данных");
  const packed = JSON.stringify(result);
  assert.equal(packed.includes("placeholder"), false);
  assert.equal(packed.includes("C2:WON"), false);
  assert.equal(packed.includes("Договор"), false);
  assert.equal(packed.includes("Магазин электрики"), false);
  assert.equal(JSON.stringify(ostrovok).includes("Не сделано"), false);
  const place = rakovy.report.find((item) => item.proof && item.proof.includes("адрес"));
  assert.equal(place.stuck, "Нет");
  assert.equal(place.status, "Сделано");
  assert.equal(place.proof.includes("чек-лист"), false);
  const goods = rakovy.report.find((item) => item.title === "Товары в витрине");
  assert.equal(goods.stuck, "Товары в витрине");
  assert.equal(goods.missing, "На Картах нет товаров в витрине.");
  assert.equal(goods.status, "Не сделано");
  assert.equal(rakovy.report.find((item) => item.title === "QR-код").status, "Не сделано");
  assert.equal(rakovy.report.length, 11);
  assert.equal(packed.includes("заполните бриф"), false);
  assert.equal(packed.includes("Пожалуйста, жду макет"), true);
  assert.equal(packed.includes("Смирнова"), true);
});

test("dialog labels do not repeat the chat", () => {
  const read = readDialog(
    [
      { author_id: "8", text: "Здравствуйте", date: "2026-11-10T11:00:00+03:00" },
      { author_id: "15", text: "Спасибо", date: "2026-11-01T11:00:00+03:00" },
      { author_id: "15", text: "Спасибо", date: "2026-11-12T11:00:00+03:00" },
    ],
    new Set(["8"]),
  );
  assert.equal(read.clientTone, "спокойный");
  assert.equal(read.managerTone, "спокойный");
  assert.equal(read.replies, "ответы реже раза в неделю");
  assert.equal(JSON.stringify(read).includes("Спасибо"), false);
  const wazzup = readDialog(
    [
      { senderid: "0", text: "Когда будет макет", date: "2026-11-10T15:00:00+03:00" },
      { senderid: "0", text: "Жду", date: "2026-11-11T12:00:00+03:00" },
    ],
    new Set(["8"]),
  );
  assert.equal(wazzup.clientTone, "нейтральный");
  assert.equal(wazzup.replies, "отвечает в пределах трёх дней");
  assert.equal(wazzup.managerTone, "Нет данных");
});

test("a present point, photos and goods stay done", () => {
  const rows = controlBrief({
    maps: {
      opened: true,
      address: true,
      addressText: "Ростов-на-Дону, улица Александра Бондарева, 6",
      coords: true,
      entrance: false,
      name: true,
      profileName: "Раковый двор",
      logo: true,
      photos: 23,
      photoSections: false,
      images: 2,
      externalLinks: 1,
      goods: 91,
      posts: 5,
      stories: 1,
      reviews: 7,
      reviewAnswers: 3,
      sampledReviews: 3,
      alts: 10,
      photoAlts: ["Рыба и морепродукты Раковый двор, фото"],
    },
    created: "2026-10-01",
    now: new Date("2026-11-17T12:00:00+03:00"),
    heard: {},
    deal: { link: "https://yandex.ru/maps/-/CXSKA-pK" },
  });
  const status = (title) => rows.find((item) => item.title === title).status;
  assert.equal(status("Геолокация и вход"), "Сделано");
  assert.equal(status("Фото по разделам"), "Сделано");
  assert.equal(status("Товары в витрине"), "Сделано");
  assert.equal(status("SEO фото"), "Не сделано");
  assert.equal(rows.find((item) => item.title === "Геолокация и вход").proof.includes("точка"), true);
});

test("a Maps profile page yields the facts it actually contains", () => {
  const html = `<title>Раковый двор, кафе — Яндекс Карты</title>
    <script type="application/json" class="state-view">${JSON.stringify({
      stack: [{ results: { items: [{
        title: "Раковый двор",
        fullAddress: "Санкт-Петербург, Набережная, 4",
        coordinates: [30.3, 59.9],
        entrances: [{ coordinates: [30.3, 59.9] }],
        photos: { count: 12, items: [{ alt: "Фасад Раковый двор" }] },
        businessImages: { logo: { urlTemplate: "https://avatars.mds.yandex.net/logo/%s" } },
        urls: ["https://example.invalid/site"],
        hasStories: false,
        ratingData: { reviewCount: 2 },
        reviewResults: { reviews: [{ text: "ок" }, { text: "ок", businessComment: { text: "спасибо" } }] },
      }] } }],
    })}</script>
    <a class="tabs-select-view__title" aria-label="Фото, 12"></a>
    <a class="tabs-select-view__title" aria-label="Отзывы, 2"></a>`;
  const profile = parseMapsProfile(html);
  assert.equal(profile.opened, true);
  assert.equal(profile.profileName, "Раковый двор");
  assert.equal(profile.addressText, "Санкт-Петербург, Набережная, 4");
  assert.equal(profile.photos, 12);
  assert.equal(profile.logo, true);
  assert.equal(profile.externalLinks, 1);
  assert.equal(profile.stories, 0);
  assert.equal(profile.goods, 0);
  assert.equal(profile.reviews, 2);
  assert.equal(profile.reviewAnswers, 1);
  const nested = readDialog(
    [{ author_id: "0", params: { MESSAGE: "Спасибо, добрый день" }, date: "2026-11-10T12:00:00+03:00" }],
    new Set(["8"]),
  );
  assert.equal(nested.clientTone, "спокойный");
});

test("a failed read does not surface the endpoint", async () => {
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder/" },
    async () => {
      throw new Error("network down");
    },
  );

  assert.deepEqual(result, { connected: false, unavailable: true, deals: [] });
  assert.equal(JSON.stringify(result).includes("http"), false);
});
