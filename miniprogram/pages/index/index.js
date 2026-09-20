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
  },

  onLoad() { this.load(); },
  onPullDownRefresh() { this.load(true); },

  async load(isPull) {
    this.setData({ loading: true, error: "" });
    try {
      const res = await wx.cloud.callFunction({ name: "get-snapshot" });
      const d = res.result;
      if (!d || !d.ok) throw new Error((d && d.error) || "数据为空");
      this.raw = d;

      // 窗口选项 = 预置窗口 + 事件锚点
      this.wins = [
        ...d.windows,
        ...(d.anchors || []).map((a) => ({ key: "anchor:" + a.date, label: a.label + "以来" })),
      ];
      this.grps = [{ key: "all", label: "全部地区" },
        ...Object.entries(d.groupNames || {}).map(([key, label]) => ({ key, label }))];

      const ytd = this.wins.findIndex((w) => w.key === "ytd");
      this.setData({
        winOptions: this.wins.map((w) => w.label),
        grpOptions: this.grps.map((g) => g.label),
        winIdx: ytd < 0 ? 0 : ytd,
        sub: `${d.countries} 个国家与地区 · ${d.meta.length} 个指数 · 数据截至 ${d.dataAsof}`,
        loading: false,
      });
      this.render();
    } catch (e) {
      this.setData({ loading: false, error: e.message || String(e) });
    } finally {
      if (isPull) wx.stopPullDownRefresh();
    }
  },

  onWin(e) { this.setData({ winIdx: +e.detail.value, expanded: "" }); this.render(); },
  onCur(e) { this.setData({ curIdx: +e.detail.value, expanded: "" }); this.render(); },
  onTier(e) { this.setData({ tierIdx: +e.detail.value, expanded: "" }); this.render(); },
  onGrp(e) { this.setData({ grpIdx: +e.detail.value, expanded: "" }); this.render(); },

  render() {
    const d = this.raw;
    if (!d) return;
    const win = this.wins[this.data.winIdx].key;
    const cur = CURS[this.data.curIdx].key;
    const tier = TIERS[this.data.tierIdx].key;
    const grp = this.grps[this.data.grpIdx].key;

    const tierOk = (m) => tier === "all" ? true : tier === "ext" ? m.tier !== "tail" : m.tier === "core";
    const pool = d.meta.filter((m) => tierOk(m) && (grp === "all" || m.group === grp));

    const val = (code) => {
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
      const dl = ((d.rankDelta || {})[r.m.code] || {})[win];
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
        asofTag: r.m.asof !== d.dataAsof ? " · 截至" + r.m.asof.slice(5) : "",
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
    const isLong = ["y1", "y3", "y5"].includes(win) || win.startsWith("anchor:");

    this.setData({
      ledeHead: `${this.wins[this.data.winIdx].label} · ${CURS[this.data.curIdx].label}口径`,
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
    const win = this.wins[this.data.winIdx].key;
    const cur = CURS[this.data.curIdx].key;
    const m = d.meta.find((x) => x.code === code);
    const r = (d.snapshot[code] || {})[win] || {};
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
        note: m.note || "",
      },
    });
  },

  goAbout() { wx.navigateTo({ url: "/pages/about/about" }); },
});
