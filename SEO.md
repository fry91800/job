# Search engines (SEO)

How MonPoste's offers get found on Google, Bing and Google for Jobs. Built 2026-10-17.

## What is built

The web app builds its pages in the browser, so a search engine reading the raw HTML saw an
empty page. Offer pages are now sent with their content:

| Address | Answered by | Content |
|---|---|---|
| `/offers/{id}` | API (`apps/api/src/seo/`), through Caddy | The app's page (its built `index.html`) with the offer in HTML inside the app's root element, its own `<title>`, meta description, canonical address, Open Graph tags and schema.org `JobPosting` |
| `/sitemap.xml` | API | Index of the offer sitemaps |
| `/sitemaps/offers-{n}.xml` | API | Open public offers, 45 000 per file, with their last change; the home page in the first |
| `/robots.txt` | API | Everything allowed except the personal pages (`/resumes`, `/photos`, `/saved`, `/generated`, `/settings`, `/add-offer`); the sitemap's address |

* **Everyone gets the same page.** Visitors and search engines receive the same HTML; the app
  starts on top of it and shows the same offer in its tab. Showing search engines something
  else (cloaking) is penalised by Google.
* **`JobPosting`** (Google for Jobs) only for open offers with a company and a place (or fully
  remote), as Google requires: title, description (HTML), publication date, expiry (the
  sources' earliest deadline), contract when it maps to Google's types (internship, temporary,
  freelance), company and its website, place, salary, `directApply: false`. Data is escaped so
  it can't end the block early; the page's security policy (no inline scripts) doesn't apply to
  data blocks.
* **Closed offers**: "Cette offre n'est plus disponible", `noindex`, no `JobPosting` (Google
  asks to remove the markup of expired jobs). **Private offers** (added by users) and unknown
  ids: status 404 with the app's page and `noindex`.
* **Attribution**: each page links to the original offer ("Voir l'offre d'origine et
  postuler", `nofollow`) and names its source (Choisir le service public, the employer's career
  site).
* The API serves offer pages only when `WEB_DIST_DIR` points to the built app (production: the
  API image carries it, `/app/web-dist`). In development, Vite serves `/offers/…` as before.
* The description Markdown → HTML conversion is shared with the web app
  (`packages/shared/src/markdown.ts`).

### Landing pages by job and place

The searches people type ("offres développeur Lyon", "alternance commercial Bretagne",
"stage marketing Paris"), as server pages (`apps/api/src/seo/landing.ts`), without the app on
top (its address handling would leave them), with the app's stylesheet.

Three families of pages (scopes), each with the same addresses:

| Scope | Prefix | Offers |
|---|---|---|
| All offers | `/emplois` | every open public offer |
| Apprenticeships | `/alternance` | contract `apprenticeship` |
| Internships | `/stage` | contract `internship` |

| Address (after the prefix) | Page |
|---|---|
| (none) | Hub: the jobs, regions, départements and towns with the most offers |
| `/{métier}` | A job across France (`/emplois/developpeur-developpeuse-informatique`) |
| `/a/{ville-NN}` | Every job in a town (`/emplois/a/lyon-69`; the département number tells apart towns with the same name) |
| `/departement/{nom-NN}` | Every job in a département (`/emplois/departement/rhone-69`) |
| `/region/{nom}` | Every job in a region (`/alternance/region/bretagne`) |
| `/{métier}/{ville-NN}` | A job in a town |
| `/{métier}/departement/{nom-NN}` | A job in a département |
| `/{métier}/region/{nom}` | A job in a region |

* Jobs are the ROME occupations (French names, both genders as in the catalogue), linked to
  offers by enrichment; places are the offers' towns, with their département and region
  (from the location table). Counts per scope, job, place and job in place are kept in
  memory, rebuilt every hour (~1.5 s for the three scopes on 46 000 offers).
* A page exists only with enough offers (`config.seo.landing`: 3 for a job or a job in a
  place, 5 for a place); below, or unknown: 404 with `noindex`. Thin pages hurt the whole
  site.
* Each page: a heading in the searched words ("Alternance Développeur à Lyon", "Offres
  d'emploi en Bretagne", "dans le Grand Est", "– Rhône (69)"), the count, the 30 newest
  offers (links to their pages), links to the same job in other places and to other jobs in
  the place, to the wider places (town → département → region), to the same page in the
  other scopes ("Voir aussi"), and to the app's search with the job, town and contract filled
  in. Title, description, canonical, Open Graph; no JobPosting (Google wants it on the
  offer's own page only).
* The landing sitemaps (`/sitemaps/landing.xml`, then `landing-2.xml`… past 45 000 pages)
  list them all; the sitemap index points to them. On the development data (46 000 offers):
  13 725 pages (emplois 12 228, stage 1 153, alternance 344).

### Instant indexing (Google's Indexing API, IndexNow)

Instead of waiting for the crawlers to read 100 000 offer pages, the API tells the search
engines about each new and closed offer (`apps/api/src/seo/indexing.ts`, every 30 minutes):

* **IndexNow** (Bing, Yandex, Seznam, Naver; Bing feeds DuckDuckGo, Ecosia, Qwant): every
  new or closed public offer page, up to 10 000 addresses a request. The key proves the site
  is ours: it is served at `/indexnow/{key}.txt`.
* **Google's Indexing API**, meant for pages with JobPosting: `URL_UPDATED` for a new offer,
  `URL_DELETED` for a closed one, offers with JobPosting only. Its quota is 200 a day by
  default: the newest offers go first, a quarter of the quota is kept for closed ones, what
  doesn't fit is left to the sitemaps. More quota can be asked from Google once the site is
  established.
* Each engine has a cursor (table `search_indexing`): offers opened or closed after it are
  told on the next run; a failed run leaves it, so the next run tries again, and sends an
  alert. A first run only tells the last day's changes.
* Off until configured: `INDEXNOW_KEY`, `GOOGLE_INDEXING_CREDENTIALS_BASE64` in
  `.env.production` (below).

## To do once the site is deployed (you)

1. **Google Search Console** (search.google.com/search-console): add the property
   `monposte.com` as a *domain* property; verify it with the `TXT` record it gives (at your
   DNS provider).
2. Search Console → *Sitemaps*: submit `https://monposte.com/sitemap.xml`.
3. Test one offer page with Google's *Rich Results Test* (search.google.com/test/rich-results):
   it should find a valid "Job posting". *URL inspection* in Search Console can request its
   indexing.
4. **Bing Webmaster Tools** (bing.com/webmasters): import the site from Search Console (one
   click); Bing also feeds other search engines (DuckDuckGo, Ecosia, Qwant).
5. Watch, in Search Console: *Pages* (indexed or not, and why) and *Job postings*
   (enhancements: errors and warnings in the markup).
6. **IndexNow** (no account): on the server, `openssl rand -hex 16`, and put the result in
   `.env.production` as `INDEXNOW_KEY=…`.
7. **Google's Indexing API** (a service account, about 10 minutes):
   1. console.cloud.google.com → create a project ("MonPoste").
   2. *APIs & Services → Library* → "Web Search Indexing API" → *Enable*.
   3. *IAM & Admin → Service accounts → Create service account* ("indexing"), no role →
      *Done*. Open it → *Keys → Add key → Create new key → JSON*: a file downloads.
   4. Search Console → *Settings → Users and permissions → Add user*: the service account's
      address (`indexing@….iam.gserviceaccount.com`), permission **Owner** (Google requires
      it for this API).
   5. Copy the file to the server, then `base64 -w0 key.json` and put the result in
      `.env.production` as `GOOGLE_INDEXING_CREDENTIALS_BASE64=…`; delete the file from the
      server and keep a copy somewhere safe (it is a password).
8. `dc up -d api` to apply. The API's log shows `search_indexing_done` with the counts every
   30 minutes (`dc logs api | grep search_indexing`).

Indexing takes days to weeks for a new domain; Google decides how many offers it indexes,
based on the site's reputation and the pages' quality and uniqueness. Offers also published
by their employer compete with the original: Google for Jobs groups them and may show
several "apply on" options.

## Next steps worth considering

1. ~~Landing pages by job and place~~, ~~départements, regions, apprenticeships and
   internships~~: built (above). Later: a short text per job (what the job is, salaries seen)
   to make pages more than lists; links from each offer page to its landing pages.
2. **Readable offer addresses** (`/offres/developpeur-typescript-lyon-{id}`), with redirects
   from the current ones.
3. Server-rendered home page text (what MonPoste does), and the legal pages.
4. Page speed is already good (first load ~190 KB compressed); keep it so.
