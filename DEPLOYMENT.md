# Deployment

How to put the platform on a server and keep it running. Everything runs with Docker
Compose on one Linux server: the API, the job collector (worker), PostgreSQL, the web
server (Caddy, with automatic HTTPS), audience measurement (Umami) and a daily database
backup. The stack steps (first
start, catalogue and board import, backup, restore) were rehearsed on a local copy of it
(D137); the server, DNS and email steps depend on your providers.

```
Internet ──443──▶ web (Caddy) ──/api──▶ api ──▶ postgres ◀── worker
                     │ built frontend          ▲      ▲
                     └ HTTPS certificates      │      └── backup (daily dump)
                                         storage volume
```

| Service | Image (Dockerfile target) | Role |
|---|---|---|
| `web` | `web` (Caddy + built frontend) | The only public service: HTTPS, security headers, frontend files, `/api` forwarded to the API |
| `api` | `api` (Node 24, Chromium for PDFs) | Applies database migrations when it starts, then serves the API; runs the daily cleanup (guests, deleted accounts) |
| `worker` | `worker` (Node 24) | Job collector: collects, checks boards, closes old offers (COLLECTOR.md) |
| `postgres` | `postgres:17` | The database; not reachable from outside |
| `backup` | `postgres:17` + `deploy/backup.sh` | A compressed dump every day, kept 14 days |
| `umami` | `ghcr.io/umami-software/umami` | Audience measurement (§7.1): dashboard on `stats.monposte.com`, tracker under `/u/` on the site |
| `umami-db` | `postgres:17` | Creates Umami's database (`umami`, on the same PostgreSQL) if missing, then stops |

Data lives in named volumes: `pgdata` (database), `storage` (uploaded resumes and
photos), `backups`, `caddy_data` (certificates) and `caddy_config`.

## 1. Before going live

Decisions and accounts to have ready:

- [ ] **A server**: Ubuntu 24.04 LTS or Debian 12, at least 2 vCPU, 4 GB RAM, 40 GB disk
  (PostgreSQL with the catalogue and ~35 000 offers is about 2 GB; Chromium needs ~500 MB
  while rendering a PDF). In the EU, for the privacy policy (Hetzner, Scaleway, OVHcloud…).
- [ ] **The domain**: `monposte.com` (registered 2026-10-16; turn on auto-renewal), with
  access to its DNS records. `monposte.fr` was in its redemption period then: worth taking
  when it is released, redirected to the `.com`.
- [ ] **An email provider** with SMTP (Brevo, Postmark, Mailjet, Amazon SES…), for the
  address confirmation and password reset emails (§5).
- [ ] **API keys**: Gemini (with a billing budget alert set in Google Cloud, §8) and Geoapify.
- [ ] **An alert channel**: an incoming webhook from Slack, Discord or Mattermost (§7).
- [ ] **The legal pages filled in**: the operator's details in
  [apps/web/src/legal/operator.ts](apps/web/src/legal/operator.ts) (company, address,
  contact, host, email provider, date) and the two notes in brackets in
  [apps/web/src/legal/texts.ts](apps/web/src/legal/texts.ts). The texts are drafts: have
  them reviewed. They are built into the frontend, so commit them before deploying.
- [ ] **The ESCO files** (`data/esco/`, see COLLECTOR.md §8.1) and, to start with the boards
  already found, the board registry export (`data/boards-<date>.json.gz`).

## 2. Server setup (once)

As root on a fresh server:

```bash
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
```

Then log in as `deploy` with your SSH key and:

```bash
# Security updates installed automatically; SSH with keys only.
sudo apt update && sudo apt upgrade -y && sudo apt install -y unattended-upgrades git
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config && sudo systemctl restart ssh

# Firewall: SSH and the web only (Docker publishes 80 and 443 itself; PostgreSQL is
# never published).
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable

# Docker Engine and its Compose plugin from Docker's official apt repository (updated
# with the system by apt and unattended-upgrades; programs in /usr/bin, data in
# /var/lib/docker).
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy   # log out and back in afterwards; then `docker ps` works without sudo

# Docker's log files capped (they grow without limit otherwise).
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker

# The application's folder: /opt/monposte, owned by the admin user.
sudo mkdir -p /opt/monposte && sudo chown deploy:deploy /opt/monposte
```

