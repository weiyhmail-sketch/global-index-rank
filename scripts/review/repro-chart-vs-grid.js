const fs=require("fs"),path=require("path");
const R=(f)=>JSON.parse(fs.readFileSync(path.join("dist",f),"utf8"));
const snapshot=R("snapshot.json"), monthly=R("monthly.json"), chart=R("chart/KS11.json");
let inst=null;
global.Page=(o)=>{inst=Object.assign({},o);inst.data=Object.assign({},o.data);inst.setData=function(x){Object.assign(this.data,x)}};
global.wx={cloud:{callFunction:async({name,data})=>{
  if(name==="get-monthly") return {result:{ok:true,...monthly}};
  if(name==="get-chart"){ // 忠实复刻 get-chart 的裁剪
    let {dates,local,usd,cny}=chart;
    if(data.from){const i=dates.findIndex(x=>x>=data.from);if(i>0){dates=dates.slice(i);local=local.slice(i);if(usd)usd=usd.slice(i);if(cny)cny=cny.slice(i);}}
    return {result:{ok:true,code:data.code,ccy:chart.ccy,n:dates.length,dailyFrom:chart.dailyFrom,dates,local,usd,cny}};
  }
  return {result:{ok:true,...snapshot}};
}},stopPullDownRefresh(){},navigateTo(){},setNavigationBarTitle(){},
createSelectorQuery:()=>({in:()=>({select:()=>({fields:()=>({exec:()=>{}})})})})};

(async()=>{
 // --- 首页：逆向区间 ---
 delete require.cache[require.resolve(path.resolve("miniprogram/pages/index/index.js"))];
 require(path.resolve("miniprogram/pages/index/index.js"));
 const home=inst;
 await home.load();
 home.setData({winIdx:home.wins.length,isCustom:true}); await home.ensureMonthly();
 const n=home.data.monthOptions.length;
 console.log("=== 自定义区间：正向 2025-12 → 最新 ===");
 console.log(" 前3:",home.data.rows.slice(0,3).map(r=>`${r.country} ${r.pct}`).join("  "));
 home.onM0({detail:{value:n-1}}); home.onM1({detail:{value:home.data.monthOptions.indexOf("2025-12")}});
 console.log("=== 逆向区间：", home.data.ledeHead, "===");
 console.log(" 前3:",home.data.rows.slice(0,3).map(r=>`${r.country} ${r.pct}`).join("  "));
 home.onM0({detail:{value:n-1}}); home.onM1({detail:{value:n-1}});
 console.log("=== 起止同月：", home.data.ledeHead, "===");
 console.log(" 前3:",home.data.rows.slice(0,3).map(r=>`${r.country} ${r.pct}`).join("  "), "| stats:",home.data.stats);

 // --- 详情页：真实 get-chart 裁剪下的 chartStat vs 各区间 ---
 delete require.cache[require.resolve(path.resolve("miniprogram/pages/detail/detail.js"))];
 require(path.resolve("miniprogram/pages/detail/detail.js"));
 const det=inst;
 det.onLoad({code:"KS11",cur:"cny"});
 await new Promise(r=>setTimeout(r,300));
 for (const [i,lab] of [[0,"近1月"],[1,"近3月"],[2,"近1年"],[3,"近3年"],[4,"近5年"]]) {
   await det.onRange({detail:{value:i}});
   const grid=det.data.wins.find(w=>w.label===lab);
   console.log(`详情页 ${lab}: 图表标题「${det.data.chartStat}」 vs 各区间格子「${grid?grid.pct:"?"}」`);
 }
})();
