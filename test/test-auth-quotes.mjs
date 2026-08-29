import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';

const DIR=new URL('.', import.meta.url).pathname, PORT=8970;
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const srv=http.createServer((q,r)=>{ const u=q.url.split('?')[0]; const f=path.join(DIR,u==='/'?'app.html':u);
  if(!fs.existsSync(f)){ r.writeHead(404); return r.end(); }
  r.writeHead(200,{'Content-Type':T[path.extname(f)]||'text/plain'}); r.end(fs.readFileSync(f)); });
await new Promise(r=>srv.listen(PORT,r));

const R=[]; const ck=(n,c,e)=>R.push({n,ok:!!c,e:c?'':(e||'')});
async function setList(id, text){
  const vals=String(text).split('\n').map(s=>s.trim()).filter(Boolean);
  const tas=page.locator(`#${id} textarea`);
  for(let i=0;i<vals.length;i++){
    if(i>=await tas.count()){ await page.click(`#${id}Add`); await page.waitForTimeout(60); }
    await tas.nth(i).fill(vals[i]);
  }
}
const CORS={'Access-Control-Allow-Origin':'*'};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:402,height:874}});
const errs=[];
page.on('console',m=>{ if(m.type()==='error') errs.push(m.text()); });
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
const noise=e=>/fonts\.(googleapis|gstatic)/.test(e)||(e.includes('403')&&e.includes('Failed to load resource'))||e.includes('mock-firebase-auth.js');