Layout on the server:

| Path | Content |
|---|---|
| `/opt/monposte` | The repository (git clone), with `.env.production` (mode 600) and `data/` (catalogue files, board registry; not in git) |
| `/var/lib/docker/volumes/monposte_*` | The data: `pgdata` (database), `storage` (uploads), `backups`, `caddy_data` (certificates), `caddy_config` |
| `/etc/docker/daemon.json` | Docker settings (log size) |

## 3. DNS

Create, at your DNS provider, before the first start (Caddy asks Let's Encrypt for the
certificate as soon as it starts, and that needs the domain to point to the server):

| Type | Name | Value |
|---|---|---|
| `A` | `monposte.com` | the server's IPv4 address |
| `AAAA` | `monposte.com` | the server's IPv6 address (if it has one) |
| `CNAME` | `www.monposte.com` | `monposte.com` (Caddy redirects it to the bare domain) |
| `CNAME` | `stats.monposte.com` | `monposte.com` (the audience dashboard, §7.1) |

Plus the email records of §5. Check with `dig +short monposte.com`.

## 4. First start

```bash
git clone -b dev https://github.com/fry91800/job.git /opt/monposte && cd /opt/monposte
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production    # fill in every value (comments explain each one)
```

A long random database password: `openssl rand -base64 32 | tr -d '/+='`. Use the same
password in `POSTGRES_PASSWORD` and in `DATABASE_URL`.

The API and the worker refuse to start when a required value is missing or still a
development one (HTTP addresses, `AI_PROVIDER=fake`, a local mail server…) and say which.

```bash
# All commands below are run from /opt/monposte. To type less (add the line to ~/.bashrc
# to keep it):
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'

dc up -d --build        # builds the images (~5 min the first time) and starts everything
dc ps                   # api "healthy", the others "Up"
dc logs --tail 50 api web
```

Then open `https://monposte.com`: the site loads, with a valid certificate. Check
`https://monposte.com/api/health` → `{"status":"ok"}`.

### Catalogue and boards (once, then when they change)

The job catalogue (ROME, ESCO, skills) is needed for search and matching; the board
registry lets the collector start from the boards already found instead of searching for
them again. Copy the files from your computer to the server:

```bash
# On your computer, from the repository:
rsync -av data/esco data/boards-2026-10-15.json.gz admin@monposte.com:/opt/monposte/data/
```

Then on the server (the worker runs as user 1000, which is `deploy` on a fresh server; else
`sudo chown -R 1000:1000 data`):

```bash
dc run --rm -v ./data:/app/data worker npm run collector -- catalogue --esco data/esco
dc run --rm -v ./data:/app/data worker npm run collector -- boards import data/boards-2026-10-15.json.gz
dc run --rm worker npm run collector -- boards list
```

The catalogue import downloads ROME from France Travail and takes about 2 minutes. The
collector, already running, picks the boards up at its next scheduled pass (COLLECTOR.md);
the first offers appear within hours, the full collection takes about a day.

### Check that everything works

- [ ] Search engines: follow SEO.md "To do once the site is deployed" (Search Console, sitemap).
- [ ] Audience measurement set up (§7.1) and a test message sent with "Un avis ?" arrives
  at `contact@monposte.com`.

- [ ] Create an account on the site: the confirmation email arrives (check spam), its link
  works.
