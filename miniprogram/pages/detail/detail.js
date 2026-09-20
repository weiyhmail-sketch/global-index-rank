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
// winKey 指向快照里的同名窗口。图表标题直接读快照，不自己算——
// 自己算会与正下方的「各区间涨幅」格子打架（实测最大差 40.49 个百分点），
// 因为两者的起点取法方向相反，而且图表对一年前的数据做了周采样。
const RANGES = [
  { key: "1m", label: "近1月", months: 1,  winKey: "m1" },
  { key: "3m", label: "近3月", months: 3,  winKey: "m3" },
  { key: "1y", label: "近1年", months: 12, winKey: "y1" },
  { key: "3y", label: "近3年", months: 36, winKey: "y3" },
  { key: "5y", label: "近5年", months: 60, winKey: "y5" },
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
    wins: [], chartStat: "", sampleNote: "", noCur: false, years: [],
  },

  onLoad(q) {
    // 令牌要在这里初始化，不能放在 load() 里。load() 第一行就 await 取快照，
    // 取失败(实测约一成)就抛出，令牌永远是 undefined；此后 ++undefined 得到 NaN，
    // 而 NaN !== NaN 恒真，onRange 会把每一次切区间都当成过期请求静默丢弃。
    this.rangeToken = 0;
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
      this.chart = await this.loadChart(RANGES[this.data.rangeIdx]);
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
  /**
   * 取某个区间的曲线并返回它——注意是返回，不是直接写 this.chart。
   * 由调用方在确认这次请求没被更晚的切换取代之后再落盘，
   * 否则先发后到的旧请求会覆盖新曲线。
   */
  async loadChart(r) {
    if (this.chartCache[r.key]) return this.chartCache[r.key];
    this.setData({ chartLoading: true });
    try {
      const from = minusMonths(this.m.asof, r.months);
      const c = await call("get-chart", { code: this.code, from });
      if (!c || !c.ok) throw new Error((c && c.error) || "走势数据获取失败");
      this.chartCache[r.key] = c;
      return c;
    } finally {
      this.setData({ chartLoading: false });
    }
  },

  onCur(e) { this.setData({ curIdx: +e.detail.value }); this.render(); },

  async onRange(e) {
    // 先取数、成功后再切标签。反过来的话一旦取数失败，
    // 新标签会挂着旧区间的曲线，之后任何一次 onCur 都会把这个错配渲染出来。
    // 页面压根没加载成功(快照失败/指数不存在)时，this.snap 与 this.m 都不存在，
    // render() 会对 undefined 解引用。此时页面已经在显示错误，切区间无意义。
    if (!this.snap || !this.m) return;
    const prev = this.data.rangeIdx;
    const next = +e.detail.value;
    // 令牌：连点几下区间时，先发的请求可能后返回。render() 读的是渲染那一刻的
    // rangeIdx，所以一个过期请求会把旧曲线配上新窗口的快照数值——正是
    // 「图表与格子不同源」换条路回来。被取代的请求到这里就地丢弃。
    const token = ++this.rangeToken;
    this.setData({ rangeIdx: next });
    try {
      const c = await this.loadChart(RANGES[next]);
      if (token !== this.rangeToken) return;
      this.chart = c;
      this.render();
    } catch (err) {
      if (token !== this.rangeToken) return;
      this.setData({ rangeIdx: prev, chartStat: "走势数据获取失败" });
      this.render();
    }
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

    // 逐年涨幅：产品评审把「分年度矩阵」判为该砍（手机上只能横滚），
    // 单个指数的竖排列表回答同一个问题，成本低得多。
    const yrs = (s.yearly || {})[this.code] || [];
    const ymax = Math.max(1, ...yrs.map((r) => Math.abs(r[cur] || 0)));
    const years = yrs.map((r) => ({
      label: r.label,
      pct: fmt(r[cur]),
      cls: cls(r[cur]),
      barW: r[cur] === null || r[cur] === undefined ? 0 : Math.abs(r[cur]) / ymax * 46,
      barPos: (r[cur] || 0) >= 0,
    }));

    // 图表：按所选区间裁剪
    const c = this.chart;
    const R = RANGES[this.data.rangeIdx];
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
        // 数字一律以快照为准，图表只负责画形状，从结构上消除第二个数据源
        const snapV = ((s.snapshot[this.code] || {})[R.winKey] || {})[cur];
        if (snapV === null || snapV === undefined) {
          // 快照说数据不够（起点早于该指数历史），图照画，但标题不能假装是 N 年
          stat = `数据自 ${c.dates[0]} 起，不足${R.label.replace("近", "")}`;
          this.draw(pts, pts[pts.length - 1][1] >= pts[0][1]);
        } else {
          stat = `${pts[0][0]} → ${pts[pts.length - 1][0]} · ${fmt(snapV)}`;
          this.draw(pts, snapV >= 0);
        }
        sampleNote = (c.dailyFrom && pts[0][0] < c.dailyFrom)
          ? `${c.dailyFrom} 之前为每周采样` : "";
      } else {
        stat = "该区间数据不足";
        this.clear();
      }
    } else {
      this.clear();
    }
    this.setData({ wins, years, chartStat: stat, sampleNote, noCur });
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
      // x 轴必须按日期而非数组下标：近一年是日采样、更早是周采样，
      // 按下标等距会让近5年图里最近一年占掉 55% 的宽度（实际只占 20% 的时间），
      // 把「多年横盘、最近拉升」画成「长期陡峭上行」。
      const t0 = +new Date(pts[0][0] + "T00:00:00Z");
      const t1 = +new Date(pts[pts.length - 1][0] + "T00:00:00Z");
      const span = t1 - t0 || 1;
      const x = (i) => padL + (W - padL - padR)
        * ((+new Date(pts[i][0] + "T00:00:00Z") - t0) / span);
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
