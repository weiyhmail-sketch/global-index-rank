# -*- coding: utf-8 -*-
"""抓取汇率日线，产出 data/raw/fx.json。

口径统一为「1 美元 = N 本币」(USD 为基准)。

源链:
  1. Frankfurter (欧洲央行, 免费无 key, 可回溯至 1999) —— 覆盖 25/29 种
  2. Yahoo Finance `{CCY}=X` —— 历史长, 但机房 IP 会被限流(Too Many Requests),
     需在正常网络下才能取到
  3. fawazahmed0 currency-api via jsDelivr —— 341 种货币, 但仅回溯至 2024-03,
     作为 Yahoo 取不到时的兜底

2、3 两源用于补 TWD/VND/PKR/LKR(欧洲央行不发布这几种)。
两源都拿不到的货币记入 missing，对应指数只提供本币口径，绝不估算填充。
"""
import json, os, sys, time
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from indices import CURRENCIES
from nethttp import get

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "fx.json")
START = "2015-01-01"
STALE_DAYS = 30        # 汇率最后更新距今超过这么多天, 判定为停更

def from_frankfurter(ccys, end):
    """返回 {ccy: {date: rate}}。一次请求拿全部币种的整段历史。"""
    syms = ",".join(sorted(ccys))
    url = f"https://api.frankfurter.dev/v1/{START}..{end}?base=USD&symbols={syms}"
    data = json.loads(get(url, timeout=90))["rates"]
    out = {c: {} for c in ccys}
    for d, row in data.items():
        for c, v in row.items():
            out[c][d] = v
    return out


def from_yahoo(ccy):
    """Yahoo 的 `{CCY}=X` 日线。机房 IP 会被限流，需在正常网络下跑。"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ccy}%3DX"
           f"?period1=1420070400&period2=9999999999&interval=1d")
    j = json.loads(get(url))
    res = j["chart"]["result"][0]
    ts = res["timestamp"]
    cl = res["indicators"]["quote"][0]["close"]
    out = {}
    for t, c in zip(ts, cl):
        if c:
            out[date.fromtimestamp(t).isoformat()] = c
    return out


CCY_API_START = date(2024, 3, 20)   # 该源最早可用日期(实测 2024-03 起)


def from_currency_api(ccys, end):
    """fawazahmed0 currency-api: 每个日期一个请求，但一次返回全部货币。

    走 jsDelivr CDN，没有速率限制；用少量并发把 ~550 天拉完。
    返回 {ccy: {date: rate}}，取不到的日期直接跳过(周末/节假日该源无数据)。
    """
    from concurrent.futures import ThreadPoolExecutor

    days = []
    d = CCY_API_START
    end_d = date.fromisoformat(end)
    while d <= end_d:
        days.append(d.isoformat())
        d += timedelta(days=1)

    low = [c.lower() for c in ccys]
    out = {c: {} for c in ccys}

    def one(day):
        url = (f"https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{day}"
               f"/v1/currencies/usd.json")
        try:
            r = json.loads(get(url, timeout=25))["usd"]
        except Exception:
            return None
        return day, {c: r.get(lc) for c, lc in zip(ccys, low)}

    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(one, days):
            done += 1
            if done % 100 == 0:
                print(f"      ...{done}/{len(days)}")
            if not res:
                continue
            day, row = res
            for c, v in row.items():
                if v:
                    out[c][day] = v
    return out


def main():
    end = date.today().isoformat()
    need = set(CURRENCIES) - {"USD"}
    rates, missing = {"USD": {}}, []

    # --- 主源 ---
    print(f"[1/3] Frankfurter: 请求 {len(need)} 种货币 {START}..{end} ...")
    try:
        got = from_frankfurter(need, end)
        for c, series in got.items():
            if series:
                rates[c] = series
        covered = set(rates) - {"USD"}
        print(f"      拿到 {len(covered)} 种，共 {sum(len(v) for v in rates.values())} 条")
    except Exception as e:
        print(f"      失败: {type(e).__name__}: {e}")
        covered = set()

    # --- 停更检查(必须在备源之前) ---
    # 欧洲央行会停止发布某些货币(TWD 自 2020-10-30 起停更)。拿陈旧汇率换算近期涨幅
    # 会产生离谱且不易察觉的错误。这里剔除停更货币并把它们交还给备源链去补,
    # 若放到最后才检查, 停更货币就再没有机会走备源了。
    today = date.fromisoformat(end)
    for c in sorted(covered):
        last = max(rates[c])
        lag = (today - date.fromisoformat(last)).days
        if lag > STALE_DAYS:
            print(f"      ! {c} 最后更新 {last} (滞后 {lag} 天) —— 停更, 转由备源补")
            del rates[c]
            covered.discard(c)

    # --- 备源 2: Yahoo(历史长, 但机房 IP 会被限流) ---
    rest = sorted(need - covered)
    if rest:
        print(f"[2/3] Yahoo 补 {len(rest)} 种: {' '.join(rest)}")
        for c in list(rest):
            try:
                series = from_yahoo(c)
                if series:
                    rates[c] = series
                    rest.remove(c)
                    print(f"      {c}: {len(series)} 条 ({min(series)} → {max(series)})")
            except Exception as e:
                print(f"      {c}: {type(e).__name__}")
            time.sleep(0.6)
    else:
        print("[2/3] Yahoo: 无需补充")

    # --- 备源 3: currency-api(仅 2024-03 起, 兜底) ---
    if rest:
        print(f"[3/3] currency-api 兜底 {len(rest)} 种: {' '.join(rest)}"
              f"  (该源仅回溯至 {CCY_API_START})")
        try:
            got = from_currency_api(rest, end)
            for c in list(rest):
                if got.get(c):
                    rates[c] = got[c]
                    rest.remove(c)
                    print(f"      {c}: {len(got[c])} 条 "
                          f"({min(got[c])} → {max(got[c])})")
        except Exception as e:
            print(f"      失败: {type(e).__name__}: {e}")
    else:
        print("[3/3] currency-api: 无需补充")

    for c in rest:
        print(f"      ! {c} 两个备源都取不到 —— 该货币只提供本币口径")
        missing.append(c)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"base": "USD", "asof": end, "missing": sorted(missing),
                   "rates": rates}, f, separators=(",", ":"))

    size = os.path.getsize(OUT) / 1024
    print(f"\n写出 {OUT}  ({size:.0f} KB)")
    print(f"可换算货币 {len(rates)} 种；缺失 {len(missing)} 种" +
          (f": {' '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
