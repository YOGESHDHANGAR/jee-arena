# JEE Arena

LeetCode-style practice platform for JEE aspirants: solve questions, take timed contests and mock tests, and see All-India ranks.

This is a **separate project** from JEE Video Studio. It has its own frontend, backend and database (`jee_arena`). The only link is `scripts/import-from-studio.js`, which **reads** questions from the Studio question bank and copies them in. Nothing in JEE Studio is modified.

## What's in it

| For students | For you (admin) |
|---|---|
| Problem list with subject/chapter/difficulty/type/PYQ/status filters | Overview: users, Pro count, questions by subject & type |
| Solve page: instant right/wrong, reveal solution, prev/next, random pick | Review drafts, fix answers, edit text/options/solutions, publish, hide |
| LaTeX rendering (KaTeX), images, basic HTML from scraped sources | Create contests (scheduled, rated) and mock tests (any time, optional Pro) |
| Weekly **contests** with JEE marking, leaderboard, **rating** (Elo-style) | Full JEE Main pattern (75 Q) or custom sections |
| **Mock tests** with All-India rank | Grant / remove Pro per user |
| **Custom tests**: pick subjects, chapters, count, difficulty | |
| Exam-style test screen: timer, palette, mark for review, autosave | |
| Profile: solved by subject, streak, heatmap, rating graph, weak chapters | Reports queue: questions students flagged, most-reported first, "Fix in editor" |
| Global leaderboards (rating, most solved) | |
| **Problem of the Day** on Home, with its own streak | |
| **Bookmarks** (☆ Save) and **My mistakes** (wrong / gave up, not yet solved) | |
| **Report** a wrong answer, broken LaTeX, missing figure… on any question | |
| **Share card** after a mock or contest: "AIR 142 · 186/300" image + link (WhatsApp, native share, download) | |
| **Chapter pages** `/physics`, `/physics/rotational-motion`: PYQs by year, topics, where to start | Duplicates: copies of the same question across sources, merge or auto-merge |
| **Time per question** in tests: slowest questions, time lost on wrong answers, vs. what others took | Difficulty from real solve rates (Overview → "Difficulty from real results") |
| Installable app (PWA), opens instantly on repeat visits | Errors: server + browser crashes, grouped |
| **हिं / EN** switch: the whole student interface in Hindi | Growth: visitors, sign-ups, active students, sources, retention, referrers |
| **Weekly leaderboard** (resets Monday IST) + last week's top 3 | Solutions: turn the best-voted discussion comment into the official solution |
| **Percentile estimate** on full JEE Main mocks | |

Marking schemes: **JEE Main** (+4/−1 MCQ and numerical), **JEE Advanced** (single +3/−1, multi-correct with partial marking +4/+1 per option/−2, numerical +4/0), and **no negative**.

## Run it locally (Windows)

Needs Node.js 22.13+ (you have 24) and a MongoDB server (your local one on port 27017 is fine — the app uses its own `jee_arena` database).

```powershell
cd jee-arena
copy .env.example .env      # then edit .env — see below
npm install
npm run seed                # 12 sample questions so the app isn't empty
npm run dev                 # API on :4000, web on http://localhost:5173
```

In `.env`:
- `DB_NAME=jee_arena` — the platform's own database. **Must differ** from Studio's.
- `JWT_SECRET` — any long random string.
- `ADMIN_EMAILS` — your email; register with it and you're admin. (Or later: `npm run make-admin -- yourusername`.)
- `STUDIO_PATH` — the jee-video-studio folder (default `../jee-video-studio`), used only by the importer.

## Import your question bank

The importer reads JEE Video Studio's bank (`jee-video-studio/bank/jee-bank.db`) **read-only** and copies questions into this app's MongoDB. Diagrams the questions use are copied into `jee-arena/media`, so the arena never depends on Studio's folders.

