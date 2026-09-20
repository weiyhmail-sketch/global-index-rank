/**
 * 一次性诊断函数：云函数出口到底怎么失败的。
 *
 * 为什么必须实测：A7 的「第一条对冲腿打到同一个 raw」方案押在一个前提上——
 * 线上失败是**连接级挂起**而不是 raw 整体不可用。若失败其实是 SNI/IP 层面的
 * 干扰，那么再开一条到同一域名的连接大概率同样被干掉，方案的收益就没了。
 * 这个前提我没测过，审查者也没测过，不能凭感觉选方案。
 *
 * 零依赖。每条腿单独计时、单独记错误类型。
 */
const https = require("https");

const REPO = "weiyhmail-sketch/global-index-rank";
const TARGETS = {
  raw:  `https://raw.githubusercontent.com/${REPO}/data/snapshot.json`,
  raw2: `https://raw.githubusercontent.com/${REPO}/data/snapshot.json`, // 同域第二条连接
  jsd:  `https://cdn.jsdelivr.net/gh/${REPO}@data/snapshot.json`,
};

function probe(url, timeout) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let firstByte = null;
    const req = https.get(url, { headers: { "User-Agent": "probe" }, timeout, agent: false }, (res) => {
      let n = 0;
      res.on("data", (c) => { if (firstByte === null) firstByte = Date.now() - t0; n += c.length; });
      res.on("end", () => resolve({ ok: true, status: res.statusCode, ms: Date.now() - t0, ttfb: firstByte, bytes: n }));
      res.on("error", (e) => resolve({ ok: false, kind: "res-" + (e.code || e.message), ms: Date.now() - t0, ttfb: firstByte }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, kind: "timeout", ms: Date.now() - t0, ttfb: firstByte }); });
    req.on("error", (e) => resolve({ ok: false, kind: e.code || e.message, ms: Date.now() - t0 }));
  });
}

exports.main = async (event) => {
  const t = event && event.timeout ? event.timeout : 2500;
  // 三条腿同时发，这样看到的是同一时刻的网络状况，而不是先后三个时刻
  const [raw, raw2, jsd] = await Promise.all([
    probe(TARGETS.raw, t), probe(TARGETS.raw2, t), probe(TARGETS.jsd, t),
  ]);
  return { ok: true, raw, raw2, jsd };
};
