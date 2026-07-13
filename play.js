// ========== モード判定 ==========
const _params = new URLSearchParams(location.search);
const PREVIEW = _params.has('preview');
const TEST = _params.has('test');

const COUNTDOWN_MS = 3000;

// ========== Supabase初期化 ==========
let sb = null;
let sbReady = false;

function initSupabase() {
  if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || SUPABASE_URL.includes('YOUR_')) {
    document.getElementById('config-warn').classList.remove('hidden');
    document.getElementById('screen-entry').classList.add('hidden');
    return false;
  }
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sbReady = true;
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const QUIZ_ROW_ID = 1;

// ========== 状態 ==========
let myId = localStorage.getItem('ltcb_player_id') || ('p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
localStorage.setItem('ltcb_player_id', myId);
let myName = '';
let currentQuiz = null;
let lastState = null;
let timerInterval = null;
let countdownInterval = null;
let mySelected = -1;
let finaleRunning = false;
const revealedRounds = new Set();

// テストモード用
let testChoice = -1;
let testElapsed = 0;

function effectiveStart(q) {
  return (q.question_started_at || 0) + COUNTDOWN_MS;
}

// ========== 効果音 ==========
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) {}
  }
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.2) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playFanfareCorrect() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => setTimeout(() => playTone(f, 0.3, 'triangle', 0.15), i * 100));
  setTimeout(() => {
    [1047, 1319, 1568].forEach((f) => playTone(f, 0.5, 'triangle', 0.12));
  }, 500);
}

function playGrandFanfare() {
  // 最終発表用の長いファンファーレ
  const seq = [
    [392, 0.18], [392, 0.18], [392, 0.18], [523, 0.5],
    [659, 0.18], [659, 0.18], [784, 0.6]
  ];
  let t = 0;
  seq.forEach(([f, d]) => {
    setTimeout(() => playTone(f, d + 0.1, 'triangle', 0.16), t * 1000);
    t += d;
  });
  setTimeout(() => {
    [523, 659, 784, 1047].forEach(f => playTone(f, 0.9, 'triangle', 0.1));
  }, (t + 0.15) * 1000);
}

function playWrong() {
  playTone(220, 0.3, 'sawtooth', 0.1);
  setTimeout(() => playTone(180, 0.4, 'sawtooth', 0.1), 200);
}

function playTick() { playTone(800, 0.05, 'square', 0.05); }
function playSelect() { playTone(600, 0.1, 'sine', 0.1); }
function playCountBeep(final) {
  if (final) playTone(880, 0.4, 'square', 0.14);
  else playTone(440, 0.15, 'square', 0.1);
}
function playStart() {
  [400, 600, 800].forEach((f, i) => setTimeout(() => playTone(f, 0.15, 'square', 0.1), i * 100));
}
function playDrum(i) { playTone(180 + (i % 3) * 30, 0.07, 'square', 0.06); }

// ========== 80'sレトロ待受: 放射線バースト生成 ==========
function buildBursts() {
  document.querySelectorAll('[data-burst]').forEach(el => {
    if (el.dataset.built) return;
    el.dataset.built = '1';
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    svg.style.width = '100%';
    svg.style.height = '100%';
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const r1 = 110 + Math.random() * 130;
      const r2 = r1 + 120 + Math.random() * 260;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', (500 + Math.cos(a) * r1).toFixed(1));
      l.setAttribute('y1', (500 + Math.sin(a) * r1).toFixed(1));
      l.setAttribute('x2', (500 + Math.cos(a) * r2).toFixed(1));
      l.setAttribute('y2', (500 + Math.sin(a) * r2).toFixed(1));
      l.setAttribute('stroke', 'rgba(255,110,175,0.6)');
      l.setAttribute('stroke-width', (1.5 + Math.random() * 2).toFixed(1));
      l.setAttribute('stroke-linecap', 'round');
      svg.appendChild(l);
    }
    el.appendChild(svg);
  });
}

