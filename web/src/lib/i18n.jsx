import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import HI from './hi.js';
import { Icon } from '../components/Icon.jsx';

/**
 * Hindi / English for the student-facing interface.
 *
 *   const t = useT();
 *   t('Start solving')                      -> "हल करना शुरू करें" in Hindi, unchanged in English
 *   t('{n} questions', { n: 25 })           -> placeholders in {curly braces}
 *
 * Keys are the English text itself, so English never needs a dictionary and a missing Hindi entry
 * just shows English. Translations live in lib/hi.js. Questions, solutions and the admin area stay
 * in their original language.
 */
const KEY = 'jee_arena_lang';
const LangCtx = createContext({ lang: 'en', setLang: () => {} });

function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'hi' || saved === 'en') return saved;
  } catch {
    /* storage blocked */
  }
  return (navigator.language || '').toLowerCase().startsWith('hi') ? 'hi' : 'en';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
  }, [lang]);
  const setLang = useCallback((l) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked: still switches for this visit */
    }
  }, []);
  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

/** Marks text that is translated later with t(variable), so the translation check (npm test) finds it. */
export const tk = (s) => s;

const missing = new Set();
export function translate(lang, s, vars) {
  let out = s;
  if (lang === 'hi') {
    if (HI[s] !== undefined) out = HI[s];
    else if (import.meta.env.DEV && s && !missing.has(s)) {
      missing.add(s);
      console.debug(`[i18n] no Hindi for: "${s}"`); // add it to web/src/lib/hi.js
    }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : out;
}

export function useT() {
  const { lang } = useContext(LangCtx);
  return useCallback((s, vars) => translate(lang, s, vars), [lang]);
}

/** EN / हिं switch for the nav bar. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      className="btn sm ghost lang-toggle"
      onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
      title={lang === 'hi' ? 'Switch to English' : 'हिन्दी में देखें'}
      aria-label={lang === 'hi' ? 'Switch to English' : 'Switch to Hindi'}
    >
      <Icon.Languages /> {lang === 'hi' ? 'EN' : 'हिं'}
    </button>
  );
}
