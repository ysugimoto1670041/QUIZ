// 同期会クイズ v2.2 (2026-07-14) - projector.js
console.log('同期会クイズ v2.2 (2026-07-14) - projector.js loaded');
// ========== プロジェクター表示ロジック ==========
const QUIZ_ROW_ID = 1;
const COUNTDOWN_MS = 3000;
// ?embed=1 : 管理画面内のプレビュー用 (無音・自動接続・全画面化なし)
const EMBED = new URLSearchParams(location.search).has('embed');
// ?test=1 : テストモード (DB進行と切り離してローカル再生。実機プロジェクターの映りを検証できる)
const TESTP = new URLSearchParams(location.search).has('test');
let tVotes = [0, 0, 0, 0];

let sb = null;
let quiz = null;
let lastKey = null;
let timerInt = null;
let countInt = null;
let finaleRunning = false;

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
  if (EMBED && !TESTP) return; // 埋め込みライブプレビューは無音 (テストは音の確認も可能)
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
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
function playFanfare() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.3, 'triangle', 0.15), i * 100));
  setTimeout(() => [1047, 1319, 1568].forEach(f => playTone(f, 0.5, 'triangle', 0.12)), 500);
}
function playGrandFanfare() {
  const seq = [[392,0.18],[392,0.18],[392,0.18],[523,0.5],[659,0.18],[659,0.18],[784,0.6]];
  let t = 0;
  seq.forEach(([f, d]) => { setTimeout(() => playTone(f, d + 0.1, 'triangle', 0.16), t * 1000); t += d; });
  setTimeout(() => [523, 659, 784, 1047].forEach(f => playTone(f, 0.9, 'triangle', 0.1)), (t + 0.15) * 1000);
}
function playTick() { playTone(800, 0.05, 'square', 0.05); }
function playCountBeep(final) { playTone(final ? 880 : 440, final ? 0.4 : 0.15, 'square', final ? 0.14 : 0.1); }
function playDrum(i) { playTone(180 + (i % 3) * 30, 0.07, 'square', 0.06); }

function playUrgeTick(frac) {
  const base = 400 + (1 - frac) * 520;
  playTone(base, 0.06, 'square', 0.06 + (1 - frac) * 0.08);
  if (frac < 0.4) {
    setTimeout(() => playTone(base * 1.5, 0.05, 'square', 0.1), 75);
  }
}

// ========== 投票数ライブ表示 (残り10秒〜) ==========
let pVotesShown = false;
let pLastVoteFetch = 0;

function showVoteBadgesP() {
  document.querySelectorAll('#p-choices .p-choice').forEach((el, i) => {
    if (!el.querySelector('.p-vote')) {
      const b = document.createElement('div');
      b.className = 'p-vote';
      b.dataset.vc = i;
      b.textContent = '0票';
      el.appendChild(b);
    }
  });
}

async function refreshVoteCountsP() {
  if (!quiz || quiz.current_idx < 0) return;
  let counts = [0, 0, 0, 0];
  if (TESTP) {
    tVotes[Math.floor(Math.random() * 4)]++;
    counts = tVotes.slice();
    document.getElementById('pq-answered').textContent = tVotes.reduce((a, b) => a + b, 0);
  } else {
    const { data } = await sb.from('answers').select('choice').eq('q_idx', quiz.current_idx);
    (data || []).forEach(a => { if (a.choice >= 0 && a.choice < 4) counts[a.choice]++; });
  }
  document.querySelectorAll('#p-choices .p-vote').forEach(el => {
    const i = parseInt(el.dataset.vc);
    const t = (counts[i] || 0) + '票';
    if (el.textContent !== t) {
      el.textContent = t;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  });
}
function playStart() { [400, 600, 800].forEach((f, i) => setTimeout(() => playTone(f, 0.15, 'square', 0.1), i * 100)); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ========== 放射線バースト ==========
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

// ========== 画面切替 ==========
function showP(name) {
  ['waiting', 'question', 'ranking', 'result'].forEach(n => {
    document.getElementById('p-' + n).classList.toggle('hidden', n !== name);
  });
}

function removeFinale() {
  const f = document.getElementById('finale-overlay');
  if (f) f.remove();
  finaleRunning = false;
}

// ========== 接続 ==========
async function connect() {
  if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('YOUR_')) {
    alert('Supabaseの設定が完了していません (supabase-config.js)');
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data } = await sb.from('quiz_state').select('*').eq('id', QUIZ_ROW_ID).maybeSingle();
  if (data) { quiz = data; handleState(data); }
  refreshCount();

  sb.channel('projector-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state', filter: `id=eq.${QUIZ_ROW_ID}` }, (payload) => {
      if (!payload.new) return;
      quiz = payload.new;
      handleState(quiz);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => refreshCount())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => refreshAnswered())
    .subscribe();

  // リアルタイム通知が届かない環境向けの保険 (2.5秒ごとに状態を再取得)
  setInterval(async () => {
    const { data } = await sb.from('quiz_state').select('*').eq('id', QUIZ_ROW_ID).maybeSingle();
    if (data) { quiz = data; handleState(data); }
    refreshCount();
  }, 2500);
}

