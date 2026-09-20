/** 用自动化通道打开小程序首页，读取渲染结果并截图。 */
const automator = require("miniprogram-automator");
const path = require("path");

(async () => {
  const mp = await automator.connect({ wsEndpoint: "ws://localhost:9420" });
  try {
    await mp.reLaunch("/pages/index/index");
    await new Promise((r) => setTimeout(r, 6000));
    const page = await mp.currentPage();
    const d = await page.data();

    console.log("路径:", page.path);
    console.log("副标题:", d.sub);
    console.log("结论条:", d.ledeHead);
    if (d.top) console.log(`  领涨  ${d.top.flag} ${d.top.country} ${d.top.pct}`);
    if (d.bottom) console.log(`  垫底  ${d.bottom.flag} ${d.bottom.country} ${d.bottom.pct}`);
    console.log("  " + d.stats);
    if (d.moves && d.moves.length) console.log("  近7日名次:", d.moves.map((m) => `${m.country}${m.delta}`).join(" "));
    console.log(`\n榜单 ${d.rows.length} 行:`);
    d.rows.slice(0, 6).forEach((r) =>
      console.log(`  ${String(r.rank).padStart(2)} ${r.flag} ${r.country}  ${r.pct}  ${r.delta || ""}`));
    if (d.error) console.log("\n⚠️ 页面报错:", d.error);
    console.log("\n窗口选项:", d.winOptions.join(" | "));
    console.log("计价:", d.curOptions.join(" | "), " 榜单:", d.tierOptions.join(" | "));

    const out = path.join(__dirname, "..", "dist", "mp-home.png");
    await mp.screenshot({ path: out });
    console.log("\n截图:", out);
  } finally {
    await mp.disconnect();
  }
})().catch((e) => { console.error("失败:", e.message); process.exit(1); });