// ========== エントリー ==========
window.joinQuiz = async function() {
  if (!sbReady) return;
  const input = document.getElementById('name-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (name.length > 20) { alert('20文字以内で入力してください'); return; }
  myName = name;
  localStorage.setItem('ltcb_player_name', myName);
  document.getElementById('btn-join').disabled = true;

  getAudioCtx();
  playStart();

  const { data: existing } = await sb.from('players').select('score').eq('id', myId).maybeSingle();
  const score = existing ? existing.score : 0;
  const { error } = await sb.from('players').upsert({
    id: myId,
    name: myName,
    score: score,
    joined_at: new Date().toISOString()
  });
  if (error) {
    console.error(error);
    alert('参加に失敗しました: ' + error.message);
    document.getElementById('btn-join').disabled = false;
    return;
  }

  document.getElementById('waiting-name').textContent = '✨ ' + myName + ' さん';
  document.getElementById('player-name').textContent = '✨ ' + myName;
  showScreen('waiting');
  startWatchQuiz();
}

// ========== スクリーン切替 ==========
function showScreen(name) {
  ['entry', 'waiting', 'question', 'result', 'ranking'].forEach(n => {
    document.getElementById('screen-' + n).classList.toggle('hidden', n !== name);
  });
  document.body.classList.toggle('in-question', name === 'question');
}

function removeFinale() {
  const f = document.getElementById('finale-overlay');
  if (f) f.remove();
  finaleRunning = false;
}

// ========== クイズ監視 ==========
async function fetchQuiz() {
  const { data, error } = await sb.from('quiz_state').select('*').eq('id', QUIZ_ROW_ID).maybeSingle();
  if (error) console.error(error);
  return data;
}

async function startWatchQuiz() {
  const initial = await fetchQuiz();
  if (initial) {
    currentQuiz = initial;
    handleStateChange(initial);
  }

  sb.channel('player-watch-' + Math.random().toString(36).slice(2, 8))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state', filter: `id=eq.${QUIZ_ROW_ID}` }, (payload) => {
      const q = payload.new;
      if (!q) return;
      currentQuiz = q;
      handleStateChange(q);
    })
    .subscribe();
}

function handleStateChange(q) {
  const state = q.state;
  const idx = q.current_idx;
  const stateKey = state + ':' + idx;

  if (state !== 'finished') removeFinale();

  if (state === 'waiting') {
    showScreen('waiting');
  } else if (state === 'question') {
    if (lastState !== stateKey) {
      mySelected = -1;
      showQuestion(q);
    } else {
      if (!timerInterval) startTimer(q);
    }
  } else if (state === 'answer') {
    if (lastState !== stateKey) {
      revealAnswer(q);
    } else {
      showScreen('question');
    }
  } else if (state === 'ranking') {
    if (lastState !== stateKey) {
      showRankingScreen();
    }
  } else if (state === 'finished') {
    if (lastState !== stateKey) showResult();
  }
  lastState = stateKey;
}

// ========== 問題表示 ==========
function showQuestion(q) {
  const idx = q.current_idx;
  const question = q.questions[idx];
  if (!question) return;

  document.getElementById('q-counter').textContent = `Q${idx + 1}/${q.questions.length}`;
  document.getElementById('q-text').textContent = question.text || '';

  const img = document.getElementById('q-image');
  if (question.image) {
    img.src = question.image;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }

  const choicesEl = document.getElementById('choices');
  const labels = ['A', 'B', 'C', 'D'];
  choicesEl.innerHTML = question.choices.map((c, i) => `
    <button class="choice" data-i="${i}" onclick="selectAnswer(${i})">
      <div class="badge">${labels[i]}</div>
      ${c.image ? `<img src="${c.image}" alt="">` : ''}
      ${c.text ? `<div>${escapeHtml(c.text)}</div>` : ''}
    </button>
  `).join('');

  document.getElementById('answered-status').classList.add('hidden');

  // 最終問題はダブルスコアを強調表示
  const oldBanner = document.getElementById('double-banner');
  if (oldBanner) oldBanner.remove();
  if (idx === q.questions.length - 1) {
    const b = document.createElement('div');
    b.id = 'double-banner';
    b.className = 'double-banner';
    b.textContent = '🔥 最終問題!ダブルスコアチャンス!!';
    const qs = document.getElementById('screen-question');
    qs.insertBefore(b, qs.firstChild);
  }

  showScreen('question');

  const effStart = effectiveStart(q);
  if (Date.now() < effStart) {
    choicesEl.classList.add('locked');
    showCountdown(effStart, () => {
      choicesEl.classList.remove('locked');
      startTimer(q);
    });
  } else {
    choicesEl.classList.remove('locked');
    startTimer(q);
  }
}