async function refreshCount() {
  if (!sb) return;
  const { data } = await sb.from('players').select('id');
  document.getElementById('p-count').textContent = (data || []).length;
}

async function refreshAnswered() {
  if (!sb || !quiz || quiz.current_idx < 0) return;
  const { data } = await sb.from('answers').select('id').eq('q_idx', quiz.current_idx);
  document.getElementById('pq-answered').textContent = (data || []).length;
}

// ========== 状態ハンドリング ==========
function handleState(q) {
  const key = q.state + ':' + q.current_idx;
  if (q.state !== 'finished') removeFinale();

  if (q.state === 'waiting') {
    toggleReadyP(false);
    showP('waiting');
  } else if (q.state === 'ready') {
    if (lastKey !== key) playStart();
    toggleReadyP(true);
    showP('waiting');
  } else if (q.state === 'question') {
    if (lastKey !== key) showQuestionP(q);
  } else if (q.state === 'answer') {
    if (lastKey !== key) revealP(q);
  } else if (q.state === 'ranking') {
    if (lastKey !== key) showRankingP();
  } else if (q.state === 'finished') {
    if (lastKey !== key) showFinishedP();
  }
  lastKey = key;
}

function toggleReadyP(on) {
  const rg = document.getElementById('p-ready');
  const jr = document.getElementById('join-row');
  if (rg) rg.classList.toggle('hidden', !on);
  if (jr) jr.classList.toggle('hidden', on);
}

function effectiveStart(q) {
  return (q.question_started_at || 0) + COUNTDOWN_MS;
}

// ========== 出題表示 ==========
function showQuestionP(q) {
  const idx = q.current_idx;
  const question = q.questions[idx];
  if (!question) return;

  pVotesShown = false;
  pLastVoteFetch = 0;
  document.getElementById('pq-num').textContent = `第${idx + 1}問 / 全${q.questions.length}問`;
  document.getElementById('pq-text').textContent = question.text || '';
  document.getElementById('pq-answered').textContent = '0';

  const img = document.getElementById('pq-image');
  if (question.image) {
    img.src = question.image;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }

  const oldR2 = document.getElementById('p-rate');
  if (oldR2) oldR2.remove();
  // 最終問題はダブルスコアを強調
  const oldD = document.getElementById('p-double');
  if (oldD) oldD.remove();
  if (idx === q.questions.length - 1) {
    const d = document.createElement('div');
    d.id = 'p-double';
    d.className = 'p-double';
    d.textContent = '🔥 最終問題!ダブルスコアチャンス!!';
    const pq = document.getElementById('p-question');
    pq.insertBefore(d, pq.querySelector('.pq-card'));
  }

  const labels = ['A', 'B', 'C', 'D'];
  document.getElementById('p-choices').innerHTML = question.choices.map((c, i) => `
    <div class="p-choice">
      <div class="pbadge">${labels[i]}</div>
      ${c.image ? `<img src="${c.image}" alt="">` : ''}
      ${c.text ? `<span>${escapeHtml(c.text)}</span>` : ''}
    </div>
  `).join('');

  showP('question');

  const effStart = effectiveStart(q);
  if (Date.now() < effStart) {
    showCountdownP(effStart, () => startTimerP(q));
  } else {
    startTimerP(q);
  }
}

function showCountdownP(effStart, onDone) {
  clearInterval(countInt);
  const existing = document.getElementById('p-countdown');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'p-countdown';
  document.body.appendChild(overlay);

  let lastShown = -1;
  function tick() {
    const remaining = effStart - Date.now();
    if (remaining <= 0) {
      clearInterval(countInt);
      countInt = null;
      overlay.remove();
      playCountBeep(true);
      onDone();
      return;
    }
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastShown) {
      lastShown = sec;
      overlay.innerHTML = `<div class="p-count-num">${sec}</div>`;
      playCountBeep(false);
    }
  }
  tick();
  countInt = setInterval(tick, 100);
}

