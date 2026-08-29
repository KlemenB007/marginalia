import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, collection, onSnapshot, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHBUdI1_nZ2Gus7ARpLg8kPytV6xDHYG8",
  authDomain: "knjigolog-8d099.firebaseapp.com",
  projectId: "knjigolog-8d099",
  storageBucket: "knjigolog-8d099.firebasestorage.app",
  messagingSenderId: "990992068049",
  appId: "1:990992068049:web:754ffc21b7dd7e7e19c4f0"
};

const app = initializeApp(firebaseConfig);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn('Predpomnilnik ni na voljo, uporabljam navadno povezavo.', e);
  db = getFirestore(app);
}
const booksCol = collection(db, "books");
const podsCol  = collection(db, "podcasts");
const auth = getAuth(app);
let user = null;
let unsubs = [];
function settingsRef(){ return doc(db, "settings", user ? user.uid : "app"); }

const BOOK_PALETTE = ['#E5A45B','#D98B6A','#C9A86B','#B8926E','#D4A08C','#A99270'];
const POD_PALETTE  = ['#9C8CFA','#7FA6E8','#7EC8C4','#B08CD9','#8E9BD4','#A0A8E0'];
const PALETTE = BOOK_PALETTE;
const ACC_BOOK = '#E5A45B', ACC_POD = '#9C8CFA';
const MONTHS = ['januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
const BOOK_STATUS = { read:'Prebrano', current:'Berem', wish:'Želim brati', dnf:'Opuščeno' };
const POD_STATUS  = { read:'Poslušano', current:'Poslušam', wish:'Želim poslušati', dnf:'Opuščeno' };
/* podcast state is derived from its episodes, never set by hand */
function podState(p){
  const eps=p.episodes||[];
  if(!eps.length) return { key:'wish', label:'Ni še epizod', cls:'status-wish' };
  const done=eps.filter(e=>(e.status||'read')==='read').length;
  const going=eps.some(e=>(e.status||'read')==='current');
  if(going) return { key:'current', label:'Poslušam', cls:'status-current' };
  if(done===eps.length) return { key:'read', label:'Vse poslušano', cls:'status-read' };
  return { key:'current', label:`${done} od ${eps.length} poslušanih`, cls:'status-current' };
}
function podRatingAvg(p){
  const r=(p.episodes||[]).map(e=>Number(e.rating)||0).filter(Boolean);
  return r.length ? Math.round(r.reduce((a,b)=>a+b,0)/r.length*10)/10 : 0;
}
const STATUS_CLASS = { read:'status-read', current:'status-current', wish:'status-wish', dnf:'status-dnf' };
const GENRE_SUGG = ['roman','biografija','zgodovina','kriminalka','fantazija','znanstvena fantastika','psihologija','poezija','popotniško','gore','esej','poslovno'];
const POD_GENRE_SUGG = ['pogovorni','zgodovina','znanost','politika','šport','kriminal','tehnologija','psihologija','poslovno','kultura','humor','dokumentarni'];
const SORTS = [
  { k:'new', label:'Najnovejše' }, { k:'old', label:'Najstarejše' },
  { k:'rating', label:'Najbolje ocenjeno' }, { k:'az', label:'A–Ž po naslovu' },
  { k:'author', label:'Po avtorju' }
];
const QUOTES = [
"Vem, da nič ne vem.|Sokrat",
"Nepregledano življenje ni vredno življenja.|Sokrat",
"Začetek je najpomembnejši del vsakega dela.|Platon",
"Vsak človek je toliko vreden, kolikor je vredno to, za kar si prizadeva.|Mark Avrelij",
"Sreča tvojega življenja je odvisna od kakovosti tvojih misli.|Mark Avrelij",
"Ne razpravljaj več o tem, kakšen naj bi bil dober človek. Bodi to.|Mark Avrelij",
"Zjutraj si reci: danes bom srečal vsiljivega, nehvaležnega, prevzetnega. Vse to jih doleti iz nevednosti o dobrem in zlem.|Mark Avrelij",
"Kar je ovira na poti, postane pot.|Mark Avrelij",
"Nismo vznemirjeni zaradi stvari, ampak zaradi mnenj o njih.|Epiktet",
"Nekatere stvari so v naši moči, druge ne.|Epiktet",
"Nihče ni svoboden, kdor ni gospodar samega sebe.|Epiktet",
"Ni pomembno, kaj se ti zgodi, ampak kako se na to odzoveš.|Epiktet",
"Ni malo časa, ki ga imamo, ampak veliko ga zapravimo.|Seneka",
"Vsak dan začni z mislijo, da si dolžan živeti dobro.|Seneka",
"Kdor je povsod, ni nikjer.|Seneka",
"Trpimo bolj v domišljiji kot v resnici.|Seneka",
"Dokler se učiš živeti, si se moraš učiti vse življenje.|Seneka",
"Nobenega vetra ni ugodnega tistemu, ki ne ve, kam pluje.|Seneka",
"Vse teče.|Heraklit",
"Nihče ne stopi dvakrat v isto reko.|Heraklit",
"Značaj je človekova usoda.|Heraklit",
"Smo to, kar vedno znova počnemo. Odličnost torej ni dejanje, ampak navada.|Aristotel",
"Znamenje izobraženega duha je, da lahko misel premisli, ne da bi jo sprejel.|Aristotel",
"Korenine izobrazbe so grenke, sadovi pa sladki.|Aristotel",
"Vsi ljudje po naravi hrepenijo po vedenju.|Aristotel",
"Prijatelj je ena duša v dveh telesih.|Aristotel",
"Pot tisočih milj se začne z enim korakom.|Lao Ce",
"Kdor pozna druge, je moder; kdor pozna sebe, je razsvetljen.|Lao Ce",
"Kdor je zadovoljen s tem, kar ima, je bogat.|Lao Ce",
"Narava se nikoli ne mudi, pa vendar je vse opravljeno.|Lao Ce",
"Ni pomembno, kako počasi greš, dokler se ne ustaviš.|Konfucij",
"Kdor se uči brez razmišljanja, je izgubljen; kdor razmišlja brez učenja, je v nevarnosti.|Konfucij",
"Rečeš mi in pozabim, pokažeš mi in si zapomnim, vključiš me in razumem.|Konfucij",
"Življenje je zares preprosto, a mi vztrajamo, da bi ga zapletli.|Konfucij",
"Kdor premakne goro, začne z odnašanjem majhnih kamnov.|Konfucij",
"Soba brez knjig je kot telo brez duše.|Ciceron",
"Če imaš vrt in knjižnico, imaš vse, kar potrebuješ.|Ciceron",
"Ne vedeti, kaj se je zgodilo pred tvojim rojstvom, pomeni ostati vedno otrok.|Ciceron",
"Nobena naloga ni tako težka, kot je videti, če jo razdeliš na majhne dele.|Ciceron",
"Kapljica izdolbe kamen, ne s silo, ampak z vztrajnostjo.|Ovid",
"Zaupaj tistemu, ki je izkusil.|Vergil",
"Vsakemu je usoda dala svoj dan.|Vergil",
"Zgrabi dan, čim manj zaupaj jutrišnjemu.|Horacij",
"Kdor je začel, je opravil polovico. Upaj si biti moder.|Horacij",
"Zdravega duha v zdravem telesu.|Juvenal",
"Človek sem, nič človeškega mi ni tuje.|Terencij",
"Med velikimi in majhnimi dušami je razlika v tem, kar imajo za nemogoče.|Plutarh",
"Duh ni posoda, ki jo je treba napolniti, ampak drva, ki jih je treba prižgati.|Plutarh",
"Prišel sem, videl sem, zmagal sem.|Julij Cezar",
"Ljudje verjamejo predvsem tisto, kar si želijo.|Julij Cezar",

"Berem, da bi vedel, da nisem sam.|William Shakespeare",
"Nič ni ne dobro ne slabo, mišljenje to naredi.|William Shakespeare",
"Vemo, kaj smo, ne pa, kaj lahko postanemo.|William Shakespeare",
"Bodi zvest sebi.|William Shakespeare",
"Prihodnost je tam, kjer bomo preživeli preostanek življenja.|William Shakespeare",
"Beseda brez misli nikoli ne gre v nebo.|William Shakespeare",
"Kdor uči, se sam uči dvakrat.|Michel de Montaigne",
"Življenje samo ni ne dobro ne zlo; je prostor za dobro in zlo.|Michel de Montaigne",
"Najveličastnejša stvar na svetu je znati pripadati sebi.|Michel de Montaigne",
"Kdor se boji trpljenja, že trpi zaradi tega, česar se boji.|Michel de Montaigne",
"Mislim, torej sem.|René Descartes",
"Branje dobrih knjig je pogovor z najboljšimi ljudmi preteklih stoletij.|René Descartes",
"Srce ima svoje razloge, ki jih razum ne pozna.|Blaise Pascal",
"To pismo sem napisal daljše, ker nisem imel časa napisati krajšega.|Blaise Pascal",
"Vsa človeška nesreča izvira iz nezmožnosti, da bi človek mirno sedel v sobi.|Blaise Pascal",
"Presojaj človeka bolj po njegovih vprašanjih kot po odgovorih.|Voltaire",
"Odlično je sovražnik dobrega.|Voltaire",
"Zdravnikova naloga je zabavati bolnika, medtem ko narava zdravi bolezen.|Voltaire",
"Človek se rodi svoboden, povsod pa je v verigah.|Jean-Jacques Rousseau",
"Potrpljenje je grenko, a njegov sad je sladek.|Jean-Jacques Rousseau",
"Imej pogum uporabiti svoj razum.|Immanuel Kant",
"Znanost je urejeno znanje, modrost je urejeno življenje.|Immanuel Kant",
"Iz krivega lesa človeštva ni mogoče stesati nič povsem ravnega.|Immanuel Kant",
"Karkoli lahko storiš ali sanjaš, da lahko storiš, začni. Drznost ima v sebi genij, moč in čarovnijo.|Johann Wolfgang von Goethe",
"Ravnaj s človekom, kakršen bi lahko bil, in postal bo, kar bi lahko bil.|Johann Wolfgang von Goethe",
"Nič ni bolj strašnega kot dejavna nevednost.|Johann Wolfgang von Goethe",
"Zadostuje ne vedeti, moramo uporabiti; hoteti ne zadostuje, moramo storiti.|Johann Wolfgang von Goethe",
"Kdor ne pozna tujih jezikov, ne ve ničesar o svojem.|Johann Wolfgang von Goethe",
"Vsak dan bi moral človek slišati košček glasbe, prebrati dobro pesem in videti lepo sliko.|Johann Wolfgang von Goethe",
"Kdor hoče doseči nemogoče, mora poskusiti absurdno.|Miguel de Cervantes",
"Kdor bere veliko in hodi veliko, vidi veliko in ve veliko.|Miguel de Cervantes",
"Pripravi se na najhujše in upaj na najboljše.|Miguel de Cervantes",

"Naredi, kar zmoreš, s tem, kar imaš, tam, kjer si.|Theodore Roosevelt",
"Verjemi, da zmoreš, in si na pol poti.|Theodore Roosevelt",
"Primerjava je tat veselja.|Theodore Roosevelt",
"Zaupaj vase. Veš več, kot misliš, da veš.|Ralph Waldo Emerson",
"Kar leži za nami in kar leži pred nami, je malenkost v primerjavi s tem, kar leži v nas.|Ralph Waldo Emerson",
"Ne hodi tja, kamor pelje pot. Pojdi raje tja, kjer poti ni, in pusti sled.|Ralph Waldo Emerson",
"Vsak človek, ki ga srečam, mi je v nečem nadrejen; v tem se od njega učim.|Ralph Waldo Emerson",
"Navdušenje je mati vsakega napredka. Brez njega ni bilo nikoli doseženo nič velikega.|Ralph Waldo Emerson",
"Naredi stvar in imel boš moč.|Ralph Waldo Emerson",
"Pojdi samozavestno v smeri svojih sanj. Živi življenje, ki si ga zamislil.|Henry David Thoreau",
"Nezadostno ni, da si zaposlen; tudi mravlje so. Vprašanje je, s čim si zaposlen.|Henry David Thoreau",
"Bogastvo človeka se meri s številom stvari, ki jih zmore pustiti pri miru.|Henry David Thoreau",
"Zgradil sem gradove v zraku. Zdaj pod njih postavi temelje.|Henry David Thoreau",
"Vsaka knjiga je čarovnija, ki premaguje čas.|Carl Sagan",
"Nič na svetu ne more nadomestiti vztrajnosti.|Calvin Coolidge",
"Najboljši način napovedati prihodnost je, da jo ustvariš.|Abraham Lincoln",
"Skoraj vsak človek prenese nesrečo. Če hočeš preizkusiti njegov značaj, mu daj moč.|Abraham Lincoln",
"Rajši molčim in veljam za bedaka, kot da spregovorim in vsak dvom odpravim.|Abraham Lincoln",
"Če bi imel šest ur, da posekam drevo, bi prve štiri porabil za brušenje sekire.|Abraham Lincoln",
"Kdor bere, živi tisoč življenj; kdor ne, živi eno samo.|George R. R. Martin",
"Vsaka omejitev, ki jo priznamo, je zid, ki smo ga sami postavili.|Frederick Douglass",
"Lažje je zgraditi močne otroke kot popravljati zlomljene odrasle.|Frederick Douglass",
"Brez boja ni napredka.|Frederick Douglass",
"Ko preberem dobro knjigo, si želim, da bi življenje trajalo tri tisoč let.|Ralph Waldo Emerson",

"Klasika je knjiga, ki nikoli ni dokončala tega, kar ima povedati.|Italo Calvino",
"Človek, ki ne bere, nima nobene prednosti pred tistim, ki ne zna brati.|Mark Twain",
"Skrb je plačevanje dolga, ki ga morda nikoli ne boš imel.|Mark Twain",
"Dobrota je jezik, ki ga gluhi slišijo in slepi vidijo.|Mark Twain",
"Čez dvajset let te bodo bolj razočarale stvari, ki jih nisi storil, kot tiste, ki si jih.|Mark Twain",
"Skrivnost napredovanja je začeti.|Mark Twain",
"Vedno delaj prav. To bo nekatere razveselilo, ostale pa presenetilo.|Mark Twain",
"Bodi to, kar si, in povej, kar čutiš, kajti tisti, ki jim je mar, ne štejejo, in tisti, ki štejejo, jim ni mar.|Bernard M. Baruch",
"Bodi to, kar si. Vse ostalo je že zasedeno.|Oscar Wilde",
"Vsi smo v blatu, a nekateri gledajo v zvezde.|Oscar Wilde",
"Izkušnja je ime, ki ga dajemo svojim napakam.|Oscar Wilde",
"Če hočeš ljudem povedati resnico, jih nasmej, sicer te bodo ubili.|Oscar Wilde",
"Ljubezen do sebe je začetek vseživljenjske romance.|Oscar Wilde",
"Živeti je najredkejša stvar na svetu. Večina ljudi obstaja, to je vse.|Oscar Wilde",
"Vsak od nas ima svojo pot, po kateri mora hoditi sam.|Lev Tolstoj",
"Vsi razmišljajo o tem, kako spremeniti svet, nihče pa o tem, kako spremeniti sebe.|Lev Tolstoj",
"Najmočnejša bojevnika sta potrpljenje in čas.|Lev Tolstoj",
"Če hočeš biti srečen, bodi.|Lev Tolstoj",
"Prava življenjska naloga ni v tem, da hodiš pred drugimi, ampak da hodiš pred svojim včerajšnjim jazom.|Lev Tolstoj",
"Lepota bo rešila svet.|Fjodor Dostojevski",
"Skrivnost človekovega obstoja ni le v tem, da ostane živ, ampak da najde, za kaj živeti.|Fjodor Dostojevski",
"Nič ni lažje kot obsojati zlobneža; nič težjega kot ga razumeti.|Fjodor Dostojevski",
"Ljubi življenje bolj kot smisel življenja.|Fjodor Dostojevski",
"Ne opisuj mi, da je luna posijala; pokaži mi lesk svetlobe na razbitem steklu.|Anton Čehov",
"Znanje nima vrednosti, dokler ga ne uporabiš v praksi.|Anton Čehov",
"Človek je to, v kar verjame.|Anton Čehov",
"Kdor hoče videti mavrico, mora prenesti dež.|Anton Čehov",
"Kdor ima zakaj živeti, prenese skoraj vsak kako.|Friedrich Nietzsche",
"Kar nas ne ubije, nas okrepi.|Friedrich Nietzsche",
"Nihče ne more zate zgraditi mostu, po katerem moraš prečkati reko življenja.|Friedrich Nietzsche",
"Vedno je nekaj norosti v ljubezni. A vedno je tudi nekaj razuma v norosti.|Friedrich Nietzsche",
"Kdor se bori s pošastmi, naj pazi, da sam ne postane pošast.|Friedrich Nietzsche",
"Naloga ni videti, česar še nihče ni videl, ampak misliti, česar še nihče ni mislil o tem, kar vsi vidijo.|Arthur Schopenhauer",
"Zdravje ni vse, a brez zdravja je vse nič.|Arthur Schopenhauer",
"Vsakdo ima meje svojega vidnega polja za meje sveta.|Arthur Schopenhauer",
"Življenje se lahko razume le nazaj, živeti pa ga je treba naprej.|Søren Kierkegaard",
"Tvegati pomeni za trenutek izgubiti tla pod nogami. Ne tvegati pomeni izgubiti sebe.|Søren Kierkegaard",
"Ne obupaj nad tem, da si ne moreš zapomniti vsega, kar bereš.|Samuel Johnson",
"Kar se pridobi brez truda, se ceni brez veselja.|Samuel Johnson",
"Velika dela ne opravi moč, ampak vztrajnost.|Samuel Johnson",

"Ni sreče v posedovanju ali prejemanju, ampak samo v dajanju.|Henry Drummond",
"Ne štej dni, naredi, da dnevi štejejo.|Muhammad Ali",
"Vsak otrok je umetnik. Težava je, kako ostati umetnik, ko odrasteš.|Pablo Picasso",
"Navdih obstaja, a te mora najti pri delu.|Pablo Picasso",
"Dejanje je temeljni ključ vsakega uspeha.|Pablo Picasso",
"Ne skrbi za svoje težave z matematiko. Zagotavljam ti, da so moje še večje.|Albert Einstein",
"Domišljija je pomembnejša od znanja.|Albert Einstein",
"Če ne znaš razložiti preprosto, nisi dovolj dobro razumel.|Albert Einstein",
"Vsakdo je genij. A če boš ribo sodil po tem, kako pleza na drevo, bo vse življenje mislila, da je nesposobna.|Albert Einstein",
"V življenju se ni treba ničesar bati, treba je le razumeti.|Marie Curie",
"Nič v življenju se ni bati, le razumeti je treba. Zdaj je čas, da razumemo več, da bi se manj bali.|Marie Curie",
"Bodi manj radoveden do ljudi in bolj radoveden do idej.|Marie Curie",
"Kdor bere, ta potuje, ne da bi se premaknil.|Marcel Proust",
"Pravo odkritje ni v iskanju novih pokrajin, ampak v gledanju z novimi očmi.|Marcel Proust",
"Naj bomo hvaležni ljudem, ki nas osrečujejo; so čudoviti vrtnarji, ki dajo, da naše duše zacvetijo.|Marcel Proust",
"Bodi potrpežljiv do vsega, kar je v tvojem srcu nerešeno. Poskusi ljubiti sama vprašanja.|Rainer Maria Rilke",
"Edino potovanje je tisto navznoter.|Rainer Maria Rilke",
"Morda so vsi zmaji našega življenja princese, ki čakajo, da nas vidijo lepe in pogumne.|Rainer Maria Rilke",
"Knjiga mora biti sekira za zamrznjeno morje v nas.|Franz Kafka",
"Vsakdo, ki ohrani sposobnost videti lepoto, se nikoli ne postara.|Franz Kafka",
"Za branje potrebuješ tri stvari: knjigo, mir in nekoga, s komer boš o njej govoril.|Virginia Woolf",
"Knjige so zrcala; v njih vidiš le tisto, kar že nosiš v sebi.|Virginia Woolf",
"Nobene sreče ni večje od tega, da lahko sam odločaš, kako preživiš svoj dan.|Virginia Woolf",
"Kdor ni dobro jedel, ne more dobro misliti, dobro ljubiti in dobro spati.|Virginia Woolf",
"Svet se lomi na vseh nas, potem pa smo mnogi močni prav na zlomljenih mestih.|Ernest Hemingway",
"Ni nič plemenitega v tem, da si boljši od drugega. Prava plemenitost je biti boljši od svojega prejšnjega jaza.|Ernest Hemingway",
"Vsak človek ima svojo vrednost prav v tem, kar ga dela drugačnega.|André Gide",
"Ne moreš odkriti novih oceanov, dokler nimaš poguma izgubiti obalo izpred oči.|André Gide",
"Vse, kar potrebujem, je knjiga in kotiček, kjer me nihče ne moti.|Jane Austen",
"Ni večjega užitka kot branje.|Jane Austen",
"Nihče ni tako moder, da bi vedel vse.|Charles Dickens",
"Ni odveč nič, kar naredimo za drugega.|Charles Dickens",
"Vzemi si čas za vse, kar je vredno; hitrost je le videz napredka.|Charles Dickens",
"Kdor gleda navzven, sanja; kdor gleda navznoter, se prebudi.|Carl Gustav Jung",
"Nisem to, kar se mi je zgodilo. Sem to, kar izberem, da bom postal.|Carl Gustav Jung",
"Vse, kar nas moti pri drugih, nas lahko pripelje do razumevanja sebe.|Carl Gustav Jung",
"Bistvo je očem nevidno.|Antoine de Saint-Exupéry",
"Če hočeš zgraditi ladjo, ne zbiraj ljudi, da bi sekali les, ampak jih nauči hrepeneti po neskončnem morju.|Antoine de Saint-Exupéry",
"Cilj brez načrta je samo želja.|Antoine de Saint-Exupéry",
"Popolnost ni dosežena takrat, ko ni več česa dodati, ampak ko ni več česa odvzeti.|Antoine de Saint-Exupéry",

"Ne prosi za lažje življenje, prosi za več moči.|Bruce Lee",
"Znanje ni dovolj, uporabiti ga moramo. Volja ni dovolj, delati moramo.|Bruce Lee",
"Izobrazba ni priprava na življenje; izobrazba je življenje samo.|John Dewey",
"Izobrazba je najmočnejše orožje, s katerim lahko spremeniš svet.|Nelson Mandela",
"Zdi se vedno nemogoče, dokler ni storjeno.|Nelson Mandela",
"Bodi sprememba, ki jo želiš videti v svetu.|Mahatma Gandhi",
"Živi, kot da boš umrl jutri. Uči se, kot da boš živel večno.|Mahatma Gandhi",
"Sila ne izvira iz telesne zmožnosti, ampak iz neomajne volje.|Mahatma Gandhi",
"Nihče te ne more prizadeti brez tvojega privoljenja.|Eleanor Roosevelt",
"Prihodnost pripada tistim, ki verjamejo v lepoto svojih sanj.|Eleanor Roosevelt",
"Vsak dan naredi eno stvar, ki te je strah.|Eleanor Roosevelt",
"Veliki umi razpravljajo o idejah, povprečni o dogodkih, majhni o ljudeh.|Eleanor Roosevelt",
"Uspeh ni dokončen, neuspeh ni usoden; šteje pogum za nadaljevanje.|Winston Churchill",
"Optimist vidi priložnost v vsaki težavi.|Winston Churchill",
"Nikoli ne zapravi dobre krize.|Winston Churchill",
"Kdor ne bere, nima nobene prednosti pred tistim, ki ne zna brati.|Konfucij",
"Ni vsak dan dober, a v vsakem dnevu je nekaj dobrega.|Alice Morse Earle",
"Včeraj je zgodovina, jutri skrivnost, danes je darilo.|Alice Morse Earle",

"Le kdor se ne boji zablod, najde novo pot.|Ivan Cankar",
"Domovina je ena, nam vsem dodeljena.|Ivan Cankar",
"Beseda je bila dana človeku, da bi z njo povedal resnico.|Ivan Cankar",
"Kdor ljubi svoj narod, ga ne slavi, ampak mu služi.|Ivan Cankar",
"Manj slovenskih besed, več slovenskih dejanj.|Ivan Cankar",
"Ne stoj, kjer si; pojdi naprej, tudi če je pot temna.|Ivan Cankar",
"Žive naj vsi narodi, ki hrepene dočakat dan, da koder sonce hodi, prepir iz sveta bo pregnan.|France Prešeren",
"Kar je bilo, ne pride več nazaj.|France Prešeren",
"Le čevlje sodi naj Kopitar.|France Prešeren",
"Vse je zaman, kar človek stori brez ljubezni.|Josip Jurčič",
"Kdor hoče drugim svetiti, mora sam goreti.|Simon Gregorčič",
"Le vkup, le vkup, uboga gmajna.|Anton Aškerc",
"Kdor ne spoštuje svojega jezika, ne spoštuje samega sebe.|Primož Trubar",
"Stati inu obstati.|Primož Trubar",
"Berite, berite, ta bukve so vaše.|Primož Trubar",
"Ljubezen do domovine se pokaže v delu, ne v besedah.|Janez Trdina",
"Naj bo delo tvoja molitev.|Fran Levstik",
"Kdor išče lepoto, jo bo našel povsod.|Janez Mencinger",
"Vsak človek nosi v sebi svoj svet.|Zofka Kveder",
"Kdor se ne uči, ta zaostaja.|Fran Erjavec",

"Sreča je, kadar to, kar misliš, kar rečeš in kar storiš, sovpada.|Mahatma Gandhi",
"Modrost se začne v čudenju.|Sokrat",
"Skrivnost spremembe je, da vso energijo osredotočiš na gradnjo novega, ne na boj s starim.|Sokrat",
"Ne moreš poučiti človeka ničesar; lahko mu le pomagaš, da to odkrije v sebi.|Galileo Galilei",
"In vendar se vrti.|Galileo Galilei",
"Če sem videl dlje, je to zato, ker sem stal na ramenih velikanov.|Isaac Newton",
"Kar vemo, je kapljica; česar ne vemo, je ocean.|Isaac Newton",
"Sreča daje prednost pripravljenemu duhu.|Louis Pasteur",
"Ni preživela najmočnejša vrsta, ampak tista, ki se je najbolje prilagajala spremembam.|Charles Darwin",
"Nevednost pogosteje rodi samozavest kot znanje.|Charles Darwin",
"Enostavnost je najvišja stopnja dovršenosti.|Leonardo da Vinci",
"Učenje nikoli ne izčrpa duha.|Leonardo da Vinci",
"Že dolgo sem opazil, da ljudje, ki nekaj dosežejo, redko sedijo in čakajo, da se jim zgodi.|Leonardo da Vinci",
"Ovira ne more upogniti moje volje. Kdor je trdno odločen, ne omahne.|Leonardo da Vinci",
"Kdor ima veliko potrpljenja, lahko doseže karkoli.|Benjamin Franklin",
"Povej mi in pozabim, uči me in si zapomnim, vključi me in se naučim.|Benjamin Franklin",
"Vlaganje v znanje prinaša najboljše obresti.|Benjamin Franklin",
"Ne odlašaj do jutri s tem, kar lahko storiš danes.|Benjamin Franklin",
"Izgubljenega časa ni več mogoče najti.|Benjamin Franklin",
"Nič ni tako močno kot ideja, ki ji je prišel čas.|Victor Hugo",
"Kdor odpre šolo, zapre zapor.|Victor Hugo",
"Največja sreča v življenju je prepričanje, da smo ljubljeni.|Victor Hugo",
"Glasba izraža tisto, česar ni mogoče povedati in o čemer ni mogoče molčati.|Victor Hugo",
"Pogum je vedeti, česa se ne bati.|Platon",
"Vsak človek se lahko nauči karkoli, če se tega loti na pravi način.|Platon",
"Dobro življenje ni vprašanje dolžine, ampak globine.|Seneka",
"Sreča ni nekaj gotovega; je nekaj, kar narediš.|Aristotel",
"Ni znanja, ki bi bilo odveč.|Leonardo da Vinci",
"Kdor želi doseči veliko, mora najprej obvladati malo.|Konfucij",
"Ne boj se počasnega napredka, boj se le nepremičnosti.|Konfucij",
"Tam, kjer se konča beseda, se začne glasba.|Heinrich Heine",
"Kjer sežigajo knjige, na koncu sežigajo tudi ljudi.|Heinrich Heine",
"Prava umetnost je skriti umetnost.|Ovid",
"Sreča spremlja pogumne.|Vergil",
"Zmagajo tisti, ki verjamejo, da zmorejo.|Vergil",
"Ni bogastva nad zdravjem, ne veselja nad srčnim veseljem.|Sirah",
"Vsaka pot se začne z odločitvijo, da ne ostaneš tam, kjer si.|Lao Ce",
"Trdo delo premaga talent, kadar talent ne dela trdo.|Tim Notke",
"Kdor ne stori napake, ne stori ničesar.|Giacomo Puccini",
"Delo, ki ga opraviš z ljubeznijo, ni nikoli izgubljeno.|Lev Tolstoj",
"Vsak konec je začetek nečesa novega.|Seneka",
"Ne obžaluj tega, kar se je končalo; bodi hvaležen, da se je zgodilo.|Mark Twain",
"Če hočeš iti hitro, pojdi sam. Če hočeš iti daleč, pojdi z drugimi.|afriški pregovor",
"Najboljši čas za sajenje drevesa je bil pred dvajsetimi leti. Drugi najboljši čas je zdaj.|kitajski pregovor",
"Pade sedemkrat, vstani osemkrat.|japonski pregovor",
"Počasi se daleč pride.|slovenski pregovor",
"Kdor ne vpraša, ostane neumen.|slovenski pregovor",
"Vsak začetek je težak.|slovenski pregovor",
"Zrno do zrna pogača, kamen do kamna palača.|slovenski pregovor",
"Kdor visoko leta, nizko pade; kdor pa vztraja, pride do cilja.|slovenski pregovor",
"Brez muje se še čevelj ne obuje.|slovenski pregovor",
"Kar se Janezek nauči, to Janez zna.|slovenski pregovor"
];

const thisYear = new Date().getFullYear();

let books = [], pods = [];
let settings = { goal:null, goalYear:thisYear };
let view = 'home';
let openPodId = null;
let editingId = null, editingPodId = null, editingEpId = null, epParentId = null;
let currentSort = 'new', currentFilter = 'all', currentGenre = null;
let podFilter = 'all';
let statsPeriod = 'all';   // 'all' or a year (number) — filters the stats charts
let statCharts = [];
let expanded = new Set(), podExpanded = new Set(), epExpanded = new Set();

const $ = id => document.getElementById(id);
const statusLine = $('statusLine');

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setStatus(msg,isErr){
  if(!msg){ statusLine.classList.add('hide'); statusLine.innerHTML=''; return; }
  statusLine.classList.remove('hide');
  statusLine.classList.toggle('err',!!isErr);
  statusLine.innerHTML = isErr ? esc(msg) : `<span class="pulse"></span>${esc(msg)}`;
}
function toLines(v){
  if(Array.isArray(v)) return v.map(x=>String(x).trim()).filter(Boolean);
  return String(v||'').split('\n').map(x=>x.trim()).filter(Boolean);
}
function fmtRating(r){ return Number.isInteger(r)?String(r):r.toFixed(1).replace('.',','); }
/* slovenska sklanjatev: forms = [1, 2, 3–4, 5+] */
function slPlural(n, forms){ const m=n%100; return forms[m===1?0:m===2?1:(m===3||m===4)?2:3]; }
function normGenre(g){ return String(g||'').trim().toLowerCase().replace(/\s+/g,' '); }
function httpsify(u){ return String(u||'').replace(/^http:/,'https:'); }
function uid(){ return 'e_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function starHtml(rating){
  const r = Number(rating)||0;
  if(!r) return '';
  return `<span class="stars-wrap"><span class="stars-bg">★★★★★</span>`+
         `<span class="stars-fg" style="width:${r/5*100}%">★★★★★</span></span>`+
         `<span class="rating-num">${fmtRating(r)}</span>`;
}
const ICON_Q = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 5C6 5 3.5 7.7 3.5 11.2c0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Zm10 0c-3.5 0-6 2.7-6 6.2 0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Z"/></svg>`;
const ICON_N = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>`;
const ICON_EP = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;

function quotesHtml(list){
  if(!list.length) return '';
  return `<div class="block"><span class="sec-label">Citati</span>${
    list.map(q=>`<div class="quote-item"><span class="qm qm-o">\u201E</span>${esc(q)}<span class="qm qm-c">\u201C</span></div>`).join('')}</div>`;
}
function notesHtml(list){
  if(!list.length) return '';
  return `<div class="block"><span class="sec-label">Opombe</span>${
    list.map((n,i)=>`<div class="note-item"><span class="note-num">${i+1}</span><span class="note-text">${esc(n)}</span></div>`).join('')}</div>`;
}
function marksHtml(q,n,ep){
  const m=[];
  if(ep) m.push(`<span class="badge-count">${ICON_EP}${ep}</span>`);
  if(q)  m.push(`<span class="badge-count">${ICON_Q}${q}</span>`);
  if(n)  m.push(`<span class="badge-count">${ICON_N}${n}</span>`);
  return m.join('');
}

/* ---------- reusable controls ---------- */
function makeRating(rangeId, fgId, valId){
  const r=$(rangeId);
  const sync=()=>{
    const v=Number(r.value)||0;
    $(fgId).style.width=(v/5*100)+'%';
    const e=$(valId);
    e.textContent = v ? fmtRating(v) : 'brez ocene';
    e.classList.toggle('none', !v);
  };
  r.addEventListener('input',sync);
  return { set(v){ r.value=Number(v)||0; sync(); }, get(){ return Number(r.value)||0; }, sync };
}
function makeColors(rowId, pal){
  const row=$(rowId);
  let val=pal[0];
  row.innerHTML=pal.map(c=>`<div class="dot" data-color="${c}" style="background:${c}"></div>`).join('');
  const sync=()=>row.querySelectorAll('.dot').forEach(d=>d.classList.toggle('sel', d.dataset.color===val));
  row.querySelectorAll('.dot').forEach(d=>{ d.onclick=()=>{ val=d.dataset.color; sync(); }; });
  return { set(v){ val=v||pal[0]; sync(); }, get(){ return val; }, random(){ val=pal[Math.floor(Math.random()*pal.length)]; sync(); } };
}
function makeSeg(segId, onChange){
  const seg=$(segId);
  let val='read';
  const sync=()=>{ seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.status===val)); if(onChange) onChange(val); };
  seg.querySelectorAll('button').forEach(b=>{ b.onclick=()=>{ val=b.dataset.status; sync(); }; });
  return { set(v){ val=v||'read'; sync(); }, get(){ return val; } };
}
function makeGenres(tagsId, inputId, suggId, suggList){
  let items=[];
  const tags=$(tagsId), input=$(inputId), sugg=$(suggId);
  sugg.innerHTML=suggList.map(g=>`<button class="g-sugg" data-g="${g}">+ ${g}</button>`).join('');
  const render=()=>{
    tags.innerHTML=items.map(g=>`<span class="g-tag">${esc(g)}<button data-g="${esc(g)}" aria-label="Odstrani">×</button></span>`).join('');
    tags.querySelectorAll('button').forEach(b=>{ b.onclick=()=>{ items=items.filter(x=>x!==b.dataset.g); render(); }; });
    sugg.querySelectorAll('.g-sugg').forEach(s=>{ s.style.display = items.includes(s.dataset.g)?'none':''; });
  };
  const add=g=>{ const v=normGenre(g); if(!v||items.includes(v)||items.length>=8) return; items.push(v); render(); };
  sugg.querySelectorAll('.g-sugg').forEach(b=>{ b.onclick=()=>add(b.dataset.g); });
  input.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); add(e.target.value); e.target.value=''; }});
  input.addEventListener('blur',e=>{ if(e.target.value.trim()){ add(e.target.value); e.target.value=''; }});
  return { set(v){ items=[...(v||[])]; input.value=''; render(); }, get(){ return [...items]; }, add };
}

/* ---- vrstični vnos citatov / opomb (brez ročnega dodajanja vrstic) ---- */
function makeList(wrapId, opts){
  opts = opts || {};
  const wrap = $(wrapId);
  wrap.classList.add('rep-list');
  if(opts.quotes) wrap.classList.add('quotes');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'rep-add';
  addBtn.id = wrapId + 'Add';
  addBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${opts.addLabel||'Dodaj'}</span>`;
  wrap.after(addBtn);

  function grow(ta){ ta.style.height='auto'; ta.style.height=Math.max(46, ta.scrollHeight)+'px'; }
  function ensureOne(){ if(!wrap.children.length) wrap.appendChild(item('')); }
  function item(val, animIn){
    const row = document.createElement('div');
    row.className = animIn ? 'rep-item anim-in' : 'rep-item';
    const ta = document.createElement('textarea');
    ta.rows = 1; ta.value = val || ''; ta.placeholder = opts.placeholder || '';
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'rep-del'; del.setAttribute('aria-label','Odstrani'); del.textContent = '×';
    row.append(ta, del);
    ta.addEventListener('input', ()=>grow(ta));
    ta.addEventListener('keydown', e=>{
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        const n = item('', true);
        row.after(n);
        const nt = n.querySelector('textarea'); nt.focus(); grow(nt);
      } else if(e.key === 'Backspace' && ta.value === '' && wrap.children.length > 1){
        e.preventDefault();
        const prev = row.previousElementSibling;
        row.remove();
        if(prev){ const pt = prev.querySelector('textarea'); pt.focus(); pt.setSelectionRange(pt.value.length, pt.value.length); }
        ensureOne();
      }
    });
    del.addEventListener('click', ()=>{ row.remove(); ensureOne(); });
    requestAnimationFrame(()=>grow(ta));
    return row;
  }
  addBtn.addEventListener('click', ()=>{
    const n = item('', true);
    wrap.appendChild(n);
    const nt = n.querySelector('textarea'); nt.focus();
  });
  return {
    set(arr){
      wrap.innerHTML = '';
      const list = (arr && arr.length) ? arr : [''];
      list.forEach(v=>wrap.appendChild(item(v)));
    },
    /* po odprtju okna: znova izračunaj višine (scrollHeight je 0, dokler je okno skrito) */
    reflow(){ [...wrap.querySelectorAll('textarea')].forEach(grow); },
    get(){ return [...wrap.querySelectorAll('textarea')].map(t=>t.value.trim()).filter(Boolean); },
    filled(){ return [...wrap.querySelectorAll('textarea')].some(t=>t.value.trim()); }
  };
}

