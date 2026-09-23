/**
 * 排行榜主页。
 *
 * 数据来自 get-snapshot 云函数（约 40 KB），已在构建侧预计算完毕：
 * 预置窗口、事件锚点、三种计价口径、近7日名次变化全部现成，
 * 页面零计算直接渲染。
 *
 * WXML 不能做运算，所以展示用的字符串（百分比、颜色类名、条宽）
 * 都在这里算好再 setData。
 */
const { call } = require("../../utils/cloud.js");

const CURS = [
  { key: "cny", label: "人民币" },
  { key: "usd", label: "美元" },
  { key: "local", label: "原币种" },
];
const TIERS = [
  { key: "core", label: "核心12国" },
  { key: "ext", label: "核心+扩展" },
  { key: "all", label: "全部" },
];

Page({
  data: {
    loading: true,
    error: "",
    // 筛选状态
    winIdx: 0, curIdx: 0, tierIdx: 0, grpIdx: 0,
    winOptions: [], curOptions: CURS.map((c) => c.label),
    tierOptions: TIERS.map((t) => t.label), grpOptions: [],
    // 展示数据
    winChip: "", sub: "", staleNote: "", ledeHead: "", rankedCount: 0, fbRows: [], naRows: [], top: null, bottom: null, stats: "", moves: [],
    rows: [], naCount: 0, expanded: "", detail: null,
    fxNote: "", divNote: "",
    // 自定义月度区间
    isCustom: false, monthOptions: [], m0Options: [], m1Options: [],
    m0Idx: 0, m1Idx: 0, m1Sel: 0, monthlyLoading: false,
  },

  onLoad() { this.load(); },
  onPullDownRefresh() { return this.load(true); },

  async load(isPull) {
    // 下拉刷新要保留用户当前的区间选择。原先无条件把 winIdx 重置成「今年以来」
    // 却不动 isCustom：自定义模式下刷新后，筛选条写着「今年以来」，
    // 榜单和结论条却还是自定义区间的数——而且是旧的月度数据。
    const prevKey = this.wins && this.wins[this.data.winIdx] ? this.wins[this.data.winIdx].key : null;
    const prevMonths = this.monthly
      ? [this.monthly.months[this.data.m0Idx], this.monthly.months[this.data.m1Idx]] : null;
    this.setData({ loading: true, error: "" });
    try {
      const d = await call("get-snapshot");
      if (!d || !d.ok) throw new Error((d && d.error) || "数据为空");
      this.raw = d;
      this.monthly = null;   // 月度数据跟着快照一起作废，要用时重取

      // 窗口选项 = 预置窗口 + 事件锚点
      this.wins = [
        ...d.windows,
        ...(d.anchors || []).map((a) => ({ key: "anchor:" + a.date, label: a.label + "以来" })),
      ];
      this.grps = [{ key: "all", label: "全部地区" },
        ...Object.entries(d.groupNames || {}).map(([key, label]) => ({ key, label }))];

      // 用众数而非最大值作为「数据截至」基准。
      // dataAsof 取的是全体最大值，而埃及交易所是周日到周四交易，
      // 它的最新日常常比其余市场晚；若以它为基准，另外 32 行都会被
      // 标上「截至 09-18」，列表全是噪音。众数才代表大盘的口径日。
      const counts = {};
      d.meta.forEach((m) => (counts[m.asof] = (counts[m.asof] || 0) + 1));
      this.baseAsof = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? 1 : -1))[0];

      const ytd = this.wins.findIndex((w) => w.key === "ytd");
      const kept = prevKey ? this.wins.findIndex((w) => w.key === prevKey) : -1;
      const winIdx = this.data.isCustom ? this.wins.length : kept >= 0 ? kept : Math.max(0, ytd);
      this.setData({
        winOptions: this.winLabels(d, CURS[this.data.curIdx].key),
        winChip: this.chipLabel(winIdx),
        grpOptions: this.grps.map((g) => g.label),
        winIdx,
        sub: `${d.countries} 个国家与地区 · ${d.meta.length} 个指数 · 数据截至 ${this.baseAsof}`,
        // 构建侧算了新鲜度却没人读，等于白算
        staleNote: [
          d.stale || "",
          // 汇率停更同理：fx.js 算出 fxStale、传了三层，客户端零引用。
          // 现在计算侧会把停更货币的外币口径置空(走「仅原币」分区)，
          // 这里把原因说出来，否则用户只看到某些市场莫名其妙掉出了排名。
          (d.fxStale && d.fxStale.length)
            ? `${d.fxStale.map((x) => x.ccy).join("、")} 汇率已 ${Math.max(...d.fxStale.map((x) => x.lag))} 天未更新，相关市场本轮只给原币口径`
            : "",
        ].filter(Boolean).join(" · "),
        loading: false,
      });
      if (this.data.isCustom) await this.ensureMonthly(prevMonths);
      else this.render();
    } catch (e) {
      this.setData({ loading: false, error: e.message || String(e) });
    } finally {
      if (isPull) wx.stopPullDownRefresh();
    }
  },

  /** chip 上只放短名；下拉列表里才带「（N 个市场）」，否则 chip 会宽到挤爆筛选条。 */
  chipLabel(i) { return i === this.wins.length ? "自定义区间" : (this.wins[i] || {}).label || ""; },

  onWin(e) {
    const i = +e.detail.value;
    const isCustom = i === this.wins.length;   // 最后一项是「自定义月度区间…」
    if (isCustom && !this.data.isCustom) this.prevWinIdx = this.data.winIdx;
    this.setData({ winIdx: i, isCustom, expanded: "", winChip: this.chipLabel(i) });
    if (isCustom) return this.ensureMonthly();
    this.render();
  },

  /**
   * 按需加载各月末点位。
   *
   * 不并入首屏数据：它占快照六成体积，而多数用户不会打开自定义区间。
   */
  async ensureMonthly(keep) {
    if (this.monthly) return this.render();
    this.setData({ monthlyLoading: true });
    try {
      const d = await call("get-monthly");
      if (!d || !d.ok) throw new Error((d && d.error) || "月度数据为空");
      this.monthly = d;
      const n = d.months.length;
      this.setData({ monthOptions: d.months, monthlyLoading: false });
      // 刷新时沿用原先选的两个月份；首次进入则默认起点取去年末、终点取最新
      const i0 = keep ? d.months.indexOf(keep[0]) : -1;
      const i1 = keep ? d.months.indexOf(keep[1]) : -1;
      this.syncMonthPickers(
        i0 >= 0 ? i0 : Math.max(0, d.months.indexOf(String(+d.dataAsof.slice(0, 4) - 1) + "-12")),
        i1 >= 0 ? i1 : n - 1);
      this.render();
    } catch (e) {
      // 不能写全局 error：那会把整张榜单藏起来，而快照明明是好的。
      // 退回进入自定义之前的区间，榜单照常显示，只提示月度数据没取到。
      const back = Math.max(0, Math.min(this.prevWinIdx || 0, this.wins.length - 1));
      this.setData({ monthlyLoading: false, isCustom: false, winIdx: back, winChip: this.chipLabel(back) });
      this.render();
      if (wx.showToast) wx.showToast({ title: "月度数据加载失败，请稍后再试", icon: "none" });
    }
  },

  // 两个 picker 看起来对称，很容易选反。选反后 b/a-1 照样出榜，
  // 印度今年以来 -21.83% 倒过来就成了 +27.92% 的第一名。
  // 两个 picker 各有自己的 range，非法项根本不出现在列表里。
  //
  // 原先两个 picker 共用一份 monthOptions，靠 handler 事后夹紧，结果是：
  // 终点选第一项 → m0Idx = -1 → 标题渲染成「undefined 月末」+ 空榜 + 无提示；
  // 起点选最后一项 → 被 Math.min 压回去变成起止同月，而那正是上一轮要禁的情形。
  // 事后夹紧还有个毛病：用户选了 A 却跳到 B，像点错了。不给他选才是对的。
  //
  //   起点列表 = months[0 .. n-2]        （起点不能是最后一个月）
  //   终点列表 = months[m0Idx+1 .. n-1]  （终点必须晚于起点）
  // m1Idx 始终存绝对下标，m1Sel 是它在终点列表里的位置。
  syncMonthPickers(i0, i1) {
    const months = this.data.monthOptions;
    const n = months.length;
    const m0Idx = Math.max(0, Math.min(i0, n - 2));
    const m1Idx = Math.max(m0Idx + 1, Math.min(i1, n - 1));
    this.setData({
      m0Idx, m1Idx,
      m0Options: months.slice(0, n - 1),
      m1Options: months.slice(m0Idx + 1),
      m1Sel: m1Idx - m0Idx - 1,
      expanded: "",
    });
  },

  onM0(e) {
    this.syncMonthPickers(+e.detail.value, this.data.m1Idx);
    this.render();
  },
  onM1(e) {
    // 终点 picker 的下标是相对的，换算回绝对下标
    this.syncMonthPickers(this.data.m0Idx, this.data.m0Idx + 1 + (+e.detail.value));
    this.render();
  },
  /**
   * 窗口下拉的文案：可比市场数少于全池时直接标出来。
   *
   * 「近5年」只有 5 个市场可比、「疫情底以来」同理 —— 用户切过去才发现榜单
   * 从 33 行缩到 5 行，会以为出了问题。点之前就说清楚，别扭感就没了。
   * 数量按当前口径取：原币 32 个可比的窗口，人民币只有 28 个。
   */
  winLabels(d, cur) {
    const total = (d.meta || []).length;
    return [
      ...this.wins.map((w) => {
        const n = w.n && typeof w.n === "object" ? w.n[cur] : w.n;
        return (n !== undefined && n !== null && n < total) ? `${w.label}（${n} 个市场）` : w.label;
      }),
      "自定义月度区间…",
    ];
  },

  onCur(e) {
    const curIdx = +e.detail.value;
    this.setData({ curIdx, expanded: "" });
    // 换口径会改变可比市场数，下拉文案跟着更新
    if (this.raw) this.setData({ winOptions: this.winLabels(this.raw, CURS[curIdx].key) });
    this.render();
  },
  onTier(e) { this.setData({ tierIdx: +e.detail.value, expanded: "" }); this.render(); },
  onGrp(e) { this.setData({ grpIdx: +e.detail.value, expanded: "" }); this.render(); },

  render() {
    const d = this.raw;
    if (!d) return;
    // 自定义模式下 winIdx 指向选项列表末尾的「自定义…」，wins 里没有对应项
    const winMeta = this.wins[this.data.winIdx];
    const win = winMeta ? winMeta.key : "custom";
    const cur = CURS[this.data.curIdx].key;
    const tier = TIERS[this.data.tierIdx].key;
    const grp = this.grps[this.data.grpIdx].key;

    const tierOk = (m) => tier === "all" ? true : tier === "ext" ? m.tier !== "tail" : m.tier === "core";
    const pool = d.meta.filter((m) => tierOk(m) && (grp === "all" || m.group === grp));

    // 自定义区间：用两个月末点位现算，涨幅 = 终点/起点 - 1
    const custom = this.data.isCustom && this.monthly
      ? { m: this.monthly, i0: this.data.m0Idx, i1: this.data.m1Idx } : null;
    const customVal = (code, cur2) => {
      const L = custom.m.levels[code];
      if (!L || !L[cur2]) return null;
      const a = L[cur2][custom.i0], b = L[cur2][custom.i1];
      return (a === null || b === null || a === undefined || b === undefined || !a)
        ? null : (b / a - 1) * 100;
    };

    const val = (code) => {
      if (custom) {
        const v = customVal(code, cur);
        if (v !== null) return { v, fb: false, why: null };
        if (cur === "local") return { v: null, fb: false, why: "short" };
        const loc = customVal(code, "local");
        return loc !== null ? { v: loc, fb: true, why: null } : { v: null, fb: false, why: "short" };
      }
      const r = d.snapshot[code] && d.snapshot[code][win];
      if (!r) return { v: null, fb: false };
      // why 是构建侧记下的「为什么取不到」：short=历史不够长 / gap=起点落在休市期
      const why = r.why || null;
      const v = r[cur];
      if (v !== null && v !== undefined) return { v, fb: false, why };
      if (cur === "local") return { v: null, fb: false, why };
      // 原币也没有 → 是数据本身不可得；原币有而该口径没有 → 是缺汇率，走 fb 那条路
      const loc = r.local;
      return (loc !== null && loc !== undefined)
        ? { v: loc, fb: true, why }
        : { v: null, fb: false, why };
    };

    // 三分而非二分。
    //
    // 口径不完整的行(fb)绝不能与完整行一起排序：排序是跨行比较，要求同一度量，
    // 而退回的原币值是另一个量纲。更糟的是这个偏差是单边的——缺汇率的恰恰是
    // 货币在贬值的新兴市场，原币数必然偏高、必然浮到榜首。
    // 实测：修此问题前，「近3年·人民币」榜的前三名全部不是人民币。
    const all = pool.map((m) => ({ m, ...val(m.code) }));
    const ok = all.filter((r) => r.v !== null && !r.fb).sort((a, b) => b.v - a.v);
    const fb = all.filter((r) => r.v !== null && r.fb).sort((a, b) => b.v - a.v);
    const na = all.filter((r) => r.v === null);
    const max = Math.max(1, ...ok.map((r) => Math.abs(r.v)));

    const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

    const mkRows = (list, ranked) => list.map((r, i) => {
      // 自定义区间没有预计算的名次变化，不显示角标
      const dl = custom ? null : ((d.rankDelta || {})[r.m.code] || {})[win];
      const delta = dl ? dl[cur] : null;
      return {
        code: r.m.code, flag: r.m.flag, country: r.m.country, name: r.m.name,
        rank: ranked && r.v !== null ? String(i + 1) : "",
        pct: r.v === null ? "—" : fmt(r.v) + (r.fb ? " *" : ""),
        cls: r.v === null ? "na" : cls(r.v),
        barW: r.v === null ? 0 : Math.abs(r.v) / max * 50,
        barPos: r.v !== null && r.v >= 0,
        delta: (delta === null || delta === undefined || delta === 0) ? ""
          : (delta > 0 ? "↑" : "↓") + Math.abs(delta),
        deltaCls: delta > 0 ? "up" : "down",
        start: r.m.start,
        // 「数据不足」有两种成因，说同一句话会说出假话：
        //   short —— 该指数历史确实不够长，「数据自 X 起」是真话
        //   gap   —— 历史够长，只是起点落在休市期内（台湾农历新年休市 11-13 天，
        //            超过回溯上限）。这时再写「数据自 2022-08-08 起」+「近3月数据不足」
        //            就是自相矛盾——实测这两句话真的同时出现在屏幕上。
        naNote: r.why === "gap" ? "起点落在休市期内，无可比收盘价"
              // 年初几天东京、A 股还没开市，它们没有「今年以来」
              : r.why === "notyet" ? `今年尚未开市（最新 ${r.m.asof}）`
              // 被频率校验截断过的，要说清是我们剔除的，而不是源里就没有
              : r.why === "short" ? (r.m.truncNote || `数据自 ${r.m.start} 起`)
              : "",
        asofTag: (r.m.asof !== this.baseAsof ? " · 截至" + r.m.asof.slice(5) : "")
          // 长假后「最近交易日」是跨假期的累计涨幅，如实标注
          + (win === "d1" && r.m.d1Span > 4 ? ` · 跨${r.m.d1Span}天` : ""),
      };
    });

    const rows = mkRows(ok, true);
    const fbRows = mkRows(fb, false);
    const naRows = mkRows(na, false);

    // 结论条
    const line = (r) => r && {
      flag: r.m.flag, country: r.m.country,
      pct: fmt(r.v), cls: cls(r.v),
    };
    let stats = "", moves = [];
    if (ok.length) {
      const up = ok.filter((r) => r.v > 0).length;
      const down = ok.filter((r) => r.v < 0).length;
      const flat = ok.length - up - down;          // 平盘不该被算进下跌
      const sorted = ok.map((r) => r.v).slice().sort((a, b) => a - b);
      const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

      // 样本太少时不给中位数：两个观测值的中位数和 33 个的长得一样，
      // 但它不是同一种东西。改为直说有几个市场可比。
      stats = ok.length < 8
        ? `仅 ${ok.length} 个市场在本区间有可比数据`
        : `${up} 涨 ${down} 跌${flat ? ` ${flat} 平` : ""} · 中位数 ${fmt(mid)}`;
      const tail = [];
      if (fb.length) tail.push(`${fb.length} 个仅原币`);
      if (na.length) tail.push(`${na.length} 个数据不足`);
      if (tail.length) stats += " · " + tail.join(" · ");

      // 先排序再截取。写反了会永远展示榜单前段那几个最无聊的 ±1。
      moves = rows.filter((r) => r.delta)
        .sort((a, b) => Math.abs(+b.delta.slice(1)) - Math.abs(+a.delta.slice(1)))
        .slice(0, 4);
    }

    // 股息提示按区间长度判定，而不是按窗口名——按名字判会漏掉默认的
    // 「今年以来」（8.7 个月，英国按 4%/年算已是约 2.9pt 的系统性低估）。
    const winRec = custom ? null
      : (d.windows.find((w) => w.key === win)
         || (d.anchors || []).map((a) => ({ key: "anchor:" + a.date, days: a.days }))
              .find((w) => w.key === win));
    const spanDays = custom
      ? (this.data.m1Idx - this.data.m0Idx) * 30
      : (winRec && winRec.days) || 0;
    const isLong = spanDays >= 90;
    const winLabel = custom
      ? `${this.monthly.months[this.data.m0Idx]} 月末 → ${this.monthly.months[this.data.m1Idx]}`
      : (winMeta ? winMeta.label : "");

    this.setData({
      ledeHead: `${winLabel} · ${CURS[this.data.curIdx].label}口径 · ${ok.length} 个市场参与排名`,
      top: ok.length ? line(ok[0]) : null,
      bottom: ok.length > 1 ? line(ok[ok.length - 1]) : null,
      stats, moves, rows, fbRows, naRows, naCount: na.length,
      rankedCount: ok.length,
      // 说明必须紧挨着受影响的行，不能丢在 33 行之后
      fxNote: fb.length
        ? `以下 ${fb.length} 个市场在本区间无可用汇率，仅列原币涨幅，不参与排名：`
        : "",
      divNote: isLong ? "长周期未计入股息。高股息市场（英国约 4%/年、日本约 2%/年）会被系统性低估。" : "",
    });
  },

  /** 点开某行 → 展开「涨幅 = 原币 × 汇率」拆解与数据来源。 */
  onTapRow(e) {
    const code = e.currentTarget.dataset.code;
    if (this.data.expanded === code) return this.setData({ expanded: "", detail: null });

    const d = this.raw;
    // 自定义模式下 winIdx 指向选项列表末尾的「自定义…」，wins 里没有对应项
    const winMeta = this.wins[this.data.winIdx];
    const win = winMeta ? winMeta.key : "custom";
    const cur = CURS[this.data.curIdx].key;
    const m = d.meta.find((x) => x.code === code);
    let r = (d.snapshot[code] || {})[win] || {};
    if (this.data.isCustom && this.monthly) {
      const L = this.monthly.levels[code] || {};
      const i0 = this.data.m0Idx, i1 = this.data.m1Idx;
      r = {};
      for (const c of ["local", "usd", "cny"]) {
        const a = L[c] && L[c][i0], b = L[c] && L[c][i1];
        r[c] = (a && b) ? (b / a - 1) * 100 : null;
      }
    }
    const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

    let calc = null;
    if (cur !== "local" && r[cur] !== null && r[cur] !== undefined
        && r.local !== null && r.local !== undefined) {
      // 涨幅 = 原币涨幅 × 汇率变动（相乘而非相加）
      const fxPart = ((1 + r[cur] / 100) / (1 + r.local / 100) - 1) * 100;
      calc = {
        total: fmt(r[cur]), totalCls: cls(r[cur]),
        local: fmt(r.local), localCls: cls(r.local),
        fx: fmt(fxPart), fxCls: cls(fxPart),
      };
    }
    this.setData({
      expanded: code,
      detail: {
        calc,
        meta: `${m.name} · 本币 ${m.ccy} · 点位 ${m.level.toLocaleString()} · 数据 ${m.start} 起 · 源 ${m.source} · 截至 ${m.asof}`,
        // fxFrom / fxReason 由构建侧从汇率数据推导，不是手写说明，不会过期
        note: m.fxFrom
          ? (m.fxReason === "gap"
              ? `${m.ccy} 自 ${m.fxFrom} 起才有公开汇率，更早区间只有原币口径。`
              : `汇率数据自 ${m.fxFrom} 起，此前该指数只有原币口径。`)
          : (m.note || ""),
      },
    });
  },

  goAbout() { wx.navigateTo({ url: "/pages/about/about" }); },

  goDetail(e) {
    const code = e.currentTarget.dataset.code;
    const cur = ["cny", "usd", "local"][this.data.curIdx];
    wx.navigateTo({ url: `/pages/detail/detail?code=${code}&cur=${cur}` });
  },
});
