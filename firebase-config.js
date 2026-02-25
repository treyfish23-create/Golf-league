// ===== Firebase Config — Golf League App =====
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (e.g. "golf-league-app")
// 3. Enable Firestore Database (start in production mode)
// 4. Enable Authentication → Google provider + Email/Password
// 5. Enable Storage (for scorecard photo uploads)
// 6. Go to Project Settings → General → Your apps → Add app (Web)
// 7. Copy your firebaseConfig object and paste it below
// 8. Run: firebase login && firebase init hosting
//
// Replace the placeholder values below with your actual config.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, increment } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification, updateProfile } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js';

const firebaseConfig = {
  apiKey:            "AIzaSyAckVkeDWt0NaCYduQH-_-o-GgUfPOBra4",
  authDomain:        "golf-league-app-c4558.firebaseapp.com",
  projectId:         "golf-league-app-c4558",
  storageBucket:     "golf-league-app-c4558.firebasestorage.app",
  messagingSenderId: "847399939050",
  appId:             "1:847399939050:web:1264ccaa2a8a3e0a61e093"
};

// Singleton — only initialize once no matter how many modules import this
let app, db, auth, storage;
if (!app) {
  app     = initializeApp(firebaseConfig);
  db      = getFirestore(app);
  auth    = getAuth(app);
  storage = getStorage(app);
  window._db      = db;
  window._auth    = auth;
  window._storage = storage;

  // Expose all Firebase SDK functions on window._FB immediately
  // so non-module app.js can use them even if firestore-sync.js fails to load.
  // firestore-sync functions will be merged in by the index.html module script.
  window._FB = {
    getAuth: () => auth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile,
    getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    onSnapshot, query, where, orderBy, doc, collection, increment,
    db, auth, storage,
    storageRef: (path) => storageRef(storage, path),
    uploadBytes, getDownloadURL
  };

  console.log('[Firebase] initialized, window._FB ready');
}

export function initFirebase() { /* no-op, kept for compat */ }

// ===== Firestore helpers =====
// All paths are scoped to leagues/{leagueId}/ for multi-tenancy.

export function leagueRef(leagueId) {
  return doc(db, 'leagues', leagueId);
}

export function leagueConfigRef(leagueId) {
  return doc(db, 'leagues', leagueId, 'config', 'settings');
}

export function matchesRef(leagueId) {
  return collection(db, 'leagues', leagueId, 'matches');
}

export function matchRef(leagueId, matchKey) {
  return doc(db, 'leagues', leagueId, 'matches', matchKey);
}

export function playerRoundsRef(leagueId, playerId) {
  return doc(db, 'leagues', leagueId, 'playerRounds', playerId);
}

export function membershipRef(leagueId, uid) {
  return doc(db, 'leagues', leagueId, 'members', uid);
}

export function userRef(uid) {
  return doc(db, 'users', uid);
}

// ===== Auth helpers =====
export { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
         createUserWithEmailAndPassword, signOut, onAuthStateChanged,
         sendPasswordResetEmail, sendEmailVerification, updateProfile,
         getDoc, getDocs, setDoc, updateDoc, deleteDoc,
         onSnapshot, query, where, orderBy, doc, collection, increment };
