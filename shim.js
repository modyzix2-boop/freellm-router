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
  if(u.pathname==='/'&&req.method==='GET'&&(req.headers.accept||'').includes('text/html')){res.writeHead(302,{Location:'/ar.html'});res.end();return;}
  if(u.pathname==='/v1/client/log'){
    const LF='/app/server/data/beaconlog.json';
    if(req.method==='GET'){
      if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
      let d;try{d=JSON.parse(fs.readFileSync(LF,'utf8'));}catch(e){d={logs:[]};}
      return J(res,200,d);
    }
    if(req.method==='POST'){
      let b='';req.on('data',x=>{b+=x;if(b.length>4096)req.destroy();});
      req.on('end',()=>{try{
        const d=JSON.parse(b||'{}');
        const clean={t:d.t||Date.now(),kind:String(d.kind||'').slice(0,20),build:String(d.build||'').slice(0,20),ua:String(d.ua||'').slice(0,180),href:String(d.href||'').slice(0,40),keyPresent:!!d.keyPresent,setupShown:!!d.setupShown,w:+d.w||0,h:+d.h||0,err:String(d.err||'').slice(0,300)};
        let cur;try{cur=JSON.parse(fs.readFileSync(LF,'utf8'));}catch(e){cur={logs:[]};}
        cur.logs.push(clean);if(cur.logs.length>50)cur.logs=cur.logs.slice(-50);
        writeStore(LF,cur);
        J(res,200,{ok:true});
      }catch(e){J(res,400,{error:'bad'});}});
      return;
    }
    return J(res,405,{error:'method'});
  }
  if(u.pathname==='/v1/client/fetch'&&req.method==='POST'){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    let b='';req.on('data',x=>{b+=x;if(b.length>64*1024)req.destroy();});
    req.on('end',()=>{(async()=>{
      try{
        const d=JSON.parse(b);
        const url=String(d.url||'').trim();
        if(!/^https?:\/\/[\w.-]+\.[a-z]{2,}([/?#]|$)/i.test(url))return J(res,400,{error:'bad url'});
        const host=new URL(url).hostname;
        if(/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(host))return J(res,400,{error:'bad host'});
        const ctrl=new AbortController();const to=setTimeout(()=>ctrl.abort(),15000);
        const r=await fetch(url,{signal:ctrl.signal,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36','Accept-Language':'ar,en;q=0.8'}});
        clearTimeout(to);
        const ct=r.headers.get('content-type')||'';
        if(!r.ok)return J(res,502,{error:'الموقع رد بـ '+r.status});
        let raw=await r.text();raw=raw.slice(0,1024*1024);
        const title=(raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'';
        let text=raw.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
        J(res,200,{ok:true,url,status:r.status,type:ct.slice(0,60),title:title.trim().slice(0,200),text:text.slice(0,8000)});
      }catch(e){J(res,502,{error:String(e.message||e).slice(0,200)});}
    })();});
    return;
  }
  if(u.pathname==='/v1/client/apk/build'&&req.method==='POST'||u.pathname==='/v1/client/apk/fix'&&req.method==='POST'||u.pathname==='/v1/client/apk/status'&&req.method==='GET'){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    const GT=process.env.GITHUB_TOKEN||'',GO=process.env.GITHUB_OWNER||'';
    if(!GT||!GO)return J(res,500,{error:'github not configured'});
    const gh=async(method,path,body,raw)=>{
      const r=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+GT,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'masaedi-app'},body:body?JSON.stringify(body):undefined});
      if(raw)return r;
      if((r.status===404||r.status===409)&&method==='GET')return 404;
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.message||('github '+r.status));
      return j;
    };
    const putFile=async(repo,fp,content,msg)=>{
      const enc=fp.split('/').map(encodeURIComponent).join('/');
      const cur=await gh('GET','/repos/'+GO+'/'+repo+'/contents/'+enc);
      const body={message:msg||'تحديث',content:Buffer.from(content,'utf8').toString('base64')};
      if(cur&&cur!==404&&cur.sha)body.sha=cur.sha;
      await gh('PUT','/repos/'+GO+'/'+repo+'/contents/'+enc,body);
    };
    const pushAll=async(repo,filesMap,msg)=>{
      let ref=await gh('GET','/repos/'+GO+'/'+repo+'/git/ref/heads/main');
      let baseTree=null,parents=[];
      if(ref===404){
        const first=Object.keys(filesMap)[0];
        await putFile(repo,first,filesMap[first],msg);
        delete filesMap[first];
        if(!Object.keys(filesMap).length)return;
        ref=await gh('GET','/repos/'+GO+'/'+repo+'/git/ref/heads/main');
      }
      if(ref!==404){
        const commit=await gh('GET','/repos/'+GO+'/'+repo+'/git/commits/'+ref.object.sha);
        baseTree=commit.tree.sha;parents=[ref.object.sha];
      }
      const tb={tree:Object.keys(filesMap).map(path=>({path,mode:'100644',type:'blob',content:filesMap[path]}))};
      if(baseTree)tb.base_tree=baseTree;
      const tree=await gh('POST','/repos/'+GO+'/'+repo+'/git/trees',tb);
      const nc=await gh('POST','/repos/'+GO+'/'+repo+'/git/commits',{message:msg,tree:tree.sha,parents});
      if(ref===404)await gh('POST','/repos/'+GO+'/'+repo+'/git/refs',{ref:'refs/heads/main',sha:nc.sha});
      else await gh('PATCH','/repos/'+GO+'/'+repo+'/git/refs/heads/main',{sha:nc.sha});
    };
    const counterF=fileFor(KEY).replace('.json','.apk.json');
    if(u.pathname==='/v1/client/apk/status'){
      const repo=u.searchParams.get('repo')||'';
      if(!/^[\w][\w.-]{0,79}$/.test(repo))return J(res,400,{error:'bad repo'});
      (async()=>{try{
        const runs=await gh('GET','/repos/'+GO+'/'+repo+'/actions/runs?per_page=1');
        const run=runs&&runs.workflow_runs&&runs.workflow_runs[0];
        if(!run)return J(res,200,{state:'none'});
        J(res,200,{state:run.status,conclusion:run.conclusion,url:run.html_url,runId:run.id});
      }catch(e){J(res,502,{error:String(e.message||e).slice(0,200)});}})();
      return;
    }
    let b='';req.on('data',x=>{b+=x;if(b.length>2*1024*1024)req.destroy();});
    req.on('end',()=>{(async()=>{
      try{
        const d=JSON.parse(b);
        const repo=String(d.repo||'').trim();
        if(!/^[\w][\w.-]{0,79}$/.test(repo))return J(res,400,{error:'bad repo name'});
        if(u.pathname==='/v1/client/apk/fix'){
          // review failed run log, ask the router's model for a fix, push, re-dispatch
          const runs=await gh('GET','/repos/'+GO+'/'+repo+'/actions/runs?per_page=1');
          const run=runs&&runs.workflow_runs&&runs.workflow_runs[0];
          if(!run||run.conclusion!=='failure')return J(res,400,{error:'no failed run'});
          const jobs=await gh('GET','/repos/'+GO+'/'+repo+'/actions/runs/'+run.id+'/jobs?per_page=5');
          const job=(jobs.jobs||[]).find(x=>x.conclusion==='failure')||(jobs.jobs||[])[0];
          let logTail='';
          if(job){
            const lr=await gh('GET','/repos/'+GO+'/'+repo+'/actions/jobs/'+job.id+'/logs',null,true);
            const lt=await lr.text();
            logTail=lt.slice(-5000);
          }
          const files=['settings.gradle','build.gradle','app/build.gradle','app/src/main/AndroidManifest.xml','app/src/main/java/com/masaedi/app/MainActivity.kt','.github/workflows/build.yml'];
          const cur={};
          for(const f of files){
            const c=await gh('GET','/repos/'+GO+'/'+repo+'/contents/'+f.split('/').map(encodeURIComponent).join('/'));
            if(c&&c!==404&&c.content)cur[f]=Buffer.from(c.content,'base64').toString('utf8');
          }
          const llm=await fetch('http://127.0.0.1:'+7861+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+KEY},body:JSON.stringify({model:'gemini-3-flash-preview',temperature:0.2,messages:[
            {role:'system',content:'أنت مهندس أندرويد. بناء GitHub Actions لمشروع أندرويد فشل. هتديك جزء من اللوج والملفات الحالية. رد بصيغة JSON فقط: {"note":"سطر واحد بالعربي يشرح المشكلة والحل","files":[{"path":"مسار الملف","content":"محتواه الكامل المصلح"}]}. صلّح أقل عدد ملفات ممكن. ماتغيرش مسارات الملفات.'},
            {role:'user',content:'اللوج (آخر جزء):\n'+logTail+'\n\nالملفات الحالية:\n'+Object.keys(cur).map(f=>'--- '+f+' ---\n'+cur[f]).join('\n\n').slice(0,12000)}
          ]})});
          const ld=await llm.json();
          const txt=ld.choices&&ld.choices[0]&&ld.choices[0].message&&ld.choices[0].message.content||'';
          const mm=txt.match(/\{[\s\S]*\}/);
          const fix=mm?JSON.parse(mm[0]):null;
          if(!fix||!Array.isArray(fix.files)||!fix.files.length)return J(res,502,{error:'المراجعة مطلعتش إصلاح واضح'});
          const allowed=new Set(files.concat(['app/src/main/assets/index.html','pubspec.yaml','lib/main.dart']));
          const fm={};
          for(const f of fix.files.slice(0,6)){
            if(!allowed.has(f.path)||typeof f.content!=='string')continue;
            fm[f.path]=f.content;
          }
          if(Object.keys(fm).length)await pushAll(repo,fm,'إصلاح بناء آلي: '+(fix.note||'').slice(0,80));
          try{await gh('POST','/repos/'+GO+'/'+repo+'/actions/workflows/build.yml/dispatches',{ref:'main'});}catch(e){}
          return J(res,200,{ok:true,note:String(fix.note||'').slice(0,300)});
        }
        // build
        const html=String(d.html||'');
        if(String(d.type||'')!=='flutter'&&html.length<50)return J(res,400,{error:'html too small'});
        const appName=String(d.appName||'تطبيقي').slice(0,40);
        const exists=await gh('GET','/repos/'+GO+'/'+repo);
        if(exists===404)await gh('POST','/user/repos',{name:repo,private:false,description:'تطبيق اتبنى بأداة مساعدي 🤖'});
        let n=0;
        if(exists!==404){try{
          const bg=await gh('GET','/repos/'+GO+'/'+repo+'/contents/app/build.gradle');
          if(bg&&bg!==404&&bg.content){const m=Buffer.from(bg.content,'base64').toString('utf8').match(/versionCode\s+(\d+)/);if(m)n=+m[1];}
          if(!n){const ps=await gh('GET','/repos/'+GO+'/'+repo+'/contents/pubspec.yaml');if(ps&&ps!==404&&ps.content){const m2=Buffer.from(ps.content,'base64').toString('utf8').match(/version:\s*1\.0\.(\d+)/);if(m2)n=+m2[1];}}
        }catch(e){}}
        if(!n){let cnt={n:0};try{cnt=JSON.parse(fs.readFileSync(counterF,'utf8'));}catch(e){}n=cnt.n||0;}
        n=n+1;writeStore(counterF,{n});
        const ver='1.0.'+n;
        const WF='name: build-apk\non: [workflow_dispatch, push]\nconcurrency: {group: apk-build, cancel-in-progress: true}\npermissions:\n  contents: write\nenv:\n  VER: "'+ver+'"\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-java@v4\n        with: {distribution: temurin, java-version: "17"}\n      - uses: gradle/actions/setup-gradle@v4\n        with: {gradle-version: "8.7"}\n      - run: gradle assembleDebug --no-daemon\n      - uses: softprops/action-gh-release@v2\n        if: success()\n        with:\n          tag_name: v${{ env.VER }}\n          name: "نسخة v${{ env.VER }}"\n          files: app/build/outputs/apk/debug/app-debug.apk\n';
        const SETTINGS='pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name="app"\ninclude ":app"\n';
        const ROOT='plugins { id "com.android.application" version "8.5.0" apply false }\n';
        const APPG='plugins { id "com.android.application" }\nandroid {\n  namespace "com.masaedi.app"\n  compileSdk 34\n  defaultConfig {\n    applicationId "com.masaedi.app"\n    minSdk 24\n    targetSdk 34\n    versionCode '+n+'\n    versionName "'+ver+'"\n  }\n}\n';
        const MAN='<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-permission android:name="android.permission.INTERNET"/>\n  <application android:label="'+appName.replace(/"/g,'')+'" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:usesCleartextTraffic="true">\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n';
        const KT='package com.masaedi.app\nimport android.app.Activity\nimport android.os.Bundle\nimport android.webkit.WebView\nimport android.webkit.WebViewClient\nclass MainActivity: Activity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    val w = WebView(this)\n    w.settings.javaScriptEnabled = true\n    w.settings.domStorageEnabled = true\n    w.webViewClient = WebViewClient()\n    w.loadUrl("file:///android_asset/index.html")\n    setContentView(w)\n  }\n}\n';
        const msg='نسخة v'+ver;
        const isFlutter=String(d.type||'')==='flutter';
        if(isFlutter){
          const dart=String(d.dart||'');
          if(dart.length<100||dart.indexOf('void main')<0)return J(res,400,{error:'dart too small'});
          const PUB='name: masaedi_app\ndescription: "تطبيق اتبنى بأداة مساعدي"\npublish_to: "none"\nversion: 1.0.'+n+'+'+n+'\n\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n\ndependencies:\n  flutter:\n    sdk: flutter\n\nflutter:\n  uses-material-design: true\n';
          const FWF='name: build-apk\non: [workflow_dispatch, push]\nconcurrency: {group: apk-build, cancel-in-progress: true}\npermissions:\n  contents: write\nenv:\n  VER: "'+ver+'"\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-java@v4\n        with: {distribution: temurin, java-version: "17"}\n      - uses: subosito/flutter-action@v2\n        with: {channel: stable, cache: true}\n      - run: flutter create --platforms android --project-name masaedi_app .\n      - run: flutter build apk --debug\n      - uses: softprops/action-gh-release@v2\n        if: success()\n        with:\n          tag_name: v${{ env.VER }}\n          name: "نسخة v${{ env.VER }}"\n          files: build/app/outputs/flutter-apk/app-debug.apk\n';
          await pushAll(repo,{'pubspec.yaml':PUB,'lib/main.dart':dart,'.github/workflows/build.yml':FWF},msg);
        }else{
          await pushAll(repo,{'settings.gradle':SETTINGS,'build.gradle':ROOT,'app/build.gradle':APPG,'app/src/main/AndroidManifest.xml':MAN,'app/src/main/java/com/masaedi/app/MainActivity.kt':KT,'app/src/main/assets/index.html':html,'.github/workflows/build.yml':WF},msg);
        }
        try{await gh('POST','/repos/'+GO+'/'+repo+'/actions/workflows/build.yml/dispatches',{ref:'main'});}catch(e){}
        J(res,200,{ok:true,version:ver,repo,url:'https://github.com/'+GO+'/'+repo,apk:'https://github.com/'+GO+'/'+repo+'/releases/latest/download/app-debug.apk'});
      }catch(e){J(res,502,{error:String(e.message||e).slice(0,300)});}
    })();});
    return;
  }
  if(u.pathname==='/v1/client/github/push'&&req.method==='POST'){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    const GT=process.env.GITHUB_TOKEN||'',GO=process.env.GITHUB_OWNER||'';
    if(!GT||!GO)return J(res,500,{error:'github not configured'});
    let b='';req.on('data',x=>{b+=x;if(b.length>2*1024*1024)req.destroy();});
    req.on('end',()=>{(async()=>{
      try{
        const d=JSON.parse(b);
        const repo=String(d.repo||'').trim();
        if(!/^[\w][\w.-]{0,79}$/.test(repo))return J(res,400,{error:'bad repo name'});
        const files=Array.isArray(d.files)?d.files.slice(0,20):[];
        if(!files.length)return J(res,400,{error:'no files'});
        const msg=String(d.message||'تحديث من مساعدي').slice(0,200);
        const gh=async(method,path,body)=>{
          const r=await fetch('https://api.github.com'+path,{method,headers:{Authorization:'Bearer '+GT,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'masaedi-app'},body:body?JSON.stringify(body):undefined});
          if(r.status===404)return 404;
          const j=await r.json().catch(()=>({}));
          if(!r.ok)throw new Error(j.message||('github '+r.status));
          return j;
        };
        const exists=await gh('GET','/repos/'+GO+'/'+repo);
        if(exists===404)await gh('POST','/user/repos',{name:repo,private:!!d.private,description:'اتبنى بأداة مساعدي 🤖'});
        for(const f of files){
          const fp=String(f.path||'').replace(/\.\./g,'').replace(/^\/+/, '').slice(0,120);
          if(!fp)continue;
          const cur=await gh('GET','/repos/'+GO+'/'+repo+'/contents/'+fp.split('/').map(encodeURIComponent).join('/'));
          const body={message:msg,content:Buffer.from(String(f.content||''),'utf8').toString('base64')};
          if(cur&&cur!==404&&cur.sha)body.sha=cur.sha;
          await gh('PUT','/repos/'+GO+'/'+repo+'/contents/'+fp.split('/').map(encodeURIComponent).join('/'),body);
        }
        J(res,200,{ok:true,url:'https://github.com/'+GO+'/'+repo});
      }catch(e){J(res,502,{error:String(e.message||e).slice(0,300)});}
    })();});
    return;
  }
  if(u.pathname==='/v1/client/notes'){
    if(!KEY||(req.headers.authorization||'')!=='Bearer '+KEY)return J(res,401,{error:'unauthorized'});
    const f=fileFor(KEY).replace('.json','.notes.json');
    if(req.method==='GET'){let d;try{d=JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){d={notes:''};}return J(res,200,d);}
    if(req.method==='PUT'){
      let b='';req.on('data',x=>{b+=x;if(b.length>131072)req.destroy();});
      req.on('end',()=>{try{const d=JSON.parse(b);writeStore(f,{notes:String(d.notes||'').slice(0,20000)});J(res,200,{ok:true});}catch(e){J(res,400,{error:'bad json'});}});
      return;
    }
    return J(res,405,{error:'method'});
  }
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
