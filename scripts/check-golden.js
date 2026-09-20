/**
 * 黄金测试：算出来的数必须和签入的期望值一致，变了就得手动确认。
 *
 * 为什么要取代等价性测试：verify-node-vs-python.js 比的是 Node 实现与
 * Python 原版，而 Python 管线早就不在链路上了。更要命的是它**看不见新代码**——
 * MAX_BACKTRACK_DAYS 是与 Python 的故意分歧，Python 没这道上限，
 * 而它在当前数据上一次都不触发，所以「600 个数值一致 ✅」只说明
 * 新逻辑在这份快照上是个空操作，不说明它被验证过。
 * 新增的 why / back / maxBack / windows[].n 这些字段更是一个都没比。
 *
 * 黄金测试反过来：任何计算结果的变化都会立刻可见，包括故意的改动——
 * 那时要人去看一眼、确认是预期的，再跑 --update 更新期望值。
 *
 *   node scripts/check-golden.js            # 比对
 *   node scripts/check-golden.js --update   # 确认无误后更新期望值
 */
const fs = require("fs");
const path = require("path");

const GOLDEN = path.join(__dirname, "golden.json");
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "dist", f), "utf8"));
const snap = D("snapshot.json");

// 取值要稳定：只收计算结果，不收 generated 这类每次都变的东西
const actual = {
  指数数: snap.meta.length,
  国家数: snap.countries,
  窗口: Object.fromEntries(snap.windows.map((w) => [w.key, { label: w.label, days: w.days, n: w.n }])),
  指数: Object.fromEntries(snap.meta.map((m) => [m.code, {
    ccy: m.ccy, start: m.start, srcStart: m.srcStart || null, canFx: m.canFx,
    fxFrom: m.fxFrom, fxReason: m.fxReason, d1Span: m.d1Span, maxBack: m.maxBack,
    truncNote: m.truncNote || null,
  }])),
  快照: Object.fromEntries(Object.entries(snap.snapshot).map(([code, row]) => [code,
    Object.fromEntries(Object.entries(row).map(([k, v]) =>
      [k, { l: v.local, u: v.usd, c: v.cny, why: v.why || null, back: v.back || null }])),
  ])),
};

if (process.argv.includes("--update")) {
  fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 1));
  console.log(`✅ 期望值已更新：${Object.keys(actual.指数).length} 个指数 · ${fs.statSync(GOLDEN).size >> 10} KB`);
  process.exit(0);
}

if (!fs.existsSync(GOLDEN)) {
  console.log("❌ 没有期望值文件，先跑 node scripts/check-golden.js --update");
  process.exit(1);
}

const expected = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
const diffs = [];
const walk = (a, b, p) => {
  if (diffs.length > 40) return;
  const ka = a && typeof a === "object" ? Object.keys(a) : null;
  const kb = b && typeof b === "object" ? Object.keys(b) : null;
  if (!ka || !kb) { if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return; }
  for (const k of new Set([...ka, ...kb])) walk(a[k], b[k], p ? `${p}.${k}` : k);
};
walk(expected, actual, "");

let n = 0;
const count = (o) => { for (const v of Object.values(o)) typeof v === "object" && v ? count(v) : n++; };
count(actual);

if (!diffs.length) {
  console.log(`✅ ${n} 个数值与期望值完全一致`);
  process.exit(0);
}
console.log(`❌ 与期望值有 ${diffs.length > 40 ? "40+" : diffs.length} 处差异：\n`);
diffs.slice(0, 40).forEach((d) => console.log("  " + d));
console.log("\n若这些变化是预期的，确认之后跑：node scripts/check-golden.js --update");
process.exit(1);