- [ ] "Forgot password": the email arrives, the link works.
- [ ] Import a resume, generate a resume for an offer, download the PDF.
- [ ] `dc run --rm api npm run ai:check` answers (one tiny Gemini request).
- [ ] An alert arrives in your channel (§7, test command).
- [ ] `dc exec backup sh /backup.sh now` writes a dump (§6).
- [ ] [securityheaders.com](https://securityheaders.com) and
  [ssllabs.com/ssltest](https://www.ssllabs.com/ssltest/) give an A.

## 5. Email

**Receiving.** The addresses the site shows or sends from must reach you: `contact@` (legal
pages), `bot@` (crawler contact), `admin@` (certificate notices), `dmarc@` (reports). The SMTP
provider below only sends. Free forwarding to your own mailbox is enough: your registrar's
email redirections (OVHcloud includes them) or Cloudflare Email Routing; it adds `MX` (and
SPF) records, which must sit alongside the provider's. A full mailbox (Proton, Infomaniak,
Google Workspace…) if you want to answer from `@monposte.com`.

**Sending.** The emails come from `MAIL_FROM`. For them to reach inboxes, the domain must prove the
provider may send for it. Your provider's dashboard gives the exact records; typically:

| Record | Purpose | Example |
|---|---|---|
| SPF (`TXT` on the domain) | Which servers may send | `v=spf1 include:<provider's> ~all` (one SPF record only: merge if one exists) |
| DKIM (`TXT` or `CNAME`, given by the provider) | Signs each email | as given |
| DMARC (`TXT` on `_dmarc`) | What to do with failures, and reports | `v=DMARC1; p=none; rua=mailto:dmarc@monposte.com` (move to `p=quarantine` after a few weeks of clean reports) |

Then verify the domain in the provider's dashboard and put its SMTP settings in
`.env.production` (`SMTP_HOST`, `SMTP_PORT` 587 with `SMTP_SECURE=false`, or 465 with
`true`; `SMTP_USER`, `SMTP_PASSWORD`). Test with [mail-tester.com](https://www.mail-tester.com):
send a password reset to its address. A failed send is logged (`email_not_sent`) and alerted.

**With Brevo** (the provider named in the privacy policy, `apps/web/src/legal/operator.ts`):

1. Create an account at brevo.com and complete the company profile (they may check new
   accounts before allowing larger volumes).
2. *Senders, Domains & Dedicated IPs → Domains → Add a domain*: `monposte.com`. Brevo shows
   the records to add at your DNS provider: a `brevo-code` `TXT` (ownership), DKIM and,
   if asked, DMARC. Add them, then *Authenticate* (minutes to a few hours).
3. *Senders → Add a sender*: `MonPoste`, `no-reply@monposte.com`.
4. *SMTP & API → SMTP*: generate an SMTP key. Settings:
   `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
   `SMTP_USER=` the login shown on that page, `SMTP_PASSWORD=` the key.
5. Turn off open and click tracking for transactional emails if the settings offer it: the
   privacy policy says there are no trackers, and rewritten links in password reset emails
   only add a detour.

To try it before deploying, put the same settings in the development `.env` (instead of
MailHog's), restart the API and ask for a password reset to your own address; put the
MailHog settings back afterwards.

## 6. Backups and restore

The `backup` service writes `job-<date>.dump` to the `backups` volume every day at
`BACKUP_HOUR` (UTC) and removes those older than `BACKUP_KEEP_DAYS`. Uploaded files are in
the `storage` volume.

**Keep a copy off the server**: a backup on the same disk is lost with the server. For
example, every night on another machine (your computer, a NAS, a second small server):

```bash
# crontab -e on the other machine (needs SSH access to the server):
30 3 * * * mkdir -p ~/monposte-backups/db && ssh admin@monposte.com 'docker run --rm -v monposte_backups:/b:ro alpine tar -c -C /b .' | tar -x -C ~/monposte-backups/db && ssh admin@monposte.com 'docker run --rm -v monposte_storage:/s:ro alpine tar -cz -C /s .' > ~/monposte-backups/storage.tar.gz
```

(The volumes are named after the compose project, `monposte`: `docker volume ls`. Going
through a container avoids needing root to read `/var/lib/docker`.) Many hosts also sell
daily server snapshots (Hetzner: backups option, 20 % of the server price): a good second
layer.

**Restore** (tested; ~10 seconds for the database with the catalogue). The database is
recreated empty, then filled from the dump (`pg_restore --clean` fails on the collector's
queue tables, so don't use it):

```bash
dc exec backup ls -lh /backups                     # choose a dump
dc stop api worker
dc exec backup sh -c 'dropdb --force "$PGDATABASE" && createdb "$PGDATABASE"'
dc exec backup sh -c 'pg_restore --no-owner --exit-on-error -d "$PGDATABASE" /backups/job-2026-10-16T0200.dump'
dc start api worker
```

A dump from another machine: `dc cp ./job-2026-10-16T0200.dump backup:/backups/` first.
Uploaded files: `docker run --rm -i -v monposte_storage:/s alpine tar -xz -C /s < storage.tar.gz`.

Try a restore every few months, on a copy of the stack if you can: an untested backup may
not work.

## 7. Monitoring and logs

**Alerts** go to `ALERT_WEBHOOK_URL` (Slack, Discord, Mattermost; the same alert is sent
at most once every 15 minutes): API errors (500), emails not sent, a failed daily cleanup
(the retention delays of the privacy policy depend on it), failed collector runs and jobs. Test the webhook:

```bash
curl -X POST -H 'Content-Type: application/json' -d '{"text":"test","content":"test"}' "<the webhook URL>"
```

**Uptime**: alerts come from inside; if the server is down, nothing is sent. Add an
external check of `https://monposte.com/api/health` every few minutes (UptimeRobot,
Better Stack… free plans are enough).

**Logs** are one JSON object per line (no personal data, no IP addresses); Docker keeps
them per container:

```bash
dc logs -f --tail 100 api                               # follow
dc logs --since 24h api | grep '"level":"error"'          # errors of the last day
dc logs --since 1h api | grep '"event":"request"' | grep -v '"status":2'   # failed requests
dc run --rm worker npm run collector -- metrics          # collector state (COLLECTOR.md)
```

Docker keeps at most 5 × 20 MB of logs per container (`/etc/docker/daemon.json`, §2).

### 7.1 Audience measurement and feedback

**Umami** (GROWTH.md §5) counts visits and the steps that matter (searches, resumes
uploaded and generated, PDFs downloaded, sign-ups…), without cookies and without storing IP
addresses; visitors whose browser sends "Do Not Track" are not counted. Its script and
collection endpoint are served on the site itself (`/u/script.js`, `/u/api/send`), its
dashboard on `https://stats.monposte.com`. Setting it up, once:

1. The DNS record `stats.monposte.com` (§3), and `UMAMI_APP_SECRET` in `.env.production`
   (`openssl rand -hex 32`).
2. `dc up -d` starts it (`umami-db` creates its database first). Open
   `https://stats.monposte.com` **right away** and log in with Umami's default account
   (`admin` / `umami`), then change its password (Settings → Profile): the dashboard is
   public until you do.
3. Settings → Websites → Add website: name MonPoste, domain `monposte.com`. Copy its
   *Website ID* into `UMAMI_WEBSITE_ID` in `.env.production`, then `dc up -d api` (no
   rebuild: the app reads it from `/api/public-config` at start).
4. Open the site in a private window and click around: the visit shows in the dashboard
   within a minute ("Realtime"). Events are under *Events*.

Umami's data is not in the daily backup (only the application's database is); losing it
loses statistics only. The privacy policy says statistics are kept 25 months at most:
Umami keeps everything, so delete older data once a year when the site is two years old
(Settings → Websites → Data → Reset, or SQL on the `umami` database).

