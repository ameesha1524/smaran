# Architecture

How Smaran is put together and how it gets to a machine. This is the map; [PLAN.md](PLAN.md) has the reasoning
behind the product, [rbac-architecture.md](rbac-architecture.md) has who may see what, and the
[RUNBOOK](RUNBOOK.md) has what to do when it is running.

## The system in one picture

```mermaid
flowchart LR
  subgraph Devices
    T["Tablet (PWA)<br/>works offline:<br/>IndexedDB + Service Worker"]
    F["Family / doctor / admin<br/>(browser)"]
  end

  subgraph VM["One VM, Docker Compose"]
    C["Caddy<br/>TLS, automatic certificate<br/>:80 / :443 (only published ports)"]
    N["frontend: nginx<br/>serves the PWA<br/>proxies /api, /actuator/health"]
    B["backend: Spring Boot 3, Java 21<br/>/api/**  /actuator/*"]
    D[("PostgreSQL 16<br/>no published port")]
    K["backup<br/>pg_dump + media tar, nightly"]
    M[("media volume<br/>photographs, voice notes")]
  end

  A["Anthropic API<br/>(journal reading, optional)"]
  G["GHCR<br/>images by tag"]

  T -- "HTTPS" --> C
  F -- "HTTPS" --> C
  C --> N --> B
  B --> D
  B --- M
  K --> D
  K --> M
  B -. "optional" .-> A
  G -. "docker compose pull" .-> VM
```

Everything the browser talks to is **one origin**: Caddy takes the request, nginx either returns a file or forwards
`/api` to the backend. That is why there is no CORS in production, and why the tablet's single address is the
domain and nothing else. The database is on a Docker network marked `internal`, with no route in from outside or out.

## What runs where

| Piece | What it is | Notes |
|---|---|---|
| `frontend/` | React 18, Vite, TypeScript, PWA | After the first load and pairing it runs with no server at all; writes queue in IndexedDB and are sent later |
| `backend/` | Spring Boot 3.3, Java 21, JPA, Flyway, JWT | Stateless; the schema is in `db/migration`; scoring has a twin in the frontend with shared golden vectors |
| `data-science/` | Python | Not deployed. Reads the admin export; simulation and evaluation |
| `deploy/` | Compose file, Caddyfile, `deploy.sh`, `smoke.sh`, `backup.sh`, `restore.sh`, `rehearse.sh` | What goes on the VM |
| `e2e/playwright/` | Browser tests | Run against a built stack in CI and by `make e2e` |

Images: `ghcr.io/<owner>/smaran-backend` and `smaran-frontend`, tagged `sha-<7>` and `latest`. Both are multi-stage
builds, run as a non-root user, and have a health check. Nothing secret is in either: configuration is environment
variables read at start (twelve-factor), and the backend **refuses to start** in production without a real JWT
secret and database password.

## Request path and what the proxy decides

```mermaid
sequenceDiagram
  participant B as Browser or tablet
  participant C as Caddy
  participant N as nginx (frontend)
  participant S as Spring Boot
  participant P as PostgreSQL

  B->>C: GET /api/patients/…  (HTTPS)
  C->>N: X-Request-Id (new), X-Forwarded-For/Proto
  N->>S: same, plus the id
  S->>S: RequestIdFilter (id into the log context)<br/>JwtAuthFilter, access rules
  S->>P: query
  S-->>B: response, X-Request-Id: <id>
  Note over C,S: The id is in every log line of this request.<br/>A caller's own X-Request-Id is replaced by Caddy.
```

- `/actuator/health` and `/actuator/info` are public and reach the backend through nginx. `/actuator/prometheus`
  and everything else under `/actuator` is not forwarded by nginx and in the backend needs an ADMIN sign-in.
- Rate limits for sign-in and pairing count the real client address, which is taken from the proxy headers
  (`server.forward-headers-strategy: native`, trusted only from private ranges).
- Security headers (CSP, HSTS, `X-Content-Type-Options`, frame and referrer policy) are set at the proxies; the
  Service Worker file is never cached.

## From a merge to a running release