function makeMore(toggleId, boxId){
  const t=$(toggleId), b=$(boxId), lbl=t.querySelector('span');
  const collapsedLabel=()=> lbl.dataset.summary ? 'Več podrobnosti · '+lbl.dataset.summary : 'Več podrobnosti';
  const set=(open, instant)=>{
    if(instant) b.classList.add('no-anim');
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.classList.toggle('open', open);
    lbl.textContent = open ? 'Manj podrobnosti' : collapsedLabel();
    if(open) t.classList.remove('hint');
    // dvojni reflow: stanje se uveljavi brez animacije, nato animacijo spet vklopimo
    if(instant){ void b.offsetWidth; b.classList.remove('no-anim'); void b.offsetWidth; }
  };
  t.onclick=()=>{ t.classList.remove('hint'); set(t.getAttribute('aria-expanded')!=='true'); };
  return {
    set, open:i=>set(true,i), collapse:i=>set(false,i),
    isOpen:()=>t.getAttribute('aria-expanded')==='true',
    /* kratek povzetek, kaj je skrito notri (npr. "3 citati, 2 opombi") */
    summary(txt){ lbl.dataset.summary = txt || ''; if(t.getAttribute('aria-expanded')!=='true') lbl.textContent = collapsedLabel(); },
    /* kratek namig, da se skriva več možnosti */
    nudge(){
      if(REDUCE_MOTION || t.getAttribute('aria-expanded')==='true') return;
      t.classList.remove('hint'); void t.offsetWidth; t.classList.add('hint');
      setTimeout(()=>t.classList.remove('hint'), 2200);
    }
  };
}

