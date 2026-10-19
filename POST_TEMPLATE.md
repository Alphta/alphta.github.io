# 新文章模板（在 GitHub 网页写文章时复制此文件的 front matter）

## 网页发文步骤

1. 仓库首页 → **Add file → Create new file**
2. 文件名输入：`content/posts/文章名/index.md`（输入 `/` 会自动生成目录）
3. 把下面的 front matter 粘到文件顶部，改标题/日期/标签
4. 上传配图：回到仓库 → 进入 `content/posts/文章名/` → **Add file → Upload files**，把图片传到 `images/` 子目录（先手动建一个 `images/.gitkeep` 或直接上传时路径写 `images/xxx.png`）
5. 上传 PDF：进入 `static/files/` → Upload files（网页上传单文件限 25MB）
6. 写完确认 `draft: false`，**Commit changes**，一两分钟后 https://essay.alphta.com 自动更新

## 复制以下内容作为文章开头

```markdown
---
title: "文章标题"
date: 2026-10-20T12:00:00+08:00
draft: false
tags: ["标签1"]
categories: []
summary: "一句话摘要，列表页显示。"
# 有封面图时取消注释（图片放本目录 images/ 下）：
# image: "images/cover.png"
---

正文从这里开始。

配图引用（图片在本文章目录的 images/ 下）：
![描述](images/xxx.png)

PDF 引用（文件在 static/files/ 下）：
[下载 PDF](/files/xxx.pdf)
```
