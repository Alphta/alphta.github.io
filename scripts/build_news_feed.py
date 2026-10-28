#!/usr/bin/env python3
"""把央行/监管/交易所等机构的公告聚合成一个 RSS 2.0 feed。

只用标准库，方便在 GitHub Actions 里零依赖运行。
输出：static/news/feed.xml（Hugo 会原样复制到站点根 /news/feed.xml）
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

CN_TZ = timezone(timedelta(hours=8))


def _D(days_ago=0):
    """n 天前的日期字符串，用于需要显式起止日期的接口。"""
    return (datetime.now(CN_TZ) - timedelta(days=days_ago)).strftime("%Y-%m-%d")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 2026-10-27 / 2026/10/27 / 2026.10.27 / 2026年10月27日
DATE_FULL = re.compile(r"(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})")
# 列表里只写 10-27 的情况
DATE_SHORT = re.compile(r"(?<!\d)(\d{1,2})\s*[-/月]\s*(\d{1,2})(?!\d)")

# 噪声过滤：领导活动 / 地方派出机构 / 人事招聘。
# 只作用于标题，命中就不进 feed，可用 --keep-noise 关闭。
NOISE_RE = re.compile(
    r"会见|会谈|座谈|拜访|拜会|调研|考察|走访|出席|致辞|讲话|批示|慰问|参观|访问"
    r"|(?:监管局|监管分局|特派办|专员办|证监局|银保监分局|财政厅|税务局|分局|办事处)\s*[：:]"
    r"|招聘|遴选|招考|报考|录用|选调|笔试|面试|拟聘"
)


class Source:
    """一个抓取源。parser 为 None 时用通用 HTML 列表解析。"""

    def __init__(self, sid, name, url, *, encoding="utf-8", base=None,
                 headers=None, parser=None, kind="html", body=None,
                 cutoff_days=45, home=None, link_re=None, short=None):
        self.id = sid
        self.name = name
        self.url = url
        self.encoding = encoding
        self.base = base or url
        self.headers = headers or {}
        self.parser = parser
        self.kind = kind
        self.body = body
        self.cutoff_days = cutoff_days
        self.home = home or base or url
        self.link_re = link_re
        self.short = short or name


# ---------------------------------------------------------------- 网络

def _decode(raw: bytes, content_type: str, fallback: str) -> str:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    encodings = []
    if m:
        encodings.append(m.group(1))
    encodings += [fallback, "utf-8", "gb18030"]
    seen = set()
    for enc in encodings:
        enc = (enc or "").lower()
        if enc in seen:
            continue
        seen.add(enc)
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "ignore")


def fetch(src: Source, timeout=25, retries=1):
    """返回 (text, final_url)。失败抛异常。"""
    headers = dict(BASE_HEADERS)
    headers.update(src.headers)
    data = src.body.encode("utf-8") if src.body else None
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(src.url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                final = resp.geturl()
            return _decode(raw, ctype, src.encoding), final
        except ssl.SSLError as e:
            last_err = e
            # 少数国内站点证书链不全，退化为不校验（只读公开数据）
            try:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                req = urllib.request.Request(src.url, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    raw = resp.read()
                    return _decode(raw, resp.headers.get("Content-Type", ""), src.encoding), resp.geturl()
            except Exception as e2:  # noqa: BLE001
                last_err = e2
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise last_err  # type: ignore[misc]


# ---------------------------------------------------------------- 解析

def clean_text(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html_mod.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def parse_date(block: str, now: datetime):
    m = DATE_FULL.search(block)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(y, mo, d, tzinfo=CN_TZ)
        except ValueError:
            return None
    m = DATE_SHORT.search(block)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        try:
            dt = datetime(now.year, mo, d, tzinfo=CN_TZ)
        except ValueError:
            return None
        if dt > now + timedelta(days=2):  # 跨年：列表里是去年的 12 月
            dt = dt.replace(year=now.year - 1)
        return dt
    return None


def parse_generic_html(text: str, src: Source, now: datetime):
    """通用列表解析：按 <li>/<tr> 块切，块内找第一个链接 + 一个日期。"""
    items = []
    blocks = re.findall(r"(?is)<(li|tr|dd)\b[^>]*>(.*?)</\1>", text)
    for _tag, block in blocks:
        if len(block) > 6000:
            block = block[:6000]
        a = re.search(r'(?is)<a\s[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a>', block)
        if not a:
            continue
        href = a.group(1).strip()
        if href.startswith(("javascript:", "#", "mailto:")):
            continue
        if src.link_re and not re.search(src.link_re, href):
            continue
        inner = a.group(2)
        # 优先 title 属性，其次 h6/h4 里的标题，最后用 <a> 内纯文本
        title = ""
        tattr = re.search(r'title\s*=\s*["\']([^"\']{4,})["\']', a.group(0))
        if tattr:
            title = clean_text(tattr.group(1))
        if len(title) < 4:
            h = re.search(r"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>", inner)
            title = clean_text(h.group(1)) if h else clean_text(inner)
        title = title[:180].strip()
        # 列表里常把日期塞进链接文本，例如「标题 10-29」「标题 2026-10-27」
        title = re.sub(r"\s*20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?\s*$", "", title)
        title = re.sub(r"\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?\s*$", "", title)
        title = title.strip(" ·-—|")
        if len(title) < 4:
            continue
        dt = parse_date(block, now)
        if not dt:
            continue
        link = urllib.parse.urljoin(src.base, href)
        items.append({"source": src.name, "title": title, "link": link, "date": dt})
    return items


def parse_json_items(data, src: Source, now: datetime, mapping):
    """把 JSON 列表映射成条目。mapping 描述字段路径。"""
    rows = data
    for key in mapping.get("list_path", []):
        rows = rows.get(key) if isinstance(rows, dict) else rows
        if rows is None:
            return []
    if not isinstance(rows, list):
        return []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = ""
        for k in mapping.get("title_keys", []):
            title = title or clean_text(str(row.get(k) or ""))
        link = ""
        for k in mapping.get("link_keys", []):
            link = link or str(row.get(k) or "")
        datestr = ""
        for k in mapping.get("date_keys", []):
            datestr = datestr or str(row.get(k) or "")
        if not title or len(title) < 4:
            continue
        dt = parse_date(datestr, now) if datestr else None
        if not dt and datestr.isdigit() and len(datestr) == 13:  # 毫秒时间戳
            dt = datetime.fromtimestamp(int(datestr) / 1000, CN_TZ)
        if not dt and datestr.isdigit() and len(datestr) == 10:  # 秒时间戳
            dt = datetime.fromtimestamp(int(datestr), CN_TZ)
        if not dt:
            continue
        if link:
            link = urllib.parse.urljoin(src.base, link)
        items.append({"source": src.name, "title": title[:180], "link": link, "date": dt})
    return items


# ---------------------------------------------------------------- 站点适配器

def parse_pbc(text: str, src: "Source", now: datetime):
    """央行新闻列表：<font class="newslist_style"> + <a title> + 日期在 <a> 外的 span。"""
    items = []
    for chunk in re.split(r'(?is)<font class="newslist_style"', text)[1:]:
        chunk = re.split(r"(?is)</tr>|<li[\s>]", chunk)[0]
        m = re.search(r'(?is)<a\s[^>]*href="([^"]*113469/(\d{19})/index\.html)"[^>]*>', chunk)
        if not m:
            continue
        tag = m.group(0)
        # 必须用空格锚定，否则 istitle="true" 会被误当成 title
        t = re.search(r'\stitle="([^"]+)"', tag)
        title = html_mod.unescape(t.group(1)) if t else ""
        if len(title) < 4:
            continue
        d = re.search(r"(20\d{2}-\d{2}-\d{2})", chunk)
        if d:
            dt = parse_date(d.group(1), now)
        else:  # 退化为用 URL 里的 20261027… 时间戳
            i = m.group(2)
            dt = parse_date(f"{i[:4]}-{i[4:6]}-{i[6:8]}", now)
        if not dt:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin(src.base, m.group(1)),
                      "date": dt})
    return items


def parse_nfra(text: str, src: "Source", now: datetime):
    """金融监管总局：/cbircweb 后端 JSON，需自己拼详情页 URL。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("rows") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", "", str(r.get("docTitle") or ""))
        dt = parse_date(str(r.get("publishDate") or ""), now)
        if len(title) < 4 or not dt:
            continue
        items.append({
            "title": title[:180],
            "link": ("https://www.nfra.gov.cn/cn/view/pages/ItemDetail.html"
                     f"?docId={r.get('docId')}&itemId=915&generaltype=0"),
            "date": dt,
        })
    return items