const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
function runCountUp(el){
  const raw = el.dataset.count || el.textContent.trim();
  const target = +raw, dur = 900, t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if(p < 1) requestAnimationFrame(step);
    else el.textContent = raw;
  };
  requestAnimationFrame(step);
}
/* števci se poženejo šele, ko prideš do njih z drsenjem */
let scrollAnimObs = null;
function resetScrollAnims(){
  if(scrollAnimObs) scrollAnimObs.disconnect();
  scrollAnimObs = ('IntersectionObserver' in window) ? new IntersectionObserver((ents)=>{
    ents.forEach(ent=>{
      if(!ent.isIntersecting) return;
      const el = ent.target;
      scrollAnimObs.unobserve(el);
      if(el.dataset.count) runCountUp(el);
      if(el.dataset.revealChart) buildChartsIn(el);
      el.classList.add('rv-in');
    });
  }, { threshold:0.25, rootMargin:'0px 0px -8% 0px' }) : null;
}
function observeScrollAnim(el){
  if(!scrollAnimObs){ if(el.dataset.count) runCountUp(el); if(el.dataset.revealChart) buildChartsIn(el); el.classList.add('rv-in'); return; }
  scrollAnimObs.observe(el);
}
function countUp(el){
  const raw = el.textContent.trim();
  if(!/^\d{2,}$/.test(raw)) return;   // le cela števila >= 10
  if(REDUCE_MOTION) return;
  el.dataset.count = raw;
  el.textContent = '0';
  observeScrollAnim(el);
}

