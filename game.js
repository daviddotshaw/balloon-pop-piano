'use strict';

// ─── SONG ────────────────────────────────────────────────────────────────────
const SONG = [
  'C','C','G','G','A','A','G',
  'F','F','E','E','D','D','C',
  'G','G','F','F','E','E','D',
  'G','G','F','F','E','E','D',
  'C','C','G','G','A','A','G',
  'F','F','E','E','D','D','C',
];

const COLORS      = { C:'#FF3B30', D:'#FF9500', E:'#FFD60A', F:'#30D158', G:'#0A84FF', A:'#BF5AF2' };
const CAL_NOTES   = ['C','D','E','F','G','A'];
const CAL_SAMPLES = 3;
const QUEUE_GAP   = 190;
const BALLOON_R   = 50;
const VISIBLE_CNT = 4;

// ─── CANVAS ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const cx     = canvas.getContext('2d');
let HIT_Y = 0;

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  HIT_Y = Math.round(canvas.height * 0.21);
  if (stars.length === 0) initStars();
}
window.addEventListener('resize', resize);

// ─── STATE ───────────────────────────────────────────────────────────────────
let gamePhase   = 'start';
let songIdx     = 0;
let balloons    = [];
let particles   = [];
let fireworks   = [];
let stars       = [];
let shootStars  = [];
let lastPopMs   = 0;
let micLevel    = 0;
let speedBoost  = 0;

// Calibration
let calibData      = {};   // active calibration (rebuilt each session)
let savedCalibData = {};   // persists across Play Again so Skip reuses it
let calIdx         = 0;
let calSamples     = [];
let calCooldown    = 0;

// Pitch debounce — require 2 consecutive same-note readings before accepting
let lastDetNote  = null;
let lastDetCount = 0;

// ─── AUDIO ───────────────────────────────────────────────────────────────────
let audioCtx   = null;
let analyser   = null;
let pitchBuf   = null;
let pitchTimer = null;
let sfxCtx     = null;

async function startMic() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const src    = audioCtx.createMediaStreamSource(stream);
    analyser     = audioCtx.createAnalyser();
    // Target ~90ms window regardless of sample rate.
    // At 8000 Hz the default 4096 gives a 512ms window — far too long.
    const targetSamples = Math.round(audioCtx.sampleRate * 0.09);
    const fftSize = Math.min(4096, Math.max(512,
      Math.pow(2, Math.ceil(Math.log2(targetSamples)))
    ));
    analyser.fftSize               = fftSize;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    pitchBuf   = new Float32Array(analyser.fftSize);
    pitchTimer = setInterval(detectPitch, 80);
    return true;
  } catch (err) {
    console.error('startMic:', err);
    document.getElementById('startScreen').style.display    = 'none';
    document.getElementById('micErrorScreen').style.display = 'flex';
    return false;
  }
}

function stopMic() {
  if (pitchTimer) { clearInterval(pitchTimer); pitchTimer = null; }
  if (audioCtx)   { audioCtx.close(); audioCtx = null; }
  analyser = null; pitchBuf = null;
}

