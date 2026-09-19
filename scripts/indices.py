# -*- coding: utf-8 -*-
"""全球主权股指元数据表。

字段说明:
  code     内部唯一键
  name     中文名
  country  国家/地区
  flag     emoji 国旗
  group    地域分组: asia / europe / americas / oceania / bench
  tier     榜单层级(bench 组无此字段):
             core —— 核心 12 国, 首屏默认只排这些
             ext  —— 扩展, 切到"全部"时出现
             tail —— 长尾。流动性低、单日跳动大, 若与核心市场同榜会系统性
                     霸占榜首榜尾, 让榜单看起来像噪音而不是信号, 故不进主榜
  ccy      指数计价货币(本币)。用于换算美元/人民币口径。
  em       东财 secid (market.code)，主源
  sina     新浪环球市场 gi.finance.sina.com.cn 的 symbol；None 表示该源无此指数
  cn/us/hk 新浪的 A股 / 美股 / 港股专用接口符号(可选)。这几条专源历史更长
           (美股回溯至 2004 年)，且境外 IP 也能访问，故在源链中优先于东财
  note     口径备注，会在详情页展示

bench 组不参与涨幅排名，仅作参考基准单独展示。
"""

INDICES = [
    # ---------------- 亚太 ----------------
    dict(code="SHCOMP", name="上证指数",     country="中国",     flag="🇨🇳", tier="core", group="asia", ccy="CNY", em="1.000001",   sina=None, cn="sh000001"),
    dict(code="CSI300", name="沪深300",      country="中国",     flag="🇨🇳", tier="ext", group="asia", ccy="CNY", em="1.000300",   sina=None, cn="sh000300"),
    dict(code="HSI",    name="恒生指数",     country="中国香港", flag="🇭🇰", tier="core", group="asia", ccy="HKD", em="100.HSI",    sina=None, hk="HSI"),
    dict(code="HSCEI",  name="恒生国企指数", country="中国香港", flag="🇭🇰", tier="ext", group="asia", ccy="HKD", em="100.HSCEI",  sina=None, hk="HSCEI"),
    dict(code="TWII",   name="台湾加权指数", country="中国台湾", flag="🇨🇳", tier="core", group="asia", ccy="TWD", em="100.TWII",   sina="TWJQ"),
    dict(code="N225",   name="日经225",      country="日本",     flag="🇯🇵", tier="core", group="asia", ccy="JPY", em="100.N225",   sina="NKY"),
    dict(code="KS11",   name="韩国综合指数", country="韩国",     flag="🇰🇷", tier="core", group="asia", ccy="KRW", em="100.KS11",   sina="KOSPI"),
    dict(code="STI",    name="新加坡海峡指数", country="新加坡", flag="🇸🇬", tier="ext", group="asia", ccy="SGD", em="100.STI",    sina=None),
    dict(code="SENSEX", name="孟买SENSEX",   country="印度",     flag="🇮🇳", tier="core", group="asia", ccy="INR", em="100.SENSEX", sina="SENSEX"),
    dict(code="KLSE",   name="富时大马KLCI", country="马来西亚", flag="🇲🇾", tier="ext", group="asia", ccy="MYR", em="100.KLSE",   sina=None),
    dict(code="SET",    name="泰国SET指数",  country="泰国",     flag="🇹🇭", tier="ext", group="asia", ccy="THB", em="100.SET",    sina=None),
    dict(code="PSI",    name="菲律宾马尼拉", country="菲律宾",   flag="🇵🇭", tier="tail", group="asia", ccy="PHP", em="100.PSI",    sina=None),
    dict(code="KSE100", name="卡拉奇KSE100", country="巴基斯坦", flag="🇵🇰", tier="tail", group="asia", ccy="PKR", em="100.KSE100", sina=None),
    dict(code="VNINDEX",name="胡志明指数",   country="越南",     flag="🇻🇳", tier="ext", group="asia", ccy="VND", em="100.VNINDEX",sina=None),
    dict(code="JKSE",   name="雅加达综合",   country="印尼",     flag="🇮🇩", tier="ext", group="asia", ccy="IDR", em="100.JKSE",   sina="JCI"),
    dict(code="CSEALL", name="科伦坡全指",   country="斯里兰卡", flag="🇱🇰", tier="tail", group="asia", ccy="LKR", em="100.CSEALL", sina=None),

    # ---------------- 欧洲 ----------------
    dict(code="SX5E",   name="欧洲斯托克50", country="欧元区",   flag="🇪🇺", tier="ext", group="europe", ccy="EUR", em="100.SX5E",   sina="SX5E"),
    dict(code="FTSE",   name="英国富时100",  country="英国",     flag="🇬🇧", tier="core", group="europe", ccy="GBP", em="100.FTSE",   sina="UKX"),
    dict(code="GDAXI",  name="德国DAX",      country="德国",     flag="🇩🇪", tier="core", group="europe", ccy="EUR", em="100.GDAXI",  sina="DAX"),
    dict(code="FCHI",   name="法国CAC40",    country="法国",     flag="🇫🇷", tier="core", group="europe", ccy="EUR", em="100.FCHI",   sina="CAC"),
    dict(code="SSMI",   name="瑞士SMI",      country="瑞士",     flag="🇨🇭", tier="ext", group="europe", ccy="CHF", em="100.SSMI",   sina="SWI20"),
    dict(code="MIB",    name="富时MIB",      country="意大利",   flag="🇮🇹", tier="ext", group="europe", ccy="EUR", em="100.MIB",    sina="FTSEMIB"),
    dict(code="IBEX",   name="西班牙IBEX35", country="西班牙",   flag="🇪🇸", tier="ext", group="europe", ccy="EUR", em="100.IBEX",   sina="IBEX"),
    dict(code="AEX",    name="荷兰AEX",      country="荷兰",     flag="🇳🇱", tier="ext", group="europe", ccy="EUR", em="100.AEX",    sina="AEX"),
    dict(code="BFX",    name="比利时BEL20",  country="比利时",   flag="🇧🇪", tier="ext", group="europe", ccy="EUR", em="100.BFX",    sina=None),
    dict(code="PSI20",  name="葡萄牙PSI20",  country="葡萄牙",   flag="🇵🇹", tier="tail", group="europe", ccy="EUR", em="100.PSI20",  sina=None),
    dict(code="ASE",    name="雅典综合指数", country="希腊",     flag="🇬🇷", tier="tail", group="europe", ccy="EUR", em="100.ASE",    sina=None),
    dict(code="ATX",    name="奥地利ATX",    country="奥地利",   flag="🇦🇹", tier="ext", group="europe", ccy="EUR", em="100.ATX",    sina=None),
    dict(code="ISEQ",   name="爱尔兰ISEQ",   country="爱尔兰",   flag="🇮🇪", tier="tail", group="europe", ccy="EUR", em="100.ISEQ",   sina=None),
    dict(code="OMXC20", name="哥本哈根20",   country="丹麦",     flag="🇩🇰", tier="ext", group="europe", ccy="DKK", em="100.OMXC20", sina=None),
    dict(code="OMXSPI", name="斯德哥尔摩全指",country="瑞典",    flag="🇸🇪", tier="ext", group="europe", ccy="SEK", em="100.OMXSPI", sina=None),
    dict(code="OSEBX",  name="奥斯陆全指",   country="挪威",     flag="🇳🇴", tier="ext", group="europe", ccy="NOK", em="100.OSEBX",  sina=None),
    dict(code="HEX",    name="赫尔辛基全指", country="芬兰",     flag="🇫🇮", tier="ext", group="europe", ccy="EUR", em="100.HEX",    sina=None),
    dict(code="ICEXI",  name="冰岛全指",     country="冰岛",     flag="🇮🇸", tier="tail", group="europe", ccy="ISK", em="100.ICEXI",  sina=None),
    dict(code="WIG",    name="华沙WIG",      country="波兰",     flag="🇵🇱", tier="ext", group="europe", ccy="PLN", em="100.WIG",    sina=None),
    dict(code="PX",     name="布拉格PX",     country="捷克",     flag="🇨🇿", tier="tail", group="europe", ccy="CZK", em="100.PX",     sina=None),
    dict(code="RTS",    name="俄罗斯RTS",    country="俄罗斯",   flag="🇷🇺", tier="ext", group="europe", ccy="USD", em="100.RTS",    sina=None,
         note="RTS 本身以美元计价，故三种货币口径下数值一致。卢布计价的 MOEX 指数因 2022 年后 ECB 停止发布卢布汇率而未纳入。"),

    # ---------------- 美洲 ----------------
    dict(code="SPX",    name="标普500",      country="美国",     flag="🇺🇸", tier="core", group="americas", ccy="USD", em="100.SPX",  sina=None, us=".INX"),
    dict(code="NDX",    name="纳斯达克100",  country="美国",     flag="🇺🇸", tier="ext", group="americas", ccy="USD", em="100.NDX",  sina=None, us=".NDX"),
    dict(code="DJIA",   name="道琼斯工业",   country="美国",     flag="🇺🇸", tier="ext", group="americas", ccy="USD", em="100.DJIA", sina=None, us=".DJI"),
    dict(code="TSX",    name="标普/TSX综合", country="加拿大",   flag="🇨🇦", tier="ext", group="americas", ccy="CAD", em="100.TSX",  sina="GSPTSE"),
    dict(code="BVSP",   name="圣保罗BOVESPA",country="巴西",     flag="🇧🇷", tier="core", group="americas", ccy="BRL", em="100.BVSP", sina="IBOV"),
    dict(code="MXX",    name="墨西哥BOLSA",  country="墨西哥",   flag="🇲🇽", tier="ext", group="americas", ccy="MXN", em="100.MXX",  sina="MXX"),

    # ---------------- 大洋洲 ----------------
    dict(code="AS51",   name="标普/ASX200",  country="澳大利亚", flag="🇦🇺", tier="core", group="oceania", ccy="AUD", em="100.AS51", sina="AS51"),
    dict(code="NZ50",   name="新西兰50",     country="新西兰",   flag="🇳🇿", tier="ext", group="oceania", ccy="NZD", em="100.NZ50", sina="NZ250"),

    # ---------------- 参考基准(不参与排名) ----------------
    dict(code="UDI",    name="美元指数",     country="—", flag="💵", group="bench", ccy="USD", em="100.UDI", sina=None),
    dict(code="CRB",    name="CRB商品指数",  country="—", flag="🛢️", group="bench", ccy="USD", em="100.CRB", sina=None),
    dict(code="BDI",    name="波罗的海干散货",country="—", flag="🚢", group="bench", ccy="USD", em="100.BDI", sina=None),
]