let lookupCalls=[];
await page.route(/itunes\.apple\.com/, route=>{
  const url=new URL(route.request().url());
  lookupCalls.push(url.pathname+'?'+url.searchParams.toString());
  if(url.pathname.includes('/lookup')){
    const eps=[{wrapperType:'track',kind:'podcast',collectionId:111,collectionName:'Apparatus'}];
    for(let i=1;i<=25;i++) eps.push({
      wrapperType:'podcastEpisode', trackName:'Epizoda '+i+(i===7?' o tišini':''),
      episodeNumber:i, trackTimeMillis:(40+i)*60000,
      releaseDate:`2026-0${1+(i%8)}-1${i%9}T10:00:00Z`
    });
    return route.fulfill({status:200,contentType:'application/json',headers:CORS,body:JSON.stringify({resultCount:eps.length,results:eps})});
  }
  route.fulfill({status:200,contentType:'application/json',headers:CORS,body:JSON.stringify({
    resultCount:1, results:[{ artistName:'Marcel Š.', collectionId:111,
      artworkUrl600:'http://is1.mzstatic.com/a.jpg', genres:['Podcasts','Society & Culture'] }]})});
});
await page.route(/googleapis\.com\/books/, r=>r.fulfill({status:200,contentType:'application/json',headers:CORS,body:'{"items":[]}'}));
await page.route(/openlibrary\.org/, r=>r.fulfill({status:200,contentType:'application/json',headers:CORS,body:'{"docs":[]}'}));
await page.route(/mzstatic|books\.google|covers\.openlibrary/, r=>r.fulfill({status:200,contentType:'image/svg+xml',headers:CORS,body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'}));

await page.goto(`http://localhost:${PORT}/app.html`);
await page.waitForTimeout(600);

// ================= 1. Auth gate =================
ck('login gate shown when signed out', await page.locator('#authGate').isVisible());
const covered=await page.evaluate(()=>{
  const el=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
  return !!(el && el.closest('#authGate'));
});
ck('app content covered by gate', covered);
ck('gate paints above app', await page.evaluate(()=>
  +getComputedStyle(document.getElementById('authGate')).zIndex >
  +getComputedStyle(document.querySelector('.nav')).zIndex));
ck('app renamed to Marginalia', (await page.title())==='Marginalia');
ck('gate shows Google button', await page.locator('#googleBtn').isVisible());
ck('mail form hidden initially', !(await page.locator('#mailForm').isVisible()));
ck('body scroll locked', (await page.evaluate(()=>document.body.style.overflow))==='hidden');

await page.click('#showMailBtn'); await page.waitForTimeout(250);
ck('mail form opens', await page.locator('#mailForm').isVisible());
await page.click('#mailGo'); await page.waitForTimeout(200);
ck('empty credentials blocked', (await page.locator('#authMsg').textContent()).includes('Vpiši'));

await page.evaluate(()=>{ window.__auth.failNext='auth/invalid-credential'; });
await page.fill('#authEmail','klemen@example.com'); await page.fill('#authPass','geslo123');
await page.click('#mailGo'); await page.waitForTimeout(350);
ck('wrong password message is human', (await page.locator('#authMsg').textContent()).includes('Napačen'));
ck('still on gate after failure', await page.locator('#authGate').isVisible());

await page.click('#toggleMode'); await page.waitForTimeout(200);
ck('signup mode switches button', (await page.locator('#mailGo').textContent())==='Ustvari račun');
await page.click('#toggleMode'); await page.waitForTimeout(200);
ck('back to login mode', (await page.locator('#mailGo').textContent())==='Prijava');

await page.fill('#authEmail','x'); await page.click('#resetBtn'); await page.waitForTimeout(250);
ck('password reset sends', (await page.evaluate(()=>window.__auth.calls)).some(c=>c.startsWith('reset:')));

// ================= 2. Sign in =================
await page.click('#googleBtn'); await page.waitForTimeout(700);
ck('gate hides after sign-in', !(await page.locator('#authGate').isVisible()));
ck('lands on home', await page.locator('#homeView').isVisible());
ck('scroll unlocked', (await page.evaluate(()=>document.body.style.overflow))==='');
ck('account button shows initial', (await page.locator('#acctBtn').textContent()).trim()==='K');
ck('greeting uses first name', (await page.locator('.greet').textContent()).includes('Klemen'));

// ================= 3. Legacy claim =================
await page.evaluate(()=>window.__auth.signOutNow()); await page.waitForTimeout(400);
await page.evaluate(()=>{
  window.__mock.seed('books',[{ id:'OLD1', title:'Stara knjiga', author:'Nekdo', status:'read', createdAtMs:1 }]);
  window.__mock.seed('podcasts',[{ id:'OLDP', title:'Star podcast', host:'H', episodes:[], createdAtMs:2 }]);
  localStorage.clear();
});
await page.evaluate(()=>window.__auth.signIn({uid:'u_google',email:'klemen@example.com',displayName:'Klemen Burlak',photoURL:''}));
await page.waitForTimeout(900);
const claimed=await page.evaluate(()=>({
  b:window.__mock.dump('books').find(x=>x.id==='OLD1')?.userId,
  p:window.__mock.dump('podcasts').find(x=>x.id==='OLDP')?.userId
}));
ck('legacy book claimed by user', claimed.b==='u_google', JSON.stringify(claimed));
ck('legacy podcast claimed', claimed.p==='u_google');
ck('claimed records now visible', (await page.locator('#hubBooks .hub-count').textContent()).includes('1'));

// ================= 4. Per-user isolation =================
await page.evaluate(()=>window.__mock.seed('books',[
  { id:'OTHER', title:'Tuja knjiga', author:'Nekdo drug', status:'read', userId:'u_someone_else', createdAtMs:5 }
]));
await page.waitForTimeout(400);
ck('other user book not counted', (await page.locator('#hubBooks .hub-count').textContent()).includes('1'));
await page.click('#navBooks'); await page.waitForTimeout(350);
const titles=await page.locator('#list .entry-title').allTextContents();
ck('other user book not listed', !titles.includes('Tuja knjiga'), JSON.stringify(titles));
await page.click('#navHome'); await page.waitForTimeout(300);

// ================= 5. Quote of the day =================
ck('quote card rendered', (await page.locator('.qday').count())===1);
const qText=(await page.locator('.qday-text').textContent()).trim();
ck('quote has text', qText.length>10, qText);
ck('quote wrapped in marks', qText.startsWith('\u201E') && qText.endsWith('\u201C'), qText.slice(0,3)+'…'+qText.slice(-3));
ck('quote has an author', (await page.locator('.qday-author').count())===1);
ck('author is not empty', (await page.locator('.qday-author').textContent()).trim().length>2);
const qFont=await page.evaluate(()=>{ const c=getComputedStyle(document.querySelector('.qday-text'));
  return { fam:c.fontFamily.toLowerCase(), style:c.fontStyle, size:parseFloat(c.fontSize) }; });
ck('quote uses display serif', qFont.fam.includes('fraunces'), JSON.stringify(qFont));
ck('quote is italic', qFont.style==='italic');
ck('quote is prominent', qFont.size>=17, String(qFont.size));

// validate the collection from source
const srcJs=fs.readFileSync(path.join(DIR,'app.js'),'utf8');
const arrMatch=srcJs.match(/const QUOTES = \[([\s\S]*?)\n\];/);
const quoteLines=arrMatch[1].split('\n').map(l=>l.trim()).filter(l=>l.startsWith('"'));
const parsed=quoteLines.map(l=>l.replace(/^"|",?$/g,''));
ck('quote collection sizeable', parsed.length>200, String(parsed.length));
ck('every quote attributed', parsed.every(q=>q.split('|').length===2 && q.split('|')[1].trim()), 
   JSON.stringify(parsed.filter(q=>q.split('|').length!==2).slice(0,2)));
ck('no duplicate quotes', new Set(parsed.map(q=>q.split('|')[0])).size===parsed.length);
ck('quotes stay short', parsed.every(q=>q.split('|')[0].split(' ').length<=30));
const bleak=/življenje je nesmisel|vse je zaman v življenju|ni upanja|nihče te ne mara/i;
ck('no bleak quotes', !parsed.some(q=>bleak.test(q.split('|')[0])),
   JSON.stringify(parsed.filter(q=>bleak.test(q)).slice(0,2)));

// same quote twice within one render
const q1=(await page.locator('.qday-text').textContent()).trim();
await page.click('#navBooks'); await page.waitForTimeout(250);
await page.click('#navHome'); await page.waitForTimeout(350);
const q2=(await page.locator('.qday-text').textContent()).trim();
ck('quote stable within the day', q1===q2, q1.slice(0,25)+' / '+q2.slice(0,25));

// motivational nudge
ck('nudge block present', (await page.locator('.nudge').count())===1);
ck('nudge has text', (await page.locator('.nudge p').textContent()).length>20);

// ================= 6. Podcast simplification =================
await page.click('#navPods'); await page.waitForTimeout(350);
await page.click('#addBtn'); await page.waitForTimeout(350);
ck('podcast sheet has no status field', (await page.locator('#pStatusSeg').count())===0);
ck('podcast sheet has no rating', (await page.locator('#pRating').count())===0);
ck('podcast sheet has no quotes field', (await page.locator('#pQuotes').count())===0);
ck('podcast sheet keeps notes', (await page.locator('#pNotes').count())===1);
ck('notes label mentions episodes', (await page.locator('label[for=pNotes]').textContent()).includes('epizod'));

await page.fill('#pTitle','Apparatus');
await page.click('#pLookupBtn'); await page.waitForTimeout(700);
ck('lookup stored catalogue link', (await page.locator('#pLookupTxt').textContent()).includes('katalog'));
ck('podcast extra fields collapsed by default', !(await page.locator('#pNotes').isVisible()));
await page.click('#podMoreToggle'); await page.waitForTimeout(400);
await setList('pNotes','Poslušam med tekom.');
await page.click('#podSave'); await page.waitForTimeout(600);
const pod=await page.evaluate(()=>window.__mock.dump('podcasts').find(p=>p.title==='Apparatus'));
ck('podcast saved with itunesId', pod.itunesId===111, JSON.stringify(pod.itunesId));
ck('podcast has no status field', pod.status===undefined);
ck('podcast has no rating field', pod.rating===undefined);
ck('podcast has no quotes field', pod.quotes===undefined);
ck('podcast stamped with userId', pod.userId==='u_google');

ck('detail opened', await page.locator('#podDetailView').isVisible());
ck('empty podcast state derived', (await page.locator('.pod-hero .status-tag').textContent())==='Ni še epizod');
ck('no star rating with no episodes', (await page.locator('.pod-hero .stars-wrap').count())===0);

// ================= 7. Episode catalogue =================
await page.click('#epAdd'); await page.waitForTimeout(350);
ck('find row visible for catalogued podcast', await page.locator('#epFindRow').isVisible());
await page.click('#epFindBtn'); await page.waitForTimeout(900);
ck('catalogue lookup called', lookupCalls.some(c=>c.includes('podcastEpisode')), JSON.stringify(lookupCalls));
ck('picker opened', await page.locator('#epFindOverlay').evaluate(e=>e.classList.contains('open')));
const zi=await page.evaluate(()=>({
  find:+getComputedStyle(document.getElementById('epFindOverlay')).zIndex,
  sheet:+getComputedStyle(document.getElementById('epOverlay')).zIndex }));
ck('picker stacks above episode sheet', zi.find>zi.sheet, JSON.stringify(zi));
const topEl=await page.evaluate(()=>{
  const b=document.querySelector('#epFindList .opt').getBoundingClientRect();
  const el=document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);
  return el && el.closest('#epFindOverlay') ? 'picker' : 'blocked';
});
ck('picker actually clickable', topEl==='picker', topEl);
const rows=await page.locator('#epFindList .opt').count();
ck('episodes listed', rows>10, String(rows));
ck('show entry filtered out', !(await page.locator('#epFindList').textContent()).includes('Apparatus'));

await page.fill('#epFindInput','tišini'); await page.waitForTimeout(250);
ck('picker filters', (await page.locator('#epFindList .opt').count())===1);
await page.locator('#epFindList .opt').first().click(); await page.waitForTimeout(350);
ck('picker closed on pick', !(await page.locator('#epFindOverlay').evaluate(e=>e.classList.contains('open'))));
ck('title autofilled', (await page.locator('#eTitle').inputValue()).includes('tišini'));
ck('number autofilled', (await page.locator('#eNum').inputValue())==='7');
ck('duration autofilled', (await page.locator('#eMinutes').inputValue())==='47');
ck('date autofilled', /^\d{4}-\d{2}-\d{2}$/.test(await page.locator('#eDate').inputValue()));

ck('episode extras auto-opened after catalogue fill', await page.locator('#eNum').isVisible());
await page.locator('#eRating').fill('5');
await setList('eQuotes','Molk je tudi odgovor.');
await page.click('#epSave'); await page.waitForTimeout(500);
ck('episode saved', (await page.locator('.ep').count())===1);
ck('state now derived as listened', (await page.locator('.pod-hero .status-tag').textContent())==='Vse poslušano');
ck('podcast rating derived from episode', (await page.locator('.pod-hero .rating-num').textContent())==='5');

// add a second, unlistened episode -> partial state
await page.click('#epAdd'); await page.waitForTimeout(320);
await page.fill('#eTitle','Nova neposlušana');
await page.click('#eStatusSeg button[data-status=wish]');
await page.click('#epSave'); await page.waitForTimeout(450);
ck('partial state shown', (await page.locator('.pod-hero .status-tag').textContent()).includes('1 od 2'));

await page.click('#podBack'); await page.waitForTimeout(350);
ck('card shows derived state', (await page.locator('#podList .entry', {hasText:'Apparatus'}).first().locator('.status-tag').textContent()).includes('1 od 2'));

// filters use derived state
await page.click('#podFilterRow .chip[data-filter=current]'); await page.waitForTimeout(250);
ck('filter V poslušanju matches', (await page.locator('#podList .entry').count())===1);
await page.click('#podFilterRow .chip[data-filter=wish]'); await page.waitForTimeout(250);
ck('Brez epizod matches old podcast', (await page.locator('#podList .entry').count())===1);
await page.click('#podFilterRow .chip[data-filter=all]'); await page.waitForTimeout(250);

// non-catalogued podcast hides the find row
await page.locator('#podList .entry', {hasText:'Star podcast'}).first().locator('.entry-head').click();
await page.waitForTimeout(400);
await page.click('#epAdd'); await page.waitForTimeout(350);
ck('find row hidden without catalogue', !(await page.locator('#epFindRow').isVisible()));
await page.click('#epCancel'); await page.waitForTimeout(280);

// ================= 8. Own quote surfaces =================


// ================= 9. Sign out =================
await page.click('#navHome'); await page.waitForTimeout(300);
await page.click('#acctBtn'); await page.waitForTimeout(320);
ck('account sheet opens', await page.locator('#acctOverlay').evaluate(e=>e.classList.contains('open')));
ck('account shows email', (await page.locator('#acctMail').textContent()).includes('@'));
await page.click('#acctSignOut'); await page.waitForTimeout(600);
ck('gate returns after sign out', await page.locator('#authGate').isVisible());
ck('data cleared from screen', (await page.locator('#hubBooks .hub-count').textContent()).includes('0'),
   await page.locator('#hubBooks .hub-count').textContent());

// sign back in, data returns
await page.evaluate(()=>window.__auth.signIn({uid:'u_google',email:'klemen@example.com',displayName:'Klemen Burlak',photoURL:''}));
await page.waitForTimeout(800);
ck('data returns after re-login', (await page.locator('#hubBooks .hub-count').textContent()).match(/[1-9]/)!==null,
   await page.locator('#hubBooks .hub-count').textContent());

// ================= 10. Books still fine =================
await page.click('#navBooks'); await page.waitForTimeout(320);
await page.click('#addBtn'); await page.waitForTimeout(350);
await page.fill('#fTitle','Nova knjiga');
await page.locator('#fRating').fill('4');
await page.click('#bookMoreToggle'); await page.waitForTimeout(400);
await setList('fQuotes','Prvi citat.\nDrugi citat.');
await page.click('#saveBtn'); await page.waitForTimeout(500);
const nb=await page.evaluate(()=>window.__mock.dump('books').find(b=>b.title==='Nova knjiga'));
ck('book saved with userId', nb.userId==='u_google');
ck('book quotes still array', Array.isArray(nb.quotes)&&nb.quotes.length===2);
ck('book status field kept', nb.status==='read');

// ================= 11. Layout =================
await page.click('#navHome'); await page.waitForTimeout(350);
ck('no h-overflow @402', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.setViewportSize({width:320,height:568}); await page.waitForTimeout(350);
ck('no h-overflow @320', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
await page.evaluate(()=>window.__auth.signOutNow()); await page.waitForTimeout(400);
ck('gate no overflow @320', (await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))<=0);
const gateInputs=await page.evaluate(()=>{ const i=document.getElementById('authEmail'); return parseFloat(getComputedStyle(i).fontSize); });
ck('gate inputs >=16px', gateInputs>=16, String(gateInputs));
const pwStyle=await page.evaluate(()=>{
  const a=getComputedStyle(document.getElementById('authEmail'));
  const b=getComputedStyle(document.getElementById('authPass'));
  return { emailBg:a.backgroundColor, passBg:b.backgroundColor, passColor:b.color };
});
ck('password field matches theme', pwStyle.passBg===pwStyle.emailBg, JSON.stringify(pwStyle));
await page.evaluate(()=>window.__auth.signIn({uid:'u_google',email:'k@e.com',displayName:'Klemen',photoURL:''}));
await page.waitForTimeout(600);
await page.setViewportSize({width:402,height:874}); await page.waitForTimeout(300);

const real=errs.filter(e=>!noise(e));
ck('no console errors', real.length===0, real.slice(0,4).join(' | '));

await page.screenshot({path:`${DIR}/v8-home.png`, fullPage:true});
await page.evaluate(()=>window.__auth.signOutNow()); await page.waitForTimeout(450);
await page.screenshot({path:`${DIR}/v8-login.png`});
await page.evaluate(()=>window.__auth.signIn({uid:'u_google',email:'k@e.com',displayName:'Klemen',photoURL:''}));
await page.waitForTimeout(700);
await page.click('#navPods'); await page.waitForTimeout(400);
await page.locator('#podList .entry', {hasText:'Apparatus'}).first().locator('.entry-head').click();
await page.waitForTimeout(450);
await page.screenshot({path:`${DIR}/v8-pod.png`, fullPage:true});

// ---- quote rotates between days (fresh page, faked clock) ----
async function quoteOn(dateStr){
  const p2=await browser.newPage({viewport:{width:402,height:874}});
  await p2.route(/mzstatic|books\.google|covers\.openlibrary|itunes\.apple|googleapis|openlibrary/,
    r=>r.fulfill({status:200,contentType:'application/json',headers:CORS,body:'{}'}));
  await p2.addInitScript(d=>{
    const Real=Date;
    const fixed=new Real(d).getTime();
    class FakeDate extends Real {
      constructor(...a){ if(!a.length) super(fixed); else super(...a); }
      static now(){ return fixed; }
    }
    window.Date=FakeDate;
  }, dateStr);
  await p2.goto(`http://localhost:${PORT}/app.html`);
  await p2.waitForTimeout(500);
  await p2.evaluate(()=>window.__auth.signIn({uid:'u_x',email:'a@b.c',displayName:'A',photoURL:''}));
  await p2.waitForTimeout(600);
  const t=(await p2.locator('.qday-text').textContent()).trim();
  await p2.close();
  return t;
}
const d1=await quoteOn('2026-09-01T09:00:00Z');
const d2=await quoteOn('2026-09-02T09:00:00Z');
const d1b=await quoteOn('2026-09-01T21:30:00Z');
ck('different quote on the next day', d1!==d2, d1.slice(0,22)+' / '+d2.slice(0,22));
ck('same quote later the same day', d1===d1b, d1.slice(0,22)+' / '+d1b.slice(0,22));

await browser.close(); srv.close();
R.forEach(r=>console.log(`${r.ok?'PASS':'FAIL'}  ${r.n}${r.e?'  >> '+r.e:''}`));
const F=R.filter(r=>!r.ok);
console.log(`\n${R.length-F.length}/${R.length} passed`);
if(F.length){ console.log('\nFAILURES:'); F.forEach(f=>console.log(' - '+f.n+' :: '+f.e)); process.exit(1); }
