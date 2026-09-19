/* 全球股市涨幅排行 —— 原型逻辑
 *
 * 与后端 build_snapshot.py 保持同一套口径:
 *   - 区间端点取「该日或之前最近一个交易日」，不插值
 *   - 外币换算按端点各自对应日期的汇率
 *   - 数据起点晚于窗口起点则返回 null，不拿首日充数
 * 这里额外实现了后端没有的能力: 把窗口终点挪到任意历史日期，
 * 从而回溯计算过去的名次(排名变化 Δ 用)。
 */

const CURS = [["cny", "人民币"], ["usd", "美元"], ["local", "原币种"]];
const TIERS = [["core", "核心12国"], ["ext", "核心+扩展"], ["all", "全部"]];
const DELTA_DAYS = 7;        // 排名变化的回溯跨度(自然日)

const st = { win: "ytd", cur: "cny", tier: "core", grp: "all", d0: null, d1: null };
const META = {};
const $ = id => document.getElementById(id);

/* ---------- 日期与取值 ---------- */

const iso = d => d.toISOString().slice(0, 10);
const shift = (s, days) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return iso(d); };

function minusMonths(s, n) {
  const d = new Date(s + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
}

/** 二分找「该日或之前最近」的一条记录，返回 [日期, 值]。 */
function at(arr, target) {
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m][0] <= target) { r = m; lo = m + 1; } else hi = m - 1; }
  return r < 0 ? null : arr[r];
}

/** 把某指数在某日的点位换算到指定口径。 */
function levelAt(code, dateStr, cur) {
  const m = META[code], pt = at(DATA.series[code], dateStr);
  if (!pt) return null;
  if (cur === "local") return pt[1];
  let usd;
  if (m.ccy === "USD") usd = pt[1];
  else {
    const r = DATA.fx[m.ccy] && at(DATA.fx[m.ccy], pt[0]);
    if (!r) return null;
    usd = pt[1] / r[1];
  }
  if (cur === "usd") return usd;
  const rc = at(DATA.fx["CNY"], pt[0]);
  return rc ? usd * rc[1] : null;
}

/** 给定窗口与终点日期，算出起点日期。d1(今日) 需要该指数自己的上一个交易日。 */
function winStart(winKey, endISO, code) {
  switch (winKey) {
    case "d1": {
      const s = DATA.series[code], i = s.findIndex(p => p[0] > endISO);
      const idx = (i === -1 ? s.length : i) - 2;
      return idx >= 0 ? s[idx][0] : null;
    }
    case "w1":  return shift(endISO, -7);
    case "m1":  return minusMonths(endISO, 1);
    case "m3":  return minusMonths(endISO, 3);
    case "ytd": return (+endISO.slice(0, 4) - 1) + "-12-31";
    case "y1":  return minusMonths(endISO, 12);
    case "y3":  return minusMonths(endISO, 36);
    case "y5":  return minusMonths(endISO, 60);
    default:    return null;
  }
}

/** 区间涨幅。start 早于该指数数据起点则返回 null。 */
function retBetween(code, cur, startISO, endISO) {
  if (!startISO || startISO < META[code].start) return null;
  const a = levelAt(code, startISO, cur), b = levelAt(code, endISO, cur);
  return (a && b) ? (b / a - 1) * 100 : null;
}

/** 当前视图下某指数的涨幅。外币口径拿不到时退回原币并标记 fb。 */
function getRet(code, cur, endISO) {
  const end = endISO || DATA.maxAsof;
  let start;
  if (st.win === "custom") start = st.d0;
  else if (st.win.startsWith("anchor:")) start = st.win.slice(7);
  else start = winStart(st.win, end, code);

  const realEnd = (st.win === "custom" && !endISO) ? st.d1 : end;
  const v = retBetween(code, cur, start, realEnd);
  if (v !== null) return { v, fb: false };
  if (cur === "local") return { v: null, fb: false };
  const loc = retBetween(code, "local", start, realEnd);
  return loc !== null ? { v: loc, fb: true } : { v: null, fb: false };
}

/* ---------- 榜单 ---------- */

const tierOk = m => st.tier === "all" ? true
                  : st.tier === "ext" ? m.tier !== "tail"
                  : m.tier === "core";

const pool = () => DATA.meta.filter(m => m.group !== "bench" && tierOk(m)
                                      && (st.grp === "all" || m.group === st.grp));

/** 按指定终点日期排名，返回 code -> 名次(1 起)。 */
function rankMap(endISO) {
  const rows = pool().map(m => ({ c: m.code, v: getRet(m.code, st.cur, endISO).v }))
                     .filter(r => r.v !== null)
                     .sort((a, b) => b.v - a.v);
  const out = {};
  rows.forEach((r, i) => out[r.c] = i + 1);
  return out;
}

