import { loadReviewClients } from "./bitrix.js";
import { envForRequest } from "./deals-handler.js";

export async function GET(_request, context, configured) {
  const env = envForRequest(context, configured);
  try {
    const body = await loadReviewClients(env);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { connected: false, clients: [], error: "Bitrix не ответил", truncated: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
