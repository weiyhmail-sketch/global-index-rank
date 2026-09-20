/**
 * 汇率，统一口径为「1 美元 = N 本币」。
 *
 * 源链：
 *   1. Frankfurter（欧洲央行）—— 覆盖多数货币，可回溯至 1999
 *   2. currency-api via jsDelivr —— 补欧洲央行不发布的币种，仅回溯至 2024-03
 *
 * 停更检查必须在备源之前：欧洲央行自 2020-10-30 起停发新台币汇率，
 * 若不剔除，拿六年前的汇率换算今年涨幅会得到离谱且不易察觉的错误。
 */
const { get, retry } = require("./http");

const START = "2015-01-01";
const STALE_DAYS = 30;        // 超过则判定主源停更，整个剔除
const SOFT_STALE_DAYS = 7;    // 超过则标记为陈旧，界面退回原币口径
const CCY_API_START = "2024-03-20";

const iso = (d) => d.toISOString().slice(0, 10);
const shiftDays = (isoDate, n) => {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const END_EQ = (end) => shiftDays(end, -7);

const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

async function fromFrankfurter(ccys, end, from = START) {
  const url = `https://api.frankfurter.dev/v1/${from}..${end}?base=USD&symbols=${[...ccys].sort().join(",")}`;
  const data = JSON.parse(await get(url, { timeout: 60000 })).rates;
  const out = {};
  for (const [d, row] of Object.entries(data)) {
    for (const [c, v] of Object.entries(row)) (out[c] ||= {})[d] = v;
  }
  return out;
}

/** currency-api 每个日期一个请求，但一次返回全部币种；走 CDN，用并发拉完。 */
async function fromCurrencyApi(ccys, end, concurrency = 10, from = CCY_API_START) {
  const days = [];
  for (let d = new Date(from + "T00:00:00Z"); iso(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(iso(d));
  }
  const low = ccys.map((c) => c.toLowerCase());
  const out = Object.fromEntries(ccys.map((c) => [c, {}]));
  for (let i = 0; i < days.length; i += concurrency) {
    await Promise.all(days.slice(i, i + concurrency).map(async (day) => {
      try {
        const r = JSON.parse(await get(
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.json`,
          { timeout: 15000 })).usd;
        ccys.forEach((c, k) => { if (r[low[k]]) out[c][day] = r[low[k]]; });
      } catch (e) { /* 周末与节假日该源无数据，跳过 */ }
    }));
  }
  return out;
}

/**
 * 返回 { rates: {ccy: {date: rate}}, missing: [ccy] }。USD 恒为 1，不入表。
 *
 * @param prev 库里已有的 rates。传入后只补增量 —— 这一步是必须的：
 *   兜底源按日期逐天请求，全量回补一次要 110 秒、900 次 CDN 请求，
 *   每天重跑既慢又是纯浪费。增量后日常只需几秒。
 */
async function fetchFX(currencies, end, prev = null) {
  const need = new Set(currencies.filter((c) => c !== "USD"));
  const rates = {};
  const missing = [];

  // 已有数据先继承下来，后面只补缺口
  let fromDate = START;
  if (prev && Object.keys(prev).length) {
    // 只继承当前指数池真正用得到的币种：无条件全盘继承会让废弃币种
    // 永久滞留（实测 30 种里 10 种无人使用、文件白胖 40%），
    // 而且它们会参与决定 fxBaseline，进而影响 fxReason 的判定。
    for (const [c, s] of Object.entries(prev)) {
      if (need.has(c) && s && Object.keys(s).length) rates[c] = { ...s };
    }
    const lasts = Object.values(rates).map((s) => Object.keys(s).sort().pop()).filter(Boolean);
    if (lasts.length) {
      // 从最早的那个"最后日期"往前一周开始补，容忍各币种进度不齐
      const earliest = lasts.sort()[0];
      fromDate = daysBetween(earliest, end) > 0 ? shiftDays(earliest, -7) : END_EQ(end);
    }
  }

  try {
    const got = await retry(() => fromFrankfurter(need, end, fromDate), 2);
    for (const [c, s] of Object.entries(got)) {
      if (s && Object.keys(s).length) rates[c] = { ...(rates[c] || {}), ...s };
    }
  } catch (e) { /* 主源整体失败则沿用已有 + 交给备源 */ }

  // 停更检查（必须在备源之前）
  for (const c of Object.keys(rates)) {
    const last = Object.keys(rates[c]).sort().pop();
    if (daysBetween(last, end) > STALE_DAYS) delete rates[c];
  }

  // 交给备源的两类：
  //   fresh   —— 完全没有数据，从 currency-api 起点全量回补
  //   partial —— 有数据但主源推不动它（欧洲央行不发布这些币种），只补增量
  //
  // partial 这条以前算出来却从未被引用，后果是 TWD/VND/PKR/EGP/RUB
  // 在首次构建后再也不更新，直到 30 天后被停更检查整个删掉、
  // 触发一次 950 次请求的全量回补，然后循环。期间界面用的是最多 30 天前的
  // 终点汇率配正确的起点汇率，canFx 仍为 true，没有任何提示。
  const fresh = [...need].filter((c) => !rates[c] || !Object.keys(rates[c]).length);
  const partial = [...need].filter((c) => rates[c] && Object.keys(rates[c]).length
    && daysBetween(Object.keys(rates[c]).sort().pop(), end) > 1);

  const toBackfill = [...fresh, ...partial];
  if (toBackfill.length) {
    // 一次拉到最早的那个缺口起点，再按币种合并；partial 只有几天的量
    const froms = toBackfill.map((c) => fresh.includes(c)
      ? CCY_API_START
      : shiftDays(Object.keys(rates[c]).sort().pop(), -3));
    const from = froms.sort()[0];
    try {
      const got = await fromCurrencyApi(toBackfill, end, 10, from);
      for (const c of toBackfill) {
        if (got[c] && Object.keys(got[c]).length) {
          rates[c] = { ...(rates[c] || {}), ...got[c] };
        } else if (fresh.includes(c)) {
          missing.push(c);
        }
      }
    } catch (e) { missing.push(...fresh); }
  }

  // A2 的配套：即使增量再断一次，也要让界面诚实地退回原币而不是
  // 拿陈旧汇率算出一个看起来正常的数。>7 天打标记，>30 天才整个删除。
  const fxStale = [];
  for (const c of Object.keys(rates)) {
    const lag = daysBetween(Object.keys(rates[c]).sort().pop(), end);
    if (lag > SOFT_STALE_DAYS) fxStale.push({ ccy: c, lag });
  }
  return { rates, missing: [...new Set(missing)].sort(), fxStale };
}

module.exports = { fetchFX };