// ─── PITCH DETECTION ─────────────────────────────────────────────────────────
function detectPitch() {
  if (!analyser) return;
  analyser.getFloatTimeDomainData(pitchBuf);

  let rms = 0;
  for (let i = 0; i < pitchBuf.length; i++) rms += pitchBuf[i] ** 2;
  micLevel = Math.min(1, Math.sqrt(rms / pitchBuf.length) * 14);

  const freq = autoCorrelate(pitchBuf, audioCtx.sampleRate);
  if (freq < 0) return;

  // ── calibration mode ──
  if (gamePhase === 'calibrating') {
    updateCalMic();
    // Accept if freq is within 2.5 semitones of the target note in any octave.
    // 2.5 semitones handles pianos tuned up to ~1 semitone sharp or flat
    // and autocorrelation jitter, while still rejecting the adjacent game note.
    const targetFreqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00];
    const target  = targetFreqs[calIdx];
    const rawSt   = Math.abs(12 * Math.log2(freq / target));
    const semDist = Math.min(rawSt % 12, 12 - rawSt % 12);
    updateCalHeard(freq);        // show user what the mic is picking up
    if (semDist > 2.5) return;
    const now = Date.now();
    if (now - calCooldown < 350) return;
    calCooldown = now;
    calSamples.push(freq);
    updateCalDots();
    if (calSamples.length >= CAL_SAMPLES) finishCalNote();
    return;
  }

  if (gamePhase !== 'playing') return;

  const note = freqToNote(freq);
  if (!note || !COLORS[note]) return;

  // Debounce: require 2 consecutive same-note detections before accepting.
  // Prevents spurious single-frame detections and held-note double-pops.
  if (note !== lastDetNote) { lastDetNote = note; lastDetCount = 1; return; }
  lastDetCount++;
  if (lastDetCount < 2) return;

  const now = Date.now();
  if (now - lastPopMs < 350) return;

  const b0 = balloons[0];
  if (!b0 || b0.state === 'popping') return;

  if (Math.abs(b0.y - b0.targetY) > 130) return;

  if (note === b0.note) { popBalloon(b0); lastPopMs = now; }
  // Silent on wrong note
}

function autoCorrelate(buf, sr) {
  const N = buf.length, HALF = N >> 1;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] ** 2;
  if (Math.sqrt(rms / N) < 0.01) return -1;

  let best = -1, bestC = 0, lastC = 1, found = false;
  const corrs = new Float32Array(HALF);
  for (let o = 1; o < HALF; o++) {
    let c = 0;
    for (let i = 0; i < HALF; i++) c += Math.abs(buf[i] - buf[i + o]);
    c = 1 - c / HALF;
    corrs[o] = c;
    if (c > 0.75 && c > lastC) {
      found = true;
      if (c > bestC) { bestC = c; best = o; }
    } else if (found) {
      const shift = ((corrs[best + 1] ?? corrs[best]) - (corrs[best - 1] ?? corrs[best])) / (2 * corrs[best]);
      return sr / (best + shift);
    }
    lastC = c;
  }
  return best > 0 ? sr / best : -1;
}

// Standard 12-tone detection — used during calibration and as fallback
function freqToNoteChromatic(freq) {
  if (freq < 80 || freq > 2100) return null;
  const midi  = Math.round(12 * Math.log2(freq / 440) + 69);
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[((midi % 12) + 12) % 12];
}

// Calibration-aware detection.
// Uses semitone-based octave-invariant distance so any octave of a calibrated note matches.
function freqToNote(freq) {
  if (freq < 80 || freq > 2100) return null;

  if (Object.keys(calibData).length === 6) {
    let best = null, bestSt = Infinity;
    for (const [note, baseFreq] of Object.entries(calibData)) {
      const raw = 12 * Math.log2(freq / baseFreq);
      const mod = ((raw % 12) + 12) % 12;
      const st  = Math.min(mod, 12 - mod); // 0–6 semitones, octave-invariant
      if (st < bestSt) { bestSt = st; best = note; }
    }
    return bestSt < 0.7 ? best : null; // within 0.7 semitones of a calibrated note
  }

  // Default: chromatic, game notes only
  const name = freqToNoteChromatic(freq);
  return CAL_NOTES.includes(name) ? name : null;
}

// ─── CALIBRATION ─────────────────────────────────────────────────────────────
function startCalibration() {
  calIdx      = 0;
  calSamples  = [];
  calCooldown = 0;
  calibData   = {};
  document.getElementById('calScreen').style.display = 'flex';
  gamePhase = 'calibrating';
  updateCalUI();
  updateSkipBtn();
}

