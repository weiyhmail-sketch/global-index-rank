# -*- coding: utf-8 -*-
"""从 Yahoo Finance 抓全球指数日线，产出 data/raw/idx/{code}.json。

设计为在 GitHub Actions（境外 runner）中运行 —— Yahoo 对境内与机房 IP
一律返回 "Edge: Too Many Requests"，本机直接跑多半会失败。

输出格式与 fetch_indices.py 一致，因此 check_data.py / build_snapshot.py
无需改动即可复用。
"""
import json, os, sys, time, argparse
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from yahoo_symbols import INDICES
from nethttp import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "raw", "idx")
SLEEP = 0.6          # Yahoo 对突发请求敏感，保守限速
RETRIES = 3


def fetch(symbol, rng="10y"):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?range={rng}&interval=1d")
    body = get(url, timeout=30)
    if body.lstrip().startswith("Edge:"):
        raise RuntimeError(f"被限流: {body.strip()[:60]}")
    j = json.loads(body)
    chart = j.get("chart") or {}
    if chart.get("error"):
        raise RuntimeError(f"API错误: {chart['error'].get('code')}")
    res = chart["result"][0]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    out = {}
    for t, c in zip(ts, closes):
        if c is None or c <= 0:      # 休市/缺失，剔除而非补零
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat()
        out[d] = float(c)
    meta = res.get("meta", {})
    return out, meta.get("currency"), meta.get("shortName") or symbol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只抓指定 code，逗号分隔")
    ap.add_argument("--range", default="10y")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    todo = INDICES
    if args.only:
        want = set(args.only.split(","))
        todo = [i for i in INDICES if i["code"] in want]

    ok, failed, ccy_mismatch = [], [], []
    for n, m in enumerate(todo, 1):
        tag = f"[{n}/{len(todo)}] {m['flag']} {m['country']} {m['name']} ({m['yahoo']})"
        last_err = None
        for attempt in range(RETRIES):
            try:
                data, ccy, name = fetch(m["yahoo"], args.range)
                if not data:
                    raise RuntimeError("返回空序列")
                ks = sorted(data)
                json.dump({"code": m["code"], "source": "yahoo", "symbol": m["yahoo"],
                           "fetched": date.today().isoformat(), "data": data},
                          open(os.path.join(CACHE, m["code"] + ".json"), "w"),
                          separators=(",", ":"))
                note = ""
                if ccy and ccy != m["ccy"]:
                    note = f"  ⚠️ 币种 Yahoo={ccy} 配置={m['ccy']}"
                    ccy_mismatch.append((m["code"], m["ccy"], ccy))
                print(f"{tag}: {len(data)} 条 {ks[0]}→{ks[-1]}{note}", flush=True)
                ok.append(m["code"])
                break
            except Exception as e:
                last_err = e
                if attempt < RETRIES - 1:
                    time.sleep(2 ** attempt)
        else:
            print(f"{tag}: 失败 {type(last_err).__name__}: {last_err}", flush=True)
            failed.append((m["code"], m["yahoo"], str(last_err)[:60]))
        time.sleep(SLEEP)

    print(f"\n成功 {len(ok)} / 失败 {len(failed)} / 共 {len(todo)}")
    if ccy_mismatch:
        print("\n币种不一致（需核对 yahoo_symbols.py 的 ccy 字段）:")
        for c, conf, real in ccy_mismatch:
            print(f"  {c}: 配置 {conf} → 实际 {real}")
    if failed:
        print("\n失败明细:")
        for c, sym, err in failed:
            print(f"  {c:<8} {sym:<14} {err}")
    return 1 if len(ok) == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
