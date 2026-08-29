# Marginalia

PWA za beleženje prebranih knjig in poslušanih podcastov. Slovenski vmesnik, temna tema.

**V živo:** https://klemenb007.github.io/marginalia/
**Repozitorij:** https://github.com/KlemenB007/marginalia

---

## Zgradba projekta

Brez gradbenega postopka in brez prevajanja. Aplikacija so tri navadne datoteke,
ki se objavijo take, kot so. Edine odvisnosti v času izvajanja so Firebase, pisave
Google Fonts in prijava Google (GSI), ki se naložijo s CDN; Chart.js je priložen
lokalno v `vendor/`.

```
index.html            HTML-ogrodje (naloži style.css in app.js)
style.css             ves slog
app.js                glavna logika: stanje, izris, okna, sinhronizacija (ES-modul, vstopna točka)
firebase.js           Firebase konfiguracija in povezava; izvozi vse Firebase funkcije za app.js
utils.js              čiste pomožne funkcije in ikone (esc, toLines, starHtml …)
lookups.js            poizvedbe po Google Books, OpenLibrary in iTunes
quotes.js             nabor citatov za „Misel dneva"
manifest.webmanifest  PWA: ime, barve, ikone, standalone
sw.js                 service worker — predpomni lupino aplikacije za offline zagon
icon.png              apple-touch-icon (180×180)
icon-192.png          PWA ikona
icon-512.png          PWA ikona (tudi maskable)
vendor/chart.umd.min.js   Chart.js v4 (grafi v statistiki) — mora se commitati
test/                 testi (ne objavljajo se na strežnik)
package.json          samo za teste
```

`index.html` nalaga `<link rel="stylesheet" href="style.css">` in
`<script type="module" src="app.js">`. `app.js` nato z `import` potegne `firebase.js`,
`utils.js`, `lookups.js` in `quotes.js`. Razdelitev je bila narejena, ker je bila ena
datoteka pretežka za urejanje; objava je še vedno en `git push`.

---

## Tehnologije

| Kaj | S čim |
|---|---|
| Podatki | Cloud Firestore (zbirki `books` in `podcasts`, dokument `settings/{uid}`) |
| Prijava | Firebase Auth — Google in e-pošta z geslom |
| Naslovnice knjig | Google Books API, rezerva OpenLibrary |
| Podcasti in epizode | iTunes Search API (`lookup` z `entity=podcastEpisode`) |
| Gostovanje | GitHub Pages |
| Namestitev / offline | `manifest.webmanifest` + `sw.js` (predpomni lupino) |

Firebase konfiguracija je **namenoma vidna v `firebase.js`**. Pri Firebase
za splet je to običajna praksa — ključ je javen po zasnovi, dostop pa varujejo varnostna
pravila Firestore. Ne skrivaj je in ne prestavljaj v spremenljivke okolja.

Service worker (`sw.js`) predpomni le lupino aplikacije (HTML/CSS/JS/ikone/Chart.js)
po vzorcu *stale-while-revalidate*: ob odprtju takoj postreže iz predpomnilnika, v
ozadju pa osveži. Klici na Firestore, Google in Apple gredo vedno na omrežje.
Registrira se **samo prek `https:`** (torej ne v testih ali na `python -m http.server`).
Ob spremembi datotek dvigni številko v `const CACHE = 'marginalia-v1'`, da se stari
predpomnilnik počisti.

### Podatkovni model

Vsak dokument nosi `userId` in pravila dovolijo dostop samo lastniku.

```
books/{id}       title, author, quotes[], notes[], genres[], color, status,
                 rating (0–5, korak 0,5), pages, pageAt, published,
                 readMonth, readYear, coverUrl, userId, createdAtMs

podcasts/{id}    title, host, notes[], genres[], color, coverUrl, itunesId,
                 userId, createdAtMs,
                 episodes[] — vgnezdeno polje:
                   { id, title, num, minutes, date, status, rating, quotes[], notes[] }

settings/{uid}   goal, goalYear, userId
```

Podcast **nima** lastnega statusa ali ocene — oboje se izračuna iz njegovih epizod
(funkciji `podState()` in `podRatingAvg()`). Citati se zapisujejo pri epizodah,
opombe pa tudi na ravni podcasta.

Starejši zapisi so lahko imeli `quotes` in `notes` kot navadno besedilo namesto polja.
Funkcija `toLines()` sprejme oboje, zato migracija ni potrebna.

---

## Zagon testov

