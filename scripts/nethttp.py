# -*- coding: utf-8 -*-
"""统一的 HTTP 取数工具。

本机 Python 3.14 (python.org 版) 未安装 CA 根证书，直接 urlopen 会报
CERTIFICATE_VERIFY_FAILED。这里统一用 certifi 提供的根证书。
"""
import ssl, urllib.request

try:
    import certifi
    _CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _CTX = ssl.create_default_context()

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def get(url, timeout=40, referer=None, encoding="utf-8"):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        return r.read().decode(encoding, "replace")