function updateCalUI() {
  const note  = CAL_NOTES[calIdx];
  const color = COLORS[note];

  const dot = document.getElementById('calNoteDot');
  dot.textContent      = note;
  dot.style.background = color;
  dot.style.boxShadow  = `0 0 36px ${color}88`;
  dot.style.color      = note === 'E' ? '#333' : '#fff';

  document.getElementById('calInstructions').textContent = `Play  ${note}  on your piano a few times`;

  updateCalDots();

  CAL_NOTES.forEach((n, i) => {
    const el = document.getElementById(`calTrack-${n}`);
    if (!el) return;
    if (i < calIdx) {
      el.style.cssText = `background:${COLORS[n]};color:${n==='E'?'#333':'#fff'};border-color:transparent;opacity:0.55;transform:scale(1);transition:all 0.3s`;
    } else if (i === calIdx) {
      el.style.cssText = `background:${COLORS[n]};color:${n==='E'?'#333':'#fff'};border-color:${COLORS[n]};opacity:1;transform:scale(1.22);transition:all 0.3s`;
    } else {
      el.style.cssText = `background:transparent;color:rgba(255,255,255,0.3);border-color:rgba(255,255,255,0.15);opacity:1;transform:scale(1);transition:all 0.3s`;
    }
  });
}

function updateCalDots() {
  document.querySelectorAll('#calSampleDots .cal-dot').forEach((d, i) => {
    d.classList.toggle('filled', i < calSamples.length);
  });
}

function updateCalMic() {
  const fill = document.getElementById('calMicFill');
  if (fill) fill.style.width = `${micLevel * 100}%`;
}

function updateCalHeard(freq) {
  const el = document.getElementById('calHeard');
  if (!el || freq < 80) return;
  const midi  = Math.round(12 * Math.log2(freq / 440) + 69);
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const note  = names[((midi % 12) + 12) % 12];
  const oct   = Math.floor(midi / 12) - 1;
  el.textContent = `Hearing: ${note}${oct}  (${Math.round(freq)} Hz)`;
}

function finishCalNote() {
  const sorted = [...calSamples].sort((a, b) => a - b);
  calibData[CAL_NOTES[calIdx]] = sorted[Math.floor(sorted.length / 2)];
  calIdx++;
  calSamples = [];
  if (calIdx >= CAL_NOTES.length) {
    savedCalibData = { ...calibData }; // persist for next Play Again
    updateSkipBtn();
    beginGame();
  } else {
    updateCalUI();
  }
}

function skipCalibration() {
  // Reuse last tuning if available, otherwise fall back to default detection
  calibData = Object.keys(savedCalibData).length === 6 ? { ...savedCalibData } : {};
  beginGame();
}

function updateSkipBtn() {
  const btn = document.getElementById('skipCalBtn');
  if (!btn) return;
  btn.textContent = Object.keys(savedCalibData).length === 6
    ? 'Skip — keep last tuning →'
    : 'Skip Tuning →';
}

function beginGame() {
  document.getElementById('calScreen').style.display = 'none';
  document.getElementById('stopBtn').style.display   = 'block';
  resetGame();
  canvas.style.display = 'block';
  gamePhase = 'playing';
}

// ─── BALLOON LOGIC ───────────────────────────────────────────────────────────
function makeBalloon(idx) {
  return {
    idx,
    note:    SONG[idx],
    color:   COLORS[SONG[idx]],
    x:       BALLOON_R * 1.6 + Math.random() * (canvas.width - BALLOON_R * 3.2),
    y:       canvas.height + 110,
    targetY: 0,
    state:   'rising',
    popT:    0,
    wobble:  Math.random() * Math.PI * 2,
  };
}

function assignTargets() {
  let qi = 0;
  for (const b of balloons) {
    if (b.state === 'popping') continue;
    b.targetY = HIT_Y + qi * QUEUE_GAP;
    qi++;
  }
}

function fillQueue() {
  const active = balloons.filter(b => b.state !== 'popping');
  while (active.length < VISIBLE_CNT) {
    const next = songIdx + active.length;
    if (next >= SONG.length) break;
    const b = makeBalloon(next);
    balloons.push(b);
    active.push(b);
  }
  assignTargets();
}

function popBalloon(b) {
  b.state = 'popping';
  spawnConfetti(b);
  playPop();
  speedBoost   = 1;
  lastDetNote  = null; // force player to re-trigger next note; prevents held-note double-pop
  lastDetCount = 0;
  setTimeout(() => {
    balloons = balloons.filter(x => x !== b);
    songIdx++;
    fillQueue();
    assignTargets();
    if (songIdx >= SONG.length) setTimeout(doVictory, 900);
  }, 650);
}

