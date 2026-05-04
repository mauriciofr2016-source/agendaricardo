import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCG5BV3Oue5qBIzf5nP9OKQ1bCrg3UYuA4",
  authDomain: "agenda-exclusiva-ricardo.firebaseapp.com",
  projectId: "agenda-exclusiva-ricardo",
  storageBucket: "agenda-exclusiva-ricardo.firebasestorage.app",
  messagingSenderId: "318280976856",
  appId: "1:318280976856:web:48f829d0f306f916190aad",
  measurementId: "G-8H4GW03ZR5"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

export {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, serverTimestamp,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
};
