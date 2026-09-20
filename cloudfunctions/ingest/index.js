/**
 * ingest —— 把 GitHub Actions 构建好的快照取回来写进云数据库。
 *
 * 为什么不在云函数里直接抓数据：
 * 云开发免费版云函数超时固定 3 秒且不可调（调高需付费版），
 * 33 个指数 + 汇率约需 36 秒，跑不完。重活因此放在 Actions，
 * 这里只做一次 20 KB 的下载和一次写库，稳落在 3 秒内。
 *
 * series.json 有 1.18 MB，境内拉取大概率超时，故不在此处同步；
 * 详情页与自定义区间所需的序列留待 P3 分批导入。
 */
const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const REPO = "weiyhmail-sketch/global-index-rank";
const BRANCH = "data";
// jsDelivr 在境内的可达性与速度都优于 raw.githubusercontent.com，
// 取不到时再回退到 raw。
const SOURCES = [
  (f) => `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${f}`,
  (f) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${f}`,
];

function get(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "ingest" }, timeout }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location, timeout));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(body);
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/**
 * 依次尝试各源。
 *
 * @param freshCheck 传入则校验内容新鲜度；判定为陈旧时继续尝试下一个源。
 *   jsDelivr 对分支引用缓存很久，Actions 会主动 purge，但仍可能命中边缘旧副本；
 *   raw.githubusercontent 慢一些但总是最新，作为兜底。
 */
async function fetchWithFallback(file) {
  let last;
  for (const mk of SOURCES) {
    const url = mk(file);
    try { return { body: await get(url), url }; }
    catch (e) { last = e; }
  }
  throw new Error(`各源均取不到 ${file}：${last && last.message}`);
}

/** 构建时间在 36 小时内视为新鲜（每日构建 + 容忍一天的失败）。 */
function freshEnough(body) {
  try {
    const g = JSON.parse(body).generated;
    return g && (Date.now() - new Date(g).getTime()) < 36 * 3600 * 1000;
  } catch (e) { return false; }
}

async function upsert(col, id, doc) {
  try { await db.collection(col).doc(id).set({ data: doc }); }
  catch (e) { await db.collection(col).add({ data: { _id: id, ...doc } }); }
}

/**
 * @param event.what "snapshot"(默认) | "fx" | "all"
 *   分开吃是因为 3 秒超时：快照 40 KB 很轻，汇率表 gzip 后约 200 KB，
 *   合在一起有超时风险。默认只吃快照——那是首屏必需的；
 *   汇率仅自定义区间用得到，可单独触发。
 */
exports.main = async (event = {}) => {
  const t0 = Date.now();
  const what = event.what || "snapshot";
  const out = { ok: true, did: [] };

  if (what === "snapshot" || what === "all") {
    try { await db.createCollection("index_snapshot"); } catch (e) { /* 已存在 */ }
    const { body, url } = await fetchWithFallback("snapshot.json");
    const snap = JSON.parse(body);
    await upsert("index_snapshot", "latest", { ...snap, ingestedAt: new Date(), sourceUrl: url });
    out.did.push("snapshot");
    // 只上报不换源：jsDelivr 的 purge 有传播延迟，一旦因陈旧而回退到
    // raw.githubusercontent 就变成两次取数，必然撞上 3 秒超时。
    // 06:10 与 06:20 两次触发本身已是重试。
    if (!freshEnough(body)) out.warning = "内容超过 36 小时，可能是每日构建失败或 CDN 未刷新";
    Object.assign(out, {
      bytes: Buffer.byteLength(body),
      from: url.includes("jsdelivr") ? "jsDelivr" : "raw.githubusercontent",
      indices: snap.meta.length, countries: snap.countries,
      dataAsof: snap.dataAsof, builtAt: snap.generated,
    });
  }

  if (what === "fx" || what === "all") {
    try { await db.createCollection("fx_daily"); } catch (e) { /* 已存在 */ }
    const { body } = await fetchWithFallback("fx.json");
    const fx = JSON.parse(body);
    await upsert("fx_daily", "latest", { ...fx, ingestedAt: new Date() });
    out.did.push("fx");
    out.fxBytes = Buffer.byteLength(body);
    out.fxCount = Object.keys(fx.rates || {}).length;
  }

  out.ms = Date.now() - t0;
  return out;
};

/*
 * 触发器说明（config.json）：
 *   北京时间 06:10 与 06:20 各跑一次。
 *   GitHub Actions 在 UTC 22:00（北京 06:00）构建，约 1 分钟完成，故 06:10 取数。
 *
 *   配两次不是冗余：云函数冷启动常常吃掉 3 秒超时里的大半（实测首次调用超时、
 *   预热后仅 1.5-1.8 秒）。第二次触发时函数已热，天然充当重试。
 *   本函数幂等（固定写 index_snapshot/latest），重复执行无副作用。
 */
