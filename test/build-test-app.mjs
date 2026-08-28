#!/usr/bin/env node
/**
 * Naredi testno kopijo aplikacije: test/app.html
 *
 * Vzame pravi ../index.html in zamenja uvoze Firebase z lokalnimi
 * lažnimi moduli, da testi tečejo brez omrežja in brez prave baze.
 *
 * Zagon:  node test/build-test-app.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SRC = path.join(root, 'index.html');
const OUT = path.join(here, 'app.html');

if (!fs.existsSync(SRC)) {
  console.error('Ne najdem index.html v', root);
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');

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

const swaps = [
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js/g,       './mock-firebase-app.js'],
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-firestore\.js/g, './mock-firebase-firestore.js'],
  [/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js/g,      './mock-firebase-auth.js'],
  [/<script src="https:\/\/accounts\.google\.com\/gsi\/client"[^>]*><\/script>/g, GSI_STUB],
];

let hits = 0;
for (const [re, to] of swaps) {
  const n = (html.match(re) || []).length;
  hits += n;
  html = html.replace(re, to);
}

if (!hits) {
  console.error('Opozorilo: nobenega uvoza Firebase nisem našel. Se je pot spremenila?');
  process.exit(1);
}

fs.writeFileSync(OUT, html);

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

console.log(`app.html zgrajen — zamenjanih ${hits} uvozov, ${(html.length/1024).toFixed(1)} KB`);
