#!/usr/bin/env node
// ===== Nuke All Firebase Data — Fresh Start =====
// Deletes ALL leagues, users, and storage files.
//
// Prerequisites:
//   1. npm install firebase-admin
//   2. Download service account key from Firebase Console:
//      https://console.firebase.google.com/project/golf-league-app-c4558/settings/serviceaccounts/adminsdk
//      → "Generate New Private Key" → save as service-account-key.json in this folder
//
// Run:  node cleanup-leagues.mjs

import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// ── Init Firebase Admin ──
const sa = JSON.parse(readFileSync('./service-account-key.json', 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: 'golf-league-app-c4558.firebasestorage.app'
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

let totalDeleted = 0;

// ── Helper: delete all docs in a collection ──
async function deleteCollection(path) {
  const snap = await db.collection(path).get();
  for (const doc of snap.docs) {
    await doc.ref.delete();
    totalDeleted++;
  }
  return snap.size;
}

// ── Step 1: Find and delete all leagues ──
console.log('\n🔍 Finding all leagues...');
const leagueSnap = await db.collection('leagues').get();
console.log(`   Found ${leagueSnap.size} league(s)\n`);

for (const leagueDoc of leagueSnap.docs) {
  const leagueId = leagueDoc.id;
  const data = leagueDoc.data();
  console.log(`🗑️  Deleting league: "${data.name || leagueId}"`);

  // Delete subcollections
  const subcollections = ['matches', 'playerRounds', 'members'];
  for (const sub of subcollections) {
    const count = await deleteCollection(`leagues/${leagueId}/${sub}`);
    if (count > 0) console.log(`     ├─ ${sub}: ${count} docs`);
  }

  // Delete config/settings doc
  try {
    await db.doc(`leagues/${leagueId}/config/settings`).delete();
    totalDeleted++;
    console.log(`     ├─ config/settings: 1 doc`);
  } catch (e) { /* may not exist */ }

  // Delete the league doc itself
  await leagueDoc.ref.delete();
  totalDeleted++;
  console.log(`     └─ league doc deleted`);
}

// ── Step 2: Clean up all user docs & league indices ──
// NOTE: Firestore subcollections survive parent doc deletion, so we must
// find all auth users and delete their league index subcollections directly.
console.log('\n🔍 Finding all auth users...');
const listResult = await admin.auth().listUsers(1000);
console.log(`   Found ${listResult.users.length} auth user(s)\n`);

for (const user of listResult.users) {
  const uid = user.uid;
  console.log(`🗑️  Cleaning user: "${user.displayName || user.email || uid}"`);

  // Delete user's league indices (subcollection may exist even without parent doc)
  const count = await deleteCollection(`users/${uid}/leagues`);
  if (count > 0) console.log(`     ├─ league indices: ${count}`);

  // Delete the user doc itself (if it exists)
  const userDoc = await db.doc(`users/${uid}`).get();
  if (userDoc.exists) {
    await userDoc.ref.delete();
    totalDeleted++;
    console.log(`     └─ user doc deleted`);
  } else {
    console.log(`     └─ (no user doc)`);
  }
}

// ── Step 3: Clean up Storage ──
console.log('\n🔍 Finding storage files...');
try {
  const [files] = await bucket.getFiles({ prefix: 'leagues/' });
  if (files.length > 0) {
    console.log(`   Found ${files.length} file(s)\n`);
    for (const file of files) {
      await file.delete();
      totalDeleted++;
      console.log(`   🗑️  ${file.name}`);
    }
  } else {
    console.log('   No storage files found');
  }
} catch (e) {
  console.log(`   Storage cleanup skipped (${e.message})`);
}

// ── Done ──
console.log(`\n✅ Complete! Deleted ${totalDeleted} items total.`);
console.log('   Firebase is now clean — ready for a fresh start.\n');

process.exit(0);
