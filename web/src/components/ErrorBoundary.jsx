import { Component } from 'react';
import { isStaleChunk, reloadOnceForNewVersion, reportError } from '../lib/errors.js';
import { useT } from '../lib/i18n.jsx';
import { Icon } from './Icon.jsx';

/** Instead of a blank white page when something in the UI crashes: a message, a reload button, and a report. */
export class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isStaleChunk(error) && reloadOnceForNewVersion()) return;
    reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <Crashed />;
  }
}

function Crashed() {
  const t = useT();
  return (
    <main className="page narrow">
      <div className="card empty stack">
        <div className="empty-icon bad"><Icon.TriangleAlert size={26} /></div>
        <h2 style={{ margin: 0 }}>{t('Something went wrong on this page')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t("It's been reported automatically. Reloading usually fixes it; your answers and progress are saved.")}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => window.location.reload()}><Icon.RotateCcw /> {t('Reload')}</button>
          <a className="btn" href="/">{t('Go home')}</a>
        </div>
      </div>
    </main>
  );
}
