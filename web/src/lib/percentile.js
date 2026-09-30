/**
 * Rough JEE Main percentile and rank for a full-length mock score (out of 300).
 *
 * Points are the top of each 10-mark band of the JEE Main 2026 marks-vs-percentile-vs-rank table
 * published by Careers360 (engineering.careers360.com/articles/jee-main-marks-vs-percentile),
 * interpolated linearly in between. Real percentiles are per shift and move a few points with how
 * hard the shift was, and a mock is not the real paper — so this is shown as an estimate only.
 * Update ANCHORS each year when the new table comes out.
 */
export const SOURCE = 'JEE Main 2026 marks-vs-percentile table (Careers360)';

// [marks, percentile, rank]
const ANCHORS = [
  [300, 100, 1],
  [291, 99.999, 15],
  [280, 99.99617561, 56],
  [271, 99.99153171, 125],
  [259, 99.97687156, 341],
  [250, 99.95228621, 704],
  [240, 99.91549924, 1246],
  [230, 99.87060821, 1909],
  [220, 99.78191884, 3217],
  [210, 99.69159044, 4549],
  [200, 99.57503767, 6269],
  [190, 99.40858575, 8724],
  [180, 99.17311273, 12197],
  [170, 98.87981861, 16524],
  [160, 98.52824811, 21710],
  [150, 98.09290531, 28132],
  [140, 97.54301298, 36243],
  [130, 96.87838902, 46047],
  [120, 96.0687115, 57991],
  [110, 95.05625037, 72925],
  [100, 93.8020333, 91426],
  [90, 92.21882783, 114780],
  [80, 90.27631202, 143434],
  [70, 87.51810893, 184121],
  [60, 83.89085926, 237626],
  [50, 78.35114254, 319343],
  [40, 69.5797271, 448730],
  [30, 56.09102043, 647703],
  [20, 36.58463962, 935442],
  [10, 18.16647924, 1207129],
  [0, 5.71472799, 1390805],
];

/** { percentile, rank } for a score out of 300, or null. */
export function estimatePercentile(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= 300) return { percentile: 100, rank: 1 };
  if (score <= 0) return { percentile: score < 0 ? Math.max(0, 5.71 + score * 0.3) : 5.71, rank: 1390805 };
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [m1, p1, r1] = ANCHORS[i];
    const [m2, p2, r2] = ANCHORS[i + 1];
    if (score <= m1 && score >= m2) {
      const f = (score - m2) / (m1 - m2);
      return { percentile: p2 + f * (p1 - p2), rank: Math.round(r2 + f * (r1 - r2)) };
    }
  }
  return null;
}

/** Only meaningful for a full JEE Main-pattern paper: 75 questions, +4/−1, out of 300. */
export const isFullJeeMain = (r) => r?.test?.scheme === 'jee_main' && r.maxScore === 300 && r.test.questionCount === 75;

/** "99.57" / "96.1" / "78" — more decimals where they matter. */
export const fmtPercentile = (p) => (p >= 99 ? p.toFixed(2) : p >= 90 ? p.toFixed(1) : p.toFixed(0));

/** Ranks rounded like people say them: 6,300 / 1.2 lakh. */
export function fmtRank(r) {
  if (r < 1000) return String(r);
  if (r < 100000) return (Math.round(r / 100) * 100).toLocaleString('en-IN');
  return `${(r / 100000).toFixed(r < 1000000 ? 2 : 1)} lakh`;
}
