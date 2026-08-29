/* Marginalia — Firebase: konfiguracija, povezava in izvoz vseh funkcij, ki jih rabi app.js.
   Konfiguracija je namenoma javna (spletni Firebase); dostop varujejo varnostna pravila Firestore.

   Testi: test/build-test-app.mjs zamenja spodnje tri uvoze s CDN-ja z lokalnimi lažnimi moduli
   (mock-firebase-*.js), zato pričakuje natanko 3 zamenjave v tej datoteki. */

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

const auth = getAuth(app);
const booksCol = collection(db, "books");
const podsCol  = collection(db, "podcasts");

export {
  app, db, auth, booksCol, podsCol,
  collection, onSnapshot, query, where, getDocs,
  addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp,
  onAuthStateChanged, GoogleAuthProvider, signInWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut
};