```powershell
npm run import -- --dry-run            # counts only, writes nothing
npm run import                         # everything (~140k rows, a few minutes)
npm run import -- --source=pw-dataset  # one source: doubtnut | ai-import | eqourse | pw-dataset
npm run import -- --subject=Physics
npm run import -- --published-only     # skip questions that would become drafts
```

- `STUDIO_PATH` in `.env` points at the Studio folder (default `../jee-video-studio`).
- Only Physics / Chemistry / Maths. `proof` questions are skipped (they can't be auto-checked).
- Questions with a usable answer and no `needs-answer` / `check-figure` / `check-math` tag → **published**. The rest → **draft** (Admin → Questions to fix and publish).
- Each question keeps its Studio source tag (`source.name`) and Studio id/number (`source.id`, `source.num`), so you can filter or replace a whole source later.
- Match-the-columns lists, passages and diagrams are folded into the question text. Chemistry `\ce{…}` renders via KaTeX mhchem.
- Re-running is safe: questions are matched by Studio id, keep their arena number and stats, and anything you edited in Admin is left alone.

## Tests

```powershell
npm test     # grading, JEE marking, ranking, rating, import normalisation
```

## Deploying cheaply

The server also serves the built web app, so it's **one Node process + one MongoDB**:

```powershell
npm run build
set NODE_ENV=production
npm start
```

- **Database:** MongoDB Atlas free tier (512 MB) holds tens of thousands of questions plus early users.
- **App:** any small Node host (Render/Railway/Fly free or starter tier, or a ₹300–500/month VPS).
- Cost-savers already built in: whole test paper is sent in one request; answers autosave every 20 s (not per click) with a local backup; leaderboards are cached for 60 s; contest results/ratings are computed once, lazily, when the first person opens results after the contest ends (no cron or worker needed); static assets are cached for 7 days.

## Google AdSense

Ads are off until you set them in `.env`:

1. Put the site on its own domain (AdSense won't approve localhost or a free subdomain), with the **Privacy** page live (`/privacy`, linked in the footer).
2. Apply at adsense.google.com and add the site. When approved, copy your publisher ID (`ca-pub-…`) to `ADSENSE_CLIENT`.
3. Create 2 **Display** ad units: one **fixed size 160×600** → `ADSENSE_SLOT_RAIL`, one **responsive** → `ADSENSE_SLOT_BOTTOM`.
4. `/ads.txt` is served automatically from `ADSENSE_CLIENT` — AdSense checks it.
5. `ADS_PREVIEW=1` shows grey boxes where ads go, to check layout before approval.

Where ads appear — never in the middle of studying:
- **Big screens (≥ 1280px wide and ≥ 720px tall):** one sticky 160×600 ad (AdSense "Wide Skyscraper") in the margin on each side. The page narrows slightly so they never overlap content, and they only show when the whole ad fits on screen.
- **Phones / short laptop screens:** a single responsive ad at the very bottom of the page, above the footer.
- **Never** between questions, options, solutions or comments, and **never** on the test/contest screen.
- **Pro members see no ads** — that's part of what Pro sells.

## Pro (premium) questions

A share of the published questions can be locked behind Pro. Free students still see every
chapter — they just don't get every question in it.

- **Pick the share from Admin → Overview**: a "Pro mix" panel lets you type a percentage
  (0–60), preview what would change, then apply it. Or from the command line:
  ```
  npm run premium -- --percent=20            # dry run, prints the breakdown
  npm run premium -- --percent=20 --apply     # actually flips the flags
  npm run premium -- --percent=20 --apply --include-pyq   # also lock some PYQs
  ```
- **How it picks which questions**: for every chapter separately, it locks that chapter's
  share, favouring questions that have a written solution and are harder — those are the ones
  worth paying for. PYQs (previous-year questions) are left free by default, since they're what
  brings students in from search; pass `--include-pyq` to lock some of those too.
- **Re-running is safe**: the choice is deterministic (same input → same picks) and it never
  touches a question an admin locked or unlocked by hand in the question editor — those are
  remembered and always count toward their chapter's share.
- **Where it's enforced**: the problem list, a single question's page, submitting an answer,
  revealing a solution, and the comment thread all check Pro status server-side. Practice tests
  and contests a free student builds also exclude Pro questions from the paper, so a free user
  can never see a Pro question's content by taking a test either.
- Because PYQs are excluded by default, "20%" usually lands a little under that (commonly
  ~17–18% of the bank) — the PYQ pool is free by default too. Tick "Include PYQs" (or
  `--include-pyq`) if you want the number closer to the exact 20%.

## Reports from students

Every question (practice page and test results) has a **⚑ Report** button: answer key wrong, question
incomplete, broken maths/formatting, figure missing, solution wrong, or something else with a note.
One open report per student per question (reporting again updates it); 20 reports/hour per account.

**Admin → Reports** groups them by question, most-reported first, shows the answer key, options and
students' notes, and has **Fix in editor** (the normal question editor; saving marks the reports fixed),
**Mark fixed**, and **Dismiss**. The Overview page shows how many questions have open reports.

## Problem of the Day

One free question per day (IST), the same for everyone, pinned at the top of Home and tagged ★ on its page.
Subjects rotate Physics → Chemistry → Maths. It prefers medium/hard questions with a written solution and
never repeats until the bank runs out. The pick is saved in the `potd` collection the first time anyone opens
Home that day, so later imports don't change it. If an admin hides it or it gets locked into a contest,
a new one is picked.

Solving it keeps a separate **POTD streak** (shown on the card). Like any submission it also counts toward
the everyday streak.

## Bookmarks and My mistakes

- **☆ Save** on a question adds it to your bookmarks (`bookmarks` collection).
- **My mistakes** = questions you got wrong or revealed and haven't solved yet (from `progress`, nothing new stored).
  Solve one and it drops off the list.
- Both are filters on the Problems page (`?status=bookmarked`, `?status=attempted`), so Prev/Next, the list
  drawer and 🎲 all work inside them. Links are on the Problems page and your profile.

## Search engines (SEO)

- Every page sets its own tab title and description.
- In production the server fills in `<title>`, description, canonical link and Open Graph tags **in the HTML
  itself** for `/problems/:n` (e.g. *"Chemical Bonding — JEE Main 2022 PYQ #6 | JEE Arena"*) and `/test/:id`,
  so Google and WhatsApp/Telegram link previews see a real title per question. Unknown questions return 404.
- `/sitemap.xml` is a sitemap index: static pages + contests/mocks, and all **free** published questions in
  files of 40,000 (`/sitemap-problems-1.xml`, …). Pro questions are left out (they only show a teaser).
- `/robots.txt` allows everything except `/api`, `/admin`, `/practice` and the test-taking/result pages, and points at the sitemap.
- Set `SITE_URL=https://yourdomain.in` in production so links in the sitemap use your domain.
- After deploying: add the site in Google Search Console and submit `https://yourdomain.in/sitemap.xml`.

## Render free plan: cold starts

Render's free plan puts the service to sleep after 15 minutes with no traffic, and it takes about a minute
to wake up. While it wakes, a first visit sees Render's own loading page (the app can't run until the server
is up). If a tab is already open, the app keeps retrying on its own and shows a small **"Waking up the
server… 12s"** notice instead of failing.

To avoid cold starts for visitors coming from YouTube, ping `https://yourdomain.in/api/health` every
10 minutes with a free uptime monitor (UptimeRobot or cron-job.org). One always-on service uses about
720–744 of the 750 free hours a month, so keep this to a single free service. Or move to Render's
Starter plan, which never sleeps.

## Question pictures on Cloudflare R2 (later)

`media/` is served by the Node server and committed with the code (about 82 MB now). When it gets big:

1. Create an R2 bucket and turn on public access (r2.dev URL, or connect a domain like `media.yourdomain.in`).
2. Create an R2 API token with *Object Read & Write* and fill `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` in `.env`.
3. `npm run media:upload -- --dry-run`, then `npm run media:upload`. Safe to re-run: it skips files that are
   already there, so run it again after each import.
4. Set `MEDIA_BASE_URL` (locally and on Render) to the bucket's public URL.

Pictures then load straight from R2's CDN, and any old `/media/...` link redirects there. After that you can
add `media/` to `.gitignore` so deploys stop carrying the images. Keep your local copy, because the importer
still writes new pictures there before you upload them.

## Backups

MongoDB Atlas's free tier has no backups, so the project makes its own: one gzip file with every collection
and its indexes (`npm run backup` → `backups/jee_arena-2026-09-29-1830.jsonl.gz`).

- **Automatic, weekly:** `.github/workflows/backup.yml` runs every Monday 03:00 IST on GitHub Actions (free).
  Push the project to GitHub, add the repository secret `MONGO_URI` (and optionally `DB_NAME` and the four `R2_…`
  values to also copy each backup to R2). In Atlas → Network Access allow `0.0.0.0/0`, because GitHub's machines
  have no fixed IP. Each run's file is downloadable from the run page for 30 days.
  You can also start one by hand: Actions → Database backup → Run workflow.
- **By hand:** `npm run backup` (add `--upload` for R2, `--keep=8` to delete older local files, `--out=D:/Backups`).
- **Restore:** `npm run restore -- backups/<file>.jsonl.gz` restores into a *new* database `jee_arena_restore`
  so you can check it first. `--to=jee_arena --replace` overwrites the live one (asks you to type the name).
  Set `MONGO_URI` to Atlas to restore there.

## Search

Question search uses a MongoDB **text index** on chapter, topic and question text. It's built in the
background the first time the server starts, which takes a minute or two for 140k questions. Every word you
type must appear, so "rotational motion" means both words. Partial words like "thermo" fall back to the old
full scan. List counts are cached for 2 minutes, so paging through results doesn't re-count 140k questions
on every page.

## Duplicate questions

Different sources carry the same question in different formatting. Each question gets a fingerprint of its
text plus its set of options, ignoring LaTeX spacing, `\text{}`, HTML tags, option order, "(JEE Main 2019…)"
tags, numbering and picture file names. There's also a second fingerprint of the text alone, used for longer
questions.

- `npm run duplicates` fingerprints the bank and prints counts; `-- --auto` previews merging every exact
  group whose copies agree on the answer, `-- --auto --apply` does it. New imports and admin edits are
  fingerprinted automatically.
- **Admin → Duplicates** shows the groups side by side, flags ones whose **answer keys disagree** (answers are
  compared by option text, not letter), and lets you pick which copy to keep. "Auto-merge…" does all the
  agreeing ones.
- Merging never deletes. The other copies become `hidden` with `duplicateOf`, the kept copy inherits a missing
  solution or PYQ tag, and bookmarks move over. Re-importing won't un-hide them. Publishing a hidden copy
  from the editor un-merges it.

## Standard chapters

Imported questions come with about 830 different chapter spellings, many of them really topics
("Rain Problem", "Capillary Tube", "Adaibaticproces"). `server/src/lib/syllabus.js` is the JEE syllabus as
students know it: about 95 standard chapters, grouped into units, each marked Class 11 or 12, plus rules that
map every raw name onto one of them. Each question stores the result as `chapterId`:

- **Automatic.** The server fills in `chapterId` at startup for any question missing one, and re-maps
  everything when `SYLLABUS_VERSION` is bumped after editing the rules. The importer and the question
  editor keep it in sync. Nothing to run by hand.
- **Used everywhere.** The Problems chapter filter (grouped by unit), Physical / Organic / Inorganic,
  chapter pages, the sitemap, My analysis, the syllabus map and the test builder.
- **Questions with no usable chapter** (Maths has about 41,000: no chapter, or "Question Bank"). Run
  `npm run chapters:classify` to preview, then `npm run chapters:classify -- --apply`. It learns from the
  questions whose chapter is known and places a question when it's at least 90% sure. Tested on held-out
  questions, those guesses were right 96% (Physics), 94% (Chemistry) and 92% (Maths) of the time.
  Re-run it after big imports.
- **Admin → Chapters.** Lists what's still unplaced, with the best guess: one click to accept, pick another
  chapter, or mark "No JEE chapter". Bulk-accept guesses above a confidence. "Guessed" lets you spot-check
  the automatic ones. Anything set there (or in the question editor's "Standard chapter" box) is never changed
  by the scripts again.

## Chapter pages

`/physics`, `/chemistry`, `/maths` list the standard chapters by unit. `/physics/kinematics` shows the question
count, PYQs by year, difficulty and type (each a link into the filtered list), topics (including the narrower
source names such as "Rain Problem"), recent PYQs, most-practised questions and related chapters in the same unit.

- Old URLs built from raw names (`/physics/rain-problem`) redirect (301) to their standard chapter, so links
  Google already has keep working. Chapters with no questions return 404 instead of a thin page.
- In production the server also puts a plain-HTML version of these pages, and of each question page, inside the
  HTML (with breadcrumbs structured data), so Google sees real content and links without running JavaScript.
- Only standard chapters that have questions are in the sitemap.

## Spaced revision

A question a student gets wrong (practice or any test), gives up on, or saves with **Save to revise** comes
back 1 day later. Right when due: again in 3 days, then 7, then it's done. Wrong at any point: back to 1 day.
Getting it right straight after the mistake doesn't count, because the point is to remember it days later.

- A red dot on the avatar and a count in the account menu show what's due. **Problems → Any status → Due for
  revision** lists them, and **Take a test → Due for revision** makes a timed paper of them.
- Stored in the `reviews` collection (`lib/reviews.js`).

## Take a test

One-tap papers: full JEE Main pattern (75 questions, 3 hours), Class 11, Class 12, my mistakes,
**Fix my weak spots** (Pro: new questions from the chapters My analysis marks weak, careless, improving or
slow) and **Due for revision**. Or build your own from the standard chapters by unit, with a Class 11/12
switch. After any test, **Review your answers → One by one** steps through the paper with a palette: your
answer against the right one, your time against a benchmark (students who got it right, else the question's
average, else JEE Main pace), the solution, and Save to revise.

## Time per question in tests

The test screen counts the seconds spent on each question while the tab is visible. The count is saved with the
normal autosave and never goes backwards. Results show each question's time and, for mocks and contests, how
many people got it right and how long they took. There's also a "Where your time went" panel (time per subject,
time spent on questions you got wrong or skipped) and a "Slowest first" tab. Attempts from before this change
simply don't show times.

## Difficulty from real results

Admin → Overview → **Difficulty from real results** (or `npm run calibrate [-- --apply]`). For questions with
30+ students, the share who solve it sets the level: 70%+ easy, 40–70% medium, under 40% hard. The share is
smoothed towards the average so small samples don't swing it, and slow "easy" questions become medium.
Levels set by hand in the editor are never touched, re-imports keep the new level, and the original label is
kept in `difficultyOriginal`. Run it every few weeks.

## Error monitoring

Server errors (500s, crashes, unhandled rejections) and JavaScript errors from students' browsers are
grouped by cause in the `errors` collection. **Admin → Errors** shows each one's count, first and last time,
page and stack trace; "Fixed" clears one until it happens again. Old entries expire after 30 days, and the
log is capped at 2,000 groups.

On the student side, a crash shows a "Something went wrong — Reload" card instead of a blank page. A tab
left open across a deploy reloads itself once, instead of failing to load new code. No external account is
needed. If you outgrow this, Sentry's free tier is the usual next step.

## Installable app (PWA)

`web/public/manifest.webmanifest`, the icons in `web/public/icons/` and a small service worker (`web/public/sw.js`):

- Android and desktop Chrome offer **Install**, and the footer shows an "📲 Install app" button when they can.
  On iPhone it's Share → Add to Home Screen.
- Returning students get the app instantly even while the free server wakes up: the page comes from the
  cache and the "Waking up the server…" notice covers the API calls.
- Build files, icons and question pictures are cached; nothing under `/api` is, so answers, scores and ranks are
  always live.
- `sw.js` and the manifest are served with `no-cache`, so a deploy reaches phones on their next visit. To
  force every phone to drop its caches, bump `VERSION` in `sw.js`.

## Solutions from the discussion

On questions without a written solution, students see "the most upvoted explanation becomes the official
solution" above the discussion. **Admin → Solutions** lists those questions' best comments (2+ upvotes by
default). You can tidy the text, then **Make official solution**. The solution then shows "✓ Solution by
@username, chosen from the discussion", the comment gets an "Official solution" badge, and the author's
profile counts it. The importer won't overwrite it. "Not good enough" stops suggesting that comment.

