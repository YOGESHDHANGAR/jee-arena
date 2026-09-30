/**
 * The JEE syllabus as students know it: subject -> unit -> chapter (with class 11/12).
 *
 * Imported questions carry whatever chapter name their source used — about 800 spellings across
 * the bank, many of them really topics ("Rain Problem", "Capillary Tube", "Adaibaticproces").
 * `syllabusChapter(subject, rawName)` maps any of them onto one of the ~90 standard chapters below,
 * so tests and filters can offer a clean list. Rules run top to bottom inside a subject and the
 * first match wins, so narrow exceptions sit above the broad keywords.
 *
 * Names that can't be placed (no chapter, "Question Bank", class-6 arithmetic…) map to null:
 * they still appear under "all chapters", just not under a specific one.
 */

/**
 * Bump when chapters or rules change: on the next start the server re-maps every question's
 * stored `chapterId` (lib/chapterIds.js). Manual choices by an admin are never touched.
 */
export const SYLLABUS_VERSION = 1;

// [id (also the URL slug: /physics/kinematics), name, class, unit]
const CHAPTERS = {
  physics: [
    ['units-and-dimensions', 'Units, Dimensions & Errors', 11, 'Mechanics'],
    ['basic-maths-and-vectors', 'Basic Maths & Vectors', 11, 'Mechanics'],
    ['kinematics', 'Kinematics (Motion in 1D & 2D)', 11, 'Mechanics'],
    ['laws-of-motion', 'Laws of Motion & Friction', 11, 'Mechanics'],
    ['circular-motion', 'Circular Motion', 11, 'Mechanics'],
    ['work-energy-and-power', 'Work, Energy & Power', 11, 'Mechanics'],
    ['centre-of-mass-and-collisions', 'Centre of Mass, Momentum & Collisions', 11, 'Mechanics'],
    ['rotational-motion', 'Rotational Motion', 11, 'Mechanics'],
    ['gravitation', 'Gravitation', 11, 'Mechanics'],
    ['properties-of-solids-and-liquids', 'Properties of Solids & Liquids', 11, 'Properties of Matter'],
    ['thermal-properties-of-matter', 'Thermal Properties & Calorimetry', 11, 'Heat & Thermodynamics'],
    ['thermodynamics', 'Thermodynamics', 11, 'Heat & Thermodynamics'],
    ['kinetic-theory-of-gases', 'Kinetic Theory of Gases', 11, 'Heat & Thermodynamics'],
    ['oscillations', 'Oscillations (SHM)', 11, 'Oscillations & Waves'],
    ['waves-and-sound', 'Waves & Sound', 11, 'Oscillations & Waves'],
    ['electrostatics', 'Electrostatics', 12, 'Electricity & Magnetism'],
    ['capacitance', 'Capacitance', 12, 'Electricity & Magnetism'],
    ['current-electricity', 'Current Electricity', 12, 'Electricity & Magnetism'],
    ['magnetic-effects-of-current', 'Magnetic Effects of Current & Magnetism', 12, 'Electricity & Magnetism'],
    ['electromagnetic-induction', 'Electromagnetic Induction', 12, 'Electricity & Magnetism'],
    ['alternating-current', 'Alternating Current', 12, 'Electricity & Magnetism'],
    ['electromagnetic-waves', 'Electromagnetic Waves', 12, 'Electricity & Magnetism'],
    ['ray-optics', 'Ray Optics', 12, 'Optics'],
    ['wave-optics', 'Wave Optics', 12, 'Optics'],
    ['dual-nature-of-matter', 'Dual Nature of Matter & Radiation', 12, 'Modern Physics'],
    ['atoms', 'Atoms', 12, 'Modern Physics'],
    ['nuclei', 'Nuclei', 12, 'Modern Physics'],
    ['semiconductors', 'Semiconductors & Communication', 12, 'Modern Physics'],
  ],
  chemistry: [
    ['mole-concept', 'Some Basic Concepts (Mole Concept)', 11, 'Physical Chemistry'],
    ['structure-of-atom', 'Structure of Atom', 11, 'Physical Chemistry'],
    ['states-of-matter', 'States of Matter (Gases)', 11, 'Physical Chemistry'],
    ['thermodynamics', 'Thermodynamics & Thermochemistry', 11, 'Physical Chemistry'],
    ['equilibrium', 'Chemical & Ionic Equilibrium', 11, 'Physical Chemistry'],
    ['redox-reactions', 'Redox Reactions & Volumetric Analysis', 11, 'Physical Chemistry'],
    ['solid-state', 'Solid State', 12, 'Physical Chemistry'],
    ['solutions', 'Solutions', 12, 'Physical Chemistry'],
    ['electrochemistry', 'Electrochemistry', 12, 'Physical Chemistry'],
    ['chemical-kinetics', 'Chemical Kinetics', 12, 'Physical Chemistry'],
    ['surface-chemistry', 'Surface Chemistry', 12, 'Physical Chemistry'],
    ['nuclear-chemistry', 'Nuclear Chemistry', 12, 'Physical Chemistry'],
    ['periodic-table', 'Periodic Table & Periodicity', 11, 'Inorganic Chemistry'],
    ['chemical-bonding', 'Chemical Bonding', 11, 'Inorganic Chemistry'],
    ['hydrogen', 'Hydrogen', 11, 'Inorganic Chemistry'],
    ['s-block-elements', 's-Block Elements', 11, 'Inorganic Chemistry'],
    ['p-block-elements', 'p-Block Elements', 11, 'Inorganic Chemistry'],
    ['d-and-f-block-elements', 'd- and f-Block Elements', 12, 'Inorganic Chemistry'],
    ['coordination-compounds', 'Coordination Compounds', 12, 'Inorganic Chemistry'],
    ['metallurgy', 'Metallurgy', 12, 'Inorganic Chemistry'],
    ['salt-analysis', 'Salt Analysis', 12, 'Inorganic Chemistry'],
    ['environmental-chemistry', 'Environmental Chemistry', 11, 'Inorganic Chemistry'],
    ['general-organic-chemistry', 'General Organic Chemistry (GOC)', 11, 'Organic Chemistry'],
    ['isomerism-and-nomenclature', 'Nomenclature & Isomerism', 11, 'Organic Chemistry'],
    ['hydrocarbons', 'Hydrocarbons', 11, 'Organic Chemistry'],
    ['haloalkanes-and-haloarenes', 'Haloalkanes & Haloarenes', 12, 'Organic Chemistry'],
    ['alcohols-phenols-and-ethers', 'Alcohols, Phenols & Ethers', 12, 'Organic Chemistry'],
    ['aldehydes-ketones-and-acids', 'Aldehydes, Ketones & Carboxylic Acids', 12, 'Organic Chemistry'],
    ['amines', 'Amines & Nitrogen Compounds', 12, 'Organic Chemistry'],
    ['biomolecules', 'Biomolecules', 12, 'Organic Chemistry'],
    ['polymers', 'Polymers', 12, 'Organic Chemistry'],
    ['chemistry-in-everyday-life', 'Chemistry in Everyday Life', 12, 'Organic Chemistry'],
    ['practical-organic-chemistry', 'Practical Organic Chemistry', 12, 'Organic Chemistry'],
  ],
  maths: [
    ['logarithms-and-inequalities', 'Basic Maths, Logarithms & Inequalities', 11, 'Algebra'],
    ['sets-relations-and-functions', 'Sets, Relations & Functions', 11, 'Algebra'],
    ['complex-numbers', 'Complex Numbers', 11, 'Algebra'],
    ['quadratic-equations', 'Quadratic Equations', 11, 'Algebra'],
    ['sequences-and-series', 'Sequences & Series', 11, 'Algebra'],
    ['permutations-and-combinations', 'Permutations & Combinations', 11, 'Algebra'],
    ['binomial-theorem', 'Binomial Theorem', 11, 'Algebra'],
    ['mathematical-induction', 'Mathematical Induction', 11, 'Algebra'],
    ['mathematical-reasoning', 'Mathematical Reasoning', 11, 'Algebra'],
    ['matrices-and-determinants', 'Matrices & Determinants', 12, 'Algebra'],
    ['linear-programming', 'Linear Programming', 12, 'Algebra'],
    ['trigonometric-ratios', 'Trigonometric Ratios & Identities', 11, 'Trigonometry'],
    ['trigonometric-equations', 'Trigonometric Equations', 11, 'Trigonometry'],
    ['properties-of-triangles', 'Properties of Triangles & Heights', 11, 'Trigonometry'],
    ['inverse-trigonometric-functions', 'Inverse Trigonometric Functions', 12, 'Trigonometry'],
    ['straight-lines', 'Straight Lines', 11, 'Coordinate Geometry'],
    ['circles', 'Circles', 11, 'Coordinate Geometry'],
    ['parabola', 'Parabola', 11, 'Coordinate Geometry'],
    ['ellipse', 'Ellipse', 11, 'Coordinate Geometry'],
    ['hyperbola', 'Hyperbola', 11, 'Coordinate Geometry'],
    ['conic-sections', 'Conic Sections (mixed)', 11, 'Coordinate Geometry'],
    ['limits', 'Limits', 11, 'Calculus'],
    ['continuity-and-differentiability', 'Continuity & Differentiability', 12, 'Calculus'],
    ['differentiation', 'Differentiation', 12, 'Calculus'],
    ['application-of-derivatives', 'Application of Derivatives', 12, 'Calculus'],
    ['indefinite-integration', 'Indefinite Integration', 12, 'Calculus'],
    ['definite-integration', 'Definite Integration', 12, 'Calculus'],
    ['area-under-curves', 'Area Under Curves', 12, 'Calculus'],
    ['differential-equations', 'Differential Equations', 12, 'Calculus'],
    ['vector-algebra', 'Vector Algebra', 12, 'Vectors & 3D'],
    ['three-dimensional-geometry', 'Three Dimensional Geometry', 12, 'Vectors & 3D'],
    ['statistics', 'Statistics', 11, 'Statistics & Probability'],
    ['probability', 'Probability', 12, 'Statistics & Probability'],
  ],
};

