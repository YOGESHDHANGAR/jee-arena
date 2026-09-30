import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Pill } from './Layout.jsx';
import { fmtRank } from '../lib/percentile.js';
import { tk, useT } from '../lib/i18n.jsx';

/**
 * Which IITs, NITs and IIITs the student's predicted rank could get today, from the JoSAA 2025 final-round
 * closing ranks (OPEN seats) in lib/josaa2025.json, loaded only when this is shown.
 *
 * NITs and IIITs admit on the JEE Main rank (CRL): NITs use the home-state quota for students from the
 * NIT's own state and the other-state quota otherwise. IITs admit on the JEE Advanced rank, which we
 * can't know yet, so it is estimated as ~72% of the Main rank: in 2025 about 1.80 lakh of the 2.5 lakh
 * students eligible from Main took Advanced, so the same standing is roughly 0.72 × the Main rank.
 * Advanced also needs the Main qualifying percentile (General: 93.10 in 2025).
 *
 * Tiers: likely = even the cautious end of the rank range is inside the closing rank;
 *        possible = the middle estimate is inside; reach = only the hopeful end is.
 */
export const ADV_FACTOR = 0.72;
export const ADV_QUALIFY_PERCENTILE = 93.1023262; // JEE Main 2025, OPEN (General)
const REACH_FACTOR = 1; // the hopeful end of the range is already optimistic

const TIERS = [
  ['likely', tk('Likely'), 'good'],
  ['possible', tk('Possible'), 'medium'],
  ['reach', tk('Reach'), 'hard'],
];
const KIND_LABEL = { IIT: tk('IITs'), NIT: tk('NITs'), IIIT: tk('IIITs') };
const isCS = (p) => /computer|artificial intelligence|data science|information technology|mathematics and computing/i.test(p);

export function tierFor(closing, ranks) {
  if (!closing) return null;
  if (ranks.worst <= closing) return 'likely';
  if (ranks.mid <= closing) return 'possible';
  if (ranks.best * REACH_FACTOR <= closing) return 'reach';
  return null;
}