function showCountdown(effStart, onDone) {
  clearInterval(countdownInterval);
  const existing = document.getElementById('countdown-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'countdown-overlay';
  document.body.appendChild(overlay);

  let lastShown = -1;
  function tick() {
    const remaining = effStart - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      overlay.remove();
      playCountBeep(true);
      onDone();
      return;
    }
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastShown) {
      lastShown = sec;
      overlay.innerHTML = `<div class="countdown-num">${sec}</div>`;
      playCountBeep(false);
    }
  }
  tick();
  countdownInterval = setInterval(tick, 100);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ========== タイマー ==========
function startTimer(q) {
  clearInterval(timerInterval);
  const limit = (q.time_limit || 15) * 1000;
  const startedAt = effectiveStart(q);
  const fillEl = document.getElementById('timer-fill');
  const textEl = document.getElementById('timer-text');
  fillEl.classList.remove('warn');
  let lastUrge = 0;

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, limit - elapsed);
    const frac = remaining / limit;
    fillEl.style.width = Math.min(100, frac * 100) + '%';
    const sec = Math.ceil(remaining / 1000);
    textEl.textContent = sec + '秒';
    // だんだん速く・高くなる「焦らせ」チクタク音 (回答時間中ずっと)
    if (remaining > 0 && elapsed >= 0) {
      const gap = Math.max(150, 850 * frac + 130); // 間隔がどんどん短く
      const now = Date.now();
      if (now - lastUrge >= gap) {
        lastUrge = now;
        const freq = 500 + (1 - frac) * 480;       // 音程がどんどん高く
        playTone(freq, 0.05, 'square', frac < 0.3 ? 0.09 : 0.05);
      }
    }
    if (sec <= 5) fillEl.classList.add('warn');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (!PREVIEW && mySelected < 0) {
        submitAnswer(-1);
      }
    }
  }, 100);
}

// ========== 回答 ==========
window.selectAnswer = function(i) {
  if (PREVIEW) return;
  if (mySelected >= 0) return;
  if (!currentQuiz || currentQuiz.state !== 'question') return;
  mySelected = i;
  playSelect();

  document.querySelectorAll('.choice').forEach((el, idx) => {
    if (idx === i) el.classList.add('selected');
    el.disabled = true;
  });

  submitAnswer(i);
}

async function submitAnswer(i) {
  const idx = currentQuiz.current_idx;
  const startedAt = effectiveStart(currentQuiz);
  const limit = (currentQuiz.time_limit || 15) * 1000;
  const elapsedMs = (i < 0) ? limit : Math.max(0, Date.now() - startedAt);

  if (TEST) {
    testChoice = i;
    testElapsed = elapsedMs;
    setTimeout(() => {
      document.getElementById('answered-status').classList.remove('hidden');
    }, 800);
    return;
  }

  const { error } = await sb.from('answers').upsert({
    q_idx: idx,
    player_id: myId,
    choice: i,
    elapsed_ms: elapsedMs,
    name: myName
  }, { onConflict: 'q_idx,player_id' });

  if (error) console.error(error);

  setTimeout(() => {
    document.getElementById('answered-status').classList.remove('hidden');
  }, 800);
}

