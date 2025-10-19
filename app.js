// Flashcards Hán Việt - client-only

const els = {
  fileInput: document.getElementById('fileInput'),
  loadDefaultBtn: document.getElementById('loadDefaultBtn'),
  tableSelect: document.getElementById('tableSelect'),
  modeSelect: document.getElementById('modeSelect'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  card: document.getElementById('card'),
  front: document.getElementById('cardFront'),
  back: document.getElementById('cardBack'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  flipBtn: document.getElementById('flipBtn'),
  wrongBtn: document.getElementById('wrongBtn'),
  correctBtn: document.getElementById('correctBtn'),
  totalCount: document.getElementById('totalCount'),
  seenCount: document.getElementById('seenCount'),
  correctCount: document.getElementById('correctCount'),
  wrongCount: document.getElementById('wrongCount'),
  accuracy: document.getElementById('accuracy'),
  progressText: document.getElementById('progressText'),
};

let rawTables = {}; // { Table_1: string[][], Table_2: string[][] }
let deck = []; // normalized items for current mode
let idx = 0;
let stats = { seen: 0, correct: 0, wrong: 0 };

// Utilities
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function percent(a, b) {
  if (!b) return '0%';
  return Math.round((a / b) * 100) + '%';
}
function sanitize(x) { return (x ?? '').toString().trim(); }

// Parsing helpers for provided JSON shape
const HEADERS = ['#','Kanji','Hán Việt','On - yomi','Kun - yomi','Ý nghĩa','Ví dụ'];
const LESSON_T1_HEADERS = ['ことば','漢字','ベトナム語'];
function tableRowsToObjects(table) {
  if (!Array.isArray(table) || table.length === 0) return [];
  const header = table[0].map(sanitize);
  // Best-effort map index by expected header
  const col = {
    idx: header.findIndex(h => h === '#'),
    kanji: header.findIndex(h => h === 'Kanji'),
    hanviet: header.findIndex(h => h === 'Hán Việt'),
    onyomi: header.findIndex(h => h === 'On - yomi'),
    kunyomi: header.findIndex(h => h === 'Kun - yomi'),
    meaning: header.findIndex(h => h === 'Ý nghĩa'),
    examples: header.findIndex(h => h === 'Ví dụ'),
  };
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i] || [];
    rows.push({
      id: sanitize(r[col.idx]),
      kanji: sanitize(r[col.kanji]),
      hanviet: sanitize(r[col.hanviet]),
      onyomi: sanitize(r[col.onyomi]),
      kunyomi: sanitize(r[col.kunyomi]),
      meaning: sanitize(r[col.meaning]),
      examples: sanitize(r[col.examples]),
    });
  }
  return rows;
}

// Detect lesson JSON Table_1 header [ことば, 漢字, ベトナム語]
function isLessonTable1(table) {
  if (!Array.isArray(table) || table.length === 0) return false;
  const header = (table[0] || []).map(sanitize);
  return header.length >= 3 && header[0] === LESSON_T1_HEADERS[0] && header[1] === LESSON_T1_HEADERS[1] && header[2] === LESSON_T1_HEADERS[2];
}

function parseLessonTable1(table) {
  if (!isLessonTable1(table)) return [];
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i] || [];
    rows.push({
      word: sanitize(r[0]),
      kanji: sanitize(r[1]),
      vi: sanitize(r[2]),
    });
  }
  return rows;
}

function normalizeOnKun(s) {
  if (!s || s === 'X') return [];
  const parts = s.split('\n').map(t => t.trim()).filter(Boolean);
  const out = new Set();
  for (let p of parts) {
    let pc = p.replace(/^\*/, '').trim();
    // Expand variants inside Japanese parentheses e.g. あらわ（あらわ.す、あらわ.れる）
    const open = pc.indexOf('（');
    const close = pc.indexOf('）');
    if (open !== -1 && close !== -1 && close > open) {
      const base = pc.slice(0, open).trim();
      const inside = pc.slice(open + 1, close).trim();
      const variants = inside.split(/[、，,]/).map(v => v.trim()).filter(Boolean);
      for (let v of variants) {
        // remove dots used to indicate okurigana boundaries
        const full = v.replaceAll('.', '');
        if (full) out.add(full);
      }
      if (base) out.add(base);
    } else {
      out.add(pc);
    }
  }
  return Array.from(out);
}

