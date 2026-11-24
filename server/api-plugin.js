import { loadOformlenieDeals, loadReviewClients, serviceEnv } from "./bitrix.js";

function attach(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (path !== "/api/oformlenie" && path !== "/api/otzyvy") {
      next();
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify(path === "/api/otzyvy"
        ? { connected: false, clients: [], error: "Bitrix не ответил", truncated: false }
        : { connected: false, deals: [] }));
      return;
    }

    try {
      const body = path === "/api/otzyvy"
        ? await loadReviewClients(serviceEnv())
        : await loadOformlenieDeals(serviceEnv());
      res.end(JSON.stringify(body));
    } catch {
      res.end(JSON.stringify(path === "/api/otzyvy"
        ? { connected: false, clients: [], error: "Bitrix не ответил", truncated: false }
        : { connected: false, deals: [] }));
    }
  });
}

export function bitrixApiPlugin() {
  return {
    name: "bitrix-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
