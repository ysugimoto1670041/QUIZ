// 同期会クイズ v3.2 (2026-07-16) - projector.js
console.log('同期会クイズ v3.2 (2026-07-16) - projector.js loaded');
// ========== プロジェクター表示ロジック ==========
const QUIZ_ROW_ID = 1;
const COUNTDOWN_MS = 5500;      // 通常: ディレイ吸収2.5秒 + 3・2・1
const COUNTDOWN_MS_LAST = 6500; // 最終問題: 予告表示3秒 + 3・2・1

function isLastQuestion(q) {
  return q && q.current_idx === ((q.questions || []).length - 1);
}
// ?embed=1 : 管理画面内のプレビュー用 (無音・自動接続・全画面化なし)
const EMBED = new URLSearchParams(location.search).has('embed');
// ?test=1 : テストモード (DB進行と切り離してローカル再生。実機プロジェクターの映りを検証できる)
const TESTP = new URLSearchParams(location.search).has('test');
// ?follow=1 : 参加者画面のテストモードに同期して動く「連動テスト」
const FOLLOW = new URLSearchParams(location.search).has('follow');
let followRanking = null; // 参加者画面から受信した途中ランキング
let followFinal = null;   // 参加者画面から受信した最終結果
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
  // HDMI接続やディスプレイ切替でコンテキストが閉じられた場合は作り直す
  if (audioCtx && audioCtx.state === 'closed') audioCtx = null;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) {}
  }
  return audioCtx;
}

// ①② 音声エンジンの生存監視: suspend/interrupted状態を自動復旧
//    (HDMIの音声出力切替・ウィンドウのフォーカス喪失などで途中から無音になる問題への対策)
let audioWatchdogStarted = false;
function startAudioWatchdog() {
  if (audioWatchdogStarted) return;
  audioWatchdogStarted = true;
  setInterval(() => {
    if (!audioCtx) return;
    if (audioCtx.state === 'closed') { audioCtx = null; return; }
    if (audioCtx.state !== 'running') {
      try { audioCtx.resume(); } catch (e) {}
      setTimeout(() => {
        if (audioCtx && audioCtx.state !== 'running' && !EMBED) showAudioHint();
      }, 1500);
    } else {
      hideAudioHint();
    }
  }, 2000);
}

function showAudioHint() {
  if (document.getElementById('audio-hint')) return;
  const b = document.createElement('button');
  b.id = 'audio-hint';
  b.textContent = '🔊 タップで音声を再開';
  b.style.cssText = 'position:fixed;bottom:6vh;left:50%;transform:translateX(-50%);z-index:2500;font-family:inherit;font-weight:900;font-size:2.4vh;padding:1.4vh 3vw;border:none;border-radius:999px;background:#ff9800;color:#fff;box-shadow:0 1vh 3vh rgba(0,0,0,.4);cursor:pointer;';
  b.onclick = () => { try { getAudioCtx().resume(); } catch (e) {} hideAudioHint(); };
  document.body.appendChild(b);
}
function hideAudioHint() {
  const b = document.getElementById('audio-hint');
  if (b) b.remove();
}
let projMuted = false; // ⑤ 多重起動検知時の自動消音フラグ

function playTone(freq, duration, type = 'sine', volume = 0.2) {
  if (projMuted) return; // ⑤ 新しい画面に音を譲る
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

// 最初のタッチ/クリックでAudioContextを確実にアンロック
function unlockAudio() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) {}
}
document.addEventListener('touchend', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });

// ==== v2.4 音響エンジン ====

// シンバルクラッシュ (ノイズバースト)
function playCrash(delay = 0) {
  if (projMuted) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  setTimeout(() => {
    try {
      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 5000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start();
    } catch (e) {}
  }, delay);
}

// ② 時間切れの鐘「カンカンカーン」(徐々に大きく鳴り響くクレッシェンド)
function playTimeUpBell() {
  const strike = (t, f, v) => setTimeout(() => {
    playTone(f, 0.5, 'triangle', v);
    playTone(f * 2.76, 0.35, 'sine', v * 0.55); // 金属的な倍音
    playTone(f * 5.4, 0.18, 'sine', v * 0.3);
  }, t);
  // カン…カン…カーン と音量が段階的に増していく
  strike(0,   1318, 0.06);
  strike(220, 1318, 0.09);
  strike(430, 1318, 0.13);
  strike(620, 1318, 0.17);
  // 最後にひときわ大きく長く鳴り響く
  setTimeout(() => {
    playTone(1046, 1.8, 'triangle', 0.2);
    playTone(1046 * 2.76, 1.2, 'sine', 0.1);
    playTone(523, 1.6, 'triangle', 0.1);
  }, 820);
}

