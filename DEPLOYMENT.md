# Deployment

How to put the platform on a server and keep it running. Everything runs with Docker
Compose on one Linux server: the API, the job collector (worker), PostgreSQL, the web
server (Caddy, with automatic HTTPS) and a daily database backup. The stack steps (first
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

# Docker (official repository).
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy   # log out and back in afterwards
```

## 3. DNS

Create, at your DNS provider, before the first start (Caddy asks Let's Encrypt for the
certificate as soon as it starts, and that needs the domain to point to the server):

| Type | Name | Value |
|---|---|---|
| `A` | `monposte.com` | the server's IPv4 address |
| `AAAA` | `monposte.com` | the server's IPv6 address (if it has one) |
| `CNAME` | `www.monposte.com` | `monposte.com` (Caddy redirects it to the bare domain) |

Plus the email records of §5. Check with `dig +short monposte.com`.

## 4. First start

```bash
git clone <repository> ~/job && cd ~/job
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production    # fill in every value (comments explain each one)
```

A long random database password: `openssl rand -base64 32 | tr -d '/+='`. Use the same
password in `POSTGRES_PASSWORD` and in `DATABASE_URL`.

The API and the worker refuse to start when a required value is missing or still a
development one (HTTP addresses, `AI_PROVIDER=fake`, a local mail server…) and say which.

```bash
# All commands below are run from ~/job. To type less:
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
rsync -av data/esco data/boards-2026-10-15.json.gz deploy@monposte.com:job/data/
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

## 6. Backups and restore

The `backup` service writes `job-<date>.dump` to the `backups` volume every day at
`BACKUP_HOUR` (UTC) and removes those older than `BACKUP_KEEP_DAYS`. Uploaded files are in
the `storage` volume.

**Keep a copy off the server**: a backup on the same disk is lost with the server. For
example, every night on another machine (your computer, a NAS, a second small server):

```bash
# crontab -e on the other machine (needs SSH access to the server):
30 3 * * * rsync -a --delete deploy@monposte.com:/var/lib/docker/volumes/job_backups/_data/ ~/job-backups/db/ && ssh deploy@monposte.com 'docker run --rm -v job_storage:/s:ro alpine tar -cz -C /s .' > ~/job-backups/storage.tar.gz
```

(Volume names start with the compose project name, `job` when the folder is `~/job`:
check with `docker volume ls`. Reading `/var/lib/docker` needs root: either use
`sudo rsync` on the server side with `--rsync-path="sudo rsync"`, or copy the dumps out first
with `dc cp backup:/backups/. ~/backups/`.) Many hosts also sell daily server snapshots:
a good second layer.

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
Uploaded files: `docker run --rm -i -v job_storage:/s alpine tar -xz -C /s < storage.tar.gz`.

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

Docker's default log files grow without limit: cap them once in `/etc/docker/daemon.json`,
then `sudo systemctl restart docker`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
```

## 8. Costs to watch

- **Gemini**: set a budget with alerts in Google Cloud (Billing → Budgets & alerts), and
  check the per-user AI limits in `apps/api/src/config.ts`.
- **Email provider**: free tiers are usually ~300 emails/day; one per signup and per
  password reset.
- **Geoapify**: the free tier (3 000 requests/day) covers place autocomplete for a start.

## 9. Updates

```bash
cd ~/job
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
| `deploy/Caddyfile` | HTTPS, security headers (CSP, HSTS), caching, `/api` forwarding |
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
