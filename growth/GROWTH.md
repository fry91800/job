# MonPoste growth plan

How to get MonPoste used: who to reach, in what order, and how to tell what works. This is
not technical documentation. It records decisions, experiments and results, and changes as
they come in. Product work it calls for becomes features in the code (FEATURE.md), marked
**[build]** below.

Started 2026-10-17, the week the site went live.

---

## 1. What MonPoste is, in one sentence

> **Toutes les offres d'emploi, et un CV adapté à chacune en une minute.**

Everything people say about MonPoste starts from this. Job boards with lots of offers already
exist (Indeed, Welcome to the Jungle, HelloWork, France Travail). What they don't do:

1. **A resume tailored to each offer**, reviewed change by change, as a PDF, in a minute.
2. **A match percentage** on every offer, from the user's own resume.
3. **Offers they don't have**: employers' own career sites and the public sector
   (Choisir le service public), in one search, with no sponsored listings.
4. **No account needed** to try it.

Lead with 1. The offers are why people stay; the tailored resume is why they try it and talk
about it.

---

## 2. First users: the people you can reach

The first users aren't decided yet. The first circle will be **the school Discord and friends**,
which is a good start: students and young graduates apply to many offers, rewrite their
resume for each one, and talk to each other. Make them the first target group, and let their
use show whether another group (experienced professionals, the public sector, career changers)
takes to it better.

**What success looks like for the first circle (first 4 weeks):**

| Number | Target |
|---|---|
| People who try it (open the site and search) | 50 |
| People who generate at least one tailored resume | 20 |
| People who come back in a later week | 10 |
| Detailed feedback conversations | 5 |

These numbers are small on purpose. At this stage the goal is learning what blocks people and
what they like, not traffic.

---

## 3. Phases

### Phase 0: before telling anyone (about a week)

The first visitors only come once; the site has to work for them.

- [ ] **Fill in the legal details** (`apps/web/src/legal/operator.ts`): name, address, contact.
      A site with placeholders loses trust immediately.
- [ ] **Go through the first visit yourself**, on a phone and a computer, as someone who has
      never seen it: search, open an offer, upload a resume, generate, download. Note every
      hesitation.
- [x] **Measure**: Umami, self-hosted and cookie-free, set up on 2026-10-17
      (https://stats.monposte.com, DEPLOYMENT.md §7.1). Events: `search` (keywords, result count), `resume_upload`,
      `resume_create`, `resume_generate`, `resume_translate`, `pdf_download`,
      `offer_save`, `offer_add`, `signup`, `feedback`; offers opened are page views
      (`/offers/…`). See §5.
- [x] **A feedback button** in the app ("Un avis ? Un problème ?", account menu): emailed to contact@monposte.com, Reply-To the sender. Check that a test
      message arrives once deployed.
- [ ] **Watch AI costs**: guests have 3 generations, registered users 30 a day (FEATURE G4).
      The global daily AI budget is built (`AI_DAILY_BUDGET_USD`, $2 by default, alerts at
      80 % and 100 %; DEPLOYMENT.md §8): choose the amount, set up the alert webhook, and
      check the Gemini spending page every day during the first weeks.
- [x] **Search Console and Bing** set up, sitemap submitted (2026-10-24) (SEO.md). Indexing takes weeks,
      so start the clock now.

### Phase 1: the first circle (weeks 1–4)

**Where:** the school Discord, friends, family members who are looking.

**How to post on the Discord.** Ask for help rather than advertise: people are glad to help
a classmate's project and forgive rough edges. For example:

> Salut ! J'ai codé un site pour chercher un job / une alternance / un stage :
> **monposte.com**. Il regroupe les offres de plein de sites carrières d'entreprises et de la
> fonction publique, et il adapte votre CV à chaque offre en une minute (vous validez chaque
> modification). Pas besoin de compte pour tester.
>
> Je cherche des gens pour l'essayer et me dire ce qui bloque ou ce qui manque, même
> brutalement 🙏 Il y a un bouton « Un avis ? » dans le site, ou répondez ici.

Then:
- **Answer every message**, fast. Fix the small things within days and say so on the Discord
  ("corrigé, merci @…"). Seeing their feedback acted on turns testers into supporters.
- **Talk to 5 people properly** (15 minutes, a call or in person): watch them use it without
  helping. Ask what they currently use to find offers, how they adapt their resume, what
  would make them come back. Write the answers in §7.
- **Before / after examples**: with their permission, keep two or three good examples of a
  resume before and after tailoring. They are the best material for phase 3.
- **Ask the school's career service** (service carrières / relations entreprises): they
  are always looking for tools to recommend to students. Show it to them once the first
  testers' feedback is fixed.

**Decide at the end of phase 1:** who used it most (students looking for an internship or
apprenticeship, graduates, something else), and which feature they used. That group is the
target for phase 3.

### Phase 2: make people come back (weeks 3–8)

Job sites live on people who return. People are looking for weeks or months; the site has to
remind them it exists.

- [x] **Job alerts by email** (built 2026-10-17, FEATURE O7): "Enregistrer cette recherche" on a search, then a
      daily or weekly email with the new matching offers (Brevo is already set up). This is
      the most important missing feature; it is listed as out of scope for the MVP and should
      come in now. Needs an account (an email address), which gives a reason to create one.
- [x] **New offers since the last visit** (built 2026-10-17): a "nouveau" mark on results.
- [ ] **Application follow-up** **[build]**: saved offers already track applications (O3); an
      occasional reminder ("3 offres enregistrées sans candidature") brings people back.
- [x] **Installable on a phone** (built 2026-10-17; "Installer l'application" in the account menu): a web app manifest so "Ajouter à l'écran
      d'accueil" gives an icon. Small work, and most students search on their phone.
- [ ] **Account creation at the right moment**: the reminder to guests already exists (G2);
      offer it right after the first successful generation, when the value is obvious.

**Measure:** share of people who come back in a later week (§5). Phase 3 only makes sense when
this is going up.

### Phase 3: reach beyond the first circle (month 2 onwards)

Free channels first, in roughly the order of effort to results:

1. **Other schools.** Classmates have friends in other schools; career services talk to each
   other. One message to each career service of nearby schools and universities, with a
   short presentation and the before/after examples. Student associations (BDE) and their
   newsletters too.
2. **Apprenticeship and internship seekers.** A huge, recurring need (every year, everyone at
   once, from spring to September). Worth checking that the apprenticeship and internship
   filters work well, and a landing page per contract type is already planned (SEO.md next
   steps: "alternance développeur Lyon").
3. **Communities where job seekers ask for help.** Reddit (r/france, r/vosfinances threads
   about job hunting, r/developpeurs), Discord servers of student and developer communities,
   LinkedIn groups. Answer questions usefully and mention MonPoste when it fits; don't post
   ads.
4. **Short content** on LinkedIn, TikTok, Instagram: "j'ai adapté mon CV à cette offre en
   30 secondes", before/after, "les offres que vous ne trouverez pas sur Indeed" (the public
   sector, career sites). One post a week is enough; what works shows in the numbers.
