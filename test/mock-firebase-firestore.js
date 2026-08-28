const cols = { books:new Map(), podcasts:new Map() };
let settings = null;
let colL = [], docL = [];
let idSeq = 0;

window.__mock = {
  seed(name, docs){
    docs.forEach(d=>{
      const id=d.id||('seed_'+(++idSeq));
      const {id:_x,...data}=d;
      if(data.userId===undefined && window.__auth && window.__auth.current())
        data.userId = window.__auth.current().uid;
      cols[name].set(id,data);
    });
    emit(name);
  },
  dump(name){ return [...cols[name].entries()].map(([id,data])=>({id,...data})); },
  settings(){ return settings; },
  failNext:null
};

function emit(name){
  const all=[...cols[name].entries()].map(([id,data])=>({id,data:()=>JSON.parse(JSON.stringify(data))}));
  colL.filter(l=>l.name===name).forEach(l=>{
    const ws=(l.ref&&l.ref.__where)||[];
    l.next({ docs: all.filter(d=>ws.every(w=>d.data()[w.f]===w.v)) });
  });
}
function emitDoc(){
  const snap={ exists:()=>settings!==null, data:()=>(settings?{...settings}:undefined) };
  docL.forEach(l=>l.next(snap));
}

export function getFirestore(){ return {__mock:true}; }
export function initializeFirestore(){ return {__mock:true}; }
export function persistentLocalCache(){ return {__cache:true}; }
export function persistentMultipleTabManager(){ return {__tabs:true}; }
export function collection(db,name){ return {__col:name}; }
export function doc(db,col,id){ return {__col:col,__doc:id}; }
export function serverTimestamp(){ return {__ts:true}; }

export function onSnapshot(ref,next,error){
  if(ref.__col==='settings'){ docL.push({next,error}); emitDoc(); }
  else { colL.push({name:ref.__col,ref,next,error}); emit(ref.__col); }
  return ()=>{};
}
export async function addDoc(ref,data){
  if(window.__mock.failNext==='add'){ window.__mock.failNext=null; throw new Error('mock add failure'); }
  const id='doc_'+(++idSeq);
  cols[ref.__col].set(id,JSON.parse(JSON.stringify(data)));
  emit(ref.__col);
  return { id };
}
export async function updateDoc(ref,data){
  if(window.__mock.failNext==='update'){ window.__mock.failNext=null; throw new Error('mock update failure'); }
  cols[ref.__col].set(ref.__doc,{...(cols[ref.__col].get(ref.__doc)||{}),...JSON.parse(JSON.stringify(data))});
  emit(ref.__col);
}
export async function deleteDoc(ref){
  if(window.__mock.failNext==='delete'){ window.__mock.failNext=null; throw new Error('mock delete failure'); }
  cols[ref.__col].delete(ref.__doc);
  emit(ref.__col);
}
export async function setDoc(ref,data,opts){
  settings=(opts&&opts.merge&&settings)?{...settings,...data}:{...data};
  emitDoc();
}

export function query(ref, ...cs){ return { __col:ref.__col, __where:cs.filter(Boolean) }; }
export function where(f,op,v){ return { f, op, v }; }
export async function getDocs(ref){
  const all=[...cols[ref.__col].entries()].map(([id,data])=>({id,data:()=>JSON.parse(JSON.stringify(data))}));
  return { docs: applyWhere(ref, all) };
}
function applyWhere(ref, docs){
  const ws = ref.__where || [];
  return docs.filter(d => ws.every(w => d.data()[w.f] === w.v));
}
window.__mock.applyWhere = applyWhere;
