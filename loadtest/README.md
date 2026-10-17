# Load test

A small [k6](https://k6.io) script, `smaran.k6.js`, for the two paths that carry the system's weight: families reading a
dashboard, and tablets sending sessions. It is a smoke-level test: it finds out whether the code holds up under a few
tens of requests a second and roughly where it starts to bend. It does not say how a deployment would perform.

## Run it

Against a stack you can throw away: it pairs tablets to the demo patients and writes sessions into them, and it signs
in as the demo caregiver, so it works only against the demo profile.

```bash
make demo
docker run --rm -i -e BASE_URL=http://host.docker.internal:8081 grafana/k6 run - < loadtest/smaran.k6.js
#   or, with k6 installed:   BASE_URL=http://localhost:8081 k6 run loadtest/smaran.k6.js
```

Settings (environment variables): `RATE` sessions a second (5), `DURATION` (60s), `READERS` dashboard readers (10),
`TABLETS` paired tablets (8), `ARRIVAL` = `in-order` (default) or `late`.

- **Dashboard readers** each ask for a random patient's whole dashboard, one after another with no pause, which is far
  more than a person does (a family member opens it a few times a day).
- **Tablets** send one-session batches at a steady `RATE` to their paired patients. `in-order`: each session is the newest
  the patient has, as from a tablet that is online. `late`: each starts at a random time in the past, as the queue of a
  tablet that was offline does; the server then rebuilds that patient's profile from her whole history for every session.

Run it twice and read the second: the first run after a stack has sat idle for hours is slow while the JVM and the connection
pool warm up (a 15-second run at 5 a second gave an ingest 95th percentile of 2.3 s; the runs after it, 97 ms).

The pass marks are generous on purpose (no more than 1% failed requests; dashboard 95th percentile under 1.5 s; ingest
95th percentile under 800 ms).

## What it measured

On **one laptop** (Intel Core i5-1135G7, 8 logical processors; Docker Desktop with 8 CPUs and 3.7 GB for all containers),
with the demo stack of this repository (PostgreSQL 16, the backend, the PWA's nginx; no limits on any container) and
the load generator on the same machine. 16 October 2026.

| Sessions arrive | Offered rate | Ingest, average | Ingest, 95th percentile | Dashboard read, 95th percentile | Failed requests | Verdict |
|---|---|---|---|---|---|---|
| in order | 5 / s for 60 s | 65 ms | **127 ms** | 64 ms | 0 | passes |
| in order | 20 / s for 30 s | 59 ms | **95 ms** | 53 ms | 0 | passes |
| in order | 50 / s for 30 s | 2.0 s | 6.5 s | 1.8 s | 0 | **saturated**: about 25 sessions a second completed, the rest the generator could not send in time |
| in order | 100 / s for 30 s | 3.1 s | 7.5 s | 4.8 s | 0 | **saturated**: about 20 a second completed |
| late | 5 / s for 30 s | 529 ms | **1.04 s** | 82 ms | 0 | **fails the ingest mark** |

No request failed in any run: past its limit the system got slower, it did not drop or corrupt anything (every check on
the response, including "the session was accepted", held in the runs that completed).

## What to take from it, and what not to

- **For the pilot this is built for the headroom is very large.** A few hundred tablets, each sending a few sessions a day,
  is on the order of one session every minute or two. The in-order path was comfortable at 20 a second on this laptop, and is not the thing to worry about.
- **A session that arrives late is about ten times as expensive**, and its cost grows with the patient's history. Each late
  session makes the server rebuild her profile from all her sessions (the backend logs "arrived out of order, rebuilding the
  profile"). The eight patients in these runs had each already been given about 200 more synthetic sessions by the runs before this
  one, on top of their 75 days of history, so the 529 ms is for a long history, longer than a few months of one session a day. A tablet that comes back after days offline sends
  a batch of late sessions, each of which triggers a rebuild: rebuilding once per batch, instead of once per session, is the
  obvious improvement and is not made (it is in `docs/PROGRESS.md` as a known issue).
- **These are not capacity figures for a deployment.** One laptop runs the load generator and every service, with Docker
  Desktop between them; a VM with 1 to 2 CPUs, the limits in `deploy/docker-compose.prod.yml` (the backend gets 1.5 CPUs and
  768 MB), TLS in front, and a database that has been running for months will not give these numbers. The run also does
  not include the live dashboard stream (server-sent events), which holds one connection open per viewer; the number of
  simultaneous viewers a single backend can hold open has not been measured.
- The script found nothing that needed fixing for correctness. It found one cost worth a decision.
