import { memo, useEffect, useMemo, useRef } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem'; // \ce{...} chemistry, used throughout the Studio bank
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import { openImage } from './ImageViewer.jsx';

/**
 * Renders question/solution text:
 *   $…$ / $$…$$ / \(…\) / \[…\]           KaTeX math (with \ce{} chemistry)
 *   {{img:file-or-url}} / {{img:…|6}}      picture (Studio's tag; size is a height hint)
 *   {{mol:SMILES}} / {{mol:SMILES|5}}      skeletal structure, drawn with smiles-drawer
 *   ![](url), **bold**, line breaks, basic HTML from sources — all sanitised.
 */
const MATH = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<!\\)\$(?:\\.|[^$\\\n])+?\$)/g;
const TOKEN = /\{\{(img|mol):([^|}]+?)(?:\|([\d.]+))?\}\}/g;

function renderMath(src, display) {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
  } catch {
    return src;
  }
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Where pictures live: /media on this server, or the R2/CDN address the server puts in
// window.__JA__ when MEDIA_BASE_URL is set (so images load straight from the CDN, no redirect).
const MEDIA_BASE = (typeof window !== 'undefined' && window.__JA__?.mediaBase) || '/media';

/** Studio stores local pictures by file name; the importer copies them to /media. */
export const mediaUrl = (src) => {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (src.startsWith('/media/')) return MEDIA_BASE === '/media' ? src : `${MEDIA_BASE}${src.slice(6)}`;
  if (src.startsWith('/')) return src;
  const clean = src.replace(/^\/?(public\/)?(images\/)?/, '');
  return `${MEDIA_BASE}/${clean.split('/').map(encodeURIComponent).join('/')}`;
};

function tokenHtml(kind, value, size) {
  const h = size ? Math.min(20, Math.max(1, Number(size))) : 4;
  if (kind === 'img') {
    // Studio's size is tuned for a video frame; on the web give diagrams more room.
    return `<img class="fig" src="${escAttr(mediaUrl(value.trim()))}" alt="" loading="lazy" style="max-height:${Math.round(h * 3)}em">`;
  }
  return `<span class="mol" data-smiles="${escAttr(value.trim())}" data-h="${h}"></span>`;
}

const TAGS = 'p|br|div|span|img|sup|sub|b|i|u|strong|em|table|thead|tbody|tr|td|th|ul|ol|li|hr';
const LOOSE_LT = new RegExp(`<(?!/?(${TAGS})\\b)`, 'gi');

function plainToHtml(part, looksHtml) {
  // Keep known formatting tags (tables, sup/sub, images); escape any other "<" such as "x < 5".
  let t = part.replace(/\\\$/g, '$').replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(LOOSE_LT, '&lt;');
  t = t
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${mediaUrl(src)}" loading="lazy">`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^---$/gm, '<hr>');
  if (!looksHtml) t = t.replace(/\n/g, '<br>');
  return t;
}

function toHtml(text = '') {
  const src = String(text);
  const looksHtml = /<\/?(p|div|ul|ol|li)\b/i.test(src);
  const html = src
    .split(MATH)
    .map((part, i) => {
      if (i % 2 === 1) {
        if (part.startsWith('$$')) return renderMath(part.slice(2, -2), true);
        if (part.startsWith('\\[')) return renderMath(part.slice(2, -2), true);
        if (part.startsWith('\\(')) return renderMath(part.slice(2, -2), false);
        return renderMath(part.slice(1, -1), false);
      }
      // Pull out {{img:…}} / {{mol:…}} tags before escaping the rest.
      let out = '';
      let last = 0;
      for (const m of part.matchAll(TOKEN)) {
        out += plainToHtml(part.slice(last, m.index), looksHtml) + tokenHtml(m[1], m[2], m[3]);
        last = m.index + m[0].length;
      }
      return out + plainToHtml(part.slice(last), looksHtml);
    })
    .join('');
  return DOMPurify.sanitize(html, { ADD_ATTR: ['loading'], FORBID_TAGS: ['style', 'script', 'iframe', 'form'] });
}

// ---- chemical structures (loaded only when a question has one) ----
const MOL_THEME = {
  FOREGROUND: 'currentColor', BACKGROUND: 'transparent', C: 'currentColor', H: 'currentColor',
  O: '#ef5a4c', N: '#4d8ff0', F: '#2fb36b', CL: '#2fb36b', BR: '#d9773a', I: '#a066c9',
  P: '#e08a2e', S: '#e0b12e', B: '#e08a2e', SI: '#e08a2e',
};
const MOL_OPTIONS = {
  width: 500, height: 500, scale: 1, padding: 6, bondThickness: 1.4, bondLength: 30,
  fontSizeLarge: 11, fontSizeSmall: 7, compactDrawing: false, explicitHydrogens: true,
  terminalCarbons: false, themes: { jee: MOL_THEME },
};
let smilesLib;
const molCache = new Map();

async function drawMolecules(root) {
  const spots = root.querySelectorAll('span.mol[data-smiles]:not([data-done])');
  if (!spots.length) return;
  smilesLib ||= import('smiles-drawer').then((m) => m.default || m);
  const SD = await smilesLib;
  for (const el of spots) {
    const smiles = el.dataset.smiles;
    const h = Number(el.dataset.h) || 4;
    el.dataset.done = '1';
    const key = `${smiles}|${h}`;
    if (!molCache.has(key)) {
      try {
        const tree = SD.Parser.parse(smiles);
        const svg = new SD.SvgDrawer(MOL_OPTIONS).draw(tree, 'svg', 'jee', null, false);
        const vb = (svg.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
        const ratio = vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : 1;
        const em = h * 1.6;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('style', `height:${em}em;width:${(em * ratio).toFixed(2)}em;vertical-align:middle;overflow:visible;display:inline-block`);
        molCache.set(key, svg.outerHTML);
      } catch {
        molCache.set(key, `<span class="mol-error">[structure: ${escAttr(smiles)}]</span>`);
      }
    }
    el.innerHTML = molCache.get(key);
  }
}

export const Rich = memo(function Rich({ text, as: Tag = 'div', className = '' }) {
  const html = useMemo(() => toHtml(text), [text]);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && html.includes('data-smiles')) drawMolecules(ref.current);
  }, [html]);
  // Any picture opens full-screen. Inside an answer option this doesn't select the option.
  const onClick = (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.src) {
      e.preventDefault();
      e.stopPropagation();
      openImage(t.currentSrc || t.src, t.alt);
    }
  };
  return <Tag ref={ref} className={`rich ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
