/**
 * Enote — čiste funkcije v utils.js in lookups.js.
 * Tečejo v golem Node-u, brez brskalnika in brez omrežja (fetch je zamenjan).
 *
 * Zagon:  node test/test-units.mjs   (ali: npm run test:units)
 */
import {
  esc, toLines, fmtRating, slPlural, normGenre, httpsify, uid,
  starHtml, quotesHtml, notesHtml, marksHtml
} from '../utils.js';
import { lookupBook, fetchEpisodes, lookupPodcast } from '../lookups.js';

const R = [];
const ck = (n, fn) => {
  try { fn(); R.push({ n, ok: true }); }
  catch (e) { R.push({ n, ok: false, e: e.message }); }
};
const eq = (got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`dobil ${a}, pričakoval ${b}`);
};
const ok = (c, msg) => { if (!c) throw new Error(msg || 'ni res'); };

/* zamenja globalni fetch z odgovori glede na URL (regex -> JSON payload) */
function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    for (const [re, payload] of routes) {
      if (re.test(String(url))) return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

/* ===== utils.js ===== */

ck('esc pobegne < > & " \'', () => eq(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;'));
ck('esc null -> prazno', () => eq(esc(null), ''));

ck('toLines: polje se obreže in počisti', () => eq(toLines(['  a ', '', 'b']), ['a', 'b']));
ck('toLines: besedilo se razbije po vrsticah', () => eq(toLines('a\n \nb'), ['a', 'b']));
ck('toLines: prazno -> []', () => eq(toLines(null), []));

ck('fmtRating: celo je celo', () => eq(fmtRating(4), '4'));
ck('fmtRating: pol z vejico', () => eq(fmtRating(4.5), '4,5'));

ck('slPlural 1', () => eq(slPlural(1, ['a', 'b', 'c', 'd']), 'a'));
ck('slPlural 2', () => eq(slPlural(2, ['a', 'b', 'c', 'd']), 'b'));
ck('slPlural 3', () => eq(slPlural(3, ['a', 'b', 'c', 'd']), 'c'));
ck('slPlural 5', () => eq(slPlural(5, ['a', 'b', 'c', 'd']), 'd'));
ck('slPlural 22 -> zadnja oblika (n%100=22)', () => eq(slPlural(22, ['a', 'b', 'c', 'd']), 'd'));
ck('slPlural 102 -> oblika za 2 (n%100=2)', () => eq(slPlural(102, ['a', 'b', 'c', 'd']), 'b'));

ck('normGenre: male črke, en presledek', () => eq(normGenre('  Znanstvena   Fantastika '), 'znanstvena fantastika'));

ck('httpsify: http -> https', () => eq(httpsify('http://x/y.jpg'), 'https://x/y.jpg'));
ck('httpsify: https ostane', () => eq(httpsify('https://x'), 'https://x'));
ck('httpsify: prazno ostane prazno', () => eq(httpsify(''), ''));

ck('uid: predpona e_ in enoličnost', () => {
  const s = new Set();
  for (let i = 0; i < 2000; i++) {
    const u = uid();
    ok(u.startsWith('e_'), 'ni predpone e_');
    s.add(u);
  }
  ok(s.size === 2000, 'podvojen uid');
});

ck('starHtml: brez ocene -> prazno', () => eq(starHtml(0), ''));
ck('starHtml: 3 -> 60 % in številka', () => {
  const h = starHtml(3);
  ok(h.includes('width:60%'), 'ni 60 %');
  ok(h.includes('>3<'), 'ni številke 3');
});

ck('quotesHtml: prazno -> prazno', () => eq(quotesHtml([]), ''));
ck('quotesHtml: citat je pobegnjen in v narekovajih', () => {
  const h = quotesHtml(['<b>x']);
  ok(h.includes('quote-item'), 'ni razreda');
  ok(h.includes('&lt;b&gt;x'), 'ni pobegnjeno');
  ok(h.includes('„') && h.includes('“'), 'ni narekovajev');
});

ck('notesHtml: oštevilči opombe', () => {
  const h = notesHtml(['prva', 'druga']);
  ok(h.includes('>1<') && h.includes('>2<'), 'ni oštevilčenja');
  ok(h.includes('prva') && h.includes('druga'), 'ni besedila');
});

ck('marksHtml: pokaže samo, kar ni 0', () => {
  ok(marksHtml(0, 0, 0) === '', 'prazno ni prazno');
  const h = marksHtml(2, 0, 3);
  ok(h.includes('2') && h.includes('3'), 'manjkajo števila');
});

/* ===== lookups.js (fetch je zamenjan) ===== */

const realFetch = globalThis.fetch;

// lookupBook — Google Books zadetek
stubFetch([
  [/googleapis\.com\/books/, {
    items: [{
      volumeInfo: {
        authors: ['Yuval Noah Harari'],
        publishedDate: '2011-05-01',
        pageCount: 443,
        categories: ['History'],
        imageLinks: { thumbnail: 'http://books.example/cover.jpg' }
      }
    }]
  }]
]);
const gb = await lookupBook('Sapiens', 'Harari');
ck('lookupBook: avtor iz Google Books', () => eq(gb.author, 'Yuval Noah Harari'));
ck('lookupBook: leto je 4 številke', () => eq(gb.published, '2011'));
ck('lookupBook: strani', () => eq(gb.pages, 443));
ck('lookupBook: žanr normiran', () => eq(gb.genres, ['history']));
ck('lookupBook: naslovnica je https', () => ok(gb.cover.startsWith('https://'), gb.cover));

// lookupBook — Google prazen -> OpenLibrary rezerva
stubFetch([
  [/googleapis\.com\/books/, { items: [] }],
  [/openlibrary\.org\/search/, {
    docs: [{ cover_i: 42, author_name: ['Ime Priimek'], first_publish_year: 1999, number_of_pages_median: 210 }]
  }]
]);
const ol = await lookupBook('Nekaj', '');
ck('lookupBook: rezerva OpenLibrary (avtor)', () => eq(ol.author, 'Ime Priimek'));
ck('lookupBook: rezerva OpenLibrary (leto)', () => eq(ol.published, 1999));
ck('lookupBook: rezerva OpenLibrary (naslovnica)', () => ok(ol.cover.includes('covers.openlibrary.org'), ol.cover));

// lookupBook — nič najdenega -> null
stubFetch([
  [/googleapis\.com\/books/, { items: [] }],
  [/openlibrary\.org\/search/, { docs: [] }]
]);
const noneBook = await lookupBook('xyzabc', '');
ck('lookupBook: brez zadetka vrne null', () => eq(noneBook, null));

// fetchEpisodes
stubFetch([
  [/itunes\.apple\.com\/lookup/, {
    results: [
      { wrapperType: 'track', kind: 'podcast', collectionName: 'Pod' },
      { wrapperType: 'podcastEpisode', kind: 'podcast-episode', trackName: 'Epizoda ena',
        episodeNumber: 12, trackTimeMillis: 3600000, releaseDate: '2020-03-04T10:00:00Z' },
      { wrapperType: 'podcastEpisode', kind: 'podcast-episode', trackName: '' }
    ]
  }]
]);
const eps = await fetchEpisodes(123);
const epsNone = await fetchEpisodes(null);
ck('fetchEpisodes: ena veljavna epizoda (prazni naslov izpade)', () => eq(eps.length, 1));
ck('fetchEpisodes: naslov', () => eq(eps[0].title, 'Epizoda ena'));
ck('fetchEpisodes: minute iz ms', () => eq(eps[0].minutes, 60));
ck('fetchEpisodes: datum obrezan na 10 znakov', () => eq(eps[0].date, '2020-03-04'));
ck('fetchEpisodes: brez itunesId vrne []', () => eq(epsNone, []));

// lookupPodcast
stubFetch([
  [/itunes\.apple\.com\/search/, {
    results: [{
      artistName: 'Voditelj X',
      artworkUrl600: 'http://itunes.example/art600.jpg',
      collectionId: 555,
      genres: ['News', 'Podcasts', 'Society & Culture']
    }]
  }]
]);
const pod = await lookupPodcast('Neki podcast');
ck('lookupPodcast: voditelj', () => eq(pod.host, 'Voditelj X'));
ck('lookupPodcast: naslovnica https', () => ok(pod.cover.startsWith('https://'), pod.cover));
ck('lookupPodcast: itunesId', () => eq(pod.itunesId, 555));
ck('lookupPodcast: žanri brez "podcasts", normirani', () => eq(pod.genres, ['news', 'society & culture']));

stubFetch([[/itunes\.apple\.com\/search/, { results: [] }]]);
const noPod = await lookupPodcast('xxx');
ck('lookupPodcast: brez zadetka -> null', () => eq(noPod, null));

globalThis.fetch = realFetch;

/* ===== izpis ===== */
R.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.e ? '  >> ' + r.e : ''}`));
const F = R.filter(r => !r.ok);
console.log(`\n${R.length - F.length}/${R.length} passed`);
if (F.length) { console.log('\nNAPAKE:'); F.forEach(f => console.log(' - ' + f.n + ' :: ' + f.e)); process.exit(1); }
