# -*- coding: utf-8 -*-
"""把原始日线 + 汇率算成排行榜快照，并打包出前端数据。

产出 data/app_data.json:
  meta      指数元数据(含数据源、数据日期、可用货币口径)
  windows   预置时间窗口定义
  snapshot  每个指数 × 每个窗口 × 每种货币口径的涨幅
  series    各指数本币日线(供画图与自定义区间)
  fx        汇率表(1 USD = N 本币)，裁剪到实际需要的日期范围
  anchors   预置事件锚点

口径要点:
  - 区间端点取「该日或之前最近一个交易日」的收盘价，不插值
  - 美元口径: level_usd = level_local / fx[ccy]  (fx 为 1 美元兑本币)
  - 人民币口径: level_cny = level_usd * fx[CNY]
  - 汇率同样按「该日或之前最近」对齐(汇率只在工作日发布)
  - 缺失/停更汇率的货币, 只输出本币口径, 其余为 None
"""
import json, os, sys
from bisect import bisect_right
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from indices import INDICES, GROUP_NAMES, TIER_NAMES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "raw", "idx")
FX_PATH = os.path.join(ROOT, "data", "raw", "fx.json")
OUT = os.path.join(ROOT, "data", "app_data.json")

WINDOWS = [
    ("d1",  "今日"),   ("w1", "近1周"), ("m1", "近1月"), ("m3", "近3月"),
    ("ytd", "今年以来"), ("y1", "近1年"), ("y3", "近3年"), ("y5", "近5年"),
]

ANCHORS = [
    ("2020-03-23", "疫情底"),
    ("2022-10-12", "美股熊市底"),
    ("2024-09-18", "中国行情起点"),
    ("2025-04-07", "关税冲击日"),
]


def minus_months(d, n):
    y, m = d.year, d.month - n
    while m <= 0:
        m += 12; y -= 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, day)


class Series:
    """日期 → 数值，支持「该日或之前最近一个值」查询。"""

    def __init__(self, mapping):
        self.keys = sorted(mapping)
        self.vals = [mapping[k] for k in self.keys]

    def at(self, target):
        """返回 (日期, 数值)；若目标早于全部数据则返回 (None, None)。"""
        i = bisect_right(self.keys, target) - 1
        if i < 0:
            return None, None
        return self.keys[i], self.vals[i]

    @property
    def last(self):
        return self.keys[-1], self.vals[-1]

    @property
    def first(self):
        return self.keys[0]


def main():
    fxraw = json.load(open(FX_PATH))
    fx = {c: Series(s) for c, s in fxraw["rates"].items() if s}
    fx_missing = set(fxraw["missing"])
    cny = fx.get("CNY")

    metas, snap, series_out = [], {}, {}
    used_ccy, min_date = set(), "9999"

    for m in INDICES:
        path = os.path.join(CACHE, m["code"] + ".json")
        if not os.path.exists(path):
            continue
        raw = json.load(open(path))
        s = Series(raw["data"])
        asof, last_local = s.last
        ccy = m["ccy"]

        # 该指数能否提供外币口径
        can_fx = (ccy == "USD") or (ccy in fx and cny is not None)

        def level(d, cur):
            """取 d 日(或之前最近)的点位，按 cur 口径换算。"""
            dt, v = s.at(d)
            if v is None:
                return None
            if cur == "local":
                return v
            if not can_fx:
                return None
            if ccy == "USD":
                usd = v
            else:
                _, r = fx[ccy].at(dt)
                if not r:
                    return None
                usd = v / r
            if cur == "usd":
                return usd
            _, rc = cny.at(dt)
            return usd * rc if rc else None

        asof_d = date.fromisoformat(asof)
        starts = {
            "d1":  s.keys[-2] if len(s.keys) > 1 else None,
            "w1":  (asof_d - timedelta(days=7)).isoformat(),
            "m1":  minus_months(asof_d, 1).isoformat(),
            "m3":  minus_months(asof_d, 3).isoformat(),
            "ytd": f"{asof_d.year - 1}-12-31",
            "y1":  minus_months(asof_d, 12).isoformat(),
            "y3":  minus_months(asof_d, 36).isoformat(),
            "y5":  minus_months(asof_d, 60).isoformat(),
        }

        row = {}
        for key, _label in WINDOWS:
            st = starts[key]
            row[key] = {}
            for cur in ("local", "usd", "cny"):
                # 数据起点晚于窗口起点 → 该窗口不可得，显示「—」而非拿首日充数
                if st is None or st < s.first:
                    row[key][cur] = None
                    continue
                a, b = level(st, cur), level(asof, cur)
                row[key][cur] = round((b / a - 1) * 100, 2) if a and b else None

        snap[m["code"]] = row
        series_out[m["code"]] = [[k, v] for k, v in zip(s.keys, s.vals)]
        used_ccy.add(ccy)
        min_date = min(min_date, s.first)

        metas.append({
            "code": m["code"], "name": m["name"], "country": m["country"],
            "flag": m["flag"], "group": m["group"], "tier": m.get("tier"), "ccy": ccy,
            "source": raw["source"], "asof": asof,
            "level": round(last_local, 2), "canFx": can_fx,
            "start": s.first,
            "note": m.get("note"),
        })

    # 裁剪汇率到实际用得到的范围与币种
    fx_out = {}
    for c in used_ccy | {"CNY"}:
        if c in fx:
            fx_out[c] = [[k, v] for k, v in zip(fx[c].keys, fx[c].vals) if k >= min_date]

    data = {
        "generated": date.today().isoformat(),
        "groupNames": GROUP_NAMES, "tierNames": TIER_NAMES,
        "windows": [{"key": k, "label": l} for k, l in WINDOWS],
        "anchors": [{"date": d, "label": l} for d, l in ANCHORS],
        "fxMissing": sorted(fx_missing),
        "meta": metas, "snapshot": snap, "series": series_out, "fx": fx_out,
    }
    json.dump(data, open(OUT, "w"), separators=(",", ":"), ensure_ascii=False)

    print(f"写出 {OUT}  ({os.path.getsize(OUT)/1024:.0f} KB)")
    print(f"指数 {len(metas)} 个，其中可换算外币口径 {sum(1 for m in metas if m['canFx'])} 个")
    from collections import Counter
    t = Counter(m["tier"] for m in metas if m["tier"])
    print("分层: " + "  ".join(f"{TIER_NAMES[k]} {t[k]}" for k in ("core","ext","tail") if t[k]))
    nofx = [m["name"] for m in metas if not m["canFx"]]
    if nofx:
        print(f"仅本币口径: {' '.join(nofx)}  (汇率缺失: {' '.join(sorted(fx_missing))})")


if __name__ == "__main__":
    main()
