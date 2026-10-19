# 博客阅读计数器（Cloudflare Workers + KV）

## 一次性部署步骤（全在 dash.cloudflare.com 上操作）

1. **建 KV 存储**：左侧 **Storage & Databases → KV** → **Create a namespace** → 名字填 `BLOG_VIEWS` → Create
2. **建 Worker**：左侧 **Workers & Pages → Create application** → **Create Worker** → 名字填 `blog-counter` → **Deploy**（先部署默认 hello world）
3. **粘贴代码**：部署完点 **Edit code**，把 `worker.js` 全文粘贴进去替换 → 右上角 **Deploy**
4. **绑定 KV**：回到 Worker 页面 → **Settings → Bindings → Add** → 选 **KV namespace**：
   - Variable name: `VIEWS`（必须完全一样）
   - KV namespace: 选 `BLOG_VIEWS`
5. **绑域名**：**Settings → Triggers → Custom Domains → Add Custom Domain** → 填 `api.alphta.com` → Add（CF 会自动建 DNS 记录，等 1-2 分钟生效）

## 验证

```bash
curl "https://api.alphta.com/hit?path=/test/"
# 应返回 {"path":"/test/","views":1}，再刷一次变 2
```

## API 说明

- `GET /hit?path=...` 计数 +1，博客文章页加载时调用
- `GET /get?path=...` 只读，适合后台看数据
- 免费额度：每天 10 万次请求 + KV 10 万次读/1 千次写，博客量级永远用不完
- KV 是全球最终一致性，计数偶尔有几秒延迟，正常