// ========== 解答発表 ==========
async function revealAnswer(q) {
  clearInterval(timerInterval); timerInterval = null;
  clearInterval(countdownInterval); countdownInterval = null;
  const cdOverlay = document.getElementById('countdown-overlay');
  if (cdOverlay) cdOverlay.remove();

  const idx = q.current_idx;
  const question = q.questions[idx];
  if (!question) return;
  const correct = question.correct;
  const isLast = idx === q.questions.length - 1;

  showScreen('question');
  const choicesEl = document.getElementById('choices');
  choicesEl.classList.remove('locked');
  document.querySelectorAll('.choice').forEach((el, idx2) => {
    el.disabled = true;
    el.classList.remove('correct-reveal', 'wrong-reveal');
    if (idx2 === correct) el.classList.add('correct-reveal');
    else el.classList.add('wrong-reveal');
  });

  if (PREVIEW) return;

  if (revealedRounds.has(idx)) return;
  revealedRounds.add(idx);

  const { data: answers, error } = await sb.from('answers').select('*').eq('q_idx', idx);
  if (error) console.error(error);
  const ans = answers || [];
  const allCorrect = ans.filter(a => a.choice === correct);
  const myAns = ans.find(a => a.player_id === myId);
  const myCorrect = myAns && myAns.choice === correct;

  let myPointsThisRound = 0;
  if (myCorrect) {
    const limit = (q.time_limit || 15) * 1000;
    const speedBonus = Math.max(0, Math.round(100 * (1 - (myAns.elapsed_ms / limit))));
    const correctCount = allCorrect.length;
    const rarityBonus = Math.round(150 / Math.max(correctCount, 1));
    myPointsThisRound = 100 + speedBonus + rarityBonus;
    if (isLast) myPointsThisRound *= 2; // 最終問題はダブルスコア
  }

  showRevealOverlay(myCorrect, myPointsThisRound, isLast && myCorrect);

  if (myCorrect && myPointsThisRound > 0) {
    const { data: currentPlayer } = await sb.from('players').select('score').eq('id', myId).maybeSingle();
    const newScore = (currentPlayer ? currentPlayer.score : 0) + myPointsThisRound;
    await sb.from('players').update({ score: newScore }).eq('id', myId);
  }
}

function showRevealOverlay(correct, points, isDouble) {
  const existing = document.getElementById('reveal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'reveal-overlay';
  overlay.classList.add('flash-bg');
  overlay.innerHTML = `
    <div class="reveal-content">
      <div class="reveal-emoji">${correct ? '🎉' : '😢'}</div>
      <div class="reveal-text ${correct ? 'reveal-correct' : 'reveal-wrong'}">
        ${correct ? 'せいかい!' : 'ざんねん'}
      </div>
      ${correct ? `<div class="reveal-points">+${points} pts</div>` : ''}
      ${isDouble ? '<div class="double-badge">🔥 ダブルスコア獲得!!</div>' : ''}
    </div>
  `;
  document.body.appendChild(overlay);

  if (correct) {
    playFanfareCorrect();
    fireConfetti();
  } else {
    playWrong();
  }

  setTimeout(() => {
    overlay.style.transition = 'opacity 0.4s';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);
  }, 2200);
}

// ========== 途中ランキング表示 (TOP20を下位から発表) ==========
async function showRankingScreen() {
  clearInterval(timerInterval); timerInterval = null;

  let arr;
  if (TEST) {
    arr = dummyPlayers(22);
  } else {
    const { data, error } = await sb.from('players').select('*').order('score', { ascending: false }).limit(20);
    if (error) console.error(error);
    arr = data || [];
  }
  arr = arr.slice(0, 20);

  const el = document.getElementById('ranking-live-list');
  const n = arr.length;
  if (n === 0) {
    el.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">まだ参加者がいません</div>';
  } else {
    el.innerHTML = arr.map((p, i) => {
      const isMe = !PREVIEW && !TEST && p.id === myId;
      const isTop5 = i < 5;
      const crown = ['👑','🥈','🥉','🏅','🏅'][i] || '';
      const delay = (n - 1 - i) * 0.22;
      return `<div class="rank-row ${isMe ? 'me' : ''} ${isTop5 ? 'top5' : ''}" style="animation-delay: ${delay}s">
        <div class="rank-pos">${crown || (i + 1)}</div>
        <div class="rank-name">${escapeHtml(p.name)}${isMe ? ' (あなた)' : ''}</div>
        <div class="rank-score">${p.score || 0}</div>
      </div>`;
    }).join('');
  }

  showScreen('ranking');
  playStart();
}

// ========== 紙吹雪 ==========
function fireConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#ff2d1f', '#d6285c', '#ffd54a', '#ff7eb3', '#42a5f5', '#66bb6a'];
  const particles = [];
  for (let i = 0; i < 90; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 8 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    });
  }
  let frame = 0;
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    frame++;
    if (frame < 200) requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  loop();
}

// ========== 最終成績発表 (段階演出) ==========
const wait = ms => new Promise(r => setTimeout(r, ms));