## Percentile estimate

On the result of a full JEE Main-pattern paper (75 questions, +4/−1, out of 300), the result page shows
"≈ 96.1 percentile · AIR around 58,000" and how many more marks reach the next level; the share card shows it too.
It's interpolated from the JEE Main 2026 marks-vs-percentile-vs-rank table published by Careers360, and
labelled as an estimate. **Update the table in `web/src/lib/percentile.js` each year** when a new one is published.

## Weekly leaderboard

Ranks → **This week** (the default tab) counts questions solved for the first time since Monday 00:00 IST, so new students can
top it. It shows last week's top 3 and your own rank. Cached for 60 seconds.

## Growth (Admin → Growth)

- **Visits:** one count per browser session, by source, with no cookies or personal data (`visits` collection). Sources:
  `youtube`, `google`, `instagram`… from the referring site, `share` from result-card links (`?ref=`), `app`
  from the installed app, any `?utm_source=`, else `direct`. Bots are ignored.
- **Sign-ups** remember the source the student first arrived from. If they came through a friend's share link, the friend
  gets the referral (shown on their profile as "invited N friends").
- **Shows:** totals, active this week/month, % of new visitors who sign up, % of new students who come back the
  next day and within a week (for those who signed up 8–37 days ago), charts per day, a sources table and top referrers.
