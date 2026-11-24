import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doneLabel, overdueItems } from "../src/content.js";
import { acceptanceStatus, clearSentMemory, controlBrief, controlMessages, deliverControlChat, latePublications, loadOformlenieDeals, loadReviewClients, monthPlan, organizationName, parseMapsProfile, parseReviewClients, pipelineSection, postReadyCards, readDialog, readyReviewLine, resetControlChatState, reviewFindings, webhookConfigured } from "./bitrix.js";
import { resetSendFlight, sendControlOnce } from "./send-once.js";

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
  assert.equal(rakovy.link, "https://yandex.ru/maps/-/CXSSVWPY");
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
  assert.equal(result.deals.find((deal) => deal.title === "Раковый двор на набережной"), undefined);
  assert.equal(rakovy.checklist.find((item) => item.title === "Шапка профиля").state, "closed");
  assert.equal(rakovy.checklist.find((item) => item.title === "Геолокация и вход").state, "open");
  assert.equal(rakovy.checklist.some((item) => item.title === "Настроить профиль по сделке"), false);
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
  for (const deal of result.deals.filter((item) => item.funnel === "oformlenie")) {
    assert.equal(Array.isArray(deal.report), true, deal.title);
    assert.equal(deal.report.length, 11, deal.title);
    assert.equal(deal.plan.weeks.length, 4, deal.title);
    assert.equal(deal.plan.weeks.map((week) => week.title).join("|"), "Неделя 1|Неделя 2|Неделя 3|Неделя 4");
  }
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
  assert.notEqual(rakovy.report.find((item) => item.title === "QR-код").status, "Не сделано");
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
    deal: { link: "https://yandex.ru/maps/-/CXSSVWPY" },
  });
  const status = (title) => rows.find((item) => item.title === title).status;
  assert.equal(status("Геолокация и вход"), "Сделано");
  assert.equal(status("Фото по разделам"), "Сделано");
  assert.equal(status("Товары в витрине"), "Сделано");
  assert.equal(status("SEO фото"), "Не сделано");
  assert.equal(rows.find((item) => item.title === "Геолокация и вход").proof.includes("точка"), true);
});

test("a goods tab and a news tab are not missing", () => {
  const html = `<script type="application/json" class="state-view">${JSON.stringify({
    stack: [{ results: { items: [{
      shortTitle: "Раковый двор",
      fullAddress: "Ростов-на-Дону, улица Александра Бондарева, 6",
      coordinates: [39.8, 47.2],
      photos: { count: 23, items: [{ alt: "Рыба, фото" }] },
    }] } }],
  })}</script>
  <a aria-label="Товары и услуги, "></a>
  <a aria-label="Новости, 5"></a>`;
  const profile = parseMapsProfile(html);
  const rows = controlBrief({
    maps: profile,
    created: "2026-10-01",
    now: new Date("2026-11-17T12:00:00+03:00"),
    heard: {},
    deal: { link: "https://yandex.ru/maps/-/CXSSVWPY" },
  });
  const status = (title) => rows.find((item) => item.title === title).status;
  assert.equal(status("Товары в витрине"), "Сделано");
  assert.equal(status("Новости"), "Сделано");
  assert.equal(rows.find((item) => item.title === "Новости").proof.includes("5"), true);
  const withChat = controlBrief({
    maps: profile,
    created: "2026-10-01",
    now: new Date("2026-11-17T12:00:00+03:00"),
    heard: { qr: true },
    deal: { link: "https://yandex.ru/maps/-/CXSSVWPY" },
  });
  assert.equal(withChat.find((item) => item.title === "QR-код").status, "Сделано");
  assert.equal(withChat.find((item) => item.title === "QR-код").proof.includes("Wazzup"), true);
});

