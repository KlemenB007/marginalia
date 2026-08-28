let cur = null;
let listeners = [];
window.__auth = {
  signIn(u){ cur = u; listeners.forEach(l=>l(cur)); },
  signOutNow(){ cur = null; listeners.forEach(l=>l(cur)); },
  current(){ return cur; },
  failNext: null,
  calls: []
};
export function getAuth(){ return { __mock:true }; }
export function onAuthStateChanged(a, cb){ listeners.push(cb); setTimeout(()=>cb(cur),0); return ()=>{}; }
export function GoogleAuthProvider(){ }
GoogleAuthProvider.credential = function(idToken){ return { __googleCred: idToken || null }; };
export async function signInWithCredential(a, cred){
  window.__auth.calls.push('credential');
  if(window.__auth.failNext){ const c=window.__auth.failNext; window.__auth.failNext=null; const e=new Error('x'); e.code=c; throw e; }
  window.__auth.signIn({uid:'u_google',email:'klemen@example.com',displayName:'Klemen Burlak',photoURL:''});
  return { user: window.__auth.current() };
}
export async function signInWithRedirect(){ window.__auth.calls.push('redirect'); window.__auth.signIn({uid:'u_google',email:'klemen@example.com',displayName:'Klemen Burlak',photoURL:''}); }
export async function signInWithPopup(){ window.__auth.calls.push('popup'); window.__auth.signIn({uid:'u_google',email:'klemen@example.com',displayName:'Klemen Burlak',photoURL:''}); }
export async function getRedirectResult(){ return null; }
export async function signInWithEmailAndPassword(a,em,pw){
  window.__auth.calls.push('email:'+em);
  if(window.__auth.failNext){ const c=window.__auth.failNext; window.__auth.failNext=null; const e=new Error('x'); e.code=c; throw e; }
  window.__auth.signIn({uid:'u_mail',email:em,displayName:'',photoURL:''});
}
export async function createUserWithEmailAndPassword(a,em,pw){
  window.__auth.calls.push('signup:'+em);
  if(window.__auth.failNext){ const c=window.__auth.failNext; window.__auth.failNext=null; const e=new Error('x'); e.code=c; throw e; }
  window.__auth.signIn({uid:'u_new',email:em,displayName:'',photoURL:''});
}
export async function sendPasswordResetEmail(a,em){ window.__auth.calls.push('reset:'+em); }
export async function signOut(){ window.__auth.signOutNow(); }
