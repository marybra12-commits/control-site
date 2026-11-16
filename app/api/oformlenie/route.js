import { loadOformlenieDeals } from "../../../server/bitrix.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  request?.headers?.get("accept");
  const body = await loadOformlenieDeals();
  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}
