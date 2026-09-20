const fs=require("fs"),path=require("path");
const R=(f)=>JSON.parse(fs.readFileSync(path.join("dist",f),"utf8"));
const snapshot=R("snapshot.json"), monthly=R("monthly.json");
let inst=null;
global.Page=(o)=>{inst=Object.assign({},o);inst.data=Object.assign({},o.data);inst.setData=function(x){Object.assign(this.data,x)}};
global.wx={cloud:{callFunction:async({name})=>name==="get-monthly"?{result:{ok:true,...monthly}}:{result:{ok:true,...snapshot}}},stopPullDownRefresh(){},navigateTo(){}};
require(path.resolve("miniprogram/pages/index/index.js"));
(async()=>{
  await inst.load();
  inst.setData({tierIdx:2}); inst.render();   // 全部
  const d=inst.data;
  console.log("== 全部 · 人民币 · 今年以来 ==");
  console.log("结论条显示的「近7日名次变化」:", d.moves.map(m=>`${m.country}${m.delta}`).join("  "));
  const real = d.rows.filter(r=>r.delta).map(r=>({c:r.country,n:r.name,d:r.delta}))
    .sort((a,b)=>Math.abs(+b.d.slice(1))-Math.abs(+a.d.slice(1))).slice(0,4);
  console.log("真正变化最大的 4 个:      ", real.map(m=>`${m.c}${m.d}`).join("  "));
  console.log("\n全部带 delta 的行（按榜单顺序）:");
  d.rows.filter(r=>r.delta).forEach((r,i)=>console.log(`  #${r.rank} ${r.country} ${r.name} ${r.delta}`));
})();
