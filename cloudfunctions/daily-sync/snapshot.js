/**
 * 快照计算 —— 与 scripts/build_snapshot.py 同一套口径，逐条对应移植。
 *
 *  - 区间端点取「该日或之前最近一个交易日」的收盘价，不插值
 *  - 外币换算按端点各自对应日期的汇率：level_usd = level_local / fx[ccy]
 *  - 数据起点晚于区间起点 → 返回 null，绝不拿首日数据充数
 */
const WINDOWS = [
  ["d1", "今日"], ["w1", "近1周"], ["m1", "近1月"], ["m3", "近3月"],
  ["ytd", "今年以来"], ["y1", "近1年"], ["y3", "近3年"], ["y5", "近5年"],
];

/** 有序 [date, value] 数组上二分找「该日或之前最近」的一条。 */
function at(arr, target) {
  if (!arr || !arr.length) return null;
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= target) { r = m; lo = m + 1; } else hi = m - 1; }
  return r < 0 ? null : arr[r];
}

const toPairs = (obj) => Object.entries(obj).map(([d, v]) => [d, v]).sort((a, b) => (a[0] < b[0] ? -1 : 1));

function minusMonths(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function shiftDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * 构造一个指数的取值器，处理三种计价口径。
 *
 * 逐口径判断可得性，不要用一个 canFx 一刀切：美元指数(ccy=USD)换算美元口径
 * 不需要任何汇率，但换算人民币口径仍需要 CNY 汇率表。早期版本把两者合并，
 * 在汇率表为空时会直接崩在 at(undefined)。
 */
function makeLevelFn(series, ccy, fxPairs) {
  const hasOwn = ccy === "USD" || !!fxPairs[ccy];
  const hasCny = !!fxPairs.CNY;
  return (dateStr, cur) => {
    const pt = at(series, dateStr);
    if (!pt) return null;
    if (cur === "local") return pt[1];
    if (!hasOwn) return null;
    let usd;
    if (ccy === "USD") usd = pt[1];
    else {
      const r = at(fxPairs[ccy], pt[0]);
      if (!r) return null;
      usd = pt[1] / r[1];
    }
    if (cur === "usd") return usd;
    if (!hasCny) return null;
    const rc = at(fxPairs.CNY, pt[0]);
    return rc ? usd * rc[1] : null;
  };
}

/**
 * @param seriesByCode { code: {date: close} }
 * @param fxRates      { ccy: {date: rate} }
 * @returns { meta: [...], snapshot: {code: {win: {cur: number|null}}} }
 */
function buildSnapshot(indices, seriesByCode, fxRates) {
  const fxPairs = Object.fromEntries(Object.entries(fxRates).map(([c, s]) => [c, toPairs(s)]));
  const meta = [], snapshot = {};

  for (const m of indices) {
    const raw = seriesByCode[m.code];
    if (!raw || !Object.keys(raw).length) continue;
    const series = toPairs(raw);
    const asof = series[series.length - 1][0];
    const first = series[0][0];
    const level = makeLevelFn(series, m.ccy, fxPairs);
    const canFx = (m.ccy === "USD" || !!fxPairs[m.ccy]) && !!fxPairs.CNY;

    const prevTradingDay = series.length > 1 ? series[series.length - 2][0] : null;
    const starts = {
      d1: prevTradingDay,
      w1: shiftDays(asof, -7),
      m1: minusMonths(asof, 1),
      m3: minusMonths(asof, 3),
      ytd: `${+asof.slice(0, 4) - 1}-12-31`,
      y1: minusMonths(asof, 12),
      y3: minusMonths(asof, 36),
      y5: minusMonths(asof, 60),
    };

    const row = {};
    for (const [key] of WINDOWS) {
      const st = starts[key];
      row[key] = {};
      for (const cur of ["local", "usd", "cny"]) {
        // 数据起点晚于窗口起点 → 不可得，显示「—」而非用首日充数
        if (!st || st < first) { row[key][cur] = null; continue; }
        const a = level(st, cur), b = level(asof, cur);
        row[key][cur] = (a && b) ? Math.round((b / a - 1) * 10000) / 100 : null;
      }
    }

    snapshot[m.code] = row;
    meta.push({
      code: m.code, name: m.name, country: m.country, flag: m.flag,
      group: m.group, tier: m.tier, ccy: m.ccy, source: `sina-${m.src}`,
      asof, start: first, level: Math.round(series[series.length - 1][1] * 100) / 100,
      canFx, note: m.note || null,
    });
  }
  return { meta, snapshot, windows: WINDOWS.map(([key, label]) => ({ key, label })) };
}

module.exports = { buildSnapshot, WINDOWS, at, toPairs, minusMonths, shiftDays };
