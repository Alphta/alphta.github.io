# 博客工具 Worker（阅读计数 + 短链）

一个 Worker 同时服务两个域名：
- `api.alphta.com` —— 阅读计数 API、短链点击量查询
- `go.alphta.com` —— 短链跳转（`go.alphta.com/xxx` → 目标网址）

Worker 名：`rapid-bush-a207`（CF 自动生成的名字，就是博客用的那个），账户 `1fde0d7b2e73becc2de1562fe60c8fba`。
KV 命名空间：`Blog_VIEWS` = `8ba601649b08479a92f16f4faf968331`，绑定变量名 `VIEWS`。

## 部署（命令行，推荐）

网页编辑器经常出现 Deploy 按钮灰掉、粘贴截断等问题，直接用 wrangler：

```bash
cd workers/counter
npx wrangler login          # 只需一次，浏览器点 Allow
npx wrangler deploy         # 部署代码，KV 绑定来自 wrangler.toml
```

本目录的 `wrangler.toml` 已经写好 name / main / KV 绑定，改完 `worker.js` 直接 `npx wrangler deploy` 即可。

## 一次性配置（已完成，记录备查）

- 自定义域：`api.alphta.com`、`go.alphta.com` 都通过 workers/domains API 挂在 `rapid-bush-a207` 上（CF 自动建 DNS 和证书）
- Secret：`ADMIN_TOKEN`（建短链用的管理密钥）
- 加 Secret：`echo "值" | npx wrangler secret put ADMIN_TOKEN`

## 创建短链

**方式 A：API（需要 ADMIN_TOKEN）**

```bash
curl -X POST https://go.alphta.com/_add \
  -H "x-admin-token: <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"tsmom","url":"https://github.com/Alphta"}'
```

**方式 B：CF 面板手填**

Storage & Databases → KV → `Blog_VIEWS` → Add entry：
- Key: `link:tsmom`
- Value: `https://github.com/Alphta`

## 使用

| 地址 | 作用 |
|---|---|
| `go.alphta.com/tsmom` | 302 跳转到目标网址，同时点击量 +1 |
| `go.alphta.com`（根） | 跳回博客首页 |
| `api.alphta.com/clicks?slug=tsmom` | 查某个短链被点了多少次 |
| `api.alphta.com/hit?path=/posts/xxx/` | 阅读计数 +1（文章页自动调用） |
| `api.alphta.com/get?path=/posts/xxx/` | 只读阅读数 |

## 踩过的坑

- **路由顺序**：`/clicks` 必须在 `path` 参数校验之前处理，否则它没有 `path` 参数会被判成 `bad path`。
- **缓存**：404 和 302 响应必须带 `Cache-Control: no-store`，否则浏览器会缓存"链接不存在"，改了短链目标也不生效。
- 网页编辑器里 Deploy 灰掉通常是因为编辑器内容和线上版本相同（没粘进去），不是故障。
- 本机 DNS 对新建子域可能有负缓存，`curl` 报 "Could not resolve host" 时用 `--resolve go.alphta.com:443:<CF IP>` 验证，或等几分钟。
