#!/usr/bin/env node
/**
 * Požene vse zbirke testov po vrsti.
 * Zagon:  npm test
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

function run(file, label) {
  console.log(`\n${'='.repeat(52)}\n  ${label}\n${'='.repeat(52)}`);
  const r = spawnSync('node', [path.join(here, file)], { stdio: 'inherit' });
  return r.status === 0;
}

if (!run('build-test-app.mjs', 'Priprava testne kopije')) {
  console.error('\nPriprava ni uspela.');
  process.exit(1);
}

const suites = [
  ['test-units.mjs',       'Enote (utils, lookups)'],
  ['test-podcasts.mjs',    'Knjige, podcasti in epizode'],
  ['test-home-theme.mjs',  'Domači zaslon in barvna shema'],
  ['test-auth-quotes.mjs', 'Prijava, citat dneva, katalog epizod'],
  ['test-features.mjs',    'Izvoz, razveljavi izbris, pregled citatov'],
];

const failed = [];
for (const [file, label] of suites) {
  if (!run(file, label)) failed.push(label);
}

console.log(`\n${'='.repeat(52)}`);
if (failed.length) {
  console.log('PADLO:');
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('Vse zbirke testov so uspešne.');