```mermaid
flowchart TD
  PR["Pull request"] --> CI
  subgraph CI["ci.yml: every push and pull request"]
    direction LR
    c1["frontend: typecheck, Vitest,<br/>golden file, build"]
    c2["backend: mvn verify<br/>(Testcontainers, authorization matrix,<br/>pairing, observability)"]
    c3["datascience: pytest,<br/>golden parity, small-N sim"]
    c4["docker-build: images, Trivy,<br/>deploy/rehearse.sh"]
    c5["security: gitleaks, npm and pip audit,<br/>Trivy fs"]
    c6["e2e: compose stack,<br/>smoke.sh, Playwright"]
  end
  SEC["security.yml: CodeQL, audits, image scan<br/>on pull request, master, and weekly"]
  PR --> SEC
  CI -- "merge to master, green" --> CD
  subgraph CD["cd.yml"]
    direction TB
    bp["build-and-push<br/>GHCR: sha-xxxxxxx and latest"] --> dep
    dep["deploy (environment: production,<br/>only if DEPLOY_ENABLED)"] --> note["notify: summary,<br/>issue on failure"]
  end
  dep -- "ssh" --> VMd
  subgraph VMd["on the VM: deploy.sh"]
    direction TB
    s1["backup"] --> s2["pull, up --wait"] --> s3{"health UP and<br/>page served?"}
    s3 -- no --> rb
    s3 -- yes --> s4{"smoke.sh passes?"}
    s4 -- no --> rb["put the previous tag back,<br/>exit non-zero"]
    s4 -- yes --> ok["record the tag as current,<br/>the old one as previous"]
  end
```

The smoke test signs in, pairs a tablet, has it send a session, and reads the session back from the dashboard: it
checks that the system does its job, which a health check does not. A release that is "healthy" with a broken API
fails it and is rolled back (that case is built and run in `deploy/rehearse.sh`).

**What a rollback is.** It runs the previous image tag again. It does not change the database, so migrations must be
compatible with the release before them ([RUNBOOK, Migrations](RUNBOOK.md#migrations)). The VM keeps
`state/current_tag`, `state/previous_tag` and `state/history`.

## Configuration

Two sets of names, one file format: `.env.example` documents both.

```mermaid
flowchart LR
  E1[".env on the VM<br/>JWT_SECRET, POSTGRES_PASSWORD,<br/>DOMAIN, GHCR_OWNER, …"] --> CP["docker-compose.prod.yml<br/>maps them"]
  CP --> ENV["SMARAN_* environment<br/>in the backend container"]
  ENV --> APP["application.yml<br/>(prod profile)"]
  APP --> SC["StartupChecks<br/>refuse to start on a missing,<br/>short or example secret"]
```

GitHub holds only what CD needs to reach the VM (`VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `DOMAIN`); the application's
secrets live on the VM and nowhere else.

## Observability

- **Logs:** JSON to stdout, one event per line, with `requestId`. `docker compose logs` is the interface.
- **Health:** `/actuator/health` (public). The container health check, `deploy.sh` and the public check in CD all use it.
- **Metrics:** `/actuator/prometheus` (admin only): `sessions_ingested_total{status}`, `auth_failures_total`,
  `pairing_failures_total{reason}`, `pairing_redeemed_total`, `scoring_rescored_total`, `scoring_mismatch_total`,
  plus the JVM and HTTP metrics Micrometer gives for free.
- **Audit:** who did what to whose data is a table in the database, not a log (`/api/admin/audit`).

## Data and backups

PostgreSQL holds everything except the photographs and voice notes, which are files in the `media` volume. The
`backup` container writes a checked `pg_dump` and a media tarball nightly and before every deploy, keeping 14 daily
and 8 weekly sets, in a volume on the same machine. Copying them off the machine is the operator's job (see the
RUNBOOK); `restore.sh` puts a chosen set back.

## What this deliberately is not

One VM, not a cluster: a pilot for a few families does not need, and could not operate, more. There is one of each
service, so a deploy has a short moment in which the backend restarts (the tablets do not notice, they work
offline). There is no Redis, no message queue and no separate identity provider. If the load or the number of
families ever calls for more, the seams are already there: the backend is stateless, the database is a connection
string, media is a directory.
