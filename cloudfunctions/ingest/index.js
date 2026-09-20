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

async function fetchWithFallback(file) {
  let last;
  for (const mk of SOURCES) {
    const url = mk(file);
    try { return { body: await get(url), url }; }
    catch (e) { last = e; }
  }
  throw new Error(`两个源都取不到 ${file}：${last && last.message}`);
}

exports.main = async () => {
  const t0 = Date.now();
  try { await db.createCollection("index_snapshot"); } catch (e) { /* 已存在 */ }

  const { body, url } = await fetchWithFallback("snapshot.json");
  const snap = JSON.parse(body);
  const doc = { ...snap, ingestedAt: new Date(), sourceUrl: url };

  try {
    await db.collection("index_snapshot").doc("latest").set({ data: doc });
  } catch (e) {
    await db.collection("index_snapshot").add({ data: { _id: "latest", ...doc } });
  }

  return {
    ok: true,
    ms: Date.now() - t0,
    bytes: Buffer.byteLength(body),
    from: url.includes("jsdelivr") ? "jsDelivr" : "raw.githubusercontent",
    indices: snap.meta.length,
    countries: snap.countries,
    dataAsof: snap.dataAsof,
    builtAt: snap.generated,
  };
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
