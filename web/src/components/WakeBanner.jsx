import { useEffect, useState } from 'react';
import { onWake } from '../lib/api.js';
import { useT } from '../lib/i18n.jsx';

/** Small floating notice while the (free-tier) server is starting up. Requests retry by themselves. */
export function WakeBanner() {
  const [since, setSince] = useState(null);
  const [, tick] = useState(0);
  const t = useT();
  useEffect(() => onWake(setSince), []);
  useEffect(() => {
    if (!since) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  const sec = Math.round((Date.now() - since) / 1000);
  return (
    <div className="wake-banner" role="status" aria-live="polite">
      <div className="spinner" />
      <span>
        {t('Waking up the server…')} {sec > 2 && <b>{sec}s</b>}
        {sec > 8 && <span style={{ opacity: 0.75 }}> · {t("usually under a minute, you don't need to refresh")}</span>}
      </span>
    </div>
  );
}
