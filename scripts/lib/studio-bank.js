/**
 * Maps one row of JEE Video Studio's question bank (bank/jee-bank.db, table `questions`)
 * to a JEE Arena question. Pure function — no I/O — so it's easy to test.
 *
 * Studio row: { id, num, subject, chapter, topic, difficulty, exam, year, type, format, data(JSON), tags }
 * data (RawQuestion): { question, options[], answer, solution?, image?, solutionImage?, type?, source?,
 *                       format?, passage?, lists?: { left[], right[], leftTitle?, rightTitle?, style? } }
 */
import { answerToKeys, parseNumeric } from './normalize.js';

/** Tags in Studio that say where a question came from, most specific first. */
export const SOURCE_TAGS = ['pw-dataset', 'eqourse', 'ai-import', 'doubtnut', 'hf-answer'];

/** Tags that mean "don't publish until someone checks it". */
const REVIEW_TAGS = ['needs-answer', 'check-figure', 'check-math'];

const SUBJECTS = { maths: 'maths', mathematics: 'maths', math: 'maths', physics: 'physics', chemistry: 'chemistry' };

const LIST_LABELS = {
  'PQRS-1234': { left: ['P', 'Q', 'R', 'S', 'T', 'U'], right: ['1', '2', '3', '4', '5', '6'] },
  'ABCD-roman': { left: ['A', 'B', 'C', 'D', 'E', 'F'], right: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
};

const imageMd = (img, mediaBase) => {
  if (!img) return '';
  const src = /^(https?:|data:)/.test(img) ? img : `${mediaBase}/${encodeURIComponent(img)}`;
  return `\n\n![](${src})`;
};

/** List-I / List-II as an HTML table (rendered by the web app, LaTeX inside cells still works). */
function listsHtml(lists, options = []) {
  if (!lists?.left?.length) return '';
  // Trust the options' own labelling ("A-III, B-IV…" vs "P-2, Q-4…") over the stored style.
  const opts = options.join(' ');
  const style = /\b[A-F]\s*[-→]\s*[IVX]+\b/.test(opts) ? 'ABCD-roman' : /\b[P-U]\s*[-→]\s*\d\b/.test(opts) ? 'PQRS-1234' : lists.style;
  const labels = LIST_LABELS[style] || LIST_LABELS['ABCD-roman'];
  const rows = Math.max(lists.left.length, lists.right?.length || 0);
  const esc = (s) => String(s ?? '').replace(/</g, '&lt;');
  let html = `\n\n<table class="match"><thead><tr><th colspan="2">${esc(lists.leftTitle || 'List-I')}</th><th colspan="2">${esc(lists.rightTitle || 'List-II')}</th></tr></thead><tbody>`;
  for (let i = 0; i < rows; i++) {
    const l = lists.left[i];
    const r = lists.right?.[i];
    html += `<tr><td>${l !== undefined ? labels.left[i] : ''}</td><td>${esc(l)}</td><td>${r !== undefined ? labels.right[i] : ''}</td><td>${esc(r)}</td></tr>`;
  }
  return `${html}</tbody></table>`;
}

/** "JEE Main 2024 · 27 Jan · Shift 1 · Physics · Q3" -> "27 Jan · Shift 1" */
function shiftFrom(source, year) {
  if (!source) return undefined;
  const parts = String(source).split('·').map((s) => s.trim());
  const keep = parts.filter((p) => /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|shift/i.test(p) && !p.includes(String(year)));
  return keep.length ? keep.join(' · ') : undefined;
}

/**
 * Returns { ok: true, question, images: [fileNames] } or { ok: false, reason }.
 */
export function mapStudioRow(row, { mediaBase = '/media' } = {}) {
  let d;
  try {
    d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {};
  } catch {
    return { ok: false, reason: 'bad JSON' };
  }
  const tags = Array.isArray(row.tags) ? row.tags : String(row.tags || '').split('\u001f').filter(Boolean);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  const subject = SUBJECTS[String(row.subject || '').toLowerCase()];
  if (!subject) return { ok: false, reason: 'not physics/chemistry/maths' };
  if (tagSet.has('proof')) return { ok: false, reason: 'proof question (cannot be auto-checked)' };
  const question = String(d.question || '').trim();
  if (!question) return { ok: false, reason: 'no question text' };

  const cls = tagSet.has('class 11') ? 11 : tagSet.has('class 12') ? 12 : null;

  // Type & answer
  const options = (d.options || []).filter((o) => o !== null && o !== undefined && String(o).trim() !== '');
  const rawType = row.type || d.type;
  let type;
  let answer = null;
  if (options.length >= 2) {
    const keys = answerToKeys(d.answer, options.length);
    type = rawType === 'multiple' || keys.length > 1 ? 'multi' : 'single';
    if (keys.length) answer = { keys };
  } else {
    type = 'numerical';
    const n = parseNumeric(d.answer);
    if (n) answer = n;
  }

  // Text: passage, question, match lists, figure
  const images = [];
  if (d.image && !/^(https?:|data:)/.test(d.image)) images.push(d.image);
  if (d.solutionImage && !/^(https?:|data:)/.test(d.solutionImage)) images.push(d.solutionImage);
  // Studio's inline picture tags: {{img:file.png}} / {{img:https://…|6}} — copy local ones too.
  for (const s of [d.question, d.solution, d.passage, ...(d.options || [])]) {
    for (const m of String(s ?? '').matchAll(/\{\{img:([^|}]+?)(?:\|[\d.]+)?\}\}/g)) {
      const src = m[1].trim();
      if (!/^(https?:|data:)/.test(src)) images.push(src.replace(/^\/?(public\/)?(images\/)?/, ''));
    }
  }
  let text = '';
  if (d.passage) text += `${String(d.passage).trim()}\n\n---\n\n`;
  // Some sources already typeset the lists inside the question (LaTeX array / HTML table) — don't show them twice.
  const hasTable = /\\begin\{(array|tabular)\}|<table/i.test(question);
  text += question + (hasTable ? '' : listsHtml(d.lists, options)) + imageMd(d.image, mediaBase);
  const solution = (String(d.solution || '').trim() + imageMd(d.solutionImage, mediaBase)).trim();

  const sourceName = SOURCE_TAGS.find((t) => tagSet.has(t)) || 'studio';
  const year = Number(row.year) || null;
  const exam = row.exam || (tagSet.has('jee-advanced') ? 'JEE Advanced' : tagSet.has('jee-main') ? 'JEE Main' : null);
  const needsReview = REVIEW_TAGS.some((t) => tagSet.has(t));

  const chapter = String(row.chapter || '').trim();
  return {
    ok: true,
    images,
    question: {
      subject,
      chapter: chapter && chapter.toLowerCase() !== 'question bank' ? chapter : 'Mixed',
      topic: row.topic ? String(row.topic).trim() : undefined,
      difficulty: ['easy', 'medium', 'hard'].includes(row.difficulty) ? row.difficulty : 'medium',
      type,
      text,
      options: type === 'numerical' ? [] : options.map((t, i) => ({ key: 'ABCDEFGH'[i], text: String(t) })),
      answer,
      solution,
      class: cls,
      pyq: year ? { exam: exam || 'JEE', year, shift: shiftFrom(d.source, year) } : undefined,
      format: d.format || row.format || 'normal',
      tags: tags.filter((t) => !SOURCE_TAGS.includes(t.toLowerCase())),
      source: { name: sourceName, id: String(row.id), num: row.num, label: d.source || undefined },
      status: answer && !needsReview ? 'published' : 'draft',
    },
  };
}
