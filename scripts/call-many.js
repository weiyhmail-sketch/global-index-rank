/** 在一个连接里批量调用云函数，避免每次新建自动化连接的开销。 */
const automator = require("miniprogram-automator");
const calls = JSON.parse(process.argv[2]);

(async () => {
  const mp = await automator.connect({ wsEndpoint: "ws://localhost:" + (process.env.AUTO_PORT || 9420) });
  try {
    for (const { name, data, label } of calls) {
      const t0 = Date.now();
      const res = await mp.evaluate((n, d) => new Promise((resolve) => {
        wx.cloud.callFunction({ name: n, data: d,
          success: (r) => resolve({ ok: true, result: r.result }),
          fail: (e) => resolve({ ok: false, error: e.errMsg || String(e) }) });
      }), name, data || {});
      const tag = label || name;
      if (res.ok && res.result && res.result.ok) {
        const r = res.result;
        console.log(`  ${tag.padEnd(14)} ${String(r.ms || Date.now() - t0).padStart(5)}ms  ${String(r.bytes || "").padStart(6)}字节  ${r.n !== undefined ? r.n + "点" : ""}`);
      } else {
        const err = (res.result && res.result.error) || res.error || "未知";
        console.log(`  ${tag.padEnd(14)} ❌ ${String(err).slice(0, 60)}`);
      }
    }
  } finally { await mp.disconnect(); }
})().catch((e) => { console.error("连接失败:", e.message); process.exit(1); });
