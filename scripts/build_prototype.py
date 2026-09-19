# -*- coding: utf-8 -*-
"""把 app_data.json 注入模板，产出可双击打开的单文件 prototype/index.html。

单文件的原因: file:// 下 fetch 本地 JSON 会被 CORS 拦截，数据必须内联。
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "prototype", "template.html")
DATA = os.path.join(ROOT, "data", "app_data.json")
OUT = os.path.join(ROOT, "prototype", "index.html")

APP = os.path.join(ROOT, "prototype", "app.js")

html = open(TPL).read()
assert "/*__DATA__*/null" in html, "模板中找不到数据占位符"
assert "/*__APP__*/" in html, "模板中找不到脚本占位符"
html = html.replace("/*__DATA__*/null", open(DATA).read())
html = html.replace("/*__APP__*/", open(APP).read())
open(OUT, "w").write(html)
print(f"写出 {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")
