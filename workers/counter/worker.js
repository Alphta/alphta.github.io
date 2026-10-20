// 博客工具 Worker：阅读计数 + 短链服务
// 部署：Cloudflare Dashboard → Workers & Pages → blog-counter → Edit code → 粘贴 → Deploy
// 绑定：
//   KV namespace 变量名 VIEWS（存计数和短链）
//   自定义域 api.alphta.com（计数 API）
//   自定义域 go.alphta.com（短链跳转）
// 可选 Secret：ADMIN_TOKEN（用于通过 API 添加短链）

const ALLOWED_ORIGIN = "https://essay.alphta.com";
const HOME = "https://essay.alphta.com";

const jsonHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: jsonHeaders });
    }

    // ---------- 短链：go.alphta.com/<slug> ----------
    if (host.startsWith("go.")) {
      const slug = url.pathname.replace(/^\/+|\/+$/g, "");

      // 管理接口：POST /_add  {"slug":"xxx","url":"https://..."}
      if (slug === "_add" && request.method === "POST") {
        if (!env.ADMIN_TOKEN || request.headers.get("x-admin-token") !== env.ADMIN_TOKEN) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
        }
        const body = await request.json().catch(() => null);
        if (!body || !body.slug || !body.url) {
          return new Response(JSON.stringify({ error: "slug and url required" }), { status: 400, headers: jsonHeaders });
        }
        if (!/^[\w-]{1,64}$/.test(body.slug) || !/^https?:\/\//.test(body.url)) {
          return new Response(JSON.stringify({ error: "bad slug or url" }), { status: 400, headers: jsonHeaders });
        }
        await env.VIEWS.put("link:" + body.slug, body.url);
        return new Response(JSON.stringify({ ok: true, slug: body.slug, url: body.url }), { headers: jsonHeaders });
      }

      if (!slug) {
        return Response.redirect(HOME, 302);
      }

      const target = await env.VIEWS.get("link:" + slug);
      if (!target) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>链接不存在</title>` +
          `<body style="font-family:system-ui;padding:40px">` +
          `<h1>链接不存在</h1><p>短链 <code>${slug}</code> 还没有创建。</p>` +
          `<p><a href="${HOME}">回到博客</a></p></body>`,
          { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
      }

      // 点击统计（key: clicks:<slug>）
      const clickKey = "clicks:" + slug;
      const clicks = (parseInt(await env.VIEWS.get(clickKey)) || 0) + 1;
      await env.VIEWS.put(clickKey, String(clicks));

      // 302 且禁止缓存，保证改了目标立刻生效
      return new Response(null, {
        status: 302,
        headers: { Location: target, "Cache-Control": "no-store" },
      });
    }

    // ---------- 阅读计数：api.alphta.com ----------

    // 短链点击量查询（先处理，它不需要 path 参数）
    if (url.pathname === "/clicks") {
      const slug = url.searchParams.get("slug") || "";
      const n = parseInt(await env.VIEWS.get("clicks:" + slug)) || 0;
      return new Response(JSON.stringify({ slug, clicks: n }), { headers: jsonHeaders });
    }

    // ---------- AI / 搜索引擎来源统计 ----------
    // GET /ref?src=chatgpt.com&page=/posts/xxx/
    if (url.pathname === "/ref") {
      const src = (url.searchParams.get("src") || "").toLowerCase().slice(0, 60);
      const page = (url.searchParams.get("page") || "/").slice(0, 200);
      if (!/^[a-z0-9.-]+$/.test(src)) {
        return new Response(JSON.stringify({ error: "bad src" }), { status: 400, headers: jsonHeaders });
      }
      const day = new Date().toISOString().slice(0, 10);
      const k1 = `ref:${day}:${src}`;
      const k2 = `refpage:${day}:${src}:${page}`;
      const n1 = (parseInt(await env.VIEWS.get(k1)) || 0) + 1;
      await env.VIEWS.put(k1, String(n1));
      const n2 = (parseInt(await env.VIEWS.get(k2)) || 0) + 1;
      await env.VIEWS.put(k2, String(n2));
      return new Response(JSON.stringify({ ok: true, src, page, count: n1 }), { headers: jsonHeaders });
    }

    // GET /refstats?days=7 → 汇总来源
    if (url.pathname === "/refstats") {
      const list = await env.VIEWS.list({ prefix: "ref:" });
      const out = {};
      for (const k of list.keys) {
        const [, day, ...rest] = k.name.split(":");
        const src = rest.join(":");
        out[src] = out[src] || {};
        out[src][day] = parseInt(await env.VIEWS.get(k.name)) || 0;
      }
      return new Response(JSON.stringify(out), { headers: jsonHeaders });
    }

    const path = url.searchParams.get("path") || "";
    if (!/^\/[\w\-./]*$/.test(path) || path.length > 200) {
      return new Response(JSON.stringify({ error: "bad path" }), { status: 400, headers: jsonHeaders });
    }

    const key = "views:" + path;

    if (url.pathname === "/hit") {
      const n = (parseInt(await env.VIEWS.get(key)) || 0) + 1;
      await env.VIEWS.put(key, String(n));
      return new Response(JSON.stringify({ path, views: n }), { headers: jsonHeaders });
    }

    if (url.pathname === "/get") {
      const n = parseInt(await env.VIEWS.get(key)) || 0;
      return new Response(JSON.stringify({ path, views: n }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: jsonHeaders });
  },
};