async function runFinale(arr) {
  if (finaleRunning) return;
  finaleRunning = true;

  const ov = document.createElement('div');
  ov.id = 'finale-overlay';
  ov.innerHTML = '<div class="finale-stage" id="finale-stage"></div>';
  document.body.appendChild(ov);
  const stage = ov.querySelector('#finale-stage');
  const n = arr.length;

  if (n === 0) {
    ov.remove();
    finaleRunning = false;
    renderResultScreen(arr);
    return;
  }

  // === 第1幕: タイトル + ファンファーレ ===
  stage.innerHTML = '<div class="finale-title">🎺 最終成績発表!</div>';
  playGrandFanfare();
  fireConfetti();
  await wait(3200);
  if (!finaleRunning) return;

  // === 第2幕: 20位〜4位を下から順に ===
  const startIdx = Math.min(19, n - 1);
  if (startIdx >= 3) {
    stage.innerHTML = '<div class="finale-sub">🏆 TOP 20</div><div class="finale-list" id="finale-list"></div>';
    const listWrap = stage.querySelector('#finale-list');
    for (let i = startIdx; i >= 3; i--) {
      if (!finaleRunning) return;
      const p = arr[i];
      if (!p) continue;
      const row = document.createElement('div');
      row.className = 'finale-row';
      row.innerHTML = `<span class="fr-pos">${i + 1}位</span><span class="fr-name">${escapeHtml(p.name)}</span><span class="fr-score">${p.score}</span>`;
      listWrap.prepend(row);
      playDrum(i);
      await wait(750);
    }
    await wait(800);
  }

  // === 第3幕: 3位 (5秒間を置く) ===
  if (arr[2] && finaleRunning) {
    bigReveal(stage, 3, arr[2], '🥉');
    await wait(5000);
  }
  // === 第4幕: 2位 (10秒間を置く) ===
  if (arr[1] && finaleRunning) {
    bigReveal(stage, 2, arr[1], '🥈');
    await wait(10000);
  }
  // === 第5幕: 1位 くす玉 + Congratulations ===
  if (arr[0] && finaleRunning) {
    champion(stage, arr[0]);
    await wait(9000);
  }

  if (!finaleRunning) return;
  ov.style.transition = 'opacity 0.8s';
  ov.style.opacity = '0';
  await wait(800);
  ov.remove();
  finaleRunning = false;
  renderResultScreen(arr);
}

function bigReveal(stage, rank, p, medal) {
  stage.innerHTML = `
    <div class="finale-bigcard blink">
      <div class="fb-medal">${medal}</div>
      <div class="fb-rank">第${rank}位</div>
      <div class="fb-name">${escapeHtml(p.name)}</div>
      <div class="fb-score">${p.score} pts</div>
    </div>`;
  playFanfareCorrect();
  fireConfetti();
}

function champion(stage, p) {
  stage.innerHTML = `
    <div class="kusudama">
      <div class="ku-half left"></div><div class="ku-half right"></div>
      <div class="ku-ribbons">${'<span class="ribbon"></span>'.repeat(10)}</div>
      <div class="ku-banner">🎊 Congratulations!! 🎊</div>
    </div>
    <div class="champ">
      <div class="champ-crown">👑</div>
      <div class="champ-rank">優 勝</div>
      <div class="champ-name">${escapeHtml(p.name)}</div>
      <div class="champ-score">${p.score} pts</div>
    </div>`;
  playGrandFanfare();
  setTimeout(playFanfareCorrect, 1600);
  fireConfetti();
  setTimeout(fireConfetti, 900);
  setTimeout(fireConfetti, 2000);
  setTimeout(fireConfetti, 3400);
}

