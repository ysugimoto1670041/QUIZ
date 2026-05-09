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
function renderQuestionList() {
  const list = document.getElementById('q-list');
  if (questions.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:24px; color:#999; font-size:13px;">まだ問題がありません<br>「+ 問題を追加」から作成してください</div>';
    return;
  }
  list.innerHTML = questions.map((q, i) => `
    <div class="q-item">
      <div class="q-num">${i + 1}</div>
      <div class="q-text">${escapeHtml(q.text || '(問題文なし)')}</div>
      <div class="q-actions">
        <button class="icon-btn" onclick="openQuestionEditor(${i})" title="編集">✏️</button>
        <button class="icon-btn" onclick="deleteQuestion(${i})" title="削除">🗑️</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// ========== 問題編集モーダル ==========
window.openQuestionEditor = function(index) {
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
  renderQuestionList();
  closeQuestionEditor();
}

window.deleteQuestion = function(i) {
  if (!confirm('この問題を削除しますか?')) return;
  questions.splice(i, 1);
  saveLocal();
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

document.getElementById('time-limit').addEventListener('change', saveLocal);
document.getElementById('q-count').addEventListener('change', saveLocal);

// ========== Supabase ヘルパ ==========
// テーブル設計:
// quiz_state (id=1 固定の単一行)
//   - state: text ('waiting'|'question'|'answer'|'finished')
//   - current_idx: int
//   - questions: jsonb (問題リスト)
//   - time_limit: int
//   - question_started_at: bigint (ミリ秒)
//   - updated_at: timestamp
// players (id=client uuid)
//   - id: text
//   - name: text
//   - score: int
//   - joined_at: timestamp
// answers
//   - id: bigserial
//   - q_idx: int
//   - player_id: text
//   - choice: int
//   - elapsed_ms: int
//   - name: text

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
  if (qCount < 1) { alert('問題を1つ以上追加してください'); return; }
  if (qCount > questions.length) {
    if (!confirm(`出題数(${qCount})が問題数(${questions.length})より多いです。${questions.length}問で開始しますか?`)) return;
  }
  const useQs = questions.slice(0, qCount);
  const timeLimit = parseInt(document.getElementById('time-limit').value);

  // 既存の回答とプレイヤースコアをリセット(参加者は維持)
  await sb.from('answers').delete().neq('id', 0);
  await sb.from('players').update({ score: 0 }).neq('id', '');

  await upsertQuiz({
    state: 'waiting',
    current_idx: -1,
    questions: useQs,
    time_limit: timeLimit,
    question_started_at: 0
  });

  document.querySelector('[data-tab="live"]').click();
  alert('クイズを開始しました!参加者が揃ったら「次へ」ボタンで第1問を出題します。');
}

window.resetQuiz = async function() {
  if (!sbReady) return;
  if (!confirm('参加者リストと回答をリセットします。よろしいですか?')) return;
  await sb.from('answers').delete().neq('id', 0);
  await sb.from('players').delete().neq('id', '');
  alert('リセットしました');
}

window.endQuiz = async function() {
  if (!confirm('クイズを終了して結果発表に進みますか?')) return;
  await upsertQuiz({ state: 'finished' });
}

// ========== ライブ進行 ==========
window.nextStep = async function() {
  const quiz = await getQuiz();
  if (!quiz) { alert('クイズが開始されていません'); return; }

  const state = quiz.state;
  const idx = quiz.current_idx;
  const total = (quiz.questions || []).length;

  if (state === 'waiting') {
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
    alert('クイズは既に終了しています。新しいクイズを始めるには「クイズ開始」を押してください。');
  }
}

let liveWatchStarted = false;
let currentLiveQuiz = null;
function startLiveWatch() {
  if (liveWatchStarted || !sbReady) return;
  liveWatchStarted = true;

  // 初回ロード
  refreshLive();

  // リアルタイム購読
  sb.channel('admin-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_state' }, () => refreshLive())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => refreshPlayers())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => refreshAnswers())
    .subscribe();
}

async function refreshLive() {
  const quiz = await getQuiz();
  currentLiveQuiz = quiz;
  if (!quiz) return;

  const stateMap = { waiting: '⏳ 待機', question: '🎯 出題中', answer: '✨ 解答発表', finished: '🏁 終了' };
  document.getElementById('stat-state').textContent = stateMap[quiz.state] || '-';
  document.getElementById('stat-current').textContent = quiz.current_idx >= 0 ? (quiz.current_idx + 1) + '/' + (quiz.questions || []).length : '-';

  const status = document.getElementById('live-status');
  status.classList.toggle('live', quiz.state === 'question');
  status.innerHTML = '<span class="dot"></span>' + (stateMap[quiz.state] || '');

  const btn = document.getElementById('btn-next');
  if (quiz.state === 'waiting') btn.textContent = '▶ 第1問を開始';
  else if (quiz.state === 'question') btn.textContent = '✨ 解答を発表';
  else if (quiz.state === 'answer') {
    btn.textContent = (quiz.current_idx + 1 >= (quiz.questions || []).length) ? '🏁 結果発表' : '▶ 次の問題へ';
  } else btn.textContent = '✓ 終了';

  refreshAnswers();
}

async function refreshPlayers() {
  const { data, error } = await sb.from('players').select('*').order('score', { ascending: false });
  if (error) { console.error(error); return; }
  document.getElementById('stat-players').textContent = (data || []).length;
  renderRanking(data || []);
}

async function refreshAnswers() {
  if (!currentLiveQuiz) return;
  const idx = currentLiveQuiz.current_idx;
  if (idx < 0) {
    document.getElementById('stat-answered').textContent = 0;
    return;
  }
  const { data, error } = await sb.from('answers').select('id').eq('q_idx', idx);
  if (error) { console.error(error); return; }
  document.getElementById('stat-answered').textContent = (data || []).length;
}

function renderRanking(players) {
  const arr = players.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const el = document.getElementById('live-ranking');
  if (arr.length === 0) {
    el.innerHTML = '<div style="text-align:center; padding:20px; color:#999; font-size:13px;">参加者を待っています...</div>';
    return;
  }
  el.innerHTML = arr.map((p, i) => {
    const crown = i < 5 ? ['👑','🥈','🥉','🏅','🏅'][i] : '';
    return `<div class="rank-item ${i < 5 ? 'top' : ''}">
      <div class="rank-pos">${crown || (i + 1)}</div>
      <div class="rank-name">${escapeHtml(p.name || '?')}</div>
      <div class="rank-score">${p.score || 0}</div>
    </div>`;
  }).join('');
}

// ========== QRコード ==========
function renderQRCode() {
  const url = location.href.replace(/\/[^\/]*$/, '/play.html').replace(/index\.html$/, 'play.html');
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
});
