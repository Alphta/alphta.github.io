# 博客工具 Worker（阅读计数 + 短链）

一个 Worker 同时服务两个域名：
- `api.alphta.com` —— 阅读计数 API、短链点击量查询
- `go.alphta.com` —— 短链跳转（`go.alphta.com/xxx` → 目标网址）

## 部署 / 更新

1. Cloudflare → **Workers & Pages → blog-counter → Edit code**
2. 用本目录 `worker.js` 全文覆盖 → **Deploy**
3. **Domains → Add Domain**，分别添加 `api.alphta.com` 和 `go.alphta.com`
4. KV 绑定：**Settings → Bindings**，变量名 `VIEWS` → 命名空间 `BLOG_VIEWS`
5. （可选，推荐）**Settings → Variables and Secrets → Add** → 类型 **Secret**，名称 `ADMIN_TOKEN`，值自己定一串随机字符 —— 有了它就能用 API 建短链，不用手点 KV 面板

## 创建短链

**方式 A：API（需要 ADMIN_TOKEN）**

```bash
curl -X POST https://go.alphta.com/_add \
  -H "x-admin-token: <你的token>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"tsmom","url":"https://github.com/Alphta"}'
```

**方式 B：CF 面板手填**

Storage & Databases → KV → `BLOG_VIEWS` → Add entry：
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

## 注意

- KV 是全球最终一致性，计数有几十秒延迟，属正常现象
- key 前缀约定：`views:` 阅读量、`link:` 短链目标、`clicks:` 短链点击量，别混用
- 想删短链：CF 面板 KV 里删掉 `link:<slug>` 即可（`go.alphta.com/<slug>` 会返回"链接不存在"页面）