// ─── PARTICLES ───────────────────────────────────────────────────────────────
function spawnConfetti(b) {
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const spd = 3 + Math.random() * 7;
    particles.push({
      x: b.x, y: b.y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 4.5,
      color: i % 4 === 0 ? '#fff' : b.color,
      size: 5 + Math.random() * 9,
      life: 1, dr: 0.013 + Math.random() * 0.017,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.28,
      rect: Math.random() > 0.45,
    });
  }
}

function spawnVictoryConfetti() {
  const cols = [...Object.values(COLORS), '#fff', '#fff', '#ffd700'];
  for (let i = 0; i < 5; i++) {
    particles.push({
      x: Math.random() * canvas.width, y: -12,
      vx: (Math.random() - 0.5) * 4, vy: 1.5 + Math.random() * 3.5,
      color: cols[Math.floor(Math.random() * cols.length)],
      size: 7 + Math.random() * 9,
      life: 1, dr: 0.003 + Math.random() * 0.004,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.18,
      rect: Math.random() > 0.35,
    });
  }
}

function spawnFirework(x, y) {
  const color = Object.values(COLORS)[Math.floor(Math.random() * 6)];
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * Math.PI * 2, spd = 1.5 + Math.random() * 6;
    fireworks.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, color,
      size: 3 + Math.random() * 5, life: 1, dr: 0.008 + Math.random() * 0.01 });
  }
}

function spawnShootingStar() {
  shootStars.push({
    x:  Math.random() * canvas.width  * 0.35,
    y:  Math.random() * canvas.height * 0.22,
    vx: 10 + Math.random() * 7,
    vy:  3 + Math.random() * 4,
    life: 1, dr: 0.011,
  });
}

// ─── STARS ───────────────────────────────────────────────────────────────────
function initStars() {
  stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 0.5 + Math.random() * 2.2,
      ph: Math.random() * Math.PI * 2,
      sp: 0.5 + Math.random() * 2.5,
    });
  }
}

// ─── SOUNDS ──────────────────────────────────────────────────────────────────
function sfx() {
  if (!sfxCtx) sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
  return sfxCtx;
}

function playPop() {
  const a = sfx(), t = a.currentTime;
  const osc = a.createOscillator(), g = a.createGain();
  osc.connect(g); g.connect(a.destination);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.exponentialRampToValueAtTime(130, t + 0.13);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  osc.start(t); osc.stop(t + 0.14);
}

function playPianoNote(a, freq, startTime, dur) {
  [[1, 0.55], [2, 0.22], [3, 0.09], [4.1, 0.05], [5, 0.03]].forEach(([mult, amp]) => {
    const osc = a.createOscillator(), g = a.createGain();
    osc.connect(g); g.connect(a.destination);
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    const decay = dur * (0.9 / mult);
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(amp, startTime + 0.006);
    g.gain.exponentialRampToValueAtTime(amp * 0.25, startTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + decay);
    osc.start(startTime); osc.stop(startTime + decay + 0.05);
  });
}

function playVictoryFanfare() {
  const a   = sfx();
  const now = a.currentTime + 0.15;

  // Quick ascending run
  [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach((freq, i) => {
    playPianoNote(a, freq, now + i * 0.1, 0.65);
  });

  // Big triumphant chord
  const chordT = now + 6 * 0.1 + 0.05;
  [523.25, 659.25, 783.99, 1046.5].forEach(freq => {
    playPianoNote(a, freq, chordT, 2.8);
  });
}

// ─── GAME FLOW ───────────────────────────────────────────────────────────────
function resetGame() {
  songIdx    = 0;
  balloons   = [];
  particles  = [];
  fireworks  = [];
  shootStars = [];
  lastPopMs  = 0;
  speedBoost = 0;
  for (let i = 0; i < Math.min(VISIBLE_CNT, SONG.length); i++) {
    const b = makeBalloon(i);
    b.targetY = HIT_Y + i * QUEUE_GAP;
    b.y       = b.targetY;
    if (i === 0) b.state = 'waiting';
    balloons.push(b);
  }
}

function doVictory() {
  gamePhase = 'victory';
  playVictoryFanfare();
  document.getElementById('victoryScreen').style.display = 'flex';
  document.getElementById('stopBtn').style.display       = 'none';

  let fw = 0;
  const fwTimer = setInterval(() => {
    spawnFirework(
      canvas.width  * (0.1 + Math.random() * 0.8),
      canvas.height * (0.1 + Math.random() * 0.65)
    );
    if (++fw > 18) clearInterval(fwTimer);
  }, 180);

  let ss = 0;
  const ssTimer = setInterval(() => {
    spawnShootingStar();
    if (++ss > 8) clearInterval(ssTimer);
  }, 650);
}

// ─── BUTTON HANDLERS ─────────────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', async () => {
  const ok = await startMic();
  if (!ok) return;
  document.getElementById('startScreen').style.display = 'none';
  startCalibration();
});

