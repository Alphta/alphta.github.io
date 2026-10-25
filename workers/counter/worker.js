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
    // 允许的来源（正式站 + 预览站 + 本地开发）
    const ALLOWED = [
      "https://essay.alphta.com",
      "https://blog-preview-bbv.pages.dev",
      "http://localhost:1313",
      "http://127.0.0.1:1313",
    ];
    const reqOrigin = request.headers.get("Origin") || "";
    const origin = ALLOWED.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGIN;
    const jsonHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };
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

    // 全站计数：PV 每次 +1；UV 按访客 id 去重（同一浏览器只算一次）
    if (url.pathname === "/sitehit") {
      let pv = parseInt(await env.VIEWS.get("site:total"));
      if (!Number.isFinite(pv)) pv = 0;
      pv += 1;
      await env.VIEWS.put("site:total", String(pv));

      let uv = parseInt(await env.VIEWS.get("site:uv"));
      if (!Number.isFinite(uv)) uv = 0;

      const vid = (url.searchParams.get("vid") || "").trim();
      if (/^[\w-]{8,64}$/.test(vid)) {
        const seen = await env.VIEWS.get("uv:" + vid);
        if (!seen) {
          await env.VIEWS.put("uv:" + vid, "1", { expirationTtl: 60 * 60 * 24 * 400 });
          uv += 1;
          await env.VIEWS.put("site:uv", String(uv));
        }
      }
      return new Response(JSON.stringify({ pv, uv }), { headers: jsonHeaders });
    }

    if (url.pathname === "/total") {
      let pv = parseInt(await env.VIEWS.get("site:total"));
      if (!Number.isFinite(pv) || pv <= 0) {
        pv = 0;
        let cursor;
        do {
          const list = await env.VIEWS.list({ prefix: "views:", cursor });
          for (const k of list.keys) {
            pv += parseInt(await env.VIEWS.get(k.name)) || 0;
          }
          cursor = list.list_complete ? null : list.cursor;
        } while (cursor);
        await env.VIEWS.put("site:total", String(pv));
      }
      const uv = parseInt(await env.VIEWS.get("site:uv")) || 0;
      return new Response(JSON.stringify({ total: pv, pv, uv }), { headers: jsonHeaders });
    }

    // ---------- 站内 AI 问答 ----------
    if (url.pathname === "/ask" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const q = String(body.q || "").trim();
      if (q.length < 2 || q.length > 200) {
        return new Response(JSON.stringify({ error: "问题长度需在 2–200 字之间" }), { status: 400, headers: jsonHeaders });
      }

      // 限流：每 IP 每分钟 8 次
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const minute = new Date().toISOString().slice(0, 16);
      const rlKey = `rl:ask:${ip}:${minute}`;
      const used = parseInt(await env.VIEWS.get(rlKey)) || 0;
      if (used >= 8) {
        return new Response(JSON.stringify({ error: "提问太频繁，请一分钟后再试" }), { status: 429, headers: jsonHeaders });
      }
      await env.VIEWS.put(rlKey, String(used + 1), { expirationTtl: 120 });

      // 语料：走站点缓存，1 小时刷新
      let corpus = [];
      try {
        const cr = await fetch("https://essay.alphta.com/ai/corpus.json", { cf: { cacheTtl: 3600 } });
        corpus = await cr.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "语料加载失败" }), { status: 500, headers: jsonHeaders });
      }

      // 关键词粗筛：中文按二元组，英文按单词
      const terms = new Set();
      for (const w of q.toLowerCase().match(/[a-z0-9]{2,}/g) || []) terms.add(w);
      const han = q.replace(/[^\u4e00-\u9fa5]/g, "");
      for (let i = 0; i < han.length - 1; i++) terms.add(han.slice(i, i + 2));
      const list = [...terms];

      const scored = corpus.map((doc) => {
        const title = doc.title || "";
        const text = doc.text || "";
        let s = 0;
        for (const t of list) {
          const inTitle = title.split(t).length - 1;
          const inText = text.split(t).length - 1;
          s += inTitle * 5 + Math.min(inText, 20);
        }
        return { doc, s };
      }).sort((a, b) => b.s - a.s);

      const picked = scored.filter((x) => x.s > 0).slice(0, 3).map((x) => x.doc);
      const use = picked.length ? picked : corpus.slice(0, 2);

      const ctx = use.map((d, i) =>
        `[${i + 1}] 《${d.title}》(${d.url})\n${(d.text || "").slice(0, 2500)}`
      ).join("\n\n");

      const prompt = `以下是本站文章片段：\n\n${ctx}\n\n用户问题：${q}`;
      const system = "你是「荒唐镜的人生」博客的检索助手。只依据提供的文章片段回答，不要使用片段之外的知识。如果片段里没有答案，直接回答「站内文章没有提到这一点」。中文回答，2–4 段，简洁，不要编造，不要加标题。";

      const models = ["gemini-flash-lite-latest", "gemini-3.8-flash"];
      let answer = "";
      for (const m of models) {
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${env.GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
              }),
            }
          );
          const j = await r.json();
          const t = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
          if (t) { answer = t.trim(); break; }
        } catch (e) { /* 换下一个模型 */ }
      }

      if (!answer) {
        return new Response(JSON.stringify({ error: "AI 暂时不可用，请稍后再试" }), { status: 503, headers: jsonHeaders });
      }

      return new Response(JSON.stringify({
        answer,
        sources: use.map((d) => ({ title: d.title, url: d.url })),
      }), { headers: jsonHeaders });
    }

    // ---------- 文件下载：访问码 → KV 文件流 ----------
    if (url.pathname === "/download" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const slug = String(body.slug || "").trim();
      const code = String(body.code || "").trim().toUpperCase();

      if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
        return new Response(JSON.stringify({ error: "bad slug" }), { status: 400, headers: jsonHeaders });
      }

      const meta = JSON.parse((await env.VIEWS.get("doc:" + slug + ":meta")) || "null");
      if (!meta) {
        return new Response(JSON.stringify({ error: "文件不存在" }), { status: 404, headers: jsonHeaders });
      }

      if (meta.paid) {
        if (!/^[A-Z0-9-]{6,32}$/.test(code)) {
          return new Response(JSON.stringify({ error: "请输入访问码" }), { status: 401, headers: jsonHeaders });
        }
        const rec = await env.VIEWS.get("code:" + code, { cacheTtl: 60 });
        if (!rec) {
          return new Response(JSON.stringify({ error: "访问码无效" }), { status: 403, headers: jsonHeaders });
        }
        let allow = ["*"];
        try { allow = JSON.parse(rec).slugs || ["*"]; } catch (e) { allow = ["*"]; }
        if (!allow.includes("*") && !allow.includes(slug)) {
          return new Response(JSON.stringify({ error: "该访问码不适用于这份文件" }), { status: 403, headers: jsonHeaders });
        }
      }

      const data = await env.VIEWS.get("file:" + slug, { type: "arrayBuffer" });
      if (!data) {
        return new Response(JSON.stringify({ error: "文件不存在" }), { status: 404, headers: jsonHeaders });
      }

      const fname = meta.filename || slug + ".pdf";
      const headers = new Headers({
        "Content-Type": meta.type || "application/pdf",
        "Content-Length": String(data.byteLength),
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(fname),
        "Cache-Control": "private, max-age=0, no-store",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Expose-Headers": "Content-Disposition",
      });
      return new Response(data, { headers });
    }

    // ---------- 付费内容：访问码解锁 ----------
    if (url.pathname === "/unlock" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const slug = String(body.slug || "").trim();
      const code = String(body.code || "").trim().toUpperCase();

      if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
        return new Response(JSON.stringify({ error: "bad slug" }), { status: 400, headers: jsonHeaders });
      }
      if (!/^[A-Z0-9-]{6,32}$/.test(code)) {
        return new Response(JSON.stringify({ error: "请输入访问码" }), { status: 401, headers: jsonHeaders });
      }

      const rec = await env.VIEWS.get("code:" + code, { cacheTtl: 60 });
      if (!rec) {
        return new Response(JSON.stringify({ error: "访问码无效" }), { status: 403, headers: jsonHeaders });
      }
      let allow = ["*"];
      try { allow = JSON.parse(rec).slugs || ["*"]; } catch (e) { allow = ["*"]; }
      if (!allow.includes("*") && !allow.includes(slug)) {
        return new Response(JSON.stringify({ error: "该访问码不适用于这篇文章" }), { status: 403, headers: jsonHeaders });
      }

      const html = await env.VIEWS.get("paid:" + slug, { cacheTtl: 60 });
      if (!html) {
        return new Response(JSON.stringify({ error: "正文暂未上架" }), { status: 404, headers: jsonHeaders });
      }
      return new Response(JSON.stringify({ ok: true, html }), { headers: jsonHeaders });
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