test("the month plan names the step due in each of the four weeks", () => {
  const rows = controlBrief({
    maps: {
      opened: true,
      name: true,
      profileName: "Кафе",
      photos: 4,
      photoAlts: ["фасад"],
      goods: 3,
      goodsNames: ["Раки гиганты"],
      posts: 3,
      firstNews: { title: "Что выбрать к пенному?", doneOn: "5 ноября 2026" },
    },
    now: new Date("2026-11-24T12:00:00+03:00"),
    deal: { received: "2026-10-09T12:00:00+03:00" },
  });
  const plan = monthPlan({
    rows,
    anchor: "2026-10-09T12:00:00+03:00",
    anchorKind: "received",
    news: [
      { title: "Что выбрать к пенному?", doneOn: "5 ноября 2026", day: "2026-11-05" },
      { title: "Морепродукты", doneOn: "5 ноября 2026", day: "2026-11-05" },
      { title: "Раки — гастрономическая традиция, которая объединяет", doneOn: "5 ноября 2026", day: "2026-11-05" },
    ],
  });
  assert.equal(plan.weeks.length, 4);
  assert.equal(plan.weeks[0].due, "15.10.2026");
  assert.equal(plan.weeks[1].due, "22.10.2026");
  assert.equal(plan.weeks[2].due, "29.10.2026");
  assert.equal(plan.weeks[3].due, "07.11.2026");
  assert.equal(plan.anchorNote.includes("Информация получена 09.10.2026"), true);
  assert.equal(plan.weeks[0].steps.some((step) => step.title === "Шапка профиля"), true);
  assert.equal(plan.weeks[1].steps.some((step) => step.title === "Товары в витрине" && step.status === "Сделано"), true);
  const first = plan.weeks[1].steps.find((step) => step.title === "Первая новость");
  assert.equal(first.status, "Сделано");
  assert.equal(first.doneOn, "5 ноября 2026");
  assert.equal(first.missing, undefined);
  const second = plan.weeks[2].steps.find((step) => step.title === "Вторая новость");
  assert.equal(second.status, "Сделано");
  assert.equal(second.doneOn, "5 ноября 2026");
  assert.equal(plan.weeks[3].steps.find((step) => step.title === "Публикация").doneOn, "5 ноября 2026");
  assert.equal(plan.weeks[3].steps.find((step) => step.title === "Правки после проверки").status, "Нет данных");
  const late = latePublications({
    news: [{ title: "Что выбрать к пенному?", doneOn: "5 ноября 2026", day: "2026-11-05" }],
    anchor: "2026-10-09T12:00:00+03:00",
  });
  assert.equal(late.some((item) => item.place === "Первая новость" && item.late && item.change.includes("22.10.2026") && item.change.includes("5 ноября 2026")), true);
  assert.equal(late.some((item) => item.place === "Вторая новость" && item.change.includes("29.10.2026") && item.change.includes("5 ноября 2026")), true);
  assert.equal(late.some((item) => item.place === "Публикация"), false);
  const onTime = monthPlan({
    rows,
    anchor: "2026-10-09T12:00:00+03:00",
    anchorKind: "received",
    news: [{ title: "Осеннее меню", doneOn: "16 октября 2026", day: "2026-10-16" }],
  });
  assert.equal(onTime.weeks[1].steps.find((step) => step.title === "Первая новость").status, "Сделано");
  assert.equal(onTime.weeks[2].steps.find((step) => step.title === "Вторая новость").status, "Не сделано");
  assert.equal(latePublications({
    news: [{ title: "Осеннее меню", doneOn: "16 октября 2026", day: "2026-10-16" }],
    anchor: "2026-10-09T12:00:00+03:00",
  }).length, 0);
  const copied = controlBrief({
    maps: rows && {
      opened: true,
      name: true,
      profileName: "Раковый двор",
      photos: 23,
      goods: 91,
      posts: 5,
      photoAlts: ["фасад"],
    },
    now: new Date("2026-11-24T12:00:00+03:00"),
    deal: { title: "ИП Иванова Анна" },
  });
  assert.equal(copied.every((row) => row.status !== "Сделано"), true);
  const blank = monthPlan({ rows, anchor: "", anchorKind: "", news: [] });
  assert.equal(blank.weeks.every((week) => !week.due), true);
  assert.equal(blank.anchorNote, "Даты получения информации нет.");
});

test("a missing step is overdue only a month after the information arrived", () => {
  const maps = { opened: true, goods: 0, posts: 1, photos: 2, name: true, profileName: "Кафе", photoAlts: [] };
  const inside = controlBrief({
    maps,
    now: new Date("2026-11-24T12:00:00+03:00"),
    deal: { received: "2026-11-10T12:00:00+03:00" },
  });
  const early = inside.find((item) => item.title === "Товары в витрине");
  assert.equal(early.status, "Не сделано");
  assert.equal(early.overdue, false);
  assert.equal(early.due, undefined);
  const late = controlBrief({
    maps,
    now: new Date("2026-11-24T12:00:00+03:00"),
    deal: { received: "2026-10-01T12:00:00+03:00" },
  }).find((item) => item.title === "Товары в витрине");
  assert.equal(late.overdue, true);
  assert.equal(late.due, "30.10.2026");
  const unknown = controlBrief({
    maps,
    now: new Date("2026-11-24T12:00:00+03:00"),
    deal: {},
  }).find((item) => item.title === "Товары в витрине");
  assert.equal(unknown.overdue, false);
  assert.equal(unknown.due, undefined);
  assert.equal(overdueItems(inside).some((item) => item.title === "Товары в витрине"), false);
  assert.equal(overdueItems([late]).length, 1);
  assert.equal(doneLabel({ doneOn: "5 ноября 2026" }), "5 ноября 2026 · Выполнено");
  assert.equal(doneLabel({}), "Выполнено");
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

test("a failed category list still returns both funnels", async () => {
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder" },
    async (url, options) => {
      const method = String(url).split("/").pop();
      const type = options?.headers?.["Content-Type"] || "";
      const body = type.includes("json") ? JSON.parse(options.body) : {};
      if (method === "crm.dealcategory.list.json" || method === "crm.dealcategory.default.get.json") {
        return { ok: false, async json() { return { error: "QUERY_LIMIT_EXCEEDED", error_description: "See https://example.invalid/rest/1/placeholder" }; } };
      }
      if (method === "crm.dealcategory.get.json") {
        const id = String(body.id);
        const name = id === "7" ? "Карты поддержка" : "Оформление ЯКарты/Аналитика";
        return { ok: true, async json() { return { result: { ID: id, NAME: name } }; } };
      }
      if (method === "crm.deal.list.json") {
        return {
          ok: true,
          async json() {
            return {
              result: [
                { ID: "1", TITLE: "Кафе Север", CATEGORY_ID: "2", STAGE_ID: "C2:NEW", STAGE_SEMANTIC_ID: "P", ASSIGNED_BY_ID: "3", DATE_CREATE: "2026-11-01T10:00:00+03:00" },
                { ID: "2", TITLE: "Бар Юг", CATEGORY_ID: "7", STAGE_ID: "C7:NEW", STAGE_SEMANTIC_ID: "P", ASSIGNED_BY_ID: "3", DATE_CREATE: "2026-11-02T10:00:00+03:00" },
              ],
            };
          },
        };
      }
      if (method === "crm.status.list.json") {
        return { ok: true, async json() { return { result: [
          { ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:NEW", NAME: "Новая" },
          { ENTITY_ID: "DEAL_STAGE_7", STATUS_ID: "C7:NEW", NAME: "Новая" },
        ] }; } };
      }
      if (method === "user.get.json") {
        return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }] }; } };
      }
      return { ok: true, async json() { return { result: [] }; } };
    },
  );
  assert.equal(result.connected, true);
  assert.equal(result.deals.some((deal) => deal.funnel === "oformlenie" && deal.title === "Кафе Север"), true);
  assert.equal(result.deals.some((deal) => deal.funnel === "podderzhka" && deal.title === "Бар Юг"), true);
  assert.equal(JSON.stringify(result).includes("http"), false);
});

