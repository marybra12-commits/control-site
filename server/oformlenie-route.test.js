import assert from "node:assert/strict";
import test from "node:test";
import { GET as appGet } from "../app/api/oformlenie/route.js";
import { GET as apiGet } from "../api/oformlenie.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

async function withEnv(value, run) {
  const previous = process.env[WEBHOOK_ENV];
  if (value === undefined) delete process.env[WEBHOOK_ENV];
  else process.env[WEBHOOK_ENV] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[WEBHOOK_ENV];
    else process.env[WEBHOOK_ENV] = previous;
  }
}

test("published route reads the webhook from the request runtime env", async () => {
  const hidden = new Proxy({}, {
    get(_target, key) {
      if (key === WEBHOOK_ENV) return "https://example.invalid/rest/1/placeholder";
      return undefined;
    },
    ownKeys() {
      return [];
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { result: [] };
    },
  });
  try {
    await withEnv(undefined, async () => {
      const response = await apiGet(new Request("http://127.0.0.1/api/oformlenie"), { env: hidden });
      const body = await response.json();
      assert.equal(body.connected, true);
      assert.equal(JSON.stringify(body).includes("example.invalid"), false);
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("published routes stay disconnected when the runtime env is blank", async () => {
  await withEnv(undefined, async () => {
    for (const get of [appGet, apiGet]) {
      const response = await get(new Request("http://127.0.0.1/api/oformlenie"));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { connected: false, deals: [] });
    }
  });
});

test("root handler reads the runtime env and returns deal titles only", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url) => {
    called = true;
    const method = String(url).split("/").pop();
    const payloads = {
      "crm.dealcategory.list.json": [{ ID: "4", NAME: "Оформление ЯКарты/Аналитика" }],
      "crm.deal.list.json": [{
        ID: "3",
        TITLE: "Карточка",
        CATEGORY_ID: "4",
        STAGE_ID: "C4:NEW",
        STAGE_SEMANTIC_ID: "P",
        ASSIGNED_BY_ID: "9",
      }],
      "crm.status.list.json": [
        { ENTITY_ID: "DEAL_STAGE_4", STATUS_ID: "C4:NEW", NAME: "Новая" },
      ],
    };
    return {
      ok: true,
      async json() {
        return { result: payloads[method] ?? [] };
      },
    };
  };
  try {
    await withEnv("https://example.invalid/rest/1/placeholder", async () => {
      const response = await apiGet(new Request("http://127.0.0.1/api/oformlenie"));
      const body = await response.json();
      assert.equal(called, true);
      assert.equal(body.connected, true);
      assert.equal(body.deals[0].title, "Карточка");
      assert.equal(body.deals[0].assignee, "Нет данных");
      assert.equal(body.deals[0].checks.every((check) => check.status === "Нет данных"), true);
      assert.equal(JSON.stringify(body).includes("http"), false);
    });
  } finally {
    globalThis.fetch = original;
  }
});