- Tag your own links to tell them apart, e.g. put `?utm_source=yt-shorts` in Shorts descriptions and
  `?utm_source=yt-video` in long videos.

## Hindi / English

The **हिं / EN** button in the top bar switches the student interface: menus, buttons, test screen, results,
leaderboards, chapter pages, profile. The choice is remembered on the device, and it starts in Hindi if the browser is set to
Hindi. Questions, solutions, the admin area and the privacy page stay as written. Translations are in
`web/src/lib/hi.js`, keyed by the English text. When you add UI text, wrap it in `t('…')` and add the Hindi there.
`npm test` fails if a string is missing Hindi or a `{placeholder}` doesn't match.

## Student analysis (Profile → 📊 My analysis)

A private page for each student, also linked from Home and every test result. Admins can open any student's.
It's built entirely from their practice history (`progress`), test results (`testAttempts`, including time per
question) and practice days, so nothing extra is stored. It's cached for a minute.

- **Headline numbers:**
  - First-try accuracy: solved on the first submission without opening the solution, the closest to exam conditions.
  - Average solve time against the **exam pace** of 2 min 24 s (JEE Main: 180 minutes for 75 questions).
  - Speed compared with **other students on the same questions** (e.g. "28% slower").
  - Accuracy in tests and marks lost to negative marking.