function startTimerP(q) {
  clearInterval(timerInt);
  const limit = (q.time_limit || 15) * 1000;
  const startedAt = effectiveStart(q);
  const fill = document.getElementById('p-timer-fill');
  fill.classList.remove('warn');
  let lastUrge = 0;

  timerInt = setInterval(() => {
    const remaining = Math.max(0, limit - (Date.now() - startedAt));
    const frac = remaining / limit;
    fill.style.width = Math.min(100, frac * 100) + '%';
    const sec = Math.ceil(remaining / 1000);
    // だんだん速く・強くなる「心臓ドキドキ」音
    if (remaining > 0) {
      const gap = Math.max(300, 1000 * frac + 200);
      const now = Date.now();
      if (now - lastUrge >= gap) {
        lastUrge = now;
        playUrgeTick(frac);
      }
    }
    // 残り10秒: 投票数を表示してライブ更新
    if (remaining > 0 && remaining <= 10000 && quiz && quiz.state === 'question') {
      if (!pVotesShown) {
        pVotesShown = true;
        showVoteBadgesP();
        refreshVoteCountsP();
      } else if (Date.now() - pLastVoteFetch > 1200) {
        pLastVoteFetch = Date.now();
        refreshVoteCountsP();
      }
    }
    if (sec <= 5) fill.classList.add('warn');
    if (remaining <= 0) { clearInterval(timerInt); timerInt = null; }
  }, 100);
}

// ========== 解答発表 ==========
async function revealP(q) {
  clearInterval(timerInt); timerInt = null;
  clearInterval(countInt); countInt = null;
  const cd = document.getElementById('p-countdown');
  if (cd) cd.remove();

  const question = q.questions[q.current_idx];
  if (!question) return;
  const correct = question.correct;

  showP('question');
  document.querySelectorAll('.p-choice').forEach((el, i) => {
    el.classList.remove('correct-reveal', 'wrong-reveal');
    if (i === correct) el.classList.add('correct-reveal');
    else el.classList.add('wrong-reveal');
  });

  // 正答率バナー (正解者数 ÷ 参加者数)
  let cc = 0, pCount = 0;
  if (TESTP) {
    cc = tVotes[correct] || 0;
    pCount = tVotes.reduce((a, b) => a + b, 0) + 2; // 未回答2人と仮定
  } else {
    const { data } = await sb.from('answers').select('choice').eq('q_idx', q.current_idx);
    cc = (data || []).filter(a => a.choice === correct).length;
    const { data: pl } = await sb.from('players').select('id');
    pCount = (pl || []).length;
  }
  const rate = pCount > 0 ? Math.round(cc / pCount * 100) : 0;
  const oldR = document.getElementById('p-rate');
  if (oldR) oldR.remove();
  if (pCount > 0) {
    const r = document.createElement('div');
    r.id = 'p-rate';
    r.className = 'p-double';
    r.style.background = 'linear-gradient(135deg, #42a5f5, #7e57c2)';
    r.style.animation = 'none';
    r.textContent = `📊 正答率 ${rate}% (${cc}/参加${pCount}人)`;
    const pq = document.getElementById('p-question');
    pq.insertBefore(r, pq.querySelector('.pq-card'));
  }
  playFanfare();
  fireConfetti();
}

// ========== 途中ランキング ==========
const DUMMY_NAMES_P = ['さとう','すずき','たかはし','たなか','わたなべ','いとう','やまもと','なかむら','こばやし','かとう','よしだ','やまだ','ささき','やまぐち','まつもと','いのうえ','きむら','はやし','しみず','さいとう','もり','あべ'];
function dummyPlayersP(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: 'd' + i, name: DUMMY_NAMES_P[i % DUMMY_NAMES_P.length], score: Math.round(Math.random() * 800 + 100) });
  }
  arr.sort((a, b) => b.score - a.score);
  return arr;
}

async function showRankingP() {
  let arr;
  if (TESTP) {
    arr = dummyPlayersP(22).slice(0, 20);
  } else {
    const { data } = await sb.from('players').select('*').order('score', { ascending: false }).limit(20);
    arr = (data || []).slice(0, 20);
  }
  const grid = document.getElementById('p-rank-grid');
  const n = arr.length;
  grid.innerHTML = arr.map((p, i) => {
    const crown = ['👑','🥈','🥉','🏅','🏅'][i] || '';
    const delay = (n - 1 - i) * 0.2;
    return `<div class="p-rank-row ${i < 5 ? 'top5' : ''}" style="animation-delay:${delay}s">
      <span class="rp">${crown || (i + 1) + '位'}</span>
      <span class="rn">${escapeHtml(p.name || '?')}</span>
      <span class="rs">${p.score || 0}</span>
    </div>`;
  }).join('') || '<div style="color:#999; font-weight:900;">まだ参加者がいません</div>';
  showP('ranking');
  playStart();
}

