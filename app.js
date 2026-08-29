import {
  db, auth, booksCol, podsCol,
  onSnapshot, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp,
  onAuthStateChanged, GoogleAuthProvider, signInWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from './firebase.js';
import { QUOTES } from './quotes.js';
import {
  esc, toLines, fmtRating, slPlural, normGenre, httpsify, uid,
  starHtml, ICON_Q, ICON_N, ICON_EP, EDIT_SVG, DEL_SVG,
  quotesHtml, notesHtml, marksHtml
} from './utils.js';
import { lookupBook, fetchEpisodes, lookupPodcast } from './lookups.js';

let user = null;
let unsubs = [];
function settingsRef(){ return doc(db, "settings", user ? user.uid : "app"); }

const BOOK_PALETTE = ['#E5A45B','#D98B6A','#C9A86B','#B8926E','#D4A08C','#A99270'];
const POD_PALETTE  = ['#9C8CFA','#7FA6E8','#7EC8C4','#B08CD9','#8E9BD4','#A0A8E0'];
const PALETTE = BOOK_PALETTE;
const ACC_BOOK = '#E5A45B', ACC_POD = '#9C8CFA';
const MONTHS = ['januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
const BOOK_STATUS = { read:'Prebrano', current:'Berem', wish:'Želim brati', dnf:'Opuščeno' };
const POD_STATUS  = { read:'Poslušano', current:'Poslušam', wish:'Želim poslušati', dnf:'Opuščeno' };
/* podcast state is derived from its episodes, never set by hand */
function podState(p){
  const eps=p.episodes||[];
  if(!eps.length) return { key:'wish', label:'Ni še epizod', cls:'status-wish' };
  const done=eps.filter(e=>(e.status||'read')==='read').length;
  const going=eps.some(e=>(e.status||'read')==='current');
  if(going) return { key:'current', label:'Poslušam', cls:'status-current' };
  if(done===eps.length) return { key:'read', label:'Vse poslušano', cls:'status-read' };
  return { key:'current', label:`${done} od ${eps.length} poslušanih`, cls:'status-current' };
}
function podRatingAvg(p){
  const r=(p.episodes||[]).map(e=>Number(e.rating)||0).filter(Boolean);
  return r.length ? Math.round(r.reduce((a,b)=>a+b,0)/r.length*10)/10 : 0;
}
const STATUS_CLASS = { read:'status-read', current:'status-current', wish:'status-wish', dnf:'status-dnf' };
const GENRE_SUGG = ['roman','biografija','zgodovina','kriminalka','fantazija','znanstvena fantastika','psihologija','poezija','popotniško','gore','esej','poslovno'];
const POD_GENRE_SUGG = ['pogovorni','zgodovina','znanost','politika','šport','kriminal','tehnologija','psihologija','poslovno','kultura','humor','dokumentarni'];
const SORTS = [
  { k:'new', label:'Najnovejše' }, { k:'old', label:'Najstarejše' },
  { k:'rating', label:'Najbolje ocenjeno' }, { k:'az', label:'A–Ž po naslovu' },
  { k:'author', label:'Po avtorju' }
];
const thisYear = new Date().getFullYear();

let books = [], pods = [];
let settings = { goal:null, goalYear:thisYear };
let view = 'home';
let openPodId = null;
let editingId = null, editingPodId = null, editingEpId = null, epParentId = null;
let currentSort = 'new', currentFilter = 'all', currentGenre = null;
let podFilter = 'all';
let statsPeriod = 'all';   // 'all' or a year (number) — filters the stats charts
let statCharts = [];
let expanded = new Set(), podExpanded = new Set(), epExpanded = new Set();

const $ = id => document.getElementById(id);
const statusLine = $('statusLine');

function setStatus(msg,isErr){
  if(!msg){ statusLine.classList.add('hide'); statusLine.innerHTML=''; return; }
  statusLine.classList.remove('hide');
  statusLine.classList.toggle('err',!!isErr);
  statusLine.innerHTML = isErr ? esc(msg) : `<span class="pulse"></span>${esc(msg)}`;
}

/* ---------- izbris z možnostjo razveljavitve ---------- */
/* Vnos se najprej samo odstrani iz lokalnega stanja in skrije (5 s okno z
   gumbom „Razveljavi"). Šele ob izteku okna se dejansko izbriše iz baze. */
let pendingDeletedIds = new Set();   // id-ji, ki jih sinhronizacija med oknom prezre
let pendingDelete = null;            // { ids, commit, undo }
let pendingTimer = null;

function showToast(msg){
  $('toastMsg').textContent = msg;
  $('toast').hidden = false;
}
function hideToast(){ $('toast').hidden = true; }

function armDelete({ ids, label, apply, restore, commit }){
  flushPendingDelete();                       // če je še kaj v teku, to najprej dokončaj
  ids.forEach(i=>pendingDeletedIds.add(i));
  apply();
  render();
  pendingDelete = {
    ids, commit,
    undo(){ ids.forEach(i=>pendingDeletedIds.delete(i)); restore(); render(); }
  };
  showToast(label);
  pendingTimer = setTimeout(flushPendingDelete, 5000);
}
async function flushPendingDelete(){
  if(pendingTimer){ clearTimeout(pendingTimer); pendingTimer=null; }
  const p = pendingDelete; pendingDelete = null;
  hideToast();
  if(!p) return;
  try{ await p.commit(); }
  finally{ p.ids.forEach(i=>pendingDeletedIds.delete(i)); }
}
function cancelPendingDelete(){
  if(pendingTimer){ clearTimeout(pendingTimer); pendingTimer=null; }
  pendingDelete = null;
  pendingDeletedIds.clear();
  hideToast();
}
$('toastUndo').onclick = ()=>{
  if(pendingTimer){ clearTimeout(pendingTimer); pendingTimer=null; }
  const p = pendingDelete; pendingDelete = null;
  hideToast();
  if(p) p.undo();
};
/* ---------- reusable controls ---------- */
function makeRating(rangeId, fgId, valId){
  const r=$(rangeId);
  const sync=()=>{
    const v=Number(r.value)||0;
    $(fgId).style.width=(v/5*100)+'%';
    const e=$(valId);
    e.textContent = v ? fmtRating(v) : 'brez ocene';
    e.classList.toggle('none', !v);
  };
  r.addEventListener('input',sync);
  return { set(v){ r.value=Number(v)||0; sync(); }, get(){ return Number(r.value)||0; }, sync };
}
function makeColors(rowId, pal){
  const row=$(rowId);
  let val=pal[0];
  row.innerHTML=pal.map(c=>`<div class="dot" data-color="${c}" style="background:${c}"></div>`).join('');
  const sync=()=>row.querySelectorAll('.dot').forEach(d=>d.classList.toggle('sel', d.dataset.color===val));
  row.querySelectorAll('.dot').forEach(d=>{ d.onclick=()=>{ val=d.dataset.color; sync(); }; });
  return { set(v){ val=v||pal[0]; sync(); }, get(){ return val; }, random(){ val=pal[Math.floor(Math.random()*pal.length)]; sync(); } };
}
function makeSeg(segId, onChange){
  const seg=$(segId);
  let val='read';
  const sync=()=>{ seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.status===val)); if(onChange) onChange(val); };
  seg.querySelectorAll('button').forEach(b=>{ b.onclick=()=>{ val=b.dataset.status; sync(); }; });
  return { set(v){ val=v||'read'; sync(); }, get(){ return val; } };
}
function makeGenres(tagsId, inputId, suggId, suggList){
  let items=[];
  const tags=$(tagsId), input=$(inputId), sugg=$(suggId);
  sugg.innerHTML=suggList.map(g=>`<button class="g-sugg" data-g="${g}">+ ${g}</button>`).join('');
  const render=()=>{
    tags.innerHTML=items.map(g=>`<span class="g-tag">${esc(g)}<button data-g="${esc(g)}" aria-label="Odstrani">×</button></span>`).join('');
    tags.querySelectorAll('button').forEach(b=>{ b.onclick=()=>{ items=items.filter(x=>x!==b.dataset.g); render(); }; });
    sugg.querySelectorAll('.g-sugg').forEach(s=>{ s.style.display = items.includes(s.dataset.g)?'none':''; });
  };
  const add=g=>{ const v=normGenre(g); if(!v||items.includes(v)||items.length>=8) return; items.push(v); render(); };
  sugg.querySelectorAll('.g-sugg').forEach(b=>{ b.onclick=()=>add(b.dataset.g); });
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); add(e.target.value); e.target.value=''; }});
  input.addEventListener('blur',e=>{ if(e.target.value.trim()){ add(e.target.value); e.target.value=''; }});
  return { set(v){ items=[...(v||[])]; input.value=''; render(); }, get(){ return [...items]; }, add };
}