// [pattern, chapter id] — tested against the lowercased raw name.
const RULES = {
  physics: [
    [/question bank|^null$|practice paper/, null],
    [/basic mathematics|^vectors?$/, 'basic-maths-and-vectors'],
    [/dimension|measurement|percentage error|^units|physical world/, 'units-and-dimensions'],
    [/electromagnetic wave|em wave|radiation emitted by electron|rms value of oscillating magnetic/, 'electromagnetic-waves'],
    [/induct|faraday|lenz|magnetic flux|induced current|\blr\b|\brl\b/, 'electromagnetic-induction'],
    [/alternating|lcr|power factor|average power/, 'alternating-current'],
    [/magnet|ampere|biot|cross field|current carrying|hysteresis|coercivity|lorentz/, 'magnetic-effects-of-current'],
    [/dual nature|photoelectric|de broglie/, 'dual-nature-of-matter'],
    [/constraint/, 'laws-of-motion'],
    [/projectile|projection/, 'kinematics'],
    [/adaibatic/, 'thermodynamics'],
    [/rotation|rigid body|rolling|torque|moment of inertia|angular/, 'rotational-motion'],
    [/shm|simple harmonic|oscillat|block spring|time period/, 'oscillations'],
    [/circular motion|centripetal|tangential acceleration/, 'circular-motion'],
    [/centre of mass|center of mass|collision|momentum|impulse|variable mass|variable linear mass/, 'centre-of-mass-and-collisions'],
    [/gravitation|satellite|kepler/, 'gravitation'],
    [/wave optics|ydse|interference|diffraction|polari[sz]/, 'wave-optics'],
    [/sound|organ pipe|doppler|wave|superposition/, 'waves-and-sound'],
    [/stress|strain|young|bulk modulus|elongation|elastic|elongated rod|properties of solids(?! and fluids)|mechanical properties of solids/, 'properties-of-solids-and-liquids'],
    [/fluid|hydrostatic|archimedes|buoyan|bernoulli|efflux|continuity|surface tension|capillar|viscos/, 'properties-of-solids-and-liquids'],
    [/kinetic theory|rms speed|r\.m\.s|root mean|ideal gas|gases in equilibrium/, 'kinetic-theory-of-gases'],
    [/thermodynamic|adiaba|isobaric|isotherm|carnot|heat engine|cyclic|p-v|p-t|v-t|expansion of gas/, 'thermodynamics'],
    [/thermal|calorimetry|specific heat|latent|heat capacity|heat transfer|conduction|stefan|molar heat/, 'thermal-properties-of-matter'],
    [/capacit|dielectric|charge on plates/, 'capacitance'],
    [/current electricity|kvl|kirchhoff|potentiometer|meter bridge|galvanometer|electrical potential in an electric circuit|resist/, 'current-electricity'],
    [/electrostat|electric charge|electric field|electic field|electric potential|gauss|dipole|charge/, 'electrostatics'],
    [/^optics$|ray optics|geometrical optics|lens|mirror|prism|refraction|apparent depth|optical instrument|illuminance/, 'ray-optics'],
    [/nucle|radioactiv/, 'nuclei'],
    [/atom|bohr|balmer|spectral|closest distance of approach/, 'atoms'],
    [/semiconductor|diode|gates|zener|modulation|communication|transistor/, 'semiconductors'],
    [/circular/, 'circular-motion'],
    [/work|energy|power|potential energy/, 'work-energy-and-power'],
    [/newton|laws of motion|friction|forces|constraint|inclined plane|relative motion between blocks|block/, 'laws-of-motion'],
    [/rectilinear|straight line|motion under gravity|projectile|relative motion|river|rain|kinematics|acceleration|position|trajectory|uniform accelerated|minimum separation|plane problem|velocity/, 'kinematics'],
  ],
  chemistry: [
    [/question bank|^null$|practice paper/, null],
    [/coordination|complex|werner|crystal field|valence bond/, 'coordination-compounds'],
    [/stereo|isomer|iupac|nomencl|nomencult|chiral|projection|specific rotation|enantiomer|optical/, 'isomerism-and-nomenclature'],
    [/steric inhibition|inductive|resonance \(|reaction mechanism|organic reaction$|some basic principles|^organic chemistry$|organic chemistry basics/, 'general-organic-chemistry'],
    [/everyday life/, 'chemistry-in-everyday-life'],
    [/structure identification|\bpoc\b|quatitative|quantitative/, 'practical-organic-chemistry'],
    [/biomolecule/, 'biomolecules'],
    [/polymer/, 'polymers'],
    [/chemical kinetics/, 'chemical-kinetics'],
    [/nuclear|radioactiv/, 'nuclear-chemistry'],
    [/inert pair|noble gas|p[- ]?block|group no|ivth group|nitrogen family|oxygen family|halogen family|oxy ?acid|hydracid|silicone|silicate|borax/, 'p-block-elements'],
    [/s[- ]?block|carbonate|oxides, peroxides|hydride/, 's-block-elements'],
    [/d (and|&) f|d[- ]?block|iib group/, 'd-and-f-block-elements'],
    [/radius|periodic|electronegativ|shielding|z_?eff|properties of elements|general facts|classification of elements/, 'periodic-table'],
    [/equivalent|titration|eudiomet|\bpoac\b|atom conservation|redox|oxidation number/, 'redox-reactions'],
    [/mole concept|stoichiometr|basic +concepts/, 'mole-concept'],
    [/\batom|bohr|quantum|spectrum|photoelectric|shrodinger|schrodinger|electronic configuration/, 'structure-of-atom'],
    [/thermodynamic|thermochem|△g|δg/, 'thermodynamics'],
    [/equilibri|eqilibri|ionic/, 'equilibrium'],
    [/states of matter|gas|vander|virial/, 'states-of-matter'],
    [/solid state|cubic|\bbcc|\bhcp|\bccp|voids/, 'solid-state'],
    [/solution|raoult|miscible/, 'solutions'],
    [/electrochem/, 'electrochemistry'],
    [/kinetic|\brate\b|order reaction|order and rate|1\^?st ?order|catalys/, 'chemical-kinetics'],
    [/surface|colloid|adsorption|emulsion|micelle|coagulation/, 'surface-chemistry'],
    [/h- ?bond/, 'chemical-bonding'],
    [/hydrogen|h_?2o_?2|hardness of water/, 'hydrogen'],
    [/bond|hybridi|\bmot\b|lewis acid|multicent/, 'chemical-bonding'],
    [/isolation|metallurg/, 'metallurgy'],
    [/qualitative|dry test|precipitation reaction|oxides, hydroxides|nitrates/, 'salt-analysis'],
    [/environmental/, 'environmental-chemistry'],
    [/halo|halogen containing/, 'haloalkanes-and-haloarenes'],
    [/amine|diazo|nitrogen/, 'amines'],
    [/aldehyde|ketone|carbox|carbonyl|aldol|cannizzaro/, 'aldehydes-ketones-and-acids'],
    [/alcohol|phenol|ether/, 'alcohols-phenols-and-ethers'],
    [/hydrocarbon|alkane|alkene|alkyne|aromatic/, 'hydrocarbons'],
  ],
  maths: [
    [/question bank|^null$|board question paper|no chapter|lines and angles|fractions|knowing our numbers|^integers$|polynomials|algebraic expression|congruence|rational numbers?$|simple equations|linear equations? in two variables|triangular prism|cyclic quadrilateral|types of triangle|complementary angles|factori[sz]ation|divisibility|^algebra$/, null],
    [/application of integrals|area (under|bounded|using)|calculation of area/, 'area-under-curves'],
    [/\bdefinite integra|properties of definite/, 'definite-integration'],
    [/integra|reduction formula/, 'indefinite-integration'],
    [/differentiation of/, 'differentiation'],
    [/vector/, 'vector-algebra'],
    [/three dimensional|3d|direction ratio|equation of plane|shortest distance/, 'three-dimensional-geometry'],
    [/inverse trig|\bitf\b|principle value/, 'inverse-trigonometric-functions'],
    [/trigonometric equation|trigonometric equations/, 'trigonometric-equations'],
    [/triangle|hight and distance|height and distance|sine (and cosine )?formula|cosine (rule|formula)|tangent rule|inradius|circumradius|ex-radii|incircle|excircle|circumcircle|circumscribing|centroid|incentre|median|m-n theorem/, 'properties-of-triangles'],
    [/trigonom|trignom|angles|compound|sine|cosine/, 'trigonometric-ratios'],
    [/complex|root of unity|roots of unity|argument|real and imaginary|conjugate/, 'complex-numbers'],
    [/probab|baye|events|expectation|random variable|binomial distribution/, 'probability'],
    [/binomial|coefficients? of x|sum of coefficients/, 'binomial-theorem'],
    [/statistic|standard deviation|^median$|variance/, 'statistics'],
    [/permutation|combination|distribution of|arrangement/, 'permutations-and-combinations'],
    [/matri|determinant|adjoint/, 'matrices-and-determinants'],
    [/induction/, 'mathematical-induction'],
    [/reasoning|tautology|statements/, 'mathematical-reasoning'],
    [/linear programming/, 'linear-programming'],
    [/sequence|series|progression|\bap\b|\bgp\b|g\.p|harmonic|arithmetic|geometric|means|am, gm|agp|terms of/, 'sequences-and-series'],
    [/quadratic|\broots?\b|theory of equations|द्विघात/, 'quadratic-equations'],
    [/parabol|latus rectum/, 'parabola'],
    [/ellipse/, 'ellipse'],
    [/hyperbola/, 'hyperbola'],
    [/focus|foci|eccentricity|directrix|chord/, 'conic-sections'],
    [/conic/, 'conic-sections'],
    [/circle/, 'circles'],
    [/straight line|pair of straight|line and point|point and line|angle bisector|family of|slope|distance of point|distance between two lines|concurren|collinear|section formula|locus|coordinate geometry|rotation of line|homogeni[sz]ation|perpendicular distance|mirror image|position of point|angle between two lines/, 'straight-lines'],
    [/differential equation|variable separable|order and degree|degree and order|general solution of de/, 'differential-equations'],
    [/definite/, 'definite-integration'],
    [/integra|integrals|reduction formula/, 'indefinite-integration'],
    [/application of derivatives|monoton|maxim|minim|extreme|tangent|normal|rolle|lmvt/, 'application-of-derivatives'],
    [/continuity|differentiab|derivability|lhl/, 'continuity-and-differentiability'],
    [/limit|hospital|lh rule|indeterminate|rationali[sz]ation/, 'limits'],
    [/differentiation|derivative|leib|first principle/, 'differentiation'],
    [/relation|function|sets?\b|binary|mapping|domain|range|greatest integer|signum|period of|venn|power set/, 'sets-relations-and-functions'],
    [/logarithm|fundamental|number system|real number|inequalit|modulus|mathematical tools/, 'logarithms-and-inequalities'],
  ],
};

const bySubject = Object.fromEntries(
  Object.entries(CHAPTERS).map(([s, list]) => [s, list.map(([id, name, cls, unit]) => ({ id, name, class: cls, unit }))]),
);
const byId = new Map(Object.entries(bySubject).flatMap(([s, list]) => list.map((c) => [`${s}:${c.id}`, c])));

/** The standard chapter list for a subject, in syllabus order. */
export const syllabusChapters = (subject) => bySubject[subject] || [];
export const syllabusChapter = (subject, id) => byId.get(`${subject}:${id}`) || null;

/** Units of a subject in syllabus order, each with its chapters. */
export function syllabusUnits(subject) {
  const units = [];
  for (const ch of syllabusChapters(subject)) {
    let u = units.find((x) => x.name === ch.unit);
    if (!u) units.push((u = { name: ch.unit, chapters: [] }));
    u.chapters.push(ch);
  }
  return units;
}

const slugish = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Is a source's chapter name narrower than the standard chapter ("Rain Problem" in Kinematics), rather
 * than just another spelling of it ("Kinematics", "Rotational motion")? Narrower names work as topics.
 */
export function isNarrowerName(raw, stdName) {
  const r = slugish(raw);
  const s = slugish(stdName);
  return !!r && !s.startsWith(r) && !r.startsWith(s);
}

const memo = new Map();

/** Standard chapter id for a raw chapter name ("Rain Problem" -> 'kinematics'), or null. */
export function syllabusIdFor(subject, raw) {
  if (!raw || !RULES[subject]) return null;
  const key = `${subject}|${raw}`;
  if (memo.has(key)) return memo.get(key);
  const s = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  let id = null;
  const hit = RULES[subject].find(([re]) => re.test(s));
  if (hit) id = hit[1];
  if (memo.size < 20000) memo.set(key, id);
  return id;
}