- **Syllabus map:** every standard chapter as a tile, grey until started, with questions tried and accuracy.
  Pro colours each one strong / improving / accurate but slow / fast but careless / weak (after 5 questions).
- **What to do next:** up to 6 concrete steps with a button each. Practise your weakest chapter with questions you haven't
  tried, revise open mistakes, slow down where you're fast but careless, do timed tests where you're accurate but slow,
  review the solutions from your last test if negative marks are hurting, start a big untouched chapter, practise more regularly.
- **Per subject:** accuracy, solve time with the exam-pace marker, speed against others, easy/medium/hard accuracy,
  strongest and weakest chapter, test performance, and how many chapters have been started.
- **Chapter by chapter:** a chart of accuracy against speed with four areas (strong / accurate but slow / fast but careless /
  needs the most work), and a table sortable by weakest, slowest or most practised. Each chapter gets a verdict once 5 questions
  have been tried.
- **More breakdowns:** by difficulty and question type; the weakest topics; exam-condition stats (attempt rate, accuracy,
  negative marks, minutes spent on wrong answers, net marks per attempt under +4/−1); recent tests; questions solved
  per week; days practised; chapters not started yet, with the most PYQs first.
- The thresholds are in `server/src/lib/analysis.js` (`verdict`, `recommendations`, `EXAM_PACE_SEC`) and are easy to tune.
- **Free vs Pro.** Free students get first-try accuracy, solve time against exam pace, accuracy per subject, chapter,
  difficulty and type, test attempt rate and accuracy, weekly activity, chapters not started, and the first 2 next steps.
  **Pro** adds:
  - speed compared with other students (overall, per subject, per chapter);
  - a strong / slow / careless / weak verdict for every chapter, and the accuracy-vs-speed map;
  - weakest topics;
  - marks lost to negative marking, time lost on wrong answers and net marks per attempt in tests;
  - the full action plan.

  Locked parts show what they would reveal, with an "Unlock with Pro" button. The Pro parts are removed on the server
  (`freeView` in `lib/analysis.js`), not just hidden, and admins always see everything. To move a feature between free and
  Pro, edit `freeView`.

