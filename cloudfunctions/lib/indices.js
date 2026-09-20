/**
 * 指数元数据 —— 仅收录云函数实际可取到的标的。
 *
 * 东方财富对腾讯云出口 IP 返回 ECONNRESET，Yahoo 对所有机房 IP 返回 429，
 * stooq 有人机验证；因此云端可用源只剩新浪的四条线。详见 docs/STATUS.md。
 *
 * src 取值：
 *   global —— gi.finance.sina.com.cn/hq/daily（上限 1000 条，约 4 年）
 *   cn     —— money.finance.sina.com.cn A股日线（1023 条）
 *   us     —— finance.sina.com.cn/staticdata/us（私有编码，回溯至 2004）
 *   hk     —— finance.sina.com.cn/stock/hkstock（私有编码，回溯至 2013）
 *
 * tier：core 核心12国 / ext 扩展 / tail 长尾（长尾流动性低、单日跳动大，
 * 与核心市场同榜会霸占榜首榜尾，故默认不进主榜）。
 */
const INDICES = [
  // ---- 亚太 ----
  { code: "SHCOMP", name: "上证指数",      country: "中国",     flag: "🇨🇳", group: "asia", tier: "core", ccy: "CNY", src: "cn",     sym: "sh000001" },
  { code: "CSI300", name: "沪深300",       country: "中国",     flag: "🇨🇳", group: "asia", tier: "ext",  ccy: "CNY", src: "cn",     sym: "sh000300" },
  { code: "SZCOMP", name: "深证成指",      country: "中国",     flag: "🇨🇳", group: "asia", tier: "tail", ccy: "CNY", src: "cn",     sym: "sz399001" },
  { code: "CHINEXT",name: "创业板指",      country: "中国",     flag: "🇨🇳", group: "asia", tier: "tail", ccy: "CNY", src: "cn",     sym: "sz399006" },
  { code: "HSI",    name: "恒生指数",      country: "中国香港", flag: "🇭🇰", group: "asia", tier: "core", ccy: "HKD", src: "hk",     sym: "HSI" },
  { code: "HSCEI",  name: "恒生国企指数",  country: "中国香港", flag: "🇭🇰", group: "asia", tier: "ext",  ccy: "HKD", src: "hk",     sym: "HSCEI" },
  { code: "TWII",   name: "台湾加权指数",  country: "中国台湾", flag: "🇨🇳", group: "asia", tier: "core", ccy: "TWD", src: "global", sym: "TWJQ" },
  { code: "N225",   name: "日经225",       country: "日本",     flag: "🇯🇵", group: "asia", tier: "core", ccy: "JPY", src: "global", sym: "NKY" },
  { code: "KS11",   name: "韩国综合指数",  country: "韩国",     flag: "🇰🇷", group: "asia", tier: "core", ccy: "KRW", src: "global", sym: "KOSPI" },
  { code: "STI",    name: "新加坡海峡指数",country: "新加坡",   flag: "🇸🇬", group: "asia", tier: "ext",  ccy: "SGD", src: "global", sym: "STI" },
  { code: "SENSEX", name: "孟买SENSEX",    country: "印度",     flag: "🇮🇳", group: "asia", tier: "core", ccy: "INR", src: "global", sym: "SENSEX" },
  { code: "KSE100", name: "卡拉奇KSE100",  country: "巴基斯坦", flag: "🇵🇰", group: "asia", tier: "tail", ccy: "PKR", src: "global", sym: "KSE100" },
  { code: "VNINDEX",name: "胡志明指数",    country: "越南",     flag: "🇻🇳", group: "asia", tier: "ext",  ccy: "VND", src: "global", sym: "VNI" },
  { code: "JKSE",   name: "雅加达综合",    country: "印尼",     flag: "🇮🇩", group: "asia", tier: "ext",  ccy: "IDR", src: "global", sym: "JCI" },

  // ---- 欧洲 ----
  { code: "SX5E",   name: "欧洲斯托克50",  country: "欧元区",   flag: "🇪🇺", group: "europe", tier: "ext",  ccy: "EUR", src: "global", sym: "SX5E" },
  { code: "FTSE",   name: "英国富时100",   country: "英国",     flag: "🇬🇧", group: "europe", tier: "core", ccy: "GBP", src: "global", sym: "UKX" },
  { code: "GDAXI",  name: "德国DAX",       country: "德国",     flag: "🇩🇪", group: "europe", tier: "core", ccy: "EUR", src: "global", sym: "DAX" },
  { code: "FCHI",   name: "法国CAC40",     country: "法国",     flag: "🇫🇷", group: "europe", tier: "core", ccy: "EUR", src: "global", sym: "CAC" },
  { code: "SSMI",   name: "瑞士SMI",       country: "瑞士",     flag: "🇨🇭", group: "europe", tier: "ext",  ccy: "CHF", src: "global", sym: "SWI20" },
  { code: "MIB",    name: "富时MIB",       country: "意大利",   flag: "🇮🇹", group: "europe", tier: "ext",  ccy: "EUR", src: "global", sym: "FTSEMIB" },
  { code: "IBEX",   name: "西班牙IBEX35",  country: "西班牙",   flag: "🇪🇸", group: "europe", tier: "ext",  ccy: "EUR", src: "global", sym: "IBEX" },
  { code: "AEX",    name: "荷兰AEX",       country: "荷兰",     flag: "🇳🇱", group: "europe", tier: "ext",  ccy: "EUR", src: "global", sym: "AEX" },
  { code: "BFX",    name: "比利时BEL20",   country: "比利时",   flag: "🇧🇪", group: "europe", tier: "ext",  ccy: "EUR", src: "global", sym: "BEL20" },
  { code: "MOEX",   name: "莫斯科MICEX",   country: "俄罗斯",   flag: "🇷🇺", group: "europe", tier: "ext",  ccy: "RUB", src: "global", sym: "INDEXCF" },
  { code: "CASE30", name: "埃及CASE30",    country: "埃及",     flag: "🇪🇬", group: "europe", tier: "tail", ccy: "EGP", src: "global", sym: "CASE" },

  // ---- 美洲 ----
  { code: "SPX",    name: "标普500",       country: "美国",     flag: "🇺🇸", group: "americas", tier: "core", ccy: "USD", src: "us",     sym: ".INX" },
  { code: "NDX",    name: "纳斯达克100",   country: "美国",     flag: "🇺🇸", group: "americas", tier: "ext",  ccy: "USD", src: "us",     sym: ".NDX" },
  { code: "DJIA",   name: "道琼斯工业",    country: "美国",     flag: "🇺🇸", group: "americas", tier: "ext",  ccy: "USD", src: "us",     sym: ".DJI" },
  { code: "TSX",    name: "标普/TSX综合",  country: "加拿大",   flag: "🇨🇦", group: "americas", tier: "ext",  ccy: "CAD", src: "global", sym: "GSPTSE" },
  { code: "BVSP",   name: "圣保罗BOVESPA", country: "巴西",     flag: "🇧🇷", group: "americas", tier: "core", ccy: "BRL", src: "global", sym: "IBOV" },
  { code: "MXX",    name: "墨西哥BOLSA",   country: "墨西哥",   flag: "🇲🇽", group: "americas", tier: "ext",  ccy: "MXN", src: "global", sym: "MXX" },

  // ---- 大洋洲 ----
  { code: "AS51",   name: "标普/ASX200",   country: "澳大利亚", flag: "🇦🇺", group: "oceania", tier: "core", ccy: "AUD", src: "global", sym: "AS51" },
  { code: "NZ50",   name: "新西兰50",      country: "新西兰",   flag: "🇳🇿", group: "oceania", tier: "ext",  ccy: "NZD", src: "global", sym: "NZ250" },
];

const GROUP_NAMES = { asia: "亚太", europe: "欧洲", americas: "美洲", oceania: "大洋洲" };
const TIER_NAMES = { core: "核心12国", ext: "扩展", tail: "长尾" };
const CURRENCIES = [...new Set(INDICES.map((i) => i.ccy))].sort();

module.exports = { INDICES, GROUP_NAMES, TIER_NAMES, CURRENCIES };