/* ---------- 渲染 ---------- */

const fmtPct = v => (v > 0 ? "+" : "") + v.toFixed(2) + "%";
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "";

function winLabel() {
  if (st.win === "custom") return st.d0 && st.d1 ? `${st.d0} → ${st.d1}` : "自定义区间";
  if (st.win.startsWith("anchor:")) {
    const a = DATA.anchors.find(x => x.date === st.win.slice(7));
    return a ? `${a.label}以来` : "自定义";
  }
  return DATA.windows.find(w => w.key === st.win).label;
}

function buildSelects() {
  const opt = (v, l, sel) => `<option value="${v}"${v === sel ? " selected" : ""}>${l}</option>`;
  const wins = DATA.windows.map(w => opt(w.key, w.label, st.win)).join("")
    + `<optgroup label="事件锚点">`
    + DATA.anchors.map(a => opt("anchor:" + a.date, a.label + "以来", st.win)).join("")
    + `</optgroup>` + opt("custom", "自定义区间…", st.win);
  $("selWin").innerHTML = wins;
  $("selCur").innerHTML = CURS.map(([v, l]) => opt(v, l, st.cur)).join("");
  $("selTier").innerHTML = TIERS.map(([v, l]) => opt(v, l, st.tier)).join("");
  $("selGrp").innerHTML = [["all", "全部地区"],
    ...Object.entries(DATA.groupNames).filter(([k]) => k !== "bench")]
    .map(([v, l]) => opt(v, l, st.grp)).join("");
}

function render() {
  buildSelects();
  $("customBox").classList.toggle("show", st.win === "custom");

  const rows = pool().map(m => ({ m, ...getRet(m.code, st.cur) }));
  const ok = rows.filter(r => r.v !== null).sort((a, b) => b.v - a.v);
  const na = rows.filter(r => r.v === null);
  const max = Math.max(1, ...ok.map(r => Math.abs(r.v)));

  renderLede(ok, na);

  $("tb").innerHTML = "";
  const prev = (st.win === "custom") ? null : rankMap(shift(DATA.maxAsof, -DELTA_DAYS));
  ok.concat(na).forEach((r, i) => {
    const rank = r.v === null ? null : i + 1;
    const d = (prev && rank && prev[r.m.code]) ? prev[r.m.code] - rank : null;
    $("tb").appendChild(tr(r, rank, max, d));
  });

  const fb = ok.concat(na).filter(r => r.fb).map(r => r.m.name);
  $("fxwarn").innerHTML = fb.length
    ? `<div class="warn">${fb.join("、")}：该区间无可用汇率，表中为<b>原币涨幅</b>（已标 *），仍参与排名。</div>` : "";

  $("divnote").innerHTML = ["y1", "y3", "y5"].includes(st.win) || st.win.startsWith("anchor:")
    ? `<div class="warn">长周期未计入股息。高股息市场（英国约 4%/年、日本约 2%/年）会被系统性低估。</div>` : "";
}

function renderLede(ok, na) {
  const curLabel = CURS.find(c => c[0] === st.cur)[1];
  $("ledeHead").textContent = `${winLabel()} · ${curLabel}口径`;

  if (!ok.length) {
    $("ledeBody").innerHTML = `<div class="nodata">该区间无可比数据（${na.length} 个指数数据起点晚于区间起点）</div>`;
    $("ledeStats").innerHTML = "";
    return;
  }
  const top = ok[0], bot = ok[ok.length - 1];
  const line = (r, tag) => `
    <div class="lede-row">
      <span class="fl">${r.m.flag}</span>
      <b>${r.m.country}</b>
      <span class="lede-pct ${cls(r.v)}">${fmtPct(r.v)}</span>
      <span class="lede-tag">${tag}</span>
    </div>`;
  $("ledeBody").innerHTML = line(top, "领涨") + (ok.length > 1 ? line(bot, "垫底") : "");

  const up = ok.filter(r => r.v > 0).length, down = ok.length - up;
  const sorted = ok.map(r => r.v).slice().sort((a, b) => a - b);
  const mid = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  let html = `<div class="stats">${up} 涨 ${down} 跌 · 中位数 <b class="${cls(mid)}">${fmtPct(mid)}</b>`
           + (na.length ? ` · ${na.length} 个数据不足` : "") + `</div>`;

  if (st.win !== "custom") {
    const prev = rankMap(shift(DATA.maxAsof, -DELTA_DAYS));
    const now = {}; ok.forEach((r, i) => now[r.m.code] = i + 1);
    const moves = ok.map(r => ({ m: r.m, d: prev[r.m.code] ? prev[r.m.code] - now[r.m.code] : 0 }))
                    .filter(x => x.d !== 0)
                    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4);
    html += moves.length
      ? `<div class="stats">近一周排名变化　` + moves.map(x =>
          `<span class="mv"><span class="fl">${x.m.flag}</span>${x.m.country}
           <b class="${x.d > 0 ? "up" : "down"}">${x.d > 0 ? "↑" : "↓"}${Math.abs(x.d)}</b></span>`).join("") + `</div>`
      : `<div class="stats">近一周排名无变化</div>`;
  }
  $("ledeStats").innerHTML = html;
}