test("a later Bitrix failure still returns the named deal", async () => {
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder" },
    async (url) => {
      const method = String(url).split("/").pop();
      if (method === "crm.dealcategory.list.json") {
        return { ok: true, async json() { return { result: [{ ID: "2", NAME: "Оформление ЯКарты/Аналитика" }] }; } };
      }
      if (method === "crm.deal.list.json") {
        return {
          ok: true,
          async json() {
            return {
              result: [{
                ID: "31",
                TITLE: "Автосделка Раковой Двор Оформление+3Д",
                CATEGORY_ID: "2",
                STAGE_ID: "C2:PREPARATION",
                STAGE_SEMANTIC_ID: "P",
                ASSIGNED_BY_ID: "8",
                DATE_CREATE: "2026-11-10T10:00:00+03:00",
              }],
            };
          },
        };
      }
      if (String(url).startsWith("https://yandex.ru/maps/")) {
        throw new Error("maps down");
      }
      throw new Error("later call down");
    },
  );
  assert.equal(result.connected, true);
  assert.equal(result.unavailable, undefined);
  const deal = result.deals.find((item) => item.title === "Автосделка Раковой Двор Оформление+3Д");
  assert.equal(deal.link, "https://yandex.ru/maps/-/CXSSVWPY");
  assert.equal(JSON.stringify(result).includes("example.invalid"), false);
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

test("the live storefront and news stay done and the review names the remaining places", () => {
  const html = `<script type="application/json" class="state-view">${JSON.stringify({
    stack: [{ response: { items: [{
      shortTitle: "Раковый двор",
      fullAddress: "Ростов-на-Дону, улица Александра Бондарева, 6",
      coordinates: [39.804647, 47.247066],
      entrances: [],
      photos: { count: 23, items: [{ alt: "Рыба и морепродукты Раковый двор, Ростов-на-Дону, фото" }] },
      urls: ["https://rakovyj-dvor-ulitsa-aleksandra-bondareva.clients.site/"],
      hasStories: true,
      ratingData: { reviewCount: 10 },
      advert: { products: [
        { title: "Раки гиганты", price: { text: "1 р.", value: 1, currency: "RUB" } },
        { title: "Раки крупные", price: { text: "1 р.", value: 1, currency: "RUB" } },
        { title: "Раки средне-крупные", price: { text: "1 р.", value: 1, currency: "RUB" } },
      ] },
      eventsPreviews: {
        count: 5,
        items: [
          { publicationTime: 1793874674218, text: "Что выбрать к пенному? Секреты удачных сочетаний напитков и закусок  Хорошо подобранная закуска" },
          { publicationTime: 1793874630612, text: "Морепродукты: как превратить обычный ужин в гастрономический вечер  Для маленького праздника" },
          { publicationTime: 1793874600000, text: "Раки — гастрономическая традиция, которая объединяет  Есть блюда, которые мы выбираем не только ради вкуса." },
        ],
      },
      reviewResults: { reviews: [
        { businessComment: { text: "Будем рады снова видеть вас в «Раковом дворе»." } },
        { businessComment: { text: "Благодарим за ваш отзыв" } },
      ] },
    }] } }],
  })}</script>Посмотреть все товары и услуги`;
  const profile = parseMapsProfile(html);
  const rows = controlBrief({
    maps: profile,
    created: "2026-10-09T10:00:00+03:00",
    now: new Date("2026-11-23T12:00:00+03:00"),
    heard: {},
    deal: { assignee: "Лиана", link: "https://yandex.ru/maps/-/CXSSVWPY", fileSeo: true },
  });
  const goods = rows.find((item) => item.title === "Товары в витрине");
  const news = rows.find((item) => item.title === "Новости");
  assert.equal(profile.addressText, "Ростов-на-Дону, улица Александра Бондарева, 6");
  assert.equal(goods.status, "Сделано");
  assert.equal(news.status, "Сделано");
  assert.equal(goods.proof.includes("Раки гиганты"), true);
  assert.equal(goods.proof.includes("Раки крупные"), true);
  assert.equal(goods.proof.includes("Раки средне-крупные"), true);
  assert.equal(goods.proof.includes("1 ₽"), true);
  assert.equal(goods.proof.includes("Посмотреть все товары и услуги"), true);
  assert.equal(news.proof.includes("5"), true);
  assert.equal(news.proof.includes("5 ноября"), true);
  assert.equal(news.proof.includes("Что выбрать к пенному?"), true);
  assert.equal(news.proof.includes("Морепродукты: как превратить обычный ужин в гастрономический вечер"), true);
  assert.equal(news.firstNews, "Раки — гастрономическая традиция, которая объединяет");
  assert.equal(news.doneOn, "5 ноября 2026");
  assert.equal(news.overdue, undefined);
  assert.equal(rows.some((item) => item.status === "Не сделано" && /нет товаров|нет новостей/.test(item.missing || "")), false);
  const review = reviewFindings(profile, { created: "2026-10-09T10:00:00+03:00", now: new Date("2026-11-23T12:00:00+03:00") });
  assert.equal(JSON.stringify(review).includes("Нет данных"), false);
  assert.equal(review.some((item) => item.place.startsWith("Новость") && item.wrong.endsWith("объединяет") && item.change.includes("гостей за столом")), true);
  assert.equal(review.some((item) => item.place.startsWith("Видимая подпись") && item.wrong.includes("фото") && item.change.includes("«Раковый двор»") && item.change.includes("что снято")), true);
  assert.equal(review.some((item) => item.wrong === "1 ₽"), false);
  assert.equal(rows.find((item) => item.title === "SEO фото").status, "Сделано");
  assert.equal(rows.find((item) => item.title === "SEO фото").proof.includes("Lightroom"), true);
  assert.equal(JSON.stringify(rows).includes("не SEO"), false);
  assert.equal(JSON.stringify(review).includes("Rakoviy"), false);
  assert.equal(JSON.stringify(review).includes("свой сайт"), false);
  assert.equal(JSON.stringify(review).includes("Благодарим"), false);
  const lines = controlMessages({
    title: "Автосделка Раковой Двор Оформление+3Д",
    created: "2026-10-09T10:00:00+03:00",
    report: rows,
    review,
  }, new Date("2026-11-23T12:00:00+03:00"));
  assert.equal(lines[0].startsWith("Автосделка Раковой Двор Оформление+3Д. Шаг:"), true);
  assert.equal(lines.some((line) => /нет товаров|нет новостей/.test(line)), false);
  assert.equal(lines.some((line) => /SEO фото|не SEO/.test(line)), false);
  assert.equal(lines.some((line) => line.includes("которая объединяет") && line.includes("Срок:")), true);
  assert.equal(lines.some((line) => line.includes("Видимая подпись")), false);
  assert.equal(lines.some((line) => /Rakoviy|свой сайт|Благодарим/.test(line)), false);
});

test("a control chat is only with Maria and names the missing method", async () => {
  resetControlChatState();
  const calls = [];
  const missing = await deliverControlChat(
    async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
      const method = String(url).split("/").pop();
      if (method === "user.get.json") {
        return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }, { ID: "4", NAME: "Анна", LAST_NAME: "Смирнова" }] }; } };
      }
      if (method === "im.chat.add.json" || method === "crm.timeline.comment.add.json") {
        return { ok: true, async json() { return { error: "ERROR_METHOD_NOT_FOUND" }; } };
      }
      return { ok: true, async json() { return { result: 1 }; } };
    },
    "https://example.invalid/rest/1/placeholder/",
    [{
      id: "31",
      title: "Автосделка Раковой Двор Оформление+3Д",
      offer: true,
      created: "2026-10-09T10:00:00+03:00",
      report: [{ title: "Витрина", status: "Не сделано", missing: "Цена стоит 1 ₽, описания нет.", due: "07.11.2026" }],
      review: [],
    }],
    new Date("2026-11-23T12:00:00+03:00"),
  );
  assert.equal(missing.missing, "im.chat.add, crm.timeline.comment.add");
  assert.equal(missing.posted, 0);
  assert.equal(JSON.stringify(missing).includes("placeholder"), false);
  assert.equal(calls.some((call) => call.url.endsWith("/im.message.add.json")), false);
  const users = calls.find((call) => call.url.endsWith("/im.chat.add.json")).body.USERS;
  assert.deepEqual(users, [3]);

  resetControlChatState();
  const sent = [];
  const comments = [];
  const chats = [];
  const posted = await deliverControlChat(
    async (url, options) => {
      const method = String(url).split("/").pop();
      const body = JSON.parse(options.body || "{}");
      if (method === "user.get.json") {
        return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }] }; } };
      }
      if (method === "im.chat.add.json") {
        chats.push(body);
        return { ok: true, async json() { return { result: 15 }; } };
      }
      if (method === "im.message.add.json") sent.push(body);
      if (method === "crm.timeline.comment.add.json") comments.push(body);
      return { ok: true, async json() { return { result: 100 }; } };
    },
    "https://example.invalid/rest/1/placeholder/",
    [
      { id: "7", title: "Другая сделка", offer: false, report: [{ title: "Новости", status: "Не сделано", missing: "На Картах нет новостей.", due: "29.10.2026" }], review: [] },
      {
        id: "31",
        title: "Автосделка Раковой Двор Оформление+3Д",
        offer: true,
        created: "2026-10-09T10:00:00+03:00",
        report: [
          { title: "SEO фото", status: "Сделано", missing: "Нет", proof: "Ключевые слова записаны в файлы фото в Lightroom, не в видимую подпись на Картах." },
          { title: "Витрина", status: "Не сделано", missing: "Цена стоит 1 ₽, описания нет.", due: "07.11.2026" },
        ],
        review: [],
      },
    ],
    new Date("2026-11-23T12:00:00+03:00"),
  );
  assert.equal(posted.missing, "");
  assert.equal(posted.posted, 2);
  assert.equal(sent[0].DIALOG_ID, "chat15");
  assert.equal(sent[0].MESSAGE.startsWith("Автосделка Раковой Двор Оформление+3Д. Шаг: Витрина."), true);
  assert.equal(sent[0].MESSAGE.includes("не SEO"), false);
  assert.equal(sent[1].MESSAGE.startsWith("Другая сделка. Шаг: Новости."), true);
  assert.equal(comments[0].fields.ENTITY_TYPE, "deal");
  assert.equal(comments[0].fields.ENTITY_ID, 31);
  assert.equal(comments[0].fields.COMMENT, sent[0].MESSAGE);
  assert.equal(comments.some((item) => String(item.fields.COMMENT).includes("не SEO")), false);
  assert.equal(chats[0].TITLE, "Система контроля");
  assert.deepEqual(chats[0].USERS, [3]);
  assert.equal(chats[0].ENTITY_TYPE, undefined);
});

