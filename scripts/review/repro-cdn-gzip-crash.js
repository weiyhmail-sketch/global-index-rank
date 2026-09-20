const https=require("https"), zlib=require("zlib"), {EventEmitter}=require("events");
let mode="";
https.get=(url,opts,cb)=>{
  const req=new EventEmitter(); req.destroy=()=>{};
  setTimeout(()=>{
    const res=new EventEmitter(); res.statusCode=200; res.resume=()=>{};
    res.headers={"content-encoding":"gzip"};
    res.pipe=(dest)=>{ res.on("data",c=>dest.write(c)); res.on("end",()=>dest.end());
                       res.on("__err",e=>dest.emit("error",e)); return dest; };
    cb(res);
    if(mode==="ok"){ const g=zlib.gzipSync(Buffer.from('{"a":1}')); res.emit("data",g); res.emit("end"); }
    if(mode==="badgzip"){ res.emit("data",Buffer.from("这不是 gzip 数据")); res.emit("end"); }
    if(mode==="socketerr"){ res.emit("data",zlib.gzipSync(Buffer.from('{"a":'))); 
      // 真实场景：响应流中途断开。res 上没有 error 监听器
      setTimeout(()=>res.emit("error",new Error("socket hang up")),5); }
  },10);
  return req;
};
const {fetchJSON}=require(require("path").join(process.cwd(),"cloudfunctions","lib","cdn.js"));
(async()=>{
  for(const m of ["ok","badgzip","socketerr"]){
    mode=m;
    try{ const r=await fetchJSON("x.json"); console.log(`${m}: ✅ 成功 ${JSON.stringify(r.data)}`);}
    catch(e){ console.log(`${m}: ⛔ 被拒「${e.message}」`); }
  }
  console.log("\n（若 socketerr 一行没打印出来、进程直接崩了，说明 res 上缺 error 监听器）");
})();
process.on("uncaughtException",(e)=>{ console.log("\n💥 未捕获异常，云函数会直接挂掉：", e.message); process.exit(9); });
