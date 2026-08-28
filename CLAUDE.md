# Marginalia — navodila za Claude Code

## O projektu
Osebna PWA aplikacija za sledenje prebranim knjigam in poslušanim podcastom/epizodam.
- Hosting: GitHub Pages (https://klemenb007.github.io/marginalia/)
- Backend: Firebase / Firestore (sinhronizacija med napravami)
- Auth: Google + email prijava, vsak uporabnik ima svojo zasebno zbirko
- Uporablja se na iPadu in iPhoneu (dodano na domači zaslon)

## Kako delam
- Nisem izkušen razvijalec (1. letnik računalništva, ozadje v zdravstvu) — razlage naj bodo jasne, brez preskakovanja korakov, a ne pretirano podrobne. En jasen korak je dovolj, ne razčlenjuj vsakega klika.
- Delam iterativno — raje manjše korake in preverjanje kot en velik poseg naenkrat.

## Testiranje in build
- Pri **manjših/kozmetičnih spremembah** (UI, stil, besedilo, razporeditev elementov): NE poganjaj testov/build-a avtomatsko po vsaki spremembi. Naredi popravek, na kratko povzemi kaj si spremenil, počakaj na potrditev ali dodatna navodila.
- Pri **strukturnih spremembah** (podatkovni model, Firestore sheme, sinhronizacija, auth logika): testiraj/preveri takoj — tu so napake dražje.
- Če popravljam več stvari zaporedoma v istem pogovoru, počakaj z izvajanjem testov, dokler ne rečem, da sem končal serijo — potem poženi enkrat na koncu.
- Če nisi prepričan, ali je sprememba "manjša" ali "strukturna", raje vprašaj kratko, kot da avtomatsko poženeš teste.

## Splošno
- Pred večjimi spremembami na shrambi podatkov (Firestore pravila, sheme) na kratko razloži tveganje, preden izvedeš.
- Ne ustvarjaj novih odvisnosti/paketov brez utemeljitve v enem stavku zakaj so potrebne.