def parse_csrc(text: str, src: "Source", now: datetime):
    """证监会：/searchList/{channelid}?_isJson=true；url 为协议相对地址。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("results") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        url = str(r.get("url") or "")
        if url.startswith("//"):
            url = "https:" + url
        dt = parse_date(str(r.get("publishedTimeStr") or r.get("publishedTime") or ""), now)
        if len(title) < 4 or not dt:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_gov_json(text: str, src: "Source", now: datetime):
    """中国政府网：YAOWENLIEBIAO.json / ZUIXINZHENGCE.json 静态数组。"""
    rows = json.loads(text)
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("list") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("TITLE") or r.get("title") or "")).strip()
        url = str(r.get("URL") or r.get("url") or "")
        dt = parse_date(str(r.get("DOCRELPUBTIME") or r.get("pubTime") or ""), now)
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_shcpe(text: str, src: "Source", now: datetime):
    """票交所：POST /shcpe-cos/article/list，publishTime 为 2026.10.23 点分隔。"""
    d = json.loads(text)
    rows = d.get("data") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishTime") or ""), now)
        aid = r.get("articleId")
        if len(title) < 4 or not dt or not aid:
            continue
        items.append({
            "title": title[:180],
            "link": ("http://www.shcpe.com.cn/content/shcpe/news/announce.html"
                     f"?articleType=news-announce&articleId={aid}"),
            "date": dt,
        })
    return items


def _raw(url, headers=None, data=None, timeout=25):
    """最简请求，返回解码后的文本（给需要多步握手的源用）。"""
    h = dict(BASE_HEADERS)
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return _decode(raw, resp.headers.get("Content-Type", ""), "utf-8")


def parse_sse(text: str, src: "Source", now: datetime):
    """上交所：pageHelp.data 是二维数组，必须拍平；SSEDATE 已是 YYYY-MM-DD。"""
    d = json.loads(text)
    rows = (d.get("pageHelp") or {}).get("data") or []
    flat = []
    for r in rows:
        if isinstance(r, list):
            flat.extend(r)
        elif isinstance(r, dict):
            flat.append(r)
    items = []
    for r in flat:
        title = re.sub(r"\s+", " ", str(r.get("TITLE") or "")).strip()
        dt = parse_date(str(r.get("SSEDATE") or ""), now)
        url = str(r.get("URL") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.sse.com.cn", url),
                      "date": dt})
    return items


def parse_szse(text: str, src: "Source", now: datetime):
    """深交所：正文 PDF 在另一个域名 disc.szse.cn/download 下。"""
    d = json.loads(text)
    rows = d.get("data") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishTime") or ""), now)
        path = str(r.get("attachPath") or "")
        if len(title) < 4 or not dt or not path:
            continue
        items.append({"title": title[:180],
                      "link": "https://disc.szse.cn/download" + path,
                      "date": dt})
    return items


def parse_chinabond(text: str, src: "Source", now: datetime):
    """中债登：queryLatestReleaseForIndex，只回最新 9 条且不可翻页。"""
    d = json.loads(text)
    rows = (((d.get("data") or {}).get("data") or {}).get("list")) or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("DocTitle") or "")).strip()
        dt = parse_date(str(r.get("ShengXiaoShiJian") or ""), now)
        url = str(r.get("DOCPUBURL") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180], "link": url, "date": dt})
    return items


def parse_bse(text: str, src: "Source", now: datetime):
    """北交所：首页是 wswaf 挑战，先用 C3VK 换 Cookie，再 POST listse.do。"""
    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None  # 不跟随，自己读挑战响应

    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request("https://www.bse.cn/news/important_news.html",
                                 headers=dict(BASE_HEADERS))
    ck, body = "", ""
    try:
        with opener.open(req, timeout=25) as r:
            body = r.read().decode("utf-8", "ignore")
            ck = r.headers.get("Set-Cookie", "") or ""
    except urllib.error.HTTPError as e:  # 302 会抛 HTTPError
        body = e.read().decode("utf-8", "ignore")
        ck = e.headers.get("Set-Cookie", "") or ""
    m = re.search(r"C3VK=([0-9a-fA-F]+)", body) or re.search(r"C3VK=([0-9a-fA-F]+)", ck)
    if not m:
        raise RuntimeError("未取到 C3VK 挑战 Cookie")
    body = ("page=0&pageSize=20&keywords=&startTime=&endTime=&nodeIds[]=1289"
            "&needFields[]=infoId&needFields[]=title&needFields[]=metaDescription"
            "&needFields[]=linkUrl&needFields[]=htmlUrl&needFields[]=publishDate")
    raw = _raw("https://www.bse.cn/info/listse.do",
               headers={"Cookie": f"C3VK={m.group(1)}",
                        "X-Requested-With": "XMLHttpRequest",
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "Referer": "https://www.bse.cn/news/important_news.html"},
               data=body.encode())
    raw = re.sub(r"^\s*[a-zA-Z_$][\w$]*\s*\(", "", raw).strip()
    raw = re.sub(r"\)\s*;?\s*$", "", raw)
    d = json.loads(raw)
    rows = (((d[0] if isinstance(d, list) else d).get("data") or {}).get("content")) or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        dt = parse_date(str(r.get("publishDate") or ""), now)
        url = str(r.get("htmlUrl") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.bse.cn", url),
                      "date": dt})
    items.sort(key=lambda x: x["date"], reverse=True)  # 首条恒为 2021 年置顶旧闻
    return items


def parse_shfe(text: str, src: "Source", now: datetime):
    """上期所：/api/search/ 必须带 Content-Type: application/json，否则 200 但 code=500。"""
    d = json.loads(text)
    rows = (d.get("data") or {}).get("content") or []
    items = []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("doctitle") or "")).strip()
        dt = parse_date(str(r.get("docreltime") or ""), now)
        url = str(r.get("docpuburl") or "")
        if len(title) < 4 or not dt or not url:
            continue
        items.append({"title": title[:180],
                      "link": urllib.parse.urljoin("https://www.shfe.com.cn", url),
                      "date": dt})
    return items


# ---------------------------------------------------------------- 源清单

def build_sources():
    S = Source
    return [
        S("pbc", "中国人民银行",
          "https://www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html",
          parser=parse_pbc, home="https://www.pbc.gov.cn/", short="人民银行"),
        S("nfra", "国家金融监督管理总局",
          "https://www.nfra.gov.cn/cbircweb/DocInfo/SelectDocByItemIdAndChild"
          "?itemId=915&pageSize=18&pageIndex=1",
          parser=parse_nfra, home="https://www.nfra.gov.cn/", short="金监总局"),
        S("csrc", "中国证监会",
          "https://www.csrc.gov.cn/searchList/a1a078ee0bc54721ab6b148884c784a8"
          "?_isAgg=true&_isJson=true&_pageSize=20&_template=index"
          "&_rangeTimeGte=&_channelName=&page=1",
          parser=parse_csrc, home="https://www.csrc.gov.cn/", short="证监会"),
        # 中国政府网按需求移除（2026-10-28）
        # S("gov", "中国政府网",
        #   "https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json",
        #   parser=parse_gov_json, home="https://www.gov.cn/"),
        # S("govzhengce", "国务院·最新政策",
        #   "https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json",
        #   parser=parse_gov_json, home="https://www.gov.cn/zhengce/zuixin/"),
        S("ndrc", "国家发展改革委", "https://www.ndrc.gov.cn/xwdt/xwfb/",
          home="https://www.ndrc.gov.cn/", short="发改委"),
        S("mof", "财政部", "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/",
          home="https://www.mof.gov.cn/", short="财政部"),
        S("mof_kjs", "财政部会计司（准则发布）",
          "https://kjs.mof.gov.cn/zhengcefabu/",
          home="https://kjs.mof.gov.cn/", short="会计司·准则", cutoff_days=200),
        S("mof_kjs_dt", "财政部会计司（工作动态）",
          "https://kjs.mof.gov.cn/gongzuodongtai/",
          home="https://kjs.mof.gov.cn/", short="会计司·动态", cutoff_days=200),
        S("chinatax", "国家税务总局",
          "https://www.chinatax.gov.cn/chinatax/n810219/n810724/common_list_swxw.html",
          home="https://www.chinatax.gov.cn/", short="税务总局"),
        S("safe", "国家外汇管理局", "https://www.safe.gov.cn/safe/whxw/index.html",
          home="https://www.safe.gov.cn/", short="外汇局"),
        S("cffex", "中国金融期货交易所", "http://www.cffex.com.cn/cn/jysgg.html",
          home="http://www.cffex.com.cn/", short="中金所"),
        S("shcpe", "上海票据交易所",
          "http://www.shcpe.com.cn/shcpe-cos/article/list",
          headers={"Content-Type": "application/json;charset=utf-8",
                   "Accept": "application/json"},
          body=json.dumps({"requestTime": "2026-10-28",
                           "requestSystem": "shcpe-cos", "requestNo": 1,
                           "pageSize": 50, "pageNum": 1,
                           "typeCode": "news-announce"}, ensure_ascii=False),
          parser=parse_shcpe, home="http://www.shcpe.com.cn/", short="票交所"),
        S("amac", "中国证券投资基金业协会", "https://www.amac.org.cn/xwfb/tzgg/",
          link_re=r"\./\d{6}/t\d{8}_\d+\.html", home="https://www.amac.org.cn/",
          short="中基协"),
        S("nafmii", "交易商协会", "https://www.nafmii.org.cn/ggtz/tz/",
          link_re=r"\./\d{6}/t\d{8}_\d+\.html", home="https://www.nafmii.org.cn/",
          short="交易商协会"),
        # S("sse", "上海证券交易所",
        # "https://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do"
        # "?jsonCallBack=&isPagination=true&pageHelp.pageSize=25&pageHelp.cacheSize=1"
        # "&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.endPage=1"
        # f"&START_DATE={_D(9)}&END_DATE={_D(0)}"
        # "&SECURITY_CODE=&TITLE=&BULLETIN_TYPE=&stockType=",
        # headers={"Referer": "https://www.sse.com.cn/"},
        # parser=parse_sse, home="https://www.sse.com.cn/"),
        # S("szse", "深圳证券交易所", "https://www.szse.cn/api/disc/announcement/annList",
        # headers={"X-Request-Type": "ajax",
        # "X-Requested-With": "XMLHttpRequest",
        # "Content-Type": "application/json;charset=UTF-8",
        # "Referer": "https://www.szse.cn/disclosure/listed/notice/index.html"},
        # body=json.dumps({"seDate": [_D(9), _D(0)],
        # "channelCode": ["listedNotice_disc"],
        # "pageSize": 30, "pageNum": 1}),
        # parser=parse_szse, home="https://www.szse.cn/"),
        S("bse", "北京证券交易所", "https://www.bse.cn/info/listse.do",
          kind="custom", parser=parse_bse, home="https://www.bse.cn/", short="北交所"),
        S("shfe", "上海期货交易所", "https://www.shfe.com.cn/api/search/",
          headers={"Content-Type": "application/json"},
          body=json.dumps({"chlid": 1003, "page": 1, "size": 50,
                           "searchword": "docchannel=2384",
                           "orderby": "-docreltime"}),
          parser=parse_shfe, home="https://www.shfe.com.cn/", short="上期所"),
        S("cffex_tz", "中金所·通知", "http://www.cffex.com.cn/cn/jystz.html",
          link_re=r"/cn/jystz/\d{8}/\d+\.html", home="http://www.cffex.com.cn/", short="中金所通知"),
        # S("chinabond", "中央结算公司（中债登）",
        # "https://www.chinabond.com.cn/cbiw/trs/queryLatestReleaseForIndex",
        # headers={"X-Requested-With": "XMLHttpRequest",
        # "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        # "Referer": "https://www.chinabond.com.cn/"},
        # body="siteInfo=CN", parser=parse_chinabond,
        # home="https://www.chinabond.com.cn/"),
        # 待补：customs/shfe/dce/czce/shclearing
    ]


# ---------------------------------------------------------------- 出口

def build_rss(items, now, self_url, site_url):
    fmt = lambda d: format_datetime(d.astimezone(CN_TZ))
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        "<title>机构公告速递</title>",
        f"<link>{escape(site_url)}</link>",
        "<description>央行、监管、交易所与金融基础设施的官方公告聚合</description>",
        "<language>zh-cn</language>",
        f"<lastBuildDate>{fmt(now)}</lastBuildDate>",
        "<generator>alphta-news-feed</generator>",
        f'<atom:link href="{escape(self_url)}" rel="self" type="application/rss+xml"/>',
    ]
    for it in items:
        parts.append("<item>")
        parts.append(f"<title>{escape(it['title'])}</title>")
        if it["link"]:
            parts.append(f"<link>{escape(it['link'])}</link>")
            parts.append(f'<guid isPermaLink="true">{escape(it["link"])}</guid>')
        else:
            parts.append(f'<guid isPermaLink="false">{escape(it["source"] + "|" + it["title"])}</guid>')
        parts.append(f"<category>{escape(it.get('short') or it['source'])}</category>")
        parts.append(f'<source url="{escape(it.get("home", ""))}">{escape(it["source"])}</source>')
        parts.append(f"<pubDate>{fmt(it['date'])}</pubDate>")
        parts.append(f"<description>{escape((it.get('short') or it['source']) + '：' + it['title'])}</description>")
        parts.append("</item>")
    parts += ["</channel>", "</rss>"]
    return "\n".join(parts) + "\n"


INDEX_TMPL = """<!doctype html>
<html lang="zh-cn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>机构公告速递</title>
<style>
:root{--fg:#1a1a1a;--dim:#8a8a8a;--line:#ececec;--link:#0a5bd4;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#e6e6e6;--dim:#8f8f8f;--line:#2a2a2a;--link:#6aa9ff;--bg:#161616}}
*{box-sizing:border-box}
body{font:16px/1.75 -apple-system,BlinkMacSystemFont,"Noto Sans SC","PingFang SC",sans-serif;
     max-width:52rem;margin:3rem auto;padding:0 1.2rem;color:var(--fg);background:var(--bg)}
h1{font-size:1.45rem;margin:0 0 .25rem}
p.sub{color:var(--dim);font-size:.88rem;margin:.2rem 0 1.6rem}
ul{list-style:none;padding:0;margin:0}

/* 表头与行共用同一套栅格：日期 | 主题 | 发文机关 */
.hd,li{display:grid;grid-template-columns:4.2rem minmax(0,1fr) 7rem;
       column-gap:.85rem;align-items:center}
.hd{padding:.5rem .2rem;border-bottom:2px solid var(--line);
    font-size:.82rem;color:var(--dim);position:sticky;top:0;background:var(--bg);z-index:1}
.hd [data-sort]{cursor:pointer;user-select:none;white-space:nowrap}
.hd [data-sort]:hover{color:var(--fg)}
.hd [data-sort].active{color:var(--fg);font-weight:600}
.hd .arrow{font-size:.7em}
.hd .c-title,.hd .c-src{text-align:center}

li{padding:.55rem .2rem;border-bottom:1px solid var(--line)}
li time{color:var(--dim);font-size:.84rem;font-variant-numeric:tabular-nums;white-space:nowrap}
li .s{color:var(--dim);font-size:.78rem;text-align:center;
     white-space:nowrap;justify-self:center}

/* 标题：换行后自动与首字左对齐（悬挂缩进） */
a.t{color:var(--link);text-decoration:none;display:block;
    line-height:1.42;              /* 折行后两行之间收紧 */
    text-indent:0;overflow-wrap:anywhere;text-wrap:pretty;
    transition:color .18s ease,opacity .18s ease}
a.t:hover{text-decoration:underline}
a.t.read{color:var(--dim);opacity:.62}

@media (max-width:560px){
  .hd,li{grid-template-columns:3.4rem minmax(0,1fr)}
  .hd .c-src,li .s{display:none}
}
</style></head><body>
<h1>机构公告速递</h1>
<p class="sub">央行、监管、交易所与金融基础设施的官方公告聚合 · 共 __COUNT__ 条 · 更新于 __NOW__ (UTC+8)</p>

<div class="hd">
  <span data-sort="date" class="active">日期<span class="arrow"></span></span>
  <span class="c-title">主题</span>
  <span data-sort="src" class="c-src">发文机关<span class="arrow"></span></span>
</div>
<ul id="list">
__ROWS__
</ul>

<script>
(function(){
  var ul = document.getElementById('list');
  var heads = document.querySelectorAll('[data-sort]');
  var state = {key:'date', dir:'desc'};

  function fmtDir(el, key){
    var arrow = el.querySelector('.arrow');
    arrow.textContent = (state.key === key) ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
    el.classList.toggle('active', state.key === key);
  }

  function applySort(key){
    if (state.key === key) { state.dir = state.dir === 'asc' ? 'desc' : 'asc'; }
    else { state.key = key; state.dir = key === 'date' ? 'desc' : 'asc'; }
    var items = Array.prototype.slice.call(ul.children);
    items.sort(function(a, b){
      var x = key === 'date' ? a.dataset.date : a.dataset.src;
      var y = key === 'date' ? b.dataset.date : b.dataset.src;
      var r = key === 'date' ? (x < y ? -1 : x > y ? 1 : 0)
                             : x.localeCompare(y, 'zh-Hans-CN');
      return state.dir === 'asc' ? r : -r;
    });
    items.forEach(function(el){ ul.appendChild(el); });
    heads.forEach(function(el){ fmtDir(el, el.dataset.sort); });
  }

  heads.forEach(function(el){
    el.addEventListener('click', function(){ applySort(el.dataset.sort); });
  });

  // 已读：点击后变淡，并记住
  var KEY = 'nf_read_';
  var links = document.querySelectorAll('a.t');
  links.forEach(function(a){
    try { if (localStorage.getItem(KEY + a.dataset.k)) a.classList.add('read'); } catch(e){}
    a.addEventListener('click', function(ev){
      // 保留 cmd/ctrl/中键的原生行为
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) {
        a.classList.add('read');
        try { localStorage.setItem(KEY + a.dataset.k, '1'); } catch(e){}
        return;
      }
      ev.preventDefault();
      // 注意：带 'noopener' 特性时 window.open 返回 null，会被误判为被拦截，
      // 所以这里用普通 window.open，再手动断开 opener。
      var w = window.open(a.href, '_blank');
      if (w) {
        try { w.opener = null; } catch (e) {}
        window.focus();               // 焦点留在本页，新标签在后台打开
      } else {
        location.href = a.href;       // 真正被弹窗拦截才兜底
      }
      a.classList.add('read');
      try { localStorage.setItem(KEY + a.dataset.k, '1'); } catch(e){}
    });
  });

  heads.forEach(function(el){ fmtDir(el, el.dataset.sort); });
})();
</script>
</body></html>
"""


def build_index_html(items, now):
    """给 /news/ 一个人类可读的落地页：表头 + 排序 + 悬挂缩进 + 后台打开。"""
    rows = []
    for it in items:
        stamp = it["date"].strftime("%Y-%m-%d %H:%M")
        day = it["date"].strftime("%m-%d")
        key = escape(it["link"] or it["title"], {'"': "&quot;"})
        rows.append(
            f'<li data-date="{stamp}" data-src="{escape(it.get("short") or it["source"])}">'
            f'<time datetime="{it["date"].strftime("%Y-%m-%d")}" '
            f'title="{it["date"].strftime("%Y-%m-%d %H:%M")}">{day}</time>'
            f'<a class="t" href="{escape(it["link"])}" data-k="{key}" '
            f'target="_blank" rel="noopener">{escape(it["title"])}</a>'
            f'<span class="s">{escape(it.get("short") or it["source"])}</span></li>'
        )
    return (INDEX_TMPL
            .replace("__ROWS__", "\n".join(rows))
            .replace("__COUNT__", str(len(items)))
            .replace("__NOW__", now.strftime("%Y-%m-%d %H:%M")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/news/feed.xml")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--only", default="")
    ap.add_argument("--keep-noise", action="store_true", help="不过滤领导活动/地方局/招聘类条目")
    args = ap.parse_args()

    now = datetime.now(CN_TZ)
    sources = [s for s in build_sources() if not args.only or s.id in args.only.split(",")]
    results, errors = {}, []

    def work(src: Source):
        try:
            if src.kind == "custom":
                return src.id, src.parser(None, src, now), None
            text, final = fetch(src)
            if src.parser:
                return src.id, src.parser(text, src, now), final
            return src.id, parse_generic_html(text, src, now), final
        except Exception as e:  # noqa: BLE001
            return src.id, e, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        for sid, res, _final in pool.map(work, sources):
            if isinstance(res, Exception):
                errors.append((sid, f"{type(res).__name__}: {res}"))
            else:
                results[sid] = res

    cutoff = now - timedelta(days=60)
    merged, seen = [], set()
    dropped = 0
    for src in sources:
        src_cutoff = now - timedelta(days=src.cutoff_days or 60)
        for it in results.get(src.id, []):
            if it["date"] < src_cutoff:
                continue
            if not args.keep_noise and NOISE_RE.search(it["title"]):
                dropped += 1
                continue
            it["source"] = src.name
            it["short"] = src.short
            it["home"] = src.home
            key = re.sub(r"[?#].*$", "", it["link"] or "") or (it["source"] + it["title"])
            if key in seen:
                continue
            seen.add(key)
            merged.append(it)
    # 先保证每个有数据的源至少 1 条，再按时间补满，避免高频站点把低频站点挤掉
    per_source = {}
    for it in merged:
        per_source.setdefault(it["source"], []).append(it)
    for arr in per_source.values():
        arr.sort(key=lambda x: x["date"], reverse=True)

    # 轮转分配：每轮每个源取 1 条，避免高频站点（如中国政府网）挤掉低频的交易所
    queues = {name: list(arr) for name, arr in per_source.items()}
    picked = []
    while len(picked) < args.limit and queues:
        for name in list(queues):
            if len(picked) >= args.limit:
                break
            arr = queues[name]
            if arr:
                picked.append(arr.pop(0))
            if not arr:
                del queues[name]
    merged = picked
    merged.sort(key=lambda x: x["date"], reverse=True)

    print(f"[info] {len(merged)} 条 / {len(sources)} 源，失败 {len(errors)} 个")
    for sid, err in errors:
        print(f"[warn] {sid}: {err}")
    for src in sources:
        n = len(results.get(src.id, []))
        if n == 0 and not any(e[0] == src.id for e in errors):
            print(f"[warn] {src.id}: 解析到 0 条")

    if not merged:
        print("[error] 没有任何条目，保留旧文件不覆盖")
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        build_rss(merged, now,
                  "https://essay.alphta.com/news/feed.xml",
                  "https://essay.alphta.com/news/"),
        encoding="utf-8",
    )
    print(f"[ok] -> {out} ({out.stat().st_size} bytes)")
    (out.parent / "index.html").write_text(build_index_html(merged, now), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
