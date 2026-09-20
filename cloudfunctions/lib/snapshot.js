/**
 * 快照计算 —— 与 scripts/build_snapshot.py 同一套口径，逐条对应移植。
 *
 *  - 区间端点取「该日或之前最近一个交易日」的收盘价，不插值
 *  - 外币换算按端点各自对应日期的汇率：level_usd = level_local / fx[ccy]
 *  - 数据起点晚于区间起点 → 返回 null，绝不拿首日数据充数
 */
// 区间起点允许向前回溯的最大自然日数。
//
// 超过则该窗口返回 null（显示「—」）。10 天覆盖了所有正常长假
// （A 股国庆 8 天、农历新年约 9 天），又能挡住数据源悄悄降级：
// 巴基斯坦 2021-2022 是月频数据，「近3年」的起点曾回溯 17 天而无人察觉。
// 不用「N 个交易日」作阈值——正是交易日序列本身不可信时才需要这道检查。
/**
 * 端点回溯上限：按指数自适应，而不是一个固定的 10 天。
 *
 * 固定 10 天误伤得比想象中广。实测 33 个指数的相邻观测间隔：
 *   中国台湾 13 天（农历新年休市最长）、中国四个指数各 11 天、印尼 11 天
 *   —— 6/33 超过 10 天，而没有一个超过 14 天。
 * 被误伤的后果不只是少一行：界面会写出「数据自 2022-08-08 起」+「近3月数据不足」，
 * 而台湾有 3.8 年连续数据，这两句话放在一起是假的。
 *
 * 自适应还比固定值更严：多数指数的最大间隔只有 5-6 天，阈值取 8 就够，
 * 比 10 更早发现「月频数据混进日频榜」这类退化。
 * 取 p99.9 而非最大值，是为了不让历史上一次性的长期停市把阈值顶到天上去；
 * 上下夹在 [8, 20] 之间，下限防过紧、上限防这道闸门被一份烂数据废掉。
 *
 * 注意：这道上限**不是**频率守卫。对月频数据，窗口起点有约 1/3 的概率
 * 正好落在离某个月频点 10 天以内，那时它照样放行。真正的频率守卫是
 * build-data.js 里的密度检查。别把这道上限当频率检查来调参。
 */
const BACKTRACK_FLOOR = 8, BACKTRACK_CEIL = 20;
function backtrackLimit(series) {
  if (series.length < 30) return BACKTRACK_CEIL;
  const gaps = [];
  for (let i = 1; i < series.length; i++)
    gaps.push(Math.round((new Date(series[i][0] + "T00:00:00Z") - new Date(series[i - 1][0] + "T00:00:00Z")) / 86400000));
  gaps.sort((a, b) => a - b);
  const p999 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.999))];
  return Math.max(BACKTRACK_FLOOR, Math.min(BACKTRACK_CEIL, p999 + 2));
}

