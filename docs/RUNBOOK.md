# Runbook

How to run Smaran in production: set it up once, deploy, roll back, rotate a secret, restore from a backup,
add a game, add a doctor. Written to be followed at a bad moment: each section is commands in order, then
how you know it worked.

What has and has not been tested is in [What was rehearsed](#what-was-rehearsed). Read it once.

Contents: [The machine](#the-machine-one-time) · [Deploy](#deploy) · [A deploy failed](#a-deploy-failed) ·
[Roll back by hand](#roll-back-by-hand) · [Migrations](#migrations) · [Rotate a secret](#rotate-a-secret) ·
[Backups and restore](#backups-and-restore) · [Looking at it](#looking-at-it) · [Add a doctor](#add-a-doctor) ·
[Add a game](#add-a-game) · [What was rehearsed](#what-was-rehearsed)

Commands below run on the VM, in the deploy directory (`~/smaran` unless the `VM_DIR` variable says otherwise),
as the deploy user. `C="docker compose -f docker-compose.prod.yml --env-file .env"` is assumed; set it first:

```bash
cd ~/smaran
export C="docker compose -f docker-compose.prod.yml --env-file .env"
export IMAGE_TAG=$(cat state/current_tag)      # the compose file needs a tag for every command
```

---

## The machine, one time

**What you need:** a Linux VM with Docker and the compose plugin (`docker compose version` works), ports 80 and
443 open to the internet, a domain whose A record points at the VM, and a user that can run `docker`.

**1. The deploy user and key**

```bash
# on the VM
sudo adduser --disabled-password deploy && sudo usermod -aG docker deploy
# on your machine
ssh-keygen -t ed25519 -f smaran-deploy -N ""          # puts the private key in the VM_SSH_KEY secret
ssh-copy-id -i smaran-deploy.pub deploy@<vm>
```

**2. The `.env`.** Root-only in effect: mode 600, owned by the deploy user, in the deploy directory. Every name
is documented in the repository's [`.env.example`](../.env.example), second half. The minimum:

```bash
mkdir -p ~/smaran && cd ~/smaran && umask 077
cat > .env <<EOF
DOMAIN=smaran.example.org
GHCR_OWNER=<your github user or organisation, lower case>
POSTGRES_PASSWORD=$(openssl rand -base64 36 | tr -d '\n+/=')
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n+/=')
EXPORT_SALT=$(openssl rand -base64 36 | tr -d '\n+/=')
SMOKE_PASSWORD=$(openssl rand -base64 24 | tr -d '\n+/=')
ADMIN_EMAIL=you@example.org
ADMIN_PASSWORD=<a long one, 12 or more characters>
EOF
chmod 600 .env
```

Keep values to letters, digits and `. _ - / + =`: `deploy.sh` reads the file as shell. The backend **refuses to
start** in production if `JWT_SECRET` or the database password is missing, short, or one of the examples in
the repository, and the compose file refuses to start without `DOMAIN`, `GHCR_OWNER`, `POSTGRES_PASSWORD`
and `JWT_SECRET`. A start that fails this way is working as intended: read the backend's log line, it says which.

Optional: `ANTHROPIC_API_KEY` (the journal reading; without it entries are saved but not read),
`JOURNAL_MODEL`, `FCM_KEY`, `TWILIO_SID`, `TWILIO_TOKEN`, `BACKUP_HOUR`, `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`.

**3. GitHub.** Settings of the repository:

| Where | What |
|---|---|
| Secrets | `VM_HOST` (address), `VM_USER` (`deploy`), `VM_SSH_KEY` (the private key), `DOMAIN` |
| Environments | create `production`; add yourself as a required reviewer if you want to approve each deploy |
| Variables | `DEPLOY_ENABLED` = `true` (until then the deploy job is skipped; images still build and push) |
| Variables | `VM_DIR` only if not `~/smaran` |
| Packages (after the first push) | each of `smaran-backend` and `smaran-frontend`: keep private (the deploy logs the VM in to GHCR for the length of the deploy) or make public |
| Branches | protect `master`: require a pull request, require the `ci` checks (`frontend`, `backend`, `datascience`, `docker-build`, `security`, `e2e`) and `security / secrets`, no force-push |

**4. First deploy.** Merge to `master`, or run the `cd` workflow by hand with a commit sha (it must be one that
passed `ci`). `deploy.sh` registers the smoke account itself on its first run.

**Done when:** `https://<domain>/` loads, `https://<domain>/actuator/health` says `{"status":"UP"}`, and the
`deploy` job is green with `smoke 8: OK` in its log.

The VM's SSH host key is trusted on first contact by the workflow (`ssh-keyscan`). That is convenient and it is
the weakest link in the chain: if someone were in the path on that first connection they could be the "VM". To pin
it, add the VM's `ssh-keyscan -t ed25519 <host>` output as a `VM_HOST_KEY` secret and have the workflow write that
instead of scanning.

---

## Deploy

Normally you do nothing: a merge to `master` runs `ci`; when it is green `cd` builds
`ghcr.io/<owner>/smaran-{backend,frontend}:sha-<7 characters>` (and `:latest`), copies `deploy/` to the VM, and
runs `./deploy.sh sha-xxxxxxx`.

What `deploy.sh` does, in this order, and stops at the first thing that fails:

1. takes the lock (a second deploy at the same time says so and exits 3);
2. a backup of the database and media (`SKIP_BACKUP=1` skips it, do not);
3. pulls the two images and starts the stack on them (`up -d --wait`);
4. waits up to 300 s for `/actuator/health` to say UP **and** the page to be served, through the public address (the backend takes one to two minutes to start on a small VM);
5. runs `smoke.sh`: signs in as the smoke account, pairs a tablet to the smoke patient, has it send a session, reads
   the dashboard to see the session there, removes the tablet;
6. only then writes `state/current_tag` (and the old one to `state/previous_tag`).

Deploying the tag that is already running does nothing. By hand, from the VM:

```bash
cd ~/smaran && ./deploy.sh sha-1a2b3c4
```

**Re-deploy something older** (not a rollback, a fresh decision): Actions, `cd`, Run workflow, the full 40-character
sha of a commit that passed `ci`. It builds that commit and deploys it.

## A deploy failed

`deploy.sh` has already put the previous tag back when a deploy fails at step 3, 4 or 5; its log says
`ROLLING BACK to <tag>` and then `rolled back: <tag> is healthy again`. The failed `cd` run also opens an issue.

1. Read the failed step's log. `smoke FAILED at step N: ...` names what broke: 1 the public address and the API,
   2 sign-in, 3 the smoke patient, 4 pairing, 5 a tablet's session, 6 the dashboard.
2. Check where you are: `cat state/current_tag; tail state/history; $C ps`.
3. Look at the failed release's logs: `$C logs --tail 200 backend` (they are JSON, one event per line, each with
   a `requestId`).
4. Fix forward on a branch; it deploys when it merges.

**If the log says `the rollback itself is not healthy; this needs a person`** (or `there is no earlier release to go back to`, on a first deploy) the VM may be down. `./deploy.sh $(cat state/previous_tag)` by hand; if the
database is what is wrong, [restore](#backups-and-restore). The pre-deploy backup is the newest in `daily/`.

## Roll back by hand

```bash
cd ~/smaran
cat state/history                       # every successful deploy, newest last
./deploy.sh "$(cat state/previous_tag)"
```

This runs the whole of `deploy.sh` for the older tag (backup, pull, up, health, smoke test). The image has to still be
in GHCR or on the VM. It puts the **code** back, not the data.

## Migrations

A rollback cannot undo a database migration, so a migration must be written so that the release before it still runs
on the schema after it: **add before you remove.** To rename a column: ship a release that adds the new column and
writes both; ship the next that reads the new one; ship a third that drops the old one. A migration that breaks the
previous release is the one case where rolling back is not enough: stop the stack, [restore](#backups-and-restore) the
pre-deploy backup, then deploy the old tag.

---

## Rotate a secret

Do these one at a time. After each: `$C up -d` (compose recreates only what changed), then `curl -s
https://<domain>/actuator/health`.

| Secret | Effect, and how |
|---|---|
| `JWT_SECRET` | **Signs everyone out and unpairs every tablet** (device tokens are signed with it). Do it when the secret may have leaked; warn the families, and re-pair the tablets afterwards (the caregiver mints new codes). Change it in `.env`, `$C up -d backend`. |
| `POSTGRES_PASSWORD` | Change it in the database first, then in `.env`: `$C exec db psql -U smaran -d smaran -c "ALTER USER smaran PASSWORD '<new>'"`; edit `.env`; `$C up -d backend backup` (the `db` container does not need restarting). |
| `ADMIN_PASSWORD` | `ADMIN_EMAIL`/`ADMIN_PASSWORD` only create the first administrator, once. Changing the `.env` later changes nothing. Change the password in the app. |
| `EXPORT_SALT` | Changes every hash in the research export, so a new export cannot be joined to an old one. Only change it on purpose. |
| `SMOKE_PASSWORD` | Set at the account's creation, so changing only the `.env` makes the smoke test fail to sign in. Set a new `SMOKE_EMAIL` as well (`.env` is read by `smoke.sh` through `deploy.sh`); the new account is registered on the next deploy. |
| `VM_SSH_KEY` | New key pair, add the public half to `~/.ssh/authorized_keys`, replace the secret, remove the old half. |
| `ANTHROPIC_API_KEY` | Edit `.env`, `$C up -d backend`. |

A secret that was ever committed is a leaked secret, whatever you do to the history: rotate it. `gitleaks` runs on every
push to find that.

---

## Backups and restore

**What exists.** The `backup` container writes, every day at `BACKUP_HOUR` (02, UTC), and before every deploy:

```
/backups/daily/smaran-<stamp>.dump       the database (pg_dump -Fc, checked with pg_restore --list before it is kept)
/backups/daily/media-<stamp>.tar.gz      photographs and voice notes
/backups/weekly/...                      the Sunday set, kept longer
```

The newest 14 daily and 8 weekly sets are kept. A file is written under a temporary name and renamed when it is
complete, so a run that dies leaves nothing that looks like a backup and is not one. They live in the `backups`
Docker volume **on the same machine**: this protects against a bad deploy, a deleted row and a corrupted database,
**not against losing the VM.** For that, copy them off the machine on a schedule you control; for example from your
own computer:

```bash
ssh deploy@<vm> 'cd ~/smaran && docker compose -f docker-compose.prod.yml --env-file .env exec -T backup \
  tar -C /backups -cf - .' > smaran-backups-$(date +%F).tar
```

**List them**

```bash
$C exec -T backup ls -lt /backups/daily
```

**Restore** (replaces the whole database; everything written since the backup is lost)

```bash
cd ~/smaran
./restore.sh daily/smaran-20261009-020000.dump                                          # the database
./restore.sh daily/smaran-20261009-020000.dump daily/media-20261009-020000.tar.gz       # and the media
```

It stops caddy, the frontend and the backend; checks the dump (`pg_restore --list`); drops and recreates the
database; restores it; lays the media back over what is there (a file added since is left alone, nothing is deleted);
starts the application. Then: sign in, and look at a patient's dashboard.

**Done when:** `/actuator/health` is UP, you can sign in, and what you expected to be back is back.

**Test the restore.** Do this after any change to the backup, and once in a while for no reason. `make rehearse`
(or the `docker-build` job in CI) does it end to end on a throw-away stack: a backup, a deliberate change to the
database, the restore, and a check that the change is gone and the patient count is what it was.

---

## Looking at it

**Health.** `GET /actuator/health` and `/actuator/info` are public and say nothing else.

**Logs.** JSON, one event per line, each with `requestId`; the same id is returned to the caller as the
`X-Request-Id` response header, so "this request failed" becomes one `grep`:

```bash
$C logs --since 1h backend | grep '"requestId":"<id>"'
$C logs --since 1h backend | grep '"level":"ERROR"'
```

The application does not log passwords, tokens, pairing codes or request bodies (a pairing code is logged by its row id); log lines that name a person carry ids, not names. That comes from reading every log statement, not from a test, so a new log line is a thing to review.

**Metrics.** `/actuator/prometheus` needs an ADMIN sign-in, so it is not on the public internet for anyone. A
scrape needs a bearer token for an admin account. Counters worth watching:

| Metric | Means |
|---|---|
| `sessions_ingested_total{status}` | game sessions received, by what became of them: `accepted`, `duplicate` (dropped, already stored), `rejected` |
| `auth_failures_total` | failed sign-ins: a steady climb is someone guessing |
| `pairing_failures_total{reason}` | a wrong code (`wrong_code`) or a lock-out after too many (`locked`); `pairing_redeemed_total` counts tablets that did pair |
| `scoring_mismatch_total` | the server's re-score disagreed with the tablet's (`scoring_rescored_total` counts all re-scores): the two engines have drifted; the golden tests should have caught it |

Grafana and Prometheus are not set up here; the endpoint is what they would scrape.

---

## Add a doctor

A doctor registers like anyone else; what they can see is decided by people, not by the registration.

1. They register at `/caregiver/register`, choosing Doctor. The account is `PENDING`: signing in tells them an
   administrator has to approve it first.
2. An administrator signs in (`/caregiver/login`, with `ADMIN_EMAIL`) and is taken to `/admin`, which lists "Doctors
   waiting for approval"; approve there. (The same thing by API: `GET /api/admin/users?status=PENDING`, then
   `POST /api/admin/users/{id}/approve`.)
3. A caregiver of a patient grants the doctor access to **that patient**, for a number of days, from the patient's
   page (`POST /api/patients/{id}/doctor-grants` with the doctor's email and `days`). A doctor sees trends only,
   for the patients who granted them, until the grant expires; the caregiver can revoke it at any time
   (`DELETE .../doctor-grants/{grantId}`). Every grant and revocation is in the audit log.

To remove a doctor altogether: `POST /api/admin/users/{id}/disable`.

## Add a game

[`docs/ADDING_A_GAME.md`](ADDING_A_GAME.md) is the guide, with Duck Roll Call as the worked example. Nothing in
deployment changes: a game is frontend code plus a scoring function that has a Java twin and shared test vectors
(`make golden`). It reaches production the way everything does, by merging.

---

## What was rehearsed

Be clear about what has been shown to work and what has only been written.

**Run, on a developer machine and in CI** (`deploy/rehearse.sh`, `make rehearse`): the production compose file behind
Caddy with its own local certificate, a good release deploying and passing the smoke test, the same tag deployed
twice (no-op), a release whose backend never starts (rolled back, the good release running again), a release that
is healthy but whose API is broken (the smoke test fails it, rolled back), a backup, a deliberate change, and a
restore that removed it.

**Run once by hand, not in CI:** the Playwright suite against the production-shaped stack on `https://localhost:8443`.

**Not run:**
- Anything against a real VM or a real domain: no Let's Encrypt issuance, no deploy over SSH, no GHCR pull with a
  login. The first real deploy is the test of those. The workflows have been checked for syntax only.
- The media half of a restore (`restore.sh` with a second argument). The database half is exercised above.
- A restore onto a different machine from a backup that was copied off the first.
- A rollback after a migration that the previous release cannot run on. By design that needs the restore.

**Known limits.** The tablet loads Google Fonts and the MediaPipe model from a CDN on first use, so the very first
run of a new tablet needs internet; after that the service worker has them. The backups are on the same machine
unless you copy them off. The rollback is of code, not data.
