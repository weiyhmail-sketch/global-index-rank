/**
 * 指数详情页：走势图 + 各窗口涨幅 + 数据口径。
 *
 * 图表数据来自构建侧预计算的 chart/{code}.json（近5年×三种口径）：
 * 客户端拿不到汇率表，换算只能在构建侧做完，否则图与榜单口径对不上。
 */
const { call } = require("../../utils/cloud.js");

const CURS = [
  { key: "cny", label: "人民币" },
  { key: "usd", label: "美元" },
  { key: "local", label: "原币种" },
];
const RANGES = [
  { key: "1m", label: "近1月", months: 1 },
  { key: "3m", label: "近3月", months: 3 },
  { key: "1y", label: "近1年", months: 12 },
  { key: "3y", label: "近3年", months: 36 },
  { key: "5y", label: "近5年", months: 60 },
];

function minusMonths(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

Page({
  data: {
    loading: true, error: "", chartLoading: false,
    code: "", flag: "", country: "", name: "", level: "", asof: "", metaLine: "", note: "",
    curIdx: 0, curOptions: CURS.map((c) => c.label),
    rangeIdx: 2, rangeOptions: RANGES.map((r) => r.label),
    wins: [], chartStat: "", sampleNote: "", noCur: false,
  },

  onLoad(q) {
    this.code = q.code;
    const cur = CURS.findIndex((c) => c.key === q.cur);
    this.setData({ code: q.code, curIdx: cur < 0 ? 0 : cur });
    this.load();
  },

  async load() {
    try {
      const snap = await call("get-snapshot");
      if (!snap || !snap.ok) throw new Error("快照获取失败");
      this.snap = snap;
      this.chartCache = {};
      const m = snap.meta.find((x) => x.code === this.code);
      if (!m) throw new Error("未找到该指数");
      this.m = m;

      wx.setNavigationBarTitle({ title: `${m.country} · ${m.name}` });
      this.setData({
        loading: false,
        flag: m.flag, country: m.country, name: m.name,
        level: m.level.toLocaleString(), asof: m.asof,
        metaLine: `本币 ${m.ccy} · 数据 ${m.start} 起 · 源 ${m.source}`,
        note: m.fxFrom
          ? (m.fxReason === "gap"
              ? `${m.ccy} 自 ${m.fxFrom} 起才有公开汇率，更早区间只有原币口径。`
              : `汇率数据自 ${m.fxFrom} 起，此前只有原币口径。`)
          : (m.note || ""),
      });
      await this.loadChart();
      this.render();
    } catch (e) {
      this.setData({ loading: false, error: e.message || String(e) });
    }
  },

  /**
   * 按所选区间向云函数取图表数据。
   *
   * 不一次拉全量再裁剪：5 年全量 52 KB / 1255 点，云函数取它会撞 3 秒超时
   * （实测 SPX 全量 timeout、带 from 的 181 点 2.2 秒通过）。
   * 按区间取既不超时，也不损失任何数据精度。取过的区间缓存起来。
   */
  async loadChart() {
    const r = RANGES[this.data.rangeIdx];
    if (this.chartCache[r.key]) { this.chart = this.chartCache[r.key]; return; }
    this.setData({ chartLoading: true });
    try {
      const from = minusMonths(this.m.asof, r.months);
      const c = await call("get-chart", { code: this.code, from });
      if (!c || !c.ok) throw new Error((c && c.error) || "走势数据获取失败");
      this.chartCache[r.key] = c;
      this.chart = c;
    } finally {
      this.setData({ chartLoading: false });
    }
  },

  onCur(e) { this.setData({ curIdx: +e.detail.value }); this.render(); },

  async onRange(e) {
    this.setData({ rangeIdx: +e.detail.value });
    try { await this.loadChart(); this.render(); }
    catch (err) { this.setData({ chartStat: "走势数据获取失败", noCur: true }); }
  },

  render() {
    const cur = CURS[this.data.curIdx].key;
    const s = this.snap, m = this.m;

    // 各窗口涨幅
    const fmt = (v) => (v === null || v === undefined) ? "—" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
    const cls = (v) => (v === null || v === undefined) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";
    const row = s.snapshot[this.code] || {};
    const wins = [
      ...s.windows.map((w) => ({ label: w.label, key: w.key })),
      ...(s.anchors || []).map((a) => ({ label: a.label, key: "anchor:" + a.date })),
    ].map((w) => {
      const v = (row[w.key] || {})[cur];
      return { label: w.label, pct: fmt(v), cls: cls(v) };
    });

    // 图表：按所选区间裁剪
    const c = this.chart;
    const series = c[cur];
    const noCur = !series || series.every((v) => v === null);
    let stat = "", sampleNote = "";
    if (!noCur) {
      // 区间已由云函数按 from 裁好，这里只剔除空值
      const pts = [];
      for (let i = 0; i < c.dates.length; i++) {
        if (series[i] !== null) pts.push([c.dates[i], series[i]]);
      }
      if (pts.length > 1) {
        const r = (pts[pts.length - 1][1] / pts[0][1] - 1) * 100;
        stat = `${pts[0][0]} → ${pts[pts.length - 1][0]} · ${fmt(r)}`;
        // 长区间的早段是周采样，如实标注
        sampleNote = (c.dailyFrom && pts[0][0] < c.dailyFrom)
          ? `${c.dailyFrom} 之前为每周采样` : "";
        this.draw(pts, r >= 0);
      } else {
        stat = "该区间数据不足";
        this.clear();
      }
    } else {
      this.clear();
    }
    this.setData({ wins, chartStat: stat, sampleNote, noCur });
  },

  clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.cw, this.ch);
  },

  /** 画折线图。首次调用时初始化 canvas 2d 上下文。 */
  draw(pts, isUp) {
    const go = () => {
      const ctx = this.ctx, W = this.cw, H = this.ch;
      const padT = 8, padB = 18, padL = 4, padR = 4;
      ctx.clearRect(0, 0, W, H);

      const vals = pts.map((p) => p[1]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi === lo) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const x = (i) => padL + (W - padL - padR) * (i / (pts.length - 1));
      const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

      const color = isUp ? "#e0403f" : "#1a9c5b";
      // 面积
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.lineTo(x(pts.length - 1), H - padB);
      ctx.lineTo(x(0), H - padB);
      ctx.closePath();
      ctx.fillStyle = isUp ? "rgba(224,64,63,.10)" : "rgba(26,156,91,.10)";
      ctx.fill();
      // 折线
      ctx.beginPath();
      ctx.moveTo(x(0), y(vals[0]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(x(i), y(vals[i]));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();
      // 起止日期
      ctx.fillStyle = "#9aa0a8";
      ctx.font = "10px sans-serif";
      ctx.fillText(pts[0][0], padL, H - 4);
      const endTxt = pts[pts.length - 1][0];
      ctx.fillText(endTxt, W - padR - ctx.measureText(endTxt).width, H - 4);
    };

    if (this.ctx) return go();
    wx.createSelectorQuery().in(this).select("#chart").fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : (wx.getSystemInfoSync().pixelRatio || 2);
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      this.ctx = canvas.getContext("2d");
      this.ctx.scale(dpr, dpr);
      this.cw = res[0].width;
      this.ch = res[0].height;
      go();
    });
  },
});