## Revenue hooks already in place

- `plan: 'free' | 'pro'` on users; `premium` flag on questions and mock tests; gated on the server.
- `/pro` pricing page. Payment isn't wired yet — connect Razorpay later: create an order endpoint, and on the payment webhook set `plan: 'pro'`. Until then, grant Pro in Admin → Users.
- Pro questions (above) give free users a reason to upgrade beyond "no ads".

## Project layout

```
server/src/
  index.js            Express app (also serves web/dist in production)
  auth.js             register / login (JWT), role checks
  lib/grading.js      answer checking + marking schemes
  lib/rating.js       contest ranks + rating changes
  lib/tests.js        paper picking, attempt grading, contest finalisation
  lib/potd.js         Problem of the Day pick + POTD streak
  lib/seo.js          per-page meta tags + plain-HTML body in index.html, sitemap, robots.txt
  lib/search.js       text-index search + count cache
  lib/fingerprint.js, lib/duplicates.js   duplicate detection and merging
  lib/chapters.js     chapter landing page data
  lib/difficulty.js   difficulty from solve rates
  lib/errors.js       error log
  lib/growth.js       Admin → Growth numbers
  lib/analysis.js     a student's strengths, weaknesses, speed and next steps
  routes/             problems (+ bookmarks, reports, potd), tests, users, leaderboard, admin (+ reports)
web/src/
  pages/              Home, Problems, Problem, Tests, TestLobby, TestRunner, TestResult,
                      Practice, Leaderboard, Profile, Pro, Admin
  components/Rich.jsx LaTeX/markdown/HTML rendering (sanitised)
  components/ReportButton.jsx, ShareCard.jsx, WakeBanner.jsx, BarChart.jsx
  lib/i18n.jsx, lib/hi.js   Hindi / English
  lib/percentile.js   JEE Main percentile estimate
  lib/track.js        visit source tracking
scripts/
  import-from-bank.js, lib/studio-bank.js, lib/normalize.js, seed.js, make-admin.js
  upload-media.js     copy media/ to Cloudflare R2 (npm run media:upload)
  backup.js, restore.js, find-duplicates.js, calibrate-difficulty.js
.github/workflows/backup.yml   weekly backup on GitHub Actions
```
