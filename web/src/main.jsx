import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import App from './App.jsx';
import { ImageViewer } from './components/ImageViewer.jsx';
import { WakeBanner } from './components/WakeBanner.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { installErrorReporting } from './lib/errors.js';
import { trackVisit } from './lib/track.js';
import { I18nProvider } from './lib/i18n.jsx';
import './styles.css';

installErrorReporting();
trackVisit();

// Installable app + instant repeat visits (public/sw.js). Production only: in dev it would cache Vite's files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <I18nProvider>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <ImageViewer />
        <WakeBanner />
      </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
