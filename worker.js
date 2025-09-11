export default {
  async fetch(request, env, ctx) {
    const withCORS = (resp) => {
      const r = new Response(resp.body, resp);
      r.headers.set("Access-Control-Allow-Origin", "*");
      r.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      r.headers.set("Access-Control-Allow-Headers", "Content-Type");
      return r;
    };

    const url = new URL(request.url);

    // --- OPTIONS (au cas où) ---
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // --- GET "simple" (proxy lecture) + cache conditionnel ---
    if (request.method === "GET") {
      const apiUrl = url.searchParams.get("apiUrl");
      const query  = url.searchParams.get("query") || "";
      if (!apiUrl) return withCORS(new Response("Missing apiUrl", { status: 400 }));

      const target = new URL(query.startsWith("?") ? query : "?" + query, apiUrl).toString();

      // ⬅️ pas de cache si nocache=1 OU si on touche aux consignes / catégories
      const skipCache =
        url.searchParams.has("nocache") ||
        /(^|\?)mode=(consignes|practice)($|&)/.test(query);

      const cache = caches.default;
      const cacheKey = new Request(target, { method: "GET" });

      if (!skipCache) {
        const cached = await cache.match(cacheKey);
        if (cached) return withCORS(cached);
      }

      const upstream = await fetch(target, { method: "GET", headers: skipCache ? { "Cache-Control": "no-cache" } : {} });
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", skipCache ? "no-store" : "public, max-age=60, s-maxage=60");

      const resp = new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });

      if (!skipCache) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return withCORS(resp);
    }

    // --- POST (autosave / soumission / consignes) ---
    if (request.method === "POST") {
      const raw = await request.text();              // accepte text/plain ou application/json
      let data = {};
      try { data = JSON.parse(raw || "{}"); } catch {}

      // Mode "proxy legacy" (si jamais tu conserves l'ancien contrat)
      if (data && data._proxy) {
        const method = data.method || "GET";
        const target = new URL((data.query || ""), data.apiUrl).toString();
        const init = method === "GET"
          ? { method: "GET" }
          : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data.body || {}) };
        const upstream = await fetch(target, init);
        return withCORS(upstream);
      }

      // Mode direct : on forwarde tel quel au Apps Script
      const apiUrl = data?.apiUrl;
      if (!apiUrl) return withCORS(new Response("Missing apiUrl", { status: 400 }));

      const upstream = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return withCORS(upstream);
    }

    return withCORS(new Response("Method Not Allowed", { status: 405 }));
  }
}
