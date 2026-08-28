import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const DIR=new URL('.', import.meta.url).pathname, PORT=8940;
const T={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const srv=http.createServer((q,r)=>{ const u=q.url.split('?')[0]; const f=path.join(DIR,u==='/'?'app.html':u);
  if(!fs.existsSync(f)){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'}); r.end(fs.readFileSync(f)); });
await new Promise(r=>srv.listen(PORT,r));

const R=[]; const ck=(n,c,e)=>R.push({n,ok:!!c,e:c?'':(e||'')});
const showMore=async sel=>{ const t=page.locator(sel);
  if((await t.getAttribute('aria-expanded'))!=='true'){ await t.click(); await page.waitForTimeout(400); } };
// vnos citatov/opomb po vrsticah (#fQuotes, #fNotes, #eQuotes, #eNotes, #pNotes)
async function setList(id, text){
  const vals=String(text).split('\n').map(s=>s.trim()).filter(Boolean);
  const tas=page.locator(`#${id} textarea`);
  for(let i=0;i<vals.length;i++){
    if(i>=await tas.count()){ await page.click(`#${id}Add`); await page.waitForTimeout(60); }
    await tas.nth(i).fill(vals[i]);
  }
}
async function ensureOpen(epLoc){
  if(!(await epLoc.locator('.ep-body').isVisible())){
    await epLoc.locator('.ep-row').click();
    await epLoc.page().waitForTimeout(250);
  }
}
const CORS={'Access-Control-Allow-Origin':'*'};

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:402,height:874}});
const errs=[];
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const noise=e=>/fonts\.(googleapis|gstatic)/.test(e)||(e.includes('403')&&e.includes('Failed to load resource'))||e.includes('mock-firebase-auth')||e.includes('mock add failure');

let itunesCalls=[];
await page.route(/itunes\.apple\.com/, route=>{
  const term=new URL(route.request().url()).searchParams.get('term')||'';
  itunesCalls.push(term);
  if(term.includes('NIMAGA')) return route.fulfill({status:200,contentType:'application/json',headers:CORS,body:'{"resultCount":0,"results":[]}'});
  route.fulfill({status:200,contentType:'application/json',headers:CORS,body:JSON.stringify({
    resultCount:1, results:[{ artistName:'Marcel Štefančič', artworkUrl600:'http://is1.mzstatic.com/art600.jpg',
      genres:['Podcasts','Society & Culture','History'] }] })});
});
await page.route(/googleapis\.com\/books/, route=>route.fulfill({status:200,contentType:'application/json',headers:CORS,
  body:JSON.stringify({items:[{volumeInfo:{authors:['A Avtor'],publishedDate:'2010',pageCount:300,categories:['Fiction'],imageLinks:{thumbnail:'http://books.google.com/x'}}}]})}));
await page.route(/openlibrary\.org/, r=>r.fulfill({status:200,contentType:'application/json',headers:CORS,body:'{"docs":[]}'}));
await page.route(/mzstatic\.com|books\.google\.com|covers\.openlibrary\.org/, r=>r.fulfill({status:200,contentType:'image/svg+xml',headers:CORS,body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'}));

await page.goto(`http://localhost:${PORT}/app.html`);
await page.waitForTimeout(700);
await page.evaluate(()=>window.__auth.signIn({uid:'u_test',email:'test@example.com',displayName:'Test',photoURL:''}));
await page.waitForTimeout(700);

// ===== 1. Nav =====
ck('5 nav tabs + add', (await page.locator('.nav-btn').count())===4 && (await page.locator('.nav-add').count())===1);
ck('home tab default on', await page.locator('#navHome').evaluate(e=>e.classList.contains('on')));
await page.click('#navBooks'); await page.waitForTimeout(250);
ck('podcasts view hidden', !(await page.locator('#podsView').isVisible()));
ck('add enabled after both collections sync', !(await page.locator('#addBtn').isDisabled()));

await page.click('#navPods'); await page.waitForTimeout(300);
ck('podcasts view shows', await page.locator('#podsView').isVisible());
ck('books view hidden', !(await page.locator('#booksView').isVisible()));
ck('pods tab on', await page.locator('#navPods').evaluate(e=>e.classList.contains('on')));
ck('podcast empty state', (await page.locator('#podsView .empty-title').textContent()).includes('Ni še podcastov'));

// ===== 2. Add podcast with lookup =====
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('podcast sheet opened (not book)', await page.locator('#podOverlay').evaluate(e=>e.classList.contains('open')));
ck('book sheet stayed closed', !(await page.locator('#overlay').evaluate(e=>e.classList.contains('open'))));
ck('podcast sheet has no manual status', (await page.locator('#pStatusSeg').count())===0);

await page.fill('#pTitle','Apparatus');
await page.click('#pLookupBtn'); await page.waitForTimeout(600);
ck('itunes called', itunesCalls.includes('Apparatus'), JSON.stringify(itunesCalls));
ck('lookup filled host', (await page.locator('#pHost').inputValue())==='Marcel Štefančič');
ck('lookup cover https', await page.evaluate(()=>document.querySelector('#pLookupPrev img')?.src.startsWith('https://')));
ck('podcast details collapsed by default', !(await page.locator('#pNotes').isVisible()));
await showMore('#podMoreToggle');
const pg=await page.locator('#pGenreTags .g-tag').allTextContents();
ck('genres added minus "Podcasts"', pg.length===2 && !pg.join('').toLowerCase().includes('podcasts'), JSON.stringify(pg));

await setList('pNotes','Opomba ena.');
await page.click('#podSave'); await page.waitForTimeout(500);

const savedPod=await page.evaluate(()=>window.__mock.dump('podcasts')[0]);
ck('podcast saved to podcasts collection', !!savedPod && savedPod.title==='Apparatus');
ck('podcast has empty episodes array', Array.isArray(savedPod.episodes) && savedPod.episodes.length===0);
ck('podcast has no stored rating', savedPod.rating===undefined);
ck('podcast has no stored quotes', savedPod.quotes===undefined);
ck('books collection untouched', (await page.evaluate(()=>window.__mock.dump('books').length))===0);

// ===== 3. Auto-open detail after create =====
ck('jumped into podcast detail', await page.locator('#podDetailView').isVisible());
ck('detail shows title', (await page.locator('.pod-hero h2').textContent())==='Apparatus');
ck('detail shows host', (await page.locator('.pod-hero .host').textContent())==='Marcel Štefančič');
ck('podcast level shows no quotes', (await page.locator('#podDetailView > .block .quote-item').count())===0);
ck('detail shows podcast notes', (await page.locator('#podDetailView .note-item').count())===1);
ck('episode empty state', (await page.locator('#epList .empty-title').textContent()).includes('Ni še epizod'));
ck('pods tab still lit in detail', await page.locator('#navPods').evaluate(e=>e.classList.contains('on')));

// ===== 4. Episodes =====
await page.click('#epAdd'); await page.waitForTimeout(350);
ck('episode sheet opens', await page.locator('#epOverlay').evaluate(e=>e.classList.contains('open')));
{
  const m=await page.locator('#epOverlay .sheet').evaluate(s=>({
    top:s.scrollTop, xover:s.scrollWidth-s.clientWidth
  }));
  ck('episode sheet opens at the top', m.top===0, 'scrollTop='+m.top);
  ck('episode sheet has no sideways scroll', m.xover<=0, 'x overflow='+m.xover);
}
await page.fill('#eTitle','Kaj nam pove tišina');
ck('episode extras collapsed by default', !(await page.locator('#eNum').isVisible()));
await showMore('#epMoreToggle');
await page.fill('#eNum','42');
await page.fill('#eMinutes','58');
await page.fill('#eDate','2026-08-12');
await page.locator('#eRating').fill('5');
await setList('eQuotes','Citat iz epizode.\nDrugi citat epizode.');
await setList('eNotes','Prva opomba.\nDruga opomba.\nTretja.');
await page.click('#epSave'); await page.waitForTimeout(450);

let pod=await page.evaluate(()=>window.__mock.dump('podcasts')[0]);
ck('episode appended to podcast doc', pod.episodes.length===1, JSON.stringify(pod.episodes));
ck('episode has generated id', typeof pod.episodes[0].id==='string' && pod.episodes[0].id.length>3);
ck('episode fields stored', pod.episodes[0].num===42 && pod.episodes[0].minutes===58 && pod.episodes[0].date==='2026-08-12');
ck('episode quotes array', pod.episodes[0].quotes.length===2);
ck('episode notes array', pod.episodes[0].notes.length===3);
ck('episode rating 5', pod.episodes[0].rating===5);

ck('episode row rendered', (await page.locator('.ep').count())===1);
ck('episode badge shows its own number', (await page.locator('.ep .ep-idx').textContent()).trim()==='42');
ck('episode shows minutes', (await page.locator('.ep .ep-meta').textContent()).includes('58 min'));
ck('episode shows formatted date', (await page.locator('.ep .ep-meta').textContent()).includes('12. avgust 2026'));
ck('episode body hidden initially', !(await page.locator('.ep .ep-body').isVisible()));
await ensureOpen(page.locator('.ep').first()); 
ck('episode expands', await page.locator('.ep .ep-body').isVisible());
ck('episode quotes rendered', (await page.locator('.ep .quote-item').count())===2);
ck('episode notes numbered', (await page.locator('.ep .note-num').allTextContents()).join('')==='123');

// reopening resets scroll to the top even if left scrolled down
await page.click('#epAdd'); await page.waitForTimeout(300);
await page.locator('#epOverlay .sheet').evaluate(s=>s.scrollTop=400);
await page.click('#epCancel'); await page.waitForTimeout(200);
await page.click('#epAdd'); await page.waitForTimeout(350);
ck('reopened episode sheet is back at the top',
  (await page.locator('#epOverlay .sheet').evaluate(s=>s.scrollTop))===0);
await page.click('#epCancel'); await page.waitForTimeout(200);

// second + third episode
await page.click('#epAdd'); await page.waitForTimeout(300);
await showMore('#epMoreToggle');
await page.fill('#eTitle','Starejša epizoda'); await page.fill('#eNum','41');
await page.fill('#eDate','2026-07-01'); await page.fill('#eMinutes','45');
await page.locator('#eRating').fill('3');
await page.click('#epSave'); await page.waitForTimeout(400);
await page.click('#epAdd'); await page.waitForTimeout(300);
await showMore('#epMoreToggle');
await page.fill('#eTitle','Najnovejsa'); await page.fill('#eDate','2026-08-20'); await page.fill('#eMinutes','30');
await page.click('#eStatusSeg button[data-status=wish]');
await page.click('#epSave'); await page.waitForTimeout(400);

ck('3 episodes', (await page.locator('.ep').count())===3);
const epOrder=await page.locator('.ep-title').allTextContents();
ck('episodes newest-date first', epOrder[0]==='Najnovejsa' && epOrder[2]==='Starejša epizoda', JSON.stringify(epOrder));
const idxs=(await page.locator('.ep-idx').allTextContents()).map(t=>t.trim());
ck('badges use episode numbers where set', idxs.includes('42') && idxs.includes('41'), JSON.stringify(idxs));
ck('numberless episode falls back to counter', idxs.some(t=>t==='3'), JSON.stringify(idxs));
ck('episode keeps its own status', (await page.locator('.ep').first().locator('.status-tag').textContent())==='Želim poslušati');
ck('listening hours pill', (await page.locator('#podDetailView .pill').first().textContent()).includes('h poslušanja'));

// ===== 5. Edit episode =====
const target=page.locator('.ep',{hasText:'Starejša epizoda'}).first();
await ensureOpen(target);
await target.locator('.epEdit').click(); await page.waitForTimeout(350);
ck('edit sheet title', (await page.locator('#epSheetTitle').textContent())==='Uredi epizodo');
ck('edit prefills title', (await page.locator('#eTitle').inputValue())==='Starejša epizoda');
ck('edit prefills date', (await page.locator('#eDate').inputValue())==='2026-07-01');
ck('edit prefills rating', (await page.locator('#eRating').inputValue())==='3');
await page.fill('#eTitle','Preimenovana');
await page.locator('#eRating').fill('4.5');
await page.click('#epSave'); await page.waitForTimeout(400);
pod=await page.evaluate(()=>window.__mock.dump('podcasts')[0]);
ck('episode renamed in place', pod.episodes.filter(e=>e.title==='Preimenovana').length===1);
ck('still 3 episodes after edit', pod.episodes.length===3, String(pod.episodes.length));
ck('episode rating updated', pod.episodes.find(e=>e.title==='Preimenovana').rating===4.5);

// ===== 6. + button inside detail adds episode =====
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('+ in detail opens episode sheet', await page.locator('#epOverlay').evaluate(e=>e.classList.contains('open')));
await page.click('#epCancel'); await page.waitForTimeout(250);

// ===== 7. Delete episode =====
const del=page.locator('.ep',{hasText:'Preimenovana'}).first();
await ensureOpen(del);
await del.locator('.epDel').click(); await page.waitForTimeout(400);
pod=await page.evaluate(()=>window.__mock.dump('podcasts')[0]);
ck('episode deleted', pod.episodes.length===2);
ck('other episodes intact', pod.episodes.some(e=>e.title==='Najnovejsa'));
ck('podcast itself not deleted', (await page.evaluate(()=>window.__mock.dump('podcasts').length))===1);

// ===== 8. Back + list card =====
await page.click('#podBack'); await page.waitForTimeout(350);
ck('back returns to pod list', await page.locator('#podsView').isVisible());
const card=page.locator('#podList .entry').first();
ck('pod card square cover', await card.locator('.cover.square').count()===1);
const badges=await card.locator('.badge-count').allTextContents();
ck('card shows episode count', badges.some(t=>t.trim()==='2'), JSON.stringify(badges));
ck('card shows aggregate quote count', badges.some(t=>t.trim()==='4'), JSON.stringify(badges));
await card.locator('.entry-head').click(); await page.waitForTimeout(350);
ck('tapping card opens detail', await page.locator('#podDetailView').isVisible());
await page.click('#podBack'); await page.waitForTimeout(300);

// ===== 9. Podcast search & filter =====
await page.fill('#podSearch','tišina'); await page.waitForTimeout(250);
ck('search finds podcast by episode title', (await page.locator('#podList .entry').count())===1);
await page.fill('#podSearch','epizode'); await page.waitForTimeout(250);
ck('search finds by episode quote/note', (await page.locator('#podList .entry').count())===1);
await page.fill('#podSearch','zzzz'); await page.waitForTimeout(250);
ck('no-match state', (await page.locator('#podsView .empty-title').textContent())==='Ni zadetkov');
await page.fill('#podSearch',''); await page.waitForTimeout(250);
await page.click('#podFilterRow .chip[data-filter=current]'); await page.waitForTimeout(250);
ck('derived current filter matches', (await page.locator('#podList .entry').count())===1);
await page.click('#podFilterRow .chip[data-filter=all]'); await page.waitForTimeout(250);

// ===== 10. Books still work =====
await page.click('#navBooks'); await page.waitForTimeout(300);
ck('books view back', await page.locator('#booksView').isVisible());
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('+ on books opens book sheet', await page.locator('#overlay').evaluate(e=>e.classList.contains('open')));
ck('book status labels intact', (await page.locator('#statusSeg button').allTextContents()).join('|')==='Prebrano|Berem|Želim brati|Opuščeno');
await page.fill('#fTitle','Homo Deus'); await page.fill('#fAuthor','Y N Harari');
await page.locator('#fRating').fill('4');
await page.selectOption('#fYear', String(new Date().getFullYear()));
await page.selectOption('#fMonth','5');
ck('book details collapsed by default', !(await page.locator('#fPages').isVisible()));
await showMore('#bookMoreToggle');
await page.fill('#fPages','420');
await setList('fQuotes','Knjižni citat.');
await setList('fNotes','Opomba a.\nOpomba b.');
await page.fill('#genreInput','zgodovina'); await page.press('#genreInput','Enter');
await page.click('#saveBtn'); await page.waitForTimeout(450);
const bk=await page.evaluate(()=>window.__mock.dump('books')[0]);
ck('book saved to books collection', bk.title==='Homo Deus');
ck('book rating 4', bk.rating===4);
ck('book quotes array', bk.quotes.length===1);
ck('podcasts unaffected by book save', (await page.evaluate(()=>window.__mock.dump('podcasts').length))===1);
ck('book card rendered', (await page.locator('#list .entry').count())===1);
await page.locator('#list .entry .entry-head').click(); await page.waitForTimeout(250);
ck('book expands with notes', (await page.locator('#list .note-item').count())===2);

// controls isolated between sheets
await page.click('#navPods'); await page.waitForTimeout(250);
await page.click('#addBtn'); await page.waitForTimeout(320);
ck('podcast sheet exposes no rating control', (await page.locator('#pRating').count())===0);
ck('pod genre tags empty', (await page.locator('#pGenreTags .g-tag').count())===0);
await page.click('#podCancel'); await page.waitForTimeout(250);
await page.click('#navBooks'); await page.waitForTimeout(250);
await page.locator('#list .entry .editBtn').click(); await page.waitForTimeout(350);
ck('book edit still prefills rating', (await page.locator('#fRating').inputValue())==='4');
ck('book edit prefills genre', (await page.locator('#genreTags .g-tag').count())===1);
await page.click('#cancelBtn'); await page.waitForTimeout(250);

// ===== 11. Stats =====
await page.click('#navStats'); await page.waitForTimeout(700); // + čas za count-up števcev
const titles=await page.locator('.stat-section-title').allTextContents();
ck('stats has Knjige section', titles.includes('Knjige'));
ck('stats has Podcasti section', titles.includes('Podcasti'));
const nums=await page.locator('.stat-num').allTextContents();
ck('book count stat', nums[0]==='1', JSON.stringify(nums));
ck('podcast count stat', nums[4]==='1', JSON.stringify(nums));
const doneEps=await page.evaluate(()=>window.__mock.dump('podcasts')[0].episodes.filter(e=>(e.status||'read')==='read').length);
ck('listened episodes stat', nums[5]===String(doneEps), nums[5]+' vs '+doneEps);
const expQ=await page.evaluate(()=>{
  const L=v=>Array.isArray(v)?v.filter(x=>String(x).trim()).length:String(v||'').split('\n').filter(x=>x.trim()).length;
  const b=window.__mock.dump('books').reduce((s,x)=>s+L(x.quotes),0);
  const p=window.__mock.dump('podcasts').reduce((s,x)=>s+L(x.quotes)+(x.episodes||[]).reduce((t,e)=>t+L(e.quotes),0),0);
  return b+p;
});
const expQ2=await page.evaluate(()=>{
  const L=v=>Array.isArray(v)?v.filter(x=>String(x).trim()).length:String(v||'').split('\n').filter(x=>x.trim()).length;
  const b=window.__mock.dump('books').reduce((s,x)=>s+L(x.quotes),0);
  const p=window.__mock.dump('podcasts').reduce((s,x)=>s+(x.episodes||[]).reduce((t,e)=>t+L(e.quotes),0),0);
  return b+p;
});
ck('quote total counts books + episodes', nums[8]===String(expQ2), nums[8]+' vs '+expQ2);
ck('top episodes section present', titles.some(t=>t.includes('epizode')));
ck('stats has Grafi section', titles.includes('Grafi'));
// grafi se gradijo ob drsenju do njih
for(const c of await page.locator('#statsView .chart-card').all()){
  await c.scrollIntoViewIfNeeded(); await page.waitForTimeout(250);
}
await page.waitForTimeout(500);
const drawn=await page.evaluate(()=>(window.__statCharts||[]).length);
ck('stat charts drawn', drawn>=2, 'drawn='+drawn);
await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(200);
ck('period chips present', (await page.locator('.stat-chips .chip').count())>=1);
const perChip=page.locator('.stat-chips .chip').nth(1);
if(await perChip.count()){
  await perChip.click(); await page.waitForTimeout(400);
  ck('period chip activates', await perChip.evaluate(e=>e.classList.contains('active')));
  await page.click('.stat-chips .chip[data-period=all]'); await page.waitForTimeout(300);
}

// ===== 12. Goal still works =====
await page.click('#goalEditBtn'); await page.waitForTimeout(300);
await page.fill('#fGoal','3'); await page.click('#goalSave'); await page.waitForTimeout(400);
ck('goal saved', (await page.evaluate(()=>window.__mock.settings()))?.goal===3);
ck('goal counts book read this year', (await page.locator('.goal-nums').textContent()).trim().startsWith('1'));

// ===== 13. Logo home =====
await page.click('#logoBtn'); await page.waitForTimeout(450);
ck('logo goes home', await page.locator('#homeView').isVisible());
ck('logo clears pod search', (await page.locator('#podSearch').inputValue())===''); 

// ===== 14. Delete podcast =====
await page.click('#navPods'); await page.waitForTimeout(300);
await page.locator('#podList .entry .entry-head').click(); await page.waitForTimeout(350);
await page.click('#podDelete'); await page.waitForTimeout(450);
ck('podcast deleted', (await page.evaluate(()=>window.__mock.dump('podcasts').length))===0);
ck('returned to pod list after delete', await page.locator('#podsView').isVisible());
ck('books survive podcast delete', (await page.evaluate(()=>window.__mock.dump('books').length))===1);

// ===== 15. Guards =====
await page.click('#addBtn'); await page.waitForTimeout(320);
await page.fill('#pTitle','   '); await page.click('#podSave'); await page.waitForTimeout(280);
ck('blank podcast title blocked', await page.locator('#podOverlay').evaluate(e=>e.classList.contains('open')));
await page.fill('#pTitle','NIMAGA'); await page.click('#pLookupBtn'); await page.waitForTimeout(600);
ck('empty lookup handled', (await page.locator('#pLookupTxt').textContent()).includes('Nič najdenega'));
await page.click('#podCancel'); await page.waitForTimeout(280);

// ===== 16. XSS in podcast/episode =====
await page.click('#addBtn'); await page.waitForTimeout(320);
await page.fill('#pTitle','<img src=x onerror=alert(1)>Pod');
await page.click('#podSave'); await page.waitForTimeout(500);
ck('podcast html escaped', (await page.locator('.pod-hero h2 img').count())===0);
ck('podcast title literal', (await page.locator('.pod-hero h2').textContent()).includes('<img'));
await page.click('#epAdd'); await page.waitForTimeout(320);
await page.fill('#eTitle','<script>x</script>Ep');
await showMore('#epMoreToggle');
await setList('eNotes','<i>nope</i>');
await page.click('#epSave'); await page.waitForTimeout(420);
ck('episode html escaped', (await page.locator('.ep-title script, .ep .note-text i').count())===0);
await ensureOpen(page.locator('.ep').first());
ck('episode note literal', (await page.locator('.ep .note-text').textContent()).includes('<i>'));

// ===== 17. Layout =====
await page.click('#logoBtn'); await page.waitForTimeout(400);
ck('no h-overflow @402', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.click('#navPods'); await page.waitForTimeout(300);
await page.setViewportSize({width:320,height:568}); await page.waitForTimeout(350);
ck('no h-overflow @320 pods', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
const navW=await page.evaluate(()=>[...document.querySelectorAll('.nav-btn')].map(b=>b.getBoundingClientRect().width));
ck('nav tabs fit @320', navW.every(w=>w>50), JSON.stringify(navW));
const navOverlap=await page.evaluate(()=>{
  const bs=[...document.querySelectorAll('.nav-btn,.nav-add')].map(b=>b.getBoundingClientRect());
  for(let i=1;i<bs.length;i++) if(bs[i].left < bs[i-1].right - 1) return true;
  return false;
});
ck('nav items do not overlap @320', !navOverlap);
await page.setViewportSize({width:402,height:874}); await page.waitForTimeout(250);
await page.locator('#podList .entry .entry-head').click(); await page.waitForTimeout(350);
await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await page.waitForTimeout(300);
const lastEp=await page.locator('.ep').last().boundingBox();
const navBox=await page.locator('.nav').boundingBox();
ck('last episode not under nav', !lastEp || lastEp.y+lastEp.height <= navBox.y+4,
   JSON.stringify({ep:lastEp&&lastEp.y+lastEp.height, nav:navBox.y}));
await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(200);
const tapBad=await page.evaluate(()=>[...document.querySelectorAll('.nav-btn,.chip,.act-btn,.tool-btn,.ep-add,.back-btn')]
  .filter(e=>e.offsetParent!==null).filter(e=>e.getBoundingClientRect().height<30)
  .map(e=>e.className+':'+e.getBoundingClientRect().height.toFixed(0)));
ck('tap targets >=30px', tapBad.length===0, JSON.stringify(tapBad));
ck('inputs >=16px', (await page.evaluate(()=>parseFloat(getComputedStyle(document.getElementById('podSearch')).fontSize)))>=16);

const real=errs.filter(e=>!noise(e));
ck('no unexpected console errors', real.length===0, real.slice(0,4).join(' | '));

// screenshots
await page.click('#logoBtn'); await page.waitForTimeout(350);
await page.screenshot({path:`${DIR}/v6-books.png`});
await page.click('#navPods'); await page.waitForTimeout(350);
await page.screenshot({path:`${DIR}/v6-pods.png`});
await page.locator('#podList .entry .entry-head').click(); await page.waitForTimeout(400);
await ensureOpen(page.locator('.ep').first());
await page.screenshot({path:`${DIR}/v6-detail.png`, fullPage:true});
await page.click('#navStats'); await page.waitForTimeout(450);
await page.screenshot({path:`${DIR}/v6-stats.png`, fullPage:true});

await browser.close(); srv.close();
R.forEach(r=>console.log(`${r.ok?'PASS':'FAIL'}  ${r.n}${r.e?'  >> '+r.e:''}`));
const F=R.filter(r=>!r.ok);
console.log(`\n${R.length-F.length}/${R.length} passed`);
if(F.length){ console.log('\nFAILURES:'); F.forEach(f=>console.log(' - '+f.n+' :: '+f.e)); process.exit(1); }
