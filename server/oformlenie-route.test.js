import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/oformlenie/route.js";

test("published route stays disconnected when the runtime env is blank", async () => {
  const key = "BITRIX_WEBHOOK_URL";
  const previous = process.env[key];
  delete process.env[key];
  try {
    const response = await GET(new Request("http://127.0.0.1/api/oformlenie"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { connected: false, deals: [] });
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
