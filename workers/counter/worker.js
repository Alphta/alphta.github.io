// 博客阅读计数器 - Cloudflare Worker
// 部署步骤见同目录 README.md
//
// API:
//   GET /hit?path=/posts/xxx/   阅读数 +1 并返回 { path, views }
//   GET /get?path=/posts/xxx/   只读返回当前数（不增加）
// 需要绑定 KV 命名空间，变量名必须是 VIEWS

const ALLOWED_ORIGIN = "https://essay.alphta.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // 只统计文章路径，防止乱刷垃圾 key
    const path = url.searchParams.get("path") || "";
    if (!/^\/[\w\-./]*$/.test(path) || path.length > 200) {
      return new Response(JSON.stringify({ error: "bad path" }), { status: 400, headers });
    }

    const key = "views:" + path;

    if (url.pathname === "/hit") {
      const n = (parseInt(await env.VIEWS.get(key)) || 0) + 1;
      await env.VIEWS.put(key, String(n));
      return new Response(JSON.stringify({ path, views: n }), { headers });
    }

    if (url.pathname === "/get") {
      const n = parseInt(await env.VIEWS.get(key)) || 0;
      return new Response(JSON.stringify({ path, views: n }), { headers });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
  },
};