document.getElementById('skipCalBtn').addEventListener('click', skipCalibration);

document.getElementById('stopBtn').addEventListener('click', () => {
  stopMic();
  gamePhase = 'start';
  canvas.style.display = 'none';
  document.getElementById('stopBtn').style.display    = 'none';
  document.getElementById('calScreen').style.display  = 'none';
  document.getElementById('startScreen').style.display = 'flex';
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  stopMic();
  gamePhase = 'start';
  canvas.style.display = 'none';
  document.getElementById('victoryScreen').style.display = 'none';
  document.getElementById('stopBtn').style.display       = 'none';
  document.getElementById('startScreen').style.display   = 'flex';
});

document.getElementById('tryAgainBtn').addEventListener('click', async () => {
  document.getElementById('micErrorScreen').style.display = 'none';
  document.getElementById('startScreen').style.display    = 'flex';
  setTimeout(() => document.getElementById('startBtn').click(), 100);
});

document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('micErrorScreen').style.display = 'none';
  document.getElementById('startScreen').style.display    = 'flex';
});

// ─── RENDERING ───────────────────────────────────────────────────────────────
function drawBg() {
  cx.fillStyle = '#080520';
  cx.fillRect(0, 0, canvas.width, canvas.height);
  const g = cx.createRadialGradient(
    canvas.width * 0.35, canvas.height * 0.45, 0,
    canvas.width * 0.35, canvas.height * 0.45, canvas.width * 0.65
  );
  g.addColorStop(0, 'rgba(55,15,110,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawStars(t) {
  for (const s of stars) {
    const op = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.sp + s.ph));
    cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    cx.fillStyle = `rgba(255,255,215,${op})`; cx.fill();
  }
}

function drawShootingStars() {
  shootStars = shootStars.filter(s => s.life > 0 && s.x < canvas.width + 120);
  for (const s of shootStars) {
    s.x += s.vx; s.y += s.vy; s.life -= s.dr;
    const spd = Math.sqrt(s.vx ** 2 + s.vy ** 2);
    const nx = s.vx / spd, ny = s.vy / spd;
    const len = 80 + (1 - s.life) * 50;
    const grd = cx.createLinearGradient(s.x - nx * len, s.y - ny * len, s.x, s.y);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, `rgba(255,255,255,${s.life * 0.95})`);
    cx.save();
    cx.strokeStyle = grd; cx.lineWidth = 2.5;
    cx.shadowColor = '#fff'; cx.shadowBlur = 10;
    cx.beginPath();
    cx.moveTo(s.x - nx * len, s.y - ny * len);
    cx.lineTo(s.x, s.y);
    cx.stroke();
    cx.restore();
  }
}

