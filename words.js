// Kho từ: dùng PostgreSQL nếu có DATABASE_URL, nếu không dùng file seed trong bộ nhớ.
const fs=require('fs'),path=require('path');
const KINDS=['Từ đơn','Từ ghép','Thành ngữ','Tục ngữ','Ca dao'];
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'db','words.seed.json'),'utf8'));
let pool=null;
if(process.env.DATABASE_URL){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL})}
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
module.exports={
  KINDS,
  async pick(kinds,n=3){
    if(pool){const r=await pool.query("SELECT text,kind FROM words WHERE status='approved' AND kind=ANY($1) ORDER BY random() LIMIT $2",[kinds,n]);if(r.rows.length>=n)return r.rows}
    return shuffle(seed.filter(w=>kinds.includes(w.kind))).slice(0,n);
  },
  async submit(text,kind,nick){
    text=String(text||'').trim().replace(/\s+/g,' ');
    if(!pool)return{ok:false,error:'Máy chủ chưa kết nối database'};
    if(text.length<2||text.length>80||!KINDS.includes(kind)||/[0-9<>]/.test(text))return{ok:false,error:'Từ không hợp lệ'};
    const r=await pool.query("INSERT INTO words(text,kind,submitted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[text,kind,String(nick).slice(0,16)]);
    return r.rowCount?{ok:true}:{ok:false,error:'Từ này đã có trong kho'};
  },
  async pending(){return pool?(await pool.query("SELECT id,text,kind,submitted_by FROM words WHERE status='pending' ORDER BY id LIMIT 100")).rows:[]},
  async review(id,status){if(pool)await pool.query("UPDATE words SET status=$2 WHERE id=$1",[id,status])}
};
