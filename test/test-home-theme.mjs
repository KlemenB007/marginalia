import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const DIR=new URL('.', import.meta.url).pathname, PORT=8960;
const T={'.html':'text/html','.js':'text/javascript','.png':'image/png'};
const srv=http.createServer((q,r)=>{ const u=q.url.split('?')[0]; const f=path.join(DIR,u==='/'?'app.html':u);
  if(!fs.existsSync(f)){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'}); r.end(fs.readFileSync(f)); });
await new Promise(r=>srv.listen(PORT,r));

const R=[]; const ck=(n,c,e)=>R.push({n,ok:!!c,e:c?'':(e||'')});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:402,height:874}});
const errs=[];
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const noise=e=>/fonts\.(googleapis|gstatic)/.test(e)||(e.includes('403')&&e.includes('Failed to load resource'))||e.includes('mock-firebase-auth');
await page.route(/mzstatic|books\.google|covers\.openlibrary/, r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'}));

await page.goto(`http://localhost:${PORT}/app.html`);
await page.waitForTimeout(700);
await page.evaluate(()=>window.__auth.signIn({uid:'u_test',email:'test@example.com',displayName:'Test',photoURL:''}));
await page.waitForTimeout(700);

// ===== empty home =====
ck('home is default view', await page.locator('#homeView').isVisible());
ck('books hidden at boot', !(await page.locator('#booksView').isVisible()));
ck('greeting shown', (await page.locator('.greet').textContent()).length>3);
ck('two hub cards', (await page.locator('.hub-card').count())===2);
ck('hub shows zero counts', (await page.locator('#hubBooks .hub-count').textContent()).includes('0'));
ck('empty in-progress message', (await page.locator('.home-empty').count())===1);
ck('no goal block when unset', (await page.locator('#homeGoal').count())===0);

// ===== seed data =====
const YEAR=new Date().getFullYear();
await page.evaluate(Y=>{
  window.__mock.seed('books',[
    { id:'B1', title:'Homo Deus', author:'Yuval Noah Harari', color:'#E5A45B', status:'read',
      rating:4.5, readYear:Y, readMonth:5, pages:420, genres:['zgodovina'], quotes:['Citat.'], notes:['Opomba.'], createdAtMs:100 },
    { id:'B2', title:'Erebos', author:'Ursula Poznanski', color:'#D98B6A', status:'current',
      pages:400, pageAt:120, createdAtMs:300 },
    { id:'B3', title:'Sobarica', author:'Nita Prose', color:'#C9A86B', status:'wish', createdAtMs:50 }
  ]);
  window.__mock.seed('podcasts',[
    { id:'P1', title:'Apparatus', host:'Marcel Š.', color:'#9C8CFA', status:'current', rating:4.5,
      genres:['kultura'], quotes:[], notes:[], createdAtMs:400,
      episodes:[{id:'e1',title:'Prva',num:1,minutes:60,date:Y+'-08-01',status:'read',rating:5,quotes:[],notes:[]},
                {id:'e2',title:'Druga',num:2,minutes:40,date:Y+'-08-10',status:'current',rating:4,quotes:[],notes:[]}]},
    { id:'P2', title:'Vzporednice', host:'RTV', color:'#7FA6E8', status:'wish',
      genres:[], quotes:[], notes:[], episodes:[], createdAtMs:200 }
  ]);
}, YEAR);
await page.waitForTimeout(400);

// ===== populated home =====
ck('hub book count', (await page.locator('#hubBooks .hub-count').textContent()).includes('3'));
ck('hub book read count', (await page.locator('#hubBooks .hub-count').textContent()).includes('1 prebranih'));
ck('hub pod count', (await page.locator('#hubPods .hub-count').textContent()).includes('2'));
ck('hub pod episode count', (await page.locator('#hubPods .hub-count').textContent()).includes('2 epizod'));

const prog=await page.locator('.home-block').first().locator('.mini').allTextContents();
ck('in-progress lists 2 items', prog.length===2, JSON.stringify(prog));
ck('in-progress has the current book', prog.join('|').includes('Erebos'));
ck('in-progress has the current podcast', prog.join('|').includes('Apparatus'));
ck('book progress % shown', prog.join('|').includes('30%'), JSON.stringify(prog));
ck('wish-status book excluded', !prog.join('|').includes('Sobarica'));

const kinds=await page.locator('.home-block').first().locator('.mini-kind').allTextContents();
ck('items labelled Knjiga/Podcast', kinds.includes('Knjiga') && kinds.includes('Podcast'), JSON.stringify(kinds));

// ===== colour separation =====
const accents=await page.evaluate(()=>{
  const minis=[...document.querySelectorAll('.home-block')][0].querySelectorAll('.mini');
  return [...minis].map(m=>({ kind:m.dataset.kind, acc:getComputedStyle(m).getPropertyValue('--mini-acc').trim() }));
});
const bookAcc=accents.find(a=>a.kind==='book')?.acc;
const podAcc =accents.find(a=>a.kind==='pod')?.acc;
ck('book accent is amber', bookAcc==='#E5A45B', String(bookAcc));
ck('podcast accent is periwinkle', podAcc==='#9C8CFA', String(podAcc));
ck('accents actually differ', bookAcc!==podAcc);

const hubColors=await page.evaluate(()=>[...document.querySelectorAll('.hub-card')].map(c=>getComputedStyle(c).getPropertyValue('--hub').trim()));
ck('hub cards use the two accents', hubColors[0]!==hubColors[1], JSON.stringify(hubColors));

const sectionAcc=await page.evaluate(()=>({
  books:getComputedStyle(document.getElementById('booksView')).getPropertyValue('--acc').trim(),
  pods:getComputedStyle(document.getElementById('podsView')).getPropertyValue('--acc').trim()
}));
ck('books section accent differs from podcasts', sectionAcc.books!==sectionAcc.pods, JSON.stringify(sectionAcc));

// dark theme sanity
const theme=await page.evaluate(()=>{
  const cs=getComputedStyle(document.body);
  const rgb=cs.backgroundColor.match(/\d+/g).map(Number);
  const text=getComputedStyle(document.querySelector('.greet')).color.match(/\d+/g).map(Number);
  return { bgLum:(rgb[0]+rgb[1]+rgb[2])/3, textLum:(text[0]+text[1]+text[2])/3 };
});
ck('background is dark', theme.bgLum < 40, JSON.stringify(theme));
ck('text is Cloud-Dancer light', theme.textLum > 220, JSON.stringify(theme));

// ===== navigation from home =====
await page.click('#hubBooks'); await page.waitForTimeout(350);
ck('hub opens books', await page.locator('#booksView').isVisible());
ck('books nav tab lit', await page.locator('#navBooks').evaluate(e=>e.classList.contains('on')));
await page.click('#navHome'); await page.waitForTimeout(300);
await page.click('#hubPods'); await page.waitForTimeout(350);
ck('hub opens podcasts', await page.locator('#podsView').isVisible());
await page.click('#navHome'); await page.waitForTimeout(350);

// mini row navigation
await page.locator('.mini[data-kind=pod]').first().click(); await page.waitForTimeout(400);
ck('mini podcast opens its detail', await page.locator('#podDetailView').isVisible());
ck('opened the right podcast', (await page.locator('.pod-hero h2').textContent())==='Apparatus');
await page.click('#navHome'); await page.waitForTimeout(350);
await page.locator('.mini[data-kind=book]').first().click(); await page.waitForTimeout(500);
ck('mini book opens books view', await page.locator('#booksView').isVisible());
ck('target book expanded', await page.locator('#list .entry[data-id=B2]').evaluate(e=>e.classList.contains('open')));
await page.click('#navHome'); await page.waitForTimeout(350);

// ===== add picker =====
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('home + opens picker', await page.locator('#addPickOverlay').evaluate(e=>e.classList.contains('open')));
ck('picker offers both', (await page.locator('#addPickOverlay .opt').count())===2);
await page.click('#pickPod'); await page.waitForTimeout(400);
ck('picker -> podcast sheet', await page.locator('#podOverlay').evaluate(e=>e.classList.contains('open')));
ck('picker switched view to pods', await page.evaluate(()=>document.getElementById('podsView').style.display!=='none'));
await page.click('#podCancel'); await page.waitForTimeout(300);
await page.click('#navHome'); await page.waitForTimeout(300);
await page.click('#addBtn'); await page.waitForTimeout(320);
await page.click('#pickBook'); await page.waitForTimeout(400);
ck('picker -> book sheet', await page.locator('#overlay').evaluate(e=>e.classList.contains('open')));
await page.click('#cancelBtn'); await page.waitForTimeout(300);

// + still direct in sections
await page.click('#navPods'); await page.waitForTimeout(300);
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('+ in pods still direct (no picker)', !(await page.locator('#addPickOverlay').evaluate(e=>e.classList.contains('open'))));
ck('+ in pods opens podcast sheet', await page.locator('#podOverlay').evaluate(e=>e.classList.contains('open')));
await page.click('#podCancel'); await page.waitForTimeout(300);

// hidden on stats
await page.click('#navStats'); await page.waitForTimeout(350);
ck('+ hidden on stats', (await page.locator('#addBtn').evaluate(e=>getComputedStyle(e).visibility))==='hidden');
await page.click('#navHome'); await page.waitForTimeout(300);
ck('+ visible again on home', (await page.locator('#addBtn').evaluate(e=>getComputedStyle(e).visibility))==='visible');

// ===== goal on home =====
await page.click('#navStats'); await page.waitForTimeout(350);
await page.click('#goalEditBtn'); await page.waitForTimeout(300);
await page.fill('#fGoal','4'); await page.click('#goalSave'); await page.waitForTimeout(400);
await page.click('#navHome'); await page.waitForTimeout(400);
ck('goal block appears on home', (await page.locator('#homeGoal').count())===1);
ck('home goal shows progress', (await page.locator('#homeView .goal-nums').textContent()).includes('/ 4'));
const gw=await page.locator('#homeView .goal-fill').evaluate(e=>e.style.width);
ck('home goal bar 25%', gw==='25%', gw);
await page.click('#homeGoal'); await page.waitForTimeout(350);
ck('goal link opens stats', await page.locator('#statsView').isVisible());
await page.click('#navHome'); await page.waitForTimeout(300);

// ===== recently added =====
const blocks=await page.locator('.home-sec h3').allTextContents();
ck('has Nazadnje dodano block', blocks.includes('Nazadnje dodano'), JSON.stringify(blocks));
const recentTitles=await page.locator('.home-block').last().locator('.mini-title').allTextContents();
ck('recent shows 3 newest', recentTitles.length===3, JSON.stringify(recentTitles));
ck('recent newest first', recentTitles[0]==='Apparatus', JSON.stringify(recentTitles));
ck('recent mixes both types', (await page.locator('.home-block').last().locator('.mini-kind').allTextContents()).includes('Knjiga'));

// ===== live update =====
await page.evaluate(()=>window.__mock.seed('books',[{ id:'B9', title:'Nova knjiga', author:'X', status:'current', createdAtMs:999 }]));
await page.waitForTimeout(400);
ck('home updates live on new data', (await page.locator('.home-block').first().locator('.mini').allTextContents()).join('|').includes('Nova knjiga'));

// ===== layout =====
ck('no h-overflow @402', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.setViewportSize({width:320,height:568}); await page.waitForTimeout(400);
ck('no h-overflow @320', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
const navW=await page.evaluate(()=>[...document.querySelectorAll('.nav-btn')].map(b=>Math.round(b.getBoundingClientRect().width)));
ck('5-item nav fits @320', navW.every(w=>w>=40), JSON.stringify(navW));
const navOv=await page.evaluate(()=>{
  const bs=[...document.querySelectorAll('.nav-btn,.nav-add')].map(b=>b.getBoundingClientRect());
  for(let i=1;i<bs.length;i++) if(bs[i].left < bs[i-1].right-1) return true;
  return false;
});
ck('nav does not overlap @320', !navOv);
const labelsClipped=await page.evaluate(()=>[...document.querySelectorAll('.nav-btn span')]
  .filter(s=>s.scrollWidth > s.clientWidth+1).map(s=>s.textContent));
ck('nav labels not clipped @320', labelsClipped.length===0, JSON.stringify(labelsClipped));
const hubW=await page.evaluate(()=>[...document.querySelectorAll('.hub-card')].map(c=>Math.round(c.getBoundingClientRect().width)));
ck('hub cards fit @320', hubW.every(w=>w>120), JSON.stringify(hubW));
await page.setViewportSize({width:402,height:874}); await page.waitForTimeout(300);

const real=errs.filter(e=>!noise(e));
// nav accent follows section
const navAccents={};
for(const [tab,view] of [['navBooks','books'],['navPods','pods'],['navHome','home']]){
  await page.click('#'+tab); await page.waitForTimeout(300);
  navAccents[view]=await page.evaluate(()=>getComputedStyle(document.querySelector('.nav-add')).backgroundColor);
}
ck('+ button recolours per section', navAccents.books!==navAccents.pods && navAccents.pods!==navAccents.home, JSON.stringify(navAccents));
await page.click('#navBooks'); await page.waitForTimeout(280);
const litBooks=await page.evaluate(()=>getComputedStyle(document.getElementById('navBooks')).color);
await page.click('#navPods'); await page.waitForTimeout(280);
const litPods=await page.evaluate(()=>getComputedStyle(document.getElementById('navPods')).color);
ck('active tab colour differs per section', litBooks!==litPods, litBooks+' / '+litPods);
await page.click('#navHome'); await page.waitForTimeout(300);
const goalFill=await page.evaluate(()=>{ const e=document.querySelector('#homeView .goal-fill'); return e?getComputedStyle(e).backgroundColor:''; });
ck('goal bar uses book accent', goalFill==='rgb(229, 164, 91)', goalFill);

ck('no console errors', real.length===0, real.slice(0,4).join(' | '));

await page.screenshot({path:`${DIR}/v7-home.png`, fullPage:true});
await page.click('#navBooks'); await page.waitForTimeout(350);
await page.screenshot({path:`${DIR}/v7-books.png`});
await page.click('#navPods'); await page.waitForTimeout(350);
await page.screenshot({path:`${DIR}/v7-pods.png`});
await page.locator('#podList .entry').first().locator('.entry-head').click(); await page.waitForTimeout(400);
await page.screenshot({path:`${DIR}/v7-detail.png`, fullPage:true});
await page.click('#navStats'); await page.waitForTimeout(400);
await page.screenshot({path:`${DIR}/v7-stats.png`});

await browser.close(); srv.close();
R.forEach(r=>console.log(`${r.ok?'PASS':'FAIL'}  ${r.n}${r.e?'  >> '+r.e:''}`));
const F=R.filter(r=>!r.ok);
console.log(`\n${R.length-F.length}/${R.length} passed`);
if(F.length){ console.log('\nFAILURES:'); F.forEach(f=>console.log(' - '+f.n+' :: '+f.e)); process.exit(1); }
