# Phase 6 explained: getting it onto a machine, and knowing when it breaks

Until now Smaran ran where someone ran it by hand. This phase is about the days after that: a change is
approved, and a few minutes later it is running for real families, and if it is not working, the machine puts
the old version back before anyone notices.

What this phase did **not** do, plainly: nothing here has run on a real server or a real web address, and the
GitHub automation has never run on GitHub. What has run is the same scripts, on one computer, against the same
configuration. The difference matters; the last section lists it.

## What changed, in plain words

| Before | After |
|---|---|
| "How do I run it?" was several terminals and a README | Two containers (the app and the API) and a database, started by one command, in development and in production |
| Secrets could be left at their example values | The server refuses to start in production if the signing secret or the database password is missing, short or an example from this repository |
| A deploy was someone copying files | Merging a change builds it, tests it, scans it, publishes it, puts it on the server, and checks that it can really do its job |
| If a release was broken, you found out from a person | The check signs in, pairs a tablet, sends a session and reads it back. If that fails the previous version comes back automatically |
| "It's slow / it's wrong" had no handle | Every request has an id that appears in every log line it caused and in the reply, so one search finds the story |
| Nobody could see how many sign-ins failed | Counters for failed sign-ins, wrong pairing codes, sessions received and dropped as duplicates, and scores that disagreed |
| The database existed in one place | A copy every night and before every deploy, checked when written, and a documented way to put it back, which is exercised, not just written down |

## The shape of it

One computer runs four things. **Caddy** is the front door: it gets and renews the HTTPS certificate by itself and
passes everything on. **nginx** hands out the app's files and passes `/api` to the **backend**. The backend talks
to **PostgreSQL**, which has no door to the outside at all. A fifth small container makes the nightly copy.

Because the browser only ever talks to one address, there is no cross-site configuration to get wrong, and the
tablet needs to know exactly one thing: the domain.

## What happens when a change is merged

1. **CI** runs on every change: the front end's type check and tests; the back end's tests against a real
   PostgreSQL, including the table that says who may see what and the pairing tests; the data-science tests; both
   images built and scanned for known vulnerabilities; the secrets scanner; and a real browser driving a running
   copy.
2. When CI is green on `master`, **CD** builds the two images, tags them with the commit, and publishes them.
3. If the deployment switch is on, a **deploy job** (in an environment you can require a person to approve) copies the
   scripts to the server and runs `deploy.sh`.
4. `deploy.sh` takes a backup, starts the new version, waits until it says it is well **and** serves the page, then
   runs the **smoke test**. Only then does it write down "this is the current version".
5. If any of those fails, it starts the previous version again and exits with an error. CD opens an issue.

The smoke test exists because "the server says it is healthy" and "the product works" are different statements. The
rehearsal includes a release built to say it is healthy while every API call fails; the health check passes it and the
smoke test stops it.

## What a rollback can and cannot do

It puts the **code** back. It does not undo what the new version did to the database. That is why the rule for
database changes is *add before you remove*: a release that adds a column is safe for the version before it, and the
release that stops using the old column can only go out once nothing needs it. For the case where that rule was broken,
the backup taken just before the deploy is the way back, and the runbook says how.

## What it watches

Logs are one JSON object per line, with the request id. Metrics are at `/actuator/prometheus`, readable only by an
administrator; nginx does not even forward that path. The counters are chosen to answer questions that come up: is
someone guessing passwords (`auth_failures_total`), is someone trying pairing codes (`pairing_failures_total`), are
tablets sending data (`sessions_ingested_total`), are the two scoring engines still in agreement
(`scoring_mismatch_total`).

While reading every log statement, I found that the notification stubs wrote family members' names, a caregiver's
email and the text of reminders to the log. Nothing sensitive should be there; those lines now carry ids only.
No test guards this, so a new log line is something to review.

## What was checked, and what was not

**Checked, by running it:**
- both images build, run as a non-root user, and pass their health checks;
- the production configuration (behind Caddy with its own certificate) serves the app, forwards the API, refuses the
  admin endpoints from outside, and a browser can register a family, add a patient, pair a tablet and remove it;
- `deploy.sh`: a good release deploys and passes the smoke test; the same release again does nothing; a release that
  never starts is rolled back; a release that starts but cannot do its job is rolled back;
- a backup, a deliberate change to the database, and a restore that removes it;
- the whole backend suite (107 unit and 429 integration tests, including the new observability tests) and the front end's
  145 tests.

**Written, but not run:**
- the GitHub workflows: they parse, and the first run is the test;
- anything over SSH, the login to the image registry, and the certificate from Let's Encrypt;
- the media half of a restore (the database half was run);
- the vulnerability scan: it failed to run on this machine, so its first result will come from CI. The framework version is old, so expect
  it to find something that has a fix.

**What you need to do** is in `docs/PROGRESS.md` ("Needs the human", H5, H13, H14) and `docs/RUNBOOK.md` ("The machine,
one time"): a server, a domain, the server's secrets, the GitHub secrets and the switch, branch protection, and a
real broken deploy to see it roll back.
