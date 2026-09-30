import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useTitle } from '../lib/hooks.js';
import { useT } from '../lib/i18n.jsx';

// Payments aren't wired in yet. When you add Razorpay, replace the upgrade button
// with a call to your /api/billing/checkout endpoint and flip `plan` on the webhook.
export default function Pro() {
  useTitle('Pro');
  const { user } = useAuth();
  const t = useT();
  return (
    <main className="page">
      <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 28px' }}>
        <h1>{t('Practise free. Go Pro for full mocks.')}</h1>
        <p className="muted">{t('Everything you need to practise daily stays free. Pro adds full-length mock tests, deeper analysis and premium question sets.')}</p>
      </div>
      <div className="grid grid-2" style={{ maxWidth: 820, margin: '0 auto' }}>
        <div className="card stack">
          <div><h2>{t('Free')}</h2><div className="price">₹0</div></div>
          <ul className="check">
            <li>{t('All practice problems with instant checking')}</li>
            <li>{t('Solutions after you attempt')}</li>
            <li>{t('Weekly rated contests & All-India rating')}</li>
            <li>{t('Custom chapter-wise tests, Class 11/12 papers and a full JEE Main pattern paper')}</li>
            <li>{t('Spaced revision: mistakes come back after 1, 3 and 7 days')}</li>
            <li>{t('Syllabus map: which chapters you have started')}</li>
            <li>{t('Streaks, heatmap and weak-chapter view')}</li>
            <li>{t('Basic analysis: accuracy, speed vs exam pace, subject and chapter accuracy')}</li>
            <li className="no">{t('Full JEE Main mock tests')}</li>
            <li className="no">{t('Pro question sets')}</li>
            <li className="no">{t('“Fix my weak spots” tests')}</li>
            <li className="no">{t('Full analysis: speed vs other students, chapter verdicts, weak topics, full action plan')}</li>
            <li className="no">{t('Ad-free')}</li>
          </ul>
          {!user && <Link className="btn lg" to="/register">{t('Create free account')}</Link>}
        </div>
        <div className="card stack" style={{ borderColor: 'var(--accent)', borderWidth: 2 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Pro</h2>
            <span className="pill pro">{t('Best value yearly')}</span>
          </div>
          <div><span className="price">₹999</span><span className="muted"> / {t('year')}</span> <span className="muted small">{t('or ₹149 / month')}</span></div>
          <ul className="check">
            <li>{t('Everything in Free')}</li>
            <li>{t('Full-length JEE Main mock tests in exam interface')}</li>
            <li>{t('All-India rank on every mock')}</li>
            <li>{t('Pro-only question sets and solutions')}</li>
            <li>{t('Subject-wise and chapter-wise test analysis')}</li>
            <li>{t('“Fix my weak spots”: one tap builds a paper from your weakest chapters')}</li>
            <li>{t('Syllabus map coloured strong / slow / careless / weak for every chapter')}</li>
            <li>{t('Full personal analysis: your speed vs other students, strong/slow/careless/weak verdict for every chapter, weakest topics, marks lost to negative marking, and a complete step-by-step plan')}</li>
            <li>{t('No ads, anywhere')}</li>
          </ul>
          {user?.plan === 'pro' ? (
            <div className="alert good">{t("You're on Pro. Thank you!")}</div>
          ) : (
            <>
              <a className="btn primary lg" href="tel:+919165607505">{t('Call/WhatsApp')} +91 91656 07505</a>
              <p className="muted small" style={{ margin: 0 }}>
                {t('Online payment is coming soon. Until then, call or WhatsApp +91 91656 07505 to pay and get Pro activated on your account.')}
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
