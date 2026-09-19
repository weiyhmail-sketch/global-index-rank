# -*- coding: utf-8 -*-
"""抓取各国主权股指日线收盘价，逐指数缓存到 data/raw/idx/{code}.json。

源链(按顺序尝试):
  1. 新浪专用接口 —— A股 / 美股 / 港股。历史最长(美股回溯至 2004 年)，
     且境外 IP 也能访问，故对这 7 个指数优先于东财
  2. 东方财富 push2his —— 覆盖全部 48 个指数，通用主源
  3. 新浪环球市场   —— 覆盖其中 18 个，备源(上限 1000 条约 4 年)

重要: 东财对机房/境外 IP 会直接拒连(返回空/RemoteDisconnected)。
若本机开着代理软件的 TUN/全局模式，路由表会把全部流量劫持进隧道
(表现为 `128.0/1 -> utunNN` 优先于 default)，此时清 HTTP_PROXY 等
环境变量无效 —— 必须关闭代理软件或切到规则模式。云函数环境无此问题。

限速: 默认每请求间隔 0.45s。实测连发 9 个无间隔请求会被封 IP 数小时。
"""
import json, os, sys, time, argparse
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from indices import INDICES
from nethttp import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "raw", "idx")
EM_UT = "f057cbcbce2a86e2866ab8877db1d059"
SLEEP = 0.45


def from_eastmoney(secid):
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
           f"?secid={secid}&klt=101&fqt=1&lmt=50000&end=20500000&iscca=1"
           f"&fields1=f1,f2,f3&fields2=f51,f53&ut={EM_UT}&forcect=1")
    j = json.loads(get(url, referer="https://quote.eastmoney.com/"))
    d = j.get("data")
    if not d or not d.get("klines"):
        raise ValueError("东财返回空(常见于机房IP被拒或代码无效)")
    out = {}
    for line in d["klines"]:
        parts = line.split(",")
        if len(parts) >= 2 and parts[1] not in ("-", ""):
            v = float(parts[1])
            if v > 0:            # 休市日可能返回 0，必须剔除
                out[parts[0]] = v
    return out, d.get("name", "")


def from_sina_cn(symbol):
    """新浪 A 股指数日线。symbol 形如 sh000001。"""
    url = ("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           f"CN_MarketData.getKLineData?symbol={symbol}&scale=240&ma=no&datalen=1023")
    txt = get(url, referer="https://finance.sina.com.cn").replace('\\"', '"')
    rows = json.loads(txt)
    return {r["day"]: float(r["close"]) for r in rows if float(r["close"]) > 0}, ""


def _from_akshare(fn, **kw):
    """新浪的美股/港股指数走私有 K 线编码, 用 akshare 的解码器。

    注意: 这条源只用于本地开发。云函数(Node)里没有 akshare,
    届时走东财即可(云端 IP 不会被拒)。
    """
    import akshare as ak
    df = getattr(ak, fn)(**kw)
    out = {}
    for _, r in df.iterrows():
        c = float(r["close"])
        if c > 0:
            out[str(r["date"])] = c
    return out, ""


def from_sina_us(symbol):
    return _from_akshare("index_us_stock_sina", symbol=symbol)


def from_sina_hk(symbol):
    return _from_akshare("stock_hk_index_daily_sina", symbol=symbol)


def from_sina(symbol):
    url = f"https://gi.finance.sina.com.cn/hq/daily?symbol={symbol}&num=10000"
    j = json.loads(get(url, referer="https://finance.sina.com.cn"))
    rows = j.get("result", {}).get("data")
    if not rows:
        raise ValueError("新浪返回空")
    # 注意: 新浪在休市日(如印尼劳动节)会返回 c="0"，而字符串 "0" 为真值，
    # 不能只判 r.get("c")，必须显式剔除非正数，否则会污染跨该日的所有计算。
    out = {}
    for r in rows:
        try:
            v = float(r.get("c") or 0)
        except (TypeError, ValueError):
            continue
        if v > 0:
            out[r["d"]] = v
    return out, ""


def fetch_one(meta):
    """按源链依次尝试，返回 (数据, 源名, 错误列表)。"""
    errs = []

    # 1) 新浪专源(历史最长, 境外 IP 可用)
    for key, fn, tag in (("cn", from_sina_cn, "sina-cn"),
                         ("us", from_sina_us, "sina-us"),
                         ("hk", from_sina_hk, "sina-hk")):
        if meta.get(key):
            try:
                data, _ = fn(meta[key])
                if data:
                    return data, tag, errs
            except Exception as e:
                errs.append(f"{tag}: {type(e).__name__}")
            time.sleep(SLEEP)

    # 2) 东财通用源
    try:
        data, _ = from_eastmoney(meta["em"])
        return data, "eastmoney", errs
    except Exception as e:
        errs.append(f"eastmoney: {type(e).__name__}")
    if meta.get("sina"):
        time.sleep(SLEEP)
        try:
            data, _ = from_sina(meta["sina"])
            return data, "sina", errs
        except Exception as e:
            errs.append(f"sina: {type(e).__name__}")
    return None, None, errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略当日缓存重新抓取")
    ap.add_argument("--only", help="只抓指定 code, 逗号分隔")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    today = date.today().isoformat()
    todo = INDICES
    if args.only:
        want = set(args.only.split(","))
        todo = [i for i in INDICES if i["code"] in want]

    ok, cached, failed = [], [], []
    for n, meta in enumerate(todo, 1):
        path = os.path.join(CACHE, meta["code"] + ".json")
        if not args.force and os.path.exists(path):
            try:
                if json.load(open(path)).get("fetched") == today:
                    cached.append(meta["code"]); continue
            except Exception:
                pass

        data, src, errs = fetch_one(meta)
        tag = f"[{n}/{len(todo)}] {meta['flag']} {meta['name']}"
        if data:
            ks = sorted(data)
            json.dump({"code": meta["code"], "source": src, "fetched": today,
                       "data": data}, open(path, "w"), separators=(",", ":"))
            print(f"{tag}: {len(data)} 条 {ks[0]}→{ks[-1]}  [{src}]")
            ok.append(meta["code"])
        else:
            print(f"{tag}: 失败 ({'; '.join(errs)})")
            failed.append(meta["code"])
        time.sleep(SLEEP)

    print(f"\n成功 {len(ok)} / 命中缓存 {len(cached)} / 失败 {len(failed)}")
    if failed:
        print("失败: " + " ".join(failed))
        print("若失败集中在东财源，多半是本机全局代理导致；关闭代理后重跑。")


if __name__ == "__main__":
    main()
