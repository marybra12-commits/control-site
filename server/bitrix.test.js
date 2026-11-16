import assert from "node:assert/strict";
import test from "node:test";
import { loadOformlenieDeals, webhookConfigured } from "./bitrix.js";

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

test("deal list asks for the first 20 and keeps only title, stage, and assignee", async () => {
  let request;
  const result = await loadOformlenieDeals(
    { BITRIX_WEBHOOK_URL: "https://example.invalid/rest/1/placeholder" },
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            result: [
              {
                ID: 7,
                TITLE: "  Карточка  ",
                STAGE_ID: "NEW",
                ASSIGNED_BY_ID: 4,
                COMMENTS: "hidden",
              },
            ],
            next: 50,
          };
        },
      };
    },
  );

  assert.equal(request.url.endsWith("/crm.deal.list.json"), true);
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    start: 0,
    limit: 20,
    select: ["ID", "TITLE", "STAGE_ID", "ASSIGNED_BY_ID"],
  });
  assert.deepEqual(result, {
    connected: true,
    deals: [{ id: "7", title: "Карточка", stage: "NEW", assignee: "4" }],
  });
  assert.equal(JSON.stringify(result).includes("example.invalid"), false);
  assert.equal(JSON.stringify(result).includes("placeholder"), false);
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
