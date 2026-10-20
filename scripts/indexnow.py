#!/usr/bin/env python3
"""把 sitemap 里的所有 URL 提交给 IndexNow（Bing / Yandex 等），加快收录

用法：python3 scripts/indexnow.py
说明：用系统 curl 发请求（Python urllib 在本机访问 Cloudflare 会 SSL 断连）。
"""
import json
import re
import subprocess
import sys

KEY = "ea58afa35b9637846f248ace3b3d4a2a"
SITE = "https://essay.alphta.com"
SITEMAP = f"{SITE}/sitemap.xml"
ENDPOINT = "https://api.indexnow.org/indexnow"


def fetch(url):
    r = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-A", "Mozilla/5.0", url],
        capture_output=True, text=True, timeout=45,
    )
    if r.returncode != 0:
        raise RuntimeError(f"curl 失败：{r.stderr.strip()[:200]}")
    return r.stdout


def main():
    xml = fetch(SITEMAP)
    urls = re.findall(r"<loc>(.*?)</loc>", xml)
    urls = [u for u in urls if u.startswith(SITE) and "/tags/" not in u]
    if not urls:
        print("sitemap 里没有可用 URL")
        return 1

    payload = json.dumps({
        "host": "essay.alphta.com",
        "key": KEY,
        "keyLocation": f"{SITE}/{KEY}.txt",
        "urlList": urls[:10000],
    }, ensure_ascii=False)

    r = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-o", "/dev/null", "-w", "%{http_code}",
         "-X", "POST", ENDPOINT,
         "-H", "Content-Type: application/json; charset=utf-8",
         "--data-binary", payload],
        capture_output=True, text=True, timeout=45,
    )
    if r.returncode != 0:
        print(f"提交失败：{r.stderr.strip()[:200]}")
        return 1
    code = r.stdout.strip()
    print(f"提交 {len(urls)} 个 URL，HTTP {code}")
    return 0 if code in ("200", "202") else 1


if __name__ == "__main__":
    sys.exit(main())
