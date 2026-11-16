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
  globalThis.fetch = async () => {
    called = true;
    return {
      ok: true,
      async json() {
        return { result: [{ ID: "3", TITLE: "Карточка", STAGE_ID: "NEW", ASSIGNED_BY_ID: "9" }] };
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