function parseExamples(s) {
  if (!s) return [];
  const lines = s.split('\n').map(t => t.trim()).filter(Boolean);
  const out = [];

  function parseSegment(seg) {
    let line = seg.trim();
    // Remove leading bullets/index markers and stray stars
    line = line.replace(/^\d+\.?\s*/, '').replace(/^[①②③④⑤⑥⑦⑧⑨]\s*/, '').replace(/^\*/,'').trim();
    const sep = line.indexOf('：'); // full-width colon
    if (sep !== -1) {
      const jpWord = line.slice(0, sep).trim();
      let rest = line.slice(sep + 1).trim();
      // Fix extra closing parens like ...))
      rest = rest.replace(/\)+$/g, m => m.length > 1 ? ')' : m);
      // Vietnamese gloss at the end in parentheses
      const lastOpen = rest.lastIndexOf('(');
      const lastClose = rest.lastIndexOf(')');
      if (lastOpen !== -1 && lastClose !== -1 && lastClose > lastOpen) {
        const reading = rest.slice(0, lastOpen).trim();
        const vi = rest.slice(lastOpen + 1, lastClose).trim();
        out.push({ jp: jpWord, reading, vi });
      } else {
        out.push({ jp: jpWord, reading: rest, vi: '' });
      }
    } else if (line) {
      out.push({ jp: line, reading: '', vi: '' });
    }
  }

  for (let line of lines) {
    const segments = line.split('／').map(t => t.trim()).filter(Boolean);
    if (segments.length > 1) {
      segments.forEach(parseSegment);
    } else {
      parseSegment(line);
    }
  }
  return out;
}

function normalizeRows(rows) {
  return rows.map((r, i) => {
    const idNum = Number(r.id) || i + 1;
    const starred = /\*/.test(r.onyomi) || /\*/.test(r.kunyomi) || /\*/.test(r.examples);
    return {
      id: idNum,
      kanji: r.kanji,
      hanviet: r.hanviet,
      onyomi: normalizeOnKun(r.onyomi),
      kunyomi: normalizeOnKun(r.kunyomi),
      meaning_vi: r.meaning ? r.meaning.split('\n').map(t=>t.trim()).filter(Boolean) : [],
      examples: parseExamples(r.examples),
      flags: { starred },
    };
  });
}

function buildDeck(mode, selectedTables) {
  let rows = [];
  const addTable = (t) => {
    if (!rawTables[t]) return;
    const tbl = rawTables[t];
    if (mode === 'lesson_table1') {
      const lessonRows = parseLessonTable1(tbl);
      if (lessonRows.length) {
        rows.push(...lessonRows.map((lr, i) => ({
          id: i + 1,
          lesson_word: lr.word,
          lesson_kanji: lr.kanji,
          lesson_vi: lr.vi,
        })));
      }
    } else {
      // words/examples modes expect classic kanji sheet
      const objs = tableRowsToObjects(tbl);
      if (objs.length) rows.push(...normalizeRows(objs));
    }
  };
  if (selectedTables === 'all') {
    Object.keys(rawTables).forEach(addTable);
  } else {
    addTable(selectedTables);
  }

  if (mode === 'words') {
    // Each card = kanji side, back shows readings, meaning, examples
    return rows.map(item => ({ type: 'word', item }));
  } else if (mode === 'lesson_table1') {
    // Each card from lesson Table_1
    const lessonItems = rows.filter(r => 'lesson_word' in r);
    const rev = (typeof document !== 'undefined' && document.getElementById('lessonReverse')) ? document.getElementById('lessonReverse').checked : false;
    const out = [];
    for (const item of lessonItems) {
      const hasKana = !!(item.lesson_word && item.lesson_word.length);
      const hasKanji = !!(item.lesson_kanji && item.lesson_kanji.length);
      if (rev) {
        if (hasKana) out.push({ type: 'lesson_word_rev_kana', item });
        if (hasKanji) out.push({ type: 'lesson_word_rev_kanji', item });
        if (!hasKana && !hasKanji) out.push({ type: 'lesson_word_rev_kana', item });
      } else {
        if (hasKana) out.push({ type: 'lesson_word_kana', item });
        if (hasKanji) out.push({ type: 'lesson_word_kanji', item });
        if (!hasKana && !hasKanji) out.push({ type: 'lesson_word_kana', item });
      }
    }
    return out;
  } else {
    // examples mode: flatten examples; each example card points to its parent kanji
    const out = [];
    for (const item of rows) {
      if (!item.examples || !item.examples.length) continue;
      for (const ex of item.examples) {
        out.push({ type: 'example', item, ex });
      }
    }
    return out;
  }
}

