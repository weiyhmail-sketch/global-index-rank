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
    sub: "", ledeHead: "", top: null, bottom: null, stats: "", moves: [],
    rows: [], naCount: 0, expanded: "", detail: null,
    fxNote: "", divNote: "",
    // 自定义月度区间
    isCustom: false, monthOptions: [], m0Idx: 0, m1Idx: 0, monthlyLoading: false,
  },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load(true); },

  async load(isPull) {
    this.setData({ loading: true, error: "" });
    try {
      const d = await call("get-snapshot");
      if (!d || !d.ok) throw new Error((d && d.error) || "数据为空");
      this.raw = d;

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
      this.setData({
        winOptions: [...this.wins.map((w) => w.label), "自定义月度区间…"],
        grpOptions: this.grps.map((g) => g.label),
        winIdx: ytd < 0 ? 0 : ytd,
        sub: `${d.countries} 个国家与地区 · ${d.meta.length} 个指数 · 数据截至 ${this.baseAsof}`,
        loading: false,
      });
      this.render();
    } catch (e) {
      this.setData({ loading: false, error: e.message || String(e) });
    } finally {
      if (isPull) wx.stopPullDownRefresh();
    }
  },

  onWin(e) {
    const i = +e.detail.value;
    const isCustom = i === this.wins.length;   // 最后一项是「自定义月度区间…」
    this.setData({ winIdx: i, isCustom, expanded: "" });
    if (isCustom) return this.ensureMonthly();
    this.render();
  },

  /**
   * 按需加载各月末点位。
   *
   * 不并入首屏数据：它占快照六成体积，而多数用户不会打开自定义区间。
   */
  async ensureMonthly() {
    if (this.monthly) return this.render();
    this.setData({ monthlyLoading: true });
    try {
      const d = await call("get-monthly");
      if (!d || !d.ok) throw new Error((d && d.error) || "月度数据为空");
      this.monthly = d;
      const n = d.months.length;
      this.setData({
        monthOptions: d.months,
        // 默认起点取去年末，终点取最新
        m0Idx: Math.max(0, d.months.indexOf(String(+d.dataAsof.slice(0, 4) - 1) + "-12")),
        m1Idx: n - 1,
        monthlyLoading: false,
      });
      this.render();
    } catch (e) {
      this.setData({ monthlyLoading: false, error: e.message || String(e) });
    }
  },

  onM0(e) { this.setData({ m0Idx: +e.detail.value, expanded: "" }); this.render(); },
  onM1(e) { this.setData({ m1Idx: +e.detail.value, expanded: "" }); this.render(); },
  onCur(e) { this.setData({ curIdx: +e.detail.value, expanded: "" }); this.render(); },
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
        if (v !== null) return { v, fb: false };
        if (cur === "local") return { v: null, fb: false };
        const loc = customVal(code, "local");
        return loc !== null ? { v: loc, fb: true } : { v: null, fb: false };
      }
      const r = d.snapshot[code] && d.snapshot[code][win];
      if (!r) return { v: null, fb: false };
      const v = r[cur];
      if (v !== null && v !== undefined) return { v, fb: false };
      if (cur === "local") return { v: null, fb: false };
      // 该口径无汇率时退回原币值参与排名并标注，不让市场凭空消失
      const loc = r.local;
      return (loc !== null && loc !== undefined) ? { v: loc, fb: true } : { v: null, fb: false };
    };

    const all = pool.map((m) => ({ m, ...val(m.code) }));
    const ok = all.filter((r) => r.v !== null).sort((a, b) => b.v - a.v);
    const na = all.filter((r) => r.v === null);
    const max = Math.max(1, ...ok.map((r) => Math.abs(r.v)));

    const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

    const rows = ok.concat(na).map((r, i) => {
      // 自定义区间没有预计算的名次变化，不显示角标
      const dl = custom ? null : ((d.rankDelta || {})[r.m.code] || {})[win];
      const delta = dl ? dl[cur] : null;
      return {
        code: r.m.code, flag: r.m.flag, country: r.m.country, name: r.m.name,
        rank: r.v === null ? "" : String(i + 1),
        pct: r.v === null ? "—" : fmt(r.v) + (r.fb ? " *" : ""),
        cls: r.v === null ? "na" : cls(r.v),
        barW: r.v === null ? 0 : Math.abs(r.v) / max * 50,
        barPos: r.v !== null && r.v >= 0,
        delta: (delta === null || delta === undefined || delta === 0) ? ""
          : (delta > 0 ? "↑" : "↓") + Math.abs(delta),
        deltaCls: delta > 0 ? "up" : "down",
        asofTag: r.m.asof !== this.baseAsof ? " · 截至" + r.m.asof.slice(5) : "",
      };
    });

    // 结论条
    const line = (r) => r && {
      flag: r.m.flag, country: r.m.country,
      pct: fmt(r.v), cls: cls(r.v),
    };
    let stats = "", moves = [];
    if (ok.length) {
      const up = ok.filter((r) => r.v > 0).length;
      const sorted = ok.map((r) => r.v).slice().sort((a, b) => a - b);
      const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      stats = `${up} 涨 ${ok.length - up} 跌 · 中位数 ${fmt(mid)}`
        + (na.length ? ` · ${na.length} 个数据不足` : "");
      moves = rows.filter((r) => r.delta).slice(0, 4)
        .sort((a, b) => Math.abs(+b.delta.slice(1)) - Math.abs(+a.delta.slice(1))).slice(0, 4);
    }

    const fbNames = all.filter((r) => r.fb).map((r) => r.m.name);
    const isLong = custom
      ? (this.monthly.months[this.data.m1Idx].slice(0, 4) !== this.monthly.months[this.data.m0Idx].slice(0, 4))
      : (["y1", "y3", "y5"].includes(win) || win.startsWith("anchor:"));
    const winLabel = custom
      ? `${this.monthly.months[this.data.m0Idx]} 月末 → ${this.monthly.months[this.data.m1Idx]}`
      : (winMeta ? winMeta.label : "");

    this.setData({
      ledeHead: `${winLabel} · ${CURS[this.data.curIdx].label}口径`,
      top: ok.length ? line(ok[0]) : null,
      bottom: ok.length > 1 ? line(ok[ok.length - 1]) : null,
      stats, moves, rows, naCount: na.length,
      fxNote: fbNames.length ? `${fbNames.join("、")}：该区间无可用汇率，表中为原币涨幅（标 *），仍参与排名。` : "",
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