export function CollegePredictor({ predicted, settings, onSettings, states }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('NIT');
  const [csOnly, setCsOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [tierFilter, setTierFilter] = useState(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    let live = true;
    import('../lib/josaa2025.json').then((m) => live && setData(m.default || m));
    return () => {
      live = false;
    };
  }, []);

  const main = predicted?.percentile && predicted?.best && predicted?.worst
    ? { mid: predicted.percentile.rank, best: predicted.best.rank, worst: predicted.worst.rank }
    : null;
  const adv = main ? { mid: Math.round(main.mid * ADV_FACTOR), best: Math.round(main.best * ADV_FACTOR), worst: Math.round(main.worst * ADV_FACTOR) } : null;
  const advEligible = (predicted?.percentile?.percentile ?? 0) >= ADV_QUALIFY_PERCENTILE;
  const advMaybe = (predicted?.best?.percentile ?? 0) >= ADV_QUALIFY_PERCENTILE;

  const results = useMemo(() => {
    if (!data || !main) return null;
    const female = !!settings?.femaleSeats;
    const byInst = new Map();
    for (const [i, program, degree, quota, gn, f] of data.programs) {
      const [name, k, state] = data.institutes[i];
      if (k !== kind) continue;
      // NITs: home-state seats for students from that state, other-state seats for everyone else.
      if (k === 'NIT') {
        const home = settings?.homeState && state === settings.homeState;
        if ((home && quota !== 'HS') || (!home && quota !== 'OS')) continue;
      }
      const closing = female ? Math.max(gn || 0, f || 0) : gn;
      const tier = tierFor(closing, k === 'IIT' ? adv : main);
      if (!tier) continue;
      if (csOnly && !isCS(program)) continue;
      if (query && !`${name} ${program}`.toLowerCase().includes(query.toLowerCase())) continue;
      const row = { program, degree, closing, tier };
      const inst = byInst.get(name) || byInst.set(name, { name, state, programs: [] }).get(name);
      inst.programs.push(row);
    }
    const order = { likely: 0, possible: 1, reach: 2 };
    const list = [...byInst.values()].map((x) => {
      // Best chances first, then the most sought-after branch within the same chance.
      x.programs.sort((a, b) => order[a.tier] - order[b.tier] || a.closing - b.closing);
      x.best = order[x.programs[0].tier];
      x.top = Math.min(...x.programs.map((p) => p.closing));
      return x;
    });
    list.sort((a, b) => a.best - b.best || a.top - b.top);
    const count = Object.fromEntries(TIERS.map(([k]) => [k, list.filter((x) => x.programs.some((p) => p.tier === k)).length]));
    return { list, count };
  }, [data, main?.mid, main?.best, main?.worst, kind, csOnly, query, settings?.homeState, settings?.femaleSeats]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!main) return null;
  const LIMIT = 8;
  const visible = results ? results.list.filter((x) => !tierFilter || x.programs.some((p) => p.tier === tierFilter)) : [];
  const toggle = (name) => setOpen((cur) => {
    const n = new Set(cur);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });

  return (
    <section className="card college">
      <div className="spread">
        <h3 className="with-icon" style={{ margin: 0 }}><Icon.GraduationCap /> {t('Colleges you could get today')}</h3>
        <div className="seg">
          {['IIT', 'NIT', 'IIIT'].map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setShowAll(false); setTierFilter(null); }}>{k === 'IIT' ? 'IITs' : k === 'NIT' ? 'NITs' : 'IIITs'}</button>)}
        </div>
      </div>

      <p className="small" style={{ margin: '8px 0' }}>
        {kind === 'IIT' ? (
          <>{t('Estimated JEE Advanced rank')} <b>{fmtRank(adv.best)} – {fmtRank(adv.worst)}</b> <span className="muted">({t('if Advanced goes as well as Main')})</span></>
        ) : (
          <>{t('Your predicted JEE Main rank')} <b>{fmtRank(main.best)} – {fmtRank(main.worst)}</b></>
        )}
      </p>

      {kind === 'IIT' && !advEligible && (
        <div className={`alert ${advMaybe ? 'warn' : 'error'} small`} style={{ marginBottom: 10 }}>
          {advMaybe
            ? t('You are near the JEE Main cut-off to sit JEE Advanced ({p} percentile for General in 2025). A few more marks make it safe.', { p: ADV_QUALIFY_PERCENTILE.toFixed(2) })
            : t('To sit JEE Advanced (needed for IITs) you need about {p} percentile in JEE Main (General, 2025). Your prediction is below that for now.', { p: ADV_QUALIFY_PERCENTILE.toFixed(2) })}
        </div>
      )}

      <div className="row college-filters">
        {kind === 'NIT' && (
          <label className="small">
            {t('Home state')}{' '}
            <select value={settings?.homeState || ''} onChange={(e) => onSettings({ homeState: e.target.value || null })}>
              <option value="">{t('Other / not listed')}</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <label className="small row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!settings?.femaleSeats} onChange={(e) => onSettings({ femaleSeats: e.target.checked })} /> {t('Include female-only seats')}
        </label>
        <label className="small row" style={{ gap: 6 }}>
          <input type="checkbox" checked={csOnly} onChange={(e) => setCsOnly(e.target.checked)} /> {t('CS, IT, AI & data science only')}
        </label>
        <input className="input sm" placeholder={t('Search college or branch')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '1 1 160px' }} />
      </div>

      {!results ? <div className="spinner" /> : (
        <>
          <div className="row" style={{ gap: 8, margin: '10px 0' }}>
            {TIERS.map(([k, label, kindCls]) => (
              <button key={k} type="button" className={`pill ${kindCls} pill-btn ${tierFilter === k ? 'on' : ''}`} aria-pressed={tierFilter === k} onClick={() => setTierFilter(tierFilter === k ? null : k)}>
                {t(label)}: {results.count[k]} {t(KIND_LABEL[kind])}
              </button>
            ))}
          </div>
          {!visible.length ? (
            <div className="empty small">{t('No {kind} within reach at this rank yet. Every 10 marks moves your rank a lot at this level: see "What to study next".', { kind: t(KIND_LABEL[kind]) })}</div>
          ) : (
            <div className="stack college-list">
              {visible.slice(0, showAll ? visible.length : LIMIT).map((x) => {
                const progs = tierFilter ? x.programs.filter((p) => p.tier === tierFilter) : x.programs;
                const shown = open.has(x.name) ? progs : progs.slice(0, 3);
                return (
                  <div key={x.name} className="college-row">
                    <div className="spread">
                      <b>{x.name}</b>
                      <span className="muted small">{progs.length === 1 ? t('1 branch') : t('{n} branches', { n: progs.length })}{kind === 'NIT' ? ` · ${settings?.homeState === x.state ? t('home state') : t('other state')}` : ''}</span>
                    </div>
                    <div className="stack" style={{ gap: 4, marginTop: 6 }}>
                      {shown.map((p) => {
                        const [, label, cls] = TIERS.find(([k]) => k === p.tier);
                        return (
                          <div key={p.program + p.degree} className="spread small">
                            <span>{p.program}{p.degree !== 'B.Tech' ? <span className="muted"> · {p.degree}</span> : null}</span>
                            <span className="row" style={{ gap: 6 }}>
                              <span className="muted mono">{t('closed at {r}', { r: fmtRank(p.closing) })}</span>
                              <Pill kind={cls}>{t(label)}</Pill>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {progs.length > 3 && (
                      <button className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => toggle(x.name)}>
                        {open.has(x.name) ? t('Show fewer') : t('+{n} more branches', { n: progs.length - 3 })}
                      </button>
                    )}
                  </div>
                );
              })}
              {visible.length > LIMIT && (
                <button className="btn sm" onClick={() => setShowAll(!showAll)}>
                  {showAll ? t('Show fewer') : t('Show all {n} colleges', { n: visible.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="muted small" style={{ margin: '10px 0 0' }}>
        {t('Based on JoSAA 2025 final-round closing ranks for OPEN seats. Closing ranks change every year, category seats (OBC, EWS, SC, ST) are not included, and IIT chances assume your JEE Advanced goes as well as your Main. Use this to set a target, not to choose colleges.')}
        {' '}{t('Ranks are for {rank}.', { rank: kind === 'IIT' ? t('JEE Advanced') : t('JEE Main (CRL)') })}
      </p>
    </section>
  );
}
