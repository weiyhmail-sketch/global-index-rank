/**
 * 四条新浪取数线。统一返回 { "YYYY-MM-DD": close }，且只保留正数收盘价。
 *
 * 剔除非正值是必须的：新浪在休市日会返回 c="0"，
 * 而 "0" 在 JS/Python 里都是真值，漏掉这一步会污染跨该日的所有区间计算。
 */
const { get, retry } = require("./http");
const decodeUS = require("./sina-decode-us").decode;
const decodeHK = require("./sina-decode-hk").decode;

const SINA_REF = "https://finance.sina.com.cn";

function fromRows(rows, dateKey, closeKey) {
  const out = {};
  for (const r of rows) {
    const v = Number(r[closeKey]);
    if (Number.isFinite(v) && v > 0) out[String(r[dateKey]).slice(0, 10)] = v;
  }
  return out;
}

/** 环球市场（约 24 个市场，上限 1000 条）。 */
async function global_(sym) {
  const body = await get(`https://gi.finance.sina.com.cn/hq/daily?symbol=${sym}&num=10000`,
    { referer: SINA_REF });
  const rows = (JSON.parse(body).result || {}).data;
  if (!rows || !rows.length) throw new Error("环球接口返回空");
  return fromRows(rows, "d", "c");
}

/** A 股日线。返回体里的引号被转义过，需先还原再解析。 */
async function cn(sym) {
  const body = await get(
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
    `CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=1023`,
    { referer: SINA_REF });
  const rows = JSON.parse(body.replace(/\\"/g, '"'));
  if (!rows.length) throw new Error("A股接口返回空");
  return fromRows(rows, "day", "close");
}

/** 美股指数：私有 K 线编码，用新浪自家的 JS 解码器还原（回溯至 2004）。 */
async function us(sym) {
  const body = await get(`https://finance.sina.com.cn/staticdata/us/${sym}`,
    { referer: "https://stock.finance.sina.com.cn" });
  const raw = body.split("=")[1].split(";")[0].replace(/"/g, "");
  const rows = decodeUS(raw);
  if (!rows || !rows.length) throw new Error("美股解码为空");
  return fromRows(rows.map((r) => ({ d: r.date.toISOString().slice(0, 10), c: r.close })), "d", "c");
}

/** 港股指数：同上（回溯至 2013）。 */
async function hk(sym) {
  const body = await get(
    `https://finance.sina.com.cn/stock/hkstock/${sym}/klc2_kl.js?d=2023_5_01`,
    { referer: "https://stock.finance.sina.com.cn" });
  const raw = body.split("=")[1].split(";")[0].replace(/"/g, "");
  const rows = decodeHK(raw);
  if (!rows || !rows.length) throw new Error("港股解码为空");
  return fromRows(rows.map((r) => ({ d: r.date.toISOString().slice(0, 10), c: r.close })), "d", "c");
}

const BY_SRC = { global: global_, cn, us, hk };

/** 按元数据里的 src 取数，带重试。 */
async function fetchIndex(meta) {
  const fn = BY_SRC[meta.src];
  if (!fn) throw new Error(`未知数据源 ${meta.src}`);
  return retry(() => fn(meta.sym));
}

module.exports = { fetchIndex, BY_SRC };