BY_CODE = {i["code"]: i for i in INDICES}

GROUP_NAMES = {
    "asia": "亚太", "europe": "欧洲", "americas": "美洲",
    "oceania": "大洋洲", "bench": "参考基准",
}

# 参与排名的指数(排除 bench)
RANKED = [i for i in INDICES if i["group"] != "bench"]

TIER_NAMES = {"core": "核心12国", "ext": "扩展", "tail": "长尾"}
CORE = [i for i in RANKED if i["tier"] == "core"]

# 需要的全部本币
CURRENCIES = sorted({i["ccy"] for i in INDICES})

if __name__ == "__main__":
    from collections import Counter
    c = Counter(i["group"] for i in INDICES)
    print(f"共 {len(INDICES)} 个指数，其中参与排名 {len(RANKED)} 个")
    for g, n in c.items():
        print(f"  {GROUP_NAMES[g]:<6} {n}")
    print(f"涉及货币 {len(CURRENCIES)} 种: {' '.join(CURRENCIES)}")
    print(f"有新浪备源的: {sum(1 for i in INDICES if i['sina'])} 个")
    t = Counter(i["tier"] for i in RANKED)
    print("分层: " + "  ".join(f"{TIER_NAMES[k]} {t[k]}" for k in ("core", "ext", "tail")))
    print("  核心12: " + " ".join(i["country"] for i in CORE))