test("im.chat.add reports the Bitrix error text", async () => {
  resetControlChatState();
  const result = await deliverControlChat(
    async (url) => {
      const method = String(url).split("/").pop();
      if (method === "user.get.json") {
        return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }] }; } };
      }
      if (method === "im.chat.add.json") {
        return { ok: true, async json() { return { error: "ACCESS_DENIED", error_description: "Доступ запрещён https://portal.bitrix24.ru/rest/1/secret" }; } };
      }
      return { ok: true, async json() { return { result: [] }; } };
    },
    "https://example.invalid/rest/1/placeholder/",
    [{
      id: "31",
      title: "Автосделка Раковой Двор Оформление+3Д",
      offer: true,
      report: [{ title: "Витрина", status: "Не сделано", missing: "Цена стоит 1 ₽, описания нет.", due: "07.11.2026" }],
      review: [],
    }],
    new Date("2026-11-23T12:00:00+03:00"),
  );
  assert.equal(result.missing.includes("im.chat.add"), true);
  assert.equal(result.error.includes("Доступ запрещён"), true);
  assert.equal(result.error.includes("http"), false);
  assert.equal(result.error.includes("secret"), false);
});

test("Rakov SEO stays done when the Maps page did not open", () => {
  const rows = controlBrief({
    maps: null,
    created: "2026-10-09T10:00:00+03:00",
    now: new Date("2026-11-24T07:50:00Z"),
    deal: { fileSeo: true },
  });
  const seo = rows.find((item) => item.title === "SEO фото");
  assert.equal(seo.status, "Сделано");
  assert.equal(seo.proof.includes("Lightroom"), true);
  assert.equal(JSON.stringify(rows).includes("не SEO"), false);
});