// ③ セレブレーションファンファーレ (最終成績発表用・響き渡る豪華版)
function playCelebrationFanfare() {
  playCrash(0);
  const seq = [
    [523, 0, 0.16], [659, 130, 0.16], [784, 260, 0.16], [1047, 390, 0.28],
    [784, 700, 0.14], [1047, 830, 0.14], [1319, 960, 0.32]
  ];
  seq.forEach(([f, t, d]) => setTimeout(() => {
    playTone(f, d + 0.15, 'triangle', 0.16);
    playTone(f / 2, d + 0.15, 'triangle', 0.08); // 低音の厚み
  }, t));
  // 持続する大団円コード + 2発目のクラッシュ
  setTimeout(() => {
    [523, 659, 784, 1047, 1319].forEach(f => playTone(f, 1.6, 'triangle', 0.09));
    playCrash(0);
  }, 1500);
  setTimeout(() => {
    [587, 740, 880, 1175].forEach(f => playTone(f, 1.4, 'triangle', 0.08));
  }, 2600);
}

// ⑥ 出題スティング「ジャジャン!」(カウントダウン0の瞬間)
// ② 正解発表ジングル (クラッシュ+上昇アルペジオ+輝く和音)
function playRevealJingle() {
  playCrash(0);
  const seq = [[523, 0], [659, 110], [784, 220], [1047, 330]];
  seq.forEach(([f, t]) => setTimeout(() => {
    playTone(f, 0.22, 'triangle', 0.16);
    playTone(f / 2, 0.22, 'triangle', 0.08);
  }, t));
  setTimeout(() => {
    [1047, 1319, 1568].forEach(f => playTone(f, 1.1, 'triangle', 0.11));
  }, 480);
}

