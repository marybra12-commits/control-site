import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GET as appGet } from "../app/api/oformlenie/route.js";
import { GET as apiGet } from "../api/oformlenie.js";
import { resetControlChatState } from "../server/bitrix.js";
import { resetSendFlight } from "../server/send-once.js";

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

test("published route reads the static runtime webhook", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { result: [] };
    },
  });
  try {
    await withEnv("https://example.invalid/rest/1/placeholder", async () => {
      const response = await apiGet(new Request("http://127.0.0.1/api/oformlenie"));
      const body = await response.json();
      assert.equal(body.connected, true);
      assert.equal(JSON.stringify(body).includes("example.invalid"), false);
    });
  } finally {
    globalThis.fetch = original;
  }
});

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

test("the deal list is ready before the greeting and stays when the post fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "control-route-"));
  const previous = process.env.CONTROL_SENT_FILE;
  process.env.CONTROL_SENT_FILE = join(dir, "sent.json");
  resetControlChatState();
  resetSendFlight();
  const order = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = String(url).split("/").pop();
    order.push(method);
    const body = options?.body ? JSON.parse(options.body) : {};
    if (method === "im.message.add.json") {
      return { ok: false, async json() { return { error: "ACCESS_DENIED", error_description: "Чат закрыт https://portal.example/rest/1/secret" }; } };
    }
    if (method === "im.chat.get.json" && String(body.CHAT_ID) === "22") {
      return { ok: true, async json() { return { result: { id: 22, title: "Система контроля", owner: 8, user_counter: 1, date_create: "2026-11-24T12:02:00+03:00", entity_type: "" } }; } };
    }
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
      "user.current.json": { ID: "8", NAME: "Мария", LAST_NAME: "Литвиненко" },
      "im.recent.get.json": [{ id: "chat22", chat_id: 22, title: "Система контроля", type: "chat" }],
    };
    return { ok: true, async json() { return { result: payloads[method] ?? [] }; } };
  };
  try {
    await withEnv("https://portal.example/rest/1/token/", async () => {
      const response = await apiGet(new Request("http://127.0.0.1/api/oformlenie"));
      const body = await response.json();
      assert.equal(body.connected, true);
      assert.equal(body.unavailable, undefined);
      assert.equal(body.deals[0].title, "Карточка");
      assert.equal(order.includes("im.message.add.json"), false);
      assert.equal(order.includes("im.chat.add.json"), false);
      assert.equal(body.bitrix, undefined);
      assert.equal(JSON.stringify(body).includes("portal.example"), false);
    });
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.CONTROL_SENT_FILE;
    else process.env.CONTROL_SENT_FILE = previous;
    resetControlChatState();
    resetSendFlight();
  }
});
