# Marginalia

PWA za beleženje prebranih knjig in poslušanih podcastov. Slovenski vmesnik, temna tema.

**V živo:** https://klemenb007.github.io/marginalia/
**Repozitorij:** https://github.com/KlemenB007/marginalia

---

## Zgradba projekta

Namerno **ena sama datoteka**: `index.html` vsebuje HTML, CSS in JavaScript skupaj.
Ni gradbenega postopka, ni prevajanja, ni odvisnosti v času izvajanja razen Firebase
in pisav Google Fonts, ki se naložita s CDN.

```
index.html      celotna aplikacija (~150 KB)
icon.png        ikona za domači zaslon (apple-touch-icon)
test/           testi (ne objavljajo se na strežnik)
package.json    samo za teste
```

Ta odločitev je zavestna: datoteko je mogoče urejati prek spletnega vmesnika GitHub
brez orodij in objaviti z enim commitom.

---

## Tehnologije

| Kaj | S čim |
|---|---|
| Podatki | Cloud Firestore (zbirki `books` in `podcasts`, dokument `settings/{uid}`) |
| Prijava | Firebase Auth — Google in e-pošta z geslom |
| Naslovnice knjig | Google Books API, rezerva OpenLibrary |
| Podcasti in epizode | iTunes Search API (`lookup` z `entity=podcastEpisode`) |
| Gostovanje | GitHub Pages |

Firebase konfiguracija je **namenoma vidna v `index.html`**. Pri Firebase za splet je
to običajna praksa — ključ je javen po zasnovi, dostop pa varujejo varnostna pravila
Firestore. Ne skrivaj je in ne prestavljaj v spremenljivke okolja.

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

1. `test/build-test-app.mjs` vzame pravi `index.html` in zamenja uvoze Firebase
   z lokalnimi lažnimi moduli → nastane `test/app.html`
2. požene vse tri zbirke testov
3. izpiše skupni rezultat

Posamezna zbirka:

```bash
npm run test:podcasts   # knjige, podcasti, epizode, postavitev
npm run test:home       # domači zaslon, barvna shema, navigacija
npm run test:auth       # prijava, citat dneva, katalog epizod
```

Skupaj okoli 260 preverjanj.

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

---

## Objava

GitHub Pages objavi vsak commit v vejo `main` samodejno, v minuti ali dveh.
Posebnega koraka za gradnjo ni.

```bash
git add index.html
git commit -m "opis spremembe"
git push
```

Mapa `test/` je v repozitoriju nemoteča — GitHub Pages postreže samo tisto,
kar brskalnik zahteva.

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

**Prelivanje.** Po vsaki spremembi postavitve preveri širino pri 320 px.

**Vsaka sprememba naj bo pred oddajo pognana skozi `npm test` in vizualno pregledana
s posnetkom zaslona.** Tako smo doslej našli večino napak — ne v kodi, ampak v tem,
kako je izgledala na telefonu.

---

## Odprto

- **Prijava z Google v načinu z domačega zaslona.** Preusmeritev na iOS odpre Safari
  kot ločeno aplikacijo in seja se izgubi. V teku je prehod na Google Identity Services
  (`signInWithCredential` z ID žetonom), ki prijavo prikaže znotraj strani.
  Zahteva Web client ID in vpis `https://klemenb007.github.io` med
  *Authorized JavaScript origins* v Google Cloud Console.
- **Prijava z Apple** — zahteva članstvo v Apple Developer Program (99 USD letno).
- **Nalaganje po delih** — smiselno šele pri nekaj sto rednih uporabnikih.
  Trenutno se ob vsakem odprtju preberejo vsi uporabnikovi zapisi.