test("SEO фото and the visible caption stay off the Bitrix message", () => {
  const lines = controlMessages({
    title: "Автосделка Раковой Двор Оформление+3Д",
    created: "2026-10-09T10:00:00+03:00",
    report: [{ title: "SEO фото", status: "Не сделано", missing: "Подписи фото на Картах шаблонные, это не SEO." }],
    review: [{ place: "Видимая подпись, 23 кадров", wrong: "Рыба и морепродукты Раковый двор, Ростов-на-Дону, фото", change: "Напишите, что снято на этом кадре.", regulation: true }],
  }, new Date("2026-11-23T12:00:00+03:00"));
  assert.deepEqual(lines, []);
});

test("a later visit posts a stuck step once, and again only when that step changes", async () => {
  resetControlChatState();
  const rakov = {
    id: "31",
    title: "Автосделка Раковой Двор Оформление+3Д",
    offer: true,
    created: "2026-10-09T10:00:00+03:00",
    report: [{ title: "Витрина", status: "Не сделано", missing: "Цена стоит 1 ₽, описания нет.", due: "07.11.2026" }],
    review: [],
  };
  const line = controlMessages(rakov, new Date("2026-11-23T12:00:00+03:00"))[0];
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(options.body);
    calls.push(method);
    if (method === "user.get.json") return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }] }; } };
    if (method === "im.chat.add.json") return { ok: true, async json() { return { result: 15 }; } };
    if (method === "im.dialog.messages.get.json") return { ok: true, async json() { return { result: { messages: [{ text: line }] } }; } };
    if (method === "crm.timeline.comment.list.json") return { ok: true, async json() { return { result: [{ COMMENT: line }] }; } };
    if (method === "im.message.add.json" || method === "crm.timeline.comment.add.json") {
      return { ok: true, async json() { return { result: body }; } };
    }
    return { ok: true, async json() { return { result: [] }; } };
  };
  const base = "https://example.invalid/rest/1/placeholder/";
  const now = new Date("2026-11-23T12:00:00+03:00");
  const first = await deliverControlChat(fetchImpl, base, [rakov], now);
  assert.equal(first.posted, 0);
  assert.equal(calls.includes("im.message.add.json"), false);
  assert.equal(calls.includes("crm.timeline.comment.add.json"), false);

  resetControlChatState();
  const sent = [];
  const fresh = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(options.body);
    if (method === "im.message.add.json" || method === "crm.timeline.comment.add.json") sent.push(method);
    if (method === "user.get.json") return { ok: true, async json() { return { result: [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }] }; } };
    if (method === "im.chat.add.json") return { ok: true, async json() { return { result: 15 }; } };
    if (method === "im.dialog.messages.get.json" || method === "crm.timeline.comment.list.json") {
      return { ok: true, async json() { return { result: [] }; } };
    }
    return { ok: true, async json() { return { result: body }; } };
  };
  const opened = await deliverControlChat(fresh, base, [rakov], now);
  const again = await deliverControlChat(fresh, base, [rakov], now);
  const changed = await deliverControlChat(fresh, base, [{
    ...rakov,
    report: [{ title: "Новости", status: "Не сделано", missing: "На Картах нет новостей.", due: "29.10.2026" }],
  }], now);
  assert.equal(opened.posted, 1);
  assert.equal(again.posted, 0);
  assert.equal(changed.posted, 1);
  assert.equal(sent.filter((method) => method === "im.message.add.json").length, 2);
  assert.equal(sent.filter((method) => method === "crm.timeline.comment.add.json").length, 2);
});

