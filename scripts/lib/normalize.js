/**
 * Turns a question document from JEE Studio's scraped bank (any reasonable shape)
 * into a JEE Arena question. Edit FIELD_NAMES if your source uses different keys —
 * run `npm run import:inspect` to see what keys your documents actually have.
 */

// First matching key wins. Dotted paths are allowed ("meta.subject").
export const FIELD_NAMES = {
  text: ['question', 'questionText', 'question_text', 'text', 'body', 'content', 'stem', 'problem'],
  options: ['options', 'choices', 'answers_options', 'optionList', 'option'],
  answer: ['answer', 'correctAnswer', 'correct_answer', 'correct', 'correctOption', 'correct_option', 'key', 'answerKey'],
  solution: ['solution', 'explanation', 'solutionText', 'solution_text', 'answerExplanation', 'hint'],
  subject: ['subject', 'subjectName', 'meta.subject'],
  chapter: ['chapter', 'chapterName', 'chapter_name', 'topic', 'meta.chapter'],
  topic: ['subtopic', 'subTopic', 'sub_topic', 'topicName', 'concept', 'meta.topic'],
  difficulty: ['difficulty', 'level', 'difficultyLevel'],
  type: ['type', 'questionType', 'question_type', 'qtype', 'format'],
  className: ['class', 'className', 'grade', 'standard', 'std'],
  source: ['source', 'dataSource', 'data_source', 'sourceName', 'origin', 'provider', 'site'],
  sourceId: ['sourceId', 'source_id', 'externalId', 'external_id', 'originalId'],
  exam: ['exam', 'examName', 'paper'],
  year: ['year', 'examYear', 'pyqYear'],
  shift: ['shift', 'session', 'date'],
};

export const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);

