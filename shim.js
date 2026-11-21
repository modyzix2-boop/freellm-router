// Same-origin shim in front of the upstream FreeLLMAPI server.
// Serves key-scoped chat sync at /v1/client/chats* (Bearer = UNIFIED_API_KEY)
// and proxies everything else to upstream on 127.0.0.1:7861.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const UP=7861,PORT=process.env.PORT||7860,KEY=process.env.UNIFIED_API_KEY||'';
const DIR='/app/server/data/chatsync';
try{fs.mkdirSync(DIR,{recursive:true});}catch(e){}
const fileFor=k=>path.join(DIR,crypto.createHash('sha256').update(k).digest('hex')+'.json');
const readStore=f=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch(e){return{chats:{}}}};
const writeStore=(f,d)=>{try{fs.writeFileSync(f,JSON.stringify(d));}catch(e){}};
const J=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x');
  if(u.pathname==='/v1/client/memory'){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    const f=fileFor(KEY).replace('.json','.memory.json');
    if(req.method==='GET'){let d;try{d=JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){d={facts:[]};}return J(res,200,d);}
    if(req.method==='PUT'){
      let b='';req.on('data',x=>{b+=x;if(b.length>65536)req.destroy();});
      req.on('end',()=>{try{const d=JSON.parse(b);if(!Array.isArray(d.facts))return J(res,400,{error:'facts must be array'});d.facts=d.facts.slice(0,100).map(x=>String(x).slice(0,500));writeStore(f,d);J(res,200,{ok:true,count:d.facts.length});}catch(e){J(res,400,{error:'bad json'});}});
      return;
    }
    return J(res,405,{error:'method'});
  }
  if(u.pathname==='/v1/client/chats'||u.pathname.startsWith('/v1/client/chats/')){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    const f=fileFor(KEY);
    const id=decodeURIComponent(u.pathname.split('/').pop()||'');
    if(req.method==='GET'&&u.pathname==='/v1/client/chats'){
      const s=readStore(f);
      return J(res,200,{chats:Object.values(s.chats).map(c=>({id:c.id,title:c.title,updated:c.updated})).sort((a,b)=>(b.updated||0)-(a.updated||0))});
    }
    if(req.method==='GET'&&id){const c=readStore(f).chats[id];return c?J(res,200,c):J(res,404,{error:'not found'});}
    if((req.method==='PUT'||req.method==='POST')&&id){
      let b='';req.on('data',d=>{b+=d;if(b.length>4*1024*1024)req.destroy();});
      req.on('end',()=>{try{const c=JSON.parse(b);if(!Array.isArray(c.msgs))return J(res,400,{error:'msgs must be array'});const s=readStore(f);s.chats[id]={id,title:String(c.title||'محادثة').slice(0,200),msgs:c.msgs,updated:Date.now()};writeStore(f,s);J(res,200,{ok:true});}catch(e){J(res,400,{error:'bad json'});}});
      return;
    }
    if(req.method==='DELETE'&&id){const s=readStore(f);delete s.chats[id];writeStore(f,s);return J(res,200,{ok:true});}
    return J(res,405,{error:'method'});
  }
  const p=http.request({host:'127.0.0.1',port:UP,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  p.on('error',()=>J(res,502,{error:'upstream starting'}));
  req.pipe(p);
}).listen(PORT,()=>console.log('[shim] listening on '+PORT+', upstream on '+UP));