// ========== 最終成績発表 ==========
async function showFinishedP() {
  if (TESTP) {
    runFinale(dummyPlayersP(22));
    return;
  }
  const { data } = await sb.from('players').select('*').order('score', { ascending: false });
  const arr = (data || []).map(p => ({ id: p.id, name: p.name, score: p.score || 0 }));
  runFinale(arr);
}

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
    renderResultP(arr);
    return;
  }

  stage.innerHTML = '<div class="finale-title">🎺 最終成績発表!</div>';
  playGrandFanfare();
  fireConfetti();
  await wait(3200);
  if (!finaleRunning) return;

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

  if (arr[2] && finaleRunning) {
    bigRevealP(stage, 3, arr[2], '🥉');
    await wait(5000);
  }
  if (arr[1] && finaleRunning) {
    bigRevealP(stage, 2, arr[1], '🥈');
    await wait(10000);
  }
  if (arr[0] && finaleRunning) {
    championP(stage, arr[0]);
    await wait(9000);
  }

  if (!finaleRunning) return;
  ov.style.transition = 'opacity 0.8s';
  ov.style.opacity = '0';
  await wait(800);
  ov.remove();
  finaleRunning = false;
  renderResultP(arr);
}

function bigRevealP(stage, rank, p, medal) {
  stage.innerHTML = `
    <div class="finale-bigcard blink">
      <div class="fb-medal">${medal}</div>
      <div class="fb-rank">第${rank}位</div>
      <div class="fb-name">${escapeHtml(p.name)}</div>
      <div class="fb-score">${p.score} pts</div>
    </div>`;
  playFanfare();
  fireConfetti();
}

function championP(stage, p) {
  stage.innerHTML = `
    <div class="kusudama">
      <div class="ku-half left"></div><div class="ku-half right"></div>
      <div class="ku-ribbons">${'<span class="ribbon"></span>'.repeat(12)}</div>
      <div class="ku-banner">🎊 Congratulations!! 🎊</div>
    </div>
    <div class="champ">
      <div class="champ-crown">👑</div>
      <div class="champ-rank">優 勝</div>
      <div class="champ-name">${escapeHtml(p.name)}</div>
      <div class="champ-score">${p.score} pts</div>
    </div>`;
  playGrandFanfare();
  setTimeout(playFanfare, 1600);
  fireConfetti();
  setTimeout(fireConfetti, 900);
  setTimeout(fireConfetti, 2000);
  setTimeout(fireConfetti, 3400);
}

function renderResultP(arr) {
  const grid = document.getElementById('p-result-grid');
  grid.innerHTML = arr.slice(0, 10).map((p, i) => {
    const crown = ['👑','🥈','🥉','🏅','🏅'][i] || '';
    return `<div class="p-rank-row ${i < 5 ? 'top5' : ''}" style="animation-delay:${i * 0.05}s">
      <span class="rp">${crown || (i + 1) + '位'}</span>
      <span class="rn">${escapeHtml(p.name)}</span>
      <span class="rs">${p.score}</span>
    </div>`;
  }).join('') || '<div style="color:#999; font-weight:900;">参加者がいませんでした</div>';
  showP('result');
}

// ========== 紙吹雪 ==========
function fireConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#ff2d1f', '#d6285c', '#ffd54a', '#ff7eb3', '#42a5f5', '#66bb6a'];
  const particles = [];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * 5 + 2,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 10 + 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    });
  }
  let frame = 0;
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.size/2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    });
    frame++;
    if (frame < 220) requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  loop();
}

// ========== ⑤ テストモード (プロジェクター実機での映り検証用) ==========
function sampleQuestionsP() {
  return [
    { text: 'テスト問題1: LTCBのコーポレートカラーに最も近い色は?', image: null,
      choices: [{text:'赤'},{text:'青'},{text:'緑'},{text:'黄'}], correct: 0 },
    { text: 'テスト問題2: このクイズアプリで正解すると鳴る音は?', image: null,
      choices: [{text:'ファンファーレ'},{text:'ブザー'},{text:'ドラムロール'},{text:'無音'}], correct: 0 }
  ];
}

