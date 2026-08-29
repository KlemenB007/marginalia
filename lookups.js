/* Marginalia — poizvedbe po zunanjih katalogih (Google Books, OpenLibrary, iTunes).
   Vse funkcije vrnejo golo vsebino ali null; ne dotikajo se DOM-a ali stanja. */

import { normGenre, httpsify } from './utils.js';

export async function lookupBook(title,author){
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

export async function fetchEpisodes(itunesId){
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

export async function lookupPodcast(name){
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
