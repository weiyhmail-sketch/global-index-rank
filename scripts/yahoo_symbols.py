# -*- coding: utf-8 -*-
"""指数 → Yahoo Finance 符号映射。

Yahoo 覆盖全球，包括新浪/东财都拿不到的东南亚、北欧、东欧小市场，
以及此前因无源而放弃的沙特、土耳其、南非、阿根廷、以色列。

仅在 GitHub Actions（境外 runner）中使用 —— Yahoo 对境内/机房 IP 限流。
"""

# code, 中文名, 国家, 旗, 分组, tier, 本币, Yahoo 符号
YAHOO = [
    # ---- 亚太 ----
    ("SHCOMP", "上证指数",      "中国",     "🇨🇳", "asia", "core", "CNY", "000001.SS"),
    ("CSI300", "沪深300",       "中国",     "🇨🇳", "asia", "ext",  "CNY", "000300.SS"),
    ("HSI",    "恒生指数",      "中国香港", "🇭🇰", "asia", "core", "HKD", "^HSI"),
    ("HSCEI",  "恒生国企指数",  "中国香港", "🇭🇰", "asia", "ext",  "HKD", "^HSCE"),
    ("TWII",   "台湾加权指数",  "中国台湾", "🇨🇳", "asia", "core", "TWD", "^TWII"),
    ("N225",   "日经225",       "日本",     "🇯🇵", "asia", "core", "JPY", "^N225"),
    ("KS11",   "韩国综合指数",  "韩国",     "🇰🇷", "asia", "core", "KRW", "^KS11"),
    ("STI",    "新加坡海峡指数", "新加坡",  "🇸🇬", "asia", "ext",  "SGD", "^STI"),
    ("SENSEX", "孟买SENSEX",    "印度",     "🇮🇳", "asia", "core", "INR", "^BSESN"),
    ("KLSE",   "富时大马KLCI",  "马来西亚", "🇲🇾", "asia", "ext",  "MYR", "^KLSE"),
    ("SET",    "泰国SET指数",   "泰国",     "🇹🇭", "asia", "ext",  "THB", "^SET.BK"),
    ("PSI",    "菲律宾PSEi",    "菲律宾",   "🇵🇭", "asia", "tail", "PHP", "PSEI.PS"),
    ("KSE100", "卡拉奇KSE100",  "巴基斯坦", "🇵🇰", "asia", "tail", "PKR", "^KSE"),
    ("VNINDEX","胡志明指数",    "越南",     "🇻🇳", "asia", "ext",  "VND", "^VNINDEX"),
    ("JKSE",   "雅加达综合",    "印尼",     "🇮🇩", "asia", "ext",  "IDR", "^JKSE"),
    ("CSEALL", "科伦坡全指",    "斯里兰卡", "🇱🇰", "asia", "tail", "LKR", "^CSE"),

    # ---- 欧洲 ----
    ("SX5E",   "欧洲斯托克50",  "欧元区",   "🇪🇺", "europe", "ext",  "EUR", "^STOXX50E"),
    ("FTSE",   "英国富时100",   "英国",     "🇬🇧", "europe", "core", "GBP", "^FTSE"),
    ("GDAXI",  "德国DAX",       "德国",     "🇩🇪", "europe", "core", "EUR", "^GDAXI"),
    ("FCHI",   "法国CAC40",     "法国",     "🇫🇷", "europe", "core", "EUR", "^FCHI"),
    ("SSMI",   "瑞士SMI",       "瑞士",     "🇨🇭", "europe", "ext",  "CHF", "^SSMI"),
    ("MIB",    "富时MIB",       "意大利",   "🇮🇹", "europe", "ext",  "EUR", "FTSEMIB.MI"),
    ("IBEX",   "西班牙IBEX35",  "西班牙",   "🇪🇸", "europe", "ext",  "EUR", "^IBEX"),
    ("AEX",    "荷兰AEX",       "荷兰",     "🇳🇱", "europe", "ext",  "EUR", "^AEX"),
    ("BFX",    "比利时BEL20",   "比利时",   "🇧🇪", "europe", "ext",  "EUR", "^BFX"),
    ("PSI20",  "葡萄牙PSI20",   "葡萄牙",   "🇵🇹", "europe", "tail", "EUR", "PSI20.LS"),
    ("ASE",    "雅典综合指数",  "希腊",     "🇬🇷", "europe", "tail", "EUR", "GD.AT"),
    ("ATX",    "奥地利ATX",     "奥地利",   "🇦🇹", "europe", "tail", "EUR", "^ATX"),
    ("ISEQ",   "爱尔兰ISEQ",    "爱尔兰",   "🇮🇪", "europe", "tail", "EUR", "^ISEQ"),
    ("OMXC25", "哥本哈根25",    "丹麦",     "🇩🇰", "europe", "ext",  "DKK", "^OMXC25"),
    ("OMXS30", "斯德哥尔摩30",  "瑞典",     "🇸🇪", "europe", "ext",  "SEK", "^OMX"),
    ("OSEAX",  "奥斯陆全指",    "挪威",     "🇳🇴", "europe", "ext",  "NOK", "^OSEAX"),
    ("OMXH25", "赫尔辛基25",    "芬兰",     "🇫🇮", "europe", "tail", "EUR", "^OMXH25"),
    ("OMXIPI", "冰岛全指",      "冰岛",     "🇮🇸", "europe", "tail", "ISK", "^OMXIPI"),
    ("WIG20",  "华沙WIG20",     "波兰",     "🇵🇱", "europe", "ext",  "PLN", "WIG20.WA"),
    ("PX",     "布拉格PX",      "捷克",     "🇨🇿", "europe", "tail", "CZK", "^PX"),
    ("IMOEX",  "莫斯科交易所",  "俄罗斯",   "🇷🇺", "europe", "ext",  "RUB", "IMOEX.ME"),
    ("XU100",  "伊斯坦布尔100", "土耳其",   "🇹🇷", "europe", "ext",  "TRY", "^XU100"),

    # ---- 美洲 ----
    ("SPX",    "标普500",       "美国",     "🇺🇸", "americas", "core", "USD", "^GSPC"),
    ("NDX",    "纳斯达克100",   "美国",     "🇺🇸", "americas", "ext",  "USD", "^NDX"),
    ("DJIA",   "道琼斯工业",    "美国",     "🇺🇸", "americas", "ext",  "USD", "^DJI"),
    ("TSX",    "标普/TSX综合",  "加拿大",   "🇨🇦", "americas", "ext",  "CAD", "^GSPTSE"),
    ("BVSP",   "圣保罗BOVESPA", "巴西",     "🇧🇷", "americas", "core", "BRL", "^BVSP"),
    ("MXX",    "墨西哥BOLSA",   "墨西哥",   "🇲🇽", "americas", "ext",  "MXN", "^MXX"),
    ("MERV",   "布宜诺斯MERVAL","阿根廷",   "🇦🇷", "americas", "ext",  "ARS", "^MERV"),

    # ---- 中东非洲 ----
    ("TA125",  "特拉维夫125",   "以色列",   "🇮🇱", "europe", "tail", "ILS", "^TA125.TA"),
    ("J203",   "富时/JSE全股",  "南非",     "🇿🇦", "europe", "ext",  "ZAR", "^J203.JO"),
    ("TASI",   "沙特全指",      "沙特",     "🇸🇦", "europe", "ext",  "SAR", "^TASI.SR"),
    ("CASE30", "埃及CASE30",    "埃及",     "🇪🇬", "europe", "tail", "EGP", "^CASE30"),

    # ---- 大洋洲 ----
    ("AS51",   "标普/ASX200",   "澳大利亚", "🇦🇺", "oceania", "core", "AUD", "^AXJO"),
    ("NZ50",   "新西兰50",      "新西兰",   "🇳🇿", "oceania", "ext",  "NZD", "^NZ50"),
]

FIELDS = ("code", "name", "country", "flag", "group", "tier", "ccy", "yahoo")
INDICES = [dict(zip(FIELDS, row)) for row in YAHOO]

if __name__ == "__main__":
    from collections import Counter
    print(f"共 {len(INDICES)} 个指数 / {len({i['country'] for i in INDICES})} 个国家与地区")
    for k, v in Counter(i["tier"] for i in INDICES).items():
        print(f"  {k}: {v}")
    print("货币:", " ".join(sorted({i["ccy"] for i in INDICES})))
