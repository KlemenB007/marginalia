import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const DIR = new URL('.', import.meta.url).pathname, PORT = 8961;
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
const srv = http.createServer((q,r)=>{ const u=q.url.split('?')[0]; const f=path.join(DIR,u==='/'?'app.html':u);
  if(!fs.existsSync(f)){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'}); r.end(fs.readFileSync(f)); });
await new Promise(r=>srv.listen(PORT,r));

const R=[]; const ck=(n,c,e)=>R.push({n,ok:!!c,e:c?'':(e||'')});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:402,height:874}, acceptDownloads:true });
const errs=[];
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('download',d=>d.path().catch(()=>{}));   // izvoz: pogoltni prenos v testu
const noise=e=>/fonts\.(googleapis|gstatic)/.test(e)||(e.includes('403')&&e.includes('Failed to load resource'))||e.includes('mock-firebase-auth');
await page.route(/mzstatic|books\.google|covers\.openlibrary/, r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'}));

await page.goto(`http://localhost:${PORT}/app.html`);
await page.waitForTimeout(600);
await page.evaluate(()=>window.__auth.signIn({uid:'u_test',email:'t@e.si',displayName:'Test',photoURL:''}));
await page.waitForTimeout(600);

const YEAR = new Date().getFullYear();
await page.evaluate(Y=>{
  window.__mock.seed('books',[
    { id:'B1', title:'Homo Deus', author:'Harari', status:'read', rating:4, readYear:Y, readMonth:3,
      genres:['zgodovina'], quotes:['Prihodnost ni napisana.','Podatki so nova nafta.'], notes:['Opomba ena.'], createdAtMs:300 },
    { id:'B2', title:'Erebos', author:'Poznanski', status:'current', quotes:['Igra te opazuje.'], notes:[], createdAtMs:200 },
    { id:'B3', title:'Tiha knjiga', author:'X', status:'wish', quotes:[], notes:[], createdAtMs:100 }
  ]);
  window.__mock.seed('podcasts',[
    { id:'P1', title:'Apparatus', host:'Marcel', color:'#9C8CFA', genres:['kultura'], notes:[], createdAtMs:400,
      episodes:[
        { id:'e1', title:'Prva epizoda', num:1, minutes:50, date:Y+'-04-01', status:'read', rating:5, quotes:['Citat iz epizode.'], notes:[] },
        { id:'e2', title:'Druga epizoda', num:2, minutes:40, date:Y+'-04-08', status:'read', rating:4, quotes:[], notes:['Zapis.'] }
      ] }
  ]);
}, YEAR);
await page.waitForTimeout(400);

/* ===================== PREGLED CITATOV ===================== */
ck('home ima gumb za pregled citatov', await page.locator('#qdayAll').count()===1);
const qdayTxt = await page.locator('#qdayAll').textContent();
ck('gumb pokaže skupno število citatov (4)', qdayTxt.includes('4'), qdayTxt);

await page.click('#qdayAll'); await page.waitForTimeout(400);
ck('odpre se pogled citatov', await page.locator('#quotesView').isVisible());
ck('drugi pogledi skriti', !(await page.locator('#homeView').isVisible()));
ck('+ skrit v pregledu citatov', (await page.locator('#addBtn').evaluate(e=>getComputedStyle(e).visibility))==='hidden');
const cnt = await page.locator('#quotesView .greet-sub').textContent();
ck('šteje 4 citate', cnt.includes('4'), cnt);
ck('izpiše vse 4 kartice', (await page.locator('.qb-card').count())===4);

// iskanje
await page.fill('#qbSearch','nafta'); await page.waitForTimeout(250);
ck('iskanje filtrira na 1 zadetek', (await page.locator('.qb-card').count())===1);
ck('pravi zadetek', (await page.locator('.qb-card .quote-item').textContent()).includes('nafta'));
await page.fill('#qbSearch',''); await page.waitForTimeout(200);
ck('brisanje iskanja vrne vse', (await page.locator('.qb-card').count())===4);

// filter po vrsti
ck('sta oba filtra (knjige/podcasti)', (await page.locator('.chip[data-kind]').count())===3);
await page.click('.chip[data-kind="pod"]'); await page.waitForTimeout(250);
ck('filter podcasti -> 1 citat', (await page.locator('.qb-card').count())===1);
await page.click('.chip[data-kind="book"]'); await page.waitForTimeout(250);
ck('filter knjige -> 3 citati', (await page.locator('.qb-card').count())===3);
await page.click('.chip[data-kind="all"]'); await page.waitForTimeout(200);

// klik na kartico odpre vir
await page.click('.chip[data-kind="pod"]'); await page.waitForTimeout(200);
await page.locator('.qb-card').first().click(); await page.waitForTimeout(400);
ck('klik na citat epizode odpre podcast', await page.locator('#podDetailView').isVisible());
ck('odprta prava epizoda', await page.locator('.ep[data-eid="e1"]').evaluate(e=>e.classList.contains('open')));

// nazaj domov
await page.click('#navHome'); await page.waitForTimeout(300);
await page.click('#qdayAll'); await page.waitForTimeout(300);
await page.click('#qbBack'); await page.waitForTimeout(300);
ck('gumb Domov v pregledu citatov deluje', await page.locator('#homeView').isVisible());

// dostop tudi iz računa
await page.click('#acctBtn'); await page.waitForTimeout(300);
ck('račun ima povezavo Vsi citati', await page.locator('#acctQuotes').count()===1);
await page.click('#acctQuotes'); await page.waitForTimeout(300);
ck('račun -> pregled citatov', await page.locator('#quotesView').isVisible());
await page.click('#navHome'); await page.waitForTimeout(300);

/* ===================== IZVOZ (JSON) ===================== */
await page.click('#acctBtn'); await page.waitForTimeout(300);
ck('račun ima gumb za izvoz', await page.locator('#acctExport').count()===1);
await page.click('#acctExport'); await page.waitForTimeout(500);
ck('izvoz zapre okno računa', !(await page.locator('#acctOverlay').evaluate(e=>e.classList.contains('open'))));

/* ===================== RAZVELJAVI IZBRIS — KNJIGA ===================== */
await page.click('#navBooks'); await page.waitForTimeout(400);
await page.locator('#list .entry[data-id="B2"] .entry-head').click(); await page.waitForTimeout(400);
await page.locator('#list .entry[data-id="B2"] .deleteBtn').click(); await page.waitForTimeout(300);
ck('po izbrisu se pokaže obvestilo', await page.locator('#toast').isVisible());
ck('knjiga izgine s seznama', (await page.locator('#list .entry[data-id="B2"]').count())===0);
ck('knjiga je v bazi še vedno (ni dokončno)', await page.evaluate(()=>window.__mock.dump('books').some(b=>b.id==='B2')));

await page.click('#toastUndo'); await page.waitForTimeout(300);
ck('razveljavitev skrije obvestilo', !(await page.locator('#toast').isVisible()));
ck('knjiga je spet na seznamu', (await page.locator('#list .entry[data-id="B2"]').count())===1);
ck('knjiga je še v bazi', await page.evaluate(()=>window.__mock.dump('books').some(b=>b.id==='B2')));

// zdaj izbriši zares in počakaj iztek okna
await page.locator('#list .entry[data-id="B2"] .entry-head').click(); await page.waitForTimeout(300);
await page.locator('#list .entry[data-id="B2"] .deleteBtn').click(); await page.waitForTimeout(300);
await page.waitForTimeout(7000);
ck('po izteku okna obvestilo izgine', !(await page.locator('#toast').isVisible()));
ck('knjiga je dokončno izbrisana iz baze', await page.evaluate(()=>!window.__mock.dump('books').some(b=>b.id==='B2')));
ck('ostali knjigi ostaneta', await page.evaluate(()=>window.__mock.dump('books').length===2));

/* ===================== RAZVELJAVI IZBRIS — EPIZODA ===================== */
await page.click('#navPods'); await page.waitForTimeout(300);
await page.locator('#podList .entry[data-id="P1"] .entry-head').click(); await page.waitForTimeout(400);
await page.locator('.ep[data-eid="e2"] .ep-row').click(); await page.waitForTimeout(300);
await page.locator('.ep[data-eid="e2"] .epDel').click(); await page.waitForTimeout(300);
ck('epizoda izgine iz seznama', (await page.locator('.ep[data-eid="e2"]').count())===0);
ck('epizoda še v bazi', await page.evaluate(()=>window.__mock.dump('podcasts')[0].episodes.some(e=>e.id==='e2')));
await page.click('#toastUndo'); await page.waitForTimeout(300);
ck('epizoda se vrne', (await page.locator('.ep[data-eid="e2"]').count())===1);

// izbriši zares
await page.locator('.ep[data-eid="e2"] .ep-row').click(); await page.waitForTimeout(300);
await page.locator('.ep[data-eid="e2"] .epDel').click(); await page.waitForTimeout(300);
await page.waitForTimeout(7000);
ck('epizoda dokončno izbrisana', await page.evaluate(()=>!window.__mock.dump('podcasts')[0].episodes.some(e=>e.id==='e2')));
ck('druga epizoda ostane', await page.evaluate(()=>window.__mock.dump('podcasts')[0].episodes.some(e=>e.id==='e1')));

/* ===================== RAZVELJAVI IZBRIS — PODCAST ===================== */
await page.locator('#podDelete').click(); await page.waitForTimeout(300);
ck('po izbrisu podcasta smo na seznamu', await page.locator('#podsView').isVisible());
ck('podcast izgine', (await page.locator('#podList .entry[data-id="P1"]').count())===0);
ck('podcast še v bazi', await page.evaluate(()=>window.__mock.dump('podcasts').some(p=>p.id==='P1')));
await page.click('#toastUndo'); await page.waitForTimeout(300);
ck('podcast se vrne na seznam', (await page.locator('#podList .entry[data-id="P1"]').count())===1);
ck('podcast ostane v bazi', await page.evaluate(()=>window.__mock.dump('podcasts').some(p=>p.id==='P1')));

/* ===================== zaključek ===================== */
ck('no h-overflow @402', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.setViewportSize({width:320,height:568});
await page.click('#navHome'); await page.waitForTimeout(300);
await page.click('#qdayAll'); await page.waitForTimeout(300);
ck('no h-overflow @320 (citati)', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.setViewportSize({width:402,height:874}); await page.waitForTimeout(200);

const real = errs.filter(e=>!noise(e));
ck('no console errors', real.length===0, real.slice(0,4).join(' | '));

await page.screenshot({ path:`${DIR}/v8-quotes.png`, fullPage:true });

await browser.close(); srv.close();
R.forEach(r=>console.log(`${r.ok?'PASS':'FAIL'}  ${r.n}${r.e?'  >> '+r.e:''}`));
const F=R.filter(r=>!r.ok);
console.log(`\n${R.length-F.length}/${R.length} passed`);
if(F.length){ console.log('\nFAILURES:'); F.forEach(f=>console.log(' - '+f.n+' :: '+f.e)); process.exit(1); }
