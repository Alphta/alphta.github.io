#!/usr/bin/env python3
"""把 sitemap 里的所有 URL 提交给 IndexNow（Bing / Yandex 等），加快收录

用法：python3 scripts/indexnow.py
"""
import json, re, sys, urllib.request

KEY = "ea58afa35b9637846f248ace3b3d4a2a"
SITE = "https://essay.alphta.com"
SITEMAP = f"{SITE}/sitemap.xml"
ENDPOINT = "https://api.indexnow.org/indexnow"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()

def main():
    xml = fetch(SITEMAP)
    urls = re.findall(r"<loc>(.*?)</loc>", xml)
    urls = [u for u in urls if u.startswith(SITE) and "/tags/" not in u]
    if not urls:
        print("sitemap 里没有可用 URL"); return 1
    payload = {
        "host": "essay.alphta.com",
        "key": KEY,
        "keyLocation": f"{SITE}/{KEY}.txt",
        "urlList": urls[:10000],
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"提交 {len(urls)} 个 URL，HTTP {r.status}")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read()[:200]}"); return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
