/**
 * 等价性验证：用同一份原始数据，比对 Node 版 buildSnapshot 与
 * Python 版 build_snapshot.py 的输出是否逐项一致。
 *
 * 这隔离了「取数」与「计算」——只测计算逻辑的移植是否忠实。
 */
const fs = require("fs");
const path = require("path");
const { buildSnapshot } = require("../cloudfunctions/lib/snapshot.js");
const { INDICES } = require("../cloudfunctions/lib/indices.js");

const ROOT = path.join(__dirname, "..");
const py = JSON.parse(fs.readFileSync(path.join(ROOT, "data/app_data.json"), "utf8"));
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "data/raw/fx.json"), "utf8"));

// 只比对两边都有的指数
const series = {};
for (const m of INDICES) {
  const f = path.join(ROOT, "data/raw/idx", m.code + ".json");
  if (fs.existsSync(f)) series[m.code] = JSON.parse(fs.readFileSync(f, "utf8")).data;
}

const node = buildSnapshot(INDICES, series, fx.rates);

let compared = 0, diffs = [];
for (const code of Object.keys(node.snapshot)) {
  if (!py.snapshot[code]) continue;
  for (const win of Object.keys(node.snapshot[code])) {
    for (const cur of ["local", "usd", "cny"]) {
      const a = node.snapshot[code][win][cur];
      const b = py.snapshot[code][win]?.[cur];
      compared++;
      const bothNull = (a === null || a === undefined) && (b === null || b === undefined);
      if (bothNull) continue;
      if (a === null || b === null || a === undefined || b === undefined || Math.abs(a - b) > 0.011) {
        diffs.push(`${code} ${win} ${cur}: node=${a} python=${b}`);
      }
    }
  }
}

console.log(`比对了 ${Object.keys(node.snapshot).length} 个指数、${compared} 个数值`);
if (diffs.length) {
  console.log(`\n❌ 发现 ${diffs.length} 处不一致：`);
  diffs.slice(0, 25).forEach((d) => console.log("  " + d));
  process.exitCode = 1;
} else {
  console.log("\n✅ 全部一致（容差 0.011 个百分点）");
}

// 抽样展示，便于人工核对
const pick = ["SPX", "N225", "KS11", "HSI", "SHCOMP"].filter((c) => node.snapshot[c]);
console.log("\n抽样（今年以来）：");
for (const c of pick) {
  const m = node.meta.find((x) => x.code === c);
  const s = node.snapshot[c].ytd;
  const f = (v) => (v === null ? "  —   " : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");
  console.log(`  ${m.flag} ${m.country.padEnd(5)} 原币 ${f(s.local)}  美元 ${f(s.usd)}  人民币 ${f(s.cny)}   [${m.source}]`);
}
