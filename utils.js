/* Marginalia — čiste pomožne funkcije in ikone.
   Brez odvisnosti od stanja aplikacije: samo vhod → izhod (in nekaj HTML-drobcev). */

export function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export function toLines(v){
  if(Array.isArray(v)) return v.map(x=>String(x).trim()).filter(Boolean);
  return String(v||'').split('\n').map(x=>x.trim()).filter(Boolean);
}
export function fmtRating(r){ return Number.isInteger(r)?String(r):r.toFixed(1).replace('.',','); }
/* slovenska sklanjatev: forms = [1, 2, 3–4, 5+] */
export function slPlural(n, forms){ const m=n%100; return forms[m===1?0:m===2?1:(m===3||m===4)?2:3]; }
export function normGenre(g){ return String(g||'').trim().toLowerCase().replace(/\s+/g,' '); }
export function httpsify(u){ return String(u||'').replace(/^http:/,'https:'); }
export function uid(){ return 'e_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

export function starHtml(rating){
  const r = Number(rating)||0;
  if(!r) return '';
  return `<span class="stars-wrap"><span class="stars-bg">★★★★★</span>`+
         `<span class="stars-fg" style="width:${r/5*100}%">★★★★★</span></span>`+
         `<span class="rating-num">${fmtRating(r)}</span>`;
}
export const ICON_Q = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9.5 5C6 5 3.5 7.7 3.5 11.2c0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Zm10 0c-3.5 0-6 2.7-6 6.2 0 3 2.1 5.3 4.9 5.3 1.7 0 2.9-1 2.9-2.5 0-1.4-1-2.4-2.4-2.4-.3 0-.6 0-.8.1.3-1.7 1.8-3 3.6-3.2V5h-2.2Z"/></svg>`;
export const ICON_N = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>`;
export const ICON_EP = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;

export const EDIT_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
export const DEL_SVG  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

export function quotesHtml(list){
  if(!list.length) return '';
  return `<div class="block"><span class="sec-label">Citati</span>${
    list.map(q=>`<div class="quote-item"><span class="qm qm-o">„</span>${esc(q)}<span class="qm qm-c">“</span></div>`).join('')}</div>`;
}
export function notesHtml(list){
  if(!list.length) return '';
  return `<div class="block"><span class="sec-label">Opombe</span>${
    list.map((n,i)=>`<div class="note-item"><span class="note-num">${i+1}</span><span class="note-text">${esc(n)}</span></div>`).join('')}</div>`;
}
export function marksHtml(q,n,ep){
  const m=[];
  if(ep) m.push(`<span class="badge-count">${ICON_EP}${ep}</span>`);
  if(q)  m.push(`<span class="badge-count">${ICON_Q}${q}</span>`);
  if(n)  m.push(`<span class="badge-count">${ICON_N}${n}</span>`);
  return m.join('');
}
