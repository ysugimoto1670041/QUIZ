// 同期会クイズ v2.9.1 (2026-07-16) - admin.js
console.log('同期会クイズ v2.9.1 (2026-07-16) - admin.js loaded');
// ========== Supabase 初期化 ==========
let sb = null;
let sbReady = false;

function initSupabase() {
  if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || SUPABASE_URL.includes('YOUR_')) {
    document.getElementById('config-warn').classList.remove('hidden');
    return false;
  }
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sbReady = true;
    return true;
  } catch (e) {
    console.error(e);
    document.getElementById('config-warn').classList.remove('hidden');
    return false;
  }
}

// ========== 状態管理 ==========
let questions = [];
let editingIndex = -1;
let tempImage = null;
let tempChoiceImages = [null, null, null, null];

// ========== タブ切替 ==========
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['setup', 'live', 'share'].forEach(name => {
      document.getElementById('tab-' + name).classList.toggle('hidden', name !== t.dataset.tab);
    });
    if (t.dataset.tab === 'share') renderQRCode();
    if (t.dataset.tab === 'live') startLiveWatch();
  });
});

// ========== 問題リスト表示 ==========
const MAX_QUESTIONS = 10;

// ========== ③ 問題の並び替え ==========
let dragFromIdx = -1;

function reorderQuestion(from, to) {
  if (from === to || from < 0 || to < 0 || from >= questions.length || to >= questions.length) return;
  const [moved] = questions.splice(from, 1);
  questions.splice(to, 0, moved);
  // 編集中の問題番号を追随させる (編集内容の保存先ずれを防止)
  if (editingIndex === from) editingIndex = to;
  else if (editingIndex > from && editingIndex <= to) editingIndex--;
  else if (editingIndex < from && editingIndex >= to) editingIndex++;
  saveLocal();
  scheduleDraftSave(); // 並び順もクラウドに共有 (全端末・本番出題順に反映)
  renderQuestionList();
}

window.moveQuestion = function(i, dir) {
  reorderQuestion(i, i + dir);
}

function bindQuestionDnD() {
  document.querySelectorAll('#q-list .q-item').forEach(el => {
    el.addEventListener('dragstart', () => {
      dragFromIdx = parseInt(el.dataset.qi);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('#q-list .q-item').forEach(x => x.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const to = parseInt(el.dataset.qi);
      el.classList.remove('drag-over');
      reorderQuestion(dragFromIdx, to);
      dragFromIdx = -1;
    });
  });
}

function renderQuestionList() {
  const list = document.getElementById('q-list');
  const full = questions.length >= MAX_QUESTIONS;

  // 追加ボタンの制御
  const addBtn = document.getElementById('btn-add-q');
  if (addBtn) {
    addBtn.disabled = full;
    addBtn.style.opacity = full ? '0.5' : '1';
    addBtn.textContent = full ? '✅ 10問 設定済み' : '+ 問題を追加';
  }

  if (questions.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:24px; color:#999; font-size:13px;">まだ問題がありません<br>「+ 問題を追加」から作成してください</div>';
    return;
  }
  list.innerHTML = questions.map((q, i) => `
    <div class="q-item" draggable="true" data-qi="${i}" title="つまんで上下に移動できます">
      <span class="q-grip" aria-hidden="true">⠿</span>
      <div class="q-num">${i + 1}</div>
      <div class="q-text">${escapeHtml(q.text || '(問題文なし)')}</div>
      <div class="q-actions">
        <button class="icon-btn" onclick="moveQuestion(${i}, -1)" title="上へ" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" onclick="moveQuestion(${i}, 1)" title="下へ" ${i === questions.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="icon-btn" onclick="openQuestionEditor(${i})" title="編集">✏️</button>
        <button class="icon-btn" onclick="deleteQuestion(${i})" title="削除">🗑️</button>
      </div>
    </div>
  `).join('') + (full ? '<div class="q-complete">🎉 問題の設定は全て完了です(10問)</div>' : '');
  bindQuestionDnD();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ========== 問題編集モーダル ==========
window.openQuestionEditor = function(index) {
  if (typeof index !== 'number' && questions.length >= MAX_QUESTIONS) {
    alert('問題は最大10問までです。既存の問題を編集するか、削除してから追加してください。');
    return;
  }
  editingIndex = (typeof index === 'number') ? index : -1;
  const q = (editingIndex >= 0) ? questions[editingIndex] : { text: '', image: null, choices: [{text:'',image:null},{text:'',image:null},{text:'',image:null},{text:'',image:null}], correct: 0 };

  document.getElementById('qe-text').value = q.text || '';
  tempImage = q.image || null;
  updateQEImagePreview();

  tempChoiceImages = q.choices.map(c => c.image || null);
  renderChoices(q.choices, q.correct);

  document.getElementById('q-editor').classList.remove('hidden');
  window.scrollTo(0, 0);
}

window.closeQuestionEditor = function() {
  document.getElementById('q-editor').classList.add('hidden');
}

function updateQEImagePreview() {
  const el = document.getElementById('qe-image');
  if (tempImage) {
    el.classList.add('has-img');
    el.style.backgroundImage = `url(${tempImage})`;
    el.innerHTML = '';
  } else {
    el.classList.remove('has-img');
    el.style.backgroundImage = '';
    el.innerHTML = '📷 タップして画像を選択';
  }
}

document.getElementById('qe-image-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) {
    tempImage = await fileToCompressedBase64(f, 800);
    updateQEImagePreview();
  }
});

