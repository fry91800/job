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

### Landing pages by job and town

The searches people type ("offres développeur Lyon", "emploi infirmier Bordeaux"), as
server pages (`apps/api/src/seo/landing.ts`), without the app on top (its address handling
would leave them), with the app's stylesheet:

| Address | Page |
|---|---|
| `/emplois` | Hub: the jobs and towns with the most offers |
| `/emplois/{métier}` | A job across France (`/emplois/developpeur-developpeuse-informatique`) |
| `/emplois/{métier}/{ville-NN}` | A job in a town (`…/lyon-69`; the département number tells apart towns with the same name) |
| `/emplois/a/{ville-NN}` | Every job in a town |

* Jobs are the ROME occupations (French names, both genders as in the catalogue), linked to
  offers by enrichment; towns are the offers' places. Counts of open public offers per job,
  town and job-in-town are kept in memory, rebuilt every hour (~3 s on 34 000 offers).
* A page exists only with enough offers (`config.seo.landing`: 3 for a job or a job in a
  town, 5 for a town); below, or unknown: 404 with `noindex`. Thin pages hurt the whole site.
* Each page: a heading in the searched words, the count, the 30 newest offers (links to their
  pages), links to the same job in other towns and to other jobs in the town (internal links
  help search engines find and weigh the pages), a link to the app's search with the job and
  town filled in. Title, description, canonical, Open Graph; no JobPosting (Google wants it
  on the offer's own page only).
* `/sitemaps/landing.xml` lists them all (the sitemap index points to it). On the development
  data (34 000 offers): 4 588 pages: 373 jobs, 4 214 towns and jobs in towns. ~40 ms a page.


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

Indexing takes days to weeks for a new domain; Google decides how many offers it indexes,
based on the site's reputation and the pages' quality and uniqueness. Offers also published
by their employer compete with the original: Google for Jobs groups them and may show
several "apply on" options.

## Next steps worth considering

1. ~~Landing pages by job and place~~: built (above). Later: départements and regions
   ("emploi développeur Bretagne"), contract types ("alternance développeur Lyon"), and a
   short text per job (what the job is) to make pages more than lists.
2. **Readable offer addresses** (`/offres/developpeur-typescript-lyon-{id}`), with redirects
   from the current ones.
3. Server-rendered home page text (what MonPoste does), and the legal pages.
4. Page speed is already good (first load ~190 KB compressed); keep it so.