function tr({ m, v, fb }, rank, max, delta) {
  const t = document.createElement("tr");
  const w = v === null ? 0 : Math.abs(v) / max * 50;
  const bar = v === null ? "" :
    `<i style="${v >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`};
        background:var(--${v >= 0 ? "up" : "down"})"></i>`;
  const dtag = (delta === null || delta === 0 || delta === undefined) ? ""
    : `<span class="delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}</span>`;
  t.innerHTML = `
    <td class="rk">${rank ?? ""}${dtag}</td>
    <td><div class="nm"><span class="fl">${m.flag}</span>
        <b>${m.country}</b><small>${m.name}${
          m.asof !== DATA.maxAsof ? ` · 截至${m.asof.slice(5)}` : ""}</small></div></td>
    <td class="pc ${v === null ? "na" : cls(v)}">${
      v === null ? "—" : fmtPct(v) + (fb ? '<span class="fb">*</span>' : "")}</td>
    <td class="barcell"><div class="bar-in"><span class="zero" style="left:50%"></span>${bar}</div></td>`;
  t.onclick = () => toggleDetail(t, m, v);
  return t;
}

/** 点开某行 → 展开汇率贡献拆解与数据来源。 */
function toggleDetail(rowEl, m, v) {
  const nxt = rowEl.nextElementSibling;
  if (nxt && nxt.classList.contains("detail")) { nxt.remove(); return; }
  document.querySelectorAll("tr.detail").forEach(e => e.remove());

  const end = st.win === "custom" ? st.d1 : DATA.maxAsof;
  let start;
  if (st.win === "custom") start = st.d0;
  else if (st.win.startsWith("anchor:")) start = st.win.slice(7);
  else start = winStart(st.win, end, m.code);

  const loc = retBetween(m.code, "local", start, end);
  let html = `<div class="dt">`;
  if (loc !== null && v !== null && st.cur !== "local") {
    // 涨幅 = 原币涨幅 × 汇率变动，两者相乘而非相加
    const fxPart = ((1 + v / 100) / (1 + loc / 100) - 1) * 100;
    html += `<div class="calc"><b class="${cls(v)}">${fmtPct(v)}</b>
      <span>= 原币 <b class="${cls(loc)}">${fmtPct(loc)}</b>
      × 汇率 <b class="${cls(fxPart)}">${fmtPct(fxPart)}</b></span></div>`;
  }
  html += `<div class="meta">${m.name} · 本币 ${m.ccy} · 点位 ${
    m.level.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    · 数据 ${m.start} 起 · 源 ${m.source} · 截至 ${m.asof}</div>`;
  if (m.note) html += `<div class="meta">${m.note}</div>`;
  html += `</div>`;

  const d = document.createElement("tr");
  d.className = "detail";
  d.innerHTML = `<td colspan="4">${html}</td>`;
  rowEl.after(d);
}

/* ---------- 初始化 ---------- */

(function init() {
  DATA.meta.forEach(m => META[m.code] = m);
  const asofs = DATA.meta.map(m => m.asof).sort();
  DATA.maxAsof = asofs[asofs.length - 1];

  const ranked = DATA.meta.filter(m => m.group !== "bench");
  const nCountry = new Set(ranked.map(m => m.country)).size;
  $("sub").textContent = `${nCountry} 个国家/地区 · ${ranked.length} 个指数 · 数据截至 ${DATA.maxAsof}`;

  const srcs = {};
  DATA.meta.forEach(m => srcs[m.source] = (srcs[m.source] || 0) + 1);
  $("srcnote").innerHTML = "<b>数据源。</b>"
    + Object.entries(srcs).map(([s, n]) => `${s} ${n} 个`).join("，") + "。";

  $("d1").value = st.d1 = DATA.maxAsof;
  $("d0").value = st.d0 = `${(+DATA.maxAsof.slice(0, 4)) - 1}-12-31`;
  $("d0").max = $("d1").max = DATA.maxAsof;
  $("d0").onchange = e => { st.d0 = e.target.value; render(); };
  $("d1").onchange = e => { st.d1 = e.target.value; render(); };

  [["selWin", "win"], ["selCur", "cur"], ["selTier", "tier"], ["selGrp", "grp"]]
    .forEach(([id, key]) => $(id).onchange = e => { st[key] = e.target.value; render(); });

  render();
})();