test("the deal list and the Maps page are read once per hour", async () => {
  resetControlChatState();
  let bitrix = 0;
  let maps = 0;
  const writes = [];
  const times = [];
  const fetchImpl = async (url) => {
    const address = String(url);
    times.push(Date.now());
    if (address.includes("im.message.add") || address.includes("crm.timeline.comment.add") || address.includes("im.chat.add")) {
      writes.push(address);
    }
    if (address.includes("yandex.ru/maps")) {
      maps += 1;
      return { ok: true, url: address, async text() { return "<title>Раковый двор</title>"; } };
    }
    bitrix += 1;
    const method = address.split("/").pop();
    const rows = {
      "crm.dealcategory.list.json": [{ ID: "2", NAME: "Оформление ЯКарты/Аналитика" }],
      "crm.deal.list.json": [{ ID: "31", TITLE: "Автосделка Раковой Двор Оформление+3Д", CATEGORY_ID: "2", STAGE_ID: "C2:NEW", ASSIGNED_BY_ID: "1", DATE_CREATE: "2026-10-09T10:00:00+03:00" }],
      "crm.status.list.json": [{ ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:NEW", NAME: "Новая" }],
      "user.get.json": [{ ID: "3", NAME: "Мария", LAST_NAME: "Брага" }],
      "crm.deal.get.json": { ID: "31", TITLE: "Автосделка Раковой Двор Оформление+3Д", CATEGORY_ID: "2" },
    };
    return { ok: true, async json() { return { result: rows[method] ?? [] }; } };
  };
  const env = { BITRIX_WEBHOOK_URL: "https://portal.bitrix24.ru/rest/1/token/" };
  const now = new Date("2026-11-23T12:00:00+03:00");
  const first = await loadOformlenieDeals(env, fetchImpl, now);
  const after = { bitrix, maps };
  const second = await loadOformlenieDeals(env, fetchImpl, now);
  assert.equal(first.connected, true);
  assert.equal(second.connected, true);
  assert.equal(bitrix, after.bitrix);
  assert.equal(maps, after.maps);
  assert.equal(after.maps, 1);
  assert.deepEqual(writes, []);
  assert.equal(times.length >= 2 && times[1] - times[0] >= 200, true);
  resetControlChatState();
});

test("the first live stall opens the chat once and a restart does not send it again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-sent-"));
  process.env.CONTROL_SENT_FILE = join(dir, "sent.json");
  resetControlChatState();
  resetSendFlight();
  writeFileSync(process.env.CONTROL_SENT_FILE, JSON.stringify({ hello: true, existingHello: true, error: "старая попытка", delivered: true, chatId: "15" }));
  const writes = [];
  const fetchImpl = async (url, options) => {
    const address = String(url);
    const method = address.split("/").pop();
    const body = options?.body ? JSON.parse(options.body) : {};
    if (method === "im.chat.add.json" || method === "im.message.add.json" || method === "crm.timeline.comment.add.json" || method === "im.chat.user.add.json") writes.push({ method, body });
    if (method === "im.chat.get.json") {
      const detail = String(body.CHAT_ID) === "22"
        ? { id: 22, title: "Система контроля", owner: 8, user_counter: 1, date_create: "2026-11-24T12:02:00+03:00", entity_type: "" }
        : { id: 15, title: "Система контроля", owner: 3, user_counter: 2, date_create: "2026-11-20T10:00:00+03:00", entity_type: "" };
      return { ok: true, async json() { return { result: detail }; } };
    }
    const rows = {
      "user.current.json": { ID: "8", NAME: "Мария", LAST_NAME: "Литвиненко" },
      "im.recent.get.json": [
        { id: "chat15", chat_id: 15, title: "Система контроля", type: "chat" },
        { id: "chat22", chat_id: 22, title: "Система контроля", type: "chat" },
      ],
    };
    return { ok: true, async json() { return { result: rows[method] ?? [] }; } };
  };
  const env = { BITRIX_WEBHOOK_URL: "https://portal.bitrix24.ru/rest/1/token/" };
  const now = new Date("2026-11-23T12:00:00+03:00");
  const first = await sendControlOnce(env, fetchImpl, now);
  const after = writes.length;
  clearSentMemory();
  resetSendFlight();
  const second = await sendControlOnce(env, fetchImpl, now);
  assert.equal(first.created, false);
  assert.equal(first.posted, 1);
  assert.equal(first.error, "");
  assert.equal(first.bitrix.method, "im.message.add");
  assert.equal(first.bitrix.ok, true);
  assert.equal(first.bitrix.chatId, "22");
  assert.equal(JSON.stringify(first.bitrix).includes("http"), false);
  assert.equal(writes.some((item) => item.method === "im.chat.add.json" || item.method === "im.chat.user.add.json"), false);
  assert.equal(writes.filter((item) => item.method === "im.message.add.json").length, 1);
  assert.equal(writes.find((item) => item.method === "im.message.add.json").body.MESSAGE, "Привет");
  assert.equal(writes.find((item) => item.method === "im.message.add.json").body.DIALOG_ID, "chat22");
  assert.equal(writes.filter((item) => item.method === "crm.timeline.comment.add.json").length, 0);
  assert.equal(second.posted, 0);
  assert.equal(writes.length, after);
  delete process.env.CONTROL_SENT_FILE;
  resetControlChatState();
  resetSendFlight();
});

