// ===== Golf League App — app.js =====
// Multi-tenant SaaS golf league management.
// All state is keyed by leagueId. No hardcoded teams/courses/dates.

'use strict';

// ===== Global App State =====
const APP = {
  user:      null,   // Firebase Auth user
  member:    null,   // { role, playerId } for current league
  leagueId:  null,
  config:    null,   // league settings doc
  matches:   {},     // matchKey → match doc
  rounds:    {},     // playerId → rounds[]
  view:      null,   // current view id
  wizard:    { step: 1, data: {} }
};

const VIEWS = ['splash', 'signin', 'signup', 'wizard', 'league-select', 'app'];
const TABS  = ['dashboard', 'scores', 'standings', 'handicaps', 'skins', 'stats', 'schedule',
               'recap', 'rules', 'history',
               'admin-members', 'admin-scores', 'admin-teams', 'admin-settings'];

// ===== View Router =====
// Accepts either 'splash' or 'view-splash' — normalizes either way
function showView(id) {
  // Strip leading 'view-' if passed accidentally
  const bare = id.startsWith('view-') ? id.slice(5) : id;
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('active', v === bare);
  });
  APP.view = bare;
}

// ===== Tab Router =====
function navTo(tab) {
  TABS.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// ===== Toast =====
function toast(msg, type = 'default', ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, ms);
}

// ===== Toggle Button Groups =====
// Sets the active state on a group of buttons and updates a hidden input.
function setToggle(groupEl, value) {
  if (typeof groupEl === 'string') groupEl = document.getElementById(groupEl);
  if (!groupEl) return;
  groupEl.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === String(value));
  });
  const input = groupEl.nextElementSibling;
  if (input && input.type === 'hidden') input.value = value;
  // Refresh pts preview when HI/LO toggle changes
  if (groupEl.id === 'tg-hilo') updatePtsPreview();
}

function initToggleGroups() {
  document.querySelectorAll('.toggle-group').forEach(group => {
    group.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => setToggle(group, btn.dataset.value));
    });
  });
}

// ===== Tab Groups (wizard course entry tabs) =====
function initTabGroups() {
  document.querySelectorAll('.tab-group').forEach(group => {
    group.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        group.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        // find sibling tab-contents
        const parent = group.parentElement;
        parent.querySelectorAll('.tab-content').forEach(tc => {
          tc.classList.toggle('active', tc.dataset.tab === target);
        });
      });
    });
  });
}

// ===== Wizard =====
const WIZARD_STEPS = 6;

function wizardNext() {
  if (!wizardValidate(APP.wizard.step)) return;
  wizardCollect(APP.wizard.step);
  if (APP.wizard.step < WIZARD_STEPS) {
    APP.wizard.step++;
    _renderWizardStep();
  } else {
    wizardFinish();
  }
}

function wizardBack() {
  if (APP.wizard.step > 1) {
    APP.wizard.step--;
    _renderWizardStep();
  }
}

function _renderWizardStep() {
  const s = APP.wizard.step;
  document.querySelectorAll('.wizard-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === s);
  });
  // dots
  document.querySelectorAll('.wizard-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 < s)  dot.classList.add('done');
    if (i + 1 === s) dot.classList.add('active');
  });
  // next/finish button
  const nextBtn = document.getElementById('wizard-next-btn');
  if (nextBtn) nextBtn.textContent = s === WIZARD_STEPS ? 'Create League' : 'Next →';
  // Step label
  const label = document.getElementById('wizard-step-label');
  if (label) label.textContent = `Step ${s} of ${WIZARD_STEPS}`;
  // scroll top
  const body = document.querySelector('.wizard-body');
  if (body) body.scrollTop = 0;
  // Step-specific renders
  if (s === 2) setTimeout(_autoCreateTeams, 10);
  if (s === 4) setTimeout(() => { renderFormatPicker(); updatePtsPreview(); }, 10);
  if (s === 5) {
    setTimeout(() => {
      // Re-attach hcp system toggle handler and init visibility
      const hcpGroup = document.getElementById('tg-hcpsys');
      if (hcpGroup) {
        hcpGroup.querySelectorAll('.toggle-btn').forEach(btn => {
          btn.addEventListener('click', () => toggleHcpSystemSettings(btn.dataset.value));
        });
      }
      // Init visibility based on current selection
      const currentSys = document.getElementById('wz-hcp-sys-val')?.value || 'custom';
      toggleHcpSystemSettings(currentSys);
    }, 10);
  }
  if (s === 6) {
    setTimeout(() => {
      renderScheduleWeeks();
      // Auto-generate round-robin matchups so createLeague() has data
      const d = APP.wizard.data;
      if (d.teams?.length >= 2) {
        const weeks = document.querySelectorAll('.schedule-week').length || 18;
        const sched = generateSchedule(d.teams, weeks, d.seasonStart, d.dayOfWeek);
        d.schedule = sched;
      }
    }, 10);
  }
}

function wizardValidate(step) {
  if (step === 1) {
    const name = document.getElementById('wz-league-name')?.value?.trim();
    if (!name) { toast('Enter a league name', 'error'); return false; }
  }
  if (step === 2) {                           // Teams & Players
    const teamRows = document.querySelectorAll('.team-row');
    if (!teamRows.length) { toast('Add at least one team before continuing', 'error'); return false; }
    // Check that every team has at least one player with a name
    let hasPlayers = false;
    teamRows.forEach(row => {
      if (row.querySelectorAll('.player-row .player-name-inp').length > 0) hasPlayers = true;
    });
    if (!hasPlayers) { toast('Add players to your teams before continuing', 'error'); return false; }
  }
  if (step === 3) {                           // Course Setup (now step 3)
    const courseName = document.getElementById('wz-course-name')?.value?.trim();
    if (!courseName) { toast('Enter a course name', 'error'); return false; }
    const frontTable = document.getElementById('scorecard-front');
    if (!frontTable) { toast('Scorecard not loaded — try refreshing', 'error'); return false; }
  }
  return true;
}

function wizardCollect(step) {
  const d = APP.wizard.data;
  if (step === 1) {
    d.leagueName     = document.getElementById('wz-league-name')?.value?.trim() || '';
    d.playersPerTeam = parseInt(document.getElementById('wz-players-per-team-val')?.value || '2');
    d.nines          = document.getElementById('wz-nines-val')?.value || '9';
    d.seasonStart    = document.getElementById('wz-season-start')?.value || '';
    d.seasonEnd      = document.getElementById('wz-season-end')?.value || '';
    d.dayOfWeek      = document.getElementById('wz-day-val')?.value || 'Monday';
    d.teeTime        = document.getElementById('wz-tee-time')?.value || '';
    d.teeInterval    = parseInt(document.getElementById('wz-tee-interval')?.value || '10');
    d.totalPlayers   = parseInt(document.getElementById('wz-total-players')?.value || '0') || 0;
  }
  if (step === 2) {                           // Teams & Players
    d.teams = collectTeams();
  }
  if (step === 3) {                           // Course Setup
    d.courseName   = document.getElementById('wz-course-name')?.value?.trim() || '';
    d.courseCity   = document.getElementById('wz-course-city')?.value?.trim() || '';
    d.tees         = document.getElementById('wz-tees')?.value?.trim() || '';
    d.scorecard    = collectScorecardGrid();
  }
  if (step === 4) {                           // League Format
    d.format           = document.getElementById('wz-format-val')?.value || 'match_play';
    d.hiLoSplit        = document.getElementById('wz-hilo-val')?.value === 'yes';
    d.absentRule          = document.getElementById('wz-absent-rule')?.value || 'blind_avg';
    d.absentFixedScore    = parseInt(document.getElementById('wz-absent-fixed-score')?.value || '0') || null;
    d.absentWorstLookback = parseInt(document.getElementById('wz-absent-worst-lookback')?.value || '4') || 4;
    d.skinsEnabled     = document.getElementById('wz-skins-val')?.value === 'yes';
    d.skinsType        = document.getElementById('wz-skins-type-val')?.value || 'gross';
    d.skinsBuyIn       = parseFloat(document.getElementById('wz-skins-buyin')?.value || '0');
    d.weeklyBuyIn      = parseFloat(document.getElementById('wz-weekly-buyin')?.value || '0');
    // Point values
    d.ptsHole    = parseFloat(document.getElementById('wz-pts-hole')?.value    ?? 1);
    d.ptsLowNet  = parseFloat(document.getElementById('wz-pts-lownet')?.value  ?? 1);
    d.ptsTeamNet = parseFloat(document.getElementById('wz-pts-teamnet')?.value ?? 0);
    d.ptsBirdie  = parseFloat(document.getElementById('wz-pts-birdie')?.value  ?? 0);
    d.ptsEagle   = parseFloat(document.getElementById('wz-pts-eagle')?.value   ?? 0);
  }
  if (step === 5) {                           // Handicap Settings
    d.hcpSystem        = document.getElementById('wz-hcp-sys-val')?.value || 'custom';
    d.hcpRounds        = parseInt(document.getElementById('wz-hcp-rounds-val')?.value || '5');
    d.hcpDrop          = document.getElementById('wz-hcp-drop-val')?.value || 'none';
    d.hcpFactor        = parseFloat(document.getElementById('wz-hcp-factor')?.value || '0.9');
    d.hcpMax           = parseInt(document.getElementById('wz-hcp-max')?.value || '18');
    d.hcpHistory       = APP.wizard._importedHistory || [];
  }
  if (step === 6) {
    d.scheduleType = document.getElementById('wz-sched-type-val')?.value || 'auto';
    d.playoffs     = parseInt(document.getElementById('wz-playoffs-val')?.value || '0');
    d.schedule     = collectSchedule();
  }
}

function collectScorecardGrid() {
  const scorecard = { front: null, back: null };
  ['front', 'back'].forEach(side => {
    const table = document.getElementById(`scorecard-${side}`);
    if (!table) return;
    const holes = [];
    for (let h = 1; h <= 9; h++) {
      holes.push({
        hole:   h,
        par:    parseInt(table.querySelector(`input[data-side="${side}"][data-row="par"][data-hole="${h}"]`)?.value || '4'),
        hdcp:   parseInt(table.querySelector(`input[data-side="${side}"][data-row="hdcp"][data-hole="${h}"]`)?.value || '0'),
        yards:  parseInt(table.querySelector(`input[data-side="${side}"][data-row="yards"][data-hole="${h}"]`)?.value || '0')
      });
    }
    scorecard[side] = holes;
  });
  return scorecard;
}

function collectTeams() {
  const teamRows = document.querySelectorAll('.team-row');
  return Array.from(teamRows).map((row, ti) => {
    const name = row.querySelector('.team-name-input')?.value?.trim() || `Team ${ti + 1}`;
    const playerRows = row.querySelectorAll('.player-row');
    const players = Array.from(playerRows).map((prow, pi) => {
      const nameInp = prow.querySelector('.player-name-inp');
      const hcpInp  = prow.querySelector('.player-hcp-inp');
      const hiloBtn = prow.querySelector('.player-hilo');
      const nm = nameInp?.value?.trim() || '';
      if (!nm) return null;
      return {
        id:          `t${ti + 1}p${pi + 1}`,
        name:        nm,
        hilo:        hiloBtn?.dataset.hilo || null,
        seedHcp:     parseFloat(hcpInp?.dataset.preciseHcp || hcpInp?.value || '') || null
      };
    }).filter(Boolean);
    return { id: `t${ti + 1}`, name, players };
  });
}

function collectSchedule() {
  // Merge UI edits (date/time/nine) back into existing schedule entries so
  // matchups generated by generateSchedule() are preserved.
  const existing = APP.wizard.data.schedule || [];
  const weekEls = document.querySelectorAll('.schedule-week');
  return Array.from(weekEls).map((el, i) => ({
    ...(existing[i] || {}),           // preserve matchups + any other fields
    week:  i + 1,
    date:  el.querySelector('input[type="date"]')?.value || '',
    time:  el.querySelector('input[type="time"]')?.value || '',
    nine:  el.querySelector('.nine-toggle button.active')?.dataset.nine || 'front'
  }));
}

// ===== Unified Config Accessors =====
// Wizard saves pointValues/absentRule at top-level; admin settings may save under format.*.
// These helpers check both paths so scoring always finds the right values.
function _getPV(config) {
  const pv = config?.pointValues || config?.format?.pointValues || {};
  return { hole: pv.hole ?? 1, lowNet: pv.lowNet ?? 1, match: pv.match ?? 0,
           birdie: pv.birdie ?? 0, eagle: pv.eagle ?? 0, teamNet: pv.teamNet ?? 0 };
}
function _getAbsentRule(config) {
  return config?.absentRule || config?.format?.absentRule || 'blind_avg';
}
function _isPlayoffWeek(weekNum) {
  const map = APP.config.playoffWeekMap;
  if (map && map[weekNum] !== undefined) return !!map[weekNum];
  // Fallback: auto-calculation based on playoffWeeks config
  const sched = APP.config.schedule || [];
  const pw = APP.config.playoffWeeks || 3;
  const start = sched.length >= 10 ? (sched.length - pw + 1) : 999;
  return weekNum >= start;
}

// Remove undefined/NaN/null from an object recursively so Firestore doesn't reject it
function sanitizeForFirestore(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore).filter(v => v !== undefined);
  if (obj !== null && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const sv = sanitizeForFirestore(v);
      if (sv !== undefined && sv !== null && !(typeof sv === 'number' && isNaN(sv))) {
        out[k] = sv;
      }
    }
    return out;
  }
  if (typeof obj === 'number' && isNaN(obj)) return undefined;
  return obj;
}

async function wizardFinish() {
  wizardCollect(WIZARD_STEPS);
  const d = APP.wizard.data;

  const btn = document.getElementById('wizard-next-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    const raw = {
      leagueName:    d.leagueName   || 'My League',
      playersPerTeam: d.playersPerTeam || 2,
      nines:         d.nines        || '9',
      seasonStart:   d.seasonStart  || '',
      seasonEnd:     d.seasonEnd    || '',
      dayOfWeek:     d.dayOfWeek    || 'Monday',
      teeTime:       d.teeTime      || '16:00',
      teeInterval:   d.teeInterval  || 10,
      totalPlayers:  d.totalPlayers || 0,
      course: {
        name:      d.courseName || '',
        city:      d.courseCity || '',
        tees:      d.tees       || '',
        scorecard: d.scorecard  || {}
      },
      format:          d.format          || 'match_play',
      hiLoSplit:     d.hiLoSplit    ?? true,
      pointValues: {
        hole:    d.ptsHole    ?? 1,
        lowNet:  d.ptsLowNet  ?? 1,
        teamNet: d.ptsTeamNet ?? 0,
        birdie:  d.ptsBirdie  ?? 0,
        eagle:   d.ptsEagle   ?? 0,
      },
      absentRule:           d.absentRule          || 'blind_avg',
      absentFixedScore:     d.absentFixedScore    || null,
      absentWorstLookback:  d.absentWorstLookback ?? 4,
      skinsEnabled:  d.skinsEnabled ?? true,
      skinsType:     d.skinsType    || 'gross',
      skinsBuyIn:    d.skinsBuyIn   || 0,
      weeklyBuyIn:   d.weeklyBuyIn  || 0,
      handicap: {
        system:       d.hcpSystem       || 'custom',
        rounds:       d.hcpRounds       || 5,
        drop:         d.hcpDrop         || 'none',
        factor:       d.hcpFactor       ?? 0.9,
        max:          d.hcpMax          || 18,
      },
      scheduleType: d.scheduleType || 'auto',
      playoffs:     d.playoffs     || 0,
      schedule:     d.schedule     || [],
      hcpHistory:   d.hcpHistory   || []
    };

    const config = sanitizeForFirestore(raw);
    const teams  = sanitizeForFirestore(d.teams || []);

    const { createLeague } = window._FB;
    const uid = APP.user?.uid || window._currentUser?.uid;
    if (!uid) { toast('Not signed in', 'error'); return; }

    const leagueId = await createLeague({
      uid,
      name:   config.leagueName,
      config,
      teams
    });

    toast(`${config.leagueName} created! 🎉`, 'success');
    await loadLeague(leagueId);

  } catch (err) {
    console.error('[wizardFinish]', err);
    toast(`Error: ${err.message || 'check console'}`, 'error');
    if (btn) { btn.textContent = 'Create League'; btn.disabled = false; }
  }
}

