#!/usr/bin/env node
/**
 * Naredi testno kopijo aplikacije: test/app.html + test/app.js + test/style.css
 *
 * Vzame prave ../index.html, ../app.js in ../style.css ter zamenja uvoze
 * Firebase (v app.js) z lokalnimi lažnimi moduli in pravi GSI <script>
 * (v index.html) z lažnim, da testi tečejo brez omrežja in brez prave baze.
 *
 * Zagon:  node test/build-test-app.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SRC_HTML = path.join(root, 'index.html');
const SRC_JS   = path.join(root, 'app.js');
const SRC_CSS  = path.join(root, 'style.css');
const OUT_HTML = path.join(here, 'app.html');
const OUT_JS   = path.join(here, 'app.js');
const OUT_CSS  = path.join(here, 'style.css');

for (const f of [SRC_HTML, SRC_JS, SRC_CSS]) {
  if (!fs.existsSync(f)) {
    console.error('Ne najdem', path.basename(f), 'v', root);
    process.exit(1);
  }
}

let html = fs.readFileSync(SRC_HTML, 'utf8');
let js   = fs.readFileSync(SRC_JS, 'utf8');

// Lažni Google Identity Services: brez omrežja, z resničnim klikljivim gumbom.
const GSI_STUB = `<script>
window.google = { accounts: { id: {
  _cb: null,
  initialize(o){ this._cb = o && o.callback; },
  renderButton(el){
    if(!el) return;
    const b = document.createElement('button');
    b.id = 'googleBtn'; b.className = 'auth-btn'; b.type = 'button';
    b.textContent = 'Nadaljuj z Google';
    b.addEventListener('click', () => {
      window.__auth.calls.push('gsi');
      window.google.accounts.id._cb && window.google.accounts.id._cb({ credential: 'fake.jwt.token' });
    });
    el.appendChild(b);
  },
  prompt(){}
} } };
</script>`;

// app.js: uvozi Firebase s CDN-ja -> lokalni lažni moduli
const jsSwaps = [
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js/g,       './mock-firebase-app.js'],
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-firestore\.js/g, './mock-firebase-firestore.js'],
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js/g,      './mock-firebase-auth.js'],
];
// index.html: pravi GSI <script> -> lažni; manifest (PWA) v testu ne rabimo
const htmlSwaps = [
  [/<script src="https:\/\/accounts\.google\.com\/gsi\/client"[^>]*><\/script>/g, GSI_STUB],
  [/<link rel="manifest"[^>]*>\s*/g, ''],
];

let hits = 0;
for (const [re, to] of jsSwaps)   { hits += (js.match(re)   || []).length; js   = js.replace(re, to); }
for (const [re, to] of htmlSwaps) { hits += (html.match(re) || []).length; html = html.replace(re, to); }

// 3 Firebase uvozi (app.js) + GSI <script> + manifest <link> (index.html)
if (hits < 5) {
  console.error(`Opozorilo: pričakoval 5 zamenjav, našel ${hits}. So se poti spremenile?`);
  process.exit(1);
}

fs.writeFileSync(OUT_HTML, html);
fs.writeFileSync(OUT_JS, js);
fs.copyFileSync(SRC_CSS, OUT_CSS);

// ikona, da se <link rel="apple-touch-icon" href="icon.png"> ne lomi
const icon = path.join(root, 'icon.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(here, 'icon.png'));

// lokalna kopija Chart.js (<script src="vendor/chart.umd.min.js">)
const vSrc = path.join(root, 'vendor');
if (fs.existsSync(vSrc)) {
  const vOut = path.join(here, 'vendor');
  fs.mkdirSync(vOut, { recursive: true });
  for (const f of fs.readdirSync(vSrc)) fs.copyFileSync(path.join(vSrc, f), path.join(vOut, f));
}

const kb = ((html.length + js.length) / 1024).toFixed(1);
console.log(`app.html + app.js + style.css zgrajeni — zamenjanih ${hits} uvozov, ${kb} KB`);