function renderChoices(choices, correct) {
  const grid = document.getElementById('qe-choices');
  const colors = ['#ff5252', '#42a5f5', '#66bb6a', '#ffa726'];
  const labels = ['A', 'B', 'C', 'D'];
  grid.innerHTML = choices.map((c, i) => `
    <div class="choice-input ${correct === i ? 'correct' : ''}" data-idx="${i}">
      <label style="color:${colors[i]};">
        <span style="display:inline-block; width:22px; height:22px; line-height:22px; text-align:center; background:${colors[i]}; color:white; border-radius:50%; font-weight:900;">${labels[i]}</span>
        選択肢
      </label>
      <input type="text" placeholder="選択肢のテキスト" value="${escapeHtml(c.text || '')}" data-choice-text="${i}">
      <div class="img-preview ${tempChoiceImages[i] ? 'has-img' : ''}" data-choice-img="${i}" style="${tempChoiceImages[i] ? 'background-image:url(' + tempChoiceImages[i] + ')' : ''}">
        ${tempChoiceImages[i] ? '' : '📷 画像(任意)'}
      </div>
      <div class="correct-radio">
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
          <input type="radio" name="qe-correct" value="${i}" ${correct === i ? 'checked' : ''}>
          正解にする
        </label>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-choice-img]').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.choiceImg);
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      input.onchange = async (e) => {
        const f = e.target.files[0];
        if (f) {
          tempChoiceImages[i] = await fileToCompressedBase64(f, 600);
          el.style.backgroundImage = `url(${tempChoiceImages[i]})`;
          el.classList.add('has-img');
          el.innerHTML = '';
        }
      };
      input.click();
    });
  });

  grid.querySelectorAll('input[name="qe-correct"]').forEach(r => {
    r.addEventListener('change', () => {
      grid.querySelectorAll('.choice-input').forEach((el, i) => {
        el.classList.toggle('correct', i === parseInt(r.value));
      });
    });
  });
}

window.saveQuestion = function() {
  const text = document.getElementById('qe-text').value.trim();
  const grid = document.getElementById('qe-choices');
  const choices = [0,1,2,3].map(i => ({
    text: grid.querySelector(`[data-choice-text="${i}"]`).value.trim(),
    image: tempChoiceImages[i]
  }));
  const correctRadio = grid.querySelector('input[name="qe-correct"]:checked');
  const correct = correctRadio ? parseInt(correctRadio.value) : 0;

  if (!text && !tempImage) { alert('問題文または画像を入力してください'); return; }
  if (choices.every(c => !c.text && !c.image)) { alert('少なくとも1つの選択肢を入力してください'); return; }

  const q = { text, image: tempImage, choices, correct };
  if (editingIndex >= 0) questions[editingIndex] = q;
  else questions.push(q);

  saveLocal();
  scheduleDraftSave();
  renderQuestionList();
  closeQuestionEditor();
}

window.deleteQuestion = function(i) {
  if (!confirm('この問題を削除しますか?')) return;
  questions.splice(i, 1);
  saveLocal();
  scheduleDraftSave();
  renderQuestionList();
}

// ========== 画像圧縮 ==========
async function fileToCompressedBase64(file, maxSize) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          const scale = maxSize / Math.max(width, height);
          width *= scale; height *= scale;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ========== ローカル保存 ==========
function saveLocal() {
  try {
    localStorage.setItem('ltcb_quiz_questions', JSON.stringify(questions));
    localStorage.setItem('ltcb_quiz_settings', JSON.stringify({
      timeLimit: parseInt(document.getElementById('time-limit').value),
      qCount: parseInt(document.getElementById('q-count').value)
    }));
  } catch (e) {
    if (e.name === 'QuotaExceededError') alert('画像が大きすぎます。サイズの小さい画像を使ってください。');
  }
}

function loadLocal() {
  try {
    const q = localStorage.getItem('ltcb_quiz_questions');
    if (q) questions = JSON.parse(q);
    const s = localStorage.getItem('ltcb_quiz_settings');
    if (s) {
      const settings = JSON.parse(s);
      if (settings.timeLimit) document.getElementById('time-limit').value = settings.timeLimit;
      if (settings.qCount) document.getElementById('q-count').value = settings.qCount;
    }
  } catch (e) { console.warn(e); }
}

document.getElementById('time-limit').addEventListener('change', () => { saveLocal(); scheduleDraftSave(); });
document.getElementById('q-count').addEventListener('change', () => { saveLocal(); scheduleDraftSave(); });

// ========== Supabase ヘルパ ==========
const QUIZ_ROW_ID = 1;

async function getQuiz() {
  const { data, error } = await sb.from('quiz_state').select('*').eq('id', QUIZ_ROW_ID).maybeSingle();
  if (error) console.error(error);
  return data;
}

async function upsertQuiz(patch) {
  const { error } = await sb.from('quiz_state').upsert({ id: QUIZ_ROW_ID, ...patch, updated_at: new Date().toISOString() });
  if (error) { console.error(error); alert('DB更新エラー: ' + error.message); }
}

// ========== クイズ開始 ==========
window.startQuiz = async function() {
  if (!sbReady) { alert('Supabaseの設定がされていません。README.mdを確認してください。'); return; }
  const qCount = Math.min(parseInt(document.getElementById('q-count').value), questions.length);
  if (qCount < 1) { alert('問題を1つ以上追加してください(「📝 問題設定」タブ)'); return; }
  if (parseInt(document.getElementById('q-count').value) > questions.length) {
    if (!confirm(`出題数が問題数(${questions.length})より多いです。${questions.length}問で開始しますか?`)) return;
  }
  const useQs = questions.slice(0, qCount);
  const timeLimit = parseInt(document.getElementById('time-limit').value);

  await sb.from('answers').delete().neq('id', 0);
  await sb.from('players').update({ score: 0 }).neq('id', '');

  await upsertQuiz({
    state: 'ready',
    current_idx: -1,
    questions: useQs,
    time_limit: timeLimit,
    question_started_at: 0
  });

  // 経過時間タイマーを開始
  localStorage.setItem('ltcb_quiz_started_at', String(Date.now()));
  localStorage.removeItem('ltcb_quiz_finished_at');
  updateElapsed();

}

window.resetQuiz = async function() {
  if (!sbReady) return;
  if (!confirm('【オールリセット】\n参加者・回答・進行状況をすべて消去し、全画面(スマホ・プロジェクター)をスタート前に戻します。\n参加者はQRコードから参加し直しとなります。よろしいですか?')) return;
  await sb.from('answers').delete().neq('id', 0);
  await sb.from('players').delete().neq('id', '');
  await upsertQuiz({ state: 'waiting', current_idx: -1, question_started_at: 0 });
  localStorage.removeItem('ltcb_quiz_started_at');
  localStorage.removeItem('ltcb_quiz_finished_at');
  updateElapsed();
  alert('オールリセットしました。参加者はQRコードから再参加できます。');
}

// スタート前へ戻る: 参加者はそのまま、全画面をスタート前(待受)に戻す
window.backToStart = async function() {
  if (!sbReady) return;
  if (!confirm('【スタート前へ戻る】\n参加者はそのままで、スマホ・プロジェクターの画面をスタート前(待受)に戻します。\nスコアと回答はリセットされます。よろしいですか?')) return;
  await sb.from('answers').delete().neq('id', 0);
  await sb.from('players').update({ score: 0 }).neq('id', '');
  await upsertQuiz({ state: 'waiting', current_idx: -1, question_started_at: 0 });
  localStorage.removeItem('ltcb_quiz_started_at');
  localStorage.removeItem('ltcb_quiz_finished_at');
  updateElapsed();
}

window.endQuiz = async function() {
  await upsertQuiz({ state: 'finished' });
}

// ========== ランキング発表トグル ==========
let rankingPrevState = null;

window.toggleRanking = async function() {
  if (!sbReady) return;
  const quiz = await getQuiz();
  if (!quiz) { alert('クイズが開始されていません'); return; }

  if (quiz.state === 'ranking') {
    const prev = rankingPrevState || ((quiz.current_idx >= 0) ? 'answer' : 'ready');
    rankingPrevState = null;
    await upsertQuiz({ state: prev });
  } else {
    if (quiz.state === 'question') {
      alert('回答受付中はランキングを表示できません。回答発表の後に押してください。');
      return;
    }
    rankingPrevState = quiz.state;
    await upsertQuiz({ state: 'ranking' });
  }
  setTimeout(refreshLive, 300);
}

// ========== ライブ進行 ==========
window.nextStep = async function() {
  const quiz = await getQuiz();
  if (!quiz) { alert('クイズが開始されていません。「▶ クイズ開始」を押してください。'); return; }

  const state = quiz.state;
  const idx = quiz.current_idx;
  const total = (quiz.questions || []).length;

  if (state === 'ranking') {
    alert('ランキング表示中です。「ランキングを閉じる」を押してから進行してください。');
    return;
  }

  if (state === 'waiting' || state === 'ready') {
    if (!(quiz.questions || []).length) {
      alert('問題が配信されていません。\nまず「▶ クイズスタート」を押してから「第1問を開始」を押してください。');
      return;
    }
    await upsertQuiz({
      state: 'question',
      current_idx: 0,
      question_started_at: Date.now()
    });
  } else if (state === 'question') {
    await upsertQuiz({ state: 'answer' });
  } else if (state === 'answer') {
    if (idx + 1 >= total) {
      await upsertQuiz({ state: 'finished' });
    } else {
      await upsertQuiz({
        state: 'question',
        current_idx: idx + 1,
        question_started_at: Date.now()
      });
    }
  } else if (state === 'finished') {
    alert('クイズは終了しています。新しいクイズを始めるには「▶ クイズ開始」を押してください。');
  }
  setTimeout(refreshLive, 300);
}

let liveWatchStarted = false;
let currentLiveQuiz = null;
let playersCount = 0;
function startLiveWatch() {
  if (liveWatchStarted || !sbReady) return;
  liveWatchStarted = true;

  refreshLive();
  refreshPlayers();

  // リアルタイム通知が届かない環境向けの保険 (3秒ごとに再取得)
  setInterval(() => { refreshLive(); refreshPlayers(); }, 3000);

  sb.channel('admin-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state' }, () => refreshLive())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => refreshPlayers())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => refreshAnswers())
    .subscribe();
}

// 進行状態のわかりやすい表現
const STATE_LABELS = {
  waiting: '⏳ 開始前(参加受付中)',
  ready: '🚀 READY GO!(第1問待ち)',
  question: '🎯 出題中(回答受付中)',
  answer: '✨ 正解発表中',
  ranking: '🏆 ランキング表示中',
  finished: '🏁 クイズ終了(成績発表)'
};

async function refreshLive() {
  const quiz = await getQuiz();
  currentLiveQuiz = quiz;
  if (!quiz) return;

  // 大型の問題番号表示
  const bigQ = document.getElementById('big-q');
  if (quiz.current_idx >= 0 && quiz.state !== 'finished') {
    bigQ.textContent = `第${quiz.current_idx + 1}問`;
  } else if (quiz.state === 'finished') {
    bigQ.textContent = '🏁 終了';
  } else if (quiz.state === 'ready') {
    bigQ.textContent = '🚀 READY!';
  } else {
    bigQ.textContent = '開始前';
  }

  const status = document.getElementById('live-status');
  status.classList.toggle('live', quiz.state === 'question');
  status.innerHTML = '<span class="dot"></span>' + (STATE_LABELS[quiz.state] || '-');

  const btn = document.getElementById('btn-next');
  if (quiz.state === 'waiting' || quiz.state === 'ready') btn.textContent = '▶ 第1問を開始';
  else if (quiz.state === 'question') btn.textContent = '✨ 正解を発表';
  else if (quiz.state === 'answer') {
    btn.textContent = (quiz.current_idx + 1 >= (quiz.questions || []).length) ? '🏁 最終成績発表へ' : '▶ 次の質問へ';
  } else if (quiz.state === 'ranking') btn.textContent = '🏆 ランキング表示中';
  else btn.textContent = '✓ 終了しました';
  // ① クイズスタートが押されるまで「第1問を開始」は無効 (グレーアウト)
  btn.disabled = (quiz.state === 'waiting');

  // 終了時に経過時間を固定
  if (quiz.state === 'finished') {
    if (!localStorage.getItem('ltcb_quiz_finished_at')) {
      localStorage.setItem('ltcb_quiz_finished_at', String(Date.now()));
    }
  }

  const rankBtn = document.getElementById('btn-ranking');
  if (rankBtn) {
    rankBtn.textContent = (quiz.state === 'ranking') ? '✖ ランキングを閉じる' : '🏆 現在のランキング発表 (TOP20)';
  }

  refreshAnswers();
  updateQuestionBoard(quiz);
}

// ========== 問題別データボード (平均回答時間 / 正答率) ==========
let testBoardRows = []; // 🧪テストモードの疑似データ

// 参加者画面のテストから疑似データを受信
if ('BroadcastChannel' in window) {
  const bcAdmin = new BroadcastChannel('ltcb-test-sync');
  bcAdmin.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === 'qstat') {
      testBoardRows[m.idx] = m;
      if (pvMode === 'test') renderTestBoard();
    } else if (m.type === 'reset') {
      testBoardRows = [];
      if (pvMode === 'test') renderTestBoard();
    }
  };
}

function renderTestBoard() {
  const el = document.getElementById('q-board');
  if (!el) return;
  const rows = testBoardRows.filter(Boolean);
  if (rows.length === 0) {
    el.innerHTML = '<div class="qb-empty">🧪 テストで正解発表すると疑似データが表示されます</div>';
    return;
  }
  el.innerHTML = rows.map((r, i) => `<div class="qb-row" style="animation-delay:${i * 0.05}s">
    <span class="qb-q">第${r.idx + 1}問</span>
    <span class="qb-t">⏱ 平均 ${r.avgT.toFixed(1)}秒</span>
    <span class="qb-p">🎯 正答率 ${r.rate}%</span>
  </div>`).join('');
}

async function updateQuestionBoard(quiz) {
  const el = document.getElementById('q-board');
  if (!el) return;
  // 🧪 テストモード中は疑似データで機能チェック
  if (pvMode === 'test') { renderTestBoard(); return; }
  if (!quiz) return;
  const qs = quiz.questions || [];

  let doneUpTo = -1;
  if (quiz.state === 'finished') doneUpTo = qs.length - 1;
  else if (quiz.current_idx >= 0) {
    doneUpTo = (quiz.state === 'question') ? quiz.current_idx - 1 : quiz.current_idx;
  }
  if (doneUpTo < 0 || qs.length === 0 || playersCount === 0) {
    el.innerHTML = '<div class="qb-empty">正解発表後に自動で追加されます</div>';
    return;
  }

  const { data, error } = await sb.from('answers').select('q_idx, choice, elapsed_ms');
  if (error) { console.error(error); return; }
  const ans = data || [];
  const limit = (quiz.time_limit || 15) * 1000;

  let html = '';
  for (let i = 0; i <= doneUpTo && i < qs.length; i++) {
    const rows = ans.filter(a => a.q_idx === i);
    // 平均回答時間: タップ時点の秒数、無回答者は制限時間としてカウント
    const sumT = rows.reduce((s, a) => s + Math.min(a.elapsed_ms || limit, limit), 0)
               + Math.max(0, playersCount - rows.length) * limit;
    const avgT = sumT / playersCount / 1000;
    // ① 正答率 = 正解者数 ÷ 参加者数
    const correct = qs[i] ? qs[i].correct : 0;
    const cc = rows.filter(a => a.choice === correct).length;
    const rate = Math.round(cc / playersCount * 100);
    html += `<div class="qb-row" style="animation-delay:${i * 0.05}s">
      <span class="qb-q">第${i + 1}問</span>
      <span class="qb-t">⏱ 平均 ${avgT.toFixed(1)}秒</span>
      <span class="qb-p">🎯 正答率 ${rate}%</span>
    </div>`;
  }
  el.innerHTML = html || '<div class="qb-empty">正解発表後に自動で追加されます</div>';
}

async function refreshPlayers() {
  const { data, error } = await sb.from('players').select('*').order('score', { ascending: false });
  if (error) { console.error(error); return; }
  playersCount = (data || []).length;
  const stat = document.getElementById('stat-players');
  const prev = stat.textContent;
  stat.textContent = playersCount;
  if (prev !== stat.textContent) {
    stat.parentElement.classList.add('bump');
    setTimeout(() => stat.parentElement.classList.remove('bump'), 400);
  }
}

async function refreshAnswers() {
  if (!currentLiveQuiz) return;
  const idx = currentLiveQuiz.current_idx;
  if (idx < 0) {
    document.getElementById('stat-correct').textContent = 0;
    document.getElementById('stat-rate').textContent = '—';
    return;
  }
  const { data, error } = await sb.from('answers').select('*').eq('q_idx', idx);
  if (error) { console.error(error); return; }
  const ans = data || [];

  const question = (currentLiveQuiz.questions || [])[idx];
  if (!question) return;
  const correctAns = ans.filter(a => a.choice === question.correct);
  document.getElementById('stat-correct').textContent = correctAns.length;
  // ④ 正答率 = 正解者数 ÷ 参加者数 (無回答も「はずれ」扱い)
  document.getElementById('stat-rate').textContent =
    playersCount > 0 ? Math.round(correctAns.length / playersCount * 100) + '%' : '—';
}

// ========== 問題リストのクラウド共有 ==========
// 専用テーブル quiz_draft (常に id=1 の単一行) に保存する。
// これによりどの端末 (PC・スマホ) からも同じ最新の問題リストが表示される。
// ※ quiz_state は CHECK(id=1) 制約があり id=2 を追加できないため専用テーブルを使用
const DRAFT_ROW_ID = 1;
let draftSaveTimer = null;

function setCloudStatus(text, color) {
  const el = document.getElementById('cloud-status');
  if (el) { el.textContent = text; el.style.color = color || '#4caf50'; }
}

function scheduleDraftSave() {
  if (!sbReady) { setCloudStatus('⚠ Supabase未設定 (この端末のみ保存)', '#e65100'); return; }
  setCloudStatus('☁ 保存中...', '#999');
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftToCloud, 800);
}

async function saveDraftToCloud() {
  if (!sbReady) return;
  const { error } = await sb.from('quiz_draft').upsert({
    id: DRAFT_ROW_ID,
    questions: questions,
    time_limit: parseInt(document.getElementById('time-limit').value) || 15,
    updated_at: new Date().toISOString()
  });
  if (error) {
    console.error('クラウド保存エラー:', error);
    if (error.code === '42P01' || String(error.message || '').includes('quiz_draft')) {
      setCloudStatus('⚠ 共有用テーブル未作成 → setup-draft.sql をSupabaseで実行してください', '#c62828');
    } else {
      setCloudStatus('⚠ クラウド保存に失敗: ' + (error.message || '不明なエラー'), '#c62828');
    }
  } else {
    setCloudStatus('☁ 全端末に共有済み');
  }
}

async function loadDraftFromCloud() {
  if (!sbReady) { setCloudStatus('⚠ Supabase未設定 (この端末のみ保存)', '#e65100'); return false; }
  const { data, error } = await sb.from('quiz_draft').select('questions, time_limit').eq('id', DRAFT_ROW_ID).maybeSingle();
  if (error) {
    console.error('クラウド読込エラー:', error);
    if (error.code === '42P01' || String(error.message || '').includes('quiz_draft')) {
      setCloudStatus('⚠ 共有用テーブル未作成 → setup-draft.sql をSupabaseで実行してください', '#c62828');
    }
    return false;
  }
  if (data && Array.isArray(data.questions) && data.questions.length > 0) {
    questions = data.questions;
    if (data.time_limit) document.getElementById('time-limit').value = data.time_limit;
    saveLocal(); // この端末にもキャッシュ
    setCloudStatus('☁ 全端末に共有済み');
    return true;
  }
  return false;
}

// ========== 経過時間 (クイズ開始からの 分:秒) ==========
let elapsedTimer = null;

function updateElapsed() {
  const el = document.getElementById('quiz-elapsed');
  if (!el) return;
  const t0 = parseInt(localStorage.getItem('ltcb_quiz_started_at') || '0');
  if (!t0) { el.textContent = '00:00'; return; }
  const tEnd = parseInt(localStorage.getItem('ltcb_quiz_finished_at') || '0') || Date.now();
  const sec = Math.max(0, Math.floor((tEnd - t0) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  el.textContent = mm + ':' + ss;
}

function startElapsedTicker() {
  if (elapsedTimer) return;
  updateElapsed();
  elapsedTimer = setInterval(updateElapsed, 1000);
}

// ========== プレビュー/テスト切替 ==========
let pvMode = 'preview'; // 参加者プレビューの現在モード

function setProjTabActive(mode) {
  document.querySelectorAll('.proj-col .pj-tab').forEach(x => {
    x.classList.toggle('active', x.dataset.mode === mode);
  });
}

function setupPreviewTabs() {
  // 参加者画面 (ライブ/テスト) — 切替時はプロジェクターも同モードに連動
  document.querySelectorAll('.preview-col .pv-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.preview-col .pv-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      pvMode = b.dataset.mode;
      const isTest = pvMode === 'test';
      document.getElementById('preview-frame').src =
        'play.html?' + (isTest ? 'test=1' : 'preview=1') + '&v=33';
      // プロジェクターを連動切替 (テスト時は参加者画面に追従する連動テストモード)
      document.getElementById('projector-frame').src =
        'projector.html?embed=1&v=33' + (isTest ? '&test=1&follow=1' : '');
      setProjTabActive(isTest ? 'test' : 'live');
      if (!isTest) { testBoardRows = []; }
      updateQuestionBoard(currentLiveQuiz);
    });
  });
  const reload = document.querySelector('.preview-col .pv-reload');
  if (reload) {
    reload.addEventListener('click', () => {
      const f = document.getElementById('preview-frame');
      f.src = f.src;
    });
  }
  // ⑤ プロジェクター画面 (ライブ/テスト)
  document.querySelectorAll('.proj-col .pj-tab').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.proj-col .pj-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('projector-frame').src =
        'projector.html?embed=1&v=33' + (b.dataset.mode === 'test' ? '&test=1' : '');
    });
  });
  const pjReload = document.querySelector('.proj-col .pj-reload');
  if (pjReload) {
    pjReload.addEventListener('click', () => {
      const f = document.getElementById('projector-frame');
      f.src = f.src;
    });
  }
}

// ========== QRコード ==========
function renderQRCode() {
  const url = location.href.replace(/\/[^\/]*$/, '/play.html');
  document.getElementById('participant-url').textContent = url;
  const qrEl = document.getElementById('qrcode');
  qrEl.innerHTML = '';
  new QRCode(qrEl, { text: url, width: 220, height: 220, colorDark: '#d6285c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
}

window.copyURL = function() {
  const url = document.getElementById('participant-url').textContent;
  navigator.clipboard.writeText(url).then(() => alert('URLをコピーしました'));
}

// ========== 起動 ==========
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  loadLocal();
  renderQuestionList();
  setupPreviewTabs();
  startElapsedTicker();

  // クラウドに保存された問題リストを読込 (どの端末でも最新を表示)
  loadDraftFromCloud().then((loaded) => {
    if (loaded) {
      renderQuestionList();
    } else if (questions.length > 0) {
      // クラウドが空でこの端末に問題がある場合はアップロードして共有
      scheduleDraftSave();
    }
  });
});