Testi tečejo v pravem brskalniku (Playwright, Chromium) proti **lažnim modulom
Firebase**, zato ne potrebujejo omrežja in ne posegajo v pravo bazo.

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` naredi troje:

1. `test/build-test-app.mjs` vzame prave `index.html`, `style.css` in vse module
   (`app.js`, `firebase.js`, `utils.js`, `lookups.js`, `quotes.js`), zamenja uvoze
   Firebase v `firebase.js` z lokalnimi lažnimi moduli, GSI `<script>` z lažnim in
   odstrani `<link rel="manifest">` → nastanejo `test/app.html` + `test/*.js` +
   `test/style.css` (pričakuje 5 zamenjav: 3 Firebase + GSI + manifest)
2. požene vse tri zbirke testov
3. izpiše skupni rezultat

Posamezna zbirka:

```bash
npm run test:podcasts   # knjige, podcasti, epizode, postavitev
npm run test:home       # domači zaslon, barvna shema, navigacija
npm run test:auth       # prijava, citat dneva, katalog epizod
```

Skupaj 271 preverjanj (podcasti 119, domov 59, prijava 93).

### Kaj je v katerem lažnem modulu

`mock-firebase-firestore.js` — pomnilniška baza z `onSnapshot`, `query`/`where`,
`addDoc`, `updateDoc`, `deleteDoc`, `setDoc`. Ponuja `window.__mock`:

```js
window.__mock.seed('books', [ {...} ])   // vstavi zapise (userId doda sam)
window.__mock.dump('books')              // preberi vse
window.__mock.failNext = 'add'           // naslednji zapis naj spodleti
```

`mock-firebase-auth.js` — ponuja `window.__auth`:

```js
window.__auth.signIn({ uid:'u_test', email:'a@b.c', displayName:'Test', photoURL:'' })
window.__auth.signOutNow()
window.__auth.failNext = 'auth/invalid-credential'
```

Zunanji API-ji (Google Books, iTunes, OpenLibrary) se v testih prestrezajo
s `page.route()`. Odgovori morajo vsebovati glavo `Access-Control-Allow-Origin: *`,
sicer jih brskalnik zavrne.

### Pisanje novih testov

Vsaka zbirka postavi majhen HTTP strežnik nad mapo `test/`, odpre `app.html`,
se prijavi in nato preverja. Vzorec:

```js
await page.goto(`http://localhost:${PORT}/app.html`);
await page.waitForTimeout(600);
await page.evaluate(()=>window.__auth.signIn({uid:'u_test',email:'t@e.si',displayName:'Test',photoURL:''}));
await page.waitForTimeout(700);
```

Brez prijave se prikaže samo prijavni zaslon in vse ostalo je skrito.

---

## Ročno preverjanje s pravo bazo

`localhost` je med dovoljenimi domenami v Firebase, zato aplikacija lokalno deluje
v celoti, vključno s prijavo in sinhronizacijo:

```bash
npm run serve      # ali: python3 -m http.server 8000
```

Odpri `http://127.0.0.1:8000`. Pozor: to piše v **pravo** bazo.

Service worker se prek navadnega `http` ne registrira, zato offline zagona tu ni
mogoče preizkusiti. To se preveri na živi strani: odpri aplikacijo z domačega zaslona,
vklopi letalski način in jo znova odpri — lupina se mora naložiti (podatki se
sinhronizirajo, ko je povezava spet na voljo).

---

## Objava

GitHub Pages objavi vsak commit v vejo `main` samodejno, v minuti ali dveh.
Posebnega koraka za gradnjo ni.

```bash
git add -A
git commit -m "opis spremembe"
git push
```

Mapa `test/` je v repozitoriju nemoteča — GitHub Pages postreže samo tisto,
kar brskalnik zahteva. Ob spremembi `sw.js` ali lupine (`index.html`, `style.css`,
`app.js`, `firebase.js`, `utils.js`, `lookups.js`, `quotes.js`, `vendor/`) dvigni
`CACHE` v `sw.js` in dopolni seznam `SHELL`, sicer starejši obiskovalci dobijo
osvežene datoteke šele ob drugem odprtju.

---

## Kaj je vredno vedeti pred spreminjanjem

**Specifičnost CSS.** Pravila kot `input[type=text]` premagajo pravila z razredom.
To je že enkrat tiho pokvarilo iskalno polje. Če slog ne prime, najprej preveri to.

**Znaki v CSS `content`.** Uporabljaj prave znake (`„`), ne ubežnih zaporedij —
ta so se v preteklosti izpisala kot dobesedno besedilo.

**Širina in inline elementi.** `width` ne deluje na `<span>` brez `display:block`.
Zaradi tega so bili nekoč vsi stolpci v statistiki enako dolgi.

**Prekrivanje oken.** Okno, ki se odpre nad drugim (izbirnik epizod nad obrazcem),
potrebuje višji `z-index`, sicer je neuporabno na dotik.

**Velikost vnosnih polj.** Vsaj `16px`, sicer iOS ob dotiku približa stran.

**Poteg za zapiranje oken.** `enableSheetSwipe` posluša dotik na celotni `.sheet`.
Poteg se sme sprožiti šele po ~14 px jasno navpičnega premika in nikoli, če se dotik
začne na gumbu ali polju — sicer je na iPadu požrl tap na „Prekliči".

**Tipkovnica pri urejanju.** Okna ob odprtju samodejno fokusirajo naslov samo pri
*novem* vnosu (`if(!editingId)` …), da pri urejanju ne skoči tipkovnica čez gumbe.

**Prelivanje.** Po vsaki spremembi postavitve preveri širino pri 320 px.

**Vsaka sprememba naj bo pred oddajo pognana skozi `npm test` in vizualno pregledana
s posnetkom zaslona.** Tako smo doslej našli večino napak — ne v kodi, ampak v tem,
kako je izgledala na telefonu.

---

## Odprto

- **Prijava z Apple** — zahteva članstvo v Apple Developer Program (99 USD letno).
- **Nalaganje po delih** — smiselno šele pri nekaj sto rednih uporabnikih.
  Trenutno se ob vsakem odprtju preberejo vsi uporabnikovi zapisi.
- **Brisanje brez razveljavitve** — `removeBook` / `removePod` / `removeEpisode`
  takoj izbrišejo zapis in izbris se sinhronizira. Manjka potrditev ali „Razveljavi".

Prijava z Google deluje tudi v načinu z domačega zaslona: uporablja Google Identity
Services (`google.accounts.id` + `signInWithCredential` z ID žetonom, oboje v `app.js`),
zato prijava ostane znotraj strani in se seja ne izgubi. Zahteva Web client ID in vpis
`https://klemenb007.github.io` med *Authorized JavaScript origins* v Google Cloud Console.