5. **Partnerships** with organisations that help job seekers: local job centres for young
   people (Missions locales), associations helping people back to work, university
   employment offices. MonPoste is free and helps them; they recommend it.
6. **Search engines** grow on their own over months (offer pages, landing pages, Google for
   Jobs). Check Search Console monthly; SEO.md lists what to build next.
7. **Launches and press**, once the product is polished and people come back: Product Hunt,
   French tech and HR media (Maddyness, Frenchweb, HR newsletters), a "Show HN" if the
   collector story (all career sites in France) interests developers. A one-off boost: use it
   when the product can keep the visitors it brings.

**Not yet:** paid ads. They only make sense once you know how much one user is worth and that
they come back; before that, you pay for visitors who leave.

### Phase 4: paying for itself (when usage is steady)

Each generated resume costs a Gemini call; the server has a monthly cost. Options, to decide
from the phase 1–3 numbers:

- **Free with limits, paid for more**: a few tailored resumes a week free, unlimited with a
  small monthly plan (students are price-sensitive: a few euros, or a pass for the job-search
  period).
- **Paid by organisations**: schools or job-support organisations pay for their members.
- **Employers**: paid visibility for offers. This changes the product (sponsored offers), so
  only if the first two don't work.

Billing is out of scope of the MVP (FEATURE.md); nothing to build until the numbers say so.

---

## 4. What to build, in order

From the phases above, the product work for the code:

| # | Feature | Phase | Why |
|---|---|---|---|
| 1 | ~~Cookie-free analytics (Umami) and events~~ built | 0 | Know what works |
| 2 | ~~Feedback button (form → email)~~ built | 0 | Hear what blocks people |
| 3 | ~~Global daily AI budget with alert~~ built | 0 | Keep costs under control |
| 4 | ~~Job alerts by email (saved searches)~~ built | 2 | Bring people back |
| 5 | ~~Installable web app (manifest, icon)~~ built | 2 | Phone users |
| 6 | ~~"Nouveau" marks~~ built; application reminders | 2 | Bring people back |
| 7 | Landing pages by contract type (alternance, stage) | 3 | Students' searches |
| 8 | Shareable examples / referral | 3 | Users bring users |

---

## 5. Numbers to watch

Weekly, in a table below (§6):

- **Visitors** and where they came from (Discord, Google, direct…).
- **Searches**, **offers opened**.
- **Activation:** visitors who generate at least one tailored resume. *The main number*:
  it's the moment MonPoste proves useful.
- **Retention:** people active in a week who were also active in an earlier week.
- **Accounts created.**
- **Alert clicks**: in Umami, Events → `alert_click`, with `sendHour` (the hour the email
  went out) and `link` (an offer or "see all"). To choose the send hour: two weeks at one
  hour (`ALERTS_SEND_HOUR` in `.env.production`, then `dc up -d api`), two weeks at
  another, and compare clicks per alert email sent (`dc logs --since 14d api | grep
  job_alerts_done` gives the emails sent).
- **AI cost** for the week (Gemini console).
- **Feedback received**, and what it was about.

---

## 6. Weekly log

| Week | Visitors | Generated ≥1 | Returning | Accounts | AI cost | What we tried | What we learnt |
|---|---|---|---|---|---|---|---|
| 2026-W43 | | | | | | | |

---

## 7. Feedback and interviews

One line per person: who (student, graduate, field), what they used, what blocked them, what
they'd want.

| Date | Who | What they did | What blocked | What they'd want |
|---|---|---|---|---|
| | | | | |

---

## 8. Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-17 | First circle: school Discord and friends; students and young graduates as the first target, to confirm in phase 1 | People we can reach now; they apply a lot and adapt their resume |
| 2026-10-17 | Growth plan kept apart from the technical docs, in `growth/` | Different purpose: experiments and results, not how the system works |
| 2026-10-17 | No paid acquisition before retention is proven | Paying for visitors who don't come back wastes money |