// ========== 結果画面 ==========
function renderResultScreen(arr) {
  const podium = document.getElementById('podium');
  podium.innerHTML = '';
  const top3Order = [1, 0, 2];
  top3Order.forEach(idx => {
    if (!arr[idx]) return;
    const p = arr[idx];
    const cls = idx === 0 ? 'p1' : idx === 1 ? 'p2' : 'p3';
    const crown = idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉';
    const div = document.createElement('div');
    div.className = 'podium-item ' + cls;
    div.innerHTML = `
      <div class="podium-crown">${crown}</div>
      <div class="podium-name">${escapeHtml(p.name)}</div>
      <div class="podium-score">${p.score}</div>
    `;
    podium.appendChild(div);
  });

  const rankFull = document.getElementById('ranking-full');
  rankFull.innerHTML = arr.map((p, i) => {
    const isMe = !PREVIEW && p.id === myId;
    const isTop5 = i < 5;
    const crown = ['👑','🥈','🥉','🏅','🏅'][i] || '';
    return `<div class="rank-row ${isMe ? 'me' : ''} ${isTop5 ? 'top5' : ''}" style="animation-delay: ${i * 0.06}s">
      <div class="rank-pos">${crown || (i + 1)}</div>
      <div class="rank-name">${escapeHtml(p.name)}${isMe ? ' (あなた)' : ''}</div>
      <div class="rank-score">${p.score}</div>
    </div>`;
  }).join('');

  showScreen('result');
}

async function showResult() {
  clearInterval(timerInterval); timerInterval = null;

  const { data, error } = await sb.from('players').select('*').order('score', { ascending: false });
  if (error) console.error(error);
  const arr = (data || []).map(p => ({ id: p.id, name: p.name, score: p.score || 0 }));

  runFinale(arr);
}

// ========== テストモード ==========
const DUMMY_NAMES = ['さとう','すずき','たかはし','たなか','わたなべ','いとう','やまもと','なかむら','こばやし','かとう','よしだ','やまだ','ささき','やまぐち','まつもと','いのうえ','きむら','はやし','しみず','さいとう','もり','あべ'];

function dummyPlayers(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: 'dummy_' + i, name: DUMMY_NAMES[i % DUMMY_NAMES.length], score: Math.round(Math.random() * 800 + 100) });
  }
  arr.sort((a, b) => b.score - a.score);
  return arr;
}

function loadTestQuiz() {
  let qs = [];
  try { qs = JSON.parse(localStorage.getItem('ltcb_quiz_questions') || '[]'); } catch (e) {}
  if (!Array.isArray(qs) || qs.length === 0) {
    qs = [
      {
        text: 'テスト問題1: LTCBのコーポレートカラーに最も近い色は?',
        image: null,
        choices: [{text:'赤'},{text:'青'},{text:'緑'},{text:'黄'}],
        correct: 0
      },
      {
        text: 'テスト問題2: このクイズアプリで正解すると鳴る音は?',
        image: null,
        choices: [{text:'ファンファーレ'},{text:'ブザー'},{text:'ドラムロール'},{text:'無音'}],
        correct: 0
      }
    ];
  }
  let tl = 15;
  try {
    const s = JSON.parse(localStorage.getItem('ltcb_quiz_settings') || '{}');
    if (s.timeLimit) tl = s.timeLimit;
  } catch (e) {}
  return { state: 'waiting', current_idx: -1, questions: qs, time_limit: tl, question_started_at: 0 };
}

function setupTestMode() {
  document.body.classList.add('preview');
  const badge = document.querySelector('.preview-badge');
  if (badge) badge.textContent = '🧪 テスト';

  currentQuiz = loadTestQuiz();
  myName = 'テスト';
  document.getElementById('screen-entry').classList.add('hidden');
  document.getElementById('waiting-name').textContent = '🧪 テストモード(本番には影響しません)';
  document.getElementById('player-name').textContent = '🧪 テスト';
  showScreen('waiting');

  const bar = document.createElement('div');
  bar.id = 'test-bar';
  bar.innerHTML = `
    <button id="test-next" onclick="testNext()">▶ 第1問</button>
    <button class="ghost" onclick="testRanking()">🏆</button>
    <button class="ghost" onclick="testReset()">↺</button>
  `;
  document.body.appendChild(bar);
}

window.testNext = function() {
  getAudioCtx();
  const q = currentQuiz;
  if (q.state === 'waiting') {
    q.state = 'question'; q.current_idx = 0; q.question_started_at = Date.now();
  } else if (q.state === 'question') {
    q.state = 'answer';
  } else if (q.state === 'answer') {
    if (q.current_idx + 1 >= q.questions.length) {
      q.state = 'finished';
    } else {
      q.state = 'question'; q.current_idx++; q.question_started_at = Date.now();
    }
  } else if (q.state === 'finished') {
    testReset();
    return;
  } else if (q.state === 'ranking') {
    q.state = (q.current_idx >= 0) ? 'answer' : 'waiting';
    handleTestState();
    return;
  }
  handleTestState();
}