function drawOneBalloon(b, t, alpha) {
  cx.save(); cx.globalAlpha = alpha;

  if (b.state === 'popping') {
    const p = b.popT;
    cx.beginPath(); cx.arc(b.x, b.y, BALLOON_R * (1 + p * 2), 0, Math.PI * 2);
    cx.strokeStyle = b.color; cx.lineWidth = Math.max(0, 5 * (1 - p));
    cx.globalAlpha = alpha * (1 - p); cx.stroke();
    cx.restore(); return;
  }

  const isActive = b.state === 'waiting';
  const wx = Math.sin(t * 0.0013 + b.wobble) * 5;
  const px = b.x + wx, py = b.y, r = BALLOON_R;

  if (isActive) { cx.shadowColor = b.color; cx.shadowBlur = 28; }

  const bg = cx.createRadialGradient(px - r * 0.3, py - r * 0.32, r * 0.04, px, py, r);
  bg.addColorStop(0, lighten(b.color, 75));
  bg.addColorStop(1, b.color);
  cx.beginPath(); cx.arc(px, py, r, 0, Math.PI * 2);
  cx.fillStyle = bg; cx.fill();

  cx.beginPath();
  cx.ellipse(px - r * 0.27, py - r * 0.27, r * 0.17, r * 0.27, -0.75, 0, Math.PI * 2);
  cx.fillStyle = 'rgba(255,255,255,0.44)'; cx.fill();

  cx.shadowBlur = 0;

  cx.beginPath(); cx.arc(px, py + r + 4, 5, 0, Math.PI * 2);
  cx.fillStyle = darken(b.color, 45); cx.fill();

  cx.beginPath();
  for (let i = 0; i <= 20; i++) {
    const frac = i / 20;
    const sx = px + Math.sin(frac * Math.PI * 2.8 + t * 0.0018) * 7;
    const sy = py + r + 8 + frac * 70;
    i === 0 ? cx.moveTo(sx, sy) : cx.lineTo(sx, sy);
  }
  cx.strokeStyle = 'rgba(255,255,255,0.5)'; cx.lineWidth = 1.5; cx.stroke();

  cx.fillStyle    = b.note === 'E' ? '#222' : '#fff';
  cx.font         = `bold ${Math.floor(r * 0.88)}px Arial, sans-serif`;
  cx.textAlign    = 'center'; cx.textBaseline = 'middle';
  cx.fillText(b.note, px, py + 1);

  if (isActive) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.006);
    cx.beginPath(); cx.arc(px, py, r + 11 + pulse * 10, 0, Math.PI * 2);
    cx.strokeStyle = `rgba(255,255,255,${0.38 + pulse * 0.42})`;
    cx.lineWidth = 3; cx.stroke();
    cx.fillStyle = '#fff'; cx.font = 'bold 26px Arial';
    cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    cx.fillText('▼', px, py - r - 15 - pulse * 7);
  }
  cx.restore();
}

function drawBalloons(t) {
  speedBoost = Math.max(0, speedBoost - 0.025);
  const lerpFactor = 0.046 + speedBoost * 0.1;

  for (const b of balloons) {
    if (b.state === 'popping') { b.popT = Math.min(1, b.popT + 0.048); continue; }
    b.y += (b.targetY - b.y) * lerpFactor;
    if (balloons[0] === b && b.state === 'rising' && Math.abs(b.y - b.targetY) < 3) {
      b.state = 'waiting'; b.y = b.targetY;
    }
  }

  for (let i = balloons.length - 1; i >= 0; i--) {
    const dim = i === 0 ? 1 : Math.max(0.32, 1 - i * 0.2);
    drawOneBalloon(balloons[i], t, dim);
  }
}

function drawParticles() {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.vx *= 0.97;
    p.life -= p.dr; p.rot += p.vr;
    cx.save(); cx.globalAlpha = p.life;
    cx.translate(p.x, p.y); cx.rotate(p.rot);
    cx.fillStyle = p.color;
    if (p.rect) cx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.5);
    else        { cx.beginPath(); cx.arc(0, 0, p.size / 2, 0, Math.PI * 2); cx.fill(); }
    cx.restore();
  }
}

function drawFireworks() {
  fireworks = fireworks.filter(f => f.life > 0);
  for (const f of fireworks) {
    f.x += f.vx; f.y += f.vy; f.vy += 0.09; f.life -= f.dr;
    cx.save(); cx.globalAlpha = f.life;
    cx.beginPath(); cx.arc(f.x, f.y, f.size * f.life, 0, Math.PI * 2);
    cx.fillStyle = f.color; cx.fill(); cx.restore();
  }
}

