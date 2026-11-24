import assert from "node:assert/strict";
import test from "node:test";
import { GET as apiGet } from "../api/otzyvy.js";

const WEBHOOK_ENV = "BITRIX_WEBHOOK_URL";

test("the reviews route stays quiet when the webhook is blank", async () => {
  const previous = process.env[WEBHOOK_ENV];
  delete process.env[WEBHOOK_ENV];
  try {
    const response = await apiGet(new Request("http://127.0.0.1/api/otzyvy"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.connected, false);
    assert.deepEqual(body.clients, []);
    assert.equal(body.error, "Битрикс пока не подключён.");
  } finally {
    if (previous === undefined) delete process.env[WEBHOOK_ENV];
    else process.env[WEBHOOK_ENV] = previous;
  }
});