**Feedback**: the app's "Un avis ? Un problème ?" button (sidebar, account menu) emails the
message to `FEEDBACK_EMAIL` (`contact@monposte.com` by default), with *Reply-To* set to the
sender's address when they give one. Nothing is stored. A message that can't be sent is
alerted (`feedback-not-sent`).

## 8. Costs to watch

- **Gemini**: each task has its model (D157): Gemini 3.8 Flash rewrites resumes (~$0.01 a
  resume at 2027 prices, half that in 2026), Gemini 3.5 Flash-Lite reads resumes, offers and
  job pages and translates (~$0.001–0.003 a call). Change them with `AI_MODEL_GENERATE`,
  `AI_MODEL_EXTRACT`, `AI_MODEL_TRANSLATE` after comparing with `npm run ai:compare` (on a
  development copy: it writes a side-by-side report in `data/ai-compare/`). A new model
  needs its price in `backendConfig.ai.prices` (else it is counted at the highest price).

  The API and the worker stop calling the AI for the rest of the day (UTC) once
  the day's estimated spending reaches `AI_DAILY_BUDGET_USD` ($2 by default, ~200 rewritten
  resumes plus their uploads); users then
  see "AI features are paused until tomorrow", and the rest of the site works. The
  collector's bot pages stop at half of it, so they never use the users' part. An alert goes
  out at 80 % and when it is reached. The estimate uses each call's token counts and the
  model's price (Gemini 3.x Flash at its 2027 price, double the 2026 one). Spending per
  day, task and model:

  ```bash
  dc exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT day, task, model, calls, round(cost_usd::numeric, 3) AS usd FROM ai_usage ORDER BY day DESC, usd DESC LIMIT 30"'
  ```

  Also set a budget with alerts in Google Cloud (Billing → Budgets & alerts) as a second
  safety net, and check the per-user AI limits in `apps/api/src/config.ts`.