const WINDOWS = [
  // 「今日」是事实错误的标签：各国收盘时点不同，长假后它还是跨假期的累计涨幅
  ["d1", "最近交易日"], ["w1", "近1周"], ["m1", "近1月"], ["m3", "近3月"],
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
  const { endShiftDays = 0, anchors = [], fxStale = [] } = opts;
  // 停更超过软阈值的货币：外币口径一律置空，让它走「仅原币」那一分区。
  //
  // fx.js 算出 fxStale 之后没人消费——它承诺的「诚实退回原币」在计算侧
  // 和展示侧都没实现，只产出了一个列表。这是第四个「写了防护但防护够不着」。
  // 用陈旧汇率照样能算出一个看起来正常的数，那才是最危险的形态：
  // 不报错、不标注、数值量级也对，只是错的。
  const staleCcy = new Set(fxStale.map((x) => x.ccy));
  // 空序列的货币直接剔除：留着它们会让下游每一处 at()/fxPairs[c][0] 都要判空，
  // 而 canFx 的语义本来就是「这个货币有可用汇率」。
  const fxPairs = Object.fromEntries(
    Object.entries(fxRates)
      .map(([c, s]) => [c, toPairs(s)])
      .filter(([, a]) => a.length));
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
    const maxBack = backtrackLimit(series);
    const level = makeLevelFn(series, m.ccy, fxPairs);
    // 本币或人民币任一停更，外币换算就不可信 —— 换算要两端汇率
    const canFx = (m.ccy === "USD" || !!fxPairs[m.ccy]) && !!fxPairs.CNY
      && !staleCcy.has(m.ccy) && !staleCcy.has("CNY");

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

    const row = {}, spans = {};
    for (const key of [...WINDOWS.map((w) => w[0]), ...anchors.map((a) => "anchor:" + a.date)]) {
      const st = starts[key];
      row[key] = {};

      // 端点回溯超限 → 整个窗口不可得。起点落在很久以前的一个交易日上，
      // 算出来的数字看着正常但对不上标签所承诺的区间。
      let tooFar = false;
      if (st && st >= first) {
        const pt = at(series, st);
        if (pt) {
          const back = Math.round(
            (new Date(st + "T00:00:00Z") - new Date(pt[0] + "T00:00:00Z")) / 86400000);
          if (back > maxBack) tooFar = true;
          else spans[key] = back;
        }
      }

      // 为什么不可得，要分开记。两种成因在界面上该说不同的话：
      //   short —— 该指数历史不够长，「数据自 X 起」是真话
      //   gap   —— 历史够长，只是起点落在休市期内(如农历新年)回溯超限，
      //            这时候说「数据自 X 起」就是假话
      if (!st || st < first) row[key].why = "short";
      else if (tooFar) row[key].why = "gap";
      else if (spans[key]) row[key].back = spans[key];

      for (const cur of ["local", "usd", "cny"]) {
        // 数据起点晚于窗口起点 → 不可得，显示「—」而非用首日充数
        if (!st || st < first || tooFar) { row[key][cur] = null; continue; }
        // 汇率停更：外币口径置空而不是拿陈旧汇率硬算
        if (cur !== "local" && !canFx) { row[key][cur] = null; continue; }
        const a = level(st, cur), b = level(asof, cur);
        row[key][cur] = (a && b) ? Math.round((b / a - 1) * 10000) / 100 : null;
      }
    }

    // 「最近一个交易日」实际跨了几天。长假后它是一个跨假期的累计涨幅
    // （2024-10-08 创业板的「今日」是 +17.25%），客户端需要如实标注。
    const d1Span = prevTradingDay
      ? Math.round((new Date(asof + "T00:00:00Z") - new Date(prevTradingDay + "T00:00:00Z")) / 86400000)
      : null;

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
      canFx, fxFrom, fxReason, d1Span, maxBack, note: m.note || null,
    });
  }
  // 每个窗口的典型天数与可比市场数。
  //   days  —— 客户端据此决定是否提示股息口径（按区间长度而非窗口名，
  //            否则默认的「今年以来」会漏掉提示）
  //   n     —— 可比市场数，用于「近5年（5 个市场）」这类标注；
  //            只有 2 个观测值的中位数不该和 33 个的长得一样
  const refAsof = meta.map((m) => m.asof).sort().pop() || "";
  const winMeta = [...WINDOWS.map(([key, label]) => ({ key, label })),
                   ...anchors.map((a) => ({ key: "anchor:" + a.date, label: a.label + "以来" }))];
  for (const w of winMeta) {
    const st = w.key.startsWith("anchor:") ? w.key.slice(7)
      : { d1: refAsof, w1: shiftDays(refAsof, -7), m1: minusMonths(refAsof, 1),
          m3: minusMonths(refAsof, 3), ytd: `${+refAsof.slice(0, 4) - 1}-12-31`,
          y1: minusMonths(refAsof, 12), y3: minusMonths(refAsof, 36),
          y5: minusMonths(refAsof, 60) }[w.key];
    w.days = st && refAsof
      ? Math.round((new Date(refAsof + "T00:00:00Z") - new Date(st + "T00:00:00Z")) / 86400000)
      : null;
    // 三种口径各数一份。原先只按 local 数了一个 w.n，而默认榜单是人民币口径：
    // 实测 y3 的 local 有 32 个、人民币只有 28 个。一个名字听起来通用、
    // 值却只对一种口径的字段，放在那里等着被误用。
    w.n = {};
    for (const cur of ["local", "usd", "cny"])
      w.n[cur] = Object.values(snapshot).filter((r) => r[w.key] && r[w.key][cur] !== null).length;
  }

  return { meta, snapshot, windows: winMeta.filter((w) => !w.key.startsWith("anchor:")),
           anchorMeta: winMeta.filter((w) => w.key.startsWith("anchor:")) };
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
  // fxStale 要一起传下去，否则两次快照的参与池口径不一致：
  // 主快照把停更货币的外币口径置空了，这里没置空，名次变化就会拿
  // 一个「其实不参与排名」的市场去比，算出无中生有的升降。
  const { days = 7, anchors = [], fxStale = [] } = opts;
  const now = buildSnapshot(indices, seriesByCode, fxRates, { anchors, fxStale });
  const past = buildSnapshot(indices, seriesByCode, fxRates, { anchors, endShiftDays: -days, fxStale });

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
      // 只在两次都参与排名的市场之间比名次。
      // 若某个指数的数据起点恰好跨过 3 年/5 年边界，参与池会变，
      // 所有人的名次整体平移一位，而 Δ 会把这个平移显示成真实的名次变化。
      const both = Object.keys(a).filter((c) => b[c] !== undefined);
      const rerank = (m) => {
        const rows = both.map((c) => ({ c, r: m[c] })).sort((x, y) => x.r - y.r);
        const o = {}; rows.forEach((x, i) => (o[x.c] = i + 1)); return o;
      };
      const A = rerank(a), B = rerank(b);
      for (const code of both) {
        ((out[code] ||= {})[win] ||= {})[cur] = B[code] - A[code];
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
    const maxBack = backtrackLimit(series);
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
/** ISO 周键，用于按周降采样。 */
function isoWeek(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;            // 周一为 0
  d.setUTCDate(d.getUTCDate() - day + 3);         // 移到本周四
  const y = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return y + "-" + w;
}

function buildChart(meta, series, fxPairs, opts = {}) {
  const { years = 5 } = opts;
  const pairs = toPairs(series);
  const cutoff = minusMonths(pairs[pairs.length - 1][0], years * 12);
  // 多留一个 cutoff 之前的点：预置区间的基准是「该日或之前最近一个交易日」，
  // 若文件里没有这个点，图表就只能退而用区间内第一个点，与榜单对不上。
  const firstIdx = pairs.findIndex((p) => p[0] >= cutoff);
  const rows = pairs.slice(firstIdx > 0 ? firstIdx - 1 : 0);
  const level = makeLevelFn(pairs, meta.ccy, fxPairs);

  // 近 1 年保留每日，更早改为每周采样。
  //
  // 全量 5 年约 1255 点 / 52 KB，云函数取它会超时（实测 SPX 全量 timeout，
  // 181 点 2.2 秒通过）。降采样后 5 年约 460 点，各区间都能稳过。
  // 图表是视觉呈现，周采样在这个尺度上肉眼无差别；涨幅计算另有日线口径，
  // 不受影响。界面上会注明长区间为周采样。
  const dailyFrom = minusMonths(pairs[pairs.length - 1][0], 12);
  const kept = [];
  let lastWeek = "";
  for (const r of rows) {
    if (r[0] >= dailyFrom) { kept.push(r); continue; }
    const wk = isoWeek(r[0]);
    if (wk !== lastWeek) { lastWeek = wk; kept.push(r); }
    else kept[kept.length - 1] = r;   // 同周取最后一个交易日
  }

  const out = { dates: [], local: [], usd: [], cny: [], dailyFrom };
  for (const [d] of kept) {
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

/**
 * 逐年涨幅（三种计价口径）。
 *
 * 产品评审把「分年度矩阵」判为该砍——48 行 × 10 列在手机上只能横向滚动，
 * 而横滚表格是移动端最差的交互。替代方案是详情页里单个指数的逐年竖排列表：
 * 成本十分之一，回答的却是同一个问题「这个市场哪年好哪年差」。
 *
 * 直接复用各年 12 月末的点位，不另取数据。当年为「年初至今」。
 *
 * @returns { code: [{ year, label, local, usd, cny }] }  由近及远
 */
function buildYearly(monthly, opts = {}) {
  const { years = 6 } = opts;
  const { months, levels } = monthly;
  if (!months || !months.length) return {};

  const idxOf = (mm) => months.indexOf(mm);
  const lastYear = +months[months.length - 1].slice(0, 4);
  const out = {};

  for (const [code, L] of Object.entries(levels)) {
    const rows = [];
    for (let y = lastYear; y > lastYear - years; y--) {
      const i0 = idxOf(`${y - 1}-12`);
      // 当年用最新一个月；往年用该年 12 月
      const i1 = y === lastYear ? months.length - 1 : idxOf(`${y}-12`);
      if (i0 < 0 || i1 < 0) continue;
      const r = { year: y, label: y === lastYear ? `${y} 年初至今` : `${y} 年` };
      let any = false;
      for (const cur of ["local", "usd", "cny"]) {
        const a = L[cur] && L[cur][i0], b = L[cur] && L[cur][i1];
        const v = (a && b) ? Math.round((b / a - 1) * 10000) / 100 : null;
        r[cur] = v;
        if (v !== null) any = true;
      }
      if (any) rows.push(r);
    }
    if (rows.length) out[code] = rows;
  }
  return out;
}

module.exports = { buildSnapshot, buildRankDelta, buildMonthly, buildChart, buildYearly, WINDOWS, at, toPairs, minusMonths, shiftDays };
