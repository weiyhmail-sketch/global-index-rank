# -*- coding: utf-8 -*-
"""原始日线数据质量检查。每次抓取后跑一遍。

检查项:
  1. 非正收盘价 —— 新浪在休市日会返回 0，会污染跨该日的全部区间计算
  2. 单日异常跳变 —— 可能是指数重算、拆分或脏数据
  3. 长缺口     —— 可能是抓取不全
  4. 数据新鲜度 —— 最后一个交易日距今过久
"""
import json, glob, os, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JUMP, GAP, STALE = 0.12, 10, 7


def main():
    issues = 0
    today = date.today()
    for path in sorted(glob.glob(os.path.join(ROOT, "data/raw/idx/*.json"))):
        d = json.load(open(path))
        code, data = d["code"], d["data"]
        ks = sorted(data)
        if not ks:
            print(f"[空] {code}"); issues += 1; continue

        bad = [k for k in ks if not data[k] or data[k] <= 0]
        if bad:
            print(f"[非正收盘] {code}: {len(bad)} 处，如 {bad[:3]}"); issues += len(bad)

        clean = [k for k in ks if data[k] > 0]
        for a, b in zip(clean, clean[1:]):
            r = data[b] / data[a] - 1
            if abs(r) > JUMP:
                print(f"[跳变] {code} {a}→{b}: {data[a]:,.1f}→{data[b]:,.1f} ({r*100:+.1f}%)")
                issues += 1
            n = (date.fromisoformat(b) - date.fromisoformat(a)).days
            if n > GAP:
                print(f"[缺口] {code} {a}→{b} ({n} 天)"); issues += 1

        lag = (today - date.fromisoformat(clean[-1])).days
        if lag > STALE:
            print(f"[陈旧] {code} 最后交易日 {clean[-1]}，滞后 {lag} 天"); issues += 1

    n = len(glob.glob(os.path.join(ROOT, "data/raw/idx/*.json")))
    print(f"\n检查 {n} 个指数，发现 {issues} 个问题" if issues
          else f"\n检查 {n} 个指数，全部通过")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