const bookRating = makeRating('fRating','rateFg','rateVal');
const epRating   = makeRating('eRating','eRateFg','eRateVal');
const bookColor  = makeColors('colorRow', BOOK_PALETTE);
const podColor   = makeColors('pColorRow', POD_PALETTE);
const bookMore   = makeMore('bookMoreToggle','bookMore');
const podMore    = makeMore('podMoreToggle','podMore');
const epMore     = makeMore('epMoreToggle','epMore');
let sheetLoading = false;
const bookStatus = makeSeg('statusSeg', v=>{
  $('pageAtWrap').style.display = (v==='current'||v==='dnf')?'':'none';
  if(!sheetLoading && (v==='current'||v==='dnf')) bookMore.open();
});
const epStatus   = makeSeg('eStatusSeg');
const bookGenres = makeGenres('genreTags','genreInput','genreSugg',GENRE_SUGG);
const podGenres  = makeGenres('pGenreTags','pGenreInput','pGenreSugg',POD_GENRE_SUGG);
const bookQuotes = makeList('fQuotes',{ quotes:true, placeholder:'Citat…', addLabel:'Dodaj citat' });
const bookNotes  = makeList('fNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });
const epQuotes   = makeList('eQuotes',{ quotes:true, placeholder:'Citat…', addLabel:'Dodaj citat' });
const epNotes    = makeList('eNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });
const podNotes   = makeList('pNotes', { placeholder:'Misel…', addLabel:'Dodaj opombo' });

let bookCover = '';
let podCover  = '';
let podItunesId = null;

const monthSel=$('fMonth');
monthSel.innerHTML=`<option value="">Mesec —</option>`+MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
const yearSel=$('fYear');
let yo=`<option value="">Leto —</option>`;
for(let y=thisYear;y>=thisYear-40;y--) yo+=`<option value="${y}">${y}</option>`;
yearSel.innerHTML=yo;

/* ---------- lookups ---------- */
async function lookupBook(title,author){
  const tries=[];
  if(author) tries.push(`intitle:"${title}" inauthor:"${author}"`);
  tries.push(`intitle:"${title}"`);
  tries.push(title+(author?' '+author:''));
  for(const q of tries){
    try{
      const r=await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`);
      if(!r.ok) continue;
      const d=await r.json();
      const it=(d.items||[])[0];
      if(!it) continue;
      const v=it.volumeInfo||{};
      return {
        author:(v.authors||[])[0]||'',
        published:(String(v.publishedDate||'').match(/\d{4}/)||[])[0]||'',
        pages:v.pageCount||'',
        genres:(v.categories||[]).slice(0,3).map(normGenre),
        cover:httpsify(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'')
      };
    }catch(e){}
  }
  try{
    const p=new URLSearchParams({title,limit:'5'});
    if(author) p.set('author',author);
    const r=await fetch(`https://openlibrary.org/search.json?${p}`);
    const d=await r.json();
    const hit=(d.docs||[]).find(x=>x.cover_i)||(d.docs||[])[0];
    if(hit) return {
      author:(hit.author_name||[])[0]||'',
      published:hit.first_publish_year||'',
      pages:hit.number_of_pages_median||'',
      genres:[],
      cover:hit.cover_i?`https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg`:''
    };
  }catch(e){}
  return null;
}

let epCatalog = [];   // fetched episode list for the podcast being edited
let epCatalogFor = null;

async function fetchEpisodes(itunesId){
  if(!itunesId) return [];
  try{
    const r=await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(itunesId)}&media=podcast&entity=podcastEpisode&limit=200`);
    if(!r.ok) return [];
    const d=await r.json();
    return (d.results||[])
      .filter(x=>x.wrapperType==='podcastEpisode' || x.kind==='podcast-episode')
      .map(x=>({
        title: x.trackName||'',
        num: x.episodeNumber||null,
        minutes: x.trackTimeMillis ? Math.round(x.trackTimeMillis/60000) : null,
        date: x.releaseDate ? String(x.releaseDate).slice(0,10) : ''
      }))
      .filter(x=>x.title);
  }catch(e){ console.error(e); return []; }
}

async function lookupPodcast(name){
  try{
    const r=await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=podcast&limit=5`);
    if(!r.ok) return null;
    const d=await r.json();
    const it=(d.results||[])[0];
    if(!it) return null;
    return {
      host: it.artistName||'',
      cover: httpsify(it.artworkUrl600||it.artworkUrl100||''),
      itunesId: it.collectionId||null,
      genres: (it.genres||[]).filter(g=>g && g.toLowerCase()!=='podcasts').slice(0,3).map(normGenre)
    };
  }catch(e){ return null; }
}

$('lookupBtn').onclick=async()=>{
  const title=$('fTitle').value.trim(), author=$('fAuthor').value.trim();
  if(!title){ $('lookupTxt').textContent='Najprej vpiši naslov.'; $('fTitle').focus(); return; }
  const btn=$('lookupBtn'); btn.disabled=true; $('lookupTxt').textContent='Iščem…';
  const res=await lookupBook(title,author);
  btn.disabled=false;
  if(!res){ $('lookupTxt').textContent='Nič najdenega. Vpiši ročno.'; return; }
  const filled=[];
  if(res.cover){ bookCover=res.cover; renderPrev('lookupPrev',bookCover); filled.push('naslovnica'); }
  if(res.author && !$('fAuthor').value.trim()){ $('fAuthor').value=res.author; filled.push('avtor'); }
  if(res.pages && !$('fPages').value.trim()){ $('fPages').value=res.pages; filled.push('strani'); }
  if(res.published && !$('fPublished').value.trim()){ $('fPublished').value=res.published; filled.push('leto izida'); }
  if(res.genres?.length){ const b=bookGenres.get().length; res.genres.forEach(bookGenres.add); if(bookGenres.get().length>b) filled.push('žanri'); }
  $('lookupTxt').textContent = filled.length ? 'Izpolnjeno: '+filled.join(', ')+'.' : 'Najdeno, a vsa polja so že izpolnjena.';
};

$('pLookupBtn').onclick=async()=>{
  const name=$('pTitle').value.trim();
  if(!name){ $('pLookupTxt').textContent='Najprej vpiši ime.'; $('pTitle').focus(); return; }
  const btn=$('pLookupBtn'); btn.disabled=true; $('pLookupTxt').textContent='Iščem…';
  const res=await lookupPodcast(name);
  btn.disabled=false;
  if(!res){ $('pLookupTxt').textContent='Nič najdenega. Vpiši ročno.'; return; }
  const filled=[];
  if(res.itunesId){ podItunesId=res.itunesId; filled.push('katalog epizod'); }
  if(res.cover){ podCover=res.cover; renderPrev('pLookupPrev',podCover); filled.push('naslovnica'); }
  if(res.host && !$('pHost').value.trim()){ $('pHost').value=res.host; filled.push('voditelj'); }
  if(res.genres?.length){ const b=podGenres.get().length; res.genres.forEach(podGenres.add); if(podGenres.get().length>b) filled.push('žanri'); }
  $('pLookupTxt').textContent = filled.length ? 'Izpolnjeno: '+filled.join(', ')+'.' : 'Najdeno, a vsa polja so že izpolnjena.';
};

function renderPrev(id,url){
  const el=$(id);
  if(url) el.innerHTML=`<img src="${esc(url)}" alt="">`;
  else el.textContent='brez';
}

/* ---------- navigation ---------- */
function goTo(v){
  view=v;
  $('homeView').style.display      = v==='home' ? '' : 'none';
  $('booksView').style.display     = v==='books' ? '' : 'none';
  $('podsView').style.display      = v==='pods' ? '' : 'none';
  $('podDetailView').style.display = v==='podDetail' ? '' : 'none';
  $('statsView').style.display     = v==='stats' ? '' : 'none';
  $('navHome').classList.toggle('on', v==='home');
  $('navBooks').classList.toggle('on', v==='books');
  $('navPods').classList.toggle('on', v==='pods' || v==='podDetail');
  $('navStats').classList.toggle('on', v==='stats');
  $('addBtn').style.visibility = v==='stats' ? 'hidden' : '';
  const navAcc = (v==='books') ? 'var(--acc-book)' : (v==='pods'||v==='podDetail') ? 'var(--acc-pod)' : 'var(--cloud)';
  document.querySelector('.nav').style.setProperty('--acc', navAcc);
  render();
  const VIEW_EL = { home:'homeView', books:'booksView', pods:'podsView', podDetail:'podDetailView', stats:'statsView' };
  const av = $(VIEW_EL[v]);
  if(av){ av.classList.remove('view-in'); void av.offsetWidth; av.classList.add('view-in'); }
}
$('navHome').onclick =()=>{ openPodId=null; goTo('home'); };
$('navBooks').onclick=()=>{ openPodId=null; goTo('books'); };
$('navPods').onclick =()=>{ openPodId=null; goTo('pods'); };
$('navStats').onclick=()=>goTo('stats');
$('logoBtn').onclick=()=>{
  openPodId=null;
  goTo('home');
  $('search').value=''; $('podSearch').value='';
  currentFilter='all'; currentGenre=null; currentSort='new'; podFilter='all';
  $('filterRow').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.filter==='all'));
  $('podFilterRow').querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.filter==='all'));
  expanded.clear(); podExpanded.clear(); epExpanded.clear();
  render();
  window.scrollTo({top:0,behavior:'smooth'});
};

$('addBtn').onclick=()=>{
  if(view==='pods') openPodSheet(null);
  else if(view==='podDetail') openEpSheet(openPodId,null);
  else if(view==='home') openAddPicker();
  else openSheet(null);
};
function openAddPicker(){ $('addPickOverlay').classList.add('open'); }
function closeAddPicker(){ $('addPickOverlay').classList.remove('open'); }
$('addPickOverlay').onclick=e=>{ if(e.target.id==='addPickOverlay') closeAddPicker(); };
$('pickBook').onclick=()=>{ closeAddPicker(); goTo('books'); openSheet(null); };
$('pickPod').onclick =()=>{ closeAddPicker(); goTo('pods');  openPodSheet(null); };


/* ---------- book filters ---------- */
$('filterRow').querySelectorAll('.chip').forEach(c=>{
  c.onclick=()=>{ $('filterRow').querySelectorAll('.chip').forEach(x=>x.classList.remove('active')); c.classList.add('active'); currentFilter=c.dataset.filter; render(); };
});
$('podFilterRow').querySelectorAll('.chip').forEach(c=>{
  c.onclick=()=>{ $('podFilterRow').querySelectorAll('.chip').forEach(x=>x.classList.remove('active')); c.classList.add('active'); podFilter=c.dataset.filter; render(); };
});

function openSort(){
  $('sortOpts').innerHTML=SORTS.map(s=>`
    <button class="opt ${s.k===currentSort?'on':''}" data-sort="${s.k}">
      <span>${s.label}</span>
      <span class="opt-tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
    </button>`).join('');
  $('sortOpts').querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ currentSort=o.dataset.sort; $('sortOverlay').classList.remove('open'); render(); }; });
  $('sortOverlay').classList.add('open');
}
$('sortBtn').onclick=openSort;
$('sortOverlay').onclick=e=>{ if(e.target.id==='sortOverlay') $('sortOverlay').classList.remove('open'); };

function genreCounts(){
  const c={};
  books.forEach(b=>(b.genres||[]).forEach(g=>{ c[g]=(c[g]||0)+1; }));
  return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'sl'));
}
function openGenre(){
  const list=genreCounts();
  const tick=`<span class="opt-tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  $('genreOpts').innerHTML =
    `<button class="opt ${currentGenre?'':'on'}" data-genre=""><span>Vsi žanri</span>${tick}</button>`+
    (list.length ? list.map(([g,c])=>`<button class="opt ${currentGenre===g?'on':''}" data-genre="${esc(g)}"><span>${esc(g)}</span><span class="opt-count">${c}</span>${tick}</button>`).join('')
                 : `<p class="empty-sub" style="padding:14px 4px">Ni še nobenega žanra.</p>`);
  $('genreOpts').querySelectorAll('.opt').forEach(o=>{ o.onclick=()=>{ currentGenre=o.dataset.genre||null; $('genreOverlay').classList.remove('open'); render(); }; });
  $('genreOverlay').classList.add('open');
}
$('genreBtn').onclick=openGenre;
$('genreOverlay').onclick=e=>{ if(e.target.id==='genreOverlay') $('genreOverlay').classList.remove('open'); };

function sortItems(arr){
  const a=[...arr];
  switch(currentSort){
    case 'old': return a.sort((x,y)=>(x.createdAtMs||0)-(y.createdAtMs||0));
    case 'rating': return a.sort((x,y)=>(Number(y.rating)||0)-(Number(x.rating)||0)||(y.createdAtMs||0)-(x.createdAtMs||0));
    case 'az': return a.sort((x,y)=>(x.title||'').localeCompare(y.title||'','sl'));
    case 'author': return a.sort((x,y)=>((x.author||x.host||'')).localeCompare(y.author||y.host||'','sl'));
    default: return a.sort((x,y)=>(y.createdAtMs||0)-(x.createdAtMs||0));
  }
}

/* ---------- render dispatch ---------- */
function render(){
  if(view==='home') return renderHome();
  if(view==='stats') return renderStats();
  if(view==='pods') return renderPods();
  if(view==='podDetail') return renderPodDetail();
  renderBooks();
}


/* ---------- home ---------- */
function coverMini(item, kind){
  const initial=(item.title||'?').trim().charAt(0);
  const color=item.color||(kind==='pod'?POD_PALETTE[0]:BOOK_PALETTE[0]);
  const inner=item.coverUrl
    ? `<img src="${esc(item.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span>${esc(initial)}</span>'">`
    : `<span>${esc(initial)}</span>`;
  return `<span class="mini-cover ${kind==='pod'?'square':''}" style="background:${color}">${inner}</span>`;
}

/* deterministic pick — same quote all day, new one at midnight */
function dayIndex(){
  const d=new Date();
  const days=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
  return days;
}
function quoteOfDay(){
  const own=[];
  books.forEach(b=>toLines(b.quotes).forEach(t=>own.push({text:t,author:b.author||'',src:b.title})));
  pods.forEach(p=>(p.episodes||[]).forEach(e=>toLines(e.quotes).forEach(t=>own.push({text:t,author:p.host||'',src:p.title+' · '+e.title}))));
  const i=dayIndex();
  // every third day, if there are enough of your own, show one of yours
  if(own.length>=3 && i%3===0) return { ...own[i%own.length], mine:true };
  const q=QUOTES[i%QUOTES.length].split('|');
  return { text:q[0], author:q[1], src:'', mine:false };
}

function qCount(){
  let n=0;
  books.forEach(b=>{ n+=toLines(b.quotes).length; });
  pods.forEach(p=>(p.episodes||[]).forEach(e=>{ n+=toLines(e.quotes).length; }));
  return n;
}
function firstName(){
  const n=(user&&(user.displayName||''))||'';
  return n.split(' ')[0]||'';
}

function renderHome(){
  const v=$('homeView');
  const h=new Date().getHours();
  const nm=firstName();
  const greet = (h<5?'Lahko noč' : h<11?'Dobro jutro' : h<18?'Dober dan' : 'Dober večer') + (nm?', '+nm:'');

  const readingNow = books.filter(b=>(b.status||'read')==='current');
  const listenNow  = pods.filter(p=>podState(p).key==='current');
  const doneBooks  = books.filter(b=>(b.status||'read')==='read');
  const epCount    = pods.reduce((s,p)=>s+(p.episodes||[]).length,0);

  const goal=Number(settings.goal)||0;
  const doneThisYear=doneBooks.filter(b=>b.readYear===thisYear).length;
  const goalPct=goal?Math.min(100,doneThisYear/goal*100):0;

  const recent=[
    ...books.map(b=>({...b,_kind:'book'})),
    ...pods.map(p=>({...p,_kind:'pod'}))
  ].sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0)).slice(0,3);

  const miniRow=(item,kind,sub)=>`
    <button class="mini" data-kind="${kind}" data-id="${item.id}" style="--mini-acc:${kind==='pod'?ACC_POD:ACC_BOOK}">
      ${coverMini(item,kind)}
      <span class="mini-info">
        <span class="mini-kind">${kind==='pod'?'Podcast':'Knjiga'}</span>
        <p class="mini-title">${esc(item.title)}</p>
        <p class="mini-sub">${esc(sub||'')}</p>
      </span>
      <span class="hub-go" style="position:static"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
    </button>`;

  const inProgress=[
    ...readingNow.map(b=>{
      const pages=Number(b.pages)||0, at=Number(b.pageAt)||0;
      const sub = pages&&at ? `${Math.round(at/pages*100)}% · stran ${at} od ${pages}` : (b.author||'');
      return miniRow(b,'book',sub);
    }),
    ...listenNow.map(p=>miniRow(p,'pod',`${(p.episodes||[]).length} ${(p.episodes||[]).length===1?'epizoda':'epizod'}`))
  ];

  const qd=quoteOfDay();
  const nudge=(()=>{
    if(!books.length && !pods.length)
      return 'Začni s <b>prvo knjigo</b>. Aplikacija postane zanimiva, ko se citati začnejo nabirati.';
    if(!inProgress.length)
      return 'Nič ni v teku. <b>Kaj bi rad začel?</b> Na seznamu želja te čaka nekaj branja.';
    const noQuotes = doneBooks.length && !doneBooks.some(b=>toLines(b.quotes).length);
    if(noQuotes)
      return 'Prebral si nekaj knjig, a <b>brez zapisanih citatov</b>. Naslednjič si zapiši en stavek — čez leto boš vesel.';
    if(goal && doneThisYear<goal){
      const left=goal-doneThisYear;
      const monthsLeft=12-new Date().getMonth();
      return `Do cilja ti manjka <b>${left} ${left===1?'knjiga':left===2?'knjigi':left<=4?'knjige':'knjig'}</b>, do konca leta pa je še ${monthsLeft} ${monthsLeft===1?'mesec':monthsLeft===2?'meseca':monthsLeft<=4?'meseci':'mesecev'}.`;
    }
    const epTotal=pods.reduce((s,p)=>s+(p.episodes||[]).filter(e=>(e.status||'read')==='read').length,0);
    return `Zbral si <b>${qCount()} ${qCount()===1?'citat':qCount()===2?'citata':qCount()<=4?'citate':'citatov'}</b> iz ${doneBooks.length+epTotal} prebranih in poslušanih stvari. Lepa polica.`;
  })();

  v.innerHTML=`
    <h2 class="greet">${esc(greet)}</h2>
    <p class="greet-sub">${
      inProgress.length
        ? `Imaš ${inProgress.length} ${inProgress.length===1?'stvar':'stvari'} v teku.`
        : 'Kaj boš danes bral ali poslušal?'}</p>

    <div class="qday">
      <div class="qday-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 5C6 5 3.5 7.7 3.5 11.2c0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Zm10 0c-3.5 0-6 2.7-6 6.2 0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Z"/></svg>
        ${qd.mine?'Iz tvojih zapiskov':'Misel dneva'}
      </div>
      <p class="qday-text"><span class="qday-mark">\u201E</span>${esc(qd.text)}<span class="qday-mark">\u201C</span></p>
      ${qd.author?`<p class="qday-author">${esc(qd.author)}</p>`:''}
      ${qd.src?`<p class="qday-src">${esc(qd.src)}</p>`:''}
    </div>

    <div class="nudge">
      <span class="nudge-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg></span>
      <p>${nudge}</p>
    </div>

    <div class="hub">
      <button class="hub-card" id="hubBooks" style="--hub:${ACC_BOOK}">
        <span class="hub-go"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        <span class="hub-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></span>
        <p class="hub-name">Knjige</p>
        <p class="hub-count"><b>${books.length}</b> v zbirki · ${doneBooks.length} prebranih</p>
      </button>
      <button class="hub-card" id="hubPods" style="--hub:${ACC_POD}">
        <span class="hub-go"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        <span class="hub-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v4"/></svg></span>
        <p class="hub-name">Podcasti</p>
        <p class="hub-count"><b>${pods.length}</b> v zbirki · ${epCount} epizod</p>
      </button>
    </div>

    <div class="home-block">
      <div class="home-sec"><h3>V teku</h3></div>
      ${inProgress.length ? inProgress.join('')
        : `<p class="home-empty">Nič v teku. Odpri knjigo ali podcast in nastavi status na „Berem" oziroma „Poslušam".</p>`}
    </div>

    ${goal ? `
    <div class="home-block">
      <div class="home-sec"><h3>Letni cilj</h3><button class="more" id="homeGoal">statistika</button></div>
      <div class="goal-card" style="margin-bottom:0">
        <div class="goal-nums">${doneThisYear} <small>/ ${goal} knjig v ${thisYear}</small></div>
        <span class="goal-track"><span class="goal-fill" style="width:${goalPct.toFixed(0)}%"></span></span>
        <span class="goal-note">${doneThisYear>=goal?'Cilj dosežen. Bravo!':`Še ${goal-doneThisYear} do cilja.`}</span>
      </div>
    </div>` : ''}

    ${recent.length ? `
    <div class="home-block">
      <div class="home-sec"><h3>Nazadnje dodano</h3></div>
      ${recent.map(r=>miniRow(r, r._kind==='pod'?'pod':'book', r._kind==='pod'?(r.host||''):(r.author||''))).join('')}
    </div>` : ''}
  `;

  $('hubBooks').onclick=()=>goTo('books');
  $('hubPods').onclick =()=>goTo('pods');
  const hg=$('homeGoal'); if(hg) hg.onclick=()=>goTo('stats');
  v.querySelectorAll('.mini').forEach(el=>{
    el.onclick=()=>{
      const id=el.dataset.id;
      if(el.dataset.kind==='pod'){ openPodId=id; epExpanded.clear(); goTo('podDetail'); window.scrollTo({top:0}); }
      else { expanded.add(id); goTo('books'); setTimeout(()=>{
        const card=document.querySelector(`#list .entry[data-id="${id}"]`);
        if(card) card.scrollIntoView({block:'center'});
      },60); }
    };
  });
}

