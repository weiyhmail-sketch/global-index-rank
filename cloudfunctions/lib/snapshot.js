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
 * @param opts.endShiftDays 把所有窗口的终点整体往前挪 N 天（用于回溯算历史名次）
 * @param opts.anchors      事件锚点 [{date,label}]，各自算一档「自该日以来」
 * @returns { meta, snapshot, windows }
 */
function buildSnapshot(indices, seriesByCode, fxRates, opts = {}) {
  const { endShiftDays = 0, anchors = [] } = opts;
  const fxPairs = Object.fromEntries(Object.entries(fxRates).map(([c, s]) => [c, toPairs(s)]));
  // 汇率表整体起点：多数货币共同的最早日期
  const fxBaseline = Object.values(fxPairs).map((a) => a[0][0]).sort()[0] || "";
  const meta = [], snapshot = {};

  for (const m of indices) {
    const raw = seriesByCode[m.code];
    if (!raw || !Object.keys(raw).length) continue;
    let series = toPairs(raw);
    if (endShiftDays) {
      // 回溯模式：砍掉终点之后的数据，等价于把"今天"挪到过去某一天
      const cut = shiftDays(series[series.length - 1][0], endShiftDays);
      series = series.filter((p) => p[0] <= cut);
      if (series.length < 2) continue;
    }
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

    // 事件锚点与预置窗口同样处理，一并预计算，省得客户端再拉序列
    for (const a of anchors) starts["anchor:" + a.date] = a.date;

    const row = {};
    for (const key of [...WINDOWS.map((w) => w[0]), ...anchors.map((a) => "anchor:" + a.date)]) {
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

    // 外币口径最早可得日，从数据推导而非手写 —— 手写说明会随源的变化而过期
    // （卢布/新台币曾被注为"仅原币口径"，加了兜底源后就不准了）。
    //
    // 两种成因要分开，否则会把"汇率表整体起点"和"该货币特有缺口"混为一谈：
    //   baseline —— 汇率表本身的起点，影响所有历史更长的指数（美股、港股）
    //   gap      —— 这个货币自己缺早期数据（欧洲央行停发，只能靠兜底源）
    let fxFrom = null, fxReason = null;
    if (canFx) {
      const starts = [fxPairs.CNY[0][0]];
      if (m.ccy !== "USD") starts.push(fxPairs[m.ccy][0][0]);
      const s0 = starts.sort().pop();
      if (s0 > first) {
        fxFrom = s0;
        fxReason = s0 > fxBaseline ? "gap" : "baseline";
      }
    }

    meta.push({
      code: m.code, name: m.name, country: m.country, flag: m.flag,
      group: m.group, tier: m.tier, ccy: m.ccy, source: `sina-${m.src}`,
      asof, start: first, level: Math.round(series[series.length - 1][1] * 100) / 100,
      canFx, fxFrom, fxReason, note: m.note || null,
    });
  }
  return { meta, snapshot, windows: WINDOWS.map(([key, label]) => ({ key, label })) };
}

/**
 * 名次变化：同一套口径下，当前名次相对 N 个自然日前的变化。
 *
 * 放在构建侧算而不是客户端：客户端要自己算就得下载全部日线序列（1.18 MB），
 * 而这里只多出几百个小整数。
 *
 * 返回 { code: { win: { cur: delta|null } } }，正数表示名次上升。
 */
function buildRankDelta(indices, seriesByCode, fxRates, opts = {}) {
  const { days = 7, anchors = [] } = opts;
  const now = buildSnapshot(indices, seriesByCode, fxRates, { anchors });
  const past = buildSnapshot(indices, seriesByCode, fxRates, { anchors, endShiftDays: -days });

  const keys = [...WINDOWS.map((w) => w[0]), ...anchors.map((a) => "anchor:" + a.date)];
  const rankOf = (snap, win, cur) => {
    const rows = Object.entries(snap)
      .map(([code, r]) => ({ code, v: r[win] && r[win][cur] }))
      .filter((r) => r.v !== null && r.v !== undefined)
      .sort((a, b) => b.v - a.v);
    const m = {};
    rows.forEach((r, i) => (m[r.code] = i + 1));
    return m;
  };

  const out = {};
  for (const win of keys) {
    for (const cur of ["local", "usd", "cny"]) {
      const a = rankOf(now.snapshot, win, cur);
      const b = rankOf(past.snapshot, win, cur);
      for (const code of Object.keys(a)) {
        ((out[code] ||= {})[win] ||= {})[cur] = b[code] ? b[code] - a[code] : null;
      }
    }
  }
  return out;
}

/**
 * 各月末的点位（三种计价口径）。
 *
 * 目的是让客户端能算任意两个月之间的涨幅，而不必下载全部日线序列。
 * 这不是近似：取的是「该月末或之前最近一个交易日」的真实收盘价，
 * 与预置窗口用的是同一套取值规则，只是把可选起点限制到月粒度。
 *
 * 体积：33 指数 × 72 个月 × 3 口径 ≈ 7000 个数字，压成共享月份表 + 数组后约 70 KB。
 *
 * @returns { months: ["YYYY-MM", ...], levels: { code: { local: [], usd: [], cny: [] } } }
 */
/**
 * 保留 n 位有效数字。
 *
 * 不能用固定小数位：换算成美元后，印尼指数约 0.39、越南约 0.07，
 * 定点保留 3 位小数的相对误差可达 0.13%，足以让月末推算的涨幅
 * 与快照对不上（实测差 0.11 个百分点）。
 */
function sig(v, n) {
  if (v === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const f = Math.pow(10, n - d);
  return Math.round(v * f) / f;
}

function buildMonthly(indices, seriesByCode, fxRates, opts = {}) {
  const { years = 6 } = opts;
  const fxPairs = Object.fromEntries(Object.entries(fxRates).map(([c, s]) => [c, toPairs(s)]));

  // 全局最新日期决定月份表的右端
  let maxDate = "";
  for (const m of indices) {
    const raw = seriesByCode[m.code];
    if (!raw) continue;
    const ks = Object.keys(raw).sort();
    if (ks.length && ks[ks.length - 1] > maxDate) maxDate = ks[ks.length - 1];
  }
  if (!maxDate) return { months: [], levels: {} };

  const months = [];
  let cur = maxDate.slice(0, 7);
  for (let i = 0; i < years * 12 + 1; i++) {
    months.unshift(cur);
    const [y, mo] = cur.split("-").map(Number);
    cur = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  }
  // 每个月取该月最后一天（当月则取最新交易日）
  const cutoffs = months.map((mm) => {
    const [y, mo] = mm.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return last > maxDate ? maxDate : last;
  });

  const levels = {};
  for (const m of indices) {
    const raw = seriesByCode[m.code];
    if (!raw) continue;
    const series = toPairs(raw);
    const level = makeLevelFn(series, m.ccy, fxPairs);
    const first = series[0][0];
    const row = { local: [], usd: [], cny: [] };
    cutoffs.forEach((d) => {
      for (const cur2 of ["local", "usd", "cny"]) {
        // 数据起点之前一律为 null，不外推
        const v = d < first ? null : level(d, cur2);
        row[cur2].push(v === null || v === undefined ? null : sig(v, 8));
      }
    });
    levels[m.code] = row;
  }
  return { months, levels };
}

/**
 * 单指数的走势图数据：近 N 年日线，三种计价口径。
 *
 * 为什么不直接用 series/{code}.json：那份只有原币收盘价，
 * 而榜单可切到美元/人民币口径，图和榜单口径不一致说不通。
 * 客户端又拿不到汇率表（gzip 254 KB，云函数取它必超时），
 * 所以换算只能在构建侧做完。
 *
 * 体积控制：日期只存一份，三个口径各一个数值数组；近 5 年约 50 KB/指数。
 *
 * @returns { dates: [...], local: [...], usd: [...], cny: [...] }
 */
function buildChart(meta, series, fxPairs, opts = {}) {
  const { years = 5 } = opts;
  const pairs = toPairs(series);
  const cutoff = minusMonths(pairs[pairs.length - 1][0], years * 12);
  const rows = pairs.filter((p) => p[0] >= cutoff);
  const level = makeLevelFn(pairs, meta.ccy, fxPairs);

  const out = { dates: [], local: [], usd: [], cny: [] };
  for (const [d] of rows) {
    out.dates.push(d);
    for (const cur of ["local", "usd", "cny"]) {
      const v = level(d, cur);
      out[cur].push(v === null || v === undefined ? null : sig(v, 8));
    }
  }
  // 整列为空的口径直接丢掉，省体积也让客户端好判断
  for (const cur of ["usd", "cny"]) {
    if (out[cur].every((v) => v === null)) delete out[cur];
  }
  return out;
}

module.exports = { buildSnapshot, buildRankDelta, buildMonthly, buildChart, WINDOWS, at, toPairs, minusMonths, shiftDays };