async function setupTestP() {
  quiz = { state: 'waiting', current_idx: -1, questions: sampleQuestionsP(), time_limit: 15, question_started_at: 0 };

  // クラウドに共有された問題リストがあれば使用 (本番と同じ見た目で検証できる)
  try {
    if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL && !SUPABASE_URL.includes('YOUR_')) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data } = await sb.from('quiz_draft').select('questions, time_limit').eq('id', 1).maybeSingle();
      if (data && Array.isArray(data.questions) && data.questions.length > 0) {
        quiz.questions = data.questions;
        if (data.time_limit) quiz.time_limit = data.time_limit;
      }
    }
  } catch (e) { console.warn(e); }

  // テストバッジと操作バー
  const badge = document.createElement('div');
  badge.className = 'p-test-badge';
  badge.textContent = '🧪 テストモード';
  document.body.appendChild(badge);

  const bar = document.createElement('div');
  bar.id = 'p-test-bar';
  bar.innerHTML = `
    <button id="p-test-next" onclick="pTestNext()">🚀 READY GO</button>
    <button class="ghost" onclick="pTestRanking()">🏆</button>
    <button class="ghost" onclick="pTestReset()">↺</button>
  `;
  document.body.appendChild(bar);

  handleState(quiz);
  lastKey = quiz.state + ':' + quiz.current_idx;
}

window.pTestNext = function() {
  getAudioCtx();
  const q = quiz;
  if (q.state === 'waiting') {
    q.state = 'ready';
  } else if (q.state === 'ready') {
    q.state = 'question'; q.current_idx = 0; q.question_started_at = Date.now();
    tVotes = [0, 0, 0, 0];
  } else if (q.state === 'question') {
    q.state = 'answer';
  } else if (q.state === 'answer') {
    if (q.current_idx + 1 >= q.questions.length) {
      q.state = 'finished';
    } else {
      q.state = 'question'; q.current_idx++; q.question_started_at = Date.now();
      tVotes = [0, 0, 0, 0];
    }
  } else if (q.state === 'ranking') {
    q.state = (q.current_idx >= 0) ? 'answer' : 'ready';
  } else if (q.state === 'finished') {
    pTestReset();
    return;
  }
  handleState(q);
  lastKey = q.state + ':' + q.current_idx;
  updateTestBtnP();
}

function updateTestBtnP() {
  const btn = document.getElementById('p-test-next');
  if (!btn) return;
  const q = quiz;
  if (q.state === 'waiting') btn.textContent = '🚀 READY GO';
  else if (q.state === 'ready') btn.textContent = '▶ 第1問';
  else if (q.state === 'question') btn.textContent = '✨ 正解';
  else if (q.state === 'answer') btn.textContent = (q.current_idx + 1 >= q.questions.length) ? '🏁 結果' : '▶ 次へ';
  else if (q.state === 'ranking') btn.textContent = '↩ 戻る';
  else if (q.state === 'finished') btn.textContent = '↺ 最初から';
}

window.pTestRanking = function() {
  getAudioCtx();
  quiz.state = 'ranking';
  handleState(quiz);
  lastKey = quiz.state + ':' + quiz.current_idx;
  updateTestBtnP();
}

window.pTestReset = function() {
  clearInterval(timerInt); timerInt = null;
  clearInterval(countInt); countInt = null;
  const cd = document.getElementById('p-countdown');
  if (cd) cd.remove();
  removeFinale();
  tVotes = [0, 0, 0, 0];
  quiz.state = 'waiting'; quiz.current_idx = -1; quiz.question_started_at = 0;
  lastKey = null;
  handleState(quiz);
  lastKey = 'waiting:-1';
  updateTestBtnP();
}

// ========== QRコード ==========
function renderQR() {
  const url = location.href.replace(/\/[^\/]*$/, '/play.html');
  const el = document.getElementById('p-qr');
  el.innerHTML = '';
  new QRCode(el, { text: url, width: 500, height: 500, colorDark: '#d6285c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
}

// ========== 起動 ==========
document.addEventListener('DOMContentLoaded', () => {
  buildBursts();
  renderQR();

  if (EMBED) {
    // 管理画面内プレビュー: クリック不要で即開始 (無音)
    document.getElementById('start-overlay').remove();
    if (TESTP) setupTestP(); else connect();
    return;
  }

  if (TESTP) {
    const ov = document.getElementById('start-overlay');
    ov.querySelector('.big').textContent = '🧪 プロジェクター テストモード';
    ov.querySelector('.small').textContent = 'クリックで音声ON+全画面。実機プロジェクターでの映りを検証できます';
  }

  document.getElementById('start-overlay').addEventListener('click', async () => {
    document.getElementById('start-overlay').remove();
    getAudioCtx();
    playStart();
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    if (TESTP) setupTestP(); else connect();
  });
});
