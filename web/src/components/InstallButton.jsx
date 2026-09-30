import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';
import { useT } from '../lib/i18n.jsx';

// Chrome/Edge/Android fire this when the site can be installed; keep it so a button can trigger it later.
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn(false));
  });
}

/** "Install app" — only shown when the browser says the site can be installed. */
export function InstallButton({ className = 'btn sm ghost' }) {
  const [can, setCan] = useState(!!deferred);
  const t = useT();
  useEffect(() => {
    listeners.add(setCan);
    return () => listeners.delete(setCan);
  }, []);
  if (!can) return null;
  return (
    <button
      className={className}
      onClick={async () => {
        const e = deferred;
        if (!e) return;
        deferred = null;
        setCan(false);
        e.prompt();
        await e.userChoice.catch(() => null);
      }}
    >
      <Icon.Download /> {t('Install app')}
    </button>
  );
}
