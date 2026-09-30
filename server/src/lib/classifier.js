/**
 * Guesses a question's standard chapter from its text, for the ~45,000 imported questions whose
 * source gave no usable chapter ("null", "Question Bank"). A naive Bayes model per subject, trained on
 * the questions whose chapter IS known — no outside service, runs in a few seconds.
 *
 * Words matter more than you'd think for JEE questions: "projectile", "entropy", "∫", "\vec",
 * "ellipse", "IUPAC" all point strongly at one chapter. LaTeX commands are kept as words
 * (\int -> "int", \vec -> "vec"), and neighbouring word pairs are added ("rate constant").
 *
 * Used by scripts/classify-chapters.js. Pure functions, no database.
 */

const STOP = new Set(
  ('the a an of to in is and or for be by on with as at if its it this that which from are was were then than '
    + 'find value given let what when where show prove following correct statement statements option options '
    + 'will has have can may equal equals number point points shown figure above below respectively '
    + 'left right frac text mathrm displaystyle quad cdot times mathbf rm dfrac tfrac limits '
    + 'img mol alt src png jpg jpeg svg width height style').split(/\s+/),
);

/** Words (and word pairs) of a question: text plus option texts. */
export function tokens(text = '') {
  const s = String(text)
    .toLowerCase()
    .replace(/\{\{(img|mol):[^}]*\}\}|!\[[^\]]*\]\([^)]*\)|<img[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\([a-z]+)/g, ' $1 ') // \int -> int
    .replace(/[∫∑∏√π∞θαβγδλμσωφΔ∠→⇌]/g, (c) => ` sym${c.codePointAt(0)} `)
    .replace(/[^a-z0-9ऀ-ॿ\s]+/g, ' ');
  const words = s.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
  const out = words.slice();
  for (let i = 1; i < words.length; i++) out.push(`${words[i - 1]}_${words[i]}`);
  return out;
}

/**
 * docs: [{ text, label }] -> model. `minDf`: ignore words seen in fewer documents (typos, numbers).
 * Word counts are taken once per document (binary), which works better than raw counts for short texts.
 */
export function train(docs, { alpha = 0.3, minDf = 3 } = {}) {
  const classes = [...new Set(docs.map((d) => d.label))].sort();
  const ci = new Map(classes.map((c, i) => [c, i]));
  const df = new Map();
  const toks = docs.map((d) => [...new Set(tokens(d.text))]);
  for (const t of toks) for (const w of t) df.set(w, (df.get(w) || 0) + 1);
  const vocab = new Map();
  for (const [w, n] of df) if (n >= minDf) vocab.set(w, vocab.size);

  const K = classes.length;
  const V = vocab.size;
  const counts = new Float64Array(V * K);
  const totals = new Float64Array(K);
  const docsPer = new Float64Array(K);
  toks.forEach((t, i) => {
    const k = ci.get(docs[i].label);
    docsPer[k]++;
    for (const w of t) {
      const v = vocab.get(w);
      if (v === undefined) continue;
      counts[v * K + k]++;
      totals[k]++;
    }
  });
  const logProb = new Float32Array(V * K);
  for (let v = 0; v < V; v++) {
    for (let k = 0; k < K; k++) logProb[v * K + k] = Math.log((counts[v * K + k] + alpha) / (totals[k] + alpha * V));
  }
  // Flattened priors: big chapters shouldn't win every close call.
  const logPrior = Float64Array.from(docsPer, (n) => 0.5 * Math.log((n + 1) / (docs.length + K)));
  return { classes, vocab, logProb, logPrior, K };
}

/** Best chapter with a probability-like confidence (0..1), and the runner-up. */
export function predict(model, text) {
  const { classes, vocab, logProb, logPrior, K } = model;
  const score = Float64Array.from(logPrior);
  let used = 0;
  for (const w of new Set(tokens(text))) {
    const v = vocab.get(w);
    if (v === undefined) continue;
    used++;
    for (let k = 0; k < K; k++) score[k] += logProb[v * K + k];
  }
  if (!used) return { label: null, p: 0, words: 0 };
  // Naive Bayes is famously over-confident; soften before turning scores into probabilities.
  const T = Math.max(1, Math.sqrt(used));
  let max = -Infinity;
  for (const x of score) max = Math.max(max, x);
  let sum = 0;
  const e = Array.from(score, (x) => {
    const y = Math.exp((x - max) / T);
    sum += y;
    return y;
  });
  const order = e.map((y, k) => [y / sum, k]).sort((a, b) => b[0] - a[0]);
  return {
    label: classes[order[0][1]],
    p: Math.round(order[0][0] * 1000) / 1000,
    second: order[1] ? classes[order[1][1]] : null,
    words: used,
  };
}

/** Accuracy of the model at each confidence cut-off, on held-out labelled questions. */
export function evaluate(model, docs, cuts = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
  const preds = docs.map((d) => ({ ...predict(model, d.text), truth: d.label }));
  return cuts.map((c) => {
    const kept = preds.filter((p) => p.label && p.p >= c);
    const right = kept.filter((p) => p.label === p.truth).length;
    return { cut: c, coverage: kept.length / docs.length, accuracy: kept.length ? right / kept.length : null };
  });
}