/* ---- vrstični vnos citatov / opomb (brez ročnega dodajanja vrstic) ---- */
function makeList(wrapId, opts){
  opts = opts || {};
  const wrap = $(wrapId);
  wrap.classList.add('rep-list');
  if(opts.quotes) wrap.classList.add('quotes');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'rep-add';
  addBtn.id = wrapId + 'Add';
  addBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${opts.addLabel||'Dodaj'}</span>`;
  wrap.after(addBtn);

  function grow(ta){ ta.style.height='auto'; ta.style.height=Math.max(46, ta.scrollHeight)+'px'; }
  function ensureOne(){ if(!wrap.children.length) wrap.appendChild(item('')); }
  function item(val, animIn){
    const row = document.createElement('div');
    row.className = animIn ? 'rep-item anim-in' : 'rep-item';
    const ta = document.createElement('textarea');
    ta.rows = 1; ta.value = val || ''; ta.placeholder = opts.placeholder || '';
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'rep-del'; del.setAttribute('aria-label','Odstrani'); del.textContent = '×';
    row.append(ta, del);
    ta.addEventListener('input', ()=>grow(ta));
    ta.addEventListener('keydown', e=>{
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        const n = item('', true);
        row.after(n);
        const nt = n.querySelector('textarea'); nt.focus(); grow(nt);
      } else if(e.key === 'Backspace' && ta.value === '' && wrap.children.length > 1){
        e.preventDefault();
        const prev = row.previousElementSibling;
        row.remove();
        if(prev){ const pt = prev.querySelector('textarea'); pt.focus(); pt.setSelectionRange(pt.value.length, pt.value.length); }
        ensureOne();
      }
    });
    del.addEventListener('click', ()=>{ row.remove(); ensureOne(); });
    requestAnimationFrame(()=>grow(ta));
    return row;
  }
  addBtn.addEventListener('click', ()=>{
    const n = item('', true);
    wrap.appendChild(n);
    const nt = n.querySelector('textarea'); nt.focus();
  });
  return {
    set(arr){
      wrap.innerHTML = '';
      const list = (arr && arr.length) ? arr : [''];
      list.forEach(v=>wrap.appendChild(item(v)));
    },
    /* po odprtju okna: znova izračunaj višine (scrollHeight je 0, dokler je okno skrito) */
    reflow(){ [...wrap.querySelectorAll('textarea')].forEach(grow); },
    get(){ return [...wrap.querySelectorAll('textarea')].map(t=>t.value.trim()).filter(Boolean); },
    filled(){ return [...wrap.querySelectorAll('textarea')].some(t=>t.value.trim()); }
  };
}

function makeMore(toggleId, boxId){
  const t=$(toggleId), b=$(boxId), lbl=t.querySelector('span');
  const collapsedLabel=()=> lbl.dataset.summary ? 'Več podrobnosti · '+lbl.dataset.summary : 'Več podrobnosti';
  const set=(open, instant)=>{
    if(instant) b.classList.add('no-anim');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.classList.toggle('open', open);
    lbl.textContent = open ? 'Manj podrobnosti' : collapsedLabel();
    if(open) t.classList.remove('hint');
    // dvojni reflow: stanje se uveljavi brez animacije, nato animacijo spet vklopimo
    if(instant){ void b.offsetWidth; b.classList.remove('no-anim'); void b.offsetWidth; }
  };
  t.onclick=()=>{ t.classList.remove('hint'); set(t.getAttribute('aria-expanded')!=='true'); };
  return {
    set, open:i=>set(true,i), collapse:i=>set(false,i),
    isOpen:()=>t.getAttribute('aria-expanded')==='true',
    /* kratek povzetek, kaj je skrito notri (npr. "3 citati, 2 opombi") */
    summary(txt){ lbl.dataset.summary = txt || ''; if(t.getAttribute('aria-expanded')!=='true') lbl.textContent = collapsedLabel(); },
    /* kratek namig, da se skriva več možnosti */
    nudge(){
      if(REDUCE_MOTION || t.getAttribute('aria-expanded')==='true') return;
      t.classList.remove('hint'); void t.offsetWidth; t.classList.add('hint');
      setTimeout(()=>t.classList.remove('hint'), 2200);
    }
  };
}

const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
function runCountUp(el){
  const raw = el.dataset.count || el.textContent.trim();
  const target = +raw, dur = 900, t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = raw;
  };
  requestAnimationFrame(step);
}
/* števci se poženejo šele, ko prideš do njih z drsenjem */
let scrollAnimObs = null;
function resetScrollAnims(){
  if(scrollAnimObs) scrollAnimObs.disconnect();
  scrollAnimObs = ('IntersectionObserver' in window) ? new IntersectionObserver((ents)=>{
    ents.forEach(ent=>{
      if(!ent.isIntersecting) return;
      const el = ent.target;
      scrollAnimObs.unobserve(el);
      if(el.dataset.count) runCountUp(el);
      if(el.dataset.revealChart) buildChartsIn(el);
      el.classList.add('rv-in');
    });
  }, { threshold:0.25, rootMargin:'0px 0px -8% 0px' }) : null;
}
function observeScrollAnim(el){
  if(!scrollAnimObs){ if(el.dataset.count) runCountUp(el); if(el.dataset.revealChart) buildChartsIn(el); el.classList.add('rv-in'); return; }
  scrollAnimObs.observe(el);
}
function countUp(el){
  const raw = el.textContent.trim();
  if(!/^\d{2,}$/.test(raw)) return;   // le cela števila >= 10
  if(REDUCE_MOTION) return;
  el.dataset.count = raw;
  el.textContent = '0';
  observeScrollAnim(el);
}

const bookRating = makeRating('fRating','rateFg','rateVal');
const epRating   = makeRating('eRating','eRateFg','eRateVal');
const bookColor  = makeColors('colorRow', BOOK_PALETTE);
const podColor   = makeColors('pColorRow', POD_PALETTE);
const bookMore   = makeMore('bookMoreToggle','bookMore');
const podMore    = makeMore('podMoreToggle','podMore');
const epMore     = makeMore('epMoreToggle','epMore');
let sheetLoading = false;
const bookStatus = makeSeg('statusSeg', v=>{
  $('pageAtWrap').style.display = (v==='current'||v==='dnf')?'':'none';
  if(!sheetLoading && (v==='current'||v==='dnf')) bookMore.open();
});
const epStatus   = makeSeg('eStatusSeg');
const bookGenres = makeGenres('genreTags','genreInput','genreSugg',GENRE_SUGG);
const podGenres  = makeGenres('pGenreTags','pGenreInput','pGenreSugg',POD_GENRE_SUGG);
const bookQuotes = makeList('fQuotes',{ quotes:true, placeholder:'Citat…', addLabel:'Dodaj citat' });
const bookNotes  = makeList('fNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });
const epQuotes   = makeList('eQuotes',{ quotes:true, placeholder:'Citat…', addLabel:'Dodaj citat' });
const epNotes    = makeList('eNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });
const podNotes   = makeList('pNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });

let bookCover = '';
let podCover  = '';
let podItunesId = null;

const monthSel=$('fMonth');
monthSel.innerHTML=`<option value="">Mesec —</option>`+MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
const yearSel=$('fYear');
let yo=`<option value="">Leto —</option>`;
for(let y=thisYear;y>=thisYear-40;y--) yo+=`<option value="${y}">${y}</option>`;
yearSel.innerHTML=yo;

/* ---------- lookups ---------- */
let epCatalog = [];   // fetched episode list for the podcast being edited
let epCatalogFor = null;


$('lookupBtn').onclick=async()=>{
  const title=$('fTitle').value.trim(), author=$('fAuthor').value.trim();
  if(!title){ $('lookupTxt').textContent='Najprej vpiši naslov.'; $('fTitle').focus(); return; }
  const btn=$('lookupBtn'); btn.disabled=true; $('lookupTxt').textContent='Iščem…';
  const res=await lookupBook(title,author);
  btn.disabled=false;
  if(!res){ $('lookupTxt').textContent='Nič najdenega. Vpiši ročno.'; return; }
  const filled=[];
  if(res.cover){ bookCover=res.cover; renderPrev('lookupPrev',bookCover); filled.push('naslovnica'); }
  if(res.author && !$('fAuthor').value.trim()){ $('fAuthor').value=res.author; filled.push('avtor'); }
  if(res.pages && !$('fPages').value.trim()){ $('fPages').value=res.pages; filled.push('strani'); }
  if(res.published && !$('fPublished').value.trim()){ $('fPublished').value=res.published; filled.push('leto izida'); }
  if(res.genres?.length){ const b=bookGenres.get().length; res.genres.forEach(bookGenres.add); if(bookGenres.get().length>b) filled.push('žanri'); }
  $('lookupTxt').textContent = filled.length ? 'Izpolnjeno: '+filled.join(', ')+'.' : 'Najdeno, a vsa polja so že izpolnjena.';
};

$('pLookupBtn').onclick=async()=>{
  const name=$('pTitle').value.trim();
  if(!name){ $('pLookupTxt').textContent='Najprej vpiši ime.'; $('pTitle').focus(); return; }
  const btn=$('pLookupBtn'); btn.disabled=true; $('pLookupTxt').textContent='Iščem…';
  const res=await lookupPodcast(name);
  btn.disabled=false;
  if(!res){ $('pLookupTxt').textContent='Nič najdenega. Vpiši ročno.'; return; }
  const filled=[];
  if(res.itunesId){ podItunesId=res.itunesId; filled.push('katalog epizod'); }
  if(res.cover){ podCover=res.cover; renderPrev('pLookupPrev',podCover); filled.push('naslovnica'); }
  if(res.host && !$('pHost').value.trim()){ $('pHost').value=res.host; filled.push('voditelj'); }
  if(res.genres?.length){ const b=podGenres.get().length; res.genres.forEach(podGenres.add); if(podGenres.get().length>b) filled.push('žanri'); }
  $('pLookupTxt').textContent = filled.length ? 'Izpolnjeno: '+filled.join(', ')+'.' : 'Najdeno, a vsa polja so že izpolnjena.';
};

function renderPrev(id,url){
  const el=$(id);
  if(url) el.innerHTML=`<img src="${esc(url)}" alt="">`;
  else el.textContent='brez';
}

/* ---------- navigation ---------- */
function goTo(v){
  view=v;
  $('homeView').style.display      = v==='home' ? '' : 'none';
  $('booksView').style.display     = v==='books' ? '' : 'none';
  $('podsView').style.display      = v==='pods' ? '' : 'none';
  $('podDetailView').style.display = v==='podDetail' ? '' : 'none';
  $('statsView').style.display     = v==='stats' ? '' : 'none';
  $('quotesView').style.display    = v==='quotes' ? '' : 'none';
  $('navHome').classList.toggle('on', v==='home');
  $('navBooks').classList.toggle('on', v==='books');
  $('navPods').classList.toggle('on', v==='pods' || v==='podDetail');
  $('navStats').classList.toggle('on', v==='stats');
  $('addBtn').style.visibility = (v==='stats'||v==='quotes') ? 'hidden' : '';
  const navAcc = (v==='books') ? 'var(--acc-book)' : (v==='pods'||v==='podDetail') ? 'var(--acc-pod)' : 'var(--cloud)';
  document.querySelector('.nav').style.setProperty('--acc', navAcc);
  render();
  const VIEW_EL = { home:'homeView', books:'booksView', pods:'podsView', podDetail:'podDetailView', stats:'statsView', quotes:'quotesView' };
  const av = $(VIEW_EL[v]);
  if(av){ av.classList.remove('view-in'); void av.offsetWidth; av.classList.add('view-in'); }
}
$('navHome').onclick =()=>{ openPodId=null; goTo('home'); };
$('navBooks').onclick=()=>{ openPodId=null; goTo('books'); };
$('navPods').onclick =()=>{ openPodId=null; goTo('pods'); };
$('navStats').onclick=()=>goTo('stats');
$('logoBtn').onclick=()=>{
  openPodId=null;
  goTo('home');
  $('search').value=''; $('podSearch').value='';
  currentFilter='all'; currentGenre=null; currentSort='new'; podFilter='all';
  $('filterRow').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.filter==='all'));
  $('podFilterRow').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.filter==='all'));
  expanded.clear(); podExpanded.clear(); epExpanded.clear();
  render();
  window.scrollTo({top:0,behavior:'smooth'});
};

$('addBtn').onclick=()=>{
  if(view==='pods') openPodSheet(null);
  else if(view==='podDetail') openEpSheet(openPodId,null);
  else if(view==='home') openAddPicker();
  else openSheet(null);
};
function openAddPicker(){ $('addPickOverlay').classList.add('open'); }
function closeAddPicker(){ $('addPickOverlay').classList.remove('open'); }
$('addPickOverlay').onclick=e=>{ if(e.target.id==='addPickOverlay') closeAddPicker(); };
$('pickBook').onclick=()=>{ closeAddPicker(); goTo('books'); openSheet(null); };
$('pickPod').onclick =()=>{ closeAddPicker(); goTo('pods');  openPodSheet(null); };


/* ---------- book filters ---------- */
$('filterRow').querySelectorAll('.chip').forEach(c=>{
  c.onclick=()=>{ $('filterRow').querySelectorAll('.chip').forEach(x=>x.classList.remove('active')); c.classList.add('active'); currentFilter=c.dataset.filter; render(); };
});
$('podFilterRow').querySelectorAll('.chip').forEach(c=>{
  c.onclick=()=>{ $('podFilterRow').querySelectorAll('.chip').forEach(x=>x.classList.remove('active')); c.classList.add('active'); podFilter=c.dataset.filter; render(); };
});

function openSort(){
  $('sortOpts').innerHTML=SORTS.map(s=>`
    <button class="opt ${s.k===currentSort?'on':''}" data-sort="${s.k}">
      <span>${s.label}</span>
      <span class="opt-tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
    </button>`).join('');
  $('sortOpts').querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ currentSort=o.dataset.sort; $('sortOverlay').classList.remove('open'); render(); }; });
  $('sortOverlay').classList.add('open');
}
$('sortBtn').onclick=openSort;
$('sortOverlay').onclick=e=>{ if(e.target.id==='sortOverlay') $('sortOverlay').classList.remove('open'); };

function genreCounts(){
  const c={};
  books.forEach(b=>(b.genres||[]).forEach(g=>{ c[g]=(c[g]||0)+1; }));
  return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'sl'));
}
function openGenre(){
  const list=genreCounts();
  const tick=`<span class="opt-tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  $('genreOpts').innerHTML =
    `<button class="opt ${currentGenre?'':'on'}" data-genre=""><span>Vsi žanri</span>${tick}</button>`+
    (list.length ? list.map(([g,c])=>`<button class="opt ${currentGenre===g?'on':''}" data-genre="${esc(g)}"><span>${esc(g)}</span><span class="opt-count">${c}</span>${tick}</button>`).join('')
                 : `<p class="empty-sub" style="padding:14px 4px">Ni še nobenega žanra.</p>`);
  $('genreOpts').querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ currentGenre=o.dataset.genre||null; $('genreOverlay').classList.remove('open'); render(); }; });
  $('genreOverlay').classList.add('open');
}
$('genreBtn').onclick=openGenre;
$('genreOverlay').onclick=e=>{ if(e.target.id==='genreOverlay') $('genreOverlay').classList.remove('open'); };

function sortItems(arr){
  const a=[...arr];
  switch(currentSort){
    case 'old': return a.sort((x,y)=>(x.createdAtMs||0)-(y.createdAtMs||0));
    case 'rating': return a.sort((x,y)=>(Number(y.rating)||0)-(Number(x.rating)||0)||(y.createdAtMs||0)-(x.createdAtMs||0));
    case 'az': return a.sort((x,y)=>(x.title||'').localeCompare(y.title||'','sl'));
    case 'author': return a.sort((x,y)=>((x.author||x.host||'')).localeCompare(y.author||y.host||'','sl'));
    default: return a.sort((x,y)=>(y.createdAtMs||0)-(x.createdAtMs||0));
  }
}

