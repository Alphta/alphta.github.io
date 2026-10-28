# news-cron：每小时自动重建 /news/ 页面

## 为什么需要它

GitHub Actions 的 `schedule` 触发器对 `Alphta/alphta.github.io` **不派发任务**
（2026-10-28 实测：仓库历史上 0 次 schedule 事件；临时加的 `*/5` 探针 workflow
连续错过多个槽位；push 和 workflow_dispatch 都正常）。这是仓库/账号级的问题，
与 workflow 文件内容无关。

因此用这个 Worker 的 cron 代替 GitHub 定时器：每小时第 7 分钟 POST 一次
`workflow_dispatch`，启动完整的 Hugo 构建（构建时会重新抓取 31 个栏目生成新闻页）。

## 一次性部署

```bash
cd workers/news-cron
npx wrangler login                              # 若之前登录过可跳过
npx wrangler deploy                             # 部署代码 + cron 触发器
echo "<GH_TOKEN>" | npx wrangler secret put GH_TOKEN
```

`GH_TOKEN` 是一个对 `Alphta/alphta.github.io` 有 **Actions: Read and write**
权限的 fine-grained PAT（或带 `workflow` scope 的 classic PAT）。
创建地址：https://github.com/settings/personal-access-tokens/new
（Repository access 选 Only select repositories → alphta.github.io；
Permissions → Repository → Actions → Read and write）

## 验证

```bash
# 手动触发一次（应返回 {"ok":true,"status":204,...}）
curl https://news-cron.<你的 workers 子域>.workers.dev/run

# 然后看 GitHub 是否多了一条 workflow_dispatch 运行
gh run list -R Alphta/alphta.github.io --limit 3
```

CF 面板里 Workers → news-cron → Settings → Triggers 能看到 cron 调度记录。

## 说明

- GitHub workflow 里的 `schedule: '7 * * * *'` 保留作备份，万一 GitHub 定时器
  恢复，等于双保险（重复构建无害，concurrency 会取消进行中的重复任务）。
- 想改频率就改 `wrangler.toml` 里的 `crons`，再 `npx wrangler deploy`。