function handleTestState() {
  const q = currentQuiz;
  const btn = document.getElementById('test-next');
  if (q.state === 'waiting') {
    showScreen('waiting');
    btn.textContent = '▶ 第1問';
  } else if (q.state === 'question') {
    mySelected = -1;
    testChoice = -1;
    testElapsed = 0;
    showQuestion(q);
    btn.textContent = '✨ 解答';
  } else if (q.state === 'answer') {
    revealAnswerTest(q);
    btn.textContent = (q.current_idx + 1 >= q.questions.length) ? '🏁 結果発表' : '▶ 次へ';
  } else if (q.state === 'finished') {
    runFinale(dummyPlayersWithMe());
    btn.textContent = '↺ 最初から';
  }
}

function dummyPlayersWithMe() {
  const arr = dummyPlayers(21);
  arr.splice(2, 0, { id: myId, name: 'あなた(テスト)', score: arr[2].score + 1 });
  arr.sort((a, b) => b.score - a.score);
  return arr;
}

function revealAnswerTest(q) {
  clearInterval(timerInterval); timerInterval = null;
  clearInterval(countdownInterval); countdownInterval = null;
  const cdOverlay = document.getElementById('countdown-overlay');
  if (cdOverlay) cdOverlay.remove();

  const question = q.questions[q.current_idx];
  const correct = question.correct;
  const isLast = q.current_idx === q.questions.length - 1;

  showScreen('question');
  const choicesEl = document.getElementById('choices');
  choicesEl.classList.remove('locked');
  document.querySelectorAll('.choice').forEach((el, idx2) => {
    el.disabled = true;
    el.classList.remove('correct-reveal', 'wrong-reveal');
    if (idx2 === correct) el.classList.add('correct-reveal');
    else el.classList.add('wrong-reveal');
  });

  const myCorrect = testChoice === correct;
  let points = 0;
  if (myCorrect) {
    const limit = (q.time_limit || 15) * 1000;
    const speedBonus = Math.max(0, Math.round(100 * (1 - (testElapsed / limit))));
    const rarityBonus = Math.round(150 / 3);
    points = 100 + speedBonus + rarityBonus;
    if (isLast) points *= 2;
  }
  showRevealOverlay(myCorrect, points, isLast && myCorrect);
}

window.testRanking = function() {
  getAudioCtx();
  currentQuiz.state = 'ranking';
  showRankingScreen();
  const btn = document.getElementById('test-next');
  btn.textContent = '↩ 戻る';
}

window.testReset = function() {
  clearInterval(timerInterval); timerInterval = null;
  clearInterval(countdownInterval); countdownInterval = null;
  const cdOverlay = document.getElementById('countdown-overlay');
  if (cdOverlay) cdOverlay.remove();
  removeFinale();
  revealedRounds.clear();
  currentQuiz = loadTestQuiz();
  mySelected = -1;
  lastState = null;
  showScreen('waiting');
  const btn = document.getElementById('test-next');
  if (btn) btn.textContent = '▶ 第1問';
}

// ========== 起動 ==========
document.addEventListener('DOMContentLoaded', () => {
  buildBursts();

  if (TEST) {
    document.getElementById('config-warn').classList.add('hidden');
    setupTestMode();
    return;
  }

  if (!initSupabase()) return;

  if (PREVIEW) {
    document.body.classList.add('preview');
    document.getElementById('screen-entry').classList.add('hidden');
    showScreen('waiting');
    document.getElementById('waiting-name').textContent = '👁 プレビュー中';
    startWatchQuiz();
    return;
  }

  const savedName = localStorage.getItem('ltcb_player_name');
  if (savedName) {
    document.getElementById('name-input').value = savedName;
  }

  document.getElementById('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinQuiz();
  });

  document.getElementById('name-input').addEventListener('input', (e) => {
    localStorage.setItem('ltcb_player_name', e.target.value);
  });
});
