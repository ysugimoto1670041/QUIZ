// ========== モード判定 ==========
// ?preview=1 が付いていると「プレビューモード」:
// 名前入力をスキップし、DBには一切書き込まず、クイズの流れだけを観戦する。
// 管理者画面のスマホプレビューで使用。
const PREVIEW = new URLSearchParams(location.search).has('preview');

// カウントダウン演出の長さ(全員共通のオフセットとして扱うため定数)
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
let currentIdx = -1;
let lastState = null;
let timerInterval = null;
let countdownInterval = null;
let mySelected = -1;

// 実効的な回答開始時刻 (カウントダウン分を全クライアント共通で加算)
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
  ['entry', 'waiting', 'question', 'result'].forEach(n => {
    document.getElementById('screen-' + n).classList.toggle('hidden', n !== name);
  });
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

  if (state === 'waiting') {
    showScreen('waiting');
  } else if (state === 'question') {
    if (lastState !== stateKey) {
      currentIdx = idx;
      mySelected = -1;
      showQuestion(q);
    } else {
      if (!timerInterval) startTimer(q);
    }
  } else if (state === 'answer') {
    if (lastState !== stateKey) {
      revealAnswer(q);
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
  showScreen('question');

  // カウントダウン演出 (開始時刻より前ならカウントダウンを表示)
  const effStart = effectiveStart(q);
  if (Date.now() < effStart) {
    choicesEl.classList.add('locked');
    showCountdown(effStart, () => {
      choicesEl.classList.remove('locked');
      startTimer(q);
    });
  } else {
    // 遅れて合流した場合はカウントダウンなしで即開始
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
  const limit = (q.time_limit || 20) * 1000;
  const startedAt = effectiveStart(q);
  const fillEl = document.getElementById('timer-fill');
  const textEl = document.getElementById('timer-text');
  fillEl.classList.remove('warn');
  let lastTickSec = -1;

  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, limit - elapsed);
    const pct = Math.min(100, (remaining / limit) * 100);
    fillEl.style.width = pct + '%';
    const sec = Math.ceil(remaining / 1000);
    textEl.textContent = sec + '秒';
    if (sec <= 5 && sec > 0 && sec !== lastTickSec) {
      lastTickSec = sec;
      playTick();
      fillEl.classList.add('warn');
    }
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
  if (PREVIEW) return; // プレビューでは回答不可
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
  const limit = (currentQuiz.time_limit || 20) * 1000;
  const elapsedMs = (i < 0) ? limit : Math.max(0, Date.now() - startedAt);

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

  // 正解の選択肢をハイライト
  const choicesEl = document.getElementById('choices');
  choicesEl.classList.remove('locked');
  document.querySelectorAll('.choice').forEach((el, idx2) => {
    el.disabled = true;
    if (idx2 === correct) el.classList.add('correct-reveal');
    else el.classList.add('wrong-reveal');
  });

  if (PREVIEW) return; // プレビューは正解表示のみで終了

  // 回答を取得して得点計算
  const { data: answers, error } = await sb.from('answers').select('*').eq('q_idx', idx);
  if (error) console.error(error);
  const ans = answers || [];
  const allCorrect = ans.filter(a => a.choice === correct);
  const myAns = ans.find(a => a.player_id === myId);
  const myCorrect = myAns && myAns.choice === correct;

  let myPointsThisRound = 0;
  if (myCorrect) {
    const limit = (q.time_limit || 20) * 1000;
    const speedBonus = Math.max(0, Math.round(100 * (1 - (myAns.elapsed_ms / limit))));
    const correctCount = allCorrect.length;
    const rarityBonus = Math.round(150 / Math.max(correctCount, 1));
    myPointsThisRound = 100 + speedBonus + rarityBonus;
  }

  showRevealOverlay(myCorrect, myPointsThisRound);

  if (myCorrect && myPointsThisRound > 0) {
    const { data: currentPlayer } = await sb.from('players').select('score').eq('id', myId).maybeSingle();
    const newScore = (currentPlayer ? currentPlayer.score : 0) + myPointsThisRound;
    await sb.from('players').update({ score: newScore }).eq('id', myId);
  }
}

function showRevealOverlay(correct, points) {
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

// ========== 結果画面 ==========
async function showResult() {
  clearInterval(timerInterval); timerInterval = null;
  showScreen('result');

  const { data, error } = await sb.from('players').select('*').order('score', { ascending: false });
  if (error) console.error(error);
  const arr = (data || []).map(p => ({ id: p.id, name: p.name, score: p.score || 0 }));

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

  if (!PREVIEW) {
    const myRank = arr.findIndex(p => p.id === myId);
    if (myRank >= 0 && myRank < 5) {
      setTimeout(fireConfetti, 500);
      setTimeout(playFanfareCorrect, 800);
    }
  }
}

// ========== 起動 ==========
document.addEventListener('DOMContentLoaded', () => {
  if (!initSupabase()) return;

  if (PREVIEW) {
    // プレビューモード: 名前入力をスキップして観戦開始
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
