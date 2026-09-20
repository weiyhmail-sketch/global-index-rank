const automator = require("miniprogram-automator");
const path = require("path");
(async () => {
  const mp = await automator.connect({ wsEndpoint: "ws://localhost:9420" });
  try {
    await new Promise((r) => setTimeout(r, 8000));
    const page = await mp.currentPage();
    const d = await page.data();
    console.log("路径:", page.path);
    if (d.error) { console.log("⚠️ 页面报错:", d.error); }
    console.log("副标题:", d.sub || "(空)");
    console.log("结论条:", d.ledeHead || "(空)");
    if (d.top) console.log(`  领涨 ${d.top.flag} ${d.top.country} ${d.top.pct}`);
    if (d.bottom) console.log(`  垫底 ${d.bottom.flag} ${d.bottom.country} ${d.bottom.pct}`);
    if (d.stats) console.log("  " + d.stats);
    if (d.moves && d.moves.length) console.log("  近7日名次: " + d.moves.map(m=>`${m.country}${m.delta}`).join(" "));
    console.log(`榜单 ${(d.rows||[]).length} 行:`);
    (d.rows||[]).slice(0,6).forEach(r=>console.log(`  ${String(r.rank).padStart(2)} ${r.flag} ${r.country} ${r.pct} ${r.delta||""}`));
    await mp.screenshot({ path: path.join(__dirname, "..", "dist", "mp-home.png") });
    console.log("截图已存 dist/mp-home.png");
  } finally { await mp.disconnect(); }
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