/* ---------- render dispatch ---------- */
function render(){
  if(view==='home') return renderHome();
  if(view==='stats') return renderStats();
  if(view==='quotes') return renderQuotes();
  if(view==='pods') return renderPods();
  if(view==='podDetail') return renderPodDetail();
  renderBooks();
}


/* ---------- home ---------- */
function coverMini(item, kind){
  const initial=(item.title||'?').trim().charAt(0);
  const color=item.color||(kind==='pod'?POD_PALETTE[0]:BOOK_PALETTE[0]);
  const inner=item.coverUrl
    ? `<img src="${esc(item.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span>${esc(initial)}</span>'">`
    : `<span>${esc(initial)}</span>`;
  return `<span class="mini-cover ${kind==='pod'?'square':''}" style="background:${color}">${inner}</span>`;
}

/* deterministic pick — same quote all day, new one at midnight */
function dayIndex(){
  const d=new Date();
  const days=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
  return days;
}
function quoteOfDay(){
  const own=[];
  books.forEach(b=>toLines(b.quotes).forEach(t=>own.push({text:t,author:b.author||'',src:b.title})));
  pods.forEach(p=>(p.episodes||[]).forEach(e=>toLines(e.quotes).forEach(t=>own.push({text:t,author:p.host||'',src:p.title+' · '+e.title}))));
  const i=dayIndex();
  // every third day, if there are enough of your own, show one of yours
  if(own.length>=3 && i%3===0) return { ...own[i%own.length], mine:true };
  const q=QUOTES[i%QUOTES.length].split('|');
  return { text:q[0], author:q[1], src:'', mine:false };
}

function qCount(){
  let n=0;
  books.forEach(b=>{ n+=toLines(b.quotes).length; });
  pods.forEach(p=>(p.episodes||[]).forEach(e=>{ n+=toLines(e.quotes).length; }));
  return n;
}
function firstName(){
  const n=(user&&(user.displayName||''))||'';
  return n.split(' ')[0]||'';
}

function renderHome(){
  const v=$('homeView');
  const h=new Date().getHours();
  const nm=firstName();
  const greet = (h<5?'Lahko noč' : h<11?'Dobro jutro' : h<18?'Dober dan' : 'Dober večer') + (nm?', '+nm:'');

  const readingNow = books.filter(b=>(b.status||'read')==='current');
  const listenNow  = pods.filter(p=>podState(p).key==='current');
  const doneBooks  = books.filter(b=>(b.status||'read')==='read');
  const epCount    = pods.reduce((s,p)=>s+(p.episodes||[]).length,0);

  const goal=Number(settings.goal)||0;
  const doneThisYear=doneBooks.filter(b=>b.readYear===thisYear).length;
  const goalPct=goal?Math.min(100,doneThisYear/goal*100):0;

  const recent=[
    ...books.map(b=>({...b,_kind:'book'})),
    ...pods.map(p=>({...p,_kind:'pod'}))
  ].sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0)).slice(0,3);

  const miniRow=(item,kind,sub)=>`
    <button class="mini" data-kind="${kind}" data-id="${item.id}" style="--mini-acc:${kind==='pod'?ACC_POD:ACC_BOOK}">
      ${coverMini(item,kind)}
      <span class="mini-info">
        <span class="mini-kind">${kind==='pod'?'Podcast':'Knjiga'}</span>
        <p class="mini-title">${esc(item.title)}</p>
        <p class="mini-sub">${esc(sub||'')}</p>
      </span>
      <span class="hub-go" style="position:static"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
    </button>`;

  const inProgress=[
    ...readingNow.map(b=>{
      const pages=Number(b.pages)||0, at=Number(b.pageAt)||0;
      const sub = pages&&at ? `${Math.round(at/pages*100)}% · stran ${at} od ${pages}` : (b.author||'');
      return miniRow(b,'book',sub);
    }),
    ...listenNow.map(p=>miniRow(p,'pod',`${(p.episodes||[]).length} ${(p.episodes||[]).length===1?'epizoda':'epizod'}`))
  ];

  const qd=quoteOfDay();
  const nudge=(()=>{
    if(!books.length && !pods.length)
      return 'Začni s <b>prvo knjigo</b>. Aplikacija postane zanimiva, ko se citati začnejo nabirati.';
    if(!inProgress.length)
      return 'Nič ni v teku. <b>Kaj bi rad začel?</b> Na seznamu želja te čaka nekaj branja.';
    const noQuotes = doneBooks.length && !doneBooks.some(b=>toLines(b.quotes).length);
    if(noQuotes)
      return 'Prebral si nekaj knjig, a <b>brez zapisanih citatov</b>. Naslednjič si zapiši en stavek — čez leto boš vesel.';
    if(goal && doneThisYear<goal){
      const left=goal-doneThisYear;
      const monthsLeft=12-new Date().getMonth();
      return `Do cilja ti manjka <b>${left} ${left===1?'knjiga':left===2?'knjigi':left<=4?'knjige':'knjig'}</b>, do konca leta pa je še ${monthsLeft} ${monthsLeft===1?'mesec':monthsLeft===2?'meseca':monthsLeft<=4?'meseci':'mesecev'}.`;
    }
    const epTotal=pods.reduce((s,p)=>s+(p.episodes||[]).filter(e=>(e.status||'read')==='read').length,0);
    return `Zbral si <b>${qCount()} ${qCount()===1?'citat':qCount()===2?'citata':qCount()<=4?'citate':'citatov'}</b> iz ${doneBooks.length+epTotal} prebranih in poslušanih stvari. Lepa polica.`;
  })();

  v.innerHTML=`
    <h2 class="greet">${esc(greet)}</h2>
    <p class="greet-sub">${
      inProgress.length
        ? `Imaš ${inProgress.length} ${inProgress.length===1?'stvar':'stvari'} v teku.`
        : 'Kaj boš danes bral ali poslušal?'}</p>

    <div class="qday">
      <div class="qday-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 5C6 5 3.5 7.7 3.5 11.2c0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Zm10 0c-3.5 0-6 2.7-6 6.2 0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Z"/></svg>
        ${qd.mine?'Iz tvojih zapiskov':'Misel dneva'}
      </div>
      <p class="qday-text"><span class="qday-mark">\u201E</span>${esc(qd.text)}<span class="qday-mark">\u201C</span></p>
      ${qd.author?`<p class="qday-author">${esc(qd.author)}</p>`:''}
      ${qd.src?`<p class="qday-src">${esc(qd.src)}</p>`:''}
      ${qCount()?`<button class="qday-all" id="qdayAll">Prebrskaj vse citate (${qCount()}) \u2192</button>`:''}
    </div>

    <div class="nudge">
      <span class="nudge-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg></span>
      <p>${nudge}</p>
    </div>

    <div class="hub">
      <button class="hub-card" id="hubBooks" style="--hub:${ACC_BOOK}">
        <span class="hub-go"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        <span class="hub-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        <p class="hub-name">Knjige</p>
        <p class="hub-count"><b>${books.length}</b> v zbirki · ${doneBooks.length} prebranih</p>
      </button>
      <button class="hub-card" id="hubPods" style="--hub:${ACC_POD}">
        <span class="hub-go"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        <span class="hub-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4"/></svg></span>
        <p class="hub-name">Podcasti</p>
        <p class="hub-count"><b>${pods.length}</b> v zbirki · ${epCount} epizod</p>
      </button>
    </div>

    <div class="home-block">
      <div class="home-sec"><h3>V teku</h3></div>
      ${inProgress.length ? inProgress.join('')
        : `<p class="home-empty">Nič v teku. Odpri knjigo ali podcast in nastavi status na „Berem" oziroma „Poslušam".</p>`}
    </div>

    ${goal ? `
    <div class="home-block">
      <div class="home-sec"><h3>Letni cilj</h3><button class="more" id="homeGoal">statistika</button></div>
      <div class="goal-card" style="margin-bottom:0">
        <div class="goal-nums">${doneThisYear} <small>/ ${goal} knjig v ${thisYear}</small></div>
        <span class="goal-track"><span class="goal-fill" style="width:${goalPct.toFixed(0)}%"></span></span>
        <span class="goal-note">${doneThisYear>=goal?'Cilj dosežen. Bravo!':`Še ${goal-doneThisYear} do cilja.`}</span>
      </div>
    </div>` : ''}

    ${recent.length ? `
    <div class="home-block">
      <div class="home-sec"><h3>Nazadnje dodano</h3></div>
      ${recent.map(r=>miniRow(r, r._kind==='pod'?'pod':'book', r._kind==='pod'?(r.host||''):(r.author||''))).join('')}
    </div>` : ''}
  `;

  $('hubBooks').onclick=()=>goTo('books');
  $('hubPods').onclick =()=>goTo('pods');
  const hg=$('homeGoal'); if(hg) hg.onclick=()=>goTo('stats');
  const qa=$('qdayAll'); if(qa) qa.onclick=()=>goTo('quotes');
  v.querySelectorAll('.mini').forEach(el=>{
    el.onclick=()=>{
      const id=el.dataset.id;
      if(el.dataset.kind==='pod'){ openPodId=id; epExpanded.clear(); goTo('podDetail'); window.scrollTo({top:0}); }
      else { expanded.add(id); goTo('books'); setTimeout(()=>{
        const card=document.querySelector(`#list .entry[data-id="${id}"]`);
        if(card) card.scrollIntoView({block:'center'});
      },60); }
    };
  });
}

