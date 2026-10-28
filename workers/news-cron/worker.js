// news-cron：每小时触发一次 GitHub Actions 构建，重新生成 /news/ 页面
//
// 背景：GitHub 的 schedule 触发器对 Alphta/alphta.github.io 不派发任务
// （实测 0 次 schedule 事件，探针 workflow 也不派发），所以用 CF Worker 的
// cron 代替它，每小时 POST 一次 workflow_dispatch。
//
// 需要的 Secret：GH_TOKEN（对 Alphta/alphta.github.io 有 Actions: write 权限的 PAT）

const REPO = "Alphta/alphta.github.io";
const WORKFLOW = "hugo.yml";

async function trigger(env) {
  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GH_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "news-cron-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );
  return {
    ok: resp.status === 204,
    status: resp.status,
    at: new Date().toISOString(),
  };
}

export default {
  // cron 触发（来自 wrangler.toml 的 [triggers]）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(trigger(env));
  },

  // 手动入口：访问 /run 立即触发一次，/ 返回健康状态
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const r = await trigger(env);
      return new Response(JSON.stringify(r), {
        status: r.ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("news-cron ok; POST /run to trigger a build", { status: 200 });
  },
};