// Rendering
function renderCard() {
  if (!deck.length) {
    els.front.innerHTML = '<div class="subtitle">Chưa có dữ liệu</div>';
    els.back.innerHTML = '';
    els.totalCount.textContent = '0';
    els.progressText.textContent = '0 / 0';
    return;
  }
  const d = deck[idx];
  els.card.classList.remove('flipped');
  if (d.type === 'word') {
    els.front.innerHTML = `
      <div class="title">${escapeHtml(d.item.kanji)}</div>
    `;
    const onyomi = d.item.onyomi.join('・') || '—';
    const kunyomi = d.item.kunyomi.join('・') || '—';
    const meaning = d.item.meaning_vi.join('; ') || '—';
    const examples = d.item.examples.map(e => `• ${escapeHtml(e.jp)}：${escapeHtml(e.reading)} (${escapeHtml(e.vi)})`).join('<br/>') || '—';
    els.back.innerHTML = `
      <div class="section"><span class="label">Hán Việt</span>${escapeHtml(d.item.hanviet)}</div>
      <div class="section"><span class="label">On-yomi</span>${escapeHtml(onyomi)}</div>
      <div class="section"><span class="label">Kun-yomi</span>${escapeHtml(kunyomi)}</div>
      <div class="section"><span class="label">Ý nghĩa</span>${escapeHtml(meaning)}</div>
      <div class="section"><span class="label">Ví dụ</span><div class="examples">${examples}</div></div>
    `;
  } else if (d.type === 'lesson_word_kana') {
    const title = d.item.lesson_word || d.item.lesson_kanji || '—';
    els.front.innerHTML = `
      <div class="title">${escapeHtml(title)}</div>
    `;
    els.back.innerHTML = `
      <div class="section"><span class="label">Từ vựng (kana)</span>${escapeHtml(d.item.lesson_word || '—')}</div>
      <div class="section"><span class="label">Kanji</span>${escapeHtml(d.item.lesson_kanji || '—')}</div>
      <div class="section"><span class="label">Nghĩa (VI)</span>${escapeHtml(d.item.lesson_vi || '—')}</div>
    `;
  } else if (d.type === 'lesson_word_kanji') {
    const title = d.item.lesson_kanji || d.item.lesson_word || '—';
    els.front.innerHTML = `
      <div class="title">${escapeHtml(title)}</div>
    `;
    els.back.innerHTML = `
      <div class="section"><span class="label">Từ vựng (kana)</span>${escapeHtml(d.item.lesson_word || '—')}</div>
      <div class="section"><span class="label">Kanji</span>${escapeHtml(d.item.lesson_kanji || '—')}</div>
      <div class="section"><span class="label">Nghĩa (VI)</span>${escapeHtml(d.item.lesson_vi || '—')}</div>
    `;
  } else if (d.type === 'lesson_word_rev_kana') {
    const vi = d.item.lesson_vi || '—';
    els.front.innerHTML = `
      <div class="title">${escapeHtml(vi)}</div>
    `;
    els.back.innerHTML = `
      <div class="section"><span class="label">Từ vựng (kana)</span>${escapeHtml(d.item.lesson_word || '—')}</div>
    `;
  } else if (d.type === 'lesson_word_rev_kanji') {
    const vi = d.item.lesson_vi || '—';
    els.front.innerHTML = `
      <div class="title">${escapeHtml(vi)}</div>
    `;
    els.back.innerHTML = `
      <div class="section"><span class="label">Kanji</span>${escapeHtml(d.item.lesson_kanji || '—')}</div>
    `;
  } else {
    // example
    els.front.innerHTML = `
      <div class="title">${escapeHtml(d.ex.jp)}</div>
      <div class="subtitle">${escapeHtml(d.item.kanji)} ・ ${escapeHtml(d.item.hanviet)}</div>
    `;
    const reading = d.ex.reading || '—';
    const meaning = d.ex.vi || '—';
    els.back.innerHTML = `
      <div class="section"><span class="label">Cách đọc</span>${escapeHtml(reading)}</div>
      <div class="section"><span class="label">Nghĩa</span>${escapeHtml(meaning)}</div>
      <div class="section"><span class="label">Kanji</span>${escapeHtml(d.item.kanji)} / ${escapeHtml(d.item.hanviet)}</div>
    `;
  }
  els.totalCount.textContent = String(deck.length);
  els.progressText.textContent = `${idx + 1} / ${deck.length}`;
  els.seenCount.textContent = String(stats.seen);
  els.correctCount.textContent = String(stats.correct);
  els.wrongCount.textContent = String(stats.wrong);
  els.accuracy.textContent = percent(stats.correct, stats.correct + stats.wrong);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function applyBuild() {
  deck = buildDeck(els.modeSelect.value, els.tableSelect.value);
  idx = 0;
  stats = { seen: 0, correct: 0, wrong: 0 };
  renderCard();
}

// Data loading
async function loadFromFile(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  rawTables = json;
  // If this looks like a lesson JSON (Table_1 header matches), prefer lesson mode automatically
  try {
    if (rawTables && Array.isArray(rawTables.Table_1) && isLessonTable1(rawTables.Table_1)) {
      els.modeSelect.value = 'lesson_table1';
      els.tableSelect.value = 'Table_1';
    }
  } catch {}
  applyBuild();
}

async function loadDefault() {
  // Try to fetch from repo root
  try {
    const res = await fetch('../vocab_export.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    rawTables = json;
    applyBuild();
  } catch (e) {
    alert('Không đọc được vocab_export.json mặc định. Hãy chọn file JSON thủ công.');
    console.error(e);
  }
}

// Controls
els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) loadFromFile(file);
});
// Dedicated loader for lesson vocab (Table_1)
const fileInputLesson = document.getElementById('fileInputLesson');
if (fileInputLesson) {
  fileInputLesson.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const json = JSON.parse(text);
    rawTables = json;
    // Force lesson_table1 mode for convenience
    els.modeSelect.value = 'lesson_table1';
    // Prefer Table_1 for this flow
    els.tableSelect.value = 'Table_1';
    applyBuild();
  });
}
els.loadDefaultBtn.addEventListener('click', loadDefault);
els.tableSelect.addEventListener('change', applyBuild);
els.modeSelect.addEventListener('change', applyBuild);
const lessonReverseEl = document.getElementById('lessonReverse');
if (lessonReverseEl) {
  lessonReverseEl.addEventListener('change', () => {
    if (els.modeSelect.value === 'lesson_table1') {
      applyBuild();
    }
  });
}
els.shuffleBtn.addEventListener('click', () => {
  shuffle(deck);
  idx = 0;
  renderCard();
});
els.prevBtn.addEventListener('click', () => {
  if (!deck.length) return;
  idx = (idx - 1 + deck.length) % deck.length;
  renderCard();
});
els.nextBtn.addEventListener('click', () => {
  if (!deck.length) return;
  idx = (idx + 1) % deck.length;
  renderCard();
});
els.flipBtn.addEventListener('click', () => {
  els.card.classList.toggle('flipped');
});
els.correctBtn.addEventListener('click', () => {
  stats.seen++; stats.correct++; nextAuto();
});
els.wrongBtn.addEventListener('click', () => {
  stats.seen++; stats.wrong++; nextAuto();
});
function nextAuto(){
  idx = Math.min(idx + 1, deck.length - 1);
  renderCard();
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') els.prevBtn.click();
  else if (e.key === 'ArrowRight') els.nextBtn.click();
  else if (e.key.toLowerCase() === ' ') { e.preventDefault(); els.flipBtn.click(); }
  else if (e.key.toLowerCase() === 's') els.shuffleBtn.click();
  else if (e.key.toLowerCase() === 'd') els.correctBtn.click();
  else if (e.key.toLowerCase() === 'a') els.wrongBtn.click();
});

// Initialize empty state
renderCard();