// ==== ③ MP3効果音・BGM (会場音源) ====
const SFX_FILES = {
  qr: 'bgm_qr.mp3',            // ① QRコード待受BGM (ループ)
  ready: 'bgm_ready.mp3',      // ② READY GO画面BGM (ループ)
  count10: 'se_countdown10.mp3', // ③ 残り10秒カウントダウン
  timeout: 'se_timeout.mp3',   // ④ タイムアップ
  reveal: 'se_reveal.mp3',     // ⑤ 正解発表
  champion: 'se_champion.mp3'  // ⑥ 優勝者発表
};
const sfxPool = {};
function getSfx(k) {
  let a = sfxPool[k];
  if (!a) { a = new Audio(SFX_FILES[k]); a.preload = 'auto'; sfxPool[k] = a; }
  return a;
}
function preloadSfx() {
  Object.keys(SFX_FILES).forEach(k => { try { getSfx(k).load(); } catch (e) {} });
}
function playSfx(k, opts) {
  opts = opts || {};
  if (projMuted) return;
  if (EMBED && !TESTP) return;
  try {
    const a = getSfx(k);
    a.loop = !!opts.loop;
    a.volume = (opts.volume !== undefined) ? opts.volume : 1;
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
function stopSfx(k) {
  const a = sfxPool[k];
  if (a) { try { a.pause(); a.currentTime = 0; } catch (e) {} }
}
function stopBgmSfx() { stopSfx('qr'); stopSfx('ready'); }

function playQuestionSting() {
  [330, 415, 494].forEach(f => playTone(f, 0.14, 'sawtooth', 0.08));
  setTimeout(() => {
    [392, 494, 587, 784].forEach(f => playTone(f, 0.45, 'sawtooth', 0.09));
    playTone(98, 0.3, 'sine', 0.12);
  }, 160);
}

// ④ 待機中BGM (ワクワク感のある8bit風ループ)
let bgmTimer = null;
let bgmStep = 0;
const BGM_MELODY = [523, 659, 784, 659, 880, 784, 659, 523, 587, 698, 880, 698, 1047, 880, 784, 659];
const BGM_BASS = [262, 262, 220, 220, 175, 175, 196, 196];

function startWaitBgm() {
  if (bgmTimer) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  bgmStep = 0;
  bgmTimer = setInterval(() => {
    const s = bgmStep % 16;
    const m = BGM_MELODY[s];
    if (m) playTone(m, 0.13, 'square', 0.028);
    if (s % 2 === 0) playTone(BGM_BASS[s / 2], 0.22, 'triangle', 0.045);
    if (s % 4 === 0) playTone(90, 0.08, 'sine', 0.07);           // キック
    if (s === 14) playTone(1568, 0.1, 'sine', 0.03);             // きらめき
    bgmStep++;
  }, 150);
}

function stopWaitBgm() {
  clearInterval(bgmTimer);
  bgmTimer = null;
}


function playUrgeTick(frac) {
  const base = 400 + (1 - frac) * 520;
  playTone(base, 0.06, 'square', 0.06 + (1 - frac) * 0.08);
  if (frac < 0.4) {
    setTimeout(() => playTone(base * 1.5, 0.05, 'square', 0.1), 75);
  }
}

// ========== 投票数ライブ表示 (残り5秒〜) ==========
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

function applyVotesToBadges() {
  document.getElementById('pq-answered').textContent = tVotes.reduce((a, b) => a + b, 0);
  document.querySelectorAll('#p-choices .p-vote').forEach(el => {
    const i = parseInt(el.dataset.vc);
    const t = (tVotes[i] || 0) + '票';
    if (el.textContent !== t) {
      el.textContent = t;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  });
}

async function refreshVoteCountsP() {
  if (!quiz || quiz.current_idx < 0) return;
  let counts = [0, 0, 0, 0];
  if (TESTP) {
    if (!FOLLOW) tVotes[Math.floor(Math.random() * 4)]++; // 連動時は参加者画面の票をそのまま使用
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

  const data = await fetchQuizP();
  if (data) { quiz = data; handleState(data); }
  refreshCount();

  // 【重要】RT通知は不完全な行(questions欠落)で届き得るため、合図としてのみ使いRESTで再取得
  sb.channel('projector-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state', filter: `id=eq.${QUIZ_ROW_ID}` }, async () => {
      const data = await fetchQuizP();
      if (data) {
        quiz = data;
        handleState(data);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => refreshCount())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => refreshAnswered())
    .subscribe();

  // 画面復帰時に即座に最新状態へ追随
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    const data = await fetchQuizP();
    if (data && (!quiz || !quiz.updated_at || data.updated_at >= quiz.updated_at)) {
      quiz = data;
      handleState(data);
    }
  });

  // リアルタイム通知が届かない環境向けの保険 (2.5秒ごとに状態を再取得)
  // ※ 古いデータで新しい表示(正解発表など)を上書きしないよう updated_at で防御
  setInterval(async () => {
    const data = await fetchQuizP();
    if (data && (!quiz || !quiz.updated_at || data.updated_at >= quiz.updated_at)) {
      quiz = data;
      handleState(data);
    }
    refreshCount();
  }, 1200); // ① 軽量化により高頻度ポーリング
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
// ① 軽量同期: 状態のみポーリングし、写真入りquestionsは配信時に1回だけ取得
const QUIZ_LIGHT_COLS = 'id, state, current_idx, question_started_at, time_limit, updated_at';
let questionsCacheP = null;
let questionsStampP = null;

async function fetchQuizP() {
  const { data: light, error } = await sb.from('quiz_state').select(QUIZ_LIGHT_COLS).eq('id', QUIZ_ROW_ID).maybeSingle();
  if (error) { console.error(error); return null; }
  if (!light) return null;
  // ① 待受中でも事前取得してキャッシュを温めておく (第1問の初動を最速化)
  const freshDist = (light.state === 'ready' && questionsStampP !== light.updated_at);
  if (!questionsCacheP) {
    // 初回のみ取得完了を待つ
    const { data: qq, error: e2 } = await sb.from('quiz_state').select('questions').eq('id', QUIZ_ROW_ID).maybeSingle();
    if (!e2 && qq && Array.isArray(qq.questions)) {
      questionsCacheP = qq.questions;
      if (light.state === 'ready') questionsStampP = light.updated_at;
    }
  } else if (freshDist && !fetchQuizP._bg) {
    // 再配信の取り込みは背景で行い、READY表示や第1問の進行を一切ブロックしない
    fetchQuizP._bg = true;
    const distStamp = light.updated_at;
    (async () => {
      try {
        const { data: qq } = await sb.from('quiz_state').select('questions').eq('id', QUIZ_ROW_ID).maybeSingle();
        if (qq && Array.isArray(qq.questions)) {
          questionsCacheP = qq.questions;
          questionsStampP = distStamp;
        }
      } catch (e) { console.warn(e); }
      finally { fetchQuizP._bg = false; }
    })();
  }
  return Object.assign({}, light, { questions: questionsCacheP || [] });
}

function handleState(q) {
  if (!q || !Array.isArray(q.questions)) return; // 不完全データ防御
  const key = q.state + ':' + q.current_idx;
  if (q.state !== 'finished') removeFinale();

  if (q.state === 'waiting') {
    stopWaitBgm();
    stopSfx('ready');
    if (lastKey !== key) playSfx('qr', { loop: true }); // ① QR待受BGM
    toggleReadyP(false);
    showP('waiting');
  } else if (q.state === 'ready') {
    stopWaitBgm();
    stopSfx('qr');
    if (lastKey !== key) playSfx('ready', { loop: true }); // ② READY GO BGM (第1問開始まで)
    toggleReadyP(true);
    showP('waiting');
  } else if (q.state === 'question') {
    stopWaitBgm();
    stopBgmSfx();
    if (lastKey !== key) showQuestionP(q);
  } else if (q.state === 'answer') {
    stopBgmSfx();
    if (lastKey !== key) revealP(q);
  } else if (q.state === 'ranking') {
    stopWaitBgm();
    stopBgmSfx();
    if (lastKey !== key) showRankingP();
  } else if (q.state === 'finished') {
    stopWaitBgm();
    stopBgmSfx();
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
  return (q.question_started_at || 0) + (isLastQuestion(q) ? COUNTDOWN_MS_LAST : COUNTDOWN_MS);
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


  // ④ バナー類はヘッダー中央に表示 (選択肢の位置を動かさない)
  const mid = document.getElementById('pq-mid');
  mid.innerHTML = '';
  if (idx === q.questions.length - 1) {
    const d = document.createElement('div');
    d.id = 'p-double';
    d.className = 'p-double';
    d.textContent = '🔥 最終問題!ダブルスコア!!';
    mid.appendChild(d);
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
    showCountdownP(effStart, () => startTimerP(q), isLastQuestion(q));
  } else {
    playQuestionSting(); // カウントダウンを逃した場合も出題の合図を鳴らす
    startTimerP(q);
  }
}

function showCountdownP(effStart, onDone, isLast) {
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
      playQuestionSting(); // ⑥ 出題スティング
      onDone();
      return;
    }
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastShown) {
      lastShown = sec;
      if (sec <= 3) {
        overlay.innerHTML = `<div class="p-count-num">${sec}</div>`;
        playCountBeep(false);
      } else if (isLast) {
        overlay.innerHTML = `<div class="countdown-final">🔥 最後の問題です。<br>この得点は倍になります!</div>`;
      } else {
        overlay.innerHTML = `<div class="countdown-ready">まもなく出題!</div>`;
      }
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

  let count10Played = false;
  timerInt = setInterval(() => {
    const remaining = Math.max(0, limit - (Date.now() - startedAt));
    const frac = remaining / limit;
    fill.style.width = Math.min(100, frac * 100) + '%';
    const sec = Math.ceil(remaining / 1000);
    // ③ 残り10秒でカウントダウン効果音 (mp3)
    if (!count10Played && remaining > 0 && remaining <= 10000) {
      count10Played = true;
      playSfx('count10');
    }
    // 残り5秒: 投票数を表示してライブ更新 (迷っている人の決断を促す)
    if (remaining > 0 && remaining <= 5000 && quiz && quiz.state === 'question') {
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
    if (remaining <= 0) {
      clearInterval(timerInt); timerInt = null;
      stopSfx('count10');
      playSfx('timeout'); // ④ タイムアップ (mp3)
    }
  }, 100);
}

// ========== 回答発表 ==========
async function updateRateBannerP(q, correct, attempt) {
  let cc = 0, pCount = 0;
  if (TESTP) {
    cc = tVotes[correct] || 0;
    pCount = tVotes.reduce((a, b) => a + b, 0) + 2; // 未回答2人と仮定
  } else {
    try {
      const { data, error } = await sb.from('answers').select('choice').eq('q_idx', q.current_idx);
      if (error) throw error;
      cc = (data || []).filter(a => a.choice === correct).length;
      const { data: pl } = await sb.from('players').select('id');
      pCount = (pl || []).length;
    } catch (e) {
      console.warn('正答率の取得に失敗。自動再試行します:', e);
      if (attempt < 5 && quiz && quiz.state === 'answer') {
        setTimeout(() => updateRateBannerP(q, correct, attempt + 1), 2500);
      }
      return;
    }
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
    r.textContent = `📊 正答率 ${rate}%`;
    document.getElementById('pq-mid').appendChild(r);
  }
}

async function revealP(q) {
  clearInterval(timerInt); timerInt = null;
  clearInterval(countInt); countInt = null;
  const cd = document.getElementById('p-countdown');
  if (cd) cd.remove();

  const question = (q.questions || [])[q.current_idx];
  if (!question) return;
  const correct = question.correct;

  showP('question');
  document.querySelectorAll('.p-choice').forEach((el, i) => {
    el.classList.remove('correct-reveal', 'wrong-reveal');
    const oldTag = el.querySelector('.p-correct-tag');
    if (oldTag) oldTag.remove();
    if (i === correct) {
      el.classList.add('correct-reveal');
      // ① どれが正解か一目でわかるタグ
      const tag = document.createElement('div');
      tag.className = 'p-correct-tag';
      tag.textContent = '✔ 正解';
      el.appendChild(tag);
    } else {
      el.classList.add('wrong-reveal');
    }
  });

  stopSfx('count10');
  playSfx('reveal'); // ⑤ 正解発表 (mp3)
  fireConfetti();

  // 正答率バナー (正解者数 ÷ 参加者数)。取得失敗時は2.5秒後に自動再試行【自己修復】
  updateRateBannerP(q, correct, 0);
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
    arr = ((FOLLOW && followRanking) ? followRanking : dummyPlayersP(22)).slice(0, 20);
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
    runFinale((FOLLOW && followFinal) ? followFinal : dummyPlayersP(22));
    return;
  }
  // ④ 通信不調による誤表示防止: 最大3回リトライ
  let data = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await sb.from('players').select('*').order('score', { ascending: false });
      if (res.error) throw res.error;
      data = res.data || [];
      break;
    } catch (e) {
      console.warn('最終結果の取得に失敗 (' + (i + 1) + '/3):', e);
      await new Promise(r => setTimeout(r, 700));
    }
  }
  if (data === null) { lastKey = null; return; } // ポーリングで自動再試行
  const arr = data.map(p => ({ id: p.id, name: p.name, score: p.score || 0 }));
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
  playCelebrationFanfare(); // ③ セレブレーションが響き渡る
  fireConfetti();
  setTimeout(fireConfetti, 1500);
  await wait(4200);
  if (!finaleRunning) return;

  const startIdx = Math.min(19, n - 1);
  if (startIdx >= 3) {
    // ② 最初から1〜20位の枠(左列=1〜10位/右列=11〜20位)を表示し、
    //    20位から順に名前と得点が埋まっていく
    const total = Math.min(20, n);
    let leftRows = '', rightRows = '';
    for (let r = 1; r <= total; r++) {
      const rowHtml = `<div class="finale-row pending" id="fr-r${r}">
        <span class="fr-pos">${r}位</span>
        <span class="fr-name">— — —</span>
        <span class="fr-score"></span>
      </div>`;
      if (r <= 10) leftRows += rowHtml; else rightRows += rowHtml;
    }
    stage.innerHTML = `<div class="finale-sub">🏆 TOP 20</div>
      <div class="finale-cols">
        <div class="finale-col" id="fl-left">${leftRows}</div>
        <div class="finale-col" id="fl-right">${rightRows}</div>
      </div>`;
    for (let i = startIdx; i >= 3; i--) {
      if (!finaleRunning) return;
      const p = arr[i];
      if (!p) continue;
      const row = document.getElementById('fr-r' + (i + 1));
      if (row) {
        row.querySelector('.fr-name').textContent = p.name;
        row.querySelector('.fr-score').textContent = p.score;
        row.classList.remove('pending');
        row.classList.add('filled');
      }
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
  playCrash();
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
  playSfx('champion'); // ⑥ 優勝者発表 (mp3)
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

async function setupFollowP() {
  quiz = { state: 'waiting', current_idx: -1, questions: sampleQuestionsP(), time_limit: 15, question_started_at: 0 };
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

  const badge = document.createElement('div');
  badge.className = 'p-test-badge';
  badge.textContent = '🧪 連動テスト (参加者画面と同期)';
  document.body.appendChild(badge);
  document.getElementById('p-count').textContent = '22';

  if ('BroadcastChannel' in window) {
    const bc = new BroadcastChannel('ltcb-test-sync');
    bc.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'reset') {
        tVotes = [0, 0, 0, 0];
        followRanking = null;
        followFinal = null;
        removeFinale();
        quiz.state = 'waiting'; quiz.current_idx = -1; quiz.question_started_at = 0;
        lastKey = null;
        handleState(quiz);
        return;
      }
      if (m.type === 'votes') {
        // 参加者画面と同じ票数に同期
        tVotes = (m.votes || [0,0,0,0]).slice();
        applyVotesToBadges();
        return;
      }
      if (m.type === 'ranking') { followRanking = m.players || null; return; }
      if (m.type === 'final')   { followFinal = m.players || null; return; }
      if (m.type !== 'state') return;
      if (m.state === 'question' && quiz.state !== 'question') tVotes = [0, 0, 0, 0];
      if (Array.isArray(m.votes)) tVotes = m.votes.slice();
      quiz.state = m.state;
      quiz.current_idx = m.current_idx;
      quiz.question_started_at = m.question_started_at;
      if (m.time_limit) quiz.time_limit = m.time_limit;
      handleState(quiz);
    };
  }
  handleState(quiz);
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

  document.getElementById('p-count').textContent = '22';

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

// ④ プロジェクター画面が複数開かれていないか監視 (音が二重になる原因)
function showMutedBadge() {
  hideAudioHint();
  if (document.getElementById('muted-badge')) return;
  const d = document.createElement('div');
  d.id = 'muted-badge';
  d.textContent = '🔇 新しいプロジェクター画面が開かれたため、この画面は消音しました (このタブは閉じてOK)';
  d.style.cssText = 'position:fixed;top:1.5vh;left:50%;transform:translateX(-50%);z-index:2500;font-weight:900;font-size:2vh;padding:1vh 2.5vw;border-radius:999px;background:#555;color:#fff;box-shadow:0 1vh 3vh rgba(0,0,0,.4);max-width:92vw;text-align:center;';
  document.body.appendChild(d);
}

function showDupWarn() {
  if (document.getElementById('dup-warn')) return;
  const d = document.createElement('div');
  d.id = 'dup-warn';
  d.textContent = '⚠ プロジェクター画面が複数開いています。音が二重になるため、他のタブ/ウィンドウを閉じてください';
  d.style.cssText = 'position:fixed;top:1.5vh;left:50%;transform:translateX(-50%);z-index:2500;font-weight:900;font-size:2vh;padding:1vh 2.5vw;border-radius:999px;background:#c62828;color:#fff;box-shadow:0 1vh 3vh rgba(0,0,0,.4);max-width:90vw;text-align:center;';
  document.body.appendChild(d);
  setTimeout(() => { const x = document.getElementById('dup-warn'); if (x) x.remove(); }, 12000);
}
if (!EMBED && 'BroadcastChannel' in window) {
  try {
    const dupBc = new BroadcastChannel('ltcb-proj-live');
    const myTag = Math.random().toString(36).slice(2);
    dupBc.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.tag === myTag) return;
      if (m.type === 'hello') {
        // ⑤ 新しいプロジェクター画面が開いた → この(古い)画面は自動で消音し、音のダブりを根絶
        dupBc.postMessage({ type: 'here', tag: myTag });
        projMuted = true;
        stopWaitBgm();
        showMutedBadge();
      } else if (m.type === 'here') {
        showDupWarn();
      }
    };
    dupBc.postMessage({ type: 'hello', tag: myTag });
  } catch (e) {}
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
    if (TESTP) { startAudioWatchdog(); preloadSfx(); }
    if (TESTP && FOLLOW) setupFollowP();
    else if (TESTP) setupTestP();
    else connect();
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
    startAudioWatchdog();
    preloadSfx();
    try { await document.documentElement.requestFullscreen(); } catch (e) {}
    if (TESTP && FOLLOW) setupFollowP();
    else if (TESTP) setupTestP();
    else connect();
  });
});
