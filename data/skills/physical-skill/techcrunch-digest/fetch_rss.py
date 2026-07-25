#!/usr/bin/env python3
"""抓 TechCrunch RSS feed，輸出 JSON 文章列表"""
import json, sys, urllib.request, re, xml.etree.ElementTree as ET

limit = 10
if len(sys.argv) > 1:
    try: limit = int(sys.argv[1])
    except: pass

req = urllib.request.Request("https://techcrunch.com/feed/", headers={"User-Agent": "PAAW/1.0"})
with urllib.request.urlopen(req, timeout=15) as resp:
    xml_data = resp.read().decode("utf-8")

root = ET.fromstring(xml_data)
items = []
for item in root.findall(".//item")[:limit]:
    title = (item.findtext("title") or "").strip()
    link = (item.findtext("link") or "").strip()
    pub_date = (item.findtext("pubDate") or "").strip()
    desc_raw = (item.findtext("description") or "").strip()
    # strip HTML tags
    desc = re.sub(r'<[^>]+>', '', desc_raw).strip()[:300]
    if title:
        items.append({"title": title, "link": link, "pubDate": pub_date, "description": desc})

print(json.dumps({"articles": items, "count": len(items)}, ensure_ascii=False, indent=2))