/* ---------- books ---------- */
function renderBooks(){
  const list=$('list');
  const q=$('search').value.trim().toLowerCase();
  const counts={all:books.length,read:0,current:0,wish:0,dnf:0};
  books.forEach(b=>{ const s=b.status||'read'; if(counts[s]!==undefined) counts[s]++; });
  ['all','read','current','wish','dnf'].forEach(k=>{ $('c-'+k).textContent=counts[k]||''; });

  $('sortLabel').textContent=(SORTS.find(s=>s.k===currentSort)||SORTS[0]).label;
  $('sortBtn').classList.toggle('on', currentSort!=='new');
  $('genreLabel').textContent=currentGenre||'Žanri';
  $('genreBtn').classList.toggle('on', !!currentGenre);

  let shown=books;
  if(currentFilter!=='all') shown=shown.filter(b=>(b.status||'read')===currentFilter);
  if(currentGenre) shown=shown.filter(b=>(b.genres||[]).includes(currentGenre));
  if(q) shown=shown.filter(b=>
    (b.title||'').toLowerCase().includes(q)||
    (b.author||'').toLowerCase().includes(q)||
    toLines(b.notes).join(' ').toLowerCase().includes(q)||
    toLines(b.quotes).join(' ').toLowerCase().includes(q)||
    (b.genres||[]).some(g=>g.includes(q)));
  shown=sortItems(shown);

  if(!shown.length){
    const f=q||currentFilter!=='all'||currentGenre;
    list.innerHTML=`<div class="empty"><div class="empty-icon">${books.length?'🔍':'📖'}</div>
      <p class="empty-title">${books.length?'Ni zadetkov':'Polica je prazna'}</p>
      <p class="empty-sub">${f?'Poskusi z drugim iskanjem ali filtrom.':'Pritisni + in dodaj prvo knjigo.'}</p></div>`;
    return;
  }
  list.innerHTML=shown.map(bookCard).join('');
  list.querySelectorAll('.entry').forEach(el=>{
    const id=el.dataset.id;
    el.querySelector('.entry-head').onclick=()=>{ expanded.has(id)?expanded.delete(id):expanded.add(id); el.classList.toggle('open',expanded.has(id)); };
    el.querySelector('.editBtn').onclick=ev=>{ ev.stopPropagation(); openSheet(id); };
    el.querySelector('.deleteBtn').onclick=ev=>{ ev.stopPropagation(); removeBook(id); };
    const qa=el.querySelector('.qa-input');
    const qQ=el.querySelector('.qa-quote'), qN=el.querySelector('.qa-note');
    const qaSync=()=>{
      qa.style.height='auto'; qa.style.height=Math.max(44,qa.scrollHeight)+'px';
      const has=!!qa.value.trim();
      qQ.classList.toggle('filled',has); qN.classList.toggle('filled',has);
    };
    qa.addEventListener('input',qaSync);
    qQ.onclick=ev=>{ ev.stopPropagation(); const v=qa.value.trim(); if(!v) return; qa.value=''; qaSync(); quickAdd(id,'quotes',v); };
    qN.onclick=ev=>{ ev.stopPropagation(); const v=qa.value.trim(); if(!v) return; qa.value=''; qaSync(); quickAdd(id,'notes',v); };
  });
}
async function quickAdd(id, field, text){
  const b=books.find(x=>x.id===id); if(!b) return;
  const next=toLines(b[field]).concat(text.trim());
  try{
    await updateDoc(doc(db,"books",id),{[field]:next});
    setStatus(field==='quotes'?'Citat dodan':'Opomba dodana');
    setTimeout(()=>{ if(statusLine.textContent==='Citat dodan'||statusLine.textContent==='Opomba dodana') setStatus(''); },1600);
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
}

function bookCard(b){
  const color=b.color||BOOK_PALETTE[0];
  const initial=(b.title||'?').trim().charAt(0);
  const st=b.status||'read';
  const isOpen=expanded.has(b.id);
  const quotes=toLines(b.quotes), notes=toLines(b.notes);
  const pages=Number(b.pages)||0, pageAt=Number(b.pageAt)||0;
  const dateTxt=fmtReadDate(b);
  const coverHtml=b.coverUrl
    ? `<img src="${esc(b.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const progress=(st==='current'||st==='dnf')&&pages&&pageAt
    ? `<span class="prog-wrap"><span class="prog-track"><span class="prog-fill" style="width:${Math.min(100,pageAt/pages*100).toFixed(0)}%"></span></span>
       <span class="prog-txt">stran ${pageAt} od ${pages} · ${Math.min(100,Math.round(pageAt/pages*100))}%</span></span>` : '';
  const details=[];
  if(pages) details.push(`<span class="pill">${pages} str.</span>`);
  if(b.published) details.push(`<span class="pill">izid ${esc(b.published)}</span>`);
  (b.genres||[]).forEach(g=>details.push(`<span class="pill genre">${esc(g)}</span>`));

  return `<div class="entry ${isOpen?'open':''}" data-id="${b.id}" style="--spine:${color}">
    <div class="entry-head">
      <div class="cover" style="background:${color}">${coverHtml}</div>
      <div class="entry-info">
        <p class="entry-title">${esc(b.title)}</p>
        <p class="entry-author">${esc(b.author)}</p>
        <div class="meta-row">
          <span class="status-tag ${STATUS_CLASS[st]}">${BOOK_STATUS[st]}</span>
          ${starHtml(b.rating)}
          ${dateTxt?`<span class="date-tag">${esc(dateTxt)}</span>`:''}
          ${marksHtml(quotes.length,notes.length,0)}
        </div>
        ${progress}
      </div>
      <span class="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div>
    <div class="entry-body"><div class="reveal-inner">
      ${details.length?`<div class="detail-row">${details.join('')}</div>`:''}
      ${quotesHtml(quotes)}${notesHtml(notes)}
      <div class="quick-add">
        <textarea class="qa-input" rows="1" placeholder="Med branjem: zapiši citat ali misel…"></textarea>
        <div class="qa-btns">
          <button type="button" class="qa-btn qa-quote">${ICON_Q} Kot citat</button>
          <button type="button" class="qa-btn qa-note">${ICON_N} Kot opomba</button>
        </div>
      </div>
      <div class="entry-actions">
        <button class="act-btn editBtn">${EDIT_SVG} Uredi</button>
        <button class="act-btn danger deleteBtn">${DEL_SVG} Izbriši</button>
      </div>
    </div></div></div>`;
}
const EDIT_SVG=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const DEL_SVG=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

function fmtReadDate(b){
  const y=b.readYear,m=b.readMonth;
  if(y&&m) return `${MONTHS[m-1]} ${y}`;
  if(y) return String(y);
  return '';
}
function fmtEpDate(iso){
  if(!iso) return '';
  const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return String(iso);
  return `${Number(m[3])}. ${MONTHS[Number(m[2])-1]} ${m[1]}`;
}

/* ---------- podcasts ---------- */
function renderPods(){
  const list=$('podList');
  const q=$('podSearch').value.trim().toLowerCase();
  const counts={all:pods.length,read:0,current:0,wish:0,dnf:0};
  pods.forEach(p=>{ const s=podState(p).key; if(counts[s]!==undefined) counts[s]++; });
  ['all','read','current','wish','dnf'].forEach(k=>{ $('pc-'+k).textContent=counts[k]||''; });

  let shown=pods;
  if(podFilter!=='all') shown=shown.filter(p=>podState(p).key===podFilter);
  if(q) shown=shown.filter(p=>
    (p.title||'').toLowerCase().includes(q)||
    (p.host||'').toLowerCase().includes(q)||
    (p.genres||[]).some(g=>g.includes(q))||
    toLines(p.notes).join(' ').toLowerCase().includes(q)||
    (p.episodes||[]).some(e=>
      (e.title||'').toLowerCase().includes(q)||
      toLines(e.notes).join(' ').toLowerCase().includes(q)||
      toLines(e.quotes).join(' ').toLowerCase().includes(q)));
  shown=sortItems(shown);

  if(!shown.length){
    const f=q||podFilter!=='all';
    list.innerHTML=`<div class="empty"><div class="empty-icon">${pods.length?'🔍':'🎧'}</div>
      <p class="empty-title">${pods.length?'Ni zadetkov':'Ni še podcastov'}</p>
      <p class="empty-sub">${f?'Poskusi z drugim iskanjem ali filtrom.':'Pritisni + in dodaj prvi podcast.'}</p></div>`;
    return;
  }
  list.innerHTML=shown.map(podCard).join('');
  list.querySelectorAll('.entry').forEach(el=>{
    el.querySelector('.entry-head').onclick=()=>{ openPodId=el.dataset.id; epExpanded.clear(); goTo('podDetail'); window.scrollTo({top:0}); };
  });
}

function podCard(p){
  const color=p.color||POD_PALETTE[0];
  const initial=(p.title||'?').trim().charAt(0);
  const state=podState(p);
  const eps=p.episodes||[];
  const notes=toLines(p.notes);
  const coverHtml=p.coverUrl
    ? `<img src="${esc(p.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const epQ=eps.reduce((s,e)=>s+toLines(e.quotes).length,0);
  const epN=eps.reduce((s,e)=>s+toLines(e.notes).length,0);
  const avg=podRatingAvg(p);
  return `<div class="entry" data-id="${p.id}" style="--spine:${color}">
    <div class="entry-head">
      <div class="cover square" style="background:${color}">${coverHtml}</div>
      <div class="entry-info">
        <p class="entry-title">${esc(p.title)}</p>
        <p class="entry-author">${esc(p.host)}</p>
        <div class="meta-row">
          <span class="status-tag ${state.cls}">${state.label}</span>
          ${starHtml(avg)}
          ${marksHtml(epQ, notes.length+epN, eps.length)}
        </div>
      </div>
      <span class="chev" style="transform:rotate(-90deg)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div></div>`;
}

function renderPodDetail(){
  const p=pods.find(x=>x.id===openPodId);
  const v=$('podDetailView');
  if(!p){ openPodId=null; goTo('pods'); return; }

  const color=p.color||POD_PALETTE[0];
  const initial=(p.title||'?').trim().charAt(0);
  const state=podState(p);
  const avg=podRatingAvg(p);
  const notes=toLines(p.notes);
  const eps=[...(p.episodes||[])].sort((a,b)=>{
    const da=a.date||'', dbb=b.date||'';
    if(da&&dbb) return dbb.localeCompare(da);
    if(da) return -1;
    if(dbb) return 1;
    return (Number(b.num)||0)-(Number(a.num)||0);
  });
  const coverHtml=p.coverUrl
    ? `<img src="${esc(p.coverUrl)}" alt="" onerror="this.parentNode.innerHTML='<span class=&quot;cover-fallback&quot;>${esc(initial)}</span>'">`
    : `<span class="cover-fallback">${esc(initial)}</span>`;
  const details=(p.genres||[]).map(g=>`<span class="pill genre">${esc(g)}</span>`);
  const totalMin=eps.reduce((s,e)=>s+(Number(e.minutes)||0),0);
  if(totalMin) details.unshift(`<span class="pill">${fmtRating(Math.round(totalMin/60*10)/10)} h poslušanja</span>`);

  v.innerHTML=`
    <div class="back-bar">
      <button class="back-btn" id="podBack">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Podcasti
      </button>
    </div>
    <div class="pod-hero">
      <div class="cover square" style="background:${color}; width:96px; height:96px; border-radius:14px">${coverHtml}</div>
      <div class="pod-hero-info">
        <h2>${esc(p.title)}</h2>
        <p class="host">${esc(p.host)}</p>
        <div class="meta-row">
          <span class="status-tag ${state.cls}">${state.label}</span>
          ${avg?starHtml(avg):''}
        </div>
      </div>
    </div>
    ${details.length?`<div class="detail-row" style="border-top:none; padding-top:0">${details.join('')}</div>`:''}
    ${notesHtml(notes)}
    <div class="entry-actions">
      <button class="act-btn" id="podEdit">${EDIT_SVG} Uredi podcast</button>
      <button class="act-btn danger" id="podDelete">${DEL_SVG} Izbriši</button>
    </div>

    <div class="ep-head">
      <h3>Epizode${eps.length?` <span class="rank-cnt">${eps.length}</span>`:''}</h3>
      <button class="ep-add" id="epAdd">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Epizoda
      </button>
    </div>
    <div class="ep-list" id="epList">${
      eps.length ? eps.map((e,i)=>epRow(e,eps.length-i)).join('')
      : `<div class="empty" style="padding:36px 20px"><p class="empty-title">Ni še epizod</p><p class="empty-sub">Dodaj prvo epizodo tega podcasta.</p></div>`
    }</div>`;

  $('podBack').onclick=()=>{ openPodId=null; goTo('pods'); };
  $('podEdit').onclick=()=>openPodSheet(p.id);
  $('podDelete').onclick=()=>removePod(p.id);
  $('epAdd').onclick=()=>openEpSheet(p.id,null);
  v.querySelectorAll('.ep').forEach(el=>{
    const eid=el.dataset.eid;
    el.querySelector('.ep-row').onclick=()=>{ epExpanded.has(eid)?epExpanded.delete(eid):epExpanded.add(eid); el.classList.toggle('open',epExpanded.has(eid)); };
    el.querySelector('.epEdit').onclick=ev=>{ ev.stopPropagation(); openEpSheet(p.id,eid); };
    el.querySelector('.epDel').onclick=ev=>{ ev.stopPropagation(); removeEpisode(p.id,eid); };
    const qa=el.querySelector('.qa-input');
    const qQ=el.querySelector('.qa-quote'), qN=el.querySelector('.qa-note');
    const qaSync=()=>{
      qa.style.height='auto'; qa.style.height=Math.max(44,qa.scrollHeight)+'px';
      const has=!!qa.value.trim();
      qQ.classList.toggle('filled',has); qN.classList.toggle('filled',has);
    };
    qa.addEventListener('input',qaSync);
    qQ.onclick=ev=>{ ev.stopPropagation(); const val=qa.value.trim(); if(!val) return; qa.value=''; qaSync(); quickAddEp(p.id,eid,'quotes',val); };
    qN.onclick=ev=>{ ev.stopPropagation(); const val=qa.value.trim(); if(!val) return; qa.value=''; qaSync(); quickAddEp(p.id,eid,'notes',val); };
  });
}
async function quickAddEp(podId, epId, field, text){
  const p=pods.find(x=>x.id===podId); if(!p) return;
  const list=(p.episodes||[]).map(e=>{
    if(e.id!==epId) return e;
    return { ...e, [field]: toLines(e[field]).concat(text.trim()) };
  });
  try{
    await updateDoc(doc(db,"podcasts",podId),{episodes:list});
    setStatus(field==='quotes'?'Citat dodan':'Opomba dodana');
    setTimeout(()=>{ if(statusLine.textContent==='Citat dodan'||statusLine.textContent==='Opomba dodana') setStatus(''); },1600);
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
}

function epRow(e,idx){
  const st=e.status||'read';
  const quotes=toLines(e.quotes), notes=toLines(e.notes);
  const isOpen=epExpanded.has(e.id);
  const dateTxt=fmtEpDate(e.date);
  const bits=[];
  if(e.minutes) bits.push(`<span class="date-tag">${esc(e.minutes)} min</span>`);
  if(dateTxt) bits.push(`<span class="date-tag">${esc(dateTxt)}</span>`);
  const badge = e.num ? esc(e.num) : idx;
  return `<div class="ep ${isOpen?'open':''}" data-eid="${e.id}">
    <div class="ep-row">
      <span class="ep-idx" title="${e.num?'Št. epizode':'Zaporedna'}">${badge}</span>
      <div class="ep-info">
        <p class="ep-title">${esc(e.title)}</p>
        <div class="ep-meta">
          <span class="status-tag ${STATUS_CLASS[st]}">${POD_STATUS[st]}</span>
          ${starHtml(e.rating)}
          ${bits.join('')}
          ${marksHtml(quotes.length,notes.length,0)}
        </div>
      </div>
      <span class="chev"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></span>
    </div>
    <div class="ep-body"><div class="reveal-inner">
      ${quotesHtml(quotes)}${notesHtml(notes)}
      <div class="quick-add">
        <textarea class="qa-input" rows="1" placeholder="Med poslušanjem: zapiši citat ali misel…"></textarea>
        <div class="qa-btns">
          <button type="button" class="qa-btn qa-quote">${ICON_Q} Kot citat</button>
          <button type="button" class="qa-btn qa-note">${ICON_N} Kot opomba</button>
        </div>
      </div>
      <div class="entry-actions">
        <button class="act-btn epEdit">${EDIT_SVG} Uredi</button>
        <button class="act-btn danger epDel">${DEL_SVG} Izbriši</button>
      </div>
    </div></div></div>`;
}

/* ---------- stats ---------- */
const GENRE_COLORS = ['#E5A45B','#9C8CFA','#7EC8C4','#E38FB4','#77C293','#D98B6A','#8E9BD4','#C9A86B'];

function epYM(iso){ const m=/^(\d{4})-(\d{2})/.exec(String(iso||'')); return m?{y:+m[1],m:+m[2]}:null; }

function statYears(){
  const s=new Set();
  books.forEach(b=>{ if(b.readYear) s.add(+b.readYear); });
  pods.forEach(p=>(p.episodes||[]).forEach(e=>{ const d=epYM(e.date); if(d) s.add(d.y); }));
  return [...s].sort((a,b)=>b-a);
}

let pendingCharts = [];
function destroyStatCharts(){
  statCharts.forEach(c=>{ try{ c.destroy(); }catch(e){} });
  statCharts=[];
  pendingCharts=[];
}
/* zgradi vse še nezgrajene grafe, ki ležijo v podani kartici */
function buildChartsIn(cardEl){
  if(!window.Chart) return;
  pendingCharts = pendingCharts.filter(pc=>{
    const el=$(pc.id);
    if(!el || !cardEl.contains(el)) return true;
    try{ statCharts.push(new Chart(el.getContext('2d'), pc.config)); }catch(e){ console.warn('chart',pc.id,e); }
    return false;
  });
  window.__statCharts = statCharts;
}

function withChartLib(fn){
  if(window.Chart) return fn();
  let n=0;
  const t=setInterval(()=>{
    if(window.Chart){ clearInterval(t); fn(); }
    else if(n++>40){ clearInterval(t); }
  },100);
}

function chartCommonOpts(){
  const cs=getComputedStyle(document.documentElement);
  const grid=cs.getPropertyValue('--line-soft').trim()||'#20252C';
  const tick=cs.getPropertyValue('--text-faint').trim()||'#6D7480';
  return { grid, tick,
    legend:{ position:'bottom', labels:{ boxWidth:9, boxHeight:9, usePointStyle:true, padding:14,
      color:cs.getPropertyValue('--text-soft').trim()||'#A3AAB5', font:{ family:"'Literata',Georgia,serif" } } } };
}

function buildStatChart(id, config){
  const el=$(id); if(!el) return;
  pendingCharts.push({ id, config });   // dejansko se zgradi ob drsenju do kartice
}

function buildStatCharts(){
  const co=chartCommonOpts();
  const yearSel = statsPeriod==='all' ? null : Number(statsPeriod);
  const barScales = {
    x:{ grid:{ display:false }, ticks:{ color:co.tick, font:{ size:11 } } },
    y:{ beginAtZero:true, ticks:{ precision:0, stepSize:1, color:co.tick, font:{ size:11 } }, grid:{ color:co.grid } }
  };
  const baseOpts = { responsive:true, maintainAspectRatio:false, animation:{ duration:1100, easing:'easeOutQuart' },
    plugins:{ legend:co.legend, tooltip:{ boxPadding:6 } } };

  const doneBooks=books.filter(b=>(b.status||'read')==='read');
  const allEps=pods.flatMap(p=>(p.episodes||[]).map(e=>({...e,pod:p.title})));
  const doneEps=allEps.filter(e=>(e.status||'read')==='read');

  /* --- 1. Aktivnost skozi čas --- */
  let labels, bookData, epData;
  if(yearSel){
    labels = MONTHS.map(m=>m.slice(0,3));
    bookData = Array(12).fill(0); epData = Array(12).fill(0);
    doneBooks.forEach(b=>{ if(+b.readYear===yearSel && b.readMonth) bookData[b.readMonth-1]++; });
    doneEps.forEach(e=>{ const d=epYM(e.date); if(d && d.y===yearSel) epData[d.m-1]++; });
  } else {
    const ys=statYears().slice().reverse();
    labels = ys.length?ys:[thisYear];
    bookData = labels.map(y=>doneBooks.filter(b=>+b.readYear===y).length);
    epData   = labels.map(y=>doneEps.filter(e=>{ const d=epYM(e.date); return d && d.y===y; }).length);
    labels = labels.map(String);
  }
  if(bookData.some(n=>n) || epData.some(n=>n)){
    buildStatChart('chAktivnost', { type:'bar',
      data:{ labels, datasets:[
        { label:'Knjige', data:bookData, backgroundColor:ACC_BOOK, borderRadius:4, maxBarThickness:34 },
        { label:'Epizode', data:epData, backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:34 } ] },
      options:{ ...baseOpts, scales:barScales } });
  }

  /* --- 2. Razdelitev ocen --- */
  const bBuck=[0,0,0,0,0], eBuck=[0,0,0,0,0];
  books.forEach(b=>{ const r=Number(b.rating); if(r>0 && (!yearSel || +b.readYear===yearSel)) bBuck[Math.min(4,Math.round(r)-1)]++; });
  allEps.forEach(e=>{ const r=Number(e.rating); const d=epYM(e.date);
    if(r>0 && (!yearSel || (d && d.y===yearSel))) eBuck[Math.min(4,Math.round(r)-1)]++; });
  if(bBuck.some(n=>n) || eBuck.some(n=>n)){
    buildStatChart('chOcene', { type:'bar',
      data:{ labels:['1★','2★','3★','4★','5★'], datasets:[
        { label:'Knjige', data:bBuck, backgroundColor:ACC_BOOK, borderRadius:4, maxBarThickness:40 },
        { label:'Epizode', data:eBuck, backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:40 } ] },
      options:{ ...baseOpts, scales:barScales } });
  }

  /* --- 3. Žanri (knjige) --- */
  const gc={};
  books.forEach(b=>{ if(!yearSel || +b.readYear===yearSel) (b.genres||[]).forEach(g=>{ gc[g]=(gc[g]||0)+1; }); });
  const gTop=Object.entries(gc).sort((a,b)=>b[1]-a[1]).slice(0,7);
  if(gTop.length){
    buildStatChart('chZanri', { type:'doughnut',
      data:{ labels:gTop.map(g=>g[0]), datasets:[{ data:gTop.map(g=>g[1]),
        backgroundColor:GENRE_COLORS, borderColor:getComputedStyle(document.documentElement).getPropertyValue('--card').trim()||'#1A1E24', borderWidth:2 }] },
      options:{ ...baseOpts, cutout:'56%',
        plugins:{ legend:{ ...co.legend, position:'right' }, tooltip:{ boxPadding:6 } } } });
  }

  /* --- 4. Epizode po podcastih --- */
  const podEp=pods.map(p=>[p.title,(p.episodes||[]).filter(e=>!yearSel || (epYM(e.date)||{}).y===yearSel).length])
    .filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(podEp.length){
    buildStatChart('chPods', { type:'bar',
      data:{ labels:podEp.map(x=>x[0]), datasets:[{ label:'Epizode', data:podEp.map(x=>x[1]),
        backgroundColor:ACC_POD, borderRadius:4, maxBarThickness:26 }] },
      options:{ ...baseOpts, indexAxis:'y', plugins:{ legend:{ display:false }, tooltip:{ boxPadding:6 } },
        scales:{ x:{ beginAtZero:true, ticks:{ precision:0, stepSize:1, color:co.tick }, grid:{ color:co.grid } },
                 y:{ grid:{ display:false }, ticks:{ color:co.tick, font:{ size:11 } } } } } });
  }
}

function renderStats(){
  destroyStatCharts();
  const v=$('statsView');
  const read=books.filter(b=>(b.status||'read')==='read');
  const rated=books.filter(b=>Number(b.rating)>0);
  const avg=rated.length?rated.reduce((s,b)=>s+Number(b.rating),0)/rated.length:0;

  const yearCount={};
  read.forEach(b=>{ if(b.readYear) yearCount[b.readYear]=(yearCount[b.readYear]||0)+1; });

  const authorCount={};
  books.forEach(b=>{ const a=(b.author||'').trim(); if(a) authorCount[a]=(authorCount[a]||0)+1; });
  const topAuthors=Object.entries(authorCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const topGenres=genreCounts().slice(0,6);
  const topRated=[...rated].sort((a,b)=>Number(b.rating)-Number(a.rating)).slice(0,5);

  const doneThisYear=yearCount[thisYear]||0;
  const totalPages=read.reduce((s,b)=>s+(Number(b.pages)||0),0);

  const allEps=pods.flatMap(p=>(p.episodes||[]).map(e=>({...e,pod:p.title})));
  const epsDone=allEps.filter(e=>(e.status||'read')==='read');
  const epMinutes=epsDone.reduce((s,e)=>s+(Number(e.minutes)||0),0);
  const epRated=allEps.filter(e=>Number(e.rating)>0);
  const epAvg=epRated.length?epRated.reduce((s,e)=>s+Number(e.rating),0)/epRated.length:0;
  const topEps=[...epRated].sort((a,b)=>Number(b.rating)-Number(a.rating)).slice(0,5);

  const quoteTotal = books.reduce((s,b)=>s+toLines(b.quotes).length,0)
    + pods.reduce((s,p)=>s+(p.episodes||[]).reduce((t,e)=>t+toLines(e.quotes).length,0),0);

  const goal=Number(settings.goal)||0;
  const goalPct=goal?Math.min(100,doneThisYear/goal*100):0;
  const left=Math.max(0,goal-doneThisYear);
  const tick=n=>n===1?'knjiga':n===2?'knjigi':n<=4?'knjige':'knjig';

  const years=statYears();
  if(statsPeriod!=='all' && !years.includes(Number(statsPeriod))) statsPeriod='all';
  const chip=(k,lbl)=>`<button class="chip ${String(statsPeriod)===String(k)?'active':''}" data-period="${k}">${lbl}</button>`;
  const chipsRow = `<div class="stat-chips">${chip('all','Vse')}${years.map(y=>chip(y,y)).join('')}</div>`;

  v.innerHTML=`
    <div class="goal-card">
      <div class="goal-top"><span class="goal-label">Letni cilj ${thisYear}</span>
      <button class="goal-edit" id="goalEditBtn">${goal?'spremeni':'nastavi'}</button></div>
      ${goal?`<div class="goal-nums">${doneThisYear} <small>/ ${goal} knjig</small></div>
        <span class="goal-track"><span class="goal-fill" style="width:${goalPct.toFixed(0)}%"></span></span>
        <span class="goal-note">${doneThisYear>=goal?'Cilj dosežen. Bravo!':`Še ${left} ${tick(left)} do cilja.`}</span>`
      :`<div class="goal-none">Nastavi cilj in spremljaj napredek skozi leto.</div>`}
    </div>

    <div class="stat-section-title" style="margin-top:6px">Knjige</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-num">${books.length}</div><div class="stat-lbl">Vseh vnosov</div></div>
      <div class="stat-box"><div class="stat-num">${read.length}</div><div class="stat-lbl">Prebranih</div></div>
      <div class="stat-box"><div class="stat-num">${avg?fmtRating(Math.round(avg*10)/10):'—'}</div><div class="stat-lbl">Povprečna ocena</div></div>
      <div class="stat-box"><div class="stat-num">${totalPages?totalPages.toLocaleString('sl'):'—'}</div><div class="stat-lbl">Prebranih strani</div></div>
    </div>

    <div class="stat-section-title">Podcasti</div>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-num">${pods.length}</div><div class="stat-lbl">Podcastov</div></div>
      <div class="stat-box"><div class="stat-num">${epsDone.length}</div><div class="stat-lbl">Poslušanih epizod</div></div>
      <div class="stat-box"><div class="stat-num">${epMinutes?Math.round(epMinutes/60):'—'}</div><div class="stat-lbl">Ur poslušanja</div></div>
      <div class="stat-box"><div class="stat-num">${epAvg?fmtRating(Math.round(epAvg*10)/10):'—'}</div><div class="stat-lbl">Povpr. ocena epizod</div></div>
    </div>

    <div class="stat-grid" style="margin-top:10px">
      <div class="stat-box"><div class="stat-num">${quoteTotal||'—'}</div><div class="stat-lbl">Zapisanih citatov</div></div>
      <div class="stat-box"><div class="stat-num">${topGenres.length||'—'}</div><div class="stat-lbl">Žanrov pri knjigah</div></div>
    </div>

    <div class="stat-section-title">Grafi</div>
    ${(books.length||pods.length)?`
    ${chipsRow}
    <div class="chart-card"><h4>Aktivnost ${statsPeriod==='all'?'po letih':'v letu '+statsPeriod}</h4>
      <div class="chart-box"><canvas id="chAktivnost"></canvas></div>
      <div class="chart-empty" id="emAktivnost" style="display:none">Za to obdobje ni podatkov z datumom.</div></div>
    <div class="chart-card"><h4>Razdelitev ocen</h4>
      <div class="chart-box"><canvas id="chOcene"></canvas></div>
      <div class="chart-empty" id="emOcene" style="display:none">Še ni ocenjenih vnosov.</div></div>
    <div class="chart-card"><h4>Žanri knjig</h4>
      <div class="chart-box tall"><canvas id="chZanri"></canvas></div>
      <div class="chart-empty" id="emZanri" style="display:none">Dodaj žanre pri knjigah.</div></div>
    <div class="chart-card"><h4>Epizode po podcastih</h4>
      <div class="chart-box"><canvas id="chPods"></canvas></div>
      <div class="chart-empty" id="emPods" style="display:none">Še ni epizod.</div></div>`
    :`<p class="empty-sub">Ko dodaš prve knjige in epizode, se tu pokažejo grafi.</p>`}

    ${topAuthors.length?`<div class="stat-section-title">Najpogostejši avtorji</div>
      ${topAuthors.map(([a,c])=>`<div class="rank-row"><span class="rank-name">${esc(a)}</span><span class="rank-cnt">${c}×</span></div>`).join('')}`:''}

    ${topRated.length?`<div class="stat-section-title">Najbolje ocenjene knjige</div>
      ${topRated.map(b=>`<div class="rank-row"><span class="rank-name">${esc(b.title)}</span><span>${starHtml(b.rating)}</span></div>`).join('')}`:''}

    ${topEps.length?`<div class="stat-section-title">Najbolje ocenjene epizode</div>
      ${topEps.map(e=>`<div class="rank-row"><span class="rank-name">${esc(e.title)}<br><span class="rank-cnt">${esc(e.pod)}</span></span><span>${starHtml(e.rating)}</span></div>`).join('')}`:''}
  `;
  const gb=$('goalEditBtn');
  if(gb) gb.onclick=openGoalSheet;
  resetScrollAnims();
  v.querySelectorAll('.stat-num').forEach(countUp);
  v.querySelectorAll('.stat-chips .chip').forEach(c=>{
    c.onclick=()=>{ const p=c.dataset.period; statsPeriod = p==='all'?'all':Number(p); renderStats(); };
  });
  withChartLib(()=>{
    if(view!=='stats') return;
    buildStatCharts();                       // samo registrira, kaj se bo zgradilo
    window.__statCharts = statCharts;
    [['chAktivnost','emAktivnost'],['chOcene','emOcene'],['chZanri','emZanri'],['chPods','emPods']].forEach(([cid,eid])=>{
      const has=pendingCharts.some(pc=>pc.id===cid);
      const box=$(cid)?.closest('.chart-box'); const em=$(eid);
      if(box) box.style.display = has?'':'none';
      if(em) em.style.display = has?'none':'';
    });
    /* graf se zgradi (in zanimira) šele, ko prideš do kartice z drsenjem */
    v.querySelectorAll('.chart-card').forEach(card=>{
      if(card.querySelector('.chart-box')?.style.display==='none') return;
      card.dataset.revealChart='1';
      observeScrollAnim(card);
    });
  });
}

/* ---------- goal ---------- */
function openGoalSheet(){
  $('goalYearTxt').textContent=thisYear;
  $('fGoal').value=settings.goal||'';
  $('goalOverlay').classList.add('open');
  setTimeout(()=>$('fGoal').focus(),80);
}
$('goalCancel').onclick=()=>$('goalOverlay').classList.remove('open');
$('goalOverlay').onclick=e=>{ if(e.target.id==='goalOverlay') $('goalOverlay').classList.remove('open'); };
$('goalSave').onclick=async()=>{
  const raw=$('fGoal').value.trim();
  const n=raw===''?null:Math.max(0,Math.floor(Number(raw)));
  if(raw!==''&&(!Number.isFinite(n)||n<=0)){ $('fGoal').focus(); return; }
  const b=$('goalSave'); b.disabled=true;
  try{ await setDoc(settingsRef(),{goal:n,goalYear:thisYear,userId:user.uid},{merge:true}); $('goalOverlay').classList.remove('open'); }
  catch(e){ console.error(e); setStatus('Cilja ni bilo mogoče shraniti.',true); }
  finally{ b.disabled=false; }
};

/* ---------- book sheet ---------- */
function openSheet(id){
  editingId=id||null;
  sheetLoading=true;
  if(id){
    const b=books.find(x=>x.id===id);
    $('sheetTitle').textContent='Uredi knjigo';
    $('fTitle').value=b.title||''; $('fAuthor').value=b.author||'';
    bookQuotes.set(toLines(b.quotes));
    bookNotes.set(toLines(b.notes));
    $('fPages').value=b.pages||''; $('fPageAt').value=b.pageAt||'';
    $('fPublished').value=b.published||'';
    bookColor.set(b.color||BOOK_PALETTE[0]); bookStatus.set(b.status||'read');
    bookRating.set(b.rating); bookGenres.set(b.genres);
    bookCover=b.coverUrl||'';
    monthSel.value=b.readMonth?String(b.readMonth):'';
    yearSel.value=b.readYear?String(b.readYear):'';
  } else {
    $('sheetTitle').textContent='Nova knjiga';
    ['fTitle','fAuthor','fPages','fPageAt','fPublished'].forEach(k=>{ $(k).value=''; });
    bookQuotes.set([]); bookNotes.set([]);
    bookColor.random(); bookStatus.set('read'); bookRating.set(0); bookGenres.set([]);
    bookCover=''; monthSel.value=''; yearSel.value='';
  }
  // povzetek, kaj je skrito pod "Več podrobnosti"
  const sum=[];
  const nq=bookQuotes.get().length, nn=bookNotes.get().length;
  if(nq) sum.push(nq+' '+slPlural(nq,['citat','citata','citati','citatov']));
  if(nn) sum.push(nn+' '+slPlural(nn,['opomba','opombi','opombe','opomb']));
  if($('fPages').value || $('fPageAt').value || $('fPublished').value) sum.push('strani');
  if(bookGenres.get().length) sum.push(slPlural(bookGenres.get().length,['žanr','žanra','žanri','žanrov']));
  bookMore.summary(sum.join(', '));
  bookMore.collapse(true);
  if(!sum.length) setTimeout(()=>bookMore.nudge(), 480);
  $('lookupTxt').textContent=bookCover?'Podatki nastavljeni.':'Vpiši naslov in pritisni Poišči.';
  renderPrev('lookupPrev',bookCover);
  $('overlay').classList.add('open');
  $('overlay').querySelector('.sheet').scrollTop=0;
  sheetLoading=false;
  setTimeout(()=>{
    $('fTitle').focus({preventScroll:true});
    $('overlay').querySelector('.sheet').scrollTop=0;
    bookQuotes.reflow(); bookNotes.reflow();
  },80);
}
function closeSheet(){ $('overlay').classList.remove('open'); editingId=null; }
const num=v=>{ const s=String(v).trim(); return s===''?null:(Math.max(0,Math.floor(Number(s)))||null); };

async function saveBook(){
  const title=$('fTitle').value.trim();
  if(!title){ $('fTitle').focus(); return; }
  const payload={
    title, author:$('fAuthor').value.trim(),
    quotes:bookQuotes.get(), notes:bookNotes.get(),
    genres:bookGenres.get(), color:bookColor.get(), status:bookStatus.get(),
    rating:bookRating.get(), pages:num($('fPages').value), pageAt:num($('fPageAt').value),
    published:num($('fPublished').value),
    readMonth:monthSel.value?Number(monthSel.value):null,
    readYear:yearSel.value?Number(yearSel.value):null,
    coverUrl:bookCover||''
  };
  const b=$('saveBtn'); b.disabled=true;
  try{
    if(editingId) await updateDoc(doc(db,"books",editingId),payload);
    else await addDoc(booksCol,{...payload,userId:user.uid,createdAtMs:Date.now(),createdAt:serverTimestamp()});
    closeSheet();
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
}
async function removeBook(id){
  try{ await deleteDoc(doc(db,"books",id)); expanded.delete(id); }
  catch(e){ console.error(e); setStatus('Brisanje ni uspelo.',true); }
}
$('cancelBtn').onclick=closeSheet;
$('saveBtn').onclick=saveBook;
$('overlay').onclick=e=>{ if(e.target.id==='overlay') closeSheet(); };
$('search').oninput=render;
$('podSearch').oninput=render;

/* ---------- podcast sheet ---------- */
function openPodSheet(id){
  editingPodId=id||null;
  if(id){
    const p=pods.find(x=>x.id===id);
    $('podSheetTitle').textContent='Uredi podcast';
    $('pTitle').value=p.title||''; $('pHost').value=p.host||'';
    podNotes.set(toLines(p.notes));
    podColor.set(p.color||POD_PALETTE[0]); podGenres.set(p.genres);
    podItunesId = p.itunesId || null;
    podCover=p.coverUrl||'';
  } else {
    $('podSheetTitle').textContent='Nov podcast';
    ['pTitle','pHost'].forEach(k=>{ $(k).value=''; });
    podNotes.set([]);
    podColor.random(); podGenres.set([]);
    podItunesId = null;
    podCover='';
  }
  const psum=[];
  const pnn=podNotes.get().length;
  if(pnn) psum.push(pnn+' '+slPlural(pnn,['opomba','opombi','opombe','opomb']));
  if(podGenres.get().length) psum.push(slPlural(podGenres.get().length,['žanr','žanra','žanri','žanrov']));
  podMore.summary(psum.join(', '));
  podMore.collapse(true);
  if(!psum.length) setTimeout(()=>podMore.nudge(), 480);
  $('pLookupTxt').textContent=podCover?'Podatki nastavljeni.':'Vpiši ime in pritisni Poišči.';
  renderPrev('pLookupPrev',podCover);
  $('podOverlay').classList.add('open');
  $('podOverlay').querySelector('.sheet').scrollTop=0;
  setTimeout(()=>{ $('pTitle').focus({preventScroll:true}); $('podOverlay').querySelector('.sheet').scrollTop=0; podNotes.reflow(); },80);
}
function closePodSheet(){ $('podOverlay').classList.remove('open'); editingPodId=null; }
$('podCancel').onclick=closePodSheet;
$('podOverlay').onclick=e=>{ if(e.target.id==='podOverlay') closePodSheet(); };
$('podSave').onclick=async()=>{
  const title=$('pTitle').value.trim();
  if(!title){ $('pTitle').focus(); return; }
  const payload={
    title, host:$('pHost').value.trim(),
    notes:podNotes.get(),
    genres:podGenres.get(), color:podColor.get(),
    itunesId:podItunesId||null, coverUrl:podCover||''
  };
  const b=$('podSave'); b.disabled=true;
  try{
    if(editingPodId) await updateDoc(doc(db,"podcasts",editingPodId),payload);
    else {
      const ref=await addDoc(podsCol,{...payload,userId:user.uid,episodes:[],createdAtMs:Date.now(),createdAt:serverTimestamp()});
      if(ref&&ref.id){ openPodId=ref.id; view='podDetail'; }
    }
    closePodSheet();
    if(view==='podDetail') goTo('podDetail');
  }catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
};
async function removePod(id){
  try{ await deleteDoc(doc(db,"podcasts",id)); podExpanded.delete(id); openPodId=null; goTo('pods'); }
  catch(e){ console.error(e); setStatus('Brisanje ni uspelo.',true); }
}

/* ---------- episode catalogue picker ---------- */
function closeEpFind(){ $('epFindOverlay').classList.remove('open'); }
$('epFindClose').onclick=closeEpFind;
$('epFindOverlay').onclick=e=>{ if(e.target.id==='epFindOverlay') closeEpFind(); };
$('epFindInput').oninput=renderEpFind;

function renderEpFind(){
  const q=$('epFindInput').value.trim().toLowerCase();
  const p=pods.find(x=>x.id===epParentId);
  const taken=new Set((p?.episodes||[]).map(e=>(e.title||'').toLowerCase()));
  let list=epCatalog;
  if(q) list=list.filter(e=>e.title.toLowerCase().includes(q));
  const box=$('epFindList');
  if(!list.length){
    box.innerHTML=`<p class="empty-sub" style="padding:14px 4px">${epCatalog.length?'Ni zadetkov.':'Ta podcast nima kataloga epizod.'}</p>`;
    return;
  }
  box.innerHTML=list.slice(0,60).map((e,i)=>{
    const bits=[e.num?'#'+e.num:'', e.minutes?e.minutes+' min':'', e.date?fmtEpDate(e.date):'']
      .filter(Boolean).join(' · ');
    const have=taken.has(e.title.toLowerCase());
    return `<button class="opt" data-i="${epCatalog.indexOf(e)}">
      <span style="min-width:0">
        <span style="display:block;overflow-wrap:anywhere">${esc(e.title)}</span>
        <span class="rank-cnt">${esc(bits)}${have?' · že dodana':''}</span>
      </span>
      ${have?'<span class="opt-count">✓</span>':''}
    </button>`;
  }).join('');
  box.querySelectorAll('.opt').forEach(o=>{
    o.onclick=()=>{
      const e=epCatalog[Number(o.dataset.i)];
      if(!e) return;
      $('eTitle').value=e.title;
      if(e.num) $('eNum').value=e.num;
      if(e.minutes) $('eMinutes').value=e.minutes;
      if(e.date && !$('eDate').value) $('eDate').value=e.date;
      if(e.num || e.minutes) epMore.open();
      $('epFindTxt').textContent='Izpolnjeno iz kataloga.';
      closeEpFind();
    };
  });
}

$('epFindBtn').onclick=async()=>{
  const p=pods.find(x=>x.id===epParentId);
  if(!p) return;
  if(!p.itunesId){
    $('epFindTxt').textContent='Ta podcast nima povezave na katalog. Uredi podcast in pritisni Poišči.';
    return;
  }
  const btn=$('epFindBtn'); btn.disabled=true;
  $('epFindTxt').textContent='Berem katalog…';
  if(epCatalogFor!==p.id){
    epCatalog=await fetchEpisodes(p.itunesId);
    epCatalogFor=p.id;
  }
  btn.disabled=false;
  if(!epCatalog.length){ $('epFindTxt').textContent='Katalog ni vrnil epizod. Vpiši ročno.'; return; }
  $('epFindTxt').textContent=`${epCatalog.length} epizod v katalogu.`;
  $('epFindInput').value='';
  renderEpFind();
  $('epFindOverlay').classList.add('open');
};

/* ---------- episode sheet ---------- */
function openEpSheet(podId,epId){
  epParentId=podId; editingEpId=epId||null;
  const p=pods.find(x=>x.id===podId);
  if(!p) return;
  if(epId){
    const e=(p.episodes||[]).find(x=>x.id===epId);
    if(!e) return;
    $('epSheetTitle').textContent='Uredi epizodo';
    $('eTitle').value=e.title||''; $('eNum').value=e.num||'';
    $('eMinutes').value=e.minutes||''; $('eDate').value=e.date||'';
    epQuotes.set(toLines(e.quotes));
    epNotes.set(toLines(e.notes));
    epStatus.set(e.status||'read'); epRating.set(e.rating);
  } else {
    $('epSheetTitle').textContent='Nova epizoda';
    ['eTitle','eNum','eMinutes','eDate'].forEach(k=>{ $(k).value=''; });
    epQuotes.set([]); epNotes.set([]);
    epStatus.set('read'); epRating.set(0);
  }
  const esum=[];
  const enq=epQuotes.get().length, enn=epNotes.get().length;
  if(enq) esum.push(enq+' '+slPlural(enq,['citat','citata','citati','citatov']));
  if(enn) esum.push(enn+' '+slPlural(enn,['opomba','opombi','opombe','opomb']));
  if($('eNum').value || $('eMinutes').value) esum.push('trajanje');
  epMore.summary(esum.join(', '));
  epMore.collapse(true);
  if(!esum.length) setTimeout(()=>epMore.nudge(), 480);
  const par=pods.find(x=>x.id===podId);
  $('epFindRow').style.display = (par && par.itunesId) ? '' : 'none';
  $('epFindTxt').textContent='Poišči epizodo v katalogu.';
  $('epOverlay').classList.add('open');
  $('epOverlay').querySelector('.sheet').scrollTop=0;
  setTimeout(()=>{ $('eTitle').focus({preventScroll:true}); $('epOverlay').querySelector('.sheet').scrollTop=0; epQuotes.reflow(); epNotes.reflow(); },80);
}
function closeEpSheet(){ $('epOverlay').classList.remove('open'); editingEpId=null; epParentId=null; }
$('epCancel').onclick=closeEpSheet;
$('epOverlay').onclick=e=>{ if(e.target.id==='epOverlay') closeEpSheet(); };

/* ---------- poteg navzdol zapre okno ---------- */
function enableSheetSwipe(overlayId, closeFn){
  const ov=$(overlayId); if(!ov) return;
  const sheet=ov.querySelector('.sheet'); if(!sheet) return;
  let startY=0, dy=0, active=false;
  const start=e=>{
    if(sheet.scrollTop>0) { active=false; return; }
    const t=e.target;
    if(t.closest('input,textarea,select,.rate-range,.seg')) return;
    startY=e.touches[0].clientY; dy=0; active=true;
    sheet.classList.add('dragging');
  };
  const move=e=>{
    if(!active) return;
    dy=e.touches[0].clientY-startY;
    if(dy<=0){ sheet.style.transform=''; return; }
    sheet.style.transform=`translateY(${dy}px)`;
    sheet.style.opacity=String(Math.max(.55, 1-dy/600));
  };
  const end=()=>{
    if(!active) return;
    active=false;
    sheet.classList.remove('dragging');
    sheet.style.transform=''; sheet.style.opacity='';
    if(dy>120){
      sheet.classList.add('closing');
      setTimeout(()=>{ sheet.classList.remove('closing'); closeFn(); }, 230);
    }
  };
  sheet.addEventListener('touchstart', start, {passive:true});
  sheet.addEventListener('touchmove', move, {passive:true});
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}
[['overlay',closeSheet],['podOverlay',closePodSheet],['epOverlay',closeEpSheet],
 ['epFindOverlay',closeEpFind],['goalOverlay',()=>$('goalOverlay').classList.remove('open')],
 ['sortOverlay',()=>$('sortOverlay').classList.remove('open')],
 ['genreOverlay',()=>$('genreOverlay').classList.remove('open')],
 ['acctOverlay',()=>$('acctOverlay').classList.remove('open')],
 ['addPickOverlay',()=>$('addPickOverlay').classList.remove('open')]
].forEach(([id,fn])=>enableSheetSwipe(id,fn));
$('epSave').onclick=async()=>{
  const title=$('eTitle').value.trim();
  if(!title){ $('eTitle').focus(); return; }
  const p=pods.find(x=>x.id===epParentId);
  if(!p) return;
  const ep={
    id: editingEpId||uid(),
    title,
    num:num($('eNum').value),
    minutes:num($('eMinutes').value),
    date:$('eDate').value||'',
    status:epStatus.get(),
    rating:epRating.get(),
    quotes:epQuotes.get(),
    notes:epNotes.get()
  };
  const list=[...(p.episodes||[])];
  if(editingEpId){
    const i=list.findIndex(x=>x.id===editingEpId);
    if(i>=0) list[i]=ep; else list.push(ep);
  } else list.push(ep);

  const b=$('epSave'); b.disabled=true;
  try{ await updateDoc(doc(db,"podcasts",p.id),{episodes:list}); closeEpSheet(); }
  catch(e){ console.error(e); setStatus('Shranjevanje ni uspelo.',true); }
  finally{ b.disabled=false; }
};
async function removeEpisode(podId,epId){
  const p=pods.find(x=>x.id===podId);
  if(!p) return;
  const list=(p.episodes||[]).filter(x=>x.id!==epId);
  try{ await updateDoc(doc(db,"podcasts",podId),{episodes:list}); epExpanded.delete(epId); }
  catch(e){ console.error(e); setStatus('Brisanje ni uspelo.',true); }
}

/* ---------- auth ---------- */
const gate=$('authGate');
const authMsg=$('authMsg');
let signupMode=false;

function setAuthMsg(t,kind){
  authMsg.textContent=t||'';
  authMsg.className='auth-msg'+(kind?' '+kind:'');
}
function authError(e){
  const c=(e&&e.code)||'';
  if(c.includes('invalid-credential')||c.includes('wrong-password')||c.includes('user-not-found'))
    return 'Napačen e-poštni naslov ali geslo.';
  if(c.includes('email-already-in-use')) return 'Ta naslov je že registriran. Poskusi prijavo.';
  if(c.includes('weak-password')) return 'Geslo mora imeti vsaj 6 znakov.';
  if(c.includes('invalid-email')) return 'E-poštni naslov ni veljaven.';
  if(c.includes('too-many-requests')) return 'Preveč poskusov. Počakaj nekaj minut.';
  if(c.includes('network')) return 'Ni povezave z internetom.';
  if(c.includes('popup')) return 'Prijavno okno je bilo zaprto.';
  return 'Prijava ni uspela. Poskusi znova.';
}

$('showMailBtn').onclick=()=>{
  $('mailForm').classList.add('show');
  $('showMailBtn').style.display='none';
  setTimeout(()=>$('authEmail').focus(),60);
};
$('toggleMode').onclick=()=>{
  signupMode=!signupMode;
  $('mailGo').textContent = signupMode ? 'Ustvari račun' : 'Prijava';
  $('toggleMode').textContent = signupMode ? 'Že imam račun — prijava' : 'Nimam še računa — registracija';
  $('authPass').setAttribute('autocomplete', signupMode?'new-password':'current-password');
  setAuthMsg('');
};
$('mailGo').onclick=async()=>{
  const em=$('authEmail').value.trim(), pw=$('authPass').value;
  if(!em||!pw){ setAuthMsg('Vpiši e-pošto in geslo.','err'); return; }
  const b=$('mailGo'); b.disabled=true; setAuthMsg('Prijavljam…');
  try{
    if(signupMode) await createUserWithEmailAndPassword(auth,em,pw);
    else await signInWithEmailAndPassword(auth,em,pw);
  }catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
  finally{ b.disabled=false; }
};
$('resetBtn').onclick=async()=>{
  const em=$('authEmail').value.trim();
  if(!em){ setAuthMsg('Najprej vpiši svoj e-poštni naslov.','err'); $('authEmail').focus(); return; }
  try{ await sendPasswordResetEmail(auth,em); setAuthMsg('Poslali smo ti povezavo za ponastavitev gesla.','ok'); }
  catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
};
const GOOGLE_CLIENT_ID = "990992068049-52s8de2e4bp1kkubosc5470k44op276t.apps.googleusercontent.com";

function initGoogle(){
  if(!window.google || !google.accounts || !google.accounts.id){
    setTimeout(initGoogle, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async resp => {
      setAuthMsg('Prijavljam…');
      try{
        await signInWithCredential(auth, GoogleAuthProvider.credential(resp.credential));
      }catch(e){ console.error(e); setAuthMsg(authError(e),'err'); }
    },
    auto_select: false,
    cancel_on_tap_outside: true
  });
  google.accounts.id.renderButton(document.getElementById('googleBtnBox'), {
    type:'standard', theme:'filled_white', size:'large',
    shape:'pill', text:'continue_with', logo_alignment:'left', width:300
  });
  google.accounts.id.prompt();
}
initGoogle();

/* account sheet */
function initials(u){
  const n=(u.displayName||u.email||'?').trim();
  return n.charAt(0).toUpperCase();
}
$('acctBtn').onclick=()=>{
  if(!user) return;
  const av=$('acctAvatar');
  av.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="">` : esc(initials(user));
  $('acctName').textContent=user.displayName||'Moj račun';
  $('acctMail').textContent=user.email||'';
  $('acctOverlay').classList.add('open');
};
$('acctOverlay').onclick=e=>{ if(e.target.id==='acctOverlay') $('acctOverlay').classList.remove('open'); };
$('acctStats').onclick=()=>{ $('acctOverlay').classList.remove('open'); goTo('stats'); };
$('acctSignOut').onclick=async()=>{
  $('acctOverlay').classList.remove('open');
  try{ await signOut(auth); }catch(e){ console.error(e); }
};

/* one-time claim of pre-login records */
async function claimLegacy(uid){
  const key='mg-claimed-'+uid;
  if(localStorage.getItem(key)) return;
  try{
    for(const [col,name] of [[booksCol,'books'],[podsCol,'podcasts']]){
      const snap=await getDocs(col);
      for(const d of snap.docs){
        if(!d.data().userId) await updateDoc(doc(db,name,d.id),{userId:uid});
      }
    }
    localStorage.setItem(key,'1');
  }catch(e){ console.error('claim skipped',e); }
}

/* ---------- sync ---------- */
function stopSync(){ unsubs.forEach(u=>{ try{u();}catch(e){} }); unsubs=[]; }

function startSync(uid){
  stopSync();
  let booksReady=false, podsReady=false;
  const ready=()=>{ if(booksReady&&podsReady){ $('addBtn').disabled=false; setStatus(''); } };

  unsubs.push(onSnapshot(query(booksCol, where('userId','==',uid)), snap=>{
    books=snap.docs.map(d=>({id:d.id,...d.data()}));
    booksReady=true; ready(); render();
  }, err=>{ console.error(err); setStatus('Napaka pri sinhronizaciji.',true); }));

  unsubs.push(onSnapshot(query(podsCol, where('userId','==',uid)), snap=>{
    pods=snap.docs.map(d=>({id:d.id,...d.data()}));
    podsReady=true; ready(); render();
  }, err=>{ console.error(err); setStatus('Napaka pri sinhronizaciji.',true); }));

  unsubs.push(onSnapshot(settingsRef(), snap=>{
    const d=snap&&snap.data?snap.data():null;
    settings=d||{goal:null,goalYear:thisYear};
    if(view==='stats'||view==='home') render();
  }, err=>{ console.error(err); }));
}

onAuthStateChanged(auth, async u=>{
  user=u;
  if(!u){
    stopSync();
    books=[]; pods=[]; settings={goal:null,goalYear:thisYear};
    expanded.clear(); podExpanded.clear(); epExpanded.clear();
    openPodId=null; epCatalog=[]; epCatalogFor=null;
    view='home'; render();
    gate.classList.add('show');
    document.body.style.overflow='hidden';
    $('mailGo').disabled=false; { const gb=$('googleBtn'); if(gb) gb.disabled=false; }
    setAuthMsg('');
    return;
  }
  gate.classList.remove('show');
  document.body.style.overflow='';
  $('acctBtn').innerHTML = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="">` : esc(initials(u));
  setStatus('Povezujem…');
  await claimLegacy(u.uid);
  startSync(u.uid);
  goTo('home');
});
