const express=require('express'),http=require('http'),path=require('path'),crypto=require('crypto');
const {Server}=require('socket.io'),store=require('./words');
const app=express(),srv=http.createServer(app);
const io=new Server(srv,{cors:{origin:process.env.CORS_ORIGIN||false},maxHttpBufferSize:1e5});
app.use(express.json({limit:'10kb'}));
app.use(express.static(path.join(__dirname,'public')));

// ---- API kiểm duyệt từ (đặt ADMIN_TOKEN trong môi trường) ----
const admin=(q,s,n)=>process.env.ADMIN_TOKEN&&q.get('x-admin-token')===process.env.ADMIN_TOKEN?n():s.sendStatus(401);
app.get('/api/health',(q,s)=>s.json({ok:true}));
app.get('/api/words/pending',(q,s)=>admin(q,s,async()=>s.json(await store.pending())));
app.post('/api/words/:id/:action(approve|reject)',(q,s)=>admin(q,s,async()=>{await store.review(+q.params.id,q.params.action==='approve'?'approved':'rejected');s.sendStatus(204)}));

// ---- Tiện ích ----
const rooms=new Map();
const sha=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const clamp=(v,a,b,d)=>{v=parseInt(v,10);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):d};
function lev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
function rate(s,k,max,ms){const n=Date.now(),b=s.data.b||(s.data.b={}),a=(b[k]||[]).filter(t=>n-t<ms);if(a.length>=max)return false;a.push(n);b[k]=a;return true}
const newCode=()=>{let c;do c=crypto.randomBytes(3).toString('hex').toUpperCase();while(rooms.has(c));return c};

function makeRoom(o){
  const kinds=(Array.isArray(o.kinds)?o.kinds:[]).filter(k=>store.KINDS.includes(k));
  const r={code:newCode(),name:String(o.name||'Phòng mới').slice(0,24),kinds:kinds.length?kinds:['Từ ghép','Thành ngữ'],
    isPublic:!!o.isPublic,pass:o.password?sha(o.password):null,max:clamp(o.max,2,12,8),time:clamp(o.time,30,180,60),goal:clamp(o.goal,100,2000,300),
    players:new Map(),host:null,phase:'lobby',turn:0,queue:[],drawer:null,word:null,choices:[],left:0,solved:new Set(),shown:new Set(),timer:null,strokes:[]};
  rooms.set(r.code,r);return r;
}
const stop=r=>{clearTimeout(r.timer);clearInterval(r.timer);r.timer=null};
function stateFor(r,id){
  const reveal=r.phase==='reveal'||id===r.drawer;
  return{code:r.code,name:r.name,kinds:r.kinds,phase:r.phase,host:r.host,time:r.time,goal:r.goal,turn:r.turn,drawer:r.drawer,left:r.left,
    word:reveal?r.word:undefined,
    hint:r.word?[...r.word].map((c,i)=>c===' '?' ':(r.shown.has(i)?c:'_')):[],
    players:[...r.players.values()].map(p=>({id:p.id,nick:p.nick,score:p.score,solved:r.solved.has(p.id)}))};
}
const emitState=r=>r.players.forEach((_,id)=>io.to(id).emit('room:state',stateFor(r,id)));
const say=(r,text)=>io.to(r.code).emit('chat:msg',{sys:true,text});

async function nextTurn(r){
  stop(r);
  if(r.players.size<2){r.phase='lobby';r.drawer=null;r.word=null;return emitState(r)}
  let d=null;
  while(r.queue.length&&!d){const c=r.queue.shift();if(r.players.has(c))d=c}
  if(!d){r.queue=[...r.players.keys()];d=r.queue.shift()}
  Object.assign(r,{drawer:d,word:null,phase:'choosing',solved:new Set(),shown:new Set(),strokes:[],left:0});r.turn++;
  r.choices=await store.pick(r.kinds,3);
  io.to(r.code).emit('draw:clear');emitState(r);
  io.to(d).emit('game:choices',r.choices);
  r.timer=setTimeout(()=>startDrawing(r,r.choices[0].text),12000);
}
function startDrawing(r,word){
  stop(r);r.word=word;r.phase='drawing';r.left=r.time;emitState(r);
  r.timer=setInterval(()=>{
    r.left--;io.to(r.code).emit('tick',r.left);
    const len=[...r.word].filter(c=>c!==' ').length;
    if(len>3&&(r.left===Math.floor(r.time/2)||r.left===Math.floor(r.time/4))){
      const idx=[...r.word].map((c,i)=>c===' '||r.shown.has(i)?-1:i).filter(i=>i>=0);
      if(idx.length>1){r.shown.add(idx[Math.floor(Math.random()*idx.length)]);emitState(r)}}
    if(r.left<=0)endTurn(r);
  },1000);
}
function endTurn(r){
  if(r.phase!=='drawing'&&r.phase!=='choosing')return;
  stop(r);r.phase='reveal';emitState(r);
  io.to(r.code).emit('turn:end',{word:r.word});
  const top=[...r.players.values()].sort((a,b)=>b.score-a.score);
  if(top[0]&&top[0].score>=r.goal){
    io.to(r.code).emit('game:over',top.map(p=>({nick:p.nick,score:p.score})));
    r.timer=setTimeout(()=>{r.players.forEach(p=>p.score=0);r.queue=[];r.turn=0;nextTurn(r)},10000);
  }else r.timer=setTimeout(()=>nextTurn(r),5000);
}
function leave(s){
  const r=rooms.get(s.data.code);if(!r)return;
  const p=r.players.get(s.id);r.players.delete(s.id);s.leave(r.code);s.data.code=null;
  if(!r.players.size){stop(r);rooms.delete(r.code);return}
  if(r.host===s.id)r.host=r.players.keys().next().value;
  if(p)say(r,p.nick+' đã rời phòng');
  if(r.drawer===s.id&&(r.phase==='drawing'||r.phase==='choosing')){r.word=r.word||'(người vẽ đã thoát)';endTurn(r)}
  else if(r.players.size<2){stop(r);r.phase='lobby';r.drawer=null;r.word=null;emitState(r)}
  else emitState(r);
}
function join(s,r,nick,ack){
  leave(s);
  r.players.set(s.id,{id:s.id,nick:String(nick||'Khách').trim().slice(0,16)||'Khách',score:0});
  if(!r.host)r.host=s.id;
  s.join(r.code);s.data.code=r.code;
  s.emit('draw:history',r.strokes);say(r,r.players.get(s.id).nick+' đã vào phòng');
  ack&&ack({ok:true,code:r.code});emitState(r);
  if(r.phase==='lobby'&&r.players.size>=2)nextTurn(r);
}