/* ---------- books ---------- */
function renderBooks(){
  const list=$('list');
  const q=$('search').value.trim().toLowerCase();
  const counts={all:books.length,read:0,current:0,wish:0,dnf:0};
  books.forEach(b=>{ const s=b.status||'read'; if(counts[s]!==undefined) counts[s]++; });
  ['all','read','current','wish','dnf'].forEach(k=>{ $('c-'+k).textContent=counts[k]||''; });

  $('sortLabel').textContent=(SORTS.find(s=>s.k===currentSort)||SORTS[0]).label;
  $('sortBtn').classList.toggle('on', currentSort!=='new');
  $('genreLabel').textContent=currentGenre||'Žanri';
  $('genreBtn').classList.toggle('on', !!currentGenre);

  let shown=books;
  if(currentFilter!=='all') shown=shown.filter(b=>(b.status||'read')===currentFilter);
  if(currentGenre) shown=shown.filter(b=>(b.genres||[]).includes(currentGenre));
  if(q) shown=shown.filter(b=>
    (b.title||'').toLowerCase().includes(q)||
    (b.author||'').toLowerCase().includes(q)||
    toLines(b.notes).join(' ').toLowerCase().includes(q)||
    toLines(b.quotes).join(' ').toLowerCase().includes(q)||
    (b.genres||[]).some(g=>g.includes(q)));
  shown=sortItems(shown);

  if(!shown.length){
    const f=q||currentFilter!=='all'||currentGenre;
    list.innerHTML=`<div class="empty"><div class="empty-icon">${books.length?'🔍':'📖'}</div>
      <p class="empty-title">${books.length?'Ni zadetkov':'Polica je prazna'}</p>
      <p class="empty-sub">${f?'Poskusi z drugim iskanjem ali filtrom.':'Pritisni + in dodaj prvo knjigo.'}</p></div>`;
    return;
  }
  list.innerHTML=shown.map(bookCard).join('');
  list.querySelectorAll('.entry').forEach(el=>{
    const id=el.dataset.id;
    el.querySelector('.entry-head').onclick=()=>{ expanded.has(id)?expanded.delete(id):expanded.add(id); el.classList.toggle('open',expanded.has(id)); };
    el.querySelector('.editBtn').onclick=ev=>{ ev.stopPropagation(); openSheet(id); };
    el.querySelector('.deleteBtn').onclick=ev=>{ ev.stopPropagation(); removeBook(id); };
    const qa=el.querySelector('.qa-input');
    const qQ=el.querySelector('.qa-quote'), qN=el.querySelector('.qa-note');
    const qaSync=()=>{
      qa.style.height='auto'; qa.style.height=Math.max(44,qa.scrollHeight)+'px';
      const has=!!qa.value.trim();
      qQ.classList.toggle('filled',has); qN.classList.toggle('filled',has);
    };
    qa.addEventListener('input',qaSync);
    qQ.onclick=ev=>{ ev.stopPropagation(); const v=qa.value.trim(); if(!v) return; qa.value=''; qaSync(); quickAdd(id,'quotes',v); };
    qN.onclick=ev=>{ ev.stopPropagation(); const v=qa.value.trim(); if(!v) return; qa.value=''; qaSync(); quickAdd(id,'notes',v); };
  });
}
async function quickAdd(id, field, text){
  const b=books.find(x=>x.id===id); if(!b) return;
  const next=toLines(b[field]).concat(text.trim());
  try{
    await updateDoc(doc(db,"books",id),{[field]:next});
    setStatus(field==='quotes'?'Citat dodan':'Opomba dodana');
    setTimeout(()=>{ if(statusLine.textContent==='Citat dodan'||statusLine.textContent==='Opomba dodana') setStatus(''); },1600);
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
}

function bookCard(b){
  const color=b.color||BOOK_PALETTE[0];
  const initial=(b.title||'?').trim().charAt(0);
  const st=b.status||'read';
  const isOpen=expanded.has(b.id);
  const quotes=toLines(b.quotes), notes=toLines(b.notes);
  const pages=Number(b.pages)||0, pageAt=Number(b.pageAt)||0;
  const dateTxt=fmtReadDate(b);
  const coverHtml=b.coverUrl
    ? `<img src="${esc(b.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const progress=(st==='current'||st==='dnf')&&pages&&pageAt
    ? `<span class="prog-wrap"><span class="prog-track"><span class="prog-fill" style="width:${Math.min(100,pageAt/pages*100).toFixed(0)}%"></span></span>
       <span class="prog-txt">stran ${pageAt} od ${pages} · ${Math.min(100,Math.round(pageAt/pages*100))}%</span></span>` : '';
  const details=[];
  if(pages) details.push(`<span class="pill">${pages} str.</span>`);
  if(b.published) details.push(`<span class="pill">izid ${esc(b.published)}</span>`);
  (b.genres||[]).forEach(g=>details.push(`<span class="pill genre">${esc(g)}</span>`));

  return `<div class="entry ${isOpen?'open':''}" data-id="${b.id}" style="--spine:${color}">
    <div class="entry-head">
      <div class="cover" style="background:${color}">${coverHtml}</div>
      <div class="entry-info">
        <p class="entry-title">${esc(b.title)}</p>
        <p class="entry-author">${esc(b.author)}</p>
        <div class="meta-row">
          <span class="status-tag ${STATUS_CLASS[st]}">${BOOK_STATUS[st]}</span>
          ${starHtml(b.rating)}
          ${dateTxt?`<span class="date-tag">${esc(dateTxt)}</span>`:''}
          ${marksHtml(quotes.length,notes.length,0)}
        </div>
        ${progress}
      </div>
      <span class="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div>
    <div class="entry-body"><div class="reveal-inner">
      ${details.length?`<div class="detail-row">${details.join('')}</div>`:''}
      ${quotesHtml(quotes)}${notesHtml(notes)}
      <div class="quick-add">
        <textarea class="qa-input" rows="1" placeholder="Med branjem: zapiši citat ali misel…"></textarea>
        <div class="qa-btns">
          <button type="button" class="qa-btn qa-quote">${ICON_Q} Kot citat</button>
          <button type="button" class="qa-btn qa-note">${ICON_N} Kot opomba</button>
        </div>
      </div>
      <div class="entry-actions">
        <button class="act-btn editBtn">${EDIT_SVG} Uredi</button>
        <button class="act-btn danger deleteBtn">${DEL_SVG} Izbriši</button>
      </div>
    </div></div></div>`;
}

function fmtReadDate(b){
  const y=b.readYear,m=b.readMonth;
  if(y&&m) return `${MONTHS[m-1]} ${y}`;
  if(y) return String(y);
  return '';
}
function fmtEpDate(iso){
  if(!iso) return '';
  const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return String(iso);
  return `${Number(m[3])}. ${MONTHS[Number(m[2])-1]} ${m[1]}`;
}

/* ---------- podcasts ---------- */
function renderPods(){
  const list=$('podList');
  const q=$('podSearch').value.trim().toLowerCase();
  const counts={all:pods.length,read:0,current:0,wish:0,dnf:0};
  pods.forEach(p=>{ const s=podState(p).key; if(counts[s]!==undefined) counts[s]++; });
  ['all','read','current','wish','dnf'].forEach(k=>{ $('pc-'+k).textContent=counts[k]||''; });

  let shown=pods;
  if(podFilter!=='all') shown=shown.filter(p=>podState(p).key===podFilter);
  if(q) shown=shown.filter(p=>
    (p.title||'').toLowerCase().includes(q)||
    (p.host||'').toLowerCase().includes(q)||
    (p.genres||[]).some(g=>g.includes(q))||
    toLines(p.notes).join(' ').toLowerCase().includes(q)||
    (p.episodes||[]).some(e=>
      (e.title||'').toLowerCase().includes(q)||
      toLines(e.notes).join(' ').toLowerCase().includes(q)||
      toLines(e.quotes).join(' ').toLowerCase().includes(q)));
  shown=sortItems(shown);

  if(!shown.length){
    const f=q||podFilter!=='all';
    list.innerHTML=`<div class="empty"><div class="empty-icon">${pods.length?'🔍':'🎧'}</div>
      <p class="empty-title">${pods.length?'Ni zadetkov':'Ni še podcastov'}</p>
      <p class="empty-sub">${f?'Poskusi z drugim iskanjem ali filtrom.':'Pritisni + in dodaj prvi podcast.'}</p></div>`;
    return;
  }
  list.innerHTML=shown.map(podCard).join('');
  list.querySelectorAll('.entry').forEach(el=>{
    el.querySelector('.entry-head').onclick=()=>{ openPodId=el.dataset.id; epExpanded.clear(); goTo('podDetail'); window.scrollTo({top:0}); };
  });
}

function podCard(p){
  const color=p.color||POD_PALETTE[0];
  const initial=(p.title||'?').trim().charAt(0);
  const state=podState(p);
  const eps=p.episodes||[];
  const notes=toLines(p.notes);
  const coverHtml=p.coverUrl
    ? `<img src="${esc(p.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const epQ=eps.reduce((s,e)=>s+toLines(e.quotes).length,0);
  const epN=eps.reduce((s,e)=>s+toLines(e.notes).length,0);
  const avg=podRatingAvg(p);
  return `<div class="entry" data-id="${p.id}" style="--spine:${color}">
    <div class="entry-head">
      <div class="cover square" style="background:${color}">${coverHtml}</div>
      <div class="entry-info">
        <p class="entry-title">${esc(p.title)}</p>
        <p class="entry-author">${esc(p.host)}</p>
        <div class="meta-row">
          <span class="status-tag ${state.cls}">${state.label}</span>
          ${starHtml(avg)}
          ${marksHtml(epQ, notes.length+epN, eps.length)}
        </div>
      </div>
      <span class="chev" style="transform:rotate(-90deg)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div></div>`;
}

function renderPodDetail(){
  const p=pods.find(x=>x.id===openPodId);
  const v=$('podDetailView');
  if(!p){ openPodId=null; goTo('pods'); return; }

  const color=p.color||POD_PALETTE[0];
  const initial=(p.title||'?').trim().charAt(0);
  const state=podState(p);
  const avg=podRatingAvg(p);
  const notes=toLines(p.notes);
  const eps=[...(p.episodes||[])].sort((a,b)=>{
    const da=a.date||'', dbb=b.date||'';
    if(da&&dbb) return dbb.localeCompare(da);
    if(da) return -1;
    if(dbb) return 1;
    return (Number(b.num)||0)-(Number(a.num)||0);
  });
  const coverHtml=p.coverUrl
    ? `<img src="${esc(p.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const details=(p.genres||[]).map(g=>`<span class="pill genre">${esc(g)}</span>`);
  const totalMin=eps.reduce((s,e)=>s+(Number(e.minutes)||0),0);
  if(totalMin) details.unshift(`<span class="pill">${fmtRating(Math.round(totalMin/60*10)/10)} h poslušanja</span>`);

  v.innerHTML=`
    <div class="back-bar">
      <button class="back-btn" id="podBack">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Podcasti
      </button>
    </div>
    <div class="pod-hero">
      <div class="cover square" style="background:${color}; width:96px; height:96px; border-radius:14px">${coverHtml}</div>
      <div class="pod-hero-info">
        <h2>${esc(p.title)}</h2>
        <p class="host">${esc(p.host)}</p>
        <div class="meta-row">
          <span class="status-tag ${state.cls}">${state.label}</span>
          ${avg?starHtml(avg):''}
        </div>
      </div>
    </div>
    ${details.length?`<div class="detail-row" style="border-top:none; padding-top:0">${details.join('')}</div>`:''}
    ${notesHtml(notes)}
    <div class="entry-actions">
      <button class="act-btn" id="podEdit">${EDIT_SVG} Uredi podcast</button>
      <button class="act-btn danger" id="podDelete">${DEL_SVG} Izbriši</button>
    </div>

    <div class="ep-head">
      <h3>Epizode${eps.length?` <span class="rank-cnt">${eps.length}</span>`:''}</h3>
      <button class="ep-add" id="epAdd">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Epizoda
      </button>
    </div>
    <div class="ep-list" id="epList">${
      eps.length ? eps.map((e,i)=>epRow(e,eps.length-i)).join('')
      : `<div class="empty" style="padding:36px 20px"><p class="empty-title">Ni še epizod</p><p class="empty-sub">Dodaj prvo epizodo tega podcasta.</p></div>`
    }</div>`;

  $('podBack').onclick=()=>{ openPodId=null; goTo('pods'); };
  $('podEdit').onclick=()=>openPodSheet(p.id);
  $('podDelete').onclick=()=>removePod(p.id);
  $('epAdd').onclick=()=>openEpSheet(p.id,null);
  v.querySelectorAll('.ep').forEach(el=>{
    const eid=el.dataset.eid;
    el.querySelector('.ep-row').onclick=()=>{ epExpanded.has(eid)?epExpanded.delete(eid):epExpanded.add(eid); el.classList.toggle('open',epExpanded.has(eid)); };
    el.querySelector('.epEdit').onclick=ev=>{ ev.stopPropagation(); openEpSheet(p.id,eid); };
    el.querySelector('.epDel').onclick=ev=>{ ev.stopPropagation(); removeEpisode(p.id,eid); };
    const qa=el.querySelector('.qa-input');
    const qQ=el.querySelector('.qa-quote'), qN=el.querySelector('.qa-note');
    const qaSync=()=>{
      qa.style.height='auto'; qa.style.height=Math.max(44,qa.scrollHeight)+'px';
      const has=!!qa.value.trim();
      qQ.classList.toggle('filled',has); qN.classList.toggle('filled',has);
    };
    qa.addEventListener('input',qaSync);
    qQ.onclick=ev=>{ ev.stopPropagation(); const val=qa.value.trim(); if(!val) return; qa.value=''; qaSync(); quickAddEp(p.id,eid,'quotes',val); };
    qN.onclick=ev=>{ ev.stopPropagation(); const val=qa.value.trim(); if(!val) return; qa.value=''; qaSync(); quickAddEp(p.id,eid,'notes',val); };
  });
}
async function quickAddEp(podId, epId, field, text){
  const p=pods.find(x=>x.id===podId); if(!p) return;
  const list=(p.episodes||[]).map(e=>{
    if(e.id!==epId) return e;
    return { ...e, [field]: toLines(e[field]).concat(text.trim()) };
  });
  try{
    await updateDoc(doc(db,"podcasts",podId),{episodes:list});
    setStatus(field==='quotes'?'Citat dodan':'Opomba dodana');
    setTimeout(()=>{ if(statusLine.textContent==='Citat dodan'||statusLine.textContent==='Opomba dodana') setStatus(''); },1600);
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
}

function epRow(e,idx){
  const st=e.status||'read';
  const quotes=toLines(e.quotes), notes=toLines(e.notes);
  const isOpen=epExpanded.has(e.id);
  const dateTxt=fmtEpDate(e.date);
  const bits=[];
  if(e.minutes) bits.push(`<span class="date-tag">${esc(e.minutes)} min</span>`);
  if(dateTxt) bits.push(`<span class="date-tag">${esc(dateTxt)}</span>`);
  const badge = e.num ? esc(e.num) : idx;
  return `<div class="ep ${isOpen?'open':''}" data-eid="${e.id}">
    <div class="ep-row">
      <span class="ep-idx" title="${e.num?'Št. epizode':'Zaporedna'}">${badge}</span>
      <div class="ep-info">
        <p class="ep-title">${esc(e.title)}</p>
        <div class="ep-meta">
          <span class="status-tag ${STATUS_CLASS[st]}">${POD_STATUS[st]}</span>
          ${starHtml(e.rating)}
          ${bits.join('')}
          ${marksHtml(quotes.length,notes.length,0)}
        </div>
      </div>
      <span class="chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div>
    <div class="ep-body"><div class="reveal-inner">
      ${quotesHtml(quotes)}${notesHtml(notes)}
      <div class="quick-add">
        <textarea class="qa-input" rows="1" placeholder="Med poslušanjem: zapiši citat ali misel…"></textarea>
        <div class="qa-btns">
          <button type="button" class="qa-btn qa-quote">${ICON_Q} Kot citat</button>
          <button type="button" class="qa-btn qa-note">${ICON_N} Kot opomba</button>
        </div>
      </div>
      <div class="entry-actions">
        <button class="act-btn epEdit">${EDIT_SVG} Uredi</button>
        <button class="act-btn danger epDel">${DEL_SVG} Izbriši</button>
      </div>
    </div></div></div>`;
}

/* ---------- stats ---------- */
const GENRE_COLORS = ['#E5A45B','#9C8CFA','#7EC8C4','#E38FB4','#77C293','#D98B6A','#8E9BD4','#C9A86B'];

function epYM(iso){ const m=/^(\d{4})-(\d{2})/.exec(String(iso||'')); return m?{y:+m[1],m:+m[2]}:null; }

function statYears(){
  const s=new Set();
  books.forEach(b=>{ if(b.readYear) s.add(+b.readYear); });
  pods.forEach(p=>(p.episodes||[]).forEach(e=>{ const d=epYM(e.date); if(d) s.add(d.y); }));
  return [...s].sort((a,b)=>b-a);
}

let pendingCharts = [];
function destroyStatCharts(){
  statCharts.forEach(c=>{ try{ c.destroy(); }catch(e){} });
  statCharts=[];
  pendingCharts=[];
}
/* zgradi vse še nezgrajene grafe, ki ležijo v podani kartici */
function buildChartsIn(cardEl){
  if(!window.Chart) return;
  pendingCharts = pendingCharts.filter(pc=>{
    const el=$(pc.id);
    if(!el || !cardEl.contains(el)) return true;
    try{ statCharts.push(new Chart(el.getContext('2d'), pc.config)); }catch(e){ console.warn('chart',pc.id,e); }
    return false;
  });
  window.__statCharts = statCharts;
}

function withChartLib(fn){
  if(window.Chart) return fn();
  let n=0;
  const t=setInterval(()=>{
    if(window.Chart){ clearInterval(t); fn(); }
    else if(n++>40){ clearInterval(t); }
  },100);
}

function chartCommonOpts(){
  const cs=getComputedStyle(document.documentElement);
  const grid=cs.getPropertyValue('--line-soft').trim()||'#20252C';
  const tick=cs.getPropertyValue('--text-faint').trim()||'#6D7480';
  return { grid, tick,
    legend:{ position:'bottom', labels:{ boxWidth:9, boxHeight:9, usePointStyle:true, padding:14,
      color:cs.getPropertyValue('--text-soft').trim()||'#A3AAB5', font:{ family:"'Literata',Georgia,serif" } } } };
}

function buildStatChart(id, config){
  const el=$(id); if(!el) return;
  pendingCharts.push({ id, config });   // dejansko se zgradi ob drsenju do kartice
}

function buildStatCharts(){
  const co=chartCommonOpts();
  const yearSel = statsPeriod==='all' ? null : Number(statsPeriod);
  const barScales = {
    x:{ grid:{ display:false }, ticks:{ color:co.tick, font:{ size:11 } } },
    y:{ beginAtZero:true, ticks:{ precision:0, stepSize:1, color:co.tick, font:{ size:11 } }, grid:{ color:co.grid } }
  };
  const baseOpts = { responsive:true, maintainAspectRatio:false, animation:{ duration:1100, easing:'easeOutQuart' },
    plugins:{ legend:co.legend, tooltip:{ boxPadding:6 } } };

  const doneBooks=books.filter(b=>(b.status||'read')==='read');
  const allEps=pods.flatMap(p=>(p.episodes||[]).map(e=>({...e,pod:p.title})));
  const doneEps=allEps.filter(e=>(e.status||'read')==='read');

  /* --- 1. Aktivnost skozi čas --- */
  let labels, bookData, epData;
  if(yearSel){
    labels = MONTHS.map(m=>m.slice(0,3));
    bookData = Array(12).fill(0); epData = Array(12).fill(0);
    doneBooks.forEach(b=>{ if(+b.readYear===yearSel && b.readMonth) bookData[b.readMonth-1]++; });
    doneEps.forEach(e=>{ const d=epYM(e.date); if(d && d.y===yearSel) epData[d.m-1]++; });
  } else {
    const ys=statYears().slice().reverse();
    labels = ys.length?ys:[thisYear];
    bookData = labels.map(y=>doneBooks.filter(b=>+b.readYear===y).length);
    epData   = labels.map(y=>doneEps.filter(e=>{ const d=epYM(e.date); return d && d.y===y; }).length);
    labels = labels.map(String);
  }
  if(bookData.some(n=>n) || epData.some(n=>n)){
    buildStatChart('chAktivnost', { type:'bar',
      data:{ labels, datasets:[
        { label:'Knjige', data:bookData, backgroundColor:ACC_BOOK, borderRadius:4, maxBarThickness:34 },
        { label:'Epizode', data:epData, backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:34 } ] },
      options:{ ...baseOpts, scales:barScales } });
  }

  /* --- 2. Razdelitev ocen --- */
  const bBuck=[0,0,0,0,0], eBuck=[0,0,0,0,0];
  books.forEach(b=>{ const r=Number(b.rating); if(r>0 && (!yearSel || +b.readYear===yearSel)) bBuck[Math.min(4,Math.round(r)-1)]++; });
  allEps.forEach(e=>{ const r=Number(e.rating); const d=epYM(e.date);
    if(r>0 && (!yearSel || (d && d.y===yearSel))) eBuck[Math.min(4,Math.round(r)-1)]++; });
  if(bBuck.some(n=>n) || eBuck.some(n=>n)){
    buildStatChart('chOcene', { type:'bar',
      data:{ labels:['1★','2★','3★','4★','5★'], datasets:[
        { label:'Knjige', data:bBuck, backgroundColor:ACC_BOOK, borderRadius:4, maxBarThickness:40 },
        { label:'Epizode', data:eBuck, backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:40 } ] },
      options:{ ...baseOpts, scales:barScales } });
  }

  /* --- 3. Žanri (knjige) --- */
  const gc={};
  books.forEach(b=>{ if(!yearSel || +b.readYear===yearSel) (b.genres||[]).forEach(g=>{ gc[g]=(gc[g]||0)+1; }); });
  const gTop=Object.entries(gc).sort((a,b)=>b[1]-a[1]).slice(0,7);
  if(gTop.length){
    buildStatChart('chZanri', { type:'doughnut',
      data:{ labels:gTop.map(g=>g[0]), datasets:[{ data:gTop.map(g=>g[1]),
        backgroundColor:GENRE_COLORS, borderColor:getComputedStyle(document.documentElement).getPropertyValue('--card').trim()||'#1A1E24', borderWidth:2 }] },
      options:{ ...baseOpts, cutout:'56%',
        plugins:{ legend:{ ...co.legend, position:'right' }, tooltip:{ boxPadding:6 } } } });
  }

  /* --- 4. Epizode po podcastih --- */
  const podEp=pods.map(p=>[p.title,(p.episodes||[]).filter(e=>!yearSel || (epYM(e.date)||{}).y===yearSel).length])
    .filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(podEp.length){
    buildStatChart('chPods', { type:'bar',
      data:{ labels:podEp.map(x=>x[0]), datasets:[{ label:'Epizode', data:podEp.map(x=>x[1]),
        backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:26 }] },
      options:{ ...baseOpts, indexAxis:'y', plugins:{ legend:{ display:false }, tooltip:{ boxPadding:6 } },
        scales:{ x:{ beginAtZero:true, ticks:{ precision:0, stepSize:1, color:co.tick }, grid:{ color:co.grid } },
                 y:{ grid:{ display:false }, ticks:{ color:co.tick, font:{ size:11 } } } } } });
  }
}

function renderStats(){
  destroyStatCharts();
  const v=$('statsView');
  const read=books.filter(b=>(b.status||'read')==='read');
  const rated=books.filter(b=>Number(b.rating)>0);
  const avg=rated.length?rated.reduce((s,b)=>s+Number(b.rating),0)/rated.length:0;

  const yearCount={};
  read.forEach(b=>{ if(b.readYear) yearCount[b.readYear]=(yearCount[b.readYear]||0)+1; });

  const authorCount={};
  books.forEach(b=>{ const a=(b.author||'').trim(); if(a) authorCount[a]=(authorCount[a]||0)+1; });
  const topAuthors=Object.entries(authorCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const topGenres=genreCounts().slice(0,6);
  const topRated=[...rated].sort((a,b)=>Number(b.rating)-Number(a.rating)).slice(0,5);

  const doneThisYear=yearCount[thisYear]||0;
  const totalPages=read.reduce((s,b)=>s+(Number(b.pages)||0),0);

  const allEps=pods.flatMap(p=>(p.episodes||[]).map(e=>({...e,pod:p.title})));
  const epsDone=allEps.filter(e=>(e.status||'read')==='read');
  const epMinutes=epsDone.reduce((s,e)=>s+(Number(e.minutes)||0),0);
  const epRated=allEps.filter(e=>Number(e.rating)>0);
  const epAvg=epRated.length?epRated.reduce((s,e)=>s+Number(e.rating),0)/epRated.length:0;
  const topEps=[...epRated].sort((a,b)=>Number(b.rating)-Number(a.rating)).slice(0,5);

  const quoteTotal = books.reduce((s,b)=>s+toLines(b.quotes).length,0)
    + pods.reduce((s,p)=>s+(p.episodes||[]).reduce((t,e)=>t+toLines(e.quotes).length,0),0);

  const goal=Number(settings.goal)||0;
  const goalPct=goal?Math.min(100,doneThisYear/goal*100):0;
  const left=Math.max(0,goal-doneThisYear);
  const tick=n=>n===1?'knjiga':n===2?'knjigi':n<=4?'knjige':'knjig';

  const years=statYears();
  if(statsPeriod!=='all' && !years.includes(Number(statsPeriod))) statsPeriod='all';
  const chip=(k,lbl)=>`<button class="chip ${String(statsPeriod)===String(k)?'active':''}" data-period="${k}">${lbl}</button>`;
  const chipsRow = `<div class="stat-chips">${chip('all','Vse')}${years.map(y=>chip(y,y)).join('')}</div>`;

  v.innerHTML=`
    <div class="goal-card">
      <div class="goal-top"><span class="goal-label">Letni cilj ${thisYear}</span>
      <button class="goal-edit" id="goalEditBtn">${goal?'spremeni':'nastavi'}</button></div>
      ${goal?`<div class="goal-nums">${doneThisYear} <small>/ ${goal} knjig</small></div>
        <span class="goal-track"><span class="goal-fill" style="width:${goalPct.toFixed(0)}%"></span></span>
        <span class="goal-note">${doneThisYear>=goal?'Cilj dosežen. Bravo!':`Še ${left} ${tick(left)} do cilja.`}</span>`
      :`<div class="goal-none">Nastavi cilj in spremljaj napredek skozi leto.</div>`}
    </div>

    <div class="stat-section-title" style="margin-top:6px">Knjige</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-num">${books.length}</div><div class="stat-lbl">Vseh vnosov</div></div>
      <div class="stat-box"><div class="stat-num">${read.length}</div><div class="stat-lbl">Prebranih</div></div>
      <div class="stat-box"><div class="stat-num">${avg?fmtRating(Math.round(avg*10)/10):'—'}</div><div class="stat-lbl">Povprečna ocena</div></div>
      <div class="stat-box"><div class="stat-num">${totalPages?totalPages.toLocaleString('sl'):'—'}</div><div class="stat-lbl">Prebranih strani</div></div>
    </div>

    <div class="stat-section-title">Podcasti</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-num">${pods.length}</div><div class="stat-lbl">Podcastov</div></div>
      <div class="stat-box"><div class="stat-num">${epsDone.length}</div><div class="stat-lbl">Poslušanih epizod</div></div>
      <div class="stat-box"><div class="stat-num">${epMinutes?Math.round(epMinutes/60):'—'}</div><div class="stat-lbl">Ur poslušanja</div></div>
      <div class="stat-box"><div class="stat-num">${epAvg?fmtRating(Math.round(epAvg*10)/10):'—'}</div><div class="stat-lbl">Povpr. ocena epizod</div></div>
    </div>

    <div class="stat-grid" style="margin-top:10px">
      <div class="stat-box"><div class="stat-num">${quoteTotal||'—'}</div><div class="stat-lbl">Zapisanih citatov</div></div>
      <div class="stat-box"><div class="stat-num">${topGenres.length||'—'}</div><div class="stat-lbl">Žanrov pri knjigah</div></div>
    </div>

    <div class="stat-section-title">Grafi</div>
    ${(books.length||pods.length)?`
    ${chipsRow}
    <div class="chart-card"><h4>Aktivnost ${statsPeriod==='all'?'po letih':'v letu '+statsPeriod}</h4>
      <div class="chart-box"><canvas id="chAktivnost"></canvas></div>
      <div class="chart-empty" id="emAktivnost" style="display:none">Za to obdobje ni podatkov z datumom.</div></div>
    <div class="chart-card"><h4>Razdelitev ocen</h4>
      <div class="chart-box"><canvas id="chOcene"></canvas></div>
      <div class="chart-empty" id="emOcene" style="display:none">Še ni ocenjenih vnosov.</div></div>
    <div class="chart-card"><h4>Žanri knjig</h4>
      <div class="chart-box tall"><canvas id="chZanri"></canvas></div>
      <div class="chart-empty" id="emZanri" style="display:none">Dodaj žanre pri knjigah.</div></div>
    <div class="chart-card"><h4>Epizode po podcastih</h4>
      <div class="chart-box"><canvas id="chPods"></canvas></div>
      <div class="chart-empty" id="emPods" style="display:none">Še ni epizod.</div></div>`
    :`<p class="empty-sub">Ko dodaš prve knjige in epizode, se tu pokažejo grafi.</p>`}

    ${topAuthors.length?`<div class="stat-section-title">Najpogostejši avtorji</div>
      ${topAuthors.map(([a,c])=>`<div class="rank-row"><span class="rank-name">${esc(a)}</span><span class="rank-cnt">${c}×</span></div>`).join('')}`:''}

    ${topRated.length?`<div class="stat-section-title">Najbolje ocenjene knjige</div>
      ${topRated.map(b=>`<div class="rank-row"><span class="rank-name">${esc(b.title)}</span><span>${starHtml(b.rating)}</span></div>`).join('')}`:''}

    ${topEps.length?`<div class="stat-section-title">Najbolje ocenjene epizode</div>
      ${topEps.map(e=>`<div class="rank-row"><span class="rank-name">${esc(e.title)}<br><span class="rank-cnt">${esc(e.pod)}</span></span><span>${starHtml(e.rating)}</span></div>`).join('')}`:''}
  `;
  const gb=$('goalEditBtn');
  if(gb) gb.onclick=openGoalSheet;
  resetScrollAnims();
  v.querySelectorAll('.stat-num').forEach(countUp);
  v.querySelectorAll('.stat-chips .chip').forEach(c=>{
    c.onclick=()=>{ const p=c.dataset.period; statsPeriod = p==='all'?'all':Number(p); renderStats(); };
  });
  withChartLib(()=>{
    if(view!=='stats') return;
    buildStatCharts();                       // samo registrira, kaj se bo zgradilo
    window.__statCharts = statCharts;
    [['chAktivnost','emAktivnost'],['chOcene','emOcene'],['chZanri','emZanri'],['chPods','emPods']].forEach(([cid,eid])=>{
      const has=pendingCharts.some(pc=>pc.id===cid);
      const box=$(cid)?.closest('.chart-box'); const em=$(eid);
      if(box) box.style.display = has?'':'none';
      if(em) em.style.display = has?'none':'';
    });
    /* graf se zgradi (in zanimira) šele, ko prideš do kartice z drsenjem */
    v.querySelectorAll('.chart-card').forEach(card=>{
      if(card.querySelector('.chart-box')?.style.display==='none') return;
      card.dataset.revealChart='1';
      observeScrollAnim(card);
    });
  });
}

/* ---------- pregled citatov ---------- */
let quoteSearch = '';
let quoteKind = 'all';   // 'all' | 'book' | 'pod'

function allQuotes(){
  const out = [];
  books.forEach(b=>toLines(b.quotes).forEach(t=>out.push({
    text:t, who:b.author||'', src:b.title||'', kind:'book', id:b.id, ts:b.createdAtMs||0
  })));
  pods.forEach(p=>(p.episodes||[]).forEach(e=>toLines(e.quotes).forEach(t=>out.push({
    text:t, who:p.host||'', src:(p.title||'')+' · '+(e.title||''), kind:'pod', id:p.id, epId:e.id, ts:p.createdAtMs||0
  }))));
  return out.sort((a,b)=>b.ts-a.ts);
}

function qbCard(x){
  return `<button class="qb-card" data-kind="${x.kind}" data-id="${esc(x.id)}"${x.epId?` data-ep="${esc(x.epId)}"`:''}
      style="--acc:${x.kind==='pod'?ACC_POD:ACC_BOOK}">
    <div class="quote-item" style="margin-bottom:9px">${esc(x.text)}</div>
    <div class="qb-src">${esc(x.src)}${x.who?` · ${esc(x.who)}`:''}</div>
  </button>`;
}

function renderQuotes(){
  const v = $('quotesView');
  const all = allQuotes();
  const bookN = all.filter(x=>x.kind==='book').length;
  const podN  = all.filter(x=>x.kind==='pod').length;
  const q = quoteSearch.trim().toLowerCase();

  let shown = all;
  if(quoteKind!=='all') shown = shown.filter(x=>x.kind===quoteKind);
  if(q) shown = shown.filter(x=>
    x.text.toLowerCase().includes(q) ||
    x.who.toLowerCase().includes(q) ||
    x.src.toLowerCase().includes(q));

  const searchIcon = `<span class="s-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>`;
  const chip = (k,lbl)=>`<button class="chip ${quoteKind===k?'active':''}" data-kind="${k}">${lbl}</button>`;

  v.innerHTML = `
    <div class="back-bar"><button class="back-btn" id="qbBack">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      Domov
    </button></div>
    <h2 class="greet" style="margin-bottom:4px">Citati</h2>
    <p class="greet-sub">${all.length
      ? `${all.length} ${slPlural(all.length,['zapisan citat','zapisana citata','zapisani citati','zapisanih citatov'])}`
      : 'Še brez zapisanih citatov.'}</p>
    ${all.length ? `
    <div class="search-bar">${searchIcon}
      <input class="search" id="qbSearch" type="text" placeholder="Išči po besedilu, avtorju, viru…" value="${esc(quoteSearch)}">
    </div>
    ${(bookN && podN) ? `<div class="chip-row">${chip('all','Vsi')}${chip('book','Knjige')}${chip('pod','Podcasti')}</div>` : ''}
    ` : ''}
    <div class="grid">
      ${shown.length ? shown.map(qbCard).join('')
        : `<div class="empty"><div class="empty-icon">${all.length?'🔍':'✍️'}</div>
           <p class="empty-title">${all.length?'Ni zadetkov':'Še brez citatov'}</p>
           <p class="empty-sub">${all.length?'Poskusi z drugim iskanjem ali filtrom.':'Citate zapišeš pri knjigi ali epizodi.'}</p></div>`}
    </div>`;

  $('qbBack').onclick = ()=>goTo('home');
  const s = $('qbSearch');
  if(s){
    s.oninput = ()=>{
      const c = s.selectionStart;
      quoteSearch = s.value;
      renderQuotes();
      const ns = $('qbSearch');
      if(ns){ ns.focus(); try{ ns.setSelectionRange(c,c); }catch(e){} }
    };
  }
  v.querySelectorAll('.chip[data-kind]').forEach(c=>{
    c.onclick = ()=>{ quoteKind = c.dataset.kind; renderQuotes(); };
  });
  v.querySelectorAll('.qb-card').forEach(el=>{
    el.onclick = ()=>{
      const id = el.dataset.id;
      if(el.dataset.kind==='pod'){
        openPodId = id; epExpanded.clear();
        if(el.dataset.ep) epExpanded.add(el.dataset.ep);
        goTo('podDetail'); window.scrollTo({top:0});
      } else {
        expanded.add(id); goTo('books');
        setTimeout(()=>{
          const card = document.querySelector(`#list .entry[data-id="${id}"]`);
          if(card) card.scrollIntoView({block:'center'});
        }, 60);
      }
    };
  });
}

/* ---------- goal ---------- */
function openGoalSheet(){
  $('goalYearTxt').textContent=thisYear;
  $('fGoal').value=settings.goal||'';
  $('goalOverlay').classList.add('open');
  setTimeout(()=>$('fGoal').focus(),80);
}
$('goalCancel').onclick=()=>$('goalOverlay').classList.remove('open');
$('goalOverlay').onclick=e=>{ if(e.target.id==='goalOverlay') $('goalOverlay').classList.remove('open'); };
$('goalSave').onclick=async()=>{
  const raw=$('fGoal').value.trim();
  const n=raw===''?null:Math.max(0,Math.floor(Number(raw)));
  if(raw!==''&&(!Number.isFinite(n)||n<=0)){ $('fGoal').focus(); return; }
  const b=$('goalSave'); b.disabled=true;
  try{ await setDoc(settingsRef(),{goal:n,goalYear:thisYear,userId:user.uid},{merge:true}); $('goalOverlay').classList.remove('open'); }
  catch(e){ console.error(e); setStatus('Cilja ni bilo mogoče shraniti.',true); }
  finally{ b.disabled=false; }
};

/* ---------- book sheet ---------- */
function openSheet(id){
  editingId=id||null;
  sheetLoading=true;
  if(id){
    const b=books.find(x=>x.id===id);
    $('sheetTitle').textContent='Uredi knjigo';
    $('fTitle').value=b.title||''; $('fAuthor').value=b.author||'';
    bookQuotes.set(toLines(b.quotes));
    bookNotes.set(toLines(b.notes));
    $('fPages').value=b.pages||''; $('fPageAt').value=b.pageAt||'';
    $('fPublished').value=b.published||'';
    bookColor.set(b.color||BOOK_PALETTE[0]); bookStatus.set(b.status||'read');
    bookRating.set(b.rating); bookGenres.set(b.genres);
    bookCover=b.coverUrl||'';
    monthSel.value=b.readMonth?String(b.readMonth):'';
    yearSel.value=b.readYear?String(b.readYear):'';
  } else {
    $('sheetTitle').textContent='Nova knjiga';
    ['fTitle','fAuthor','fPages','fPageAt','fPublished'].forEach(k=>{ $(k).value=''; });
    bookQuotes.set([]); bookNotes.set([]);
    bookColor.random(); bookStatus.set('read'); bookRating.set(0); bookGenres.set([]);
    bookCover=''; monthSel.value=''; yearSel.value='';
  }
  // povzetek, kaj je skrito pod "Več podrobnosti"
  const sum=[];
  const nq=bookQuotes.get().length, nn=bookNotes.get().length;
  if(nq) sum.push(nq+' '+slPlural(nq,['citat','citata','citati','citatov']));
  if(nn) sum.push(nn+' '+slPlural(nn,['opomba','opombi','opombe','opomb']));
  if($('fPages').value || $('fPageAt').value || $('fPublished').value) sum.push('strani');
  if(bookGenres.get().length) sum.push(slPlural(bookGenres.get().length,['žanr','žanra','žanri','žanrov']));
  bookMore.summary(sum.join(', '));
  bookMore.collapse(true);
  if(!sum.length) setTimeout(()=>bookMore.nudge(), 480);
  $('lookupTxt').textContent=bookCover?'Podatki nastavljeni.':'Vpiši naslov in pritisni Poišči.';
  renderPrev('lookupPrev',bookCover);
  $('overlay').classList.add('open');
  $('overlay').querySelector('.sheet').scrollTop=0;
  sheetLoading=false;
  setTimeout(()=>{
    if(!editingId) $('fTitle').focus({preventScroll:true});   // pri urejanju ne sprožamo tipkovnice
    $('overlay').querySelector('.sheet').scrollTop=0;
    bookQuotes.reflow(); bookNotes.reflow();
  },80);
}
function closeSheet(){ $('overlay').classList.remove('open'); editingId=null; }
const num=v=>{ const s=String(v).trim(); return s===''?null:(Math.max(0,Math.floor(Number(s)))||null); };

async function saveBook(){
  const title=$('fTitle').value.trim();
  if(!title){ $('fTitle').focus(); return; }
  const payload={
    title, author:$('fAuthor').value.trim(),
    quotes:bookQuotes.get(), notes:bookNotes.get(),
    genres:bookGenres.get(), color:bookColor.get(), status:bookStatus.get(),
    rating:bookRating.get(), pages:num($('fPages').value), pageAt:num($('fPageAt').value),
    published:num($('fPublished').value),
    readMonth:monthSel.value?Number(monthSel.value):null,
    readYear:yearSel.value?Number(yearSel.value):null,
    coverUrl:bookCover||''
  };
  const b=$('saveBtn'); b.disabled=true;
  try{
    if(editingId) await updateDoc(doc(db,"books",editingId),payload);
    else await addDoc(booksCol,{...payload,userId:user.uid,createdAtMs:Date.now(),createdAt:serverTimestamp()});
    closeSheet();
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
}
function removeBook(id){
  const idx=books.findIndex(x=>x.id===id);
  if(idx<0) return;
  const snap=books[idx];
  armDelete({
    ids:[id], label:'Knjiga izbrisana',
    apply(){ books.splice(idx,1); expanded.delete(id); },
    restore(){ books.splice(Math.min(idx,books.length),0,snap); },
    commit(){ return deleteDoc(doc(db,"books",id)).catch(e=>{ console.error(e); setStatus('Brisanje ni uspelo.',true); }); }
  });
}
$('cancelBtn').onclick=closeSheet;
$('saveBtn').onclick=saveBook;
$('overlay').onclick=e=>{ if(e.target.id==='overlay') closeSheet(); };
$('search').oninput=render;
$('podSearch').oninput=render;

/* ---------- podcast sheet ---------- */
function openPodSheet(id){
  editingPodId=id||null;
  if(id){
    const p=pods.find(x=>x.id===id);
    $('podSheetTitle').textContent='Uredi podcast';
    $('pTitle').value=p.title||''; $('pHost').value=p.host||'';
    podNotes.set(toLines(p.notes));
    podColor.set(p.color||POD_PALETTE[0]); podGenres.set(p.genres);
    podItunesId = p.itunesId || null;
    podCover=p.coverUrl||'';
  } else {
    $('podSheetTitle').textContent='Nov podcast';
    ['pTitle','pHost'].forEach(k=>{ $(k).value=''; });
    podNotes.set([]);
    podColor.random(); podGenres.set([]);
    podItunesId = null;
    podCover='';
  }
  const psum=[];
  const pnn=podNotes.get().length;
  if(pnn) psum.push(pnn+' '+slPlural(pnn,['opomba','opombi','opombe','opomb']));
  if(podGenres.get().length) psum.push(slPlural(podGenres.get().length,['žanr','žanra','žanri','žanrov']));
  podMore.summary(psum.join(', '));
  podMore.collapse(true);
  if(!psum.length) setTimeout(()=>podMore.nudge(), 480);
  $('pLookupTxt').textContent=podCover?'Podatki nastavljeni.':'Vpiši ime in pritisni Poišči.';
  renderPrev('pLookupPrev',podCover);
  $('podOverlay').classList.add('open');
  $('podOverlay').querySelector('.sheet').scrollTop=0;
  setTimeout(()=>{ if(!editingPodId) $('pTitle').focus({preventScroll:true}); $('podOverlay').querySelector('.sheet').scrollTop=0; podNotes.reflow(); },80);
}
function closePodSheet(){ $('podOverlay').classList.remove('open'); editingPodId=null; }
$('podCancel').onclick=closePodSheet;
$('podOverlay').onclick=e=>{ if(e.target.id==='podOverlay') closePodSheet(); };
$('podSave').onclick=async()=>{
  const title=$('pTitle').value.trim();
  if(!title){ $('pTitle').focus(); return; }
  const payload={
    title, host:$('pHost').value.trim(),
    notes:podNotes.get(),
    genres:podGenres.get(), color:podColor.get(),
    itunesId:podItunesId||null, coverUrl:podCover||''
  };
  const b=$('podSave'); b.disabled=true;
  try{
    if(editingPodId) await updateDoc(doc(db,"podcasts",editingPodId),payload);
    else {
      const ref=await addDoc(podsCol,{...payload,userId:user.uid,episodes:[],createdAtMs:Date.now(),createdAt:serverTimestamp()});
      if(ref&&ref.id){ openPodId=ref.id; view='podDetail'; }
    }
    closePodSheet();
    if(view==='podDetail') goTo('podDetail');
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
};
function removePod(id){
  const idx=pods.findIndex(x=>x.id===id);
  if(idx<0) return;
  const snap=pods[idx];
  armDelete({
    ids:[id], label:'Podcast izbrisan',
    apply(){ pods.splice(idx,1); podExpanded.delete(id); openPodId=null; goTo('pods'); },
    restore(){ pods.splice(Math.min(idx,pods.length),0,snap); },
    commit(){ return deleteDoc(doc(db,"podcasts",id)).catch(e=>{ console.error(e); setStatus('Brisanje ni uspelo.',true); }); }
  });
}

/* ---------- episode catalogue picker ---------- */
function closeEpFind(){ $('epFindOverlay').classList.remove('open'); }
$('epFindClose').onclick=closeEpFind;
$('epFindOverlay').onclick=e=>{ if(e.target.id==='epFindOverlay') closeEpFind(); };
$('epFindInput').oninput=renderEpFind;

function renderEpFind(){
  const q=$('epFindInput').value.trim().toLowerCase();
  const p=pods.find(x=>x.id===epParentId);
  const taken=new Set((p?.episodes||[]).map(e=>(e.title||'').toLowerCase()));
  let list=epCatalog;
  if(q) list=list.filter(e=>e.title.toLowerCase().includes(q));
  const box=$('epFindList');
  if(!list.length){
    box.innerHTML=`<p class="empty-sub" style="padding:14px 4px">${epCatalog.length?'Ni zadetkov.':'Ta podcast nima kataloga epizod.'}</p>`;
    return;
  }
  box.innerHTML=list.slice(0,60).map((e,i)=>{
    const bits=[e.num?'#'+e.num:'', e.minutes?e.minutes+' min':'', e.date?fmtEpDate(e.date):'']
      .filter(Boolean).join(' · ');
    const have=taken.has(e.title.toLowerCase());
    return `<button class="opt" data-i="${epCatalog.indexOf(e)}">
      <span style="min-width:0">
        <span style="display:block;overflow-wrap:anywhere">${esc(e.title)}</span>
        <span class="rank-cnt">${esc(bits)}${have?' · že dodana':''}</span>
      </span>
      ${have?'<span class="opt-count">✓</span>':''}
    </button>`;
  }).join('');
  box.querySelectorAll('.opt').forEach(o=>{
    o.onclick=()=>{
      const e=epCatalog[Number(o.dataset.i)];
      if(!e) return;
      $('eTitle').value=e.title;
      if(e.num) $('eNum').value=e.num;
      if(e.minutes) $('eMinutes').value=e.minutes;
      if(e.date && !$('eDate').value) $('eDate').value=e.date;
      if(e.num || e.minutes) epMore.open();
      $('epFindTxt').textContent='Izpolnjeno iz kataloga.';
      closeEpFind();
    };
  });
}

$('epFindBtn').onclick=async()=>{
  const p=pods.find(x=>x.id===epParentId);
  if(!p) return;
  if(!p.itunesId){
    $('epFindTxt').textContent='Ta podcast nima povezave na katalog. Uredi podcast in pritisni Poišči.';
    return;
  }
  const btn=$('epFindBtn'); btn.disabled=true;
  $('epFindTxt').textContent='Berem katalog…';
  if(epCatalogFor!==p.id){
    epCatalog=await fetchEpisodes(p.itunesId);
    epCatalogFor=p.id;
  }
  btn.disabled=false;
  if(!epCatalog.length){ $('epFindTxt').textContent='Katalog ni vrnil epizod. Vpiši ročno.'; return; }
  $('epFindTxt').textContent=`${epCatalog.length} epizod v katalogu.`;
  $('epFindInput').value='';
  renderEpFind();
  $('epFindOverlay').classList.add('open');
};

/* ---------- episode sheet ---------- */
function openEpSheet(podId,epId){
  epParentId=podId; editingEpId=epId||null;
  const p=pods.find(x=>x.id===podId);
  if(!p) return;
  if(epId){
    const e=(p.episodes||[]).find(x=>x.id===epId);
    if(!e) return;
    $('epSheetTitle').textContent='Uredi epizodo';
    $('eTitle').value=e.title||''; $('eNum').value=e.num||'';
    $('eMinutes').value=e.minutes||''; $('eDate').value=e.date||'';
    epQuotes.set(toLines(e.quotes));
    epNotes.set(toLines(e.notes));
    epStatus.set(e.status||'read'); epRating.set(e.rating);
  } else {
    $('epSheetTitle').textContent='Nova epizoda';
    ['eTitle','eNum','eMinutes','eDate'].forEach(k=>{ $(k).value=''; });
    epQuotes.set([]); epNotes.set([]);
    epStatus.set('read'); epRating.set(0);
  }
  const esum=[];
  const enq=epQuotes.get().length, enn=epNotes.get().length;
  if(enq) esum.push(enq+' '+slPlural(enq,['citat','citata','citati','citatov']));
  if(enn) esum.push(enn+' '+slPlural(enn,['opomba','opombi','opombe','opomb']));
  if($('eNum').value || $('eMinutes').value) esum.push('trajanje');
  epMore.summary(esum.join(', '));
  epMore.collapse(true);
  if(!esum.length) setTimeout(()=>epMore.nudge(), 480);
  const par=pods.find(x=>x.id===podId);
  $('epFindRow').style.display = (par && par.itunesId) ? '' : 'none';
  $('epFindTxt').textContent='Poišči epizodo v katalogu.';
  $('epOverlay').classList.add('open');
  $('epOverlay').querySelector('.sheet').scrollTop=0;
  setTimeout(()=>{ if(!editingEpId) $('eTitle').focus({preventScroll:true}); $('epOverlay').querySelector('.sheet').scrollTop=0; epQuotes.reflow(); epNotes.reflow(); },80);
}
function closeEpSheet(){ $('epOverlay').classList.remove('open'); editingEpId=null; epParentId=null; }
$('epCancel').onclick=closeEpSheet;
$('epOverlay').onclick=e=>{ if(e.target.id==='epOverlay') closeEpSheet(); };

/* ---------- poteg navzdol zapre okno ---------- */
function enableSheetSwipe(overlayId, closeFn){
  const ov=$(overlayId); if(!ov) return;
  const sheet=ov.querySelector('.sheet'); if(!sheet) return;
  const THRESHOLD=14;                 // koliko px mora prst prepotovati, preden je to poteg
  let startY=0, startX=0, dy=0, tracking=false, dragging=false;
  const start=e=>{
    tracking=false; dragging=false;
    if(sheet.scrollTop>0) return;     // vsebina je oddrsana navzdol — pusti navadno drsenje
    // poteg se ne sme začeti na gumbu, polju ali drugi kontrolni komponenti
    if(e.target.closest('input,textarea,select,button,a,label,.seg,.rate-range,.color-row,.genre-tags,.opt')) return;
    startY=e.touches[0].clientY; startX=e.touches[0].clientX; dy=0; tracking=true;
  };
  const move=e=>{
    if(!tracking) return;
    dy=e.touches[0].clientY-startY;
    if(!dragging){
      const dx=e.touches[0].clientX-startX;
      if(dy>THRESHOLD && dy>Math.abs(dx)){ dragging=true; sheet.classList.add('dragging'); }
      else return;                    // dokler ni jasnega navpičnega potega, se ne dogaja nič
    }
    sheet.style.transform=`translateY(${Math.max(0,dy)}px)`;
    sheet.style.opacity=String(Math.max(.55, 1-dy/600));
  };
  const end=()=>{
    tracking=false;
    if(!dragging) return;
    dragging=false;
    sheet.classList.remove('dragging');
    sheet.style.transform=''; sheet.style.opacity='';
    if(dy>120){
      sheet.classList.add('closing');
      setTimeout(()=>{ sheet.classList.remove('closing'); closeFn(); }, 230);
    }
  };
  sheet.addEventListener('touchstart', start, {passive:true});
  sheet.addEventListener('touchmove', move, {passive:true});
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}
const SHEET_CLOSERS=[
 ['overlay',closeSheet],['podOverlay',closePodSheet],['epOverlay',closeEpSheet],
 ['epFindOverlay',closeEpFind],['goalOverlay',()=>$('goalOverlay').classList.remove('open')],
 ['sortOverlay',()=>$('sortOverlay').classList.remove('open')],
 ['genreOverlay',()=>$('genreOverlay').classList.remove('open')],
 ['acctOverlay',()=>$('acctOverlay').classList.remove('open')],
 ['addPickOverlay',()=>$('addPickOverlay').classList.remove('open')]
];
SHEET_CLOSERS.forEach(([id,fn])=>enableSheetSwipe(id,fn));

/* Escape zapre najbolj zgornje odprto okno (tipkovnica na iPadu) */
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  const open=SHEET_CLOSERS.filter(([id])=>$(id).classList.contains('open'));
  if(!open.length) return;
  open.sort((a,b)=>(parseInt(getComputedStyle($(b[0])).zIndex)||0)-(parseInt(getComputedStyle($(a[0])).zIndex)||0));
  open[0][1]();
});
$('epSave').onclick=async()=>{
  const title=$('eTitle').value.trim();
  if(!title){ $('eTitle').focus(); return; }
  const p=pods.find(x=>x.id===epParentId);
  if(!p) return;
  const ep={
    id: editingEpId||uid(),
    title,
    num:num($('eNum').value),
    minutes:num($('eMinutes').value),
    date:$('eDate').value||'',
    status:epStatus.get(),
    rating:epRating.get(),
    quotes:epQuotes.get(),
    notes:epNotes.get()
  };
  const list=[...(p.episodes||[])];
  if(editingEpId){
    const i=list.findIndex(x=>x.id===editingEpId);
    if(i>=0) list[i]=ep; else list.push(ep);
  } else list.push(ep);

  const b=$('epSave'); b.disabled=true;
  try{ await updateDoc(doc(db,"podcasts",p.id),{episodes:list}); closeEpSheet(); }
  catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
};
function removeEpisode(podId,epId){
  const p=pods.find(x=>x.id===podId);
  if(!p||!p.episodes) return;
  const idx=p.episodes.findIndex(x=>x.id===epId);
  if(idx<0) return;
  const snap=p.episodes[idx];
  armDelete({
    ids:[epId], label:'Epizoda izbrisana',
    apply(){ p.episodes.splice(idx,1); epExpanded.delete(epId); },
    restore(){ p.episodes.splice(Math.min(idx,p.episodes.length),0,snap); },
    commit(){ return updateDoc(doc(db,"podcasts",podId),{episodes:p.episodes}).catch(e=>{ console.error(e); setStatus('Brisanje ni uspelo.',true); }); }
  });
}

/* ---------- auth ---------- */
const gate=$('authGate');
const authMsg=$('authMsg');
let signupMode=false;

function setAuthMsg(t,kind){
  authMsg.textContent=t||'';
  authMsg.className='auth-msg'+(kind?' '+kind:'');
}
function authError(e){
  const c=(e&&e.code)||'';
  if(c.includes('invalid-credential')||c.includes('wrong-password')||c.includes('user-not-found'))
    return 'Napačen e-poštni naslov ali geslo.';
  if(c.includes('email-already-in-use')) return 'Ta naslov je že registriran. Poskusi prijavo.';
  if(c.includes('weak-password')) return 'Geslo mora imeti vsaj 6 znakov.';
  if(c.includes('invalid-email')) return 'E-poštni naslov ni veljaven.';
  if(c.includes('too-many-requests')) return 'Preveč poskusov. Počakaj nekaj minut.';
  if(c.includes('network')) return 'Ni povezave z internetom.';
  if(c.includes('popup')) return 'Prijavno okno je bilo zaprto.';
  return 'Prijava ni uspela. Poskusi znova.';
}

$('showMailBtn').onclick=()=>{
  $('mailForm').classList.add('show');
  $('showMailBtn').style.display='none';
  setTimeout(()=>$('authEmail').focus(),60);
};
$('toggleMode').onclick=()=>{
  signupMode=!signupMode;
  $('mailGo').textContent = signupMode ? 'Ustvari račun' : 'Prijava';
  $('toggleMode').textContent = signupMode ? 'Že imam račun — prijava' : 'Nimam še računa — registracija';
  $('authPass').setAttribute('autocomplete', signupMode?'new-password':'current-password');
  setAuthMsg('');
};
$('mailGo').onclick=async()=>{
  const em=$('authEmail').value.trim(), pw=$('authPass').value;
  if(!em||!pw){ setAuthMsg('Vpiši e-pošto in geslo.','err'); return; }
  const b=$('mailGo'); b.disabled=true; setAuthMsg('Prijavljam…');
  try{
    if(signupMode) await createUserWithEmailAndPassword(auth,em,pw);
    else await signInWithEmailAndPassword(auth,em,pw);
  }catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
  finally{ b.disabled=false; }
};
$('resetBtn').onclick=async()=>{
  const em=$('authEmail').value.trim();
  if(!em){ setAuthMsg('Najprej vpiši svoj e-poštni naslov.','err'); $('authEmail').focus(); return; }
  try{ await sendPasswordResetEmail(auth,em); setAuthMsg('Poslali smo ti povezavo za ponastavitev gesla.','ok'); }
  catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
};
const GOOGLE_CLIENT_ID = "990992068049-52s8de2e4bp1kkubosc5470k44op276t.apps.googleusercontent.com";

function initGoogle(){
  if(!window.google || !google.accounts || !google.accounts.id){
    setTimeout(initGoogle, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async resp => {
      setAuthMsg('Prijavljam…');
      try{
        await signInWithCredential(auth, GoogleAuthProvider.credential(resp.credential));
      }catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
    },
    auto_select: false,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton(document.getElementById('googleBtnBox'), {
    type:'standard', theme:'filled_white', size:'large',
    shape:'pill', text:'continue_with', logo_alignment:'left', width:300
  });
  google.accounts.id.prompt();
}
initGoogle();

/* account sheet */
function initials(u){
  const n=(u.displayName||u.email||'?').trim();
  return n.charAt(0).toUpperCase();
}
$('acctBtn').onclick=()=>{
  if(!user) return;
  const av=$('acctAvatar');
  av.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : esc(initials(user));
  $('acctName').textContent=user.displayName||'Moj račun';
  $('acctMail').textContent=user.email||'';
  $('acctOverlay').classList.add('open');
};
$('acctOverlay').onclick=e=>{ if(e.target.id==='acctOverlay') $('acctOverlay').classList.remove('open'); };
$('acctStats').onclick=()=>{ $('acctOverlay').classList.remove('open'); goTo('stats'); };
$('acctQuotes').onclick=()=>{ $('acctOverlay').classList.remove('open'); goTo('quotes'); };
$('acctExport').onclick=async()=>{
  $('acctOverlay').classList.remove('open');
  const data={
    app:'Marginalia', version:1,
    exportedAt:new Date().toISOString(),
    account:{ uid:user?user.uid:'', email:(user&&user.email)||'' },
    books, podcasts:pods,
    settings:{ goal:settings.goal??null, goalYear:settings.goalYear??thisYear }
  };
  const fname=`marginalia-${new Date().toISOString().slice(0,10)}.json`;
  const file=new File([JSON.stringify(data,null,2)], fname, { type:'application/json' });
  try{
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title:'Marginalia — izvoz' });
      return;
    }
  }catch(e){ if(e && e.name==='AbortError') return; }
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');
  a.href=url; a.download=fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  setStatus('Izvoz pripravljen.');
  setTimeout(()=>{ if(statusLine.textContent==='Izvoz pripravljen.') setStatus(''); }, 2500);
};
$('acctSignOut').onclick=async()=>{
  $('acctOverlay').classList.remove('open');
  try{ await signOut(auth); }catch(e){ console.error(e); }
};

