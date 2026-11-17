import { loadOformlenieDeals, serviceEnv } from "./bitrix.js";

function attach(server) {
  server.middlewares.use(async (req, res, next) => {
    const path = req.url?.split("?")[0];
    if (path !== "/api/oformlenie") {
      next();
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ connected: false, deals: [] }));
      return;
    }

    try {
      const body = await loadOformlenieDeals(serviceEnv());
      res.end(JSON.stringify(body));
    } catch {
      res.end(JSON.stringify({ connected: false, deals: [] }));
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