io.on('connection',s=>{
  const room=()=>rooms.get(s.data.code);
  s.on('lobby:list',ack=>ack&&ack([...rooms.values()].filter(r=>r.isPublic).map(r=>({code:r.code,name:r.name,kinds:r.kinds,players:r.players.size,max:r.max,goal:r.goal,locked:!!r.pass}))));
  s.on('room:create',(o,ack)=>{if(!rate(s,'c',3,60000))return ack&&ack({ok:false,error:'Thao tác quá nhanh'});join(s,makeRoom(o||{}),o&&o.nick,ack)});
  s.on('room:join',(o,ack)=>{
    const r=rooms.get(String(o&&o.code||'').toUpperCase());
    if(!r)return ack&&ack({ok:false,error:'Không tìm thấy phòng'});
    if(r.players.size>=r.max)return ack&&ack({ok:false,error:'Phòng đã đầy'});
    if(r.pass&&sha(o.password||'')!==r.pass)return ack&&ack({ok:false,error:'Sai mật khẩu',needPass:true});
    join(s,r,o.nick,ack);
  });
  s.on('room:quick',(o,ack)=>{
    const r=[...rooms.values()].find(r=>r.isPublic&&!r.pass&&r.players.size<r.max&&r.players.size>0)||makeRoom({name:'Phòng công khai',isPublic:true,kinds:store.KINDS});
    join(s,r,o&&o.nick,ack);
  });
  s.on('room:leave',()=>leave(s));
  s.on('game:pick',w=>{const r=room();if(r&&r.phase==='choosing'&&s.id===r.drawer&&r.choices.some(c=>c.text===w))startDrawing(r,w)});
  s.on('draw:stroke',g=>{
    const r=room();if(!r||r.phase!=='drawing'||s.id!==r.drawer||!g||!rate(s,'d',240,1000))return;
    const n=v=>typeof v==='number'&&v>=0&&v<=1;
    if(![g.x0,g.y0,g.x1,g.y1].every(n)||!/^#[0-9a-f]{6}$/i.test(g.c)||!(g.w>=1&&g.w<=60))return;
    const seg={x0:g.x0,y0:g.y0,x1:g.x1,y1:g.y1,c:g.c,w:g.w};
    if(r.strokes.length<20000)r.strokes.push(seg);s.to(r.code).emit('draw:stroke',seg);
  });
  s.on('draw:clear',()=>{const r=room();if(r&&r.phase==='drawing'&&s.id===r.drawer){r.strokes=[];io.to(r.code).emit('draw:clear')}});
  s.on('chat:guess',txt=>{
    const r=room();if(!r||!rate(s,'g',5,3000))return;
    txt=String(txt||'').trim().slice(0,60);if(!txt)return;
    const p=r.players.get(s.id);if(!p)return;
    const insider=r.phase==='drawing'&&(s.id===r.drawer||r.solved.has(s.id));
    if(insider){[...r.solved,r.drawer].forEach(id=>io.to(id).emit('chat:msg',{nick:p.nick,text:txt,priv:true}));return}
    if(r.phase==='drawing'){
      const g=norm(txt),w=norm(r.word);
      if(g&&g===w){
        const pts=Math.round(50+100*r.left/r.time)+(r.solved.size===0?20:0);
        p.score+=pts;const d=r.players.get(r.drawer);if(d)d.score+=15;
        r.solved.add(s.id);say(r,p.nick+' đã đoán đúng! +'+pts);emitState(r);
        if(r.solved.size>=r.players.size-1)endTurn(r);
        return;
      }
      if(w.length>3&&lev(g,w)<=1)s.emit('chat:msg',{sys:true,text:'Gần đúng rồi!'});
    }
    io.to(r.code).emit('chat:msg',{nick:p.nick,text:txt});
  });
  s.on('word:submit',async(o,ack)=>{if(!rate(s,'w',3,60000))return ack&&ack({ok:false,error:'Thao tác quá nhanh'});
    const r=room(),p=r&&r.players.get(s.id);ack&&ack(await store.submit(o&&o.text,o&&o.kind,p?p.nick:'Khách'))});
  s.on('disconnect',()=>leave(s));
});
srv.listen(process.env.PORT||3000,()=>console.log('VẼ ĐI! chạy ở cổng',process.env.PORT||3000));