/* one-time claim of pre-login records */
async function claimLegacy(uid){
  const key='mg-claimed-'+uid;
  if(localStorage.getItem(key)) return;
  try{
    for(const [col,name] of [[booksCol,'books'],[podsCol,'podcasts']]){
      const snap=await getDocs(col);
      for(const d of snap.docs){
        if(!d.data().userId) await updateDoc(doc(db,name,d.id),{userId:uid});
      }
    }
    localStorage.setItem(key,'1');
  }catch(e){ console.error('claim skipped',e); }
}

/* ---------- sync ---------- */
function stopSync(){ unsubs.forEach(u=>{ try{u();}catch(e){} }); unsubs=[]; }

function startSync(uid){
  stopSync();
  let booksReady=false, podsReady=false;
  const ready=()=>{ if(booksReady&&podsReady){ $('addBtn').disabled=false; setStatus(''); } };

  unsubs.push(onSnapshot(query(booksCol, where('userId','==',uid)), snap=>{
    books=snap.docs.map(d=>({id:d.id,...d.data()})).filter(b=>!pendingDeletedIds.has(b.id));
    booksReady=true; ready(); render();
  }, err=>{ console.error(err); setStatus('Napaka pri sinhronizaciji.',true); }));

  unsubs.push(onSnapshot(query(podsCol, where('userId','==',uid)), snap=>{
    pods=snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(p=>!pendingDeletedIds.has(p.id))
      .map(p=>(pendingDeletedIds.size && Array.isArray(p.episodes))
        ? { ...p, episodes:p.episodes.filter(e=>!pendingDeletedIds.has(e.id)) } : p);
    podsReady=true; ready(); render();
  }, err=>{ console.error(err); setStatus('Napaka pri sinhronizaciji.',true); }));

  unsubs.push(onSnapshot(settingsRef(), snap=>{
    const d=snap&&snap.data?snap.data():null;
    settings=d||{goal:null,goalYear:thisYear};
    if(view==='stats'||view==='home') render();
  }, err=>{ console.error(err); }));
}

onAuthStateChanged(auth, async u=>{
  user=u;
  if(!u){
    stopSync();
    cancelPendingDelete();
    books=[]; pods=[]; settings={goal:null,goalYear:thisYear};
    expanded.clear(); podExpanded.clear(); epExpanded.clear();
    openPodId=null; epCatalog=[]; epCatalogFor=null;
    view='home'; render();
    gate.classList.add('show');
    document.body.style.overflow='hidden';
    $('mailGo').disabled=false; { const gb=$('googleBtn'); if(gb) gb.disabled=false; }
    setAuthMsg('');
    return;
  }
  gate.classList.remove('show');
  document.body.style.overflow='';
  $('acctBtn').innerHTML = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : esc(initials(u));
  setStatus('Povezujem…');
  await claimLegacy(u.uid);
  startSync(u.uid);
  goTo('home');
});

/* ---------- service worker (samo v živo, prek https) ---------- */
if('serviceWorker' in navigator && location.protocol==='https:'){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.warn('SW registracija ni uspela', e));
  });
}