test("a finished checklist is posted once into the existing chat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-ready-"));
  process.env.CONTROL_SENT_FILE = join(dir, "sent.json");
  resetControlChatState();
  const writes = [];
  const messages = [];
  const fetchImpl = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = options?.body ? JSON.parse(options.body) : {};
    if (method === "im.chat.add.json" || method === "im.message.add.json") writes.push({ method, body });
    if (method === "im.message.add.json") messages.push({ text: body.MESSAGE });
    if (method === "im.chat.get.json") {
      return { ok: true, async json() { return { result: { id: 22, title: "Система контроля", owner: 8, user_counter: 1, date_create: "2026-11-24T12:02:00+03:00", entity_type: "" } }; } };
    }
    const rows = {
      "user.current.json": { ID: "8", NAME: "Мария", LAST_NAME: "Литвиненко" },
      "im.recent.get.json": [{ id: "chat22", chat_id: 22, title: "Система контроля", type: "chat" }],
      "im.dialog.messages.get.json": { messages: messages.slice() },
    };
    return { ok: true, async json() { return { result: rows[method] ?? [] }; } };
  };
  const done = {
    id: "31",
    title: "Раковый двор",
    link: "https://yandex.ru/maps/-/CXSSVWPY",
    report: [
      { title: "Новости", status: "Сделано" },
      { title: "SEO фото", status: "Сделано" },
    ],
  };
  const open = { ...done, id: "32", report: [{ title: "Новости", status: "Не сделано" }] };
  assert.equal(readyReviewLine(open), "");
  const line = readyReviewLine(done);
  assert.equal(line.includes("Раковый двор"), true);
  assert.equal(line.includes("https://yandex.ru/maps/-/CXSSVWPY"), true);
  assert.equal(line.includes("Карточка готова к проверке."), true);
  const base = "https://portal.example/rest/1/token/";
  const first = await postReadyCards(fetchImpl, base, [done, open]);
  clearSentMemory();
  const second = await postReadyCards(fetchImpl, base, [done, open]);
  assert.equal(first.posted, 1);
  assert.equal(second.posted, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "im.message.add.json");
  assert.equal(writes[0].body.DIALOG_ID, "chat22");
  assert.equal(writes[0].body.MESSAGE, line);
  delete process.env.CONTROL_SENT_FILE;
  resetControlChatState();
});

test("the ready message uses the chat search when recent dialogs are empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-search-"));
  process.env.CONTROL_SENT_FILE = join(dir, "sent.json");
  resetControlChatState();
  const writes = [];
  const fetchImpl = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = options?.body ? JSON.parse(options.body) : {};
    if (method === "im.message.add.json" || method === "im.chat.add.json") writes.push({ method, body });
    if (method === "im.chat.get.json") {
      return { ok: true, async json() { return { result: { id: 22, name: "Система контроля", owner: 8, user_counter: 1, date_create: "24.11.2026 12:02:00", entity_type: "" } }; } };
    }
    const rows = {
      "user.current.json": { ID: "8", NAME: "Мария", LAST_NAME: "Литвиненко" },
      "im.recent.get.json": [],
      "im.search.chat.list.json": [{ id: 22, title: "Система контроля", owner: 8 }],
      "im.dialog.messages.get.json": { messages: [] },
    };
    return { ok: true, async json() { return { result: rows[method] ?? [] }; } };
  };
  const done = {
    id: "31",
    title: "Раковый двор",
    link: "https://yandex.ru/maps/-/CXSSVWPY",
    report: [{ title: "Новости", status: "Сделано" }],
  };
  const sent = await postReadyCards(fetchImpl, "https://portal.example/rest/1/token/", [done]);
  assert.equal(sent.posted, 1);
  assert.equal(sent.bitrix.method, "im.message.add");
  assert.equal(sent.bitrix.ok, true);
  assert.equal(sent.bitrix.chatId, "22");
  assert.equal(sent.bitrix.error, "");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.DIALOG_ID, "chat22");
  assert.equal(writes[0].body.MESSAGE.includes("Карточка готова к проверке."), true);
  assert.equal(JSON.stringify(sent.bitrix).includes("http"), false);
  delete process.env.CONTROL_SENT_FILE;
  resetControlChatState();
});

test("a closed chat is joined once and the review message is posted there", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-join-"));
  process.env.CONTROL_SENT_FILE = join(dir, "sent.json");
  resetControlChatState();
  const writes = [];
  let blocked = true;
  const fetchImpl = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = options?.body ? JSON.parse(options.body) : {};
    if (method === "im.chat.add.json" || method === "im.chat.user.add.json" || method === "im.message.add.json") writes.push({ method, body });
    if (method === "im.message.add.json" && blocked) {
      blocked = false;
      return { ok: false, async json() { return { error: "ACCESS_DENIED", error_description: "Доступ запрещён https://portal.example/rest/1/secret" }; } };
    }
    if (method === "im.chat.get.json") {
      return { ok: true, async json() { return { result: { id: 22, title: "Система контроля", owner: 8, user_counter: 1, date_create: "2026-11-24T12:02:00+03:00", entity_type: "" } }; } };
    }
    const rows = {
      "user.current.json": { ID: "8", NAME: "Мария", LAST_NAME: "Литвиненко" },
      "im.recent.get.json": [{ id: "chat22", chat_id: 22, title: "Система контроля", type: "chat" }],
      "im.dialog.messages.get.json": { messages: [] },
    };
    return { ok: true, async json() { return { result: rows[method] ?? body }; } };
  };
  const done = {
    id: "31",
    title: "Раковый двор",
    link: "https://yandex.ru/maps/-/CXSSVWPY",
    report: [{ title: "Новости", status: "Сделано" }],
  };
  const sent = await postReadyCards(fetchImpl, "https://portal.example/rest/1/token/", [done]);
  assert.equal(sent.bitrix.method, "im.message.add");
  assert.equal(sent.bitrix.ok, true);
  assert.equal(sent.bitrix.chatId, "22");
  assert.equal(sent.bitrix.error, "");
  assert.equal(JSON.stringify(sent.bitrix).includes("http"), false);
  assert.equal(writes.some((item) => item.method === "im.chat.add.json"), false);
  assert.equal(writes.filter((item) => item.method === "im.chat.user.add.json").length, 1);
  assert.equal(writes.filter((item) => item.method === "im.message.add.json").length, 2);
  assert.equal(writes.at(-1).body.MESSAGE.includes("Карточка готова к проверке."), true);
  assert.equal(writes.at(-1).body.DIALOG_ID, "chat22");
  delete process.env.CONTROL_SENT_FILE;
  resetControlChatState();
});

