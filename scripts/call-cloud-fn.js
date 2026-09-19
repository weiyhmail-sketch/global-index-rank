/**
 * 通过小程序自动化通道调用云函数并打印返回值。
 *
 * 为什么需要这个: 微信开发者工具 CLI 只有 list/info/deploy/inc-deploy/download，
 * 没有 invoke。要拿到云函数的实际返回值(而不是去 GUI 里翻日志)，
 * 只能走 miniprogram-automator 驱动模拟器，在小程序里 callFunction。
 *
 * 用法:
 *   node scripts/call-cloud-fn.js <函数名> [JSON参数]
 * 前置:
 *   /Applications/wechatwebdevtools.app/Contents/MacOS/cli auto \
 *     --project <项目路径> --auto-port 9420
 */
const automator = require("miniprogram-automator");

const NAME = process.argv[2];
const DATA = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const PORT = process.env.AUTO_PORT || 9420;

if (!NAME) {
  console.error("用法: node scripts/call-cloud-fn.js <函数名> [JSON参数]");
  process.exit(1);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://localhost:${PORT}` });
  try {
    const res = await mp.evaluate(
      (name, data) =>
        new Promise((resolve) => {
          wx.cloud.callFunction({
            name,
            data,
            success: (r) => resolve({ ok: true, result: r.result }),
            fail: (e) => resolve({ ok: false, error: e.errMsg || String(e) }),
          });
        }),
      NAME,
      DATA
    );
    console.log(JSON.stringify(res, null, 2));
    process.exitCode = res.ok ? 0 : 1;
  } finally {
    await mp.disconnect();
  }
})().catch((e) => {
  console.error("连接自动化通道失败:", e.message);
  console.error("请先运行: cli auto --project <项目路径> --auto-port 9420");
  process.exit(1);
});