- **Email provider**: free tiers are usually ~300 emails/day (Brevo's too); one per signup
  and per password reset, and **one per job alert with new offers each morning**: a few
  hundred users with daily alerts reach it. Watch Brevo's statistics, and move to a paid
  plan (Brevo Starter: ~20 000 emails/month for a few euros) before the limit: past it,
  password resets stop too. Alerts sent per run: `dc logs --since 24h api | grep job_alerts_done`.
- **Geoapify**: the free tier (3 000 requests/day) covers place autocomplete for a start.

## 9. Updates

```bash
cd /opt/monposte
git pull
dc up -d --build          # rebuilds what changed; the API applies new migrations when it starts
dc ps && dc logs --tail 30 api worker
```

The site is unavailable for the few seconds the API restarts. Before an update with a
database migration, make a backup first (`dc exec backup sh /backup.sh now`).

**Going back**: `git checkout <previous commit>` and `dc up -d --build`. Migrations only go
forward: if the bad update changed the database, restore the backup made before it (§6).

After a catalogue or matching change (COLLECTOR.md §16):
`dc run --rm worker npm run collector -- reenrich`.

To save the board registry (to start another server, or as a spare):
`dc run --rm -v ./data:/app/data worker npm run collector -- boards export`.

## 10. Reference

| File | Role |
|---|---|
| `Dockerfile` | The images: `api`, `worker`, `web` |
| `docker-compose.prod.yml` | The production stack (`ENV_FILE` picks another settings file, for rehearsals) |
| `.env.production.example` | Every production setting, commented |
| `deploy/Caddyfile` | HTTPS, security headers (CSP, HSTS), caching, `/api` forwarding, Umami's tracker (`/u/`) and dashboard (`stats.`) |
| `deploy/backup.sh` | Daily dump and retention; `sh /backup.sh now` for one dump |
| `apps/web/public/bot.html` | The page the collector's user agent points to (`CRAWLER_CONTACT_URL`) |
| `apps/api/src/lib/production-check.ts` | Settings the API checks before starting |

**Rehearsing locally** (another project name and ports, nothing shared with the
development stack; `DOMAIN=localhost` makes Caddy use its own local certificate):

```bash
ENV_FILE=.env.rehearsal docker compose -p jobrehearsal -f docker-compose.prod.yml --env-file .env.rehearsal up -d --build
# https://localhost:8443 (with HTTP_PORT=8080, HTTPS_PORT=8443 in .env.rehearsal)
ENV_FILE=.env.rehearsal docker compose -p jobrehearsal -f docker-compose.prod.yml --env-file .env.rehearsal down -v
```

Leave the worker stopped in a rehearsal (`… stop worker`) unless it should really collect.
