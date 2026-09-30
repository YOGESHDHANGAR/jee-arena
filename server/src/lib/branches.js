import { syllabusChapter, syllabusIdFor } from './syllabus.js';

/**
 * Chemistry is taught (and revised) as three branches: Physical, Organic and Inorganic.
 * Questions only carry a raw chapter name, so the branch comes from the standard chapter it maps
 * to in lib/syllabus.js ("P-Block Halogen" -> p-Block Elements -> Inorganic). One map, so the
 * Problems filter and the test builder always agree.
 */
export const CHEM_BRANCHES = ['physical', 'organic', 'inorganic'];

const UNIT_BRANCH = { 'Physical Chemistry': 'physical', 'Organic Chemistry': 'organic', 'Inorganic Chemistry': 'inorganic' };

/** 'physical' | 'organic' | 'inorganic' for a chemistry chapter name, or null when it can't be told. */
export function chemBranch(chapter) {
  const ch = syllabusChapter('chemistry', syllabusIdFor('chemistry', chapter));
  return ch ? UNIT_BRANCH[ch.unit] : null;
}
