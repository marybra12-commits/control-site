import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceStatus, loadOformlenieDeals, organizationName, webhookConfigured } from "./bitrix.js";

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

test("deal list keeps the title, labeled fields, and the girl's name", async () => {
  const calls = [];
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder" },
    async (url, options) => {
      calls.push({ url, options });
      const method = String(url).split("/").pop();
      const payloads = {
        "crm.deal.userfield.list.json": [
          { FIELD_NAME: "UF_PERIOD", LIST_COLUMN_LABEL: { ru: "Период" } },
          { FIELD_NAME: "UF_LINK", EDIT_FORM_LABEL: { ru: "Ссылка" } },
          { FIELD_NAME: "UF_ADDRESS", LIST_COLUMN_LABEL: "Адрес точки" },
        ],
        "crm.deal.list.json": [
          {
            ID: 7,
            TITLE: "  Индивидуальный предприниматель Иванова Анна  ",
            STAGE_ID: "C2:WON",
            ASSIGNED_BY_ID: 4,
            DATE_CREATE: "2026-11-16T11:00:00+03:00",
            UF_PERIOD: "ноябрь",
            UF_LINK: "https://example.invalid/card",
            UF_ADDRESS: "Невский, 1",
            COMMENTS: "hidden",
          },
        ],
        "crm.status.list.json": [
          { ENTITY_ID: "DEAL_STAGE_2", STATUS_ID: "C2:WON", NAME: "Успех" },
        ],
        "user.get.json": [
          { ID: 4, NAME: "Анна", LAST_NAME: "Смирнова" },
        ],
      };
      return {
        ok: true,
        async json() {
          return { result: payloads[method] ?? [] };
        },
      };
    },
    new Date("2026-11-20T12:00:00+03:00"),
  );

  const dealCall = calls.find((call) => String(call.url).endsWith("/crm.deal.list.json"));
  assert.equal(dealCall.options.method, "POST");
  assert.deepEqual(JSON.parse(dealCall.options.body).select, [
    "ID",
    "TITLE",
    "CATEGORY_ID",
    "STAGE_ID",
    "ASSIGNED_BY_ID",
    "DATE_CREATE",
    "BEGINDATE",
    "CLOSEDATE",
    "UF_PERIOD",
    "UF_LINK",
    "UF_ADDRESS",
  ]);
  assert.equal(result.connected, true);
  assert.equal(result.deals[0].title, "ИП Иванова Анна");
  assert.equal(result.deals[0].period, "ноябрь");
  assert.equal(result.deals[0].link, "https://example.invalid/card");
  assert.equal(result.deals[0].address, "Невский, 1");
  assert.equal(result.deals[0].assignee, "Анна Смирнова");
  assert.equal(result.deals[0].stage, "Успех");
  assert.equal(result.deals[0].checks.find((check) => check.code === "AM-D0-1").status, "Сделано");
  assert.equal(result.deals[0].checks.find((check) => check.code === "AM-D0-2").status, "Нет данных");
  assert.equal(JSON.stringify(result).includes("placeholder"), false);
  assert.equal(JSON.stringify(result).includes("C2:WON"), false);
  assert.equal(JSON.stringify(result).includes("Смирнова") , true);
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