// ===== Schedule Generator (Berger round-robin) =====
function generateSchedule(teams, weeks, startDate, dayOfWeek) {
  const n = teams.length % 2 === 0 ? teams.length : teams.length + 1;
  const rounds = [];
  const arr = Array.from({ length: n }, (_, i) => i);

  for (let r = 0; r < n - 1; r++) {
    const pairings = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a < teams.length && b < teams.length) {
        pairings.push([teams[a].id, teams[b].id]);
      }
    }
    rounds.push(pairings);
    // rotate: keep arr[0] fixed, rotate the rest
    arr.splice(1, 0, arr.pop());
  }

  // Map rounds to dates — parse as local date to avoid timezone shift
  const schedule = [];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function _parseDateLocal(str) {
    if (!str) return new Date();
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function _formatDateLocal(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let date = _parseDateLocal(startDate);
  // Advance to the correct day of week
  const targetDay = dayNames.indexOf(dayOfWeek);
  if (targetDay >= 0) {
    while (date.getDay() !== targetDay) date.setDate(date.getDate() + 1);
  }

  for (let w = 0; w < weeks && w < rounds.length; w++) {
    schedule.push({
      week:     w + 1,
      date:     _formatDateLocal(date),
      matchups: rounds[w]
    });
    date = new Date(date);
    date.setDate(date.getDate() + 7);
  }

  return schedule;
}

// ===== Scorecard Grid Renderer =====
// Renders an editable 3-row × 9-col scorecard table inside a container.
function renderScorecardGrid(containerId, side, prefill = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const rows = ['yards', 'par', 'hdcp'];
  const labels = { yards: 'Yards', par: 'Par', hdcp: 'Hdcp' };
  const defaults = { yards: 350, par: 4, hdcp: 0 };

  let html = `<div class="scorecard-grid"><table id="scorecard-${side}">
    <thead><tr><th>Hole</th>`;
  for (let h = 1; h <= 9; h++) html += `<th>${h}</th>`;
  html += `<th>Total</th></tr></thead><tbody>`;

  rows.forEach(row => {
    html += `<tr><td>${labels[row]}</td>`;
    for (let h = 1; h <= 9; h++) {
      const val = prefill?.[h - 1]?.[row] ?? defaults[row];
      html += `<td><input type="number" data-side="${side}" data-row="${row}" data-hole="${h}" value="${val}" min="0" max="${row === 'par' ? 9 : 9999}"></td>`;
    }
    html += `<td class="total" id="sc-${side}-${row}-total">–</td></tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  // Attach live total calculation
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => _updateScorecardTotals(side));
  });
  _updateScorecardTotals(side);
}

function _updateScorecardTotals(side) {
  ['yards', 'par'].forEach(row => {
    const inputs = document.querySelectorAll(`input[data-side="${side}"][data-row="${row}"]`);
    const sum = Array.from(inputs).reduce((acc, inp) => acc + (parseInt(inp.value) || 0), 0);
    const el = document.getElementById(`sc-${side}-${row}-total`);
    if (el) el.textContent = sum || '–';
  });
}

// ===== OCR Upload =====
function initOCRUpload() {
  const fileInput = document.getElementById('scorecard-file');
  const zone      = document.getElementById('upload-zone');
  if (!fileInput || !zone) return;

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleScorecardFile(file);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleScorecardFile(file);
  });
}

async function handleScorecardFile(file) {
  const preview = document.getElementById('upload-preview');
  const status  = document.getElementById('ocr-status');
  const img     = document.getElementById('upload-preview-img');

  // Show image preview
  const url = URL.createObjectURL(file);
  if (img)     { img.src = url; }
  if (preview) preview.classList.add('visible');

  // Show loading status
  if (status) {
    status.className = 'ocr-status visible loading';
    status.innerHTML = '<span class="spinner"></span> Reading scorecard…';
  }

  try {
    const base64 = await fileToBase64(file);
    const result = await callOCR(base64, file.type);
    applyOCRResult(result);
    if (status) {
      status.className = 'ocr-status visible success';
      status.textContent = '✓ Scorecard read — review and edit below';
    }
    // Switch to manual tab so user can review/edit
    const manualTabBtn = document.querySelector('.tab-btn[data-tab="manual"]');
    if (manualTabBtn) manualTabBtn.click();
  } catch (err) {
    console.error('[OCR]', err);
    if (status) {
      status.className = 'ocr-status visible error';
      status.textContent = err.message?.includes('No API key')
        ? 'Photo reading not configured — switching to manual entry'
        : 'Could not read scorecard — please enter manually';
    }
    // Auto-switch to manual tab on any failure
    setTimeout(() => {
      const manualTabBtn = document.querySelector('.tab-btn[data-tab="manual"]');
      if (manualTabBtn) manualTabBtn.click();
    }, 1500);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Calls Anthropic Claude Vision API directly to parse scorecard image
async function callOCR(base64, mimeType) {
  const apiKey = window._anthropicKey; // Set via admin settings or env
  if (!apiKey) throw new Error('No API key configured');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            apiKey,
      'anthropic-version':    '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        }, {
          type: 'text',
          text: 'This is a golf scorecard. Extract the hole data and return ONLY valid JSON in this exact format: {"front":[{"hole":1,"par":4,"hdcp":1,"yards":350},...9 holes],"back":[{"hole":10,"par":4,"hdcp":2,"yards":380},...9 holes]}. If only 9 holes visible, return only front. Numbers only, no nulls.'
        }]
      }]
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`API error: ${resp.status} ${err}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text || '';
  // Extract JSON from response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

function applyOCRResult(result) {
  if (result.front) renderScorecardGrid('scorecard-front-container', 'front', result.front);
  if (result.back)  renderScorecardGrid('scorecard-back-container',  'back',  result.back);
}

// ===== Teams Builder =====
let _teamCount = 0;

// Auto-create the right number of empty teams based on pool size and players-per-team
function _autoCreateTeams() {
  const container = document.getElementById('teams-container');
  if (!container) return;
  const existingTeams = container.querySelectorAll('.team-row').length;
  if (existingTeams > 0) return; // don't overwrite if teams already exist (e.g. navigating back)

  const ppt = parseInt(document.getElementById('wz-players-per-team-val')?.value || '2');
  const poolSize = _pool.length;
  if (poolSize === 0) return; // no players, no auto-create

  const needed = Math.ceil(poolSize / ppt);
  for (let i = 0; i < needed; i++) {
    addTeam();
  }
}

function addTeam(name = '') {
  _teamCount++;
  const container = document.getElementById('teams-container');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'team-row';
  div.dataset.teamIdx = _teamCount;

  // Make the player-rows div a drop target
  div.innerHTML = `
    <div class="team-row-header">
      <input class="team-name-input" type="text" placeholder="Team name" value="${name}">
      <button class="btn-icon" onclick="removeTeam(this)" title="Remove team">✕</button>
    </div>
    <div class="player-rows team-drop-zone"
      ondragover="event.preventDefault()"
      ondrop="dropOnTeam(event,this.closest('.team-row'))"
      ondragenter="this.classList.add('drag-over')"
      ondragleave="this.classList.remove('drag-over')">
      <div class="team-drop-hint">Drop players here</div>
    </div>
    <button class="btn-icon add mt-8" onclick="addPlayerToTeam(this)" style="font-size:13px;color:var(--mt)">+ Add player</button>
  `;
  container.appendChild(div);
}

function buildPlayerRow(teamIdx, playerIdx, name = '', hilo = null, hcp = '') {
  return `
    <div class="player-row">
      <input class="player-name-inp" type="text" placeholder="Player name" value="${name}">
      <input class="player-hcp-inp" type="number" placeholder="Hcp" value="${hcp}" min="0" max="54" step="0.5" style="width:60px;text-align:center" title="Starting handicap (optional)" />
      ${hilo ? `<button class="player-hilo ${hilo.toLowerCase()}" data-hilo="${hilo}" onclick="toggleHiLo(this)">${hilo}</button>` : ''}
      <button class="btn-icon" onclick="removePlayer(this)">✕</button>
    </div>
  `;
}

function removeTeam(btn) {
  btn.closest('.team-row').remove();
}

function addPlayerToTeam(btn) {
  const playerRows = btn.previousElementSibling;
  const existingCount = playerRows.querySelectorAll('.player-row').length;
  const ppt = parseInt(document.getElementById('wz-players-per-team-val')?.value || '2');
  const hiloOptions = ['LO', 'HI', null, null];
  const hilo = ppt >= 2 ? (hiloOptions[existingCount] || null) : null;

  const div = document.createElement('div');
  div.className = 'player-row';
  div.draggable = true;
  div.innerHTML = `
    <input class="player-name-inp" type="text" placeholder="Player name">
    <input class="player-hcp-inp" type="number" placeholder="Hcp" min="0" max="54" step="0.5" style="width:60px;text-align:center" title="Starting handicap (optional)" />
    ${hilo ? `<button class="player-hilo ${hilo.toLowerCase()}" data-hilo="${hilo}" onclick="toggleHiLo(this)">${hilo}</button>` : ''}
    <button class="btn-icon" onclick="removePlayer(this)">✕</button>
  `;
  // Make it draggable to other teams
  div.addEventListener('dragstart', e => {
    const nameInp = div.querySelector('.player-name-inp');
    const id = div.dataset.poolId || `manual-${Date.now()}`;
    div.dataset.poolId = id;
    const hcpInp = div.querySelector('.player-hcp-inp');
    e.dataTransfer.setData('text/plain', JSON.stringify({ id, name: nameInp?.value || '', hcp: parseFloat(hcpInp?.dataset.preciseHcp || hcpInp?.value) || null, from: 'team' }));
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  playerRows.appendChild(div);
  // Hide drop hint if players present
  _updateTeamDropHint(playerRows);
}

function removePlayer(btn) {
  const row = btn.closest('.player-row');
  const playerRows = row?.closest('.player-rows');
  row?.remove();
  if (playerRows) _updateTeamDropHint(playerRows);
}

function _updateTeamDropHint(playerRows) {
  const hint = playerRows?.querySelector('.team-drop-hint');
  if (!hint) return;
  const count = playerRows.querySelectorAll('.player-row').length;
  hint.style.display = count > 0 ? 'none' : '';
}

function toggleHiLo(btn) {
  const current = btn.dataset.hilo;
  const next = current === 'HI' ? 'LO' : 'HI';
  btn.dataset.hilo = next;
  btn.textContent = next;
  btn.className = `player-hilo ${next.toLowerCase()}`;
}

// Programmatically set a player row's HI/LO button to a specific value
function _setHiLo(playerRow, value) {
  const btn = playerRow.querySelector('.player-hilo');
  if (!btn) return;
  btn.dataset.hilo = value;
  btn.textContent = value;
  btn.className = `player-hilo ${value.toLowerCase()}`;
}

// Re-evaluate HI/LO for all players on a team based on current handicap values
function _reevaluateHiLo(playerRowsContainer) {
  if (!playerRowsContainer) return;
  const rows = playerRowsContainer.querySelectorAll('.player-row');
  if (rows.length !== 2) return; // only applies to 2-player teams

  // Use precise decimal if available, otherwise the input value
  const inp0 = rows[0].querySelector('.player-hcp-inp');
  const inp1 = rows[1].querySelector('.player-hcp-inp');
  const hcp0 = parseFloat(inp0?.dataset.preciseHcp || inp0?.value);
  const hcp1 = parseFloat(inp1?.dataset.preciseHcp || inp1?.value);

  if (isNaN(hcp0) || isNaN(hcp1)) return; // can't compare if either is missing

  if (hcp0 < hcp1) {
    _setHiLo(rows[0], 'LO');
    _setHiLo(rows[1], 'HI');
  } else if (hcp0 > hcp1) {
    _setHiLo(rows[0], 'HI');
    _setHiLo(rows[1], 'LO');
  }
  // If exactly equal at precise level, leave as-is
}

// ===== Schedule Builder =====
function renderScheduleWeeks() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  const d = APP.wizard.data;

  // Parse YYYY-MM-DD as local midnight (avoids UTC timezone shift on all platforms)
  function parseDateLocal(str) {
    if (!str) return new Date();
    const [y, m, dd] = str.split('-').map(Number);
    return new Date(y, m - 1, dd);
  }

  // Calculate number of weeks from date range
  let weeks = 0;
  if (d.seasonStart && d.seasonEnd) {
    const start = parseDateLocal(d.seasonStart);
    const end   = parseDateLocal(d.seasonEnd);
    weeks = Math.round((end - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
    weeks = Math.max(1, Math.min(weeks, 52));
  } else {
    weeks = 18; // default
  }

  // Generate start date — already using local parsing above
  let date = parseDateLocal(d.seasonStart);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const targetDay = dayNames.indexOf(d.dayOfWeek || 'Monday');
  if (targetDay >= 0) {
    while (date.getDay() !== targetDay) date.setDate(date.getDate() + 1);
  }

  // Format as YYYY-MM-DD without UTC conversion
  function formatDateLocal(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  container.innerHTML = '';
  for (let w = 1; w <= weeks; w++) {
    const dateStr = formatDateLocal(date);
    const nine = w % 2 === 1 ? 'front' : 'back'; // alternate by default

    const div = document.createElement('div');
    div.className = 'schedule-week';
    div.innerHTML = `
      <span class="schedule-week-num">Wk ${w}</span>
      <input type="date" value="${dateStr}">
      <input type="time" value="${d.teeTime || '16:00'}">
      <div class="nine-toggle">
        <button data-nine="front" class="${nine === 'front' ? 'active' : ''}" onclick="toggleNine(this)">Front</button>
        <button data-nine="back"  class="${nine === 'back'  ? 'active' : ''}" onclick="toggleNine(this)">Back</button>
      </div>
    `;
    container.appendChild(div);

    date = new Date(date);
    date.setDate(date.getDate() + 7);
  }
}

function toggleNine(btn) {
  const group = btn.closest('.nine-toggle');
  group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function addScheduleWeek() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  const existing = container.querySelectorAll('.schedule-week');
  const w = existing.length + 1;
  // use last row's date + 7 days as default
  let dateStr = '';
  if (existing.length > 0) {
    const lastDate = existing[existing.length - 1].querySelector('input[type="date"]')?.value;
    if (lastDate) {
      const [y, m, dd] = lastDate.split('-').map(Number);
      const d = new Date(y, m - 1, dd + 7); // local midnight + 7 days
      const yr = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2,'0'), da = String(d.getDate()).padStart(2,'0');
      dateStr = `${yr}-${mo}-${da}`;
    }
  }
  const teeTime = APP.wizard.data.teeTime || '16:00';
  const nine = w % 2 === 1 ? 'front' : 'back';
  const div = document.createElement('div');
  div.className = 'schedule-week';
  div.innerHTML = `
    <span class="schedule-week-num">Wk ${w}</span>
    <input type="date" value="${dateStr}">
    <input type="time" value="${teeTime}">
    <div class="nine-toggle">
      <button data-nine="front" class="${nine === 'front' ? 'active' : ''}" onclick="toggleNine(this)">Front</button>
      <button data-nine="back"  class="${nine === 'back'  ? 'active' : ''}" onclick="toggleNine(this)">Back</button>
    </div>
    <button class="btn-icon" onclick="this.closest('.schedule-week').remove();renumberSchedule()" title="Remove week">✕</button>
  `;
  container.appendChild(div);
}

function renumberSchedule() {
  document.querySelectorAll('.schedule-week').forEach((el, i) => {
    const label = el.querySelector('.schedule-week-num');
    if (label) label.textContent = `Wk ${i + 1}`;
  });
}

// ===== Format Picker =====
const FORMAT_DEFS = [
  { id: 'match_play',       label: 'Match Play',          emoji: '🏆', desc: 'Hole-by-hole competition. Win the most holes to win the match. Most popular league format.' },
  { id: 'best_ball',        label: 'Best Ball / Four Ball',emoji: '⛳', desc: 'Each player plays their own ball; the lowest score on the team counts for each hole.' },
  { id: 'scramble',         label: 'Scramble',            emoji: '🤝', desc: 'All players hit, the team picks the best shot, everyone plays from there. Beginner friendly.' },
  { id: 'stroke_play',      label: 'Stroke Play',         emoji: '✏️',  desc: 'Lowest total strokes over the round wins. Simple and straightforward.' },
  { id: 'stableford',       label: 'Stableford / Points', emoji: '🎯', desc: 'Points per hole based on score vs par. Birdie=2, Par=1, Bogey=0. Highest points wins.' },
  { id: 'alternate_shot',   label: 'Alternate Shot',      emoji: '🔄', desc: 'Partners alternate hitting the same ball. Used in Ryder Cup, TGL, and LIV team formats.' },
  { id: 'modified_stableford', label: 'Modified Stableford', emoji: '🏅', desc: 'Eagle=3, Birdie=2, Par=1, Bogey=-1, Double Bogey=-3. Rewards aggressive play.' },
  { id: 'skins',            label: 'Skins Only',          emoji: '💰', desc: 'Each hole is worth money. Tie carries over (carryover skins). Winner takes all per hole.' },
  { id: 'red_white_blue',   label: 'Red White & Blue',    emoji: '🇺🇸', desc: 'Three 3-hole segments, each scored differently: front=Stableford, middle=Stroke, back=Match.' },
  { id: 'string_scramble',  label: 'String Scramble',     emoji: '🧵', desc: 'Like scramble but each team has a "string" they can use to move the ball any distance (once per round).' },
  { id: 'chapman',          label: 'Chapman (Pinehurst)', emoji: '🌲', desc: 'Both players drive, swap balls for second shot, then select one ball to finish as alternate shot.' },
  { id: 'shamble',          label: 'Shamble',             emoji: '🦩', desc: 'All players drive, select best drive, then each plays their own ball in from there.' },
];

function renderFormatPicker() {
  const el = document.getElementById('format-picker');
  if (!el) return;
  const current = document.getElementById('wz-format-val')?.value || 'match_play';
  el.innerHTML = FORMAT_DEFS.map(f => `
    <div class="format-card ${f.id === current ? 'active' : ''}" onclick="selectFormat('${f.id}',this)">
      <div class="format-card-top">
        <span class="format-emoji">${f.emoji}</span>
        <span class="format-label">${f.label}</span>
        <span class="format-info-btn" onclick="event.stopPropagation();showFormatInfo('${f.id}')" title="More info">ℹ</span>
      </div>
      <div class="format-desc">${f.desc}</div>
    </div>
  `).join('');
}

function selectFormat(id, el) {
  document.querySelectorAll('.format-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const hidden = document.getElementById('wz-format-val');
  if (hidden) hidden.value = id;
}

function showFormatInfo(id) {
  const fmt = FORMAT_DEFS.find(f => f.id === id);
  if (fmt) toast(`${fmt.emoji} ${fmt.label}: ${fmt.desc}`, 'default', 6000);
}

// ===== Point Values Stepper (Step 4) =====
function stepPts(id, delta) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const min = parseFloat(inp.min ?? 0);
  const max = parseFloat(inp.max ?? 99);
  const newVal = Math.min(max, Math.max(min, parseFloat(inp.value || 0) + delta));
  inp.value = newVal;
  updatePtsPreview();
}

function updatePtsPreview() {
  const hole    = parseFloat(document.getElementById('wz-pts-hole')?.value    || 1);
  const lownet  = parseFloat(document.getElementById('wz-pts-lownet')?.value  || 1);
  const teamnet = parseFloat(document.getElementById('wz-pts-teamnet')?.value || 0);
  const birdie  = parseFloat(document.getElementById('wz-pts-birdie')?.value  || 0);
  const eagle   = parseFloat(document.getElementById('wz-pts-eagle')?.value   || 0);

  const hiLoSplit = document.getElementById('wz-hilo-val')?.value === 'yes';
  const matchups = hiLoSplit ? 2 : 1;

  // Max pts per individual match: 9 holes + low net bonus
  const maxPerMatch  = 9 * hole + lownet;
  // Team bonus (team net) applies once per team matchup
  const maxPerTeam   = maxPerMatch * matchups + teamnet;

  // Build description
  const parts = [];
  parts.push(`${9 * hole} hole pts (${hole} × 9)`);
  if (lownet > 0)  parts.push(`${lownet} low net bonus${matchups > 1 ? ' × 2 matches' : ''}`);
  if (teamnet > 0) parts.push(`${teamnet} low team net bonus`);
  if (birdie > 0)  parts.push(`+${birdie} per birdie`);
  if (eagle > 0)   parts.push(`+${eagle} per eagle`);

  const preview = document.getElementById('pts-preview');
  if (!preview) return;
  preview.innerHTML = `
    <strong>Max ${maxPerTeam} pts per team matchup</strong>&nbsp;·&nbsp;${parts.join(' + ')}
    ${(birdie > 0 || eagle > 0) ? '<br><span style="color:var(--mt)">Birdie/eagle bonuses are per player per hole, on top of hole win points</span>' : ''}
  `;
}

// ===== Player Pool (Step 2 — Import & Drag) =====

// Pool state: array of { id, name }
let _pool = [];
let _poolIdCounter = 0;

function toggleImportPanel() {
  const panel = document.getElementById('import-panel');
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  if (open) document.getElementById('import-names-input')?.focus();
}

async function loadImportFile(input) {
  if (!input.files || !input.files.length) return;
  const files = Array.from(input.files);
  const texts = await Promise.all(files.map(f => f.text()));
  const ta = document.getElementById('import-names-input');
  if (ta) ta.value = (ta.value ? ta.value + '\n' : '') + texts.join('\n');
  const names = files.map(f => f.name).join(', ');
  document.getElementById('import-status').textContent = `Loaded ${files.length} file${files.length > 1 ? 's' : ''}: ${names}`;
}

function importPlayerNames() {
  const ta = document.getElementById('import-names-input');
  if (!ta) return;
  const raw = ta.value;

  // Split on newlines and commas, strip empties
  const names = raw
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (!names.length) { toast('No names found — paste some names first', 'error'); return; }

  let added = 0;
  names.forEach(name => {
    if (!_pool.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      _addToPool(name);
      added++;
    }
  });

  ta.value = '';
  document.getElementById('import-status').textContent = `${added} player${added !== 1 ? 's' : ''} added`;
  document.getElementById('import-panel').style.display = 'none';
  toast(`${added} player${added !== 1 ? 's' : ''} added to pool`, 'success');
}

function _addToPool(name, hcp = null) {
  const id = `pool-${++_poolIdCounter}`;
  _pool.push({ id, name, hcp });
  _renderPool();
}

function addPlayerToPool() {
  const inp = document.getElementById('add-player-name-inp');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) { toast('Enter a name first', 'error'); return; }
  if (_pool.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast('Already in pool', 'error'); return;
  }
  _addToPool(name);
  inp.value = '';
  inp.focus();
}

function _renderPool() {
  const pool = document.getElementById('player-pool');
  if (!pool) return;
  const hint = document.getElementById('pool-empty-hint');

  // Remove existing chips (not the hint)
  pool.querySelectorAll('.pool-chip').forEach(c => c.remove());

  if (!_pool.length) {
    if (hint) hint.style.display = '';
    return;
  }
  if (hint) hint.style.display = 'none';

  _pool.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'pool-chip';
    chip.draggable = true;
    chip.dataset.playerId = p.id;
    chip.dataset.playerName = p.name;
    const safeName = p.name.replace(/'/g, "\\'");
    const hcpLabel = p.hcp != null ? ` <span class="pool-chip-hcp">(${Math.round(p.hcp)})</span>` : '';
    chip.innerHTML = `<span>${p.name}${hcpLabel}</span><button class="pool-chip-add" onclick="event.stopPropagation();assignToNextTeam('${p.id}','${safeName}',${p.hcp != null ? p.hcp : 'null'})" title="Add to next team">+</button><button class="pool-chip-remove" onclick="removeFromPool('${p.id}')" title="Remove">✕</button>`;
    chip.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ id: p.id, name: p.name, hcp: p.hcp, from: 'pool' }));
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    pool.appendChild(chip);
  });
}

function removeFromPool(id) {
  _pool = _pool.filter(p => p.id !== id);
  _renderPool();
}

function dropOnPool(event) {
  event.preventDefault();
  const pool = document.getElementById('player-pool');
  if (pool) pool.classList.remove('drag-over');

  let data;
  try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
  if (!data || data.from === 'pool') return; // already in pool

  // Remove from team row in DOM
  const teamRow = document.querySelector(`.player-row[data-pool-id="${data.id}"]`);
  if (teamRow) teamRow.remove();

  // Add back to pool (with handicap)
  if (!_pool.find(p => p.id === data.id)) {
    _pool.push({ id: data.id, name: data.name, hcp: data.hcp != null ? parseFloat(data.hcp) : null });
    _renderPool();
  }
}

// Called when a pool chip is dropped onto a team drop zone
function dropOnTeam(event, teamEl) {
  event.preventDefault();
  teamEl.classList.remove('drag-over');

  let data;
  try { data = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
  if (!data) return;

  const playerRows = teamEl.querySelector('.player-rows');
  if (!playerRows) return;

  // If coming from another team, remove old row
  if (data.from === 'team') {
    const old = document.querySelector(`.player-row[data-pool-id="${data.id}"]`);
    if (old) old.remove();
  }

  // If coming from pool, remove from pool array
  if (data.from === 'pool') {
    _pool = _pool.filter(p => p.id !== data.id);
    _renderPool();
  }

  // Determine HI/LO based on handicap comparison
  const existingRows = playerRows.querySelectorAll('.player-row');
  const existingCount = existingRows.length;
  const ppt = parseInt(document.getElementById('wz-players-per-team-val')?.value || '2');

  let hilo = null;
  if (ppt >= 2 && existingCount === 0) {
    hilo = 'LO'; // tentative — re-evaluated when 2nd player added
  } else if (ppt >= 2 && existingCount === 1) {
    // Compare handicaps to determine HI/LO (use precise decimals for tiebreaking)
    const existingRow = existingRows[0];
    const existingHcpInp = existingRow.querySelector('.player-hcp-inp');
    const existingHcpVal = parseFloat(existingHcpInp?.dataset.preciseHcp || existingHcpInp?.value);
    const incomingHcpVal = data.hcp != null ? parseFloat(data.hcp) : NaN;

    if (!isNaN(existingHcpVal) && !isNaN(incomingHcpVal)) {
      if (incomingHcpVal < existingHcpVal) {
        hilo = 'LO';
        _setHiLo(existingRow, 'HI');
      } else if (incomingHcpVal > existingHcpVal) {
        hilo = 'HI';
        _setHiLo(existingRow, 'LO');
      } else {
        // Exactly equal: positional fallback
        hilo = 'HI';
        _setHiLo(existingRow, 'LO');
      }
    } else {
      // One or both missing hcp: positional fallback
      hilo = 'HI';
      _setHiLo(existingRow, 'LO');
    }
  }

  // Build player row
  const div = document.createElement('div');
  div.className = 'player-row';
  div.dataset.poolId = data.id;
  div.draggable = true;
  div.innerHTML = `
    <input class="player-name-inp" type="text" value="${data.name}" placeholder="Player name">
    <input class="player-hcp-inp" type="number" placeholder="Hcp" min="0" max="54" step="0.5" style="width:60px;text-align:center" title="Starting handicap (optional)" />
    ${hilo ? `<button class="player-hilo ${hilo.toLowerCase()}" data-hilo="${hilo}" onclick="toggleHiLo(this)">${hilo}</button>` : ''}
    <button class="btn-icon" onclick="returnPlayerToPool(this,'${data.id}','${data.name.replace(/'/g, "\\'")}')">↩</button>
    <button class="btn-icon" onclick="removePlayer(this)">✕</button>
  `;

  // Pre-fill handicap from drag data (display rounded, keep precise in data-hcp)
  if (data.hcp != null) {
    const hcpInp = div.querySelector('.player-hcp-inp');
    if (hcpInp) {
      hcpInp.value = Math.round(data.hcp);
      hcpInp.dataset.preciseHcp = data.hcp;
    }
  }

  // Re-evaluate HI/LO when handicap is manually edited
  const hcpInput = div.querySelector('.player-hcp-inp');
  if (hcpInput) {
    hcpInput.addEventListener('input', () => _reevaluateHiLo(div.closest('.player-rows')));
  }

  // Make the placed row draggable back to another team
  div.addEventListener('dragstart', e => {
    const nameInp = div.querySelector('.player-name-inp');
    const hcpInp = div.querySelector('.player-hcp-inp');
    e.dataTransfer.setData('text/plain', JSON.stringify({
      id: data.id,
      name: nameInp?.value || data.name,
      hcp: parseFloat(hcpInp?.dataset.preciseHcp || hcpInp?.value) || (data.hcp || null),
      from: 'team'
    }));
    div.classList.add('dragging');
  });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));

  playerRows.appendChild(div);
  _updateTeamDropHint(playerRows);
}

// Tap-to-add: assign a pool player to the next team with an open slot
function assignToNextTeam(id, name, hcp) {
  const ppt = parseInt(document.getElementById('wz-players-per-team-val')?.value || '2');
  const teams = document.querySelectorAll('#teams-container .team-row');
  let target = null;
  for (const team of teams) {
    const rows = team.querySelector('.player-rows');
    if (rows && rows.querySelectorAll('.player-row').length < ppt) {
      target = team;
      break;
    }
  }
  if (!target) { toast('All teams are full — add another team first', 'error'); return; }

  // Simulate a drop from pool
  const fakeEvent = {
    preventDefault() {},
    dataTransfer: {
      getData() { return JSON.stringify({ id, name, hcp: hcp != null ? hcp : null, from: 'pool' }); }
    }
  };
  target.classList.remove('drag-over');
  dropOnTeam(fakeEvent, target);
}

function returnPlayerToPool(btn, id, name) {
  const row = btn.closest('.player-row');
  const nameInp = row?.querySelector('.player-name-inp');
  const hcpInp  = row?.querySelector('.player-hcp-inp');
  const currentName = nameInp?.value?.trim() || name;
  const currentHcp  = hcpInp?.value ? parseFloat(hcpInp.value) : null;
  if (row) row.remove();
  if (!_pool.find(p => p.id === id)) {
    _pool.push({ id, name: currentName, hcp: currentHcp });
    _renderPool();
  }
}


// ===== Missing Player Rule Toggle =====
function toggleAbsentScoreInput(val) {
  const fixedField   = document.getElementById('absent-fixed-score-field');
  const worstField   = document.getElementById('absent-worst-lookback-field');
  if (fixedField) fixedField.style.display = val === 'fixed_score'  ? '' : 'none';
  if (worstField) worstField.style.display = val === 'worst_score'  ? '' : 'none';
}

// ===== Absent Score Engine =====
// Returns a gross score array (9 values) for a missing player given the current config and
// that player's historical/current rounds. currentMatchWeek is 1-based.
function getAbsentScore(playerId, config, currentMatchDate) {
  const rule    = _getAbsentRule(config);
  const rounds  = (APP.rounds?.[playerId] || [])
    .filter(r => r.grossScore > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')); // newest first

  const holes   = 9;
  const par     = (config.course?.scorecard?.front || _defaultHoles('front'))
    .reduce((a, h) => a + h.par, 0); // typical par for reference

  // Helper: spread a single gross total evenly across 9 holes
  function spreadScore(gross) {
    if (!gross) return new Array(holes).fill(0);
    const base = Math.floor(gross / holes);
    const rem  = gross - base * holes;
    return Array.from({ length: holes }, (_, i) => base + (i < rem ? 1 : 0));
  }

  switch (rule) {

    case 'duplicate_prev': {
      // Use the player's most recent round score
      if (rounds.length > 0) return spreadScore(rounds[0].grossScore);
      // Fall through to blind_avg if no history
    }
    // falls through
    case 'blind_avg': {
      // Average of all committed rounds across all players
      let total = 0, count = 0;
      Object.values(APP.rounds || {}).forEach(playerRounds => {
        playerRounds.forEach(r => { if (r.grossScore > 0) { total += r.grossScore; count++; } });
      });
      const avg = count > 0 ? Math.round(total / count) : (par + 5);
      return spreadScore(avg);
    }

    case 'worst_score': {
      const lookback = config.absentWorstLookback ?? 4;
      const recent   = rounds.slice(0, lookback); // most recent N rounds
      if (recent.length === 0) {
        // No history — use league average + penalty (worst known + buffer)
        let leagueWorst = 0;
        Object.values(APP.rounds || {}).forEach(pr => {
          pr.forEach(r => { if (r.grossScore > leagueWorst) leagueWorst = r.grossScore; });
        });
        return spreadScore(leagueWorst || (par + 9));
      }
      const worst = Math.max(...recent.map(r => r.grossScore));
      return spreadScore(worst);
    }

    case 'fixed_score': {
      const fixed = config.absentFixedScore;
      return fixed ? spreadScore(fixed) : spreadScore(par + 5);
    }

    case 'last_score': {
      if (rounds.length > 0) return spreadScore(rounds[0].grossScore);
      return spreadScore(par + 5);
    }

    case 'vs_par':
      return spreadScore(par);

    case 'forfeit':
    case 'half_pts':
    default:
      return new Array(holes).fill(0); // caller handles forfeit/half_pts specially
  }
}

// ===== Handicap System Toggle =====
// Show/hide custom settings when system changes (scratch/manual don't need them)
function toggleHcpSystemSettings(val) {
  const settings = document.getElementById('hcp-custom-settings');
  if (!settings) return;
  settings.style.display = (val === 'scratch' || val === 'manual') ? 'none' : '';
}

// ===== Step 5 Import Summary =====
// Shows a read-only summary of CSV data imported in Step 1
function _renderS5ImportSummary() {
  const el = document.getElementById('s5-import-summary');
  if (!el) return;
  const imported = APP.wizard._importedHistory || [];
  if (!imported.length) {
    el.innerHTML = '<p style="color:var(--mt);font-size:13px;padding:12px 0">No history imported yet. You can upload CSV files on Step 1.</p>';
    return;
  }
  const par = 35;
  const factor = parseFloat(document.getElementById('wz-hcp-factor')?.value || '0.9');
  const totalRounds = imported.reduce((s, p) => s + p.scores.length, 0);
  let html = `<p style="font-size:12px;font-weight:600;color:var(--gd);margin-bottom:8px">✓ ${imported.length} players · ${totalRounds} rounds imported</p>`;
  html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--mt)">Player</th>';
  html += '<th style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--mt)">Rounds</th>';
  html += '<th style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--mt)">Avg</th>';
  html += '<th style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--mt)">Best</th>';
  html += '<th style="text-align:center;padding:5px 8px;border-bottom:1px solid var(--bd);color:var(--mt)">Est. Hcp</th>';
  html += '</tr></thead><tbody>';
  imported.forEach(p => {
    const grossScores = p.scores.map(s => s.grossScore);
    const avg = grossScores.reduce((a, b) => a + b, 0) / grossScores.length;
    const best = Math.min(...grossScores);
    const sorted = [...grossScores].sort((a, b) => a - b).slice(0, 5);
    const estHcp = Math.min(18, Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length - par) * factor));
    html += `<tr>
      <td style="padding:5px 8px;border-bottom:1px solid var(--bd)">${p.displayName}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${grossScores.length}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${avg.toFixed(1)}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${best}</td>
      <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center;color:var(--gd);font-weight:600">${estHcp}</td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ===== Handicap Manual Score Entry =====
function renderHcpManualTable() {
  const wrap = document.getElementById('hcp-manual-table-wrap');
  if (!wrap) return;

  // Get how many rounds the slider is set to
  const numRounds = parseInt(document.getElementById('wz-hcp-rounds-val')?.value || '5');

  // Collect players from wizard data (teams may not be set yet if going backwards)
  const teams = APP.wizard.data.teams || collectTeams();
  const players = teams.flatMap(t => t.players || []).filter(p => p && p.name);

  if (!players.length) {
    wrap.innerHTML = `
      <div class="hcp-manual-empty">
        <p style="color:var(--mt);font-size:13px;text-align:center;padding:16px 0">
          No players found — go back to Step 2 and add your teams first
        </p>
      </div>`;
    return;
  }

  // Read back any previously-entered values so they survive re-renders
  const existing = APP.wizard._manualScores || {};

  let html = `<div class="hcp-manual-table-scroll"><table class="hcp-manual-table">
    <thead>
      <tr>
        <th class="hcp-player-col">Player</th>`;
  for (let i = 1; i <= numRounds; i++) {
    html += `<th>Round ${i}</th>`;
  }
  html += `</tr>
    </thead>
    <tbody>`;

  players.forEach(p => {
    const prev = existing[p.id] || [];
    html += `<tr data-player-id="${p.id}">
      <td class="hcp-player-col"><span class="hcp-player-name">${p.name}</span></td>`;
    for (let i = 0; i < numRounds; i++) {
      const val = prev[i] != null ? prev[i] : '';
      html += `<td><input
        type="number"
        class="hcp-score-inp"
        data-player="${p.id}"
        data-round="${i}"
        value="${val}"
        min="20" max="120"
        placeholder="–"
        oninput="saveHcpManualScore('${p.id}',${i},this.value)"
      /></td>`;
    }
    html += `</tr>`;
  });

  html += `</tbody></table></div>
    <p class="field-hint" style="margin-top:6px">Scores are gross (total strokes). Oldest first, most recent last.</p>`;

  wrap.innerHTML = html;
}

function saveHcpManualScore(playerId, roundIdx, value) {
  if (!APP.wizard._manualScores) APP.wizard._manualScores = {};
  if (!APP.wizard._manualScores[playerId]) APP.wizard._manualScores[playerId] = [];
  const num = parseFloat(value);
  APP.wizard._manualScores[playerId][roundIdx] = isNaN(num) ? null : num;
}

function collectHcpManualHistory() {
  // Convert _manualScores into array of { playerId, scores: [] }
  const raw = APP.wizard._manualScores || {};
  const result = [];
  for (const [playerId, scores] of Object.entries(raw)) {
    const clean = (scores || []).filter(s => s != null && s > 0);
    if (clean.length > 0) {
      result.push({ playerId, scores: clean });
    }
  }
  return result;
}

// ===== HCP History CSV Import =====
// Supports FringeGolfers export format:
//   "Name","Round Date","Course","Score","Num Putts"
//   "Last, First","2025-05-13","Wellshire Golf Course","52 (+17)",""

function handleHcpCsvDrop(event) {
  event.preventDefault();
  document.getElementById('hcp-import-zone')?.classList.remove('drag-over');
  handleHcpCsvFiles(event.dataTransfer.files);
}

async function handleHcpCsvFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const statusEl = document.getElementById('hcp-import-status');
  if (statusEl) statusEl.textContent = `Reading ${fileList.length} file${fileList.length > 1 ? 's' : ''}…`;

  // Read all files as text concurrently
  const texts = await Promise.all(
    Array.from(fileList).map(f => f.text())
  );

  // Parse and merge all CSVs — deduplicate by player+date
  const byPlayer = {};   // "Last, First" → Map<date, grossScore>

  for (const text of texts) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      // Skip header row
      if (line.startsWith('"Name"') || line.startsWith('Name')) continue;

      // Parse CSV fields (simple quoted CSV — values don't contain commas)
      const fields = line.match(/"([^"]*)"/g)?.map(s => s.replace(/"/g, '')) || [];
      if (fields.length < 4) continue;

      const nameRaw  = fields[0].trim();   // "Last, First"
      const dateStr  = fields[1].trim();   // "2025-05-13"
      const scoreRaw = fields[3].trim();   // "52 (+17)" or "52"

      if (!nameRaw || !dateStr || !scoreRaw) continue;

      // Extract gross score — take the leading integer
      const scoreMatch = scoreRaw.match(/^(\d+)/);
      if (!scoreMatch) continue;
      const gross = parseInt(scoreMatch[1]);
      if (isNaN(gross) || gross < 20 || gross > 120) continue;

      if (!byPlayer[nameRaw]) byPlayer[nameRaw] = new Map();
      // Deduplicate: if same player+date appears in multiple files, keep first
      if (!byPlayer[nameRaw].has(dateStr)) {
        byPlayer[nameRaw].set(dateStr, gross);
      }
    }
  }

  const playerCount = Object.keys(byPlayer).length;
  if (!playerCount) {
    if (statusEl) statusEl.textContent = '⚠️ No valid score rows found — check file format';
    return;
  }

  // Convert "Last, First" → "First Last" for display
  function toDisplayName(lastFirst) {
    const parts = lastFirst.split(',').map(s => s.trim());
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : lastFirst;
  }

  // Build the _importedHistory array that createLeague will consume
  // Format: [{ name, displayName, scores: [{date, grossScore}] }]
  const imported = Object.entries(byPlayer).map(([nameRaw, dateMap]) => {
    const scores = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))  // sort by date
      .map(([date, grossScore]) => ({ date, grossScore }));
    return {
      name:        nameRaw,
      displayName: toDisplayName(nameRaw),
      scores
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  APP.wizard._importedHistory = imported;

  // Render preview table
  const par = 35; // 9-hole par
  const factor = parseFloat(document.getElementById('wz-hcp-factor')?.value || '0.9');
  const tbody = document.getElementById('hcp-preview-tbody');
  const wrap  = document.getElementById('hcp-preview-wrap');
  const title = document.getElementById('hcp-preview-title');

  if (tbody) {
    tbody.innerHTML = imported.map(p => {
      const grossScores = p.scores.map(s => s.grossScore);
      const avg  = grossScores.reduce((a, b) => a + b, 0) / grossScores.length;
      const best = Math.min(...grossScores);
      // Simple estimated hcp using best 5 of available rounds
      const sorted = [...grossScores].sort((a, b) => a - b).slice(0, 5);
      const avgBest5 = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const estHcp = Math.max(0, Math.min(18, Math.round((avgBest5 - par) * factor * 10) / 10));
      return `
        <tr>
          <td style="padding:5px 8px;border-bottom:1px solid var(--bd)">${p.displayName}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${grossScores.length}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${avg.toFixed(1)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center">${best}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--bd);text-align:center;color:var(--gd);font-weight:600">${estHcp}</td>
        </tr>`;
    }).join('');
  }

  const totalRounds = imported.reduce((s, p) => s + p.scores.length, 0);
  if (title) title.textContent = `✓ ${playerCount} players · ${totalRounds} rounds imported`;
  if (wrap)  wrap.style.display = '';
  if (statusEl) statusEl.textContent = '';

  // Auto-populate seed handicaps on Step 2 player rows if names match
  _applySeedHcpsFromHistory(imported);

  // Auto-add imported player names to Step 2 player pool (with hcp)
  let poolAdded = 0;
  imported.forEach(p => {
    const existing = _pool.find(x => x.name.toLowerCase() === p.displayName.toLowerCase());
    if (!existing) {
      const id = `pool-${++_poolIdCounter}`;
      const grossScores = p.scores.map(s => s.grossScore);
      const hcp = _calcSeedHcp(grossScores);
      _pool.push({ id, name: p.displayName, hcp });
      poolAdded++;
    } else if (existing.hcp == null) {
      // Backfill hcp for pool entries added before CSV import
      const grossScores = p.scores.map(s => s.grossScore);
      existing.hcp = _calcSeedHcp(grossScores);
    }
  });
  _renderPool();
}

function clearHcpImport() {
  APP.wizard._importedHistory = [];
  const wrap   = document.getElementById('hcp-preview-wrap');
  const status = document.getElementById('hcp-import-status');
  const file   = document.getElementById('hcp-csv-file');
  if (wrap)   wrap.style.display = 'none';
  if (status) status.textContent = '';
  if (file)   file.value = '';
  toast('Import cleared', 'info');
}

// Shared seed-hcp calculator. Returns decimal (e.g. 9.7), NOT rounded to int.
function _calcSeedHcp(grossScores) {
  if (!grossScores || !grossScores.length) return null;
  const par = 35;
  const factor = parseFloat(document.getElementById('wz-hcp-factor')?.value || '0.9');
  const sorted = [...grossScores].sort((a, b) => a - b).slice(0, 5);
  const avgBest5 = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return Math.max(0, Math.min(18, Math.round((avgBest5 - par) * factor * 10) / 10));
}

// Try to auto-fill seed handicap inputs on Step 2 rows
// matching "First Last" against player name inputs
function _applySeedHcpsFromHistory(imported) {
  const playerRows = document.querySelectorAll('.player-row');
  playerRows.forEach(row => {
    const nameInp = row.querySelector('.player-name-inp');
    const hcpInp  = row.querySelector('.player-hcp-inp');
    if (!nameInp || !hcpInp || hcpInp.value) return; // skip if already filled

    const rowName = nameInp.value.trim().toLowerCase();
    if (!rowName) return;

    // Try to find a match in imported data
    const match = imported.find(p => {
      return p.displayName.toLowerCase() === rowName ||
             p.name.toLowerCase() === rowName;
    });
    if (!match) return;

    const grossScores = match.scores.map(s => s.grossScore);
    const estHcp = _calcSeedHcp(grossScores);
    if (estHcp != null) {
      hcpInp.value = Math.round(estHcp);
      hcpInp.dataset.preciseHcp = estHcp;
    }
  });

  // Also update pool entries with handicaps for matching names
  imported.forEach(imp => {
    const match = _pool.find(p =>
      p.name.toLowerCase() === imp.displayName.toLowerCase() ||
      p.name.toLowerCase() === imp.name.toLowerCase()
    );
    if (match && match.hcp == null) {
      const grossScores = imp.scores.map(s => s.grossScore);
      match.hcp = _calcSeedHcp(grossScores);
    }
  });
  _renderPool();
}

// ===== Handicap Engine =====
function calcHcp(rounds, config) {
  const hcpConfig = config?.handicap || {};
  const numRounds = hcpConfig.rounds || 5;
  const factor    = hcpConfig.factor ?? 0.9;
  const maxHcp    = hcpConfig.max    ?? 18;
  const drop      = hcpConfig.drop || 'none';
  const par       = config?.course?.scorecard?.front?.reduce((a, h) => a + h.par, 0) || 35;

  // WHS slope/rating (optional — when both set, use differential formula)
  const slope   = config?.course?.slope;
  const rating  = config?.course?.rating;
  const useWHS  = slope > 0 && rating > 0;
  const rating9 = useWHS ? rating / 2 : null;  // 9-hole course rating

  if (!rounds || rounds.length === 0) return 0;

  const recent = rounds
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, numRounds);

  // Convert to either differentials (WHS) or raw scores (league formula)
  const values = recent
    .map(r => {
      const gross = r.grossScore || r.score || 0;
      if (gross <= 0) return null;
      if (useWHS) return (113 / slope) * (gross - rating9);
      return gross;
    })
    .filter(v => v !== null);

  if (values.length === 0) return 0;

  // Drop outlier scores before averaging
  let filtered = values.slice();
  if (drop !== 'none' && filtered.length > 2) {
    filtered.sort((a, b) => a - b);
    if (drop === 'low' || drop === 'both') filtered = filtered.slice(1);
    if (drop === 'high' || drop === 'both') filtered = filtered.slice(0, -1);
  }

  const avg = filtered.reduce((a, b) => a + b, 0) / filtered.length;

  // WHS: differentials are already relative to rating, just apply factor
  // League: subtract par first, then apply factor
  const hcp = useWHS
    ? Math.round(avg * factor * 10) / 10
    : Math.round((avg - par) * factor * 10) / 10;

  return Math.min(Math.max(hcp, 0), maxHcp);
}

// Handicap with manual adjustment applied
function calcHcpAdj(rounds, config, playerId) {
  const base = calcHcp(rounds, config);
  const adj  = (config?.manualAdj || {})[playerId] || 0;
  const max  = config?.handicap?.max || 18;
  return Math.min(Math.max(base + adj, 0), max);
}

// ===== Match Scoring Engine =====
// Distributes handicap strokes by hole difficulty (hdcp rank)
function getHcpStrokes(hcp, holes) {
  // holes: [{hole, par, hdcp, yards}]
  const sorted = holes.slice().sort((a, b) => a.hdcp - b.hdcp); // hdcp=1 hardest
  const strokes = new Array(holes.length).fill(0);
  let remaining = Math.round(hcp);
  for (let s = 0; s < remaining; s++) {
    const holeIdx = holes.findIndex(h => h.hole === sorted[s % sorted.length].hole);
    strokes[holeIdx]++;
  }
  return strokes; // index-aligned to holes array
}

// Calculate a single match (2 players, 9 holes)
// pv = pointValues config: { hole, lowNet, birdie, eagle }
//   teamNet is handled at the team level, not per-match
function calcMatch(scores1, scores2, hcp1, hcp2, holes, pv) {
  // Point value defaults (backwards compatible)
  const holePts   = pv?.hole   ?? 1;
  const lowNetPts = pv?.lowNet ?? 1;
  const birdiePts = pv?.birdie ?? 0;
  const eaglePts  = pv?.eagle  ?? 0;

  const strokes1 = getHcpStrokes(Math.max(0, hcp1 - hcp2), holes);
  const strokes2 = getHcpStrokes(Math.max(0, hcp2 - hcp1), holes);

  let pts1 = 0, pts2 = 0;
  const holeResults = holes.map((hole, i) => {
    const gross1 = scores1[i] || 0;
    const gross2 = scores2[i] || 0;
    const net1 = gross1 - strokes1[i];
    const net2 = gross2 - strokes2[i];
    const par  = hole.par || 4;

    // Hole win points (scaled by holePts)
    let hp1 = 0, hp2 = 0;
    if (net1 < net2)       { hp1 = holePts; }
    else if (net2 < net1)  { hp2 = holePts; }
    else { hp1 = holePts / 2; hp2 = holePts / 2; }

    // Birdie bonus (gross score)
    let bb1 = 0, bb2 = 0;
    if (birdiePts > 0 && gross1 > 0) {
      if (gross1 <= par - 2) bb1 = eaglePts || birdiePts; // eagle or better
      else if (gross1 === par - 1) bb1 = birdiePts;
    }
    if (birdiePts > 0 && gross2 > 0) {
      if (gross2 <= par - 2) bb2 = eaglePts || birdiePts;
      else if (gross2 === par - 1) bb2 = birdiePts;
    }
    // Eagle bonus on top of birdie if configured separately
    if (eaglePts > 0 && gross1 > 0 && gross1 <= par - 2) bb1 = eaglePts;
    if (eaglePts > 0 && gross2 > 0 && gross2 <= par - 2) bb2 = eaglePts;

    pts1 += hp1 + bb1;
    pts2 += hp2 + bb2;
    return {
      hole: hole.hole, net1, net2,
      strokes1: strokes1[i], strokes2: strokes2[i],
      pts1: hp1, pts2: hp2,
      birdie1: bb1, birdie2: bb2
    };
  });

  // Low net bonus point (scaled by lowNetPts)
  const totalNet1 = scores1.reduce((a, b) => a + b, 0) - strokes1.reduce((a, b) => a + b, 0);
  const totalNet2 = scores2.reduce((a, b) => a + b, 0) - strokes2.reduce((a, b) => a + b, 0);
  let bonus1 = 0, bonus2 = 0;
  if (lowNetPts > 0) {
    if (totalNet1 < totalNet2)      { bonus1 = lowNetPts; }
    else if (totalNet2 < totalNet1) { bonus2 = lowNetPts; }
    else { bonus1 = lowNetPts / 2; bonus2 = lowNetPts / 2; }
  }

  pts1 += bonus1;
  pts2 += bonus2;

  const maxPts = 9 * holePts + lowNetPts;

  return {
    pts1: Math.round(pts1 * 10) / 10,
    pts2: Math.round(pts2 * 10) / 10,
    holeResults,
    bonus1, bonus2,
    totalNet1, totalNet2,
    maxPts
  };
}

// ===== Standings Calculator =====
function calcStandings(matches, teams) {
  const pts = {};
  teams.forEach(t => { pts[t.id] = { team: t, pts: 0, wins: 0, losses: 0, ties: 0, played: 0 }; });

  Object.values(matches).forEach(m => {
    if (m.status !== 'committed') return;
    const r = m.result;
    if (!r) return;
    // result: { team1Id, team2Id, pts1, pts2 }
    const { team1Id, team2Id, pts1, pts2 } = r;
    if (pts[team1Id]) { pts[team1Id].pts += pts1; pts[team1Id].played++; if (pts1 > pts2) pts[team1Id].wins++; else if (pts2 > pts1) pts[team1Id].losses++; else pts[team1Id].ties++; }
    if (pts[team2Id]) { pts[team2Id].pts += pts2; pts[team2Id].played++; if (pts2 > pts1) pts[team2Id].wins++; else if (pts1 > pts2) pts[team2Id].losses++; else pts[team2Id].ties++; }
  });

  return Object.values(pts).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
}

// ===== Skins Calculator =====
// Calculate skins for a specific week. All committed matches that week compete on same holes.
// Returns { holes: [{hole, winner, winnerName, score, pot}], totalSkins, players: {pid: count} }
function calcWeeklySkins(weekNum, allMatches, config) {
  const teams   = config.teams || [];
  const weekMatches = Object.values(allMatches).filter(m =>
    m.week == weekNum && m.status === 'committed' && m.scores
  );
  if (!weekMatches.length) return { holes: [], totalSkins: 0, players: {} };

  const nine  = weekMatches[0]?.nine || 'front';
  const holes = config.course?.scorecard?.[nine] || _defaultHoles(nine);
  const useNet = config.format?.skinsNet || false;

  // Build per-hole scores from all matches
  const result = [];
  let carry = 0;
  const playerSkins = {};

  // Helper: find player name
  const pName = (pid) => {
    for (const t of teams) {
      const p = (t.players || []).find(pl => pl.id === pid);
      if (p) return p.name;
    }
    return pid;
  };

  // Helper: get hcp strokes for net skins
  const hcpStrokes = {};
  if (useNet) {
    weekMatches.forEach(m => {
      Object.keys(m.scores).forEach(pid => {
        if (!hcpStrokes[pid]) {
          const rounds = APP.rounds[pid] || [];
          const hcp = calcHcp(rounds, config);
          hcpStrokes[pid] = getHcpStrokes(hcp, holes);
        }
      });
    });
  }

  for (let i = 0; i < holes.length; i++) {
    const allScores = [];
    weekMatches.forEach(m => {
      Object.entries(m.scores).forEach(([pid, scores]) => {
        let score = scores[i] || 99;
        if (useNet && hcpStrokes[pid]) score -= (hcpStrokes[pid][i] || 0);
        allScores.push({ pid, score });
      });
    });

    const min = Math.min(...allScores.map(s => s.score));
    const winners = allScores.filter(s => s.score === min);

    if (winners.length === 1) {
      const w = winners[0];
      const pot = 1 + carry;
      carry = 0;
      playerSkins[w.pid] = (playerSkins[w.pid] || 0) + pot;
      result.push({ hole: holes[i].hole, par: holes[i].par, winner: w.pid, winnerName: pName(w.pid), score: min, pot, carryover: false });
    } else {
      carry++;
      result.push({ hole: holes[i].hole, par: holes[i].par, winner: null, winnerName: null, score: null, pot: 0, carryover: true });
    }
  }

  return { holes: result, totalSkins: Object.values(playerSkins).reduce((a, b) => a + b, 0), players: playerSkins };
}

// ===== Renders =====

// ---- Dashboard Tab ----
function renderDashboard() {
  const el = document.getElementById('tab-dashboard');
  if (!el || !APP.config) return;

  const myPlayerId = APP.member?.playerId;
  const teams      = APP.config.teams || [];
  const config     = APP.config;
  const uid        = APP.user?.uid || window._currentUser?.uid;

  // Find player's team and partner
  let myTeam = null, myPlayer = null, myPartner = null;
  for (const t of teams) {
    const found = (t.players || []).find(p => p.id === myPlayerId);
    if (found) {
      myTeam = t;
      myPlayer = found;
      myPartner = (t.players || []).find(p => p.id !== myPlayerId) || null;
      break;
    }
  }

  // If no linked player, show link prompt with claim button
  if (!myPlayerId || !myTeam) {
    const isCommish = APP.member?.role === 'commissioner';
    el.innerHTML = `
      <div class="empty-state mt-12">
        <div class="empty-icon">👤</div>
        <p>Your account isn't linked to a player yet.</p>
        <p class="mt-8" style="color:var(--mt);font-size:13px;margin-bottom:16px">
          ${isCommish ? 'Link yourself to a player on the roster.' : 'Claim your player from the roster, or ask your commissioner to assign you.'}
        </p>
        <button class="btn btn-green" onclick="showClaimModal()">
          ${isCommish ? '🔗 Link My Player' : '🏌️ Claim My Player'}
        </button>
        <p class="mt-8" style="color:var(--mt);font-size:12px">Or browse the <a href="#" onclick="navTo('scores');return false" style="color:var(--gd)">Scores</a> tab.</p>
      </div>`;
    return;
  }

  // Gather match data for my team
  const allMatches = Object.entries(APP.matches);
  const myMatches  = allMatches.filter(([, m]) =>
    m.team1Id === myTeam.id || m.team2Id === myTeam.id
  );

  // --- Section 1: Action Required ---
  const actions = [];
  myMatches.forEach(([key, m]) => {
    const canApprove = _canApproveScores(m, uid);
    const canEnter   = _canEnterScores(m, uid);
    if (canApprove && m.status === 'pending') {
      const opp = m.team1Id === myTeam.id ? m.team2Name : m.team1Name;
      actions.push(`
        <div class="dashboard-action-card" onclick="openMatch('${key}')">
          <div class="action-card-badge">APPROVE</div>
          <div class="action-card-body">
            <div class="action-card-title">vs ${opp} — Week ${m.week}</div>
            <div class="action-card-hint">Opponent submitted scores. Tap to review & approve.</div>
          </div>
        </div>`);
    } else if (canEnter && m.status === 'draft') {
      const opp = m.team1Id === myTeam.id ? m.team2Name : m.team1Name;
      const isPast = m.date && new Date(m.date) <= new Date();
      if (isPast) {
        actions.push(`
          <div class="dashboard-action-card" onclick="openMatch('${key}')">
            <div class="action-card-badge enter">ENTER</div>
            <div class="action-card-body">
              <div class="action-card-title">vs ${opp} — Week ${m.week}</div>
              <div class="action-card-hint">Match day has passed. Tap to enter scores.</div>
            </div>
          </div>`);
      }
    }
  });

  const actionHtml = actions.length
    ? `<div class="dashboard-section">
         <div class="dash-section-title">Action Required</div>
         ${actions.join('')}
       </div>`
    : '';

  // --- Section 2: Next Match ---
  const upcoming = myMatches
    .filter(([, m]) => m.status === 'draft' && m.date)
    .sort(([, a], [, b]) => new Date(a.date) - new Date(b.date));
  const next = upcoming[0];

  let nextHtml = '';
  if (next) {
    const [nextKey, nm] = next;
    const oppTeamId   = nm.team1Id === myTeam.id ? nm.team2Id : nm.team1Id;
    const oppTeamName = nm.team1Id === myTeam.id ? nm.team2Name : nm.team1Name;
    const oppTeam     = teams.find(t => t.id === oppTeamId);
    const oppPlayers  = oppTeam?.players || [];
    const oppHcps     = oppPlayers.map(p => {
      const rounds = APP.rounds[p.id] || [];
      return { name: p.name, hilo: p.hilo || '', hcp: calcHcp(rounds, config) };
    });

    nextHtml = `
      <div class="dashboard-section">
        <div class="dash-section-title">Next Match</div>
        <div class="next-match-card">
          <div class="next-match-header">
            <span class="next-match-opp">vs ${oppTeamName}</span>
            <span class="next-match-week">Week ${nm.week}</span>
          </div>
          <div class="next-match-details">
            <span>${nm.date ? _fmtDate(nm.date) : '—'}</span>
            <span>${nm.time || ''}</span>
            <span>${(nm.nine || 'front').charAt(0).toUpperCase() + (nm.nine || 'front').slice(1)} 9</span>
          </div>
          <div class="next-match-opponents">
            ${oppHcps.map(o => `
              <div class="next-match-opp-row">
                <span class="opp-name">${o.name}</span>
                <span class="opp-hilo">${o.hilo || ''}</span>
                <span class="opp-hcp">${o.hcp.toFixed(1)} HCP</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
  }

  // --- Section 3: My Season stats strip ---
  const myRounds    = APP.rounds[myPlayerId] || [];
  const myHcp       = calcHcp(myRounds, config);
  const scoringAvg  = myRounds.length
    ? (myRounds.reduce((s, r) => s + (r.grossScore || r.score || 0), 0) / myRounds.length).toFixed(1)
    : '—';

  // Team record from standings
  const standings = calcStandings(APP.matches, teams);
  const myStanding = standings.find(s => s.team.id === myTeam.id);
  const record = myStanding
    ? `${myStanding.wins}-${myStanding.losses}-${myStanding.ties}`
    : '0-0-0';
  const teamRank = myStanding ? standings.indexOf(myStanding) + 1 : '—';

  const statsHtml = `
    <div class="dashboard-section">
      <div class="dash-section-title">My Season</div>
      <div class="dashboard-stat-strip">
        <div class="dashboard-stat-item">
          <div class="dashboard-stat-value">${myHcp.toFixed(1)}</div>
          <div class="dashboard-stat-label">Handicap</div>
        </div>
        <div class="dashboard-stat-item">
          <div class="dashboard-stat-value">${scoringAvg}</div>
          <div class="dashboard-stat-label">Avg Score</div>
        </div>
        <div class="dashboard-stat-item">
          <div class="dashboard-stat-value">${record}</div>
          <div class="dashboard-stat-label">Record</div>
        </div>
        <div class="dashboard-stat-item">
          <div class="dashboard-stat-value">#${teamRank}</div>
          <div class="dashboard-stat-label">Team Rank</div>
        </div>
      </div>
    </div>`;

  // --- Section 4: Recent Results (last 3 committed) ---
  const committed = myMatches
    .filter(([, m]) => m.status === 'committed' && m.result)
    .sort(([, a], [, b]) => (b.week || 0) - (a.week || 0))
    .slice(0, 3);

  let recentHtml = '';
  if (committed.length) {
    const rows = committed.map(([key, m]) => {
      const isT1  = m.team1Id === myTeam.id;
      const myPts = isT1 ? m.result.pts1 : m.result.pts2;
      const opPts = isT1 ? m.result.pts2 : m.result.pts1;
      const opp   = isT1 ? m.team2Name : m.team1Name;
      const wlt   = myPts > opPts ? 'win' : myPts < opPts ? 'loss' : 'tie';
      const badge = wlt === 'win' ? 'W' : wlt === 'loss' ? 'L' : 'T';

      // Find my gross score for this match
      const myGross = m.scores?.[myPlayerId]
        ? m.scores[myPlayerId].reduce((a, b) => a + b, 0)
        : null;

      return `
        <div class="recent-result-row" onclick="openMatch('${key}')">
          <div class="result-badge ${wlt}">${badge}</div>
          <div class="result-info">
            <div class="result-opp">vs ${opp}</div>
            <div class="result-meta">Wk ${m.week} · ${myPts}–${opPts} pts${myGross ? ` · Shot ${myGross}` : ''}</div>
          </div>
        </div>`;
    }).join('');

    recentHtml = `
      <div class="dashboard-section">
        <div class="dash-section-title">Recent Results</div>
        <div class="card">
          <div class="card-body">${rows}</div>
        </div>
      </div>`;
  }

  // --- Section 5: My Rounds (last 5) ---
  let roundsHtml = '';
  if (myRounds.length) {
    const last5 = myRounds
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    const rRows = last5.map((r, i) => {
      const gross = r.grossScore || r.score || 0;
      const prev  = last5[i + 1] ? (last5[i + 1].grossScore || last5[i + 1].score || 0) : null;
      const trend = prev ? (gross < prev ? '↓' : gross > prev ? '↑' : '—') : '';
      const trendClass = gross < (prev || gross) ? 'trend-down' : gross > (prev || gross) ? 'trend-up' : '';
      return `
        <tr>
          <td>${r.date ? _fmtDate(r.date) : `Wk ${r.week || '?'}`}</td>
          <td>${(r.nine || 'front').charAt(0).toUpperCase()}9</td>
          <td class="round-gross">${gross}</td>
          <td class="round-trend ${trendClass}">${trend}</td>
        </tr>`;
    }).join('');

    roundsHtml = `
      <div class="dashboard-section">
        <div class="dash-section-title">My Rounds</div>
        <div class="card">
          <div class="score-table-wrap">
            <table class="rounds-mini-table">
              <thead><tr><th>Date</th><th>Nine</th><th>Gross</th><th></th></tr></thead>
              <tbody>${rRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  // --- Assemble ---
  el.innerHTML = `
    <div class="dashboard-header">
      <h2>${myPlayer.name}</h2>
      <div class="dashboard-team-label">${myTeam.name} · ${myPlayer.hilo || 'LO'}</div>
    </div>
    ${actionHtml}
    ${nextHtml}
    ${statsHtml}
    ${recentHtml}
    ${roundsHtml}
  `;
}

// ---- Standings Tab ----
function renderStandings() {
  const el = document.getElementById('tab-standings');
  if (!el || !APP.config) return;

  const teams = APP.config.teams || [];
  const standing = calcStandings(APP.matches, teams);
  const totalWeeks = Object.values(APP.matches).filter(m => m.status === 'committed')
    .reduce((weeks, m) => { weeks.add(m.week); return weeks; }, new Set()).size;

  // Find max possible pts (for bar width)
  const maxPts = standing.length ? Math.max(...standing.map(r => r.pts), 1) : 1;

  el.innerHTML = `
    <div class="card mt-12">
      <div class="card-header">
        <h3>Standings</h3>
        ${totalWeeks ? `<span class="standings-weeks">Through ${totalWeeks} week${totalWeeks !== 1 ? 's' : ''}</span>` : ''}
      </div>
      <div class="score-table-wrap">
        <table class="standings-table">
          <thead><tr>
            <th>#</th><th>Team</th><th>Pts</th><th>W</th><th>L</th><th>T</th><th>GP</th>
          </tr></thead>
          <tbody>
            ${standing.map((row, i) => {
              const pct = maxPts > 0 ? (row.pts / maxPts * 100) : 0;
              const isMyTeam = APP.member?.playerId && (row.team.players || []).some(p => p.id === APP.member.playerId);
              return `
                <tr class="${isMyTeam ? 'my-team-row' : ''} ${i < 3 ? 'top-three' : ''}">
                  <td class="rank-num">
                    ${i === 0 ? '<span class="rank-badge gold">1</span>' :
                      i === 1 ? '<span class="rank-badge silver">2</span>' :
                      i === 2 ? '<span class="rank-badge bronze">3</span>' :
                      `<span class="rank-num-plain">${i + 1}</span>`}
                  </td>
                  <td class="team-name">
                    ${row.team.name}
                    <div class="pts-bar" style="width: ${pct}%"></div>
                  </td>
                  <td class="pts">${row.pts.toFixed(1)}</td>
                  <td>${row.wins}</td>
                  <td>${row.losses}</td>
                  <td>${row.ties}</td>
                  <td class="gp">${row.played}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---- Handicaps Tab ----
function renderHandicaps() {
  const el = document.getElementById('tab-handicaps');
  if (!el || !APP.config) return;

  const teams  = APP.config.teams || [];
  const config = APP.config;
  const manAdj = config.manualAdj || {};

  const allPlayers = teams.flatMap(t => (t.players || []).map(p => ({ ...p, teamName: t.name })));

  // Sort by handicap
  const sorted = allPlayers.map(player => {
    const rounds = APP.rounds[player.id] || [];
    const calc   = calcHcp(rounds, config);
    const adj    = manAdj[player.id] || 0;
    const final  = Math.min(Math.max(calc + adj, 0), config.handicap?.max || 18);
    const grossScores = rounds.map(r => r.grossScore || r.score || 0).filter(s => s > 0);
    const lastRound   = grossScores.length ? grossScores[grossScores.length - 1] : null;
    const trend = grossScores.length >= 2 ? grossScores[grossScores.length - 1] - grossScores[grossScores.length - 2] : 0;
    return { ...player, rounds: rounds.length, calc, adj, final, lastRound, trend };
  }).sort((a, b) => a.final - b.final);

  const cards = sorted.map((p, i) => `
    <div class="hcp-card">
      <div class="hcp-rank">${i + 1}</div>
      <div class="player-name">${p.name}</div>
      <div class="hcp-team-name">${p.teamName}</div>
      <div class="hcp-value">${p.final.toFixed(1)}</div>
      <div class="hcp-label">Handicap</div>
      ${p.adj ? `<div class="hcp-adj">${p.adj > 0 ? '+' : ''}${p.adj} adj</div>` : ''}
      <div class="hcp-detail">
        <span>${p.rounds} rd${p.rounds !== 1 ? 's' : ''}</span>
        ${p.lastRound ? `<span>Last: ${p.lastRound}</span>` : ''}
        ${p.trend !== 0 ? `<span class="hcp-trend ${p.trend < 0 ? 'improving' : 'declining'}">${p.trend < 0 ? '↓' : '↑'}${Math.abs(p.trend)}</span>` : ''}
      </div>
    </div>
  `).join('');

  const par = config?.course?.scorecard?.front?.reduce((a, h) => a + h.par, 0) || 35;
  const useWHS = (config?.course?.slope > 0 && config?.course?.rating > 0);
  const formulaBanner = useWHS
    ? `<div class="hcp-formula-banner">WHS Formula · Rating ${config.course.rating} · Slope ${config.course.slope}</div>`
    : `<div class="hcp-formula-banner">League Formula · Par ${par}</div>`;

  el.innerHTML = `
    <div class="mt-12">
      ${formulaBanner}
      <div class="hcp-grid">${cards || '<div class="empty-state"><p>No players yet</p></div>'}</div>
    </div>
  `;
}

// ---- Schedule Tab ----
function renderSchedule() {
  const el = document.getElementById('tab-schedule');
  if (!el || !APP.config) return;

  const schedule = APP.config.schedule || [];
  const cancelled = APP.config.cancelledWeeks || {};
  const startTime = APP.config.startTeeTime || APP.config.teeTime || '';
  const interval  = APP.config.teeInterval || 10;

  if (!schedule.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">📅</div><p>No schedule configured</p></div>';
    return;
  }

  // Find current/next week
  const today = new Date().toISOString().slice(0, 10);
  let currentWeekNum = null;
  for (const w of schedule) {
    if (w.date && w.date >= today) { currentWeekNum = w.week; break; }
  }

  // Render regular schedule weeks
  const regularHtml = schedule.map(week => {
    const isCancelled = cancelled[week.week];
    const isCurrent   = week.week === currentWeekNum;
    const isPast      = week.date && week.date < today && !isCurrent;

    // Check week status from matches
    const weekMatches = Object.values(APP.matches).filter(m => m.week == week.week);
    const allCommitted = weekMatches.length > 0 && weekMatches.every(m => m.status === 'committed');
    const hasPending   = weekMatches.some(m => m.status === 'pending');
    const isPlayoff    = _isPlayoffWeek(week.week);

    const statusChip = isCancelled ? '<span class="chip chip-cancelled">Cancelled</span>' :
      allCommitted ? '<span class="chip chip-committed">Complete</span>' :
      hasPending ? '<span class="chip chip-pending">In Progress</span>' :
      isPast ? '<span class="chip chip-draft">Not Played</span>' : '';

    // Build matchup list from actual match docs (schedule entries may not have matchups array)
    const matchups = week.matchups || [];
    const matchupList = matchups.length > 0 ? matchups : weekMatches.map(m => [m.team1Id, m.team2Id]);

    // Build tee labels from matchup count
    const teeLabelsFinal = [];
    if (startTime && matchupList.length) {
      const [h, m] = startTime.split(':').map(Number);
      matchupList.forEach((_, i) => {
        const totalMin = h * 60 + m + i * interval;
        const tH = Math.floor(totalMin / 60), tM = totalMin % 60;
        const h12 = tH > 12 ? tH - 12 : tH === 0 ? 12 : tH;
        teeLabelsFinal.push(`${h12}:${String(tM).padStart(2, '0')}`);
      });
    }

    return `
      <div class="schedule-week-card ${isCurrent ? 'schedule-current' : ''} ${isCancelled ? 'schedule-cancelled' : ''} ${isPast && !isCurrent ? 'schedule-past' : ''}">
        <div class="schedule-week-header">
          <div class="schedule-header-left">
            <span class="schedule-week-label">Week ${week.week}${isPlayoff ? ' — Playoffs' : ''}</span>
            ${statusChip}
          </div>
          <div class="schedule-header-right">
            ${week.date ? `<span class="schedule-week-date">${_fmtDate(week.date)}</span>` : ''}
            <span class="chip chip-nine">${(week.nine || 'front') === 'front' ? 'Front' : 'Back'} 9</span>
          </div>
        </div>
        ${matchupList.map(([t1id, t2id], mi) => {
          const t1 = (APP.config.teams || []).find(t => t.id === t1id);
          const t2 = (APP.config.teams || []).find(t => t.id === t2id);
          const teeLabel = teeLabelsFinal[mi] || '';
          const matchEntry = weekMatches.find(m => m.team1Id === t1id && m.team2Id === t2id);
          const result = matchEntry?.result;
          return `
            <div class="matchup-row">
              ${teeLabel ? `<span class="matchup-tee">${teeLabel}</span>` : ''}
              <div class="matchup-teams">
                <span class="matchup-team-name ${result && result.pts1 > result.pts2 ? 'matchup-winner' : ''}">${t1?.name || t1id}</span>
                ${result ? `<span class="matchup-score">${result.pts1}-${result.pts2}</span>` : '<span class="matchup-vs">vs</span>'}
                <span class="matchup-team-name ${result && result.pts2 > result.pts1 ? 'matchup-winner' : ''}">${t2?.name || t2id}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  // Render custom / makeup rounds (week 100+)
  const customRounds = APP.config.customRounds || [];
  const customHtml = customRounds.map(cr => {
    const weekMatches = Object.values(APP.matches).filter(m => m.week == cr.weekNum);
    const allCommitted = weekMatches.length > 0 && weekMatches.every(m => m.status === 'committed');
    const hasPending   = weekMatches.some(m => m.status === 'pending');
    const isPast       = cr.date && cr.date < today;

    const statusChip = allCommitted ? '<span class="chip chip-committed">Complete</span>' :
      hasPending ? '<span class="chip chip-pending">In Progress</span>' :
      isPast ? '<span class="chip chip-draft">Not Played</span>' : '';

    return `
      <div class="schedule-week-card ${isPast ? 'schedule-past' : ''}">
        <div class="schedule-week-header">
          <div class="schedule-header-left">
            <span class="schedule-week-label">${cr.label || 'Makeup'}</span>
            <span class="chip chip-makeup">MAKEUP</span>
            ${statusChip}
          </div>
          <div class="schedule-header-right">
            ${cr.date ? `<span class="schedule-week-date">${_fmtDate(cr.date)}</span>` : ''}
            <span class="chip chip-nine">${(cr.nine || 'front') === 'front' ? 'Front' : 'Back'} 9</span>
          </div>
        </div>
        ${(cr.matchups || []).map(([t1id, t2id]) => {
          const t1 = (APP.config.teams || []).find(t => t.id === t1id);
          const t2 = (APP.config.teams || []).find(t => t.id === t2id);
          const matchEntry = weekMatches.find(m => m.team1Id === t1id && m.team2Id === t2id);
          const result = matchEntry?.result;
          return `
            <div class="matchup-row">
              <div class="matchup-teams">
                <span class="matchup-team-name ${result && result.pts1 > result.pts2 ? 'matchup-winner' : ''}">${t1?.name || t1id}</span>
                ${result ? `<span class="matchup-score">${result.pts1}-${result.pts2}</span>` : '<span class="matchup-vs">vs</span>'}
                <span class="matchup-team-name ${result && result.pts2 > result.pts1 ? 'matchup-winner' : ''}">${t2?.name || t2id}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');

  el.innerHTML = regularHtml + customHtml + _renderPlayoffBracket();
}

// ---- Playoff Bracket ----
function _renderPlayoffBracket() {
  const schedule = APP.config?.schedule || [];
  const teams    = APP.config?.teams || [];
  if (schedule.length < 10 || teams.length < 4) return '';

  // Find the first playoff week from the schedule using the unified helper
  const playoffStart = schedule.reduce((first, w) => _isPlayoffWeek(w.week) && (first === 999 || w.week < first) ? w.week : first, 999);
  if (playoffStart === 999) return '';
  const standings = calcStandings(APP.matches, teams);
  if (!standings || !standings.length) return '';

  // Seed teams by standings — each entry has { team: {...}, pts, wins, ... }
  const seeded = standings.slice(0, Math.min(teams.length, 8)).map(s => ({
    ...s, teamId: s.team.id, team: s.team.name
  }));
  const numTeams = seeded.length;

  // Determine bracket size: 4-team or 8-team
  const hasQF = numTeams >= 8;
  const rounds = [];

  if (hasQF) {
    // QF: #1v#8, #4v#5, #2v#7, #3v#6
    const qfPairs = [[0,7],[3,4],[1,6],[2,5]];
    const qfRound = qfPairs.map(([a,b]) => ({
      seed1: a+1, team1: seeded[a]?.team || 'TBD', team1Id: seeded[a]?.teamId,
      seed2: b+1, team2: seeded[b]?.team || 'TBD', team2Id: seeded[b]?.teamId,
      week: playoffStart,
      result: _findPlayoffResult(seeded[a]?.teamId, seeded[b]?.teamId, playoffStart)
    }));
    rounds.push({ label: 'Quarterfinals', matches: qfRound });

    // SF: winners of QF
    const sfMatches = [
      _advanceBracketMatch(qfRound[0], qfRound[1]),
      _advanceBracketMatch(qfRound[2], qfRound[3])
    ];
    sfMatches.forEach(m => {
      m.week = playoffStart + 1;
      if (m.team1Id && m.team2Id) m.result = _findPlayoffResult(m.team1Id, m.team2Id, m.week);
    });
    rounds.push({ label: 'Semifinals', matches: sfMatches });

    // Championship
    const champMatch = _advanceBracketMatch(sfMatches[0], sfMatches[1]);
    champMatch.week = playoffStart + 2;
    if (champMatch.team1Id && champMatch.team2Id) champMatch.result = _findPlayoffResult(champMatch.team1Id, champMatch.team2Id, champMatch.week);
    rounds.push({ label: 'Championship', matches: [champMatch] });
  } else {
    // 4-team bracket: SF only
    const sfPairs = [[0,3],[1,2]];
    const sfRound = sfPairs.map(([a,b]) => ({
      seed1: a+1, team1: seeded[a]?.team || 'TBD',
      seed2: b+1, team2: seeded[b]?.team || 'TBD',
      team1Id: seeded[a]?.teamId, team2Id: seeded[b]?.teamId,
      week: playoffStart,
      result: _findPlayoffResult(seeded[a]?.teamId, seeded[b]?.teamId, playoffStart)
    }));
    rounds.push({ label: 'Semifinals', matches: sfRound });

    const champMatch = _advanceBracketMatch(sfRound[0], sfRound[1]);
    champMatch.week = playoffStart + 1;
    if (champMatch.team1Id && champMatch.team2Id) champMatch.result = _findPlayoffResult(champMatch.team1Id, champMatch.team2Id, champMatch.week);
    rounds.push({ label: 'Championship', matches: [champMatch] });
  }

  return `
    <div class="bracket-container">
      <div class="bracket-title">🏆 Playoff Bracket</div>
      <div class="bracket-rounds">
        ${rounds.map(round => `
          <div class="bracket-round">
            <div class="bracket-round-label">${round.label}</div>
            ${round.matches.map(m => `
              <div class="bracket-match ${m.result ? 'bracket-completed' : ''}">
                <div class="bracket-team ${m.result && m.result.pts1 > m.result.pts2 ? 'bracket-winner' : ''}">
                  <span class="bracket-seed">${m.seed1 || ''}</span>
                  <span class="bracket-name">${m.team1 || 'TBD'}</span>
                  ${m.result ? `<span class="bracket-pts">${m.result.pts1}</span>` : ''}
                </div>
                <div class="bracket-team ${m.result && m.result.pts2 > m.result.pts1 ? 'bracket-winner' : ''}">
                  <span class="bracket-seed">${m.seed2 || ''}</span>
                  <span class="bracket-name">${m.team2 || 'TBD'}</span>
                  ${m.result ? `<span class="bracket-pts">${m.result.pts2}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function _findPlayoffResult(team1Id, team2Id, week) {
  if (!team1Id || !team2Id) return null;
  const match = Object.values(APP.matches).find(m =>
    m.week == week && m.status === 'committed' &&
    ((m.team1Id === team1Id && m.team2Id === team2Id) || (m.team1Id === team2Id && m.team2Id === team1Id))
  );
  if (!match?.result) return null;
  // Normalize so team1 matches our bracket's team1
  if (match.team1Id === team1Id) return match.result;
  return { pts1: match.result.pts2, pts2: match.result.pts1 };
}

function _advanceBracketMatch(m1, m2) {
  const winner1 = m1.result ? (m1.result.pts1 > m1.result.pts2 ? { team: m1.team1, seed: m1.seed1, teamId: m1.team1Id } : { team: m1.team2, seed: m1.seed2, teamId: m1.team2Id }) : null;
  const winner2 = m2.result ? (m2.result.pts1 > m2.result.pts2 ? { team: m2.team1, seed: m2.seed1, teamId: m2.team1Id } : { team: m2.team2, seed: m2.seed2, teamId: m2.team2Id }) : null;
  return {
    seed1: winner1?.seed || '', team1: winner1?.team || 'TBD', team1Id: winner1?.teamId || null,
    seed2: winner2?.seed || '', team2: winner2?.team || 'TBD', team2Id: winner2?.teamId || null,
    result: null
  };
}

// ---- Rules Tab ----
function renderRules() {
  const el = document.getElementById('tab-rules');
  if (!el || !APP.config) return;

  const c = APP.config;
  const ls = c.leagueSettings || {};
  const fmt = c.format || {};
  const pvFmt = _getPV(c);
  const absentRuleFmt = _getAbsentRule(c);
  const hcpConfig = c.handicap || {};
  const course = c.course || {};
  const isCommish = APP.member?.role === 'commissioner';

  const fees = ls.fees || [];
  const conduct = ls.conduct || [];

  el.innerHTML = `
    <div class="mt-12">
      <!-- Match Format -->
      <div class="rules-card">
        <div class="rules-card-title">⛳ Match Format</div>
        <div class="rules-card-body">
          <div class="rules-item"><strong>Format:</strong> ${fmt.type === 'match_play' ? '9-Hole Match Play' : fmt.type || 'Match Play'}</div>
          <div class="rules-item"><strong>Points per Hole:</strong> ${pvFmt.hole}</div>
          <div class="rules-item"><strong>Low Net Bonus:</strong> ${pvFmt.lowNet}</div>
          ${pvFmt.birdie ? `<div class="rules-item"><strong>Birdie Bonus:</strong> ${pvFmt.birdie}</div>` : ''}
          ${pvFmt.eagle ? `<div class="rules-item"><strong>Eagle Bonus:</strong> ${pvFmt.eagle}</div>` : ''}
          <div class="rules-item"><strong>Max Points per Match:</strong> ${(pvFmt.hole * 9 + pvFmt.lowNet) * 2}</div>
          <div class="rules-item"><strong>Missing Player:</strong> ${absentRuleFmt.replace(/_/g, ' ')}</div>
        </div>
      </div>

      <!-- Handicap System -->
      <div class="rules-card">
        <div class="rules-card-title">📊 Handicap System</div>
        <div class="rules-card-body">
          <div class="rules-item"><strong>Type:</strong> ${(hcpConfig.type || 'custom_rolling').replace(/_/g, ' ')}</div>
          <div class="rules-item"><strong>Rounds Used:</strong> Best ${hcpConfig.rounds || 5} of last ${hcpConfig.rounds || 5}</div>
          <div class="rules-item"><strong>Reduction Factor:</strong> ${hcpConfig.factor ?? 0.9}</div>
          <div class="rules-item"><strong>Max Handicap:</strong> ${hcpConfig.max ?? 18}</div>
        </div>
      </div>

      <!-- Course Info -->
      ${course.name ? `
      <div class="rules-card">
        <div class="rules-card-title">🏌️ Course</div>
        <div class="rules-card-body">
          <div class="rules-item"><strong>Course:</strong> ${course.name}</div>
          ${course.location ? `<div class="rules-item"><strong>Location:</strong> ${course.location}</div>` : ''}
          ${course.tees ? `<div class="rules-item"><strong>Tees:</strong> ${course.tees}</div>` : ''}
        </div>
      </div>
      ` : ''}

      <!-- Fees -->
      <div class="rules-card">
        <div class="rules-card-title">💰 Fees</div>
        <div class="rules-card-body">
          ${fees.length ? fees.map(f => `<div class="rules-item">• ${f}</div>`).join('') :
            '<div class="rules-item" style="opacity:0.5">No fees configured</div>'}
          ${isCommish ? '<button class="btn btn-outline btn-sm mt-8" onclick="editRulesSection(\'fees\')">Edit Fees</button>' : ''}
        </div>
      </div>

      <!-- Code of Conduct -->
      <div class="rules-card">
        <div class="rules-card-title">📋 Code of Conduct</div>
        <div class="rules-card-body">
          ${conduct.length ? conduct.map(c => `<div class="rules-item">• ${c}</div>`).join('') :
            '<div class="rules-item" style="opacity:0.5">No conduct rules configured</div>'}
          ${isCommish ? '<button class="btn btn-outline btn-sm mt-8" onclick="editRulesSection(\'conduct\')">Edit Conduct</button>' : ''}
        </div>
      </div>
    </div>
  `;
}

function editRulesSection(section) {
  const ls = APP.config.leagueSettings || {};
  const current = (ls[section] || []).join('\n');
  const label = section === 'fees' ? 'Fees (one per line)' : 'Code of Conduct (one per line)';
  const input = prompt(label + ':', current);
  if (input === null) return;

  const lines = input.split('\n').map(l => l.trim()).filter(l => l);
  if (!APP.config.leagueSettings) APP.config.leagueSettings = {};
  APP.config.leagueSettings[section] = lines;

  window._FB.saveLeagueConfig({ leagueSettings: APP.config.leagueSettings })
    .then(() => { toast(`${section} updated`, 'success'); renderRules(); })
    .catch(err => { console.error('[editRulesSection]', err); toast('Failed to save', 'error'); });
}

window.editRulesSection = editRulesSection;

// ---- Recap Tab ----
function renderRecap() {
  const el = document.getElementById('tab-recap');
  if (!el || !APP.config) return;

  const committed = Object.entries(APP.matches)
    .filter(([, m]) => m.status === 'committed' && m.result)
    .sort(([, a], [, b]) => (b.week || 0) - (a.week || 0));

  if (!committed.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">📰</div><p>No completed matches to recap</p></div>';
    return;
  }

  // Group by week
  const byWeek = {};
  committed.forEach(([key, m]) => {
    const w = m.week || 0;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push([key, m]);
  });

  // Custom round label lookup
  const customRounds = APP.config.customRounds || [];
  const customByWeek = {};
  customRounds.forEach(cr => { customByWeek[cr.weekNum] = cr; });

  const weeksDesc = Object.keys(byWeek).sort((a, b) => +b - +a);

  el.innerHTML = `<div class="mt-12">${weeksDesc.map(week => {
    const weekMatches = byWeek[week];
    const firstMatch  = weekMatches[0]?.[1];
    const date = firstMatch?.date || '';
    const isCustom = +week >= 100;
    const customRound = customByWeek[+week];
    const weekLabel = isCustom ? (customRound?.label || 'Makeup') : `Week ${week}`;

    // Find biggest blowout for "Commissioner's Take"
    let biggestMargin = 0, biggestWinner = '', biggestLoser = '';

    const matchCards = weekMatches.map(([key, m]) => {
      const r = m.result;
      if (!r) return '';
      const margin = Math.abs((r.pts1 || 0) - (r.pts2 || 0));
      const winner = r.pts1 > r.pts2 ? m.team1Name : r.pts2 > r.pts1 ? m.team2Name : null;
      const loser  = r.pts1 > r.pts2 ? m.team2Name : r.pts2 > r.pts1 ? m.team1Name : null;

      if (margin > biggestMargin) {
        biggestMargin = margin;
        biggestWinner = winner || '';
        biggestLoser  = loser || '';
      }

      const tag = margin >= 12 ? 'MASSACRE' : margin >= 8 ? 'BLOWOUT' : margin >= 4 ? 'SOLID W' :
                  margin > 0 ? 'TIGHT' : 'DRAW';
      const tagClass = tag === 'MASSACRE' ? 'recap-tag-massacre' : tag === 'BLOWOUT' ? 'recap-tag-blowout' :
                       tag === 'SOLID W' ? 'recap-tag-solid' : tag === 'TIGHT' ? 'recap-tag-tight' : 'recap-tag-draw';

      return `
        <div class="recap-match">
          <span class="recap-team ${r.pts1 > r.pts2 ? 'recap-winner' : ''}">${m.team1Name}</span>
          <span class="recap-score">${r.pts1} – ${r.pts2}</span>
          <span class="recap-team ${r.pts2 > r.pts1 ? 'recap-winner' : ''}">${m.team2Name}</span>
          <span class="recap-tag ${tagClass}">${tag}</span>
        </div>`;
    }).join('');

    // Commissioner's Take
    let take = '';
    if (biggestMargin >= 12) take = `${biggestWinner} absolutely demolished ${biggestLoser}. That one hurt.`;
    else if (biggestMargin >= 8) take = `${biggestWinner} put on a clinic against ${biggestLoser}.`;
    else if (biggestMargin >= 4) take = `Solid showing by ${biggestWinner} over ${biggestLoser}.`;
    else if (biggestMargin > 0) take = `Nail-biters all around this week. Could've gone either way.`;
    else take = `Dead heat this week. Every point was earned.`;

    return `
      <div class="recap-week">
        <div class="recap-week-header">
          <div class="recap-header-left">
            <span class="recap-week-label">${weekLabel}</span>
            ${isCustom ? '<span class="chip chip-makeup">MAKEUP</span>' : ''}
          </div>
          ${date ? `<span class="recap-week-date">${_fmtDate(date)}</span>` : ''}
        </div>
        ${matchCards}
        <div class="recap-take">💬 ${take}</div>
      </div>`;
  }).join('')}</div>`;
}

// ---- History / Champions Tab ----
function renderHistory() {
  const el = document.getElementById('tab-history');
  if (!el || !APP.config) return;

  const champions = APP.config.champions || [];
  const isCommish = APP.member?.role === 'commissioner';

  if (!champions.length && !isCommish) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">🏆</div><p>No champions recorded yet</p></div>';
    return;
  }

  // Dynasty stats
  const titleCounts = {};
  champions.forEach(ch => {
    const key = ch.team || 'Unknown';
    titleCounts[key] = (titleCounts[key] || 0) + 1;
  });
  const mostTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1])[0];
  const uniqueChamps = Object.keys(titleCounts).length;
  const defending = champions.length ? champions[champions.length - 1] : null;

  el.innerHTML = `
    <div class="mt-12">
      ${champions.length ? `
        <!-- Dynasty Stats -->
        <div class="history-stats-grid">
          <div class="history-stat-card">
            <div class="history-stat-val">${champions.length}</div>
            <div class="history-stat-label">Seasons</div>
          </div>
          <div class="history-stat-card">
            <div class="history-stat-val">${uniqueChamps}</div>
            <div class="history-stat-label">Unique Champions</div>
          </div>
          ${mostTitles ? `
          <div class="history-stat-card">
            <div class="history-stat-val">${mostTitles[1]}</div>
            <div class="history-stat-label">Most Titles<br><small>${mostTitles[0]}</small></div>
          </div>` : ''}
          ${defending ? `
          <div class="history-stat-card">
            <div class="history-stat-val">🏆</div>
            <div class="history-stat-label">Defending<br><small>${defending.team}</small></div>
          </div>` : ''}
        </div>

        <!-- Champions List -->
        <div class="champions-list">
          ${champions.slice().reverse().map(ch => `
            <div class="champion-card">
              <div class="champion-year">${ch.year}</div>
              <div class="champion-info">
                <div class="champion-team">${ch.team}</div>
                ${ch.players ? `<div class="champion-players">${ch.players}</div>` : ''}
                ${ch.tagline ? `<div class="champion-tagline">"${ch.tagline}"</div>` : ''}
                ${ch.note ? `<div class="champion-note">${ch.note}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${isCommish ? `
        <!-- Add Champion Form -->
        <div class="admin-section mt-12">
          <div class="admin-section-title">🏆 Record Champion</div>
          <div class="settings-row"><label>Year</label><input class="field" id="ch-year" type="number" value="${new Date().getFullYear()}" /></div>
          <div class="settings-row"><label>Team Name</label><input class="field" id="ch-team" placeholder="e.g. Fisher/Butler" /></div>
          <div class="settings-row"><label>Players</label><input class="field" id="ch-players" placeholder="e.g. Trey Fisher & Matt Butler" /></div>
          <div class="settings-row"><label>Tagline</label><input class="field" id="ch-tagline" placeholder="e.g. Dominated from wire to wire" /></div>
          <div class="settings-row"><label>Note</label><input class="field" id="ch-note" placeholder="e.g. Inaugural season" /></div>
          <button class="btn btn-green btn-sm" onclick="addChampion()">Add Champion</button>
        </div>
      ` : ''}
    </div>
  `;
}

async function addChampion() {
  const year    = parseInt(document.getElementById('ch-year')?.value) || new Date().getFullYear();
  const team    = document.getElementById('ch-team')?.value?.trim();
  const players = document.getElementById('ch-players')?.value?.trim() || '';
  const tagline = document.getElementById('ch-tagline')?.value?.trim() || '';
  const note    = document.getElementById('ch-note')?.value?.trim() || '';

  if (!team) { toast('Enter a team name', 'error'); return; }

  const champions = APP.config.champions || [];
  champions.push({ year, team, players, tagline, note });
  APP.config.champions = champions;

  try {
    await window._FB.saveLeagueConfig({ champions });
    toast('Champion recorded!', 'success');
    renderHistory();
  } catch (err) {
    console.error('[addChampion]', err);
    toast('Failed to save', 'error');
  }
}

window.addChampion = addChampion;

// ---- Skins Tab ----
function renderSkins() {
  const el = document.getElementById('tab-skins');
  if (!el || !APP.config) return;

  const allMatches = APP.matches;
  const schedule   = APP.config.schedule || [];

  // Find weeks that have at least one committed match
  const playedWeeks = [];
  schedule.forEach(w => {
    const hasCommitted = Object.values(allMatches).some(m => m.week == w.week && m.status === 'committed');
    if (hasCommitted) playedWeeks.push(w.week);
  });

  if (!playedWeeks.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">💰</div><p>No completed rounds yet for skins</p></div>';
    return;
  }

  // Default to latest played week
  const currentWeek = window._skinsWeek || playedWeeks[playedWeeks.length - 1];

  // Week selector
  const weekOpts = playedWeeks.map(w =>
    `<option value="${w}" ${w == currentWeek ? 'selected' : ''}>Week ${w}</option>`
  ).join('');

  // Calc skins for selected week
  const skins = calcWeeklySkins(currentWeek, allMatches, APP.config);

  // Build hole rows
  const holeRows = skins.holes.map(h => {
    if (h.carryover) {
      return `
        <div class="skin-row carryover">
          <div class="skin-hole">${h.hole}</div>
          <div class="skin-par">Par ${h.par}</div>
          <div class="skin-winner">Carryover →</div>
          <div class="skin-score"></div>
          <div class="skin-pot"></div>
        </div>`;
    }
    return `
      <div class="skin-row">
        <div class="skin-hole">${h.hole}</div>
        <div class="skin-par">Par ${h.par}</div>
        <div class="skin-winner">${h.winnerName}</div>
        <div class="skin-score">${h.score}</div>
        <div class="skin-pot">${h.pot > 1 ? `${h.pot} skins` : '1 skin'}</div>
      </div>`;
  }).join('');

  // Season totals (across all played weeks)
  const seasonTotals = {};
  playedWeeks.forEach(w => {
    const ws = calcWeeklySkins(w, allMatches, APP.config);
    Object.entries(ws.players).forEach(([pid, count]) => {
      seasonTotals[pid] = (seasonTotals[pid] || 0) + count;
    });
  });

  const teams = APP.config.teams || [];
  const pName = (pid) => {
    for (const t of teams) {
      const p = (t.players || []).find(pl => pl.id === pid);
      if (p) return p.name;
    }
    return pid;
  };

  const leaderboard = Object.entries(seasonTotals)
    .map(([pid, count]) => ({ pid, name: pName(pid), count }))
    .sort((a, b) => b.count - a.count);

  const leaderRows = leaderboard.map((row, i) => `
    <div class="stat-row">
      <span class="rank">${i + 1}</span>
      <span class="name">${row.name}</span>
      <span class="val">${row.count}</span>
    </div>
  `).join('');

  // Skins buy-in info
  const buyIn = APP.config.format?.skinsBuyIn || 0;
  const numPlayers = Object.values(APP.matches).filter(m => m.week == currentWeek && m.status === 'committed' && m.scores)
    .reduce((pids, m) => { Object.keys(m.scores).forEach(pid => pids.add(pid)); return pids; }, new Set()).size;
  const weekPot = buyIn * numPlayers;

  el.innerHTML = `
    <div class="card mt-12">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
        <h3>Skins</h3>
        <select class="skins-week-select" onchange="window._skinsWeek=+this.value;renderSkins()">
          ${weekOpts}
        </select>
      </div>
      <div class="card-body">
        <div class="skins-summary">
          <span>Week ${currentWeek} · ${skins.totalSkins} skin${skins.totalSkins !== 1 ? 's' : ''} won</span>
          ${buyIn > 0 ? `<span class="skins-pot-label">Pot: $${weekPot} ($${buyIn}/player)</span>` : ''}
        </div>
        <div class="skins-hole-list">
          <div class="skin-row skin-header">
            <div class="skin-hole">#</div>
            <div class="skin-par">Par</div>
            <div class="skin-winner">Winner</div>
            <div class="skin-score">Score</div>
            <div class="skin-pot">Value</div>
          </div>
          ${holeRows}
        </div>
      </div>
    </div>
    ${leaderboard.length ? `
    <div class="card mt-12">
      <div class="card-header"><h3>Season Skins Leaderboard</h3></div>
      <div class="card-body">
        ${leaderboard.map((row, i) => {
          const skinValue = buyIn > 0 && skins.totalSkins > 0 ? (weekPot / skins.totalSkins * row.count).toFixed(0) : '';
          return `
            <div class="stat-row ${i < 3 ? 'top-skin' : ''}">
              <span class="rank">${i + 1}</span>
              <span class="name">${row.name}</span>
              <span class="val">${row.count} skins${skinValue ? ` · $${skinValue}` : ''}</span>
            </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;
}
window.renderSkins = renderSkins;

// ---- Stats Tab ----
function calcAllPlayerStats(config, matches, rounds) {
  const teams = config.teams || [];
  const allPlayers = teams.flatMap(t => (t.players || []).map(p => ({ ...p, teamName: t.name, teamId: t.id })));

  return allPlayers.map(player => {
    const pid = player.id;
    const pRounds = rounds[pid] || [];
    const grossScores = pRounds.map(r => r.grossScore || r.score || 0).filter(s => s > 0);

    // Basic scoring
    const roundsPlayed = grossScores.length;
    const scoringAvg   = roundsPlayed ? grossScores.reduce((a, b) => a + b, 0) / roundsPlayed : 0;
    const lowRound     = roundsPlayed ? Math.min(...grossScores) : 0;

    // Hole-by-hole stats (birdies, pars, bogeys, eagles)
    let birdies = 0, pars = 0, bogeys = 0, doubles = 0, eagles = 0, holesPlayed = 0;
    Object.entries(matches).forEach(([, m]) => {
      if (m.status !== 'committed' || !m.scores?.[pid]) return;
      const nine  = m.nine || 'front';
      const holes = config.course?.scorecard?.[nine] || _defaultHoles(nine);
      m.scores[pid].forEach((s, i) => {
        if (!s || !holes[i]) return;
        holesPlayed++;
        const diff = s - holes[i].par;
        if (diff <= -2) eagles++;
        else if (diff === -1) birdies++;
        else if (diff === 0) pars++;
        else if (diff === 1) bogeys++;
        else doubles++;
      });
    });

    // Match record (team level)
    let matchWins = 0, matchLosses = 0, matchTies = 0, matchPts = 0;
    Object.values(matches).forEach(m => {
      if (m.status !== 'committed' || !m.result) return;
      const isT1 = m.team1Id === player.teamId;
      const isT2 = m.team2Id === player.teamId;
      if (!isT1 && !isT2) return;
      const myPts = isT1 ? m.result.pts1 : m.result.pts2;
      const opPts = isT1 ? m.result.pts2 : m.result.pts1;
      matchPts += myPts;
      if (myPts > opPts) matchWins++;
      else if (myPts < opPts) matchLosses++;
      else matchTies++;
    });

    const totalMatches = matchWins + matchLosses + matchTies;
    const winPct = totalMatches ? matchWins / totalMatches : 0;

    return {
      ...player,
      roundsPlayed, scoringAvg, lowRound,
      birdies, pars, bogeys, doubles, eagles, holesPlayed,
      matchWins, matchLosses, matchTies, matchPts, winPct
    };
  });
}

function renderStats() {
  const el = document.getElementById('tab-stats');
  if (!el || !APP.config) return;

  const stats = calcAllPlayerStats(APP.config, APP.matches, APP.rounds);
  const active = stats.filter(s => s.roundsPlayed > 0);

  if (!active.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">📊</div><p>No rounds played yet</p></div>';
    return;
  }

  // Leaderboard builder
  const board = (title, data, valFn, fmtFn, sortDir = 'desc') => {
    const sorted = data.slice().sort((a, b) =>
      sortDir === 'desc' ? valFn(b) - valFn(a) : valFn(a) - valFn(b)
    ).slice(0, 5);

    const rows = sorted.map((p, i) => `
      <div class="stat-row">
        <span class="rank">${i + 1}</span>
        <span class="name">${p.name}</span>
        <span class="val">${fmtFn(p)}</span>
      </div>
    `).join('');

    return `
      <div class="card stats-card">
        <div class="card-header"><h3>${title}</h3></div>
        <div class="card-body">${rows}</div>
      </div>`;
  };

  el.innerHTML = `
    <div class="stats-grid mt-12">
      ${board('Scoring Average', active, p => -p.scoringAvg, p => p.scoringAvg.toFixed(1), 'desc')}
      ${board('Low Round', active, p => -p.lowRound, p => p.lowRound, 'desc')}
      ${board('Match Points', active, p => p.matchPts, p => p.matchPts.toFixed(1))}
      ${board('Win %', active.filter(p => (p.matchWins + p.matchLosses + p.matchTies) >= 2), p => p.winPct, p => (p.winPct * 100).toFixed(0) + '%')}
      ${board('Birdies', active, p => p.birdies, p => p.birdies)}
      ${board('Iron Man (Rounds)', active, p => p.roundsPlayed, p => p.roundsPlayed)}
    </div>
  `;
}

// ---- Admin Scores Tab ----
function renderAdminScores() {
  const el = document.getElementById('tab-admin-scores');
  if (!el || !APP.config || APP.member?.role !== 'commissioner') return;

  const matches = Object.entries(APP.matches);
  if (!matches.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">⚙️</div><p>No matches yet</p></div>';
    return;
  }

  // Group by status priority: pending → draft → committed
  const pending   = matches.filter(([, m]) => m.status === 'pending');
  const draft     = matches.filter(([, m]) => m.status === 'draft');
  const committed = matches.filter(([, m]) => m.status === 'committed');

  const renderGroup = (title, items, actions, icon) => {
    if (!items.length) return '';
    // Sort by week
    items.sort(([, a], [, b]) => (a.week || 0) - (b.week || 0));
    return `
      <div class="admin-section">
        <div class="admin-section-title">${icon ? icon + ' ' : ''}${title} (${items.length})</div>
        ${items.map(([key, m]) => `
          <div class="match-card admin-match-card">
            <div class="match-card-teams">
              <div class="match-team-block">
                <span class="match-team-name">${m.team1Name || 'Team 1'}</span>
                ${m.result ? `<span class="match-team-pts">${m.result.pts1 ?? ''}</span>` : ''}
              </div>
              <span class="match-vs">vs</span>
              <div class="match-team-block right">
                <span class="match-team-name">${m.team2Name || 'Team 2'}</span>
                ${m.result ? `<span class="match-team-pts">${m.result.pts2 ?? ''}</span>` : ''}
              </div>
            </div>
            <div class="match-card-footer">
              <span class="chip chip-${m.status}">${_statusLabel(m.status)}</span>
              <span class="admin-match-meta">Wk ${m.week} · ${m.date ? _fmtDate(m.date) : ''} · ${(m.nine || 'front') === 'front' ? 'F9' : 'B9'}</span>
              ${m.forceCommitted ? '<span class="chip chip-force">Force</span>' : ''}
            </div>
            <div class="admin-match-actions">
              ${actions(key, m)}
            </div>
          </div>
        `).join('')}
      </div>`;
  };

  // Summary stats
  const totalMatches = matches.length;
  const pctDone = totalMatches ? Math.round(committed.length / totalMatches * 100) : 0;

  el.innerHTML = `
    <div class="mt-12">
      <div class="admin-scores-summary">
        <div class="admin-stat-chip"><span class="admin-stat-num">${committed.length}</span><span class="admin-stat-label">Complete</span></div>
        <div class="admin-stat-chip pending"><span class="admin-stat-num">${pending.length}</span><span class="admin-stat-label">Pending</span></div>
        <div class="admin-stat-chip draft"><span class="admin-stat-num">${draft.length}</span><span class="admin-stat-label">Not Started</span></div>
        <div class="admin-stat-chip"><span class="admin-stat-num">${pctDone}%</span><span class="admin-stat-label">Done</span></div>
      </div>
      ${renderGroup('Pending Approval', pending, (key) => `
        <button class="btn btn-green btn-sm" onclick="adminForceApprove('${key}')">Force Approve</button>
        <button class="btn btn-outline btn-sm" onclick="openMatch('${key}')">View Scores</button>
      `, '⏳')}
      ${renderGroup('Not Started', draft, (key) => `
        <button class="btn btn-outline btn-sm" onclick="openMatch('${key}')">Enter Scores</button>
      `, '📝')}
      ${renderGroup('Completed', committed, (key) => `
        <button class="btn btn-outline btn-sm" onclick="openMatch('${key}')">View</button>
        <button class="btn btn-danger btn-sm" onclick="adminUnlockMatch('${key}')">Unlock</button>
      `, '✅')}
    </div>
  `;
}

async function adminForceApprove(matchKey) {
  const match = APP.matches[matchKey];
  if (!match || !match.scores) { toast('No scores to approve', 'error'); return; }

  // Recalculate result from stored scores
  const config = APP.config;
  const nine   = match.nine || 'front';
  const holes  = config.course?.scorecard?.[nine] || _defaultHoles(nine);
  const teams  = config.teams || [];
  const pv     = _getPV(config);

  const t1 = teams.find(t => t.id === match.team1Id);
  const t2 = teams.find(t => t.id === match.team2Id);
  if (!t1 || !t2) { toast('Teams not found', 'error'); return; }

  const hcp = (p) => p ? calcHcp(APP.rounds[p.id] || [], config) : 0;
  const [p1hi, p1lo] = _splitHiLo(t1, hcp);
  const [p2hi, p2lo] = _splitHiLo(t2, hcp);

  const s = match.scores;
  let pts1 = 0, pts2 = 0;

  // HI match
  if (s[p1hi?.id] && s[p2hi?.id]) {
    const res = calcMatch(s[p1hi.id], s[p2hi.id], hcp(p1hi), hcp(p2hi), holes, pv);
    pts1 += res.pts1; pts2 += res.pts2;
  }
  // LO match
  if (s[p1lo?.id] && s[p2lo?.id]) {
    const res = calcMatch(s[p1lo.id], s[p2lo.id], hcp(p1lo), hcp(p2lo), holes, pv);
    pts1 += res.pts1; pts2 += res.pts2;
  }

  const result = { team1Id: match.team1Id, team2Id: match.team2Id, pts1, pts2 };

  try {
    await window._FB.forceCommitMatch(matchKey, result);
    // Also commit player rounds
    _commitScoresToPlayerRounds(s, match);
    toast('Match force-approved', 'success');
  } catch (err) {
    console.error('[adminForceApprove]', err);
    toast('Failed to force-approve', 'error');
  }
}

async function adminUnlockMatch(matchKey) {
  try {
    await window._FB.unlockMatch(matchKey);
    toast('Match unlocked', 'success');
  } catch (err) {
    console.error('[adminUnlockMatch]', err);
    toast('Failed to unlock', 'error');
  }
}
window.adminForceApprove = adminForceApprove;
window.adminUnlockMatch  = adminUnlockMatch;

// Helper: split team into HI/LO players
function _splitHiLo(team, hcpFn) {
  const players = team.players || [];
  if (players.length < 2) return [players[0] || null, players[0] || null];
  const sorted = players.slice().sort((a, b) => hcpFn(b) - hcpFn(a));
  return [sorted[0], sorted[1]]; // [HI, LO]
}

// ---- Admin Teams Tab ----
function renderAdminTeams() {
  const el = document.getElementById('tab-admin-teams');
  if (!el || !APP.config || APP.member?.role !== 'commissioner') return;

  const teams = APP.config.teams || [];

  if (!teams.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">👥</div><p>No teams configured</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="mt-12">
      <div class="admin-section">
        <div class="admin-section-title">Edit Teams & Players</div>
        <div id="admin-teams-list">
          ${teams.map((t, ti) => `
            <div class="admin-team-card" data-team-idx="${ti}">
              <div class="admin-team-header">
                <input class="field admin-team-name" value="${t.name || ''}" data-team-idx="${ti}" placeholder="Team name" />
              </div>
              <div class="admin-team-players">
                ${(t.players || []).map((p, pi) => `
                  <div class="admin-player-row" data-player-idx="${pi}">
                    <input class="field admin-player-name" value="${p.name || ''}" data-team-idx="${ti}" data-player-idx="${pi}" placeholder="Player name" />
                    <button class="player-hilo ${(p.hilo || 'lo').toLowerCase()}" onclick="adminToggleHiLo(${ti},${pi})" data-team-idx="${ti}" data-player-idx="${pi}" data-hilo="${p.hilo || 'LO'}">${p.hilo || 'LO'}</button>
                    <button class="btn btn-danger btn-sm" onclick="adminRemovePlayer(${ti},${pi})">✕</button>
                  </div>
                `).join('')}
                <button class="btn btn-outline btn-sm mt-8" onclick="adminAddPlayer(${ti})">+ Add Player</button>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="admin-save-bar">
          <button class="btn btn-green" onclick="adminSaveTeams()">Save Team Changes</button>
        </div>
      </div>
    </div>
  `;
}

function adminToggleHiLo(ti, pi) {
  const teams = APP.config.teams;
  const player = teams[ti]?.players?.[pi];
  if (!player) return;
  player.hilo = player.hilo === 'HI' ? 'LO' : 'HI';
  renderAdminTeams();
}

function adminAddPlayer(ti) {
  const teams = APP.config.teams;
  if (!teams[ti]) return;
  const players = teams[ti].players || [];
  const newId = `p${Date.now()}`;
  players.push({ id: newId, name: '', hilo: players.length === 0 ? 'LO' : 'HI' });
  teams[ti].players = players;
  renderAdminTeams();
}

function adminRemovePlayer(ti, pi) {
  const teams = APP.config.teams;
  if (!teams[ti]?.players?.[pi]) return;
  teams[ti].players.splice(pi, 1);
  renderAdminTeams();
}

async function adminSaveTeams() {
  // Read current values from DOM inputs
  const teams = APP.config.teams || [];
  const teamCards = document.querySelectorAll('.admin-team-card');

  teamCards.forEach(card => {
    const ti = +card.dataset.teamIdx;
    const nameInput = card.querySelector('.admin-team-name');
    if (nameInput && teams[ti]) teams[ti].name = nameInput.value.trim();

    card.querySelectorAll('.admin-player-row').forEach(row => {
      const pi = +row.dataset.playerIdx;
      const pNameInput = row.querySelector('.admin-player-name');
      if (pNameInput && teams[ti]?.players?.[pi]) {
        teams[ti].players[pi].name = pNameInput.value.trim();
      }
    });
  });

  try {
    await window._FB.saveLeagueConfig({ teams });
    toast('Teams saved', 'success');
  } catch (err) {
    console.error('[adminSaveTeams]', err);
    toast('Failed to save teams', 'error');
  }
}

window.adminToggleHiLo   = adminToggleHiLo;
window.adminAddPlayer    = adminAddPlayer;
window.adminRemovePlayer = adminRemovePlayer;
window.adminSaveTeams    = adminSaveTeams;

// ---- Admin Settings Tab ----
function renderAdminSettings() {
  const el = document.getElementById('tab-admin-settings');
  if (!el || !APP.config || APP.member?.role !== 'commissioner') return;

  const c = APP.config;
  const hcpConfig = c.handicap || {};
  const fmtConfig = c.format || {};
  const pv = _getPV(APP.config);
  // Normalize handicap system type — wizard writes "custom" / admin used to write "custom_rolling"
  const sysType = (hcpConfig.type === 'custom_rolling' ? 'custom' : hcpConfig.type) || hcpConfig.system || 'custom';
  const dropVal = hcpConfig.drop || 'none';
  const schedule  = c.schedule || [];
  const teams     = c.teams || [];
  const manAdj    = c.manualAdj || {};
  const hcpExcluded = c.hcpExcludedWeeks || [];
  const cancelledWeeks = c.cancelledWeeks || {};

  // Build season dates editor rows
  const seasonDatesRows = schedule.map(w => {
    const excluded = hcpExcluded.includes(w.week);
    const cancelled = cancelledWeeks[w.week];
    const isPlayoff = _isPlayoffWeek(w.week);
    return `
      <div class="season-date-row ${cancelled ? 'cancelled' : ''}" data-week="${w.week}">
        <span class="sd-week">W${w.week}</span>
        <input class="field sd-date-input" type="date" value="${w.date || ''}" data-week="${w.week}" />
        <div class="sd-nine-toggle">
          <button class="btn-xs ${w.nine === 'front' ? 'active' : ''}" onclick="adminSetNine(${w.week},'front')">F</button>
          <button class="btn-xs ${w.nine === 'back' ? 'active' : ''}" onclick="adminSetNine(${w.week},'back')">B</button>
        </div>
        <label class="sd-hcp-toggle" title="Include in handicap calc">
          <input type="checkbox" ${!excluded ? 'checked' : ''} onchange="adminToggleHcpWeek(${w.week}, this.checked)" />
          <span class="sd-hcp-label">HCP</span>
        </label>
        <button class="btn-xs btn-cancel-week ${cancelled ? 'active' : ''}" onclick="adminToggleCancelWeek(${w.week})" title="${cancelled ? 'Restore week' : 'Cancel week'}">
          ${cancelled ? '↩' : '🚫'}
        </button>
        <button class="btn-xs btn-playoff-week ${isPlayoff ? 'active' : ''}" onclick="adminTogglePlayoffWeek(${w.week})" title="${isPlayoff ? 'Playoff week — click for Standard' : 'Standard week — click for Playoff'}">
          ${isPlayoff ? 'PO' : 'REG'}
        </button>
      </div>`;
  }).join('');

  // Build handicap adjustments table
  const allPlayers = teams.flatMap(t => (t.players || []).map(p => ({ ...p, teamName: t.name })));
  const hcpAdjRows = allPlayers.map(p => {
    const rounds = APP.rounds[p.id] || [];
    const calc = calcHcp(rounds, c);
    const adj = manAdj[p.id] || 0;
    const final = Math.min(Math.max(calc + adj, 0), hcpConfig.max || 18);
    return `
      <tr>
        <td class="hcpadj-name">${p.name}</td>
        <td class="hcpadj-calc">${calc.toFixed(1)}</td>
        <td class="hcpadj-adj">
          <input type="number" class="field field-sm hcpadj-input" value="${adj}" step="0.5" min="-18" max="18" data-pid="${p.id}" onchange="adminSetHcpAdj('${p.id}', this.value)" />
        </td>
        <td class="hcpadj-final">${final.toFixed(1)}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="mt-12">
      <!-- League Info -->
      <div class="admin-section">
        <div class="admin-section-title">League Info</div>
        <div class="settings-row">
          <label>League Name</label>
          <input class="field" id="as-league-name" value="${c.leagueName || ''}" />
        </div>
        <div class="settings-row">
          <label>Season Year</label>
          <input class="field" type="number" id="as-season-year" value="${c.seasonYear || new Date().getFullYear()}" min="2020" max="2040" />
        </div>
        <div class="settings-row">
          <label>Day of Week</label>
          <select class="field" id="as-day-of-week">
            ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(d =>
              `<option value="${d}" ${(c.dayOfWeek || '') === d ? 'selected' : ''}>${d}</option>`
            ).join('')}
          </select>
        </div>
        <div class="settings-row">
          <label>Start Tee Time</label>
          <input class="field" type="time" id="as-tee-time" value="${c.startTeeTime || c.teeTime || ''}" />
        </div>
        <div class="settings-row">
          <label>Tee Interval (min)</label>
          <input class="field" type="number" id="as-tee-interval" value="${c.teeInterval || 10}" min="5" max="30" step="1" />
        </div>
      </div>

      <!-- Season Dates -->
      <div class="admin-section">
        <div class="admin-section-title">Season Dates & Nines</div>
        <p class="admin-help-text">Set dates, front/back 9, handicap inclusion, and cancel weeks.</p>
        <div class="season-dates-grid">
          <div class="season-date-row sd-header">
            <span class="sd-week">Wk</span>
            <span class="sd-date-input">Date</span>
            <span class="sd-nine-toggle">9</span>
            <span class="sd-hcp-label">HCP</span>
            <span class="btn-xs" style="visibility:hidden">X</span>
            <span class="btn-playoff-week" style="visibility:hidden">PO</span>
          </div>
          ${seasonDatesRows}
        </div>
        <div class="admin-save-bar" style="position:static;background:none;padding:10px 0">
          <button class="btn btn-green btn-sm" onclick="adminSaveSeasonDates()">Save Season Dates</button>
        </div>
      </div>

      <!-- Course -->
      <div class="admin-section">
        <div class="admin-section-title">Course</div>
        <div class="settings-row">
          <label>Course Name</label>
          <input class="field" id="as-course-name" value="${c.course?.name || ''}" />
        </div>
        <div class="settings-row">
          <label>Location</label>
          <input class="field" id="as-course-location" value="${c.course?.location || ''}" />
        </div>
        <div class="settings-row">
          <label>Tees</label>
          <input class="field" id="as-course-tees" value="${c.course?.tees || ''}" />
        </div>
        <div class="settings-row">
          <label>Course Rating (18-hole)</label>
          <input class="field" type="number" id="as-course-rating" value="${c.course?.rating || ''}" min="55" max="80" step="0.1" placeholder="e.g. 70.7" />
        </div>
        <div class="settings-row">
          <label>Slope Rating</label>
          <input class="field" type="number" id="as-course-slope" value="${c.course?.slope || ''}" min="55" max="155" step="1" placeholder="e.g. 125" />
        </div>
        <p class="admin-help-text">Optional: When both are set, handicaps use the WHS differential formula. Leave empty for the default league formula.</p>
      </div>

      <!-- Scoring Format -->
      <div class="admin-section">
        <div class="admin-section-title">Scoring Format</div>
        <div class="settings-row">
          <label>Format</label>
          <input class="field" id="as-format-type" value="${fmtConfig.type || 'match_play'}" readonly />
        </div>
        <div class="settings-row">
          <label>Points per Hole Win</label>
          <input class="field" type="number" id="as-pv-hole" value="${pv.hole ?? 1}" min="0" step="0.5" />
        </div>
        <div class="settings-row">
          <label>Low Net Bonus</label>
          <input class="field" type="number" id="as-pv-lownet" value="${pv.lowNet ?? 1}" min="0" step="0.5" />
        </div>
        <div class="settings-row">
          <label>Team Net Bonus</label>
          <input class="field" type="number" id="as-pv-teamnet" value="${pv.teamNet ?? 0}" min="0" step="0.5" />
        </div>
        <div class="settings-row">
          <label>Birdie Bonus</label>
          <input class="field" type="number" id="as-pv-birdie" value="${pv.birdie ?? 0}" min="0" step="0.5" />
        </div>
        <div class="settings-row">
          <label>Eagle Bonus</label>
          <input class="field" type="number" id="as-pv-eagle" value="${pv.eagle ?? 0}" min="0" step="0.5" />
        </div>
        <div class="settings-row">
          <label>Missing Player Rule</label>
          <select class="field" id="as-absent-rule">
            ${['blind_avg','last_score','worst_score','fixed_score','forfeit','half_pts','plays_both'].map(r =>
              `<option value="${r}" ${_getAbsentRule(APP.config) === r ? 'selected' : ''}>${r.replace(/_/g, ' ')}</option>`
            ).join('')}
          </select>
        </div>
        <div class="settings-row" id="as-absent-fixed-row" style="display:${_getAbsentRule(APP.config) === 'fixed_score' ? '' : 'none'}">
          <label>Fixed Score</label>
          <input class="field" type="number" id="as-absent-fixed" value="${fmtConfig.absentFixedScore || 50}" min="30" max="80" />
        </div>
      </div>

      <!-- Handicap System -->
      <div class="admin-section">
        <div class="admin-section-title">Handicap System</div>
        <div class="settings-row">
          <label>Handicap System</label>
          <div class="toggle-group" id="as-tg-hcpsys">
            <button type="button" class="toggle-btn ${sysType === 'custom' ? 'active' : ''}" data-value="custom">Custom Rolling</button>
            <button type="button" class="toggle-btn ${sysType === 'whs' ? 'active' : ''}" data-value="whs">WHS</button>
            <button type="button" class="toggle-btn ${sysType === 'manual' ? 'active' : ''}" data-value="manual">Manual</button>
            <button type="button" class="toggle-btn ${sysType === 'scratch' ? 'active' : ''}" data-value="scratch">Scratch</button>
          </div>
          <input type="hidden" id="as-hcp-type" value="${sysType}" />
        </div>
        <div id="as-hcp-custom-settings" style="display:${['scratch','manual'].includes(sysType) ? 'none' : ''}">
          <div class="settings-row">
            <label>Rounds Used to Calculate</label>
            <div style="display:flex;align-items:center;gap:12px;margin-top:4px">
              <input type="range" id="as-hcp-rounds" min="1" max="20" value="${hcpConfig.rounds ?? 5}" style="flex:1"
                oninput="document.getElementById('as-hcp-rounds-display').textContent=this.value" />
              <span id="as-hcp-rounds-display" style="font-size:18px;font-weight:700;color:var(--ac);min-width:28px">${hcpConfig.rounds ?? 5}</span>
            </div>
          </div>
          <div class="settings-row">
            <label>Drop Scores</label>
            <div class="toggle-group" id="as-tg-hcpdrop">
              <button type="button" class="toggle-btn ${dropVal === 'none' ? 'active' : ''}" data-value="none">None</button>
              <button type="button" class="toggle-btn ${dropVal === 'low' ? 'active' : ''}" data-value="low">Drop Lowest</button>
              <button type="button" class="toggle-btn ${dropVal === 'high' ? 'active' : ''}" data-value="high">Drop Highest</button>
              <button type="button" class="toggle-btn ${dropVal === 'both' ? 'active' : ''}" data-value="both">Drop Both</button>
            </div>
            <input type="hidden" id="as-hcp-drop" value="${dropVal}" />
          </div>
          <div class="settings-row-pair">
            <div class="settings-row">
              <label>Reduction Factor</label>
              <input class="field" type="number" id="as-hcp-factor" value="${hcpConfig.factor ?? 0.9}" min="0.5" max="1" step="0.05" />
              <p class="admin-help-text" style="margin-top:2px">0.9 = 90% of index</p>
            </div>
            <div class="settings-row">
              <label>Max Handicap</label>
              <input class="field" type="number" id="as-hcp-max" value="${hcpConfig.max ?? 18}" min="1" max="54" />
            </div>
          </div>
        </div>
      </div>

      <!-- Handicap Adjustments -->
      <div class="admin-section">
        <div class="admin-section-title">Handicap Adjustments</div>
        <p class="admin-help-text">Manual adjustments add/subtract from calculated handicap.</p>
        <div class="score-table-wrap">
          <table class="hcpadj-table">
            <thead><tr><th>Player</th><th>Calc</th><th>Adj</th><th>Final</th></tr></thead>
            <tbody>${hcpAdjRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Absent Player Overrides -->
      <div class="admin-section">
        <div class="admin-section-title">Mark Players Absent</div>
        <p class="admin-help-text">Mark a player absent for a specific week. Their score will be generated using the Missing Player Rule above.</p>
        <div class="settings-row" style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label>Week</label>
            <select class="field" id="as-absent-ovr-week">
              ${schedule.map(w => `<option value="${w.week}">Week ${w.week}${w.date ? ' — ' + w.date : ''}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1">
            <label>Player</label>
            <select class="field" id="as-absent-ovr-player">
              ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
          <button type="button" class="btn btn-green btn-sm" onclick="adminMarkAbsent()">Mark Absent</button>
        </div>
        <div id="as-absent-ovr-list" class="absent-overrides-list">
          ${_renderAbsentOverrides(c, allPlayers, schedule)}
        </div>
      </div>

      <!-- Skins -->
      <div class="admin-section">
        <div class="admin-section-title">Skins</div>
        <div class="settings-row">
          <label>Skins Enabled</label>
          <label class="toggle-switch">
            <input type="checkbox" id="as-skins-enabled" ${fmtConfig.skinsEnabled ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <label>Net Skins</label>
          <label class="toggle-switch">
            <input type="checkbox" id="as-skins-net" ${fmtConfig.skinsNet ? 'checked' : ''} />
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="settings-row">
          <label>Buy-In per Week ($)</label>
          <input class="field" type="number" id="as-skins-buyin" value="${fmtConfig.skinsBuyIn || 0}" min="0" step="1" />
        </div>
      </div>

      <!-- Custom / Makeup Rounds -->
      <div class="admin-section">
        <div class="admin-section-title">Custom / Makeup Rounds</div>
        <p class="admin-help-text">Create one-off matchups for rain makeups, extra weeks, or special events.</p>
        ${_renderExistingCustomRounds(c)}
        <div id="custom-round-form" class="custom-round-form">
          <div class="settings-row">
            <label>Round Label</label>
            <input class="field" id="cr-label" placeholder="e.g. May 28 Makeup" />
          </div>
          <div class="settings-row">
            <label>Date</label>
            <input class="field" type="date" id="cr-date" />
          </div>
          <div class="settings-row">
            <label>Nine</label>
            <div class="sd-nine-toggle">
              <button class="btn-xs active" id="cr-nine-front" onclick="crSetNine('front')">Front</button>
              <button class="btn-xs" id="cr-nine-back" onclick="crSetNine('back')">Back</button>
            </div>
          </div>
          <div id="cr-pairings" class="cr-pairings">
            <div class="cr-pairing-row" data-idx="0">
              <select class="field cr-team-select" id="cr-t1-0">
                <option value="">Team A</option>
                ${(c.teams || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
              <span class="matchup-vs">vs</span>
              <select class="field cr-team-select" id="cr-t2-0">
                <option value="">Team B</option>
                ${(c.teams || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
              <button class="btn-xs btn-danger" onclick="crRemovePairing(0)" title="Remove">✕</button>
            </div>
          </div>
          <div class="cr-actions">
            <button class="btn btn-outline btn-sm" onclick="crAddPairing()">+ Add Pairing</button>
            <button class="btn btn-green btn-sm" onclick="saveCustomRound()">Save Round</button>
          </div>
        </div>
      </div>

      <!-- Season Rollover -->
      <div class="admin-section admin-section-danger">
        <div class="admin-section-title">⚠️ Season Rollover</div>
        <p class="admin-help-text">End the current season: archives all scores to history, deletes match data, and clears the schedule. Teams and handicap settings are preserved.</p>
        <div class="rollover-steps">
          <div class="rollover-step">1. Export scores CSV (automatic backup)</div>
          <div class="rollover-step">2. Archive all player rounds into score history</div>
          <div class="rollover-step">3. Delete all match documents</div>
          <div class="rollover-step">4. Clear schedule, tee times, and cancelled weeks</div>
          <div class="rollover-step">5. Preserve teams, handicap settings, and manual adjustments</div>
        </div>
        <button class="btn btn-danger-solid btn-sm" onclick="seasonRollover()" style="margin-top:12px">
          🔄 Start Season Rollover
        </button>
      </div>

      <!-- Data Management -->
      <div class="admin-section">
        <div class="admin-section-title">Data Management</div>
        <div class="settings-row">
          <label>Export League Data</label>
          <button class="btn btn-outline btn-sm" onclick="adminExportData()">Export JSON</button>
        </div>
        <div class="settings-row">
          <label>Export Scores CSV</label>
          <button class="btn btn-outline btn-sm" onclick="adminExportScoresCSV()">Export CSV</button>
        </div>
        <div class="settings-row">
          <label>Import League Data</label>
          <input type="file" id="import-json-input" accept=".json" class="field" style="max-width:220px" />
          <button class="btn btn-outline btn-sm" onclick="adminImportData()">Import JSON</button>
        </div>
      </div>

      <!-- Hard Reset -->
      <div class="admin-section admin-section-danger">
        <div class="admin-section-title">💣 Hard Reset</div>
        <p class="admin-help-text">Delete ALL matches, player rounds, and custom rounds. Teams and league settings are preserved. This cannot be undone.</p>
        <button class="btn btn-danger-solid btn-sm" onclick="adminHardReset()">Hard Reset League</button>
      </div>

      <div class="admin-save-bar">
        <button class="btn btn-green" onclick="adminSaveSettings()">Save All Settings</button>
      </div>
    </div>
  `;

  // Show/hide fixed score row based on absent rule
  document.getElementById('as-absent-rule')?.addEventListener('change', (e) => {
    const row = document.getElementById('as-absent-fixed-row');
    if (row) row.style.display = e.target.value === 'fixed_score' ? '' : 'none';
  });

  // Handicap system toggle buttons
  document.getElementById('as-tg-hcpsys')?.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#as-tg-hcpsys .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('as-hcp-type').value = btn.dataset.value;
      const custom = document.getElementById('as-hcp-custom-settings');
      if (custom) custom.style.display = ['scratch','manual'].includes(btn.dataset.value) ? 'none' : '';
    });
  });

  // Drop scores toggle buttons
  document.getElementById('as-tg-hcpdrop')?.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#as-tg-hcpdrop .toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('as-hcp-drop').value = btn.dataset.value;
    });
  });
}

// ---- Absent Player Overrides ----
function _renderAbsentOverrides(config, allPlayers, schedule) {
  const overrides = config.absentOverrides || {};
  const keys = Object.keys(overrides).filter(k => overrides[k]);
  if (!keys.length) return '<p class="admin-help-text" style="opacity:0.5">No absent overrides yet.</p>';

  return keys.sort().map(key => {
    // key format: "w3_p5"
    const [wPart, pPart] = key.split('_');
    const weekNum = wPart.replace('w', '');
    const player = allPlayers.find(p => p.id === pPart);
    const weekEntry = schedule.find(w => String(w.week) === weekNum);
    const dateStr = weekEntry?.date ? ' — ' + weekEntry.date : '';
    return `<div class="absent-override-row">
      <span>Week ${weekNum}${dateStr} · <strong>${player?.name || pPart}</strong></span>
      <button type="button" class="btn-xs btn-danger" onclick="adminRemoveAbsent('${key}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

async function adminMarkAbsent() {
  const week = document.getElementById('as-absent-ovr-week')?.value;
  const playerId = document.getElementById('as-absent-ovr-player')?.value;
  if (!week || !playerId) { toast('Select a week and player', 'error'); return; }

  const key = `w${week}_${playerId}`;
  if (!APP.config.absentOverrides) APP.config.absentOverrides = {};

  if (APP.config.absentOverrides[key]) {
    toast('Player already marked absent for that week', 'error');
    return;
  }

  APP.config.absentOverrides[key] = true;

  try {
    await window._FB.saveLeagueConfig({ absentOverrides: APP.config.absentOverrides });
    toast('Player marked absent', 'success');
    renderAdminSettings();
    renderScores();
  } catch (err) {
    console.error('[adminMarkAbsent]', err);
    toast('Failed to save', 'error');
  }
}

async function adminRemoveAbsent(key) {
  if (!APP.config.absentOverrides) return;
  delete APP.config.absentOverrides[key];

  try {
    await window._FB.saveLeagueConfig({ absentOverrides: APP.config.absentOverrides });
    toast('Absent override removed', 'success');
    renderAdminSettings();
    renderScores();
  } catch (err) {
    console.error('[adminRemoveAbsent]', err);
    toast('Failed to save', 'error');
  }
}

// ---- Custom / Makeup Rounds ----
function _renderExistingCustomRounds(config) {
  const customRounds = config.customRounds || [];
  if (!customRounds.length) return '<p class="admin-help-text" style="opacity:0.5">No custom rounds yet.</p>';
  const teams = config.teams || [];
  return customRounds.map((cr, idx) => {
    const matchups = (cr.matchups || []).map(([t1id, t2id]) => {
      const t1 = teams.find(t => t.id === t1id);
      const t2 = teams.find(t => t.id === t2id);
      return `<span class="cr-existing-matchup">${t1?.name || t1id} vs ${t2?.name || t2id}</span>`;
    }).join('');
    return `
      <div class="cr-existing-round">
        <div class="cr-existing-header">
          <div>
            <span class="cr-existing-label">${cr.label || `Custom Round`}</span>
            <span class="chip chip-nine" style="margin-left:6px">${cr.nine === 'back' ? 'Back' : 'Front'} 9</span>
            ${cr.date ? `<span class="cr-existing-date">${_fmtDate(cr.date)}</span>` : ''}
          </div>
          <button class="btn-xs btn-danger" onclick="deleteCustomRound(${idx})" title="Delete round">🗑</button>
        </div>
        <div class="cr-existing-matchups">${matchups}</div>
      </div>`;
  }).join('');
}

let _crNine = 'front';
let _crPairingCount = 1;

function crSetNine(nine) {
  _crNine = nine;
  const frontBtn = document.getElementById('cr-nine-front');
  const backBtn  = document.getElementById('cr-nine-back');
  if (frontBtn) frontBtn.classList.toggle('active', nine === 'front');
  if (backBtn)  backBtn.classList.toggle('active', nine === 'back');
}

function crAddPairing() {
  const container = document.getElementById('cr-pairings');
  if (!container) return;
  const idx = _crPairingCount++;
  const teams = APP.config?.teams || [];
  const row = document.createElement('div');
  row.className = 'cr-pairing-row';
  row.dataset.idx = idx;
  row.innerHTML = `
    <select class="field cr-team-select" id="cr-t1-${idx}">
      <option value="">Team A</option>
      ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
    </select>
    <span class="matchup-vs">vs</span>
    <select class="field cr-team-select" id="cr-t2-${idx}">
      <option value="">Team B</option>
      ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
    </select>
    <button class="btn-xs btn-danger" onclick="crRemovePairing(${idx})" title="Remove">✕</button>
  `;
  container.appendChild(row);
}

function crRemovePairing(idx) {
  const row = document.querySelector(`.cr-pairing-row[data-idx="${idx}"]`);
  if (row) row.remove();
}

async function saveCustomRound() {
  const label = document.getElementById('cr-label')?.value?.trim();
  const date  = document.getElementById('cr-date')?.value || '';

  // Gather pairings
  const rows = document.querySelectorAll('.cr-pairing-row');
  const matchups = [];
  const usedTeams = new Set();
  let valid = true;

  rows.forEach(row => {
    const idx = row.dataset.idx;
    const t1 = document.getElementById(`cr-t1-${idx}`)?.value;
    const t2 = document.getElementById(`cr-t2-${idx}`)?.value;
    if (!t1 || !t2) { valid = false; return; }
    if (t1 === t2) { valid = false; return; }
    if (usedTeams.has(t1) || usedTeams.has(t2)) { valid = false; return; }
    usedTeams.add(t1);
    usedTeams.add(t2);
    matchups.push([t1, t2]);
  });

  if (!label) { toast('Enter a round label', 'error'); return; }
  if (!valid || !matchups.length) { toast('Fix pairings: each team must appear once, all fields required', 'error'); return; }

  // Calculate next custom weekNum (100+)
  const customRounds = APP.config.customRounds || [];
  const maxWeek = customRounds.reduce((mx, cr) => Math.max(mx, cr.weekNum || 0), 99);
  const weekNum = maxWeek + 1;

  const newRound = { weekNum, label, date, nine: _crNine, matchups };

  try {
    // Save to config
    customRounds.push(newRound);
    APP.config.customRounds = customRounds;
    await window._FB.saveLeagueConfig({ customRounds });

    // Create match docs in Firestore
    await window._FB.createMatchDocs({
      week: weekNum,
      date,
      nine: _crNine,
      matchups,
      isCustom: true,
      label
    }, APP.config.teams || []);

    toast('Custom round created', 'success');
    _crPairingCount = 1;
    _crNine = 'front';
    renderAdminSettings();
    renderSchedule();
    renderScores();
  } catch (err) {
    console.error('[saveCustomRound]', err);
    toast('Failed to save custom round', 'error');
  }
}

async function deleteCustomRound(idx) {
  const customRounds = APP.config.customRounds || [];
  const cr = customRounds[idx];
  if (!cr) return;

  if (!confirm(`Delete "${cr.label || 'Custom Round'}" and all its match data?`)) return;

  try {
    // Delete match docs for this custom round
    const weekNum = cr.weekNum;
    const matchups = cr.matchups || [];
    for (let mi = 0; mi < matchups.length; mi++) {
      await window._FB.deleteMatch(`w${weekNum}_m${mi}`);
    }

    // Remove from config
    customRounds.splice(idx, 1);
    APP.config.customRounds = customRounds;
    await window._FB.saveLeagueConfig({ customRounds });

    // Also remove from local APP.matches
    for (let mi = 0; mi < matchups.length; mi++) {
      delete APP.matches[`w${weekNum}_m${mi}`];
    }

    toast('Custom round deleted', 'success');
    renderAdminSettings();
    renderSchedule();
    renderScores();
  } catch (err) {
    console.error('[deleteCustomRound]', err);
    toast('Failed to delete custom round', 'error');
  }
}

async function adminSaveSettings() {
  const updated = {
    leagueName:    document.getElementById('as-league-name')?.value?.trim() || '',
    seasonYear:    parseInt(document.getElementById('as-season-year')?.value) || new Date().getFullYear(),
    dayOfWeek:     document.getElementById('as-day-of-week')?.value || '',
    startTeeTime:  document.getElementById('as-tee-time')?.value || '',
    teeInterval:   parseInt(document.getElementById('as-tee-interval')?.value) || 10,
    course: {
      ...(APP.config.course || {}),
      name:     document.getElementById('as-course-name')?.value?.trim() || '',
      location: document.getElementById('as-course-location')?.value?.trim() || '',
      tees:     document.getElementById('as-course-tees')?.value?.trim() || '',
      rating:   parseFloat(document.getElementById('as-course-rating')?.value) || null,
      slope:    parseInt(document.getElementById('as-course-slope')?.value) || null,
    },
    // pointValues & absentRule saved at TOP LEVEL (wizard writes them here, scoring reads from here)
    pointValues: {
      hole:    parseFloat(document.getElementById('as-pv-hole')?.value) || 1,
      lowNet:  parseFloat(document.getElementById('as-pv-lownet')?.value) || 1,
      teamNet: parseFloat(document.getElementById('as-pv-teamnet')?.value) || 0,
      birdie:  parseFloat(document.getElementById('as-pv-birdie')?.value) || 0,
      eagle:   parseFloat(document.getElementById('as-pv-eagle')?.value) || 0,
    },
    absentRule:       document.getElementById('as-absent-rule')?.value || 'blind_avg',
    absentFixedScore: parseInt(document.getElementById('as-absent-fixed')?.value) || 50,
    format: {
      ...(APP.config.format || {}),
      skinsEnabled:     document.getElementById('as-skins-enabled')?.checked || false,
      skinsNet:         document.getElementById('as-skins-net')?.checked || false,
      skinsBuyIn:       parseFloat(document.getElementById('as-skins-buyin')?.value) || 0,
    },
    handicap: {
      ...(APP.config.handicap || {}),
      type:    document.getElementById('as-hcp-type')?.value || 'custom',
      rounds:  parseInt(document.getElementById('as-hcp-rounds')?.value) || 5,
      drop:    document.getElementById('as-hcp-drop')?.value || 'none',
      factor:  parseFloat(document.getElementById('as-hcp-factor')?.value) || 0.9,
      max:     parseInt(document.getElementById('as-hcp-max')?.value) || 18,
    }
  };

  try {
    await window._FB.saveLeagueConfig(updated);
    toast('Settings saved', 'success');
    const titleEl = document.querySelector('.app-header-titles h1');
    if (titleEl && updated.leagueName) titleEl.textContent = updated.leagueName;
    const subEl = document.querySelector('.app-header-titles .season-label');
    if (subEl && updated.seasonYear) subEl.textContent = `Season ${updated.seasonYear}`;
  } catch (err) {
    console.error('[adminSaveSettings]', err);
    toast('Failed to save settings', 'error');
  }
}

// ---- Admin Settings: Season Date helpers ----
function adminSetNine(week, nine) {
  const schedule = APP.config.schedule || [];
  const entry = schedule.find(w => w.week == week);
  if (entry) entry.nine = nine;
  renderAdminSettings();
}

function adminToggleHcpWeek(week, included) {
  const excluded = APP.config.hcpExcludedWeeks || [];
  if (included) {
    APP.config.hcpExcludedWeeks = excluded.filter(w => w != week);
  } else {
    if (!excluded.includes(week)) excluded.push(week);
    APP.config.hcpExcludedWeeks = excluded;
  }
}

function adminToggleCancelWeek(week) {
  const cancelled = APP.config.cancelledWeeks || {};
  cancelled[week] = !cancelled[week];
  APP.config.cancelledWeeks = cancelled;
  renderAdminSettings();
}

function adminTogglePlayoffWeek(week) {
  const map = APP.config.playoffWeekMap || {};
  map[week] = !_isPlayoffWeek(week);
  APP.config.playoffWeekMap = map;
  renderAdminSettings();
}

async function adminSaveSeasonDates() {
  const schedule = APP.config.schedule || [];
  const dateInputs = document.querySelectorAll('.sd-date-input');
  dateInputs.forEach(inp => {
    const w = parseInt(inp.dataset.week);
    const entry = schedule.find(e => e.week === w);
    if (entry && inp.value) entry.date = inp.value;
  });

  try {
    await window._FB.saveLeagueConfig({
      schedule,
      hcpExcludedWeeks: APP.config.hcpExcludedWeeks || [],
      cancelledWeeks: APP.config.cancelledWeeks || {},
      playoffWeekMap: APP.config.playoffWeekMap || {}
    });
    toast('Season dates saved', 'success');
  } catch (err) {
    console.error('[adminSaveSeasonDates]', err);
    toast('Failed to save dates', 'error');
  }
}

async function adminSetHcpAdj(playerId, value) {
  const adj = parseFloat(value) || 0;
  const manAdj = APP.config.manualAdj || {};
  manAdj[playerId] = adj;
  APP.config.manualAdj = manAdj;
  try {
    await window._FB.saveLeagueConfig({ manualAdj: manAdj });
    toast('Handicap adjustment saved', 'success');
  } catch (err) {
    console.error('[adminSetHcpAdj]', err);
    toast('Failed to save adjustment', 'error');
  }
}

function adminExportData() {
  const data = { config: APP.config, matches: APP.matches, rounds: APP.rounds };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `league-backup-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Data exported', 'success');
}

function adminExportScoresCSV() {
  const teams = APP.config.teams || [];
  const allPlayers = teams.flatMap(t => t.players || []);
  const committed = Object.entries(APP.matches).filter(([, m]) => m.status === 'committed');

  let csv = 'Week,Date,Player,Team,Gross Score,Nine\n';
  committed.sort(([, a], [, b]) => (a.week || 0) - (b.week || 0));
  for (const [, m] of committed) {
    const scores = m.scores || {};
    for (const [pid, s] of Object.entries(scores)) {
      const player = allPlayers.find(p => p.id === pid);
      const team = teams.find(t => (t.players || []).some(p => p.id === pid));
      const gross = s.reduce((a, b) => a + b, 0);
      csv += `${m.week},${m.date || ''},${player?.name || pid},${team?.name || ''},${gross},${m.nine || ''}\n`;
    }
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `scores-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('Scores exported', 'success');
}

window.adminSaveSettings     = adminSaveSettings;
window.adminSetNine          = adminSetNine;
window.adminToggleHcpWeek    = adminToggleHcpWeek;
window.adminToggleCancelWeek = adminToggleCancelWeek;
window.adminSaveSeasonDates  = adminSaveSeasonDates;
window.adminSetHcpAdj        = adminSetHcpAdj;
window.adminExportData       = adminExportData;
window.adminExportScoresCSV  = adminExportScoresCSV;
window.crSetNine             = crSetNine;
window.crAddPairing          = crAddPairing;
window.crRemovePairing       = crRemovePairing;
window.saveCustomRound       = saveCustomRound;
window.deleteCustomRound     = deleteCustomRound;

// ---- Season Rollover ----
async function seasonRollover() {
  const year = APP.config?.seasonYear || new Date().getFullYear();
  const msg = `⚠️ SEASON ROLLOVER — ${year}\n\nThis will:\n• Archive all player rounds to history\n• Delete ALL match data\n• Clear the schedule\n\nTeams and settings are preserved.\n\nThis action cannot be undone.\n\nType "ROLLOVER" to confirm:`;
  const input = prompt(msg);
  if (input !== 'ROLLOVER') { toast('Rollover cancelled', 'info'); return; }

  try {
    toast('Starting rollover...', 'info');

    // Step 1: Auto-export CSV backup
    adminExportScoresCSV();

    // Step 2-7: Archive and rollover via Firestore
    const scoreHistory = await window._FB.archiveAndRollover(year);

    // Clear local state
    APP.matches = {};
    APP.rounds  = {};
    APP.config.schedule = [];
    APP.config.weekTeeTimes = {};
    APP.config.cancelledWeeks = {};
    APP.config.customRounds = [];
    APP.config.hcpExcludedWeeks = [];
    APP.config.scoreHistory = scoreHistory;

    toast(`Season ${year} archived! Ready for new season.`, 'success');
    refreshApp();
  } catch (err) {
    console.error('[seasonRollover]', err);
    toast('Rollover failed: ' + err.message, 'error');
  }
}

window.seasonRollover        = seasonRollover;

// ---- Hard Reset & Import ----
async function adminHardReset() {
  const msg = '💣 HARD RESET\n\nThis will permanently delete:\n• All match data\n• All player rounds\n• Custom rounds\n• Manual adjustments\n\nTeams and settings are preserved.\n\nType "RESET" to confirm:';
  const input = prompt(msg);
  if (input !== 'RESET') { toast('Reset cancelled', 'info'); return; }

  try {
    toast('Resetting...', 'info');
    await window._FB.hardReset();
    APP.matches = {};
    APP.rounds = {};
    APP.config.customRounds = [];
    APP.config.manualAdj = {};
    APP.config.schedule = [];
    toast('League reset complete', 'success');
    refreshApp();
  } catch (err) {
    console.error('[hardReset]', err);
    toast('Reset failed: ' + err.message, 'error');
  }
}

async function adminImportData() {
  const fileInput = document.getElementById('import-json-input');
  const file = fileInput?.files?.[0];
  if (!file) { toast('Select a JSON file first', 'error'); return; }

  if (!confirm('Import data from file? This will overwrite existing data for matching fields.')) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);
    await window._FB.importLeagueData(json);
    toast('Data imported! Reloading...', 'success');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    console.error('[importData]', err);
    toast('Import failed: ' + err.message, 'error');
  }
}

window.adminHardReset  = adminHardReset;
window.adminImportData = adminImportData;

// ---- Player Claim Modal ----
// Shows a modal for an unlinked member to claim a roster player

async function showClaimModal() {
  const { loadAllMembers, saveMembership } = window._FB;
  const uid  = APP.user?.uid || window._currentUser?.uid;
  if (!uid || !APP.config) return;

  // Load all members to find which players are already claimed
  const members = await loadAllMembers();
  const claimedIds = new Set(members.filter(m => m.playerId).map(m => m.playerId));

  // Build list of unclaimed players from all teams
  const teams = APP.config.teams || [];
  const unclaimed = [];
  for (const t of teams) {
    for (const p of (t.players || [])) {
      if (!claimedIds.has(p.id)) {
        unclaimed.push({ id: p.id, name: p.name, teamName: t.name, hilo: p.hilo });
      }
    }
  }

  // Remove any existing claim modal
  document.getElementById('claim-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'claim-modal-overlay';
  overlay.className = 'claim-modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const options = unclaimed.length
    ? `<option value="">— Select your name —</option>` +
      unclaimed.map(p => `<option value="${p.id}">${p.name} (${p.teamName}${p.hilo ? ' · ' + p.hilo : ''})</option>`).join('')
    : `<option value="">No unclaimed players</option>`;

  overlay.innerHTML = `
    <div class="claim-modal">
      <h3>🏌️ Claim Your Player</h3>
      <p style="color:var(--mt);font-size:13px;margin:8px 0 16px">Select yourself from the roster to link your account to your player profile.</p>
      <select id="claim-player-select" class="field" style="width:100%">${options}</select>
      <div style="margin:12px 0">
        <label style="font-size:13px;color:var(--mt)">Profile Photo (optional)</label>
        <input type="file" id="claim-photo-input" accept="image/*" class="field" style="margin-top:4px" />
      </div>
      <div class="claim-modal-actions">
        <button class="btn btn-outline" onclick="document.getElementById('claim-modal-overlay').remove()">Skip</button>
        <button class="btn btn-green" id="claim-confirm-btn" onclick="confirmClaim()" ${unclaimed.length ? '' : 'disabled'}>Claim</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

async function confirmClaim() {
  const { saveMembership } = window._FB;
  const uid = APP.user?.uid || window._currentUser?.uid;
  if (!uid) return;

  const select = document.getElementById('claim-player-select');
  const playerId = select?.value;
  if (!playerId) { toast('Select a player first', 'error'); return; }

  const btn = document.getElementById('claim-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    // Upload photo if selected
    const photoInput = document.getElementById('claim-photo-input');
    let photoURL = null;
    if (photoInput?.files?.[0]) {
      try {
        photoURL = await window._FB.uploadPlayerPhoto(playerId, photoInput.files[0]);
      } catch (photoErr) {
        console.warn('[Claim] Photo upload failed:', photoErr);
        // Continue without photo
      }
    }

    const memberData = { playerId };
    if (photoURL) memberData.photoURL = photoURL;
    await saveMembership(uid, memberData);
    APP.member = { ...APP.member, ...memberData };
    document.getElementById('claim-modal-overlay')?.remove();
    toast('Player linked!', 'success');
    refreshApp();
  } catch (err) {
    console.error('[Claim]', err);
    toast('Failed to claim player', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Claim'; }
  }
}

window.showClaimModal = showClaimModal;
window.confirmClaim   = confirmClaim;

// ---- Admin Members Tab ----

async function renderAdminMembers() {
  const el = document.getElementById('tab-admin-members');
  if (!el || !APP.config) return;

  const { loadAllMembers, loadLeagueMeta } = window._FB;

  // Load members and league meta (for joinCode)
  const members = await loadAllMembers();
  APP.members = members;
  const meta = await loadLeagueMeta(APP.leagueId);
  const joinCode = meta?.joinCode || '—';

  const teams = APP.config.teams || [];
  const claimedIds = new Set(members.filter(m => m.playerId).map(m => m.playerId));

  // Build player lookup: playerId → { name, teamName, hilo }
  const playerMap = {};
  for (const t of teams) {
    for (const p of (t.players || [])) {
      playerMap[p.id] = { name: p.name, teamName: t.name, hilo: p.hilo };
    }
  }

  // Unclaimed players
  const unclaimed = [];
  for (const t of teams) {
    for (const p of (t.players || [])) {
      if (!claimedIds.has(p.id)) {
        unclaimed.push({ id: p.id, name: p.name, teamName: t.name, hilo: p.hilo });
      }
    }
  }

  // Build unclaimed options for assign dropdowns
  const unclaimedOpts = unclaimed.map(p =>
    `<option value="${p.id}">${p.name} (${p.teamName})</option>`
  ).join('');

  // --- Section 1: Join Code ---
  const joinCodeSection = `
    <div class="admin-section">
      <h3>Join Code</h3>
      <p style="color:var(--mt);font-size:13px;margin-bottom:12px">Share this code with players so they can join your league.</p>
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="join-code-display" id="join-code-display">${joinCode}</span>
        <button class="btn btn-outline" onclick="copyJoinCode()">📋 Copy</button>
        <button class="btn btn-outline" onclick="regenerateCode()">🔄 New Code</button>
      </div>
      <p style="color:var(--mt);font-size:12px;margin-top:10px">
        Share link: <span style="color:var(--gd);user-select:all">${window.location.origin}?join=${joinCode}</span>
      </p>
    </div>`;

  // --- Section 2: Members List ---
  const memberRows = members.sort((a, b) => {
    if (a.role === 'commissioner' && b.role !== 'commissioner') return -1;
    if (b.role === 'commissioner' && a.role !== 'commissioner') return 1;
    return (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '');
  }).map(m => {
    const player = m.playerId ? playerMap[m.playerId] : null;
    const initials = (m.displayName || m.email || '?').slice(0, 2).toUpperCase();
    const isCommish = m.role === 'commissioner';
    const roleBadge = isCommish
      ? '<span class="member-role-badge commish">Commissioner</span>'
      : '<span class="member-role-badge player">Player</span>';

    const playerInfo = player
      ? `<span style="color:var(--gd)">${player.name}</span> <span style="color:var(--mt);font-size:12px">(${player.teamName}${player.hilo ? ' · ' + player.hilo : ''})</span>`
      : '<span style="color:var(--mt);font-style:italic">Unlinked</span>';

    // Actions (don't show remove for commissioner)
    let actions = '';
    if (!player && unclaimed.length > 0) {
      actions += `
        <select class="field member-assign-select" onchange="adminAssignPlayer('${m.uid}', this.value)" style="font-size:12px;padding:4px 6px">
          <option value="">Assign…</option>
          ${unclaimedOpts}
        </select>`;
    }
    if (player) {
      actions += `<button class="btn btn-outline btn-xs" onclick="adminUnlinkPlayer('${m.uid}')">Unlink</button>`;
    }
    if (!isCommish) {
      actions += `<button class="btn btn-danger btn-xs" onclick="adminRemoveMember('${m.uid}', '${(m.displayName || m.email || '').replace(/'/g, "\\'")}')">Remove</button>`;
    }

    return `
      <div class="member-row">
        <div class="member-avatar">${initials}</div>
        <div class="member-info">
          <div class="member-name">${m.displayName || m.email || 'Unknown'} ${roleBadge}</div>
          <div class="member-player">${playerInfo}</div>
        </div>
        <div class="member-actions">${actions}</div>
      </div>`;
  }).join('');

  const membersSection = `
    <div class="admin-section">
      <h3>Members (${members.length})</h3>
      <div class="member-list">${memberRows || '<div class="empty-state">No members yet</div>'}</div>
    </div>`;

  // --- Section 3: Unclaimed Players ---
  const unclaimedRows = unclaimed.map(p => `
    <div class="unclaimed-player-row">
      <span>👤</span>
      <span>${p.name}</span>
      <span style="color:var(--mt);font-size:12px">${p.teamName}${p.hilo ? ' · ' + p.hilo : ''}</span>
    </div>
  `).join('');

  const unclaimedSection = unclaimed.length ? `
    <div class="admin-section">
      <h3>Unclaimed Players (${unclaimed.length})</h3>
      <p style="color:var(--mt);font-size:13px;margin-bottom:8px">These roster players haven't been linked to any member account yet.</p>
      ${unclaimedRows}
    </div>` : '';

  el.innerHTML = joinCodeSection + membersSection + unclaimedSection;
}

async function copyJoinCode() {
  const code = document.getElementById('join-code-display')?.textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast('Join code copied!', 'success');
  } catch {
    // Fallback: select the text
    toast('Code: ' + code, 'success');
  }
}

async function regenerateCode() {
  const { regenerateJoinCode } = window._FB;
  if (!confirm('Generate a new code? The old code will stop working.')) return;
  try {
    const newCode = await regenerateJoinCode();
    toast('New code generated!', 'success');
    renderAdminMembers(); // re-render to show new code
  } catch (err) {
    console.error('[RegenCode]', err);
    toast('Failed to generate new code', 'error');
  }
}

async function adminAssignPlayer(memberUid, playerId) {
  if (!playerId) return;
  const { saveMembership } = window._FB;
  try {
    await saveMembership(memberUid, { playerId });
    toast('Player assigned!', 'success');
    // Refresh if it's the current user
    if (memberUid === (APP.user?.uid || window._currentUser?.uid)) {
      APP.member = { ...APP.member, playerId };
    }
    renderAdminMembers();
    refreshApp();
  } catch (err) {
    console.error('[AssignPlayer]', err);
    toast('Failed to assign player', 'error');
  }
}

async function adminUnlinkPlayer(memberUid) {
  const { saveMembership } = window._FB;
  try {
    // To unlink, we need to set playerId to empty string (merge: true won't delete it)
    // Use updateDoc via _FB to set the field to null
    const db = window._db;
    const { updateDoc, doc } = window._FB;
    await updateDoc(doc(db, 'leagues', APP.leagueId, 'members', memberUid), { playerId: '' });
    toast('Player unlinked', 'success');
    if (memberUid === (APP.user?.uid || window._currentUser?.uid)) {
      APP.member = { ...APP.member, playerId: '' };
    }
    renderAdminMembers();
    refreshApp();
  } catch (err) {
    console.error('[UnlinkPlayer]', err);
    toast('Failed to unlink', 'error');
  }
}

async function adminRemoveMember(memberUid, name) {
  if (!confirm(`Remove ${name} from this league? They'll need to rejoin.`)) return;
  const { removeMember } = window._FB;
  try {
    await removeMember(memberUid);
    toast(`${name} removed`, 'success');
    renderAdminMembers();
  } catch (err) {
    console.error('[RemoveMember]', err);
    toast('Failed to remove member', 'error');
  }
}

window.copyJoinCode      = copyJoinCode;
window.regenerateCode    = regenerateCode;
window.adminAssignPlayer = adminAssignPlayer;
window.adminUnlinkPlayer = adminUnlinkPlayer;
window.adminRemoveMember = adminRemoveMember;

// ---- Scores Tab ----
function renderScores() {
  const el = document.getElementById('tab-scores');
  if (!el) return;

  const matches = Object.entries(APP.matches);
  if (!matches.length) {
    el.innerHTML = '<div class="empty-state mt-12"><div class="empty-icon">⛳</div><p>No matches scheduled yet</p></div>';
    return;
  }

  // Group by week
  const byWeek = {};
  matches.forEach(([key, m]) => {
    const w = m.week || 0;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push([key, m]);
  });

  // Sort matches within each week by tee time slot (if configured)
  Object.values(byWeek).forEach(weekMatches => {
    const teeOrder = APP.config?.weekTeeTimes?.[weekMatches[0]?.[1]?.week];
    if (teeOrder?.length) {
      weekMatches.sort(([keyA], [keyB]) => {
        const idxA = parseInt(keyA.split('_m')[1]) || 0;
        const idxB = parseInt(keyB.split('_m')[1]) || 0;
        return (teeOrder.indexOf(idxA) === -1 ? 99 : teeOrder.indexOf(idxA)) -
               (teeOrder.indexOf(idxB) === -1 ? 99 : teeOrder.indexOf(idxB));
      });
    }
  });

  const uid = APP.user?.uid || window._currentUser?.uid;
  const isCommish = APP.member?.role === 'commissioner';
  const cancelled = APP.config?.cancelledWeeks || {};
  const startTime = APP.config?.startTeeTime || APP.config?.teeTime || '';
  const interval  = APP.config?.teeInterval || 10;

  // Custom round lookup for labels
  const customRounds = APP.config?.customRounds || [];
  const customByWeek = {};
  customRounds.forEach(cr => { customByWeek[cr.weekNum] = cr; });

  el.innerHTML = Object.keys(byWeek).sort((a,b) => +a - +b).map(week => {
    const weekMatches = byWeek[week];
    const firstMatch  = weekMatches[0]?.[1];
    const date = firstMatch?.date || '';
    const nine = firstMatch?.nine || 'front';
    const isCancelled = cancelled[week];
    const isCustom = +week >= 100;
    const customRound = customByWeek[+week];

    // Tee time labels
    const teeLabels = [];
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number);
      weekMatches.forEach((_, i) => {
        const totalMin = h * 60 + m + i * interval;
        const tH = Math.floor(totalMin / 60), tM = totalMin % 60;
        const ampm = tH >= 12 ? 'PM' : 'AM';
        const h12 = tH > 12 ? tH - 12 : tH === 0 ? 12 : tH;
        teeLabels.push(`${h12}:${String(tM).padStart(2, '0')} ${ampm}`);
      });
    }

    // Week label: use custom round label for week 100+
    const weekLabel = isCustom
      ? (customRound?.label || 'Makeup')
      : `Week ${week}`;

    return `
      <div class="week-group ${isCancelled ? 'week-cancelled' : ''}">
        <div class="week-group-header">
          <div class="week-group-left">
            <span class="week-group-label">${weekLabel}</span>
            ${isCustom ? '<span class="chip chip-makeup">MAKEUP</span>' : ''}
            ${isCancelled ? '<span class="chip chip-cancelled">Cancelled</span>' : ''}
          </div>
          <div class="week-group-right">
            ${date ? `<span class="week-group-date">${_fmtDate(date)}</span>` : ''}
            <span class="week-group-nine chip chip-nine">${nine === 'front' ? 'Front' : 'Back'} 9</span>
            ${isCommish ? `
              <button class="btn-xs nine-swap" onclick="adminSwapNine(${week})" title="Toggle Front/Back">↔</button>
            ` : ''}
          </div>
        </div>
        ${weekMatches.map(([key, m], mi) => {
          const status   = m.status || 'draft';
          const canEnter = _canEnterScores(m, uid);
          const canApprove = _canApproveScores(m, uid);
          const clickable = canEnter || canApprove || isCommish || status !== 'draft';
          const teeLabel = teeLabels[mi] || '';
          return `
            <div class="match-card ${clickable ? 'clickable' : ''}" onclick="${clickable ? `openMatch('${key}')` : ''}">
              <div class="match-card-teams">
                <div class="match-team-block">
                  <span class="match-team-name">${m.team1Name || 'Team 1'}</span>
                  ${status === 'committed' ? `<span class="match-team-pts">${m.result?.pts1 ?? '–'}</span>` : ''}
                </div>
                <span class="match-vs">vs</span>
                <div class="match-team-block right">
                  <span class="match-team-name">${m.team2Name || 'Team 2'}</span>
                  ${status === 'committed' ? `<span class="match-team-pts">${m.result?.pts2 ?? '–'}</span>` : ''}
                </div>
              </div>
              <div class="match-card-footer">
                <span class="chip chip-${status}">${_statusLabel(status)}</span>
                ${teeLabel ? `<span class="match-tee-time">${teeLabel}</span>` : ''}
                <span class="match-action-hint">
                  ${canApprove && status === 'pending' ? 'Approve scores' :
                    canEnter  && status === 'draft'    ? 'Enter scores' :
                    status === 'disputed'              ? 'Disputed' :
                    status === 'escalated'             ? 'Escalated' :
                    isCommish && status === 'pending'  ? 'Admin approve' :
                    status === 'committed'             ? 'View result' :
                    clickable                          ? 'View' : ''}
                </span>
              </div>
              ${isCommish && weekMatches.length > 1 ? `
                <div class="tee-swap-arrows" onclick="event.stopPropagation()">
                  ${mi > 0 ? `<button class="btn-xs" onclick="adminSwapTeeTime(${week},${mi},${mi-1})">▲</button>` : ''}
                  ${mi < weekMatches.length - 1 ? `<button class="btn-xs" onclick="adminSwapTeeTime(${week},${mi},${mi+1})">▼</button>` : ''}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }).join('');
}

// Swap front/back 9 for a week (commissioner only)
async function adminSwapNine(week) {
  const schedule = APP.config.schedule || [];
  const entry = schedule.find(w => w.week == week);
  if (!entry) return;
  const newNine = entry.nine === 'front' ? 'back' : 'front';
  entry.nine = newNine;

  // Also update all match docs for this week
  const weekMatches = Object.entries(APP.matches).filter(([, m]) => m.week == week);
  try {
    for (const [key] of weekMatches) {
      await window._FB.saveMatch(key, { nine: newNine });
    }
    await window._FB.saveLeagueConfig({ schedule });
    toast(`Week ${week} set to ${newNine} 9`, 'success');
  } catch (err) {
    console.error('[adminSwapNine]', err);
    toast('Failed to swap nine', 'error');
  }
}

// Swap tee time positions for two matches in a week
async function adminSwapTeeTime(week, posA, posB) {
  const teeOrder = APP.config.weekTeeTimes || {};
  const weekMatches = Object.entries(APP.matches).filter(([, m]) => m.week == week);

  // Build current order of match indices
  let order = teeOrder[week];
  if (!order || !order.length) {
    order = weekMatches.map(([key]) => parseInt(key.split('_m')[1]) || 0);
  }

  // Swap positions
  if (posA >= 0 && posA < order.length && posB >= 0 && posB < order.length) {
    [order[posA], order[posB]] = [order[posB], order[posA]];
  }

  teeOrder[week] = order;
  APP.config.weekTeeTimes = teeOrder;

  try {
    await window._FB.saveLeagueConfig({ weekTeeTimes: teeOrder });
    renderScores();
    toast('Tee times swapped', 'success');
  } catch (err) {
    console.error('[adminSwapTeeTime]', err);
    toast('Failed to swap tee times', 'error');
  }
}

window.adminSwapNine     = adminSwapNine;
window.adminSwapTeeTime  = adminSwapTeeTime;

function _statusLabel(s) {
  return { draft: 'Not Started', pending: 'Pending Approval', committed: 'Final',
           disputed: 'Disputed', escalated: 'Escalated' }[s] || s;
}

function _fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Can the current user enter scores for this match?
function _canEnterScores(match, uid) {
  if (!uid) return false;
  if (APP.member?.role === 'commissioner') return true;
  const myPlayerId = APP.member?.playerId;
  if (!myPlayerId) return false;
  // Player must be on team1 or team2
  const t1 = (APP.config?.teams || []).find(t => t.id === match.team1Id);
  const t2 = (APP.config?.teams || []).find(t => t.id === match.team2Id);
  const onTeam1 = (t1?.players || []).some(p => p.id === myPlayerId);
  const onTeam2 = (t2?.players || []).some(p => p.id === myPlayerId);
  const editableStatus = ['draft', 'disputed', 'escalated'];
  return (onTeam1 || onTeam2) && editableStatus.includes(match.status);
}

// Can the current user approve scores? Must be on the *opposing* team from submitter.
// Also returns true for disputed/escalated statuses.
function _canApproveScores(match, uid) {
  const actionable = ['pending', 'disputed', 'escalated'];
  if (!uid || !actionable.includes(match.status)) return false;
  if (APP.member?.role === 'commissioner') return true;
  const myPlayerId = APP.member?.playerId;
  if (!myPlayerId) return false;
  const submitterTeam = match.submittedByTeam;
  const t1 = (APP.config?.teams || []).find(t => t.id === match.team1Id);
  const t2 = (APP.config?.teams || []).find(t => t.id === match.team2Id);
  const onTeam1 = (t1?.players || []).some(p => p.id === myPlayerId);
  const onTeam2 = (t2?.players || []).some(p => p.id === myPlayerId);
  if (submitterTeam === match.team1Id && onTeam2) return true;
  if (submitterTeam === match.team2Id && onTeam1) return true;
  return false;
}

// ===== Score Entry Modal =====
let _modalMatchKey = null;

function openMatch(matchKey) {
  const match = APP.matches[matchKey];
  if (!match) { toast('Match not found', 'error'); return; }

  _modalMatchKey = matchKey;
  const config   = APP.config || {};
  const teams    = config.teams || [];
  const nine     = match.nine || 'front';
  const holes    = config.course?.scorecard?.[nine] || _defaultHoles(nine);
  const uid      = APP.user?.uid || window._currentUser?.uid;
  const isCommish = APP.member?.role === 'commissioner';
  const status   = match.status || 'draft';

  // Find teams & players
  const t1 = teams.find(t => t.id === match.team1Id) || { name: match.team1Name || 'Team 1', players: [] };
  const t2 = teams.find(t => t.id === match.team2Id) || { name: match.team2Name || 'Team 2', players: [] };

  // Determine HI/LO players
  const t1lo = t1.players.find(p => p.hilo === 'LO') || t1.players[0];
  const t1hi = t1.players.find(p => p.hilo === 'HI') || t1.players[1];
  const t2lo = t2.players.find(p => p.hilo === 'LO') || t2.players[0];
  const t2hi = t2.players.find(p => p.hilo === 'HI') || t2.players[1];

  // Calculate handicaps
  const hcp = (p) => p ? calcHcp(APP.rounds[p.id] || [], config) : 0;
  const hcp1lo = hcp(t1lo), hcp1hi = hcp(t1hi);
  const hcp2lo = hcp(t2lo), hcp2hi = hcp(t2hi);

  // Existing scores (if any)
  const scores = match.scores || {};

  // Inject absent scores for players who haven't entered any scores yet
  // or who have been manually marked absent by the commissioner
  const absentRule = _getAbsentRule(config);
  const absentOverrides = config?.absentOverrides || {};
  if (!['forfeit', 'half_pts', 'sub'].includes(absentRule)) {
    [t1lo, t1hi, t2lo, t2hi].forEach(player => {
      if (!player) return;
      const overrideKey = `w${match.week}_${player.id}`;
      const isOverrideAbsent = absentOverrides[overrideKey];
      const existing = scores[player.id];
      if (isOverrideAbsent || !existing || !existing.some(s => s > 0)) {
        scores[player.id] = getAbsentScore(player.id, config, match.date);
      }
    });
  }

  // Editing permitted? Disputed/escalated matches can be edited by submitter team too
  const canEdit = (status === 'draft' && (_canEnterScores(match, uid) || isCommish)) ||
                  ((status === 'disputed' || status === 'escalated') && (_canEnterScores(match, uid) || isCommish)) ||
                  (isCommish); // commissioner can always edit

  // Populate modal header
  document.getElementById('modal-week-badge').textContent = `Week ${match.week || '?'}`;
  document.getElementById('modal-title').textContent = `${t1.name} vs ${t2.name}`;
  document.getElementById('modal-meta').textContent =
    `${nine === 'front' ? 'Front' : 'Back'} 9 · ${match.date ? _fmtDate(match.date) : ''}`;

  // Status bar
  _renderModalStatusBar(status, match);

  // Build HI and LO grids
  _buildScoreGrid('modal-hi-grid', t1hi, t2hi, hcp1hi, hcp2hi, holes, scores, canEdit, 'hi');
  _buildScoreGrid('modal-lo-grid', t1lo, t2lo, hcp1lo, hcp2lo, holes, scores, canEdit, 'lo');

  document.getElementById('modal-hi-label').textContent =
    `${t1hi?.name || '?'} vs ${t2hi?.name || '?'}`;
  document.getElementById('modal-lo-label').textContent =
    `${t1lo?.name || '?'} vs ${t2lo?.name || '?'}`;

  // Initial pts render
  _updateModalPts(holes, scores, t1lo, t1hi, t2lo, t2hi, hcp1lo, hcp1hi, hcp2lo, hcp2hi);

  // Footer actions
  _renderModalFooter(status, match, uid, isCommish,
    t1, t2, t1lo, t1hi, t2lo, t2hi, hcp1lo, hcp1hi, hcp2lo, hcp2hi, holes);

  // Show modal
  const modal = document.getElementById('match-modal');
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
}

function closeMatchModal(e) {
  if (e && e.target !== document.getElementById('match-modal')) return;
  const modal = document.getElementById('match-modal');
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 280);
  _modalMatchKey = null;
}

function _defaultHoles(nine) {
  const start = nine === 'back' ? 10 : 1;
  return Array.from({length: 9}, (_, i) => ({ hole: start + i, par: 4, hdcp: i + 1, yards: 350 }));
}

function _renderModalStatusBar(status, match) {
  const bar = document.getElementById('modal-status-bar');
  if (!bar) return;
  const msgs = {
    draft:     { cls: 'status-draft',     txt: 'Scores not yet entered' },
    pending:   { cls: 'status-pending',   txt: `Submitted — waiting for ${match.team2Name || 'opponent'} to approve` },
    committed: { cls: 'status-committed', txt: '✓ Scores approved and locked' },
    disputed:  { cls: 'status-disputed',  txt: '⚠️ Scores disputed — needs re-review' },
    escalated: { cls: 'status-escalated', txt: '🚨 Escalated to commissioner' },
  };
  const s = msgs[status] || { cls: '', txt: status };
  bar.className = `modal-status-bar ${s.cls}`;
  bar.textContent = s.txt;
}

function _buildScoreGrid(tableId, p1, p2, hcp1, hcp2, holes, scores, canEdit, hilo) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const strokes1 = getHcpStrokes(Math.max(0, hcp1 - hcp2), holes);
  const strokes2 = getHcpStrokes(Math.max(0, hcp2 - hcp1), holes);
  const s1 = scores[p1?.id] || [];
  const s2 = scores[p2?.id] || [];

  // Build header row: Hole numbers
  const holeNums = holes.map(h => h.hole);
  let html = `<thead>
    <tr class="sg-header">
      <th class="sg-name-col"></th>
      ${holeNums.map(h => `<th>${h}</th>`).join('')}
      <th class="sg-tot">Tot</th>
    </tr>
    <tr class="sg-par-row">
      <td class="sg-name-col sg-label">Par</td>
      ${holes.map(h => `<td>${h.par}</td>`).join('')}
      <td class="sg-tot">${holes.reduce((a,h) => a + h.par, 0)}</td>
    </tr>
  </thead>`;

  html += `<tbody>`;

  // Player 1 row
  html += _scoreRow(p1, s1, strokes1, holes, canEdit, hilo, 'p1');
  // Player 2 row
  html += _scoreRow(p2, s2, strokes2, holes, canEdit, hilo, 'p2');

  html += `</tbody>`;
  table.innerHTML = html;

  // Attach live update listeners
  table.querySelectorAll('input.score-inp').forEach(inp => {
    inp.addEventListener('input', () => _onScoreInput(hilo));
  });
}

function _scoreRow(player, scores, strokes, holes, canEdit, hilo, slot) {
  if (!player) return `<tr><td class="sg-name-col" colspan="${holes.length + 2}">—</td></tr>`;
  const total = scores.reduce((a, b) => a + (parseInt(b) || 0), 0);
  return `<tr class="sg-player-row" data-player-id="${player.id}" data-hilokey="${hilo}-${slot}">
    <td class="sg-name-col">
      <span class="sg-player-name">${player.name}</span>
      <span class="sg-hcp-badge">+${Math.round(strokes.reduce((a,b)=>a+b,0))}</span>
    </td>
    ${holes.map((h, i) => {
      const val = scores[i] != null ? scores[i] : '';
      const hasStroke = strokes[i] > 0;
      return canEdit
        ? `<td class="${hasStroke ? 'has-stroke' : ''}">
             <input class="score-inp" type="number" min="1" max="12"
               data-player="${player.id}" data-hole="${i}" data-hilokey="${hilo}"
               value="${val}" placeholder="${h.par}">
           </td>`
        : `<td class="${hasStroke ? 'has-stroke' : ''} ${_netClass(val, h.par, strokes[i])}">${val || '–'}</td>`;
    }).join('')}
    <td class="sg-tot">${total || '–'}</td>
  </tr>`;
}

function _netClass(gross, par, stroke) {
  if (!gross) return '';
  const net = parseInt(gross) - stroke;
  if (net < par - 1) return 'score-eagle';
  if (net < par)     return 'score-birdie';
  if (net === par)   return 'score-par';
  if (net === par+1) return 'score-bogey';
  return 'score-double';
}

function _onScoreInput(hiloKey) {
  // Collect current scores from the grid and update the pts display live
  const match = APP.matches[_modalMatchKey];
  if (!match) return;
  const config = APP.config || {};
  const teams  = config.teams || [];
  const nine   = match.nine || 'front';
  const holes  = config.course?.scorecard?.[nine] || _defaultHoles(nine);
  const t1 = teams.find(t => t.id === match.team1Id) || { players: [] };
  const t2 = teams.find(t => t.id === match.team2Id) || { players: [] };
  const t1lo = t1.players.find(p => p.hilo === 'LO') || t1.players[0];
  const t1hi = t1.players.find(p => p.hilo === 'HI') || t1.players[1];
  const t2lo = t2.players.find(p => p.hilo === 'LO') || t2.players[0];
  const t2hi = t2.players.find(p => p.hilo === 'HI') || t2.players[1];
  const hcp = (p) => p ? calcHcp(APP.rounds[p.id] || [], config) : 0;

  // Read current scores from inputs
  const liveScores = _readInputScores();
  _updateModalPts(holes, liveScores, t1lo, t1hi, t2lo, t2hi,
    hcp(t1lo), hcp(t1hi), hcp(t2lo), hcp(t2hi));
}

function _readInputScores() {
  const scores = {};
  document.querySelectorAll('input.score-inp').forEach(inp => {
    const pid = inp.dataset.player;
    const i   = parseInt(inp.dataset.hole);
    if (!scores[pid]) scores[pid] = [];
    scores[pid][i] = parseInt(inp.value) || 0;
  });
  return scores;
}

function _updateModalPts(holes, scores, t1lo, t1hi, t2lo, t2hi,
    hcp1lo, hcp1hi, hcp2lo, hcp2hi) {
  if (!t1lo || !t1hi || !t2lo || !t2hi) return;

  const pv          = _getPV(APP.config);
  const playsBoth   = _getAbsentRule(APP.config) === 'plays_both';
  const s1lo = scores[t1lo.id] || [], s1hi = scores[t1hi.id] || [];
  const s2lo = scores[t2lo.id] || [], s2hi = scores[t2hi.id] || [];

  // Detect which player is the absent one (no real scores entered at all before absent fill)
  // "plays_both" mode: if t1hi is absent → t1lo plays both t2hi AND t2lo
  //                    if t1lo is absent → t1hi plays both t2hi AND t2lo
  //                    same logic for team 2
  const t1hiAbsent = playsBoth && !APP.matches[_modalMatchKey]?.scores?.[t1hi.id]?.some(s=>s>0);
  const t1loAbsent = playsBoth && !APP.matches[_modalMatchKey]?.scores?.[t1lo.id]?.some(s=>s>0);
  const t2hiAbsent = playsBoth && !APP.matches[_modalMatchKey]?.scores?.[t2hi.id]?.some(s=>s>0);
  const t2loAbsent = playsBoth && !APP.matches[_modalMatchKey]?.scores?.[t2lo.id]?.some(s=>s>0);

  // In plays_both mode, rename the HI/LO labels to reflect who's playing whom
  if (playsBoth) {
    if (t1hiAbsent) {
      // t1lo plays both t2hi and t2lo
      document.getElementById('modal-hi-label').textContent = `${t1lo.name} vs ${t2hi.name} (sub HI)`;
      document.getElementById('modal-lo-label').textContent = `${t1lo.name} vs ${t2lo.name}`;
    } else if (t1loAbsent) {
      document.getElementById('modal-hi-label').textContent = `${t1hi.name} vs ${t2hi.name}`;
      document.getElementById('modal-lo-label').textContent = `${t1hi.name} vs ${t2lo.name} (sub LO)`;
    } else if (t2hiAbsent) {
      document.getElementById('modal-hi-label').textContent = `${t1hi.name} vs ${t2lo.name} (sub HI)`;
      document.getElementById('modal-lo-label').textContent = `${t1lo.name} vs ${t2lo.name}`;
    } else if (t2loAbsent) {
      document.getElementById('modal-hi-label').textContent = `${t1hi.name} vs ${t2hi.name}`;
      document.getElementById('modal-lo-label').textContent = `${t1lo.name} vs ${t2hi.name} (sub LO)`;
    }
  }

  // Determine actual scores for each grid slot — in plays_both absent case, use present player's scores
  const grid1hi = t1hiAbsent ? s1lo : s1hi;
  const grid1lo = t1loAbsent ? s1hi : s1lo;
  const grid2hi = t2hiAbsent ? s2lo : s2hi;
  const grid2lo = t2loAbsent ? s2hi : s2lo;
  // Handicaps follow the player who is actually playing
  const ghcp1hi = t1hiAbsent ? hcp1lo : hcp1hi;
  const ghcp1lo = t1loAbsent ? hcp1hi : hcp1lo;
  const ghcp2hi = t2hiAbsent ? hcp2lo : hcp2hi;
  const ghcp2lo = t2loAbsent ? hcp2hi : hcp2lo;

  const hasHiScores = grid1hi.some(s=>s>0) && grid2hi.some(s=>s>0);
  const hasLoScores = grid1lo.some(s=>s>0) && grid2lo.some(s=>s>0);

  if (hasHiScores) {
    const res = calcMatch(grid1hi, grid2hi, ghcp1hi, ghcp2hi, holes, pv);
    _renderMatchPts('modal-hi-pts', t1hiAbsent ? t1lo : t1hi, t2hiAbsent ? t2lo : t2hi, res);
    _colorScoreGrid('modal-hi-grid', holes, grid1hi, grid2hi, ghcp1hi, ghcp2hi);
  }
  if (hasLoScores) {
    const res = calcMatch(grid1lo, grid2lo, ghcp1lo, ghcp2lo, holes, pv);
    _renderMatchPts('modal-lo-pts', t1loAbsent ? t1hi : t1lo, t2loAbsent ? t2hi : t2lo, res);
    _colorScoreGrid('modal-lo-grid', holes, grid1lo, grid2lo, ghcp1lo, ghcp2lo);
  }

  // Team totals (including optional team net bonus)
  if (hasHiScores || hasLoScores) {
    const hiRes = hasHiScores ? calcMatch(grid1hi, grid2hi, ghcp1hi, ghcp2hi, holes, pv) : {pts1:0, pts2:0, totalNet1:0, totalNet2:0};
    const loRes = hasLoScores ? calcMatch(grid1lo, grid2lo, ghcp1lo, ghcp2lo, holes, pv) : {pts1:0, pts2:0, totalNet1:0, totalNet2:0};

    // Team net bonus: award teamNet pts to the team with the lower combined net score
    const teamNetPts = pv?.teamNet ?? 0;
    let teamBonus1 = 0, teamBonus2 = 0;
    if (teamNetPts > 0 && (hasHiScores && hasLoScores)) {
      const combinedNet1 = (hiRes.totalNet1 ?? 0) + (loRes.totalNet1 ?? 0);
      const combinedNet2 = (hiRes.totalNet2 ?? 0) + (loRes.totalNet2 ?? 0);
      if (combinedNet1 < combinedNet2)       teamBonus1 = teamNetPts;
      else if (combinedNet2 < combinedNet1)  teamBonus2 = teamNetPts;
      else { teamBonus1 = teamNetPts / 2; teamBonus2 = teamNetPts / 2; } // tie
    }

    const tot1 = hiRes.pts1 + loRes.pts1 + teamBonus1;
    const tot2 = hiRes.pts2 + loRes.pts2 + teamBonus2;
    const el   = document.getElementById('modal-team-totals');
    if (el) {
      const bonus1Str = teamBonus1 > 0 ? ` <span class="team-net-badge">+${teamBonus1} net</span>` : '';
      const bonus2Str = teamBonus2 > 0 ? ` <span class="team-net-badge">+${teamBonus2} net</span>` : '';
      el.innerHTML = `
        <div class="team-total ${tot1 > tot2 ? 'winning' : ''}">
          <span class="team-total-name">${APP.matches[_modalMatchKey]?.team1Name || 'Team 1'}${bonus1Str}</span>
          <span class="team-total-pts">${tot1.toFixed(1)}</span>
        </div>
        <div class="team-total-divider">pts</div>
        <div class="team-total ${tot2 > tot1 ? 'winning' : ''}">
          <span class="team-total-pts">${tot2.toFixed(1)}</span>
          <span class="team-total-name">${APP.matches[_modalMatchKey]?.team2Name || 'Team 2'}${bonus2Str}</span>
        </div>
      `;
    }
  }
}

function _renderMatchPts(elId, p1, p2, res) {
  const el = document.getElementById(elId);
  if (!el) return;
  const w1 = res.pts1 > res.pts2, w2 = res.pts2 > res.pts1;
  el.innerHTML = `
    <div class="match-pts-player ${w1 ? 'winner' : ''}">
      <span>${p1?.name || '?'}</span>
      <span class="pts-val">${res.pts1.toFixed(1)}</span>
    </div>
    <div class="match-pts-sep">–</div>
    <div class="match-pts-player ${w2 ? 'winner' : ''}">
      <span class="pts-val">${res.pts2.toFixed(1)}</span>
      <span>${p2?.name || '?'}</span>
    </div>
  `;
}

function _colorScoreGrid(tableId, holes, s1, s2, hcp1, hcp2) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const str1 = getHcpStrokes(Math.max(0, hcp1 - hcp2), holes);
  const str2 = getHcpStrokes(Math.max(0, hcp2 - hcp1), holes);

  const rows = table.querySelectorAll('tbody tr.sg-player-row');
  if (rows.length < 2) return;

  holes.forEach((hole, i) => {
    const g1 = s1[i] || 0, g2 = s2[i] || 0;
    if (!g1 || !g2) return;
    const net1 = g1 - str1[i], net2 = g2 - str2[i];
    const cell1 = rows[0].cells[i + 1];
    const cell2 = rows[1].cells[i + 1];
    if (cell1) cell1.classList.toggle('hole-win', net1 < net2);
    if (cell2) cell2.classList.toggle('hole-win', net2 < net1);
  });
}

function _renderModalFooter(status, match, uid, isCommish,
    t1, t2, t1lo, t1hi, t2lo, t2hi, hcp1lo, hcp1hi, hcp2lo, hcp2hi, holes) {
  const footer = document.getElementById('modal-footer');
  if (!footer) return;
  const canEnter   = _canEnterScores(match, uid) || isCommish;
  const canApprove = _canApproveScores(match, uid);

  if (status === 'committed') {
    footer.innerHTML = `<div class="modal-committed-msg">✓ Scores are locked and final</div>`;
    return;
  }

  if (status === 'draft' && canEnter) {
    footer.innerHTML = `
      <button class="btn-modal-submit" onclick="handleSubmitScores()">
        Submit Scores for Approval →
      </button>
      <p class="modal-footer-hint">Opponent will need to approve before scores are final</p>
    `;
    return;
  }

  // Dispute history display helper
  const disputeHistoryHtml = (match.disputeHistory || []).length ? `
    <div class="dispute-history">
      <div class="dispute-history-title">Dispute History</div>
      ${(match.disputeHistory || []).map(d => `
        <div class="dispute-entry">
          <span class="dispute-note">"${d.note || 'No note'}"</span>
          <span class="dispute-time">${d.at ? new Date(d.at).toLocaleDateString() : ''}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  if (status === 'pending' && canApprove) {
    footer.innerHTML = `
      ${disputeHistoryHtml}
      <div class="modal-approve-row">
        <button class="btn-modal-reject" onclick="handleDisputeScores()">⚠ Dispute</button>
        <button class="btn-modal-approve" onclick="handleApproveScores()">✓ Approve & Lock</button>
      </div>
      <p class="modal-footer-hint">Dispute sends scores back with a note for the submitter</p>
    `;
    return;
  }

  if (status === 'pending') {
    footer.innerHTML = `<div class="modal-committed-msg" style="color:var(--gd)">⏳ Waiting for opponent to approve</div>`;
    return;
  }

  if ((status === 'disputed' || status === 'escalated') && canEnter) {
    footer.innerHTML = `
      ${disputeHistoryHtml}
      <button class="btn-modal-submit" onclick="handleSubmitScores()">
        Re-Submit Scores →
      </button>
      <p class="modal-footer-hint">Review and fix scores, then re-submit for approval</p>
    `;
    return;
  }

  if ((status === 'disputed' || status === 'escalated') && canApprove) {
    footer.innerHTML = `
      ${disputeHistoryHtml}
      <div class="modal-approve-row">
        <button class="btn-modal-reject" onclick="handleDisputeScores()">⚠ Dispute Again</button>
        <button class="btn-modal-approve" onclick="handleApproveScores()">✓ Approve & Lock</button>
      </div>
      ${status === 'escalated' ? '<p class="modal-footer-hint" style="color:#e74c3c">⚡ Commissioner can force-commit this match</p>' : ''}
    `;
    return;
  }

  if (status === 'escalated' && isCommish) {
    footer.innerHTML = `
      ${disputeHistoryHtml}
      <div class="modal-approve-row">
        <button class="btn-modal-approve" onclick="handleForceCommit()">🔒 Force Commit</button>
      </div>
      <p class="modal-footer-hint">Commissioner override — locks scores immediately</p>
    `;
    return;
  }

  if (status === 'disputed' || status === 'escalated') {
    footer.innerHTML = `${disputeHistoryHtml}<div class="modal-committed-msg" style="color:#e67e22">⚠️ Match is ${status} — waiting for resolution</div>`;
    return;
  }

  footer.innerHTML = '';
}

async function handleSubmitScores() {
  if (!_modalMatchKey) return;
  const liveScores = _readInputScores();

  // Validate — need at least some scores entered
  const filled = Object.values(liveScores).flat().filter(s => s > 0).length;
  if (filled < 9) {
    toast('Enter at least 9 hole scores before submitting', 'error'); return;
  }

  const btn = document.querySelector('.btn-modal-submit');
  if (btn) { btn.textContent = 'Submitting…'; btn.disabled = true; }

  try {
    const match = APP.matches[_modalMatchKey];
    const myTeamId = _getMyTeamId(match);
    await window._FB.submitScores(_modalMatchKey, liveScores, myTeamId);

    // Also commit scores to playerRounds so handicaps update
    await _commitScoresToPlayerRounds(liveScores, match);

    toast('Scores submitted! Waiting for opponent to approve.', 'success');
    closeMatchModal();
  } catch (err) {
    console.error('[submitScores]', err);
    toast('Error submitting — check console', 'error');
    if (btn) { btn.textContent = 'Submit Scores for Approval →'; btn.disabled = false; }
  }
}

async function handleApproveScores() {
  if (!_modalMatchKey) return;
  const btn = document.querySelector('.btn-modal-approve');
  if (btn) { btn.textContent = 'Approving…'; btn.disabled = true; }
  try {
    // Calculate and store result on approve
    const match  = APP.matches[_modalMatchKey];
    const config = APP.config || {};
    const teams  = config.teams || [];
    const nine   = match.nine || 'front';
    const holes  = config.course?.scorecard?.[nine] || _defaultHoles(nine);
    const t1     = teams.find(t => t.id === match.team1Id) || { players: [] };
    const t2     = teams.find(t => t.id === match.team2Id) || { players: [] };
    const t1lo   = t1.players.find(p => p.hilo === 'LO') || t1.players[0];
    const t1hi   = t1.players.find(p => p.hilo === 'HI') || t1.players[1];
    const t2lo   = t2.players.find(p => p.hilo === 'LO') || t2.players[0];
    const t2hi   = t2.players.find(p => p.hilo === 'HI') || t2.players[1];
    const pv         = _getPV(config);
    const playsBoth  = _getAbsentRule(config) === 'plays_both';
    const hcp        = p => p ? calcHcp(APP.rounds[p.id] || [], config) : 0;
    const scores     = match.scores || {};

    // plays_both: if one player is absent, the present player's score runs against both opponents
    const t1hiAbsent = playsBoth && !(scores[t1hi?.id] || []).some(s=>s>0);
    const t1loAbsent = playsBoth && !(scores[t1lo?.id] || []).some(s=>s>0);
    const t2hiAbsent = playsBoth && !(scores[t2hi?.id] || []).some(s=>s>0);
    const t2loAbsent = playsBoth && !(scores[t2lo?.id] || []).some(s=>s>0);

    const sc1hi = t1hiAbsent ? (scores[t1lo?.id]||[]) : (scores[t1hi?.id]||[]);
    const sc1lo = t1loAbsent ? (scores[t1hi?.id]||[]) : (scores[t1lo?.id]||[]);
    const sc2hi = t2hiAbsent ? (scores[t2lo?.id]||[]) : (scores[t2hi?.id]||[]);
    const sc2lo = t2loAbsent ? (scores[t2hi?.id]||[]) : (scores[t2lo?.id]||[]);
    const hcp1hi = t1hiAbsent ? hcp(t1lo) : hcp(t1hi);
    const hcp1lo = t1loAbsent ? hcp(t1hi) : hcp(t1lo);
    const hcp2hi = t2hiAbsent ? hcp(t2lo) : hcp(t2hi);
    const hcp2lo = t2loAbsent ? hcp(t2hi) : hcp(t2lo);

    const hiRes  = calcMatch(sc1hi, sc2hi, hcp1hi, hcp2hi, holes, pv);
    const loRes  = calcMatch(sc1lo, sc2lo, hcp1lo, hcp2lo, holes, pv);

    // Team net bonus: goes to team with lower combined net score
    const teamNetPts = pv?.teamNet ?? 0;
    let teamBonus1 = 0, teamBonus2 = 0;
    if (teamNetPts > 0) {
      const combinedNet1 = (hiRes.totalNet1 ?? 0) + (loRes.totalNet1 ?? 0);
      const combinedNet2 = (hiRes.totalNet2 ?? 0) + (loRes.totalNet2 ?? 0);
      if (combinedNet1 < combinedNet2)       teamBonus1 = teamNetPts;
      else if (combinedNet2 < combinedNet1)  teamBonus2 = teamNetPts;
      else { teamBonus1 = teamNetPts / 2; teamBonus2 = teamNetPts / 2; }
    }

    const result = {
      team1Id: match.team1Id, team2Id: match.team2Id,
      pts1: hiRes.pts1 + loRes.pts1 + teamBonus1,
      pts2: hiRes.pts2 + loRes.pts2 + teamBonus2,
      hiPts1: hiRes.pts1, hiPts2: hiRes.pts2,
      loPts1: loRes.pts1, loPts2: loRes.pts2,
      teamBonus1, teamBonus2,
    };

    await window._FB.approveScores(_modalMatchKey, result);
    toast('Scores approved and locked! 🎉', 'success');
    closeMatchModal();
  } catch (err) {
    console.error('[approveScores]', err);
    toast('Error approving — check console', 'error');
    if (btn) { btn.textContent = '✓ Approve & Lock'; btn.disabled = false; }
  }
}

async function handleRejectScores() {
  if (!_modalMatchKey) return;
  await window._FB.rejectScores(_modalMatchKey);
  toast('Scores sent back for correction', 'default');
  closeMatchModal();
}

async function handleDisputeScores() {
  if (!_modalMatchKey) return;
  const note = prompt('Reason for dispute (optional):') || '';
  try {
    await window._FB.disputeScores(_modalMatchKey, note);
    const match = APP.matches[_modalMatchKey];
    const wasDisputed = match?.status === 'disputed';
    toast(wasDisputed ? 'Match escalated to commissioner' : 'Scores disputed — sent back with note', 'default');
    closeMatchModal();
  } catch (err) {
    console.error('[handleDisputeScores]', err);
    toast('Failed to dispute', 'error');
  }
}

async function handleForceCommit() {
  if (!_modalMatchKey) return;
  if (!confirm('Force commit this match? This is a commissioner override.')) return;
  try {
    // Calculate result same as handleApproveScores
    const match  = APP.matches[_modalMatchKey];
    const config = APP.config || {};
    const teams  = config.teams || [];
    const nine   = match.nine || 'front';
    const holes  = config.course?.scorecard?.[nine] || _defaultHoles(nine);
    const t1     = teams.find(t => t.id === match.team1Id) || { players: [] };
    const t2     = teams.find(t => t.id === match.team2Id) || { players: [] };
    const t1lo   = t1.players.find(p => p.hilo === 'LO') || t1.players[0];
    const t1hi   = t1.players.find(p => p.hilo === 'HI') || t1.players[1];
    const t2lo   = t2.players.find(p => p.hilo === 'LO') || t2.players[0];
    const t2hi   = t2.players.find(p => p.hilo === 'HI') || t2.players[1];
    const pv     = _getPV(config);
    const hcpFn  = p => p ? calcHcp(APP.rounds[p.id] || [], config) : 0;
    const scores = match.scores || {};

    const hiRes  = calcMatch(scores[t1hi?.id]||[], scores[t2hi?.id]||[], hcpFn(t1hi), hcpFn(t2hi), holes, pv);
    const loRes  = calcMatch(scores[t1lo?.id]||[], scores[t2lo?.id]||[], hcpFn(t1lo), hcpFn(t2lo), holes, pv);

    const result = {
      team1Id: match.team1Id, team2Id: match.team2Id,
      pts1: hiRes.pts1 + loRes.pts1, pts2: hiRes.pts2 + loRes.pts2,
      hiPts1: hiRes.pts1, hiPts2: hiRes.pts2,
      loPts1: loRes.pts1, loPts2: loRes.pts2,
    };

    await window._FB.forceCommitMatch(_modalMatchKey, result);
    toast('Match force-committed by commissioner', 'success');
    closeMatchModal();
  } catch (err) {
    console.error('[handleForceCommit]', err);
    toast('Force commit failed', 'error');
  }
}

window.handleDisputeScores = handleDisputeScores;
window.handleForceCommit   = handleForceCommit;

function _getMyTeamId(match) {
  const myPlayerId = APP.member?.playerId;
  if (!myPlayerId) return match.team1Id;
  const t1 = (APP.config?.teams || []).find(t => t.id === match.team1Id);
  const onTeam1 = (t1?.players || []).some(p => p.id === myPlayerId);
  return onTeam1 ? match.team1Id : match.team2Id;
}

async function _commitScoresToPlayerRounds(scores, match) {
  // Write each player's score as a new round entry in playerRounds
  const date   = match.date || new Date().toISOString().slice(0,10);
  const nine   = match.nine || 'front';
  const config = APP.config || {};
  const holes  = config.course?.scorecard?.[nine] || _defaultHoles(nine);
  const par    = holes.reduce((a, h) => a + h.par, 0);

  for (const [playerId, holeScores] of Object.entries(scores)) {
    const grossScore = holeScores.reduce((a, b) => a + (parseInt(b) || 0), 0);
    if (!grossScore) continue;
    const existing = (APP.rounds[playerId] || []).slice();
    existing.push({ date, grossScore, score: grossScore, matchKey: _modalMatchKey, nine });
    await window._FB.savePlayerRounds(playerId, existing);
  }
}

// ===== League Loading =====
async function loadLeague(leagueId) {
  const { setActiveLeague, loadLeagueConfig, loadMembership, saveMembership, listenMatches, listenPlayerRounds, listenLeagueConfig } = window._FB;

  setActiveLeague(leagueId);
  APP.leagueId = leagueId;
  window._leagueId = leagueId;

  // Load config
  APP.config = await loadLeagueConfig();
  if (!APP.config) { toast('League not found', 'error'); return; }

  // Load membership (role + playerId for current user)
  const uid = APP.user?.uid || window._currentUser?.uid;
  if (uid) {
    APP.member = await loadMembership(uid);
    // Backfill displayName/email if missing (for legacy membership docs)
    const user = APP.user || window._currentUser;
    if (APP.member && (!APP.member.displayName || !APP.member.email)) {
      const patch = {};
      if (!APP.member.displayName && user?.displayName) patch.displayName = user.displayName;
      if (!APP.member.email && user?.email) patch.email = user.email;
      if (Object.keys(patch).length) {
        saveMembership(uid, patch).catch(() => {});
        Object.assign(APP.member, patch);
      }
    }

    // Sync user league index role if it drifted from actual membership role
    if (APP.member?.role) {
      const { loadUserLeagues, addUserLeagueIndex } = window._FB;
      try {
        const leagues = await loadUserLeagues(uid);
        const idx = leagues.find(l => l.leagueId === leagueId);
        if (idx && idx.role !== APP.member.role) {
          console.log('[loadLeague] syncing index role:', idx.role, '→', APP.member.role);
          addUserLeagueIndex(uid, leagueId, idx.name, APP.member.role).catch(() => {});
        }
      } catch (e) { /* non-critical */ }
    }
  }

  // Real-time listeners
  listenLeagueConfig(config => {
    APP.config = config;
    refreshApp();
  });

  listenMatches(matches => {
    APP.matches = matches;
    renderDashboard();
    renderScores();
    renderStandings();
    renderSkins();
    renderStats();
    renderSchedule();
    renderRecap();
  });

  listenPlayerRounds(rounds => {
    APP.rounds = rounds;
    renderDashboard();
    renderHandicaps();
    renderStats();
  });

  // Update header
  const titleEl = document.querySelector('.app-header-titles h1');
  if (titleEl) titleEl.textContent = APP.config.leagueName || 'My League';

  // Check commissioner
  const isCommissioner = APP.member?.role === 'commissioner';
  document.querySelector('.nav-divider')?.style?.setProperty('display', isCommissioner ? '' : 'none');
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.style.display = isCommissioner ? '' : 'none';
  });

  showView('app');
  navTo('dashboard');
  refreshApp();

  // Auto-show claim modal for members who haven't linked a player yet
  if (APP.member && !APP.member.playerId) {
    setTimeout(() => showClaimModal(), 300);
  }
}

function refreshApp() {
  renderDashboard();
  renderScores();
  renderStandings();
  renderHandicaps();
  renderSkins();
  renderStats();
  renderSchedule();
  renderRules();
  renderRecap();
  renderHistory();
  if (APP.member?.role === 'commissioner') {
    renderAdminMembers();
    renderAdminScores();
    renderAdminTeams();
    renderAdminSettings();
  }
}

// ===== League Select =====
async function showLeagueSelect() {
  const { loadUserLeagues } = window._FB;
  const uid = APP.user?.uid || window._currentUser?.uid;
  if (!uid) { showView('signin'); return; }
  if (!APP.user) APP.user = window._currentUser;

  const leagues = await loadUserLeagues(uid);
  const container = document.getElementById('league-list');
  if (!container) { showView('league-select'); return; }

  const leagueCards = leagues.length ? leagues.map(l => `
    <div class="league-card" onclick="loadLeague('${l.leagueId}')">
      <div class="league-card-info">
        <h3>${l.name}</h3>
        <p>${l.role}</p>
      </div>
      <span class="league-card-chevron">›</span>
    </div>
  `).join('') : `
    <div class="league-empty">
      <p>You're not in any leagues yet.</p>
    </div>
  `;

  container.innerHTML = `
    ${leagueCards}
    <div class="join-card">
      <h3>Join a League</h3>
      <p style="color:var(--mt);font-size:13px;margin-bottom:12px">Enter the 6-character code from your commissioner</p>
      <div style="display:flex;gap:10px;align-items:center">
        <input id="join-code-input" class="field join-code-input" type="text"
               maxlength="6" placeholder="ABC123"
               oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" />
        <button class="btn btn-green" onclick="handleJoinLeague()">Join</button>
      </div>
      <div id="join-error" style="color:var(--ac);font-size:13px;margin-top:8px;display:none"></div>
    </div>
    <div style="text-align:center;margin-top:16px">
      <button class="btn-primary" onclick="startWizard()">Create a League</button>
    </div>
  `;

  showView('league-select');

  // Auto-join from URL param: ?join=ABCDEF
  const params = new URLSearchParams(window.location.search);
  const joinParam = params.get('join');
  if (joinParam) {
    const inp = document.getElementById('join-code-input');
    if (inp) inp.value = joinParam.toUpperCase();
    // Clear the URL param so it doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname);
    handleJoinLeague();
  }
}

async function handleJoinLeague() {
  const { findLeagueByJoinCode, joinLeague } = window._FB;
  const uid = APP.user?.uid || window._currentUser?.uid;
  const user = APP.user || window._currentUser;
  if (!uid) return;

  const input = document.getElementById('join-code-input');
  const errEl = document.getElementById('join-error');
  const code  = input?.value?.trim();

  if (!code || code.length < 4) {
    if (errEl) { errEl.textContent = 'Enter a valid join code'; errEl.style.display = ''; }
    return;
  }

  // Disable button during request
  const btn = input?.parentElement?.querySelector('.btn-green');
  if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }

  try {
    const league = await findLeagueByJoinCode(code);
    if (!league) {
      if (errEl) { errEl.textContent = 'Invalid code — no league found'; errEl.style.display = ''; }
      return;
    }

    const result = await joinLeague(uid, league.id, {
      displayName: user?.displayName || '',
      email: user?.email || ''
    });

    if (result?.alreadyMember) {
      toast(`Already in ${league.name} — loading`, 'success');
    } else {
      toast(`Joined ${league.name}!`, 'success');
    }
    // Auto-load the league either way
    await loadLeague(league.id);
  } catch (err) {
    console.error('[Join]', err);
    if (errEl) { errEl.textContent = 'Failed to join — try again'; errEl.style.display = ''; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
  }
}

// ===== Wizard Start =====
function startWizard() {
  APP.wizard = { step: 1, data: {} };
  _teamCount = 0;
  _pool = [];
  _poolIdCounter = 0;
  showView('wizard');
  _renderWizardStep();

  setTimeout(() => {
    // Init scorecard grids (step 3 — manual entry tab)
    renderScorecardGrid('scorecard-front-container', 'front');
    renderScorecardGrid('scorecard-back-container', 'back');
    // Render schedule (step 6)
    renderScheduleWeeks();
  }, 50);
}

// ===== Auth Flows =====
// All Firebase calls go through window._FB which is set by the module script in index.html

async function handleGoogleSignIn() {
  const { GoogleAuthProvider, signInWithPopup, getAuth } = window._FB;
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(getAuth(), provider);
    await onUserSignedIn(result.user);
  } catch (err) {
    console.error(err);
    if (err.code !== 'auth/popup-closed-by-user') toast('Sign-in failed', 'error');
  }
}

async function handleEmailSignIn(e) {
  e?.preventDefault();
  const email = document.getElementById('signin-email')?.value?.trim();
  const pass  = document.getElementById('signin-pass')?.value;
  if (!email || !pass) { toast('Enter email and password', 'error'); return; }
  const { signInWithEmailAndPassword, getAuth } = window._FB;
  try {
    const result = await signInWithEmailAndPassword(getAuth(), email, pass);
    await onUserSignedIn(result.user);
  } catch (err) {
    toast(friendlyAuthError(err.code), 'error');
  }
}

async function handleEmailSignUp(e) {
  e?.preventDefault();
  const name  = document.getElementById('signup-name')?.value?.trim();
  const email = document.getElementById('signup-email')?.value?.trim();
  const pass  = document.getElementById('signup-pass')?.value;
  if (!name || !email || !pass) { toast('Fill all fields', 'error'); return; }
  const { createUserWithEmailAndPassword, getAuth, saveUserProfile } = window._FB;
  try {
    const result = await createUserWithEmailAndPassword(getAuth(), email, pass);
    await saveUserProfile(result.user.uid, { displayName: name, email, createdAt: Date.now() });
    await onUserSignedIn(result.user);
  } catch (err) {
    toast(friendlyAuthError(err.code), 'error');
  }
}

async function onUserSignedIn(user) {
  APP.user = user;
  window._currentUser = user;
  await showLeagueSelect();
}

async function handleSignOut() {
  const { signOut, getAuth } = window._FB;
  await signOut(getAuth());
  APP.user     = null;
  APP.leagueId = null;
  APP.config   = null;
  APP.matches  = {};
  APP.rounds   = {};
  window._currentUser = null;
  showView('splash');
  // Show the sign-in/sign-up buttons after sign-out
  const btns    = document.getElementById('splash-btns');
  const loading = document.getElementById('splash-loading');
  if (loading) loading.style.display = 'none';
  if (btns)    btns.style.display    = 'flex';
}

function friendlyAuthError(code) {
  const msgs = {
    'auth/user-not-found':   'No account with that email',
    'auth/wrong-password':   'Incorrect password',
    'auth/invalid-email':    'Invalid email address',
    'auth/email-already-in-use': 'Email already in use',
    'auth/weak-password':    'Password must be at least 6 characters',
    'auth/invalid-credential': 'Invalid email or password',
  };
  return msgs[code] || 'Sign-in failed — try again';
}

// Auth state is handled by the inline module script in index.html
// which calls window.showLeagueSelect() or window.showView('splash')

// ===== DOMContentLoaded =====
document.addEventListener('DOMContentLoaded', () => {
  // Force color-scheme dark on date/time inputs (for dark dropdown popups)
  // MutationObserver handles inputs added dynamically (schedule weeks, etc.)
  function fixDateTimeInputs() {
    document.querySelectorAll('input[type="date"], input[type="time"]').forEach(inp => {
      inp.style.colorScheme = 'dark';
    });
  }
  fixDateTimeInputs();
  new MutationObserver(() => fixDateTimeInputs())
    .observe(document.body, { childList: true, subtree: true });

  showView('splash');
  initToggleGroups();
  initTabGroups();
  initOCRUpload();

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => navTo(btn.dataset.tab));
  });

  // Wizard
  document.getElementById('wizard-next-btn')?.addEventListener('click', wizardNext);
  document.getElementById('wizard-back-btn')?.addEventListener('click', wizardBack);

  // Splash buttons — Create League → sign-up flow; Sign In → sign-in flow
  document.getElementById('btn-create-league')?.addEventListener('click', () => showView('signup'));
  document.getElementById('btn-sign-in')?.addEventListener('click', () => showView('signin'));

  // Sign in
  document.getElementById('btn-google-signin')?.addEventListener('click', handleGoogleSignIn);
  document.getElementById('signin-form')?.addEventListener('submit', handleEmailSignIn);
  document.getElementById('link-to-signup')?.addEventListener('click', () => showView('signup'));

  // Sign up
  document.getElementById('btn-google-signup')?.addEventListener('click', handleGoogleSignIn);
  document.getElementById('signup-form')?.addEventListener('submit', handleEmailSignUp);
  document.getElementById('link-to-signin')?.addEventListener('click', () => showView('signin'));

  // League select
  document.getElementById('btn-new-league')?.addEventListener('click', startWizard);

  // App header
  document.getElementById('btn-switch-league')?.addEventListener('click', showLeagueSelect);
  document.getElementById('user-avatar')?.addEventListener('click', handleSignOut);

  // Wizard step 6: re-render schedule if user goes back/forward
  // (handled by wizardNext collecting data and renderScheduleWeeks on wizard init)
});

// ===== Expose globals needed by inline onclick handlers =====
window.showView           = showView;
window.wizardNext         = wizardNext;
window.wizardBack         = wizardBack;
window.addTeam            = addTeam;
window.removeTeam         = removeTeam;
window.addPlayerToTeam    = addPlayerToTeam;
window.removePlayer       = removePlayer;
window.toggleHiLo         = toggleHiLo;
window.toggleNine         = toggleNine;
window.setToggle          = setToggle;
window.loadLeague         = loadLeague;
window.showLeagueSelect   = showLeagueSelect;
window.startWizard        = startWizard;
window.handleSignOut      = handleSignOut;
window.addScheduleWeek    = addScheduleWeek;
window.renumberSchedule   = renumberSchedule;
window.selectFormat       = selectFormat;
window.showFormatInfo     = showFormatInfo;
window.renderHcpManualTable   = renderHcpManualTable;
window.saveHcpManualScore     = saveHcpManualScore;
window.toggleAbsentScoreInput = toggleAbsentScoreInput;
window.getAbsentScore         = getAbsentScore;
window.toggleHcpSystemSettings = toggleHcpSystemSettings;
window.toggleImportPanel      = toggleImportPanel;
window.loadImportFile         = loadImportFile;
window.importPlayerNames      = importPlayerNames;
window.handleHcpCsvDrop       = handleHcpCsvDrop;
window.handleHcpCsvFiles      = handleHcpCsvFiles;
window.clearHcpImport         = clearHcpImport;
window.stepPts                = stepPts;
window.updatePtsPreview       = updatePtsPreview;
window.addPlayerToPool        = addPlayerToPool;
window.removeFromPool         = removeFromPool;
window.assignToNextTeam       = assignToNextTeam;
window.dropOnPool             = dropOnPool;
window.dropOnTeam             = dropOnTeam;
window.returnPlayerToPool     = returnPlayerToPool;
window.openMatch              = openMatch;
window.closeMatchModal        = closeMatchModal;
window.handleSubmitScores     = handleSubmitScores;
window.handleApproveScores    = handleApproveScores;
window.handleRejectScores     = handleRejectScores;
