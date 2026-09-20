/**
 * 指数数量守卫的触发用例。
 *
 * 为什么单独写一个：这道守卫上一轮写完就没运行过（prev-snapshot.json 没人写、
 * workflow 也不下载，existsSync 恒 false），而它是**唯一**能发现
 * 「某个市场悄悄从榜单消失」的机制——那种失效绕得过所有其他防线：
 * 构建成功、generated 是新的、freshEnough 通过、数据也是今天的，只是少了一个国家。
 *
 * 纪律：每加一道防护，就写一个让它触发的用例。不然只是写了个心安。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SNAP = path.join(DIST, "snapshot.json");
const PREV = path.join(DIST, "prev-snapshot.json");

if (!fs.existsSync(SNAP)) {
  console.log("❌ 先跑一次 node scripts/build-data.js");
  process.exit(1);
}

const fails = [];
const backup = fs.existsSync(PREV) ? fs.readFileSync(PREV) : null;
const run = () => {
  try {
    return { code: 0, out: execFileSync("node", [path.join(ROOT, "scripts", "build-data.js")],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

try {
  // ---- 用例 1：上一轮多一个指数 → 必须 exit 1 并点名丢了谁 ----
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const ghost = { ...snap.meta[0], code: "__GHOST__", country: "幽灵国", name: "幽灵指数", flag: "🏳️" };
  fs.writeFileSync(PREV, JSON.stringify({ ...snap, meta: [...snap.meta, ghost] }));
  const r1 = run();
  const named = /丢失.*幽灵国/.test(r1.out);
  console.log(`用例1 上一轮多一个指数 → 退出码 ${r1.code}${named ? "，并点名了丢失的市场" : ""}`);
  if (r1.code !== 1) fails.push(`上一轮多一个指数时应当 exit 1，实际 ${r1.code}`);
  if (!named) fails.push("没有点名具体丢了哪个市场，光说数量下降没法排查");

  // ---- 用例 2：数量持平 → 正常通过，并且打印出守卫跑过了 ----
  fs.writeFileSync(PREV, JSON.stringify(snap));
  const r2 = run();
  const ran = /数量守卫：上一轮 \d+ 个指数/.test(r2.out);
  console.log(`用例2 数量持平 → 退出码 ${r2.code}${ran ? "，守卫确实执行了" : "，但没有守卫执行的痕迹"}`);
  if (r2.code !== 0) fails.push(`数量持平时不该失败，实际 ${r2.code}`);
  if (!ran) fails.push("守卫没有留下执行痕迹——无法区分「比过了」和「跳过了」");

  // ---- 用例 3：没有上一轮产物 → 跳过，但必须说出来 ----
  fs.rmSync(PREV, { force: true });
  const r3 = run();
  const said = /跳过数量守卫/.test(r3.out);
  console.log(`用例3 无上一轮产物 → 退出码 ${r3.code}${said ? "，并明说跳过了" : "，且悄无声息"}`);
  if (r3.code !== 0) fails.push(`无上一轮产物时不该失败，实际 ${r3.code}`);
  if (!said) fails.push("跳过守卫时没有任何提示——这正是它白写一轮都没人发现的原因");

  // ---- 用例 4：构建之后必须留下副本给下一轮 ----
  const left = fs.existsSync(PREV);
  console.log(`用例4 构建后是否留下 prev-snapshot.json → ${left ? "是" : "否"}`);
  if (!left) fails.push("构建后没写 prev-snapshot.json，下一轮守卫又会变成死代码");
} finally {
  if (backup) fs.writeFileSync(PREV, backup);
}

console.log(fails.length ? "\n❌ " + fails.join("\n❌ ") : "\n✅ 数量守卫会按预期触发");
process.exit(fails.length ? 1 : 0);