test("the review chat keeps every named launch and drops a compliment", () => {
  const clients = parseReviewClients([
    { id: 1, text: "Спасибо, на карте кафе красивое и уютное место для гостей." },
    { id: 2, text: "Гостевой дом Арс\nhttps://yandex.ru/maps/org/ars/1\nМария Литвиненко: 11 отзывов к оплате за прошлую неделю\nКирилл Соколов, 5 звёзд, на модерации\nВот 12шт\nвопрос 5500\nв работе" },
    { id: 3, text: "Кафе Север\nhttps://yandex.ru/maps/org/sever/2\nзаказано 20\n01.11.2026 Анна Смирнова получено 8\nостаток 12\nоплата 4000\nзапущен" },
  ]);
  assert.equal(clients.length, 2);
  const ars = clients.find((item) => item.organization === "Гостевой дом Арс");
  assert.equal(ars.link, "https://yandex.ru/maps/org/ars/1");
  assert.equal(ars.purchased, "Нет данных");
  assert.equal(ars.remainder, "Нет данных");
  assert.equal(ars.payment, "Вопрос, 5500");
  assert.equal(ars.paymentNote.includes("11"), true);
  assert.equal(ars.status, "в работе");
  assert.equal(ars.shots[0].account, "Кирилл Соколов");
  assert.equal(ars.shots[0].received, "12");
  assert.equal(ars.shots[0].date, "Нет данных");
  assert.equal(ars.shots[0].note.includes("5 звёзд"), true);
  assert.equal(ars.shots[0].note.includes("на модерации"), true);
  const sever = clients.find((item) => item.organization === "Кафе Север");
  assert.equal(sever.purchased, "20");
  assert.equal(sever.remainder, "12");
  assert.equal(sever.payment, "4000");
  assert.equal(sever.status, "запущен");
  assert.equal(sever.shots[0].date, "01.11.2026");
  assert.equal(sever.shots[0].account, "Анна Смирнова");
  assert.equal(sever.shots[0].received, "8");
});

test("a plain Bitrix refusal is shown without a URL", async () => {
  const result = await loadReviewClients({ BITRIX_WEBHOOK_URL: "https://portal.example/rest/1/token/" }, async () => ({
    ok: false,
    async json() {
      throw new Error("not json");
    },
    async text() {
      return "ACCESS_DENIED see https://portal.example/rest/1/token/docs";
    },
  }));
  assert.equal(result.connected, false);
  assert.deepEqual(result.clients, []);
  assert.equal(result.error.includes("ACCESS_DENIED"), true);
  assert.equal(result.error.includes("http"), false);
  assert.equal(result.error.includes("token"), false);
});

test("a failed review chat keeps the Bitrix error and no invented client", async () => {
  const calls = [];
  const result = await loadReviewClients({ BITRIX_WEBHOOK_URL: "https://portal.example/rest/1/token/" }, async (endpoint) => {
    const method = endpoint.split("/").pop();
    calls.push(method);
    return {
      ok: false,
      async json() {
        return { error: "QUERY_LIMIT_EXCEEDED", error_description: "See https://portal.example/rest/1/token/docs" };
      },
    };
  });
  assert.equal(result.connected, false);
  assert.deepEqual(result.clients, []);
  assert.equal(result.error.includes("QUERY_LIMIT_EXCEEDED"), true);
  assert.equal(result.error.includes("http"), false);
  assert.equal(result.error.includes("token"), false);
  assert.equal(calls.includes("im.message.add.json"), false);
  assert.equal(calls.includes("im.chat.add.json"), false);
});

test("the review loader reads the Maxim chat and does not post", async () => {
  const calls = [];
  const result = await loadReviewClients({ BITRIX_WEBHOOK_URL: "https://portal.example/rest/1/token/" }, async (endpoint, options) => {
    const method = endpoint.split("/").pop();
    calls.push(method);
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = Object.fromEntries(new URLSearchParams(options.body));
    if (method === "im.search.chat.list.json" && body.FIND === "Максим Отзывы") {
      return { ok: true, async json() { return { result: [{ id: "chat77", title: "Максим Отзывы", entity_id: "wazzup|79286096999" }] }; } };
    }
    if (method === "im.dialog.messages.get.json") {
      if (body.LAST_ID) return { ok: true, async json() { return { result: { messages: [] } }; } };
      return { ok: true, async json() { return { result: { messages: [{ id: 4, text: "Кафе Север\nзаказано 3\nзапущен" }] } }; } };
    }
    return { ok: true, async json() { return { result: [] }; } };
  });
  assert.equal(result.connected, true);
  assert.equal(result.clients.length, 1);
  assert.equal(result.clients[0].organization, "Кафе Север");
  assert.equal(result.clients[0].purchased, "3");
  assert.equal(result.clients[0].status, "запущен");
  assert.equal(calls.includes("im.message.add.json"), false);
  assert.equal(JSON.stringify(result).includes("portal.example"), false);
});
