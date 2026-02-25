// ===== Firestore Sync — Golf League App =====
// Multi-tenant: all reads/writes scoped to leagues/{leagueId}/

// firebase-config.js initializes Firebase as a singleton on import
import {
  leagueRef, leagueConfigRef, matchesRef, matchRef,
  playerRoundsRef, membershipRef, userRef,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, doc, collection, increment,
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged
} from './firebase-config.js';

// ===== Module state =====
let _leagueId  = null;
let _listeners = []; // { unsub } — cleaned up on league switch

// ===== Init =====
export function initFirestore() {
  console.log('[Firestore] ready');
}

// ===== League switch =====
export function setActiveLeague(leagueId) {
  if (!leagueId) {
    console.warn('[Firestore] setActiveLeague called with falsy leagueId:', leagueId);
    return;
  }
  _teardownListeners();
  _leagueId = leagueId;
  window._leagueId = leagueId;
  console.log('[Firestore] active league:', leagueId);
}

function _teardownListeners() {
  _listeners.forEach(l => l.unsub());
  _listeners = [];
}

// ===== Retry utility for critical writes =====
async function _retryWrite(fn, label = 'write', maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[Firestore] ${label} attempt ${i + 1} failed:`, err.message);
      if (i === maxRetries - 1) {
        console.error(`[Firestore] ${label} failed after ${maxRetries} attempts`);
        if (typeof window.toast === 'function') window.toast('Save failed — check your connection', 'error', 5000);
        throw err;
      }
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}

function _track(unsub) {
  _listeners.push({ unsub });
  return unsub;
}

// ===== User / Profile =====
export async function loadUserProfile(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveUserProfile(uid, data) {
  await setDoc(userRef(uid), data, { merge: true });
}

// ===== League Membership =====
// leagues/{leagueId}/members/{uid} → { uid, role, playerId, joinedAt }
export async function loadMembership(uid) {
  if (!_leagueId) return null;
  const snap = await getDoc(membershipRef(_leagueId, uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveMembership(uid, data) {
  if (!_leagueId) return;
  await setDoc(membershipRef(_leagueId, uid), data, { merge: true });
}

// Load all members for the current league
export async function loadAllMembers() {
  if (!_leagueId) return [];
  const db = window._db;
  const col = collection(db, 'leagues', _leagueId, 'members');
  const snap = await getDocs(col);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// Find a league by its join code (cross-league query on top-level leagues collection)
export async function findLeagueByJoinCode(code) {
  if (!code) return null;
  const db = window._db;
  const q = query(collection(db, 'leagues'), where('joinCode', '==', code.trim().toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Join a league: create membership + user league index + bump memberCount
export async function joinLeague(uid, leagueId, profile) {
  const db = window._db;
  // Check if already a member
  const existing = await getDoc(doc(db, 'leagues', leagueId, 'members', uid));
  if (existing.exists()) return { alreadyMember: true, membership: existing.data() };

  // Load league name for the index doc
  const leagueSnap = await getDoc(doc(db, 'leagues', leagueId));
  const leagueName = leagueSnap.exists() ? leagueSnap.data().name : 'League';

  // Create membership
  await setDoc(doc(db, 'leagues', leagueId, 'members', uid), {
    uid,
    role: 'player',
    joinedAt: Date.now(),
    displayName: profile?.displayName || '',
    email: profile?.email || ''
  });

  // User league index
  await addUserLeagueIndex(uid, leagueId, leagueName, 'player');

  // Increment memberCount
  await updateDoc(doc(db, 'leagues', leagueId), { memberCount: increment(1) });

  return { alreadyMember: false };
}

// Remove a member from the current league
export async function removeMember(uid) {
  if (!_leagueId) return;
  const db = window._db;
  await deleteDoc(doc(db, 'leagues', _leagueId, 'members', uid));
  await updateDoc(doc(db, 'leagues', _leagueId), { memberCount: increment(-1) });
  // Also remove from user's league index
  try { await deleteDoc(doc(db, 'users', uid, 'leagues', _leagueId)); } catch(e) { /* ok */ }
}

// Regenerate the join code for the current league
export async function regenerateJoinCode() {
  if (!_leagueId) return null;
  const db = window._db;
  const newCode = _generateJoinCode();
  await updateDoc(doc(db, 'leagues', _leagueId), { joinCode: newCode });
  return newCode;
}

function _generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ===== User Leagues (index doc) =====
// users/{uid}/leagues/{leagueId} → { leagueId, name, role, lastAccess }
export async function loadUserLeagues(uid) {
  const db = window._db;
  const col = collection(db, 'users', uid, 'leagues');
  const snap = await getDocs(col);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addUserLeagueIndex(uid, leagueId, name, role) {
  const db = window._db;
  await setDoc(doc(db, 'users', uid, 'leagues', leagueId), {
    leagueId,
    name,
    role,
    lastAccess: Date.now()
  });
}

// ===== League Config =====
export async function loadLeagueConfig() {
  if (!_leagueId) return null;
  const snap = await getDoc(leagueConfigRef(_leagueId));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (data.schedule) data.schedule = expandScheduleFromFirestore(data.schedule);
  return data;
}

export async function saveLeagueConfig(data) {
  if (!_leagueId) return;
  const toWrite = { ...data };
  if (toWrite.schedule) toWrite.schedule = flattenScheduleForFirestore(toWrite.schedule);
  await setDoc(leagueConfigRef(_leagueId), toWrite, { merge: true });
}

// League metadata (top-level leagues/{leagueId} doc — name, createdBy, createdAt, etc.)
export async function saveLeagueMeta(leagueId, meta) {
  const db = window._db;
  await setDoc(doc(db, 'leagues', leagueId), meta, { merge: true });
}

export async function loadLeagueMeta(leagueId) {
  const db = window._db;
  const snap = await getDoc(doc(db, 'leagues', leagueId));
  return snap.exists() ? snap.data() : null;
}

// ===== Matches =====
export async function loadAllMatches() {
  if (!_leagueId) return [];
  const snap = await getDocs(matchesRef(_leagueId));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function loadMatch(matchKey) {
  if (!_leagueId) return null;
  const snap = await getDoc(matchRef(_leagueId, matchKey));
  return snap.exists() ? snap.data() : null;
}

export async function saveMatch(matchKey, data) {
  if (!_leagueId) return;
  await _retryWrite(() => setDoc(matchRef(_leagueId, matchKey), data, { merge: true }), 'saveMatch');
}

// Real-time listener for all matches in this league
export function listenMatches(cb) {
  if (!_leagueId) { console.warn('[Firestore] listenMatches: no active league'); return; }
  const unsub = onSnapshot(matchesRef(_leagueId), snap => {
    const matches = {};
    snap.docs.forEach(d => { matches[d.id] = d.data(); });
    cb(matches);
  }, err => {
    console.error('[Firestore] listenMatches error:', err);
    if (typeof window.toast === 'function') window.toast('Sync lost — retrying…', 'error', 4000);
  });
  return _track(unsub);
}

// ===== Player Rounds =====
// leagues/{leagueId}/playerRounds/{playerId} → { rounds: [...] }
export async function loadPlayerRounds(playerId) {
  if (!_leagueId) return [];
  const snap = await getDoc(playerRoundsRef(_leagueId, playerId));
  return snap.exists() ? (snap.data().rounds || []) : [];
}

export async function savePlayerRounds(playerId, rounds) {
  if (!_leagueId) return;
  await _retryWrite(() => setDoc(playerRoundsRef(_leagueId, playerId), { rounds }, { merge: true }), 'savePlayerRounds');
}

// Real-time listener for all playerRounds in this league
export function listenPlayerRounds(cb) {
  if (!_leagueId) { console.warn('[Firestore] listenPlayerRounds: no active league'); return; }
  const db = window._db;
  const col = collection(db, 'leagues', _leagueId, 'playerRounds');
  const unsub = onSnapshot(col, snap => {
    const data = {};
    snap.docs.forEach(d => { data[d.id] = d.data().rounds || []; });
    cb(data);
  }, err => {
    console.error('[Firestore] listenPlayerRounds error:', err);
    if (typeof window.toast === 'function') window.toast('Sync lost — retrying…', 'error', 4000);
  });
  return _track(unsub);
}

// ===== Real-time League Config Listener =====
export function listenLeagueConfig(cb) {
  if (!_leagueId) { console.warn('[Firestore] listenLeagueConfig: no active league'); return; }
  const unsub = onSnapshot(leagueConfigRef(_leagueId), snap => {
    if (!snap.exists()) { cb(null); return; }
    const data = snap.data();
    if (data.schedule) data.schedule = expandScheduleFromFirestore(data.schedule);
    cb(data);
  }, err => {
    console.error('[Firestore] listenLeagueConfig error:', err);
    if (typeof window.toast === 'function') window.toast('Sync lost — retrying…', 'error', 4000);
  });
  return _track(unsub);
}

// ===== Firestore Schedule Serialization =====
// Firestore doesn't allow nested arrays. Convert matchups from
// [[t1,t2],[t3,t4]] → [{team1:t1,team2:t2},{team1:t3,team2:t4}]
function flattenScheduleForFirestore(schedule) {
  if (!Array.isArray(schedule)) return schedule;
  return schedule.map(week => ({
    ...week,
    matchups: (week.matchups || []).map(m =>
      Array.isArray(m) ? { team1: m[0], team2: m[1] } : m
    )
  }));
}

// Reverse: convert matchup objects back to arrays for app code
function expandScheduleFromFirestore(schedule) {
  if (!Array.isArray(schedule)) return schedule;
  return schedule.map(week => ({
    ...week,
    matchups: (week.matchups || []).map(m =>
      Array.isArray(m) ? m : [m.team1, m.team2]
    )
  }));
}

// ===== League Creation =====
// Called by the wizard when user completes setup.
// Creates all the docs for a brand-new league.
export async function createLeague({ uid, name, config, teams }) {
  const db = window._db;

  // Generate leagueId from name + timestamp
  const slug   = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
  const leagueId = `${slug}-${Date.now()}`;

  // Top-level league doc (with join code for inviting players)
  const joinCode = _generateJoinCode();
  await setDoc(doc(db, 'leagues', leagueId), {
    name,
    joinCode,
    createdBy: uid,
    createdAt: Date.now(),
    memberCount: 1
  });

  // Config/settings — flatten schedule matchups to avoid Firestore nested-array error
  const configToWrite = {
    ...config,
    schedule: flattenScheduleForFirestore(config?.schedule || []),
    teams,
    createdAt: Date.now()
  };
  await setDoc(doc(db, 'leagues', leagueId, 'config', 'settings'), configToWrite);

  // Commissioner membership
  await setDoc(doc(db, 'leagues', leagueId, 'members', uid), {
    uid,
    role: 'commissioner',
    joinedAt: Date.now()
  });

  // Index on user
  await addUserLeagueIndex(uid, leagueId, name, 'commissioner');

  // Seed match docs from the schedule — one doc per matchup per week.
  // config.schedule = [{ week, date, nine, matchups: [[t1id, t2id], ...] }]
  // Match key format: w{week}_m{matchIdx}
  const schedule = config?.schedule || [];
  const allTeams = teams || [];
  for (const weekEntry of schedule) {
    const matchups = weekEntry.matchups || [];
    for (let mi = 0; mi < matchups.length; mi++) {
      const [t1id, t2id] = matchups[mi];
      const t1 = allTeams.find(t => t.id === t1id);
      const t2 = allTeams.find(t => t.id === t2id);
      const matchKey = `w${weekEntry.week}_m${mi}`;
      await setDoc(doc(db, 'leagues', leagueId, 'matches', matchKey), {
        week:      weekEntry.week,
        date:      weekEntry.date  || '',
        nine:      weekEntry.nine  || 'front',
        time:      weekEntry.time  || '',
        team1Id:   t1id,
        team2Id:   t2id,
        team1Name: t1?.name || t1id,
        team2Name: t2?.name || t2id,
        status:    'draft',
        scores:    {},
        result:    null,
        createdAt: Date.now()
      });
    }
  }

  // Seed playerRounds from CSV-imported history (hcpHistory).
  // config.hcpHistory = [{ name, displayName, scores: [{date, grossScore}] }]
  // Match players by name (case-insensitive) against all players in teams.
  const hcpHistory = config?.hcpHistory || [];
  if (hcpHistory.length > 0) {
    // Build a flat lookup: normalized name → playerId
    const nameToId = {};
    for (const team of (teams || [])) {
      for (const player of (team.players || [])) {
        const norm = player.name.trim().toLowerCase();
        nameToId[norm] = player.id;
        // Also index "Last, First" style if the name looks like "First Last"
        const parts = player.name.trim().split(/\s+/);
        if (parts.length >= 2) {
          const lastFirst = `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`.toLowerCase();
          nameToId[lastFirst] = player.id;
        }
      }
    }

    for (const entry of hcpHistory) {
      if (!entry.scores?.length) continue;

      // Try matching by displayName ("First Last") and raw name ("Last, First")
      const playerId =
        nameToId[entry.displayName?.trim().toLowerCase()] ||
        nameToId[entry.name?.trim().toLowerCase()];

      if (!playerId) continue; // player not in this league's teams — skip

      const rounds = entry.scores.map(({ date, grossScore }) => ({
        grossScore,
        score: grossScore,
        date,
        source: 'history'
      }));
      await setDoc(doc(db, 'leagues', leagueId, 'playerRounds', playerId), { rounds });
    }
  }

  // Seed playerRounds with any manually-entered handicap history from the wizard.
  // config.handicap.manualScores = [{ playerId, scores: [grossScore, ...] }]
  // Scores are oldest-first; we assign fake dates going back in weekly increments.
  const manualScores = config?.handicap?.manualScores || [];
  if (manualScores.length > 0) {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    for (const entry of manualScores) {
      if (!entry.playerId || !entry.scores?.length) continue;
      const rounds = entry.scores.map((grossScore, i) => ({
        grossScore,
        score: grossScore,
        date: new Date(now - (entry.scores.length - i) * oneWeek).toISOString().slice(0, 10),
        source: 'seed'
      }));
      await setDoc(doc(db, 'leagues', leagueId, 'playerRounds', entry.playerId), { rounds });
    }
  }

  return leagueId;
}

// ===== Delete Match =====
export async function deleteMatch(matchKey) {
  if (!_leagueId) return;
  const db = window._db;
  await deleteDoc(doc(db, 'leagues', _leagueId, 'matches', matchKey));
}

// ===== Create Match Docs =====
// Reusable: creates match docs for a weekEntry (regular or custom round).
// weekEntry = { week, date, nine, time?, matchups: [[t1id, t2id], ...] }
// teams = full teams array from config
export async function createMatchDocs(weekEntry, teams) {
  if (!_leagueId) return;
  const db = window._db;
  const allTeams = teams || [];
  const matchups = weekEntry.matchups || [];
  for (let mi = 0; mi < matchups.length; mi++) {
    const [t1id, t2id] = matchups[mi];
    const t1 = allTeams.find(t => t.id === t1id);
    const t2 = allTeams.find(t => t.id === t2id);
    const matchKey = `w${weekEntry.week}_m${mi}`;
    await setDoc(doc(db, 'leagues', _leagueId, 'matches', matchKey), {
      week:      weekEntry.week,
      date:      weekEntry.date  || '',
      nine:      weekEntry.nine  || 'front',
      time:      weekEntry.time  || '',
      team1Id:   t1id,
      team2Id:   t2id,
      team1Name: t1?.name || t1id,
      team2Name: t2?.name || t2id,
      status:    'draft',
      scores:    {},
      result:    null,
      isCustom:  weekEntry.isCustom || false,
      customLabel: weekEntry.label || '',
      createdAt: Date.now()
    });
  }
}

// ===== Player Photo Upload =====
export async function uploadPlayerPhoto(playerId, file) {
  if (!_leagueId) return null;
  const { storageRef, uploadBytes, getDownloadURL } = window._FB;
  const ref = storageRef(`leagues/${_leagueId}/players/${playerId}.jpg`);
  await uploadBytes(ref, file);
  return await getDownloadURL(ref);
}

// ===== Season Rollover =====
// Archives current playerRounds into config.scoreHistory, deletes all matches, clears schedule fields.
export async function archiveAndRollover(seasonYear) {
  if (!_leagueId) return;
  const db = window._db;

  // 1. Load all playerRounds
  const prCol = collection(db, 'leagues', _leagueId, 'playerRounds');
  const prSnap = await getDocs(prCol);

  // 2. Load current config to get existing scoreHistory
  const configSnap = await getDoc(leagueConfigRef(_leagueId));
  const config = configSnap.exists() ? configSnap.data() : {};
  const scoreHistory = config.scoreHistory || {};

  // 3. Merge current rounds into scoreHistory
  prSnap.docs.forEach(d => {
    const playerId = d.id;
    const rounds = d.data().rounds || [];
    const existing = scoreHistory[playerId] || [];
    const tagged = rounds.map(r => ({ ...r, season: seasonYear || new Date().getFullYear() }));
    scoreHistory[playerId] = [...existing, ...tagged];
  });

  // 4. Save scoreHistory to config
  await setDoc(leagueConfigRef(_leagueId), { scoreHistory }, { merge: true });

  // 5. Delete all playerRounds docs
  for (const d of prSnap.docs) {
    await deleteDoc(doc(db, 'leagues', _leagueId, 'playerRounds', d.id));
  }

  // 6. Delete all match docs
  const matchSnap = await getDocs(collection(db, 'leagues', _leagueId, 'matches'));
  for (const d of matchSnap.docs) {
    await deleteDoc(doc(db, 'leagues', _leagueId, 'matches', d.id));
  }

  // 7. Clear schedule-related config fields (preserve teams, handicap, format, course, etc.)
  await setDoc(leagueConfigRef(_leagueId), {
    schedule: [],
    weekTeeTimes: {},
    cancelledWeeks: {},
    customRounds: [],
    hcpExcludedWeeks: []
  }, { merge: true });

  return scoreHistory;
}

// ===== Hard Reset =====
export async function hardReset() {
  if (!_leagueId) return;
  const db = window._db;

  // Delete all match docs
  const matchSnap = await getDocs(collection(db, 'leagues', _leagueId, 'matches'));
  for (const d of matchSnap.docs) {
    await deleteDoc(doc(db, 'leagues', _leagueId, 'matches', d.id));
  }

  // Delete all playerRounds docs
  const prSnap = await getDocs(collection(db, 'leagues', _leagueId, 'playerRounds'));
  for (const d of prSnap.docs) {
    await deleteDoc(doc(db, 'leagues', _leagueId, 'playerRounds', d.id));
  }

  // Clear config fields
  await setDoc(leagueConfigRef(_leagueId), {
    schedule: [],
    weekTeeTimes: {},
    cancelledWeeks: {},
    customRounds: [],
    hcpExcludedWeeks: [],
    scoreHistory: {},
    manualAdj: {}
  }, { merge: true });
}

// ===== Delete League =====
export async function deleteLeague() {
  if (!_leagueId) return;
  const db = window._db;
  const id = _leagueId;

  // 1. Get all members first (need UIDs to clean user league indices)
  const membersSnap = await getDocs(collection(db, 'leagues', id, 'members'));

  // 2. Delete all subcollection docs
  for (const sub of ['matches', 'playerRounds', 'members']) {
    const snap = await getDocs(collection(db, 'leagues', id, sub));
    for (const d of snap.docs) await deleteDoc(d.ref);
  }

  // 3. Delete config doc
  try { await deleteDoc(leagueConfigRef(id)); } catch(e) { /* may not exist */ }

  // 4. Delete each member's user league index
  for (const m of membersSnap.docs) {
    const uid = m.data().uid || m.id;
    try { await deleteDoc(doc(db, 'users', uid, 'leagues', id)); } catch(e) { /* ok */ }
  }

  // 5. Delete top-level league doc
  await deleteDoc(leagueRef(id));

  // 6. Tear down listeners and clear state
  _teardownListeners();
  _leagueId = null;
  window._leagueId = null;
}

// ===== Import League Data =====
export async function importLeagueData(json) {
  if (!_leagueId) return;
  const db = window._db;

  // Validate structure
  if (!json || typeof json !== 'object') throw new Error('Invalid JSON structure');

  // Import config
  if (json.config) {
    await setDoc(leagueConfigRef(_leagueId), json.config, { merge: true });
  }

  // Import matches
  if (json.matches) {
    for (const [key, data] of Object.entries(json.matches)) {
      await setDoc(doc(db, 'leagues', _leagueId, 'matches', key), data);
    }
  }

  // Import rounds
  if (json.rounds) {
    for (const [playerId, rounds] of Object.entries(json.rounds)) {
      await setDoc(doc(db, 'leagues', _leagueId, 'playerRounds', playerId), { rounds });
    }
  }
}

// ===== Score Approval Flow =====
export async function submitScores(matchKey, scores, submittedByTeam) {
  await saveMatch(matchKey, {
    scores,
    status: 'pending',
    submittedByTeam: submittedByTeam || null,
    submittedAt: Date.now(),
    submittedBy: window._auth?.currentUser?.uid || null
  });
}

export async function approveScores(matchKey, result) {
  await saveMatch(matchKey, {
    status: 'committed',
    result: result || null,
    approvedAt: Date.now(),
    approvedBy: window._auth?.currentUser?.uid || null
  });
}

export async function rejectScores(matchKey) {
  await saveMatch(matchKey, {
    status: 'draft',
    rejectedAt: Date.now(),
    rejectedBy: window._auth?.currentUser?.uid || null
  });
}

export async function disputeScores(matchKey, note) {
  if (!_leagueId) return;
  const db = window._db;
  const ref = doc(db, 'leagues', _leagueId, 'matches', matchKey);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};

  const history = data.disputeHistory || [];
  history.push({
    note: note || '',
    by: window._auth?.currentUser?.uid || null,
    at: Date.now()
  });

  // First dispute → 'disputed'; second → 'escalated'
  const newStatus = data.status === 'disputed' ? 'escalated' : 'disputed';

  await saveMatch(matchKey, {
    status: newStatus,
    disputeHistory: history,
    lastDisputedAt: Date.now(),
    lastDisputedBy: window._auth?.currentUser?.uid || null
  });
}

export async function forceCommitMatch(matchKey, result) {
  await saveMatch(matchKey, {
    status: 'committed',
    result: result || null,
    forceCommitted: true,
    forceCommittedAt: Date.now(),
    forceCommittedBy: window._auth?.currentUser?.uid || null
  });
}

export async function unlockMatch(matchKey) {
  await saveMatch(matchKey, {
    status: 'draft',
    unlockedAt: Date.now(),
    unlockedBy: window._auth?.currentUser?.uid || null
  });
}