export function pick(doc, field) {
  for (const k of FIELD_NAMES[field]) {
    const v = get(doc, k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const KEYS = 'ABCDEFGH';

export function normSubject(v) {
  const s = String(v || '').toLowerCase();
  if (/phy/.test(s)) return 'physics';
  if (/chem/.test(s)) return 'chemistry';
  if (/math/.test(s)) return 'maths';
  return null;
}

export function normDifficulty(v) {
  const s = String(v ?? '').toLowerCase();
  if (/easy|low|^1$|beginner/.test(s)) return 'easy';
  if (/hard|high|difficult|^[345]$|advanced|tough/.test(s)) return 'hard';
  return 'medium';
}

export function normClass(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? Number(m[0]) : null; // null = unknown class, kept; anything but 11/12 is skipped
}

const toText = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return String(v.text ?? v.value ?? v.content ?? v.option ?? v.label ?? v.html ?? JSON.stringify(v));
};

/** Options as [{ key, text }] plus any keys flagged correct inside the options themselves. */
export function normOptions(raw) {
  if (!raw) return { options: [], flagged: [] };
  let list = raw;
  if (!Array.isArray(raw) && typeof raw === 'object') {
    // { A: '...', B: '...' } or { a: '...', ... } or { option1: ... }
    list = Object.entries(raw).map(([k, v]) => ({ _k: k, ...(typeof v === 'object' ? v : { text: v }) }));
  }
  const options = [];
  const flagged = [];
  list.forEach((o, i) => {
    let key = KEYS[i];
    if (o && typeof o === 'object') {
      const k = String(o.key ?? o.label ?? o.identifier ?? o._k ?? '').trim().replace(/[()]/g, '').toUpperCase();
      if (/^[A-H]$/.test(k)) key = k;
      else if (/^[1-8]$/.test(k)) key = KEYS[Number(k) - 1];
      if (o.isCorrect === true || o.correct === true || o.is_correct === true) flagged.push(key);
    }
    let text = toText(o).trim();
    text = text.replace(/^\(?[A-Da-d1-4][).:]\s+/, ''); // strip leading "(a) " / "A. " labels
    options.push({ key, text });
  });
  return { options, flagged };
}

/** Maps any answer spelling to keys: 'B', '(b)', 'option 2', 2, [1,3], 'A,C', 'AC' ... */
export function answerToKeys(raw, optionCount) {
  if (raw == null || raw === '') return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of arr) {
    if (typeof item === 'number') {
      // 1-based index is by far the most common; treat 0 as index 0.
      const idx = item === 0 ? 0 : item - 1;
      if (idx >= 0 && idx < Math.max(optionCount, 4)) out.push(KEYS[idx]);
      continue;
    }
    const s = String(item).trim();
    const opt = s.match(/^option\s*([1-8a-h])$/i);
    if (opt) {
      const c = opt[1].toUpperCase();
      out.push(/\d/.test(c) ? KEYS[Number(c) - 1] : c);
      continue;
    }
    const parts = s.replace(/[()[\]\s]/g, '').toUpperCase().split(/[,;&/|]|AND/).filter(Boolean);
    for (const p of parts) {
      if (/^[A-H]+$/.test(p) && p.length <= optionCount) out.push(...p.split(''));
      else if (/^[1-8]$/.test(p) && optionCount >= Number(p)) out.push(KEYS[Number(p) - 1]);
    }
  }
  return [...new Set(out)].sort();
}

export function parseNumeric(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return { value: raw };
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
  const range = s.match(/^(-?\d*\.?\d+)\s*(?:to|-|–|,)\s*(-?\d*\.?\d+)$/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const n = Number(s.replace(/[^\d.eE+-]/g, ''));
  return s && Number.isFinite(n) ? { value: n } : null;
}

/**
 * Returns { ok: true, question } or { ok: false, reason }.
 * question.status is 'published' only when it has a usable answer; otherwise 'draft'.
 */
export function normalize(doc, { defaultSource = 'jee-studio' } = {}) {
  const text = toText(pick(doc, 'text')).trim();
  if (!text) return { ok: false, reason: 'no question text' };

  const subject = normSubject(pick(doc, 'subject'));
  if (!subject) return { ok: false, reason: 'not physics/chemistry/maths' };

  const cls = normClass(pick(doc, 'className'));
  if (cls !== null && cls !== 11 && cls !== 12) return { ok: false, reason: 'not class 11/12' };

  const { options, flagged } = normOptions(pick(doc, 'options'));
  const rawAnswer = pick(doc, 'answer');
  const rawType = String(pick(doc, 'type') || '').toLowerCase();

  let type;
  let answer = null;
  if (options.length >= 2) {
    const keys = flagged.length ? [...new Set(flagged)].sort() : answerToKeys(rawAnswer, options.length);
    type = /multi|more than one|multiple correct|mcq-?m/.test(rawType) || keys.length > 1 ? 'multi' : 'single';
    if (keys.length) answer = { keys };
  } else {
    type = 'numerical';
    const n = parseNumeric(rawAnswer);
    if (n) answer = n;
  }

  const sourceName = String(pick(doc, 'source') || defaultSource).trim();
  const year = Number(String(pick(doc, 'year') ?? '').match(/(19|20)\d{2}/)?.[0]) || null;
  const exam = pick(doc, 'exam');

  return {
    ok: true,
    question: {
      subject,
      chapter: String(pick(doc, 'chapter') || 'General').trim(),
      topic: pick(doc, 'topic') ? String(pick(doc, 'topic')).trim() : undefined,
      difficulty: normDifficulty(pick(doc, 'difficulty')),
      type,
      text,
      options: type === 'numerical' ? [] : options,
      answer,
      solution: toText(pick(doc, 'solution')).trim(),
      class: cls,
      pyq: year ? { exam: exam ? String(exam) : 'JEE', year, shift: pick(doc, 'shift') ? String(pick(doc, 'shift')) : undefined } : undefined,
      source: { name: sourceName, id: String(pick(doc, 'sourceId') ?? doc._id) },
      status: answer ? 'published' : 'draft',
    },
  };
}
