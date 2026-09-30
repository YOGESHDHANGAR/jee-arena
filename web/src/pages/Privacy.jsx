import { useTitle } from '../lib/hooks.js';

export default function Privacy() {
  useTitle('Privacy policy');
  return (
    <main className="page narrow">
      <article className="card stack legal">
        <h1>Privacy policy</h1>
        <p className="muted small">Last updated: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>

        <h2>What we collect</h2>
        <p>
          When you create an account we store your name, username, email address, your JEE attempt year (if you give it) and a
          securely hashed password. As you use JEE Arena we store your answers, attempts, time spent on questions, test results,
          ratings and any comments you post, so we can show your progress, ranks and statistics.
        </p>

        <h2>How we use it</h2>
        <p>
          To run the service: checking answers, building tests, computing ranks and ratings, showing leaderboards and your profile,
          and keeping the site secure. Your username, name, rating, solved counts and comments are visible to other students. Your
          email address is never shown publicly.
        </p>

        <h2>Advertising and cookies</h2>
        <p>
          Free accounts see ads served by Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on
          your prior visits to this website or other websites. Google's use of advertising cookies enables it and its partners to
          serve ads to you based on your visits to this and/or other sites on the Internet.
        </p>
        <p>
          You may opt out of personalised advertising by visiting{' '}
          <a href="https://www.google.com/settings/ads" target="_blank" rel="noreferrer">Google Ads Settings</a>, or opt out of some
          third-party vendors' use of cookies at{' '}
          <a href="https://www.aboutads.info/choices" target="_blank" rel="noreferrer">www.aboutads.info</a>. Learn how Google uses
          information from sites that use its services at{' '}
          <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noreferrer">
            policies.google.com/technologies/partner-sites
          </a>
          . Pro members see no ads.
        </p>
        <p>
          We also keep your login token in your browser's local storage, and store in-progress test answers there so they survive a
          lost connection.
        </p>

        <h2>Sharing</h2>
        <p>We don't sell your personal data. We share it only with service providers that host and run the site, or when required by law.</p>

        <h2>Your choices</h2>
        <p>You can update your name and attempt year from your profile, and ask us to delete your account and data by contacting us.</p>

        <h2>Children</h2>
        <p>JEE Arena is meant for students preparing for JEE. If you are under 18, please use it with a parent's or guardian's permission.</p>

        <h2>Contact</h2>
        <p>Questions about this policy: write to the site owner at the contact address shown on this page's footer.</p>
      </article>
    </main>
  );
}