function rrect(x, y, w, h, r) {
  const R = Math.min(r, w / 2, h / 2);
  cx.beginPath();
  cx.moveTo(x + R, y); cx.lineTo(x + w - R, y); cx.arcTo(x + w, y, x + w, y + R, R);
  cx.lineTo(x + w, y + h - R); cx.arcTo(x + w, y + h, x + w - R, y + h, R);
  cx.lineTo(x + R, y + h); cx.arcTo(x, y + h, x, y + h - R, R);
  cx.lineTo(x, y + R); cx.arcTo(x, y, x + R, y, R);
  cx.closePath();
}

function drawHUD(t) {
  const bx = 20, by = 16, bw = canvas.width - 40, bh = 10;
  cx.fillStyle = 'rgba(255,255,255,0.12)';
  rrect(bx, by, bw, bh, 5); cx.fill();

  if (songIdx > 0) {
    const pg = cx.createLinearGradient(bx, 0, bx + bw, 0);
    pg.addColorStop(0,   COLORS.C); pg.addColorStop(0.2, COLORS.D);
    pg.addColorStop(0.4, COLORS.E); pg.addColorStop(0.6, COLORS.F);
    pg.addColorStop(0.8, COLORS.G); pg.addColorStop(1,   COLORS.A);
    cx.fillStyle = pg;
    rrect(bx, by, Math.max(bh, bw * (songIdx / SONG.length)), bh, 5);
    cx.fill();
  }

  cx.fillStyle = 'rgba(255,255,200,0.6)';
  cx.font = '13px Arial'; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
  cx.fillText(`${songIdx} / ${SONG.length}`, canvas.width / 2, 44);

  const active = balloons.find(b => b.state === 'waiting');
  if (active) {
    const cy2 = canvas.height - 58;
    const pulse = 0.68 + 0.32 * Math.sin(t * 0.006);
    const pw = 215, ph = 50, px = (canvas.width - pw) / 2;
    cx.save(); cx.globalAlpha = pulse;
    cx.fillStyle = active.color + '2A';
    rrect(px, cy2 - ph / 2, pw, ph, ph / 2); cx.fill();
    cx.strokeStyle = active.color; cx.lineWidth = 2; cx.stroke();
    cx.restore();
    cx.fillStyle    = '#fff';
    cx.font         = `bold ${Math.min(22, Math.floor(canvas.width * 0.056))}px Arial`;
    cx.textAlign    = 'center'; cx.textBaseline = 'middle';
    cx.fillText(`🎵  Play  ${active.note}`, canvas.width / 2, cy2);
  }

  const mw = 100, mh = 6, mx = (canvas.width - mw) / 2, my = canvas.height - 18;
  cx.fillStyle = 'rgba(255,255,255,0.14)'; rrect(mx, my, mw, mh, 3); cx.fill();
  if (micLevel > 0.01) {
    cx.fillStyle = micLevel > 0.22 ? '#30D158' : '#FF9500';
    rrect(mx, my, Math.max(mh, mw * micLevel), mh, 3); cx.fill();
  }

  cx.fillStyle = 'rgba(255,255,200,0.28)';
  cx.font = '12px Arial'; cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
  cx.fillText('⭐  Twinkle Twinkle Little Star  ⭐', canvas.width / 2, canvas.height - 3);
}

// ─── COLOUR HELPERS ──────────────────────────────────────────────────────────
function hexRgb(h) {
  return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
}
function lighten(h, a) {
  const [r,g,b] = hexRgb(h);
  return `rgb(${Math.min(255,r+a)},${Math.min(255,g+a)},${Math.min(255,b+a)})`;
}
function darken(h, a) {
  const [r,g,b] = hexRgb(h);
  return `rgb(${Math.max(0,r-a)},${Math.max(0,g-a)},${Math.max(0,b-a)})`;
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function loop(t) {
  requestAnimationFrame(loop);
  cx.clearRect(0, 0, canvas.width, canvas.height);
  drawBg(); drawStars(t);

  if (gamePhase === 'playing') {
    drawBalloons(t); drawParticles(); drawHUD(t);
  } else if (gamePhase === 'victory') {
    if (Math.random() < 0.28) spawnVictoryConfetti();
    drawParticles(); drawFireworks(); drawShootingStars();
  }
}

resize();
requestAnimationFrame(loop);
