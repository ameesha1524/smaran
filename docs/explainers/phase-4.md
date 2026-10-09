# Phase 4 explained: from a game on her tablet to a number on her family's phone

Before this phase, a game told the server how much of the sitting she had done, and the
dashboard drew a chart from that. Now every game says, round by round, what happened; the
tablet scores it and says why in plain words; the server checks it, stores it, works out where
she stands against her own usual, raises an alert when it matters, and tells the family's
screen the moment it happens.

All data here is synthetic. Nothing in this phase makes any clinical claim.

## What changed, in plain words

| Before | After |
|---|---|
| A game reported one number, how much she finished | A game reports every round it saw (the "trials"), and its own module turns them into scores with a stated reason |
| Three of the games kept no record of what she did | All of them do. Duck Roll Call logs the fields the specification asks for; the others log what a person can honestly count |
| The server believed whatever 0 to 1 numbers arrived | The server refuses a session with an unknown game, a score outside 0 to 100, a start time in the future, or a score for something that game does not measure |
| A session that arrived late was added to the end | It is put in its place: the whole profile is rebuilt in order, and the result is the same as if it had arrived on time |
| Alerts were computed on the fly, two of them from nothing the games measured | Alerts are stored. They open when a pattern starts, update while it lasts, and end when she is back to her own usual |
| A dashboard showed demo data if the server was away | It shows what the server stored, says "too early to say" where a few sessions cannot tell a pattern from a bad day, and a refusal is a refusal |
| A doctor saw the family's names | A doctor sees her trends, markers, alerts and sessions, and nothing about who visits |
| The dashboard had to be reloaded | It updates by itself within a second or two of a session arriving |
| Her journal was read by a model called from the tablet | It is read by a model called from the server, and only the readings are kept: never her words |

## How a session travels

1. **She finishes a game.** The game hands over its trials: for Duck Roll Call each round's span, flash time,
   whether she got it first time, where her first mistake fell, how long before she began.
2. **The game's module scores it.** Each game has one module that says what the trials mean: what raw score (0 to 100)
   for which domain, how confident that is (from how many trials there were), and a sentence saying why.
3. **The tablet folds it into her profile once**, so it is right even with no signal.
4. **The tablet queues an envelope** (the trials, the scores and the reasons) and sends it when it can.
5. **The server checks it, stores it, rescores it if it can, and folds it into her profile**, writes a snapshot of where
   she stands, opens or ends alerts, and sends "something changed" to anyone watching her dashboard.
6. **The dashboard asks again** for the numbers it needs, through the ordinary, authorised endpoints.

## Where she stands: "against her own usual"

The engine compares each session with her own recent average, in units of how much she normally varies. That is why a
patient who always scores low is not flagged and one who falls by ten points is. Until a domain has about a dozen
readings the status is "stable" whatever the numbers say, and until five the dashboard says "too early to say".

## How to demo it in 60 seconds

```
cd backend  && mvn verify              # 101 unit + 401 integration tests on PostgreSQL 16
cd ../frontend && npm test             # 145 tests
python scripts/make_duck_vectors.py    # regenerate the shared Duck Roll Call vectors (a third implementation, in Python)
```

Then the part that proves a test can fail. In `SessionIngestionService`, change the line that decides whether a session is
newer than everything stored to `boolean inOrder = true;`. Run `IngestionIT`: `lateArrivalRebuilds` fails ("MOTOR expected
62.61 but was 59.14"), because a late session is folded in at the end instead of in its place. Put it back.

To watch it work, run `python e2e/phase4_games_flow.py` (set-up in `e2e/phase2_ui_flow.py`). It opens three browsers: the
family's, the tablet's and a doctor's. The tablet plays Duck Roll Call on its real screen; within a second or two the family's
dashboard shows the session with its reasons. The tablet then plays Morning Rituals with the network cut, reconnects, and the
queue drains once. The same batch sent again changes nothing. The doctor sees it all read-only, with no family names.

## Six likely interview questions

**1. The tablet computes the scores. Why should the server believe them?**
It does not believe them blindly, and says where the boundary is. The tablet scores so that her profile on the glass and the
one on the server are built from the same numbers, and so it works with no signal. The server then (a) checks every session:
the game must be registered, each score must be inside 0 to 100, the targets must be ones that game measures, the time must be
plausible; (b) for Duck Roll Call, scores the raw rounds again with its own Java code and compares. When they agree the session
is marked `scoring_trust = server`; when they do not, the tablet's scores stay, the session stays `device`, and a counter
(`scoring_mismatch_total`) goes up. What this does not catch is a tablet that lies inside the allowed range for a game the
server cannot re-score. That is the documented limit.

**2. What happens when a session arrives out of order?**
The engine's baseline for a session is the average of the ones before it, so the order matters. A session newer than everything
stored is folded in with one step. One older than something stored cannot be. So the server replays every session, oldest
first, from a profile that has seen nothing, and rewrites every snapshot. I tested that the two routes agree exactly: ten
sessions fed in order and the same ten shuffled give the same levels, the same raw history, the same run counts and the same
snapshots. And I broke it on purpose to be sure the test notices.

**3. How do alerts avoid crying wolf, and avoid repeating themselves?**
Three things. The rule: by default two sessions in a row below her usual, not one. The gate: nothing is raised until a domain
has enough readings to trust. And episodes: an alert is a row that is open from the first qualifying session until a session
says the pattern is over. A continuing episode updates its row, and may be raised from "watch" to "decline"; the database
refuses a second open row for the same patient, kind and target. Acknowledging says someone has seen it; it does not close it.

**3b. And the sundowning alert?**
It asks one narrow question: over the last month, do her sittings between 3 and 7 in the evening score lower than her mornings?
Each sitting is compared with the average for its own game first, so a hard game that is only ever played in the afternoon does
not look like a dip. It needs six sittings in each part of the day, and flags at an effect size of 0.8 (the gap, in units of her
spread). It ends below 0.5, so it does not flicker. It says "worth mentioning to her doctor" and "not a diagnosis".

**4. Why is the dashboard live over SSE, and how is that kept safe?**
An event carries only ids ("a session arrived"); the dashboard then asks the ordinary endpoints, so a stream can never show more
than the dashboard may read. The stream is checked when it opens and again before every event it sends, so a doctor whose
grant has expired stops receiving on the next event (tested). A browser's own `EventSource` cannot send an Authorization header
and the token must not go in a URL, so the stream is read with `fetch` and parsed by a small function that has its own tests.

**5. How is her journal kept private?**
The text is sent for one request and never stored: not in the database, the audit log or any contribution. The server asks the model with a
prompt that lives on the server (a tablet cannot change it, and the key never leaves the server), checks the answer, clamps the
numbers, keeps only the four known concern flags, and stores the readings. A test searches every column that could hold the
words. Honest limit: the model also returns a one-sentence gist. It is told not to quote her, a model can echo, so it is kept
short and shown to no one: not on the dashboard, not to a doctor. And the entry does go to the model provider for that request,
which a real deployment must say in its consent text.

**6. What did the tests find that you were not looking for?**
Two things in my own code. Two batches arriving for one new patient at once both tried to create her profile row and one failed
with a duplicate key; the fix is a per-patient advisory lock taken first. And when the server decided the Duck session agreed with
the tablet, the "trusted" mark was silently not saved, because saving an entity with an assigned id returns a different, managed
copy and I had kept changing the original. A test that checks the stored value found it.

## Honest limitations

- **Only Duck Roll Call is re-scored by the server.** The other games' scores are the tablet's, checked for range and plausibility only.
- **The Lotus Frog and the Koi game were not played by the browser test.** They are canvas games a script cannot play. Their scoring
  is unit-tested, and the Lotus Frog's own readings are passed through unchanged (the server cannot check them).
- **No game measures inhibition or trajectory precision yet,** so those two clinician markers always say "not measured yet". The Koi
  game has no creature to leave alone, so it cannot.
- **Caregiver voice notes (item 9) and the family's upload screen for photographs, voices and hints (item 10) are not done.** The
  tablet side of item 10 is: it now fetches her family's files with its own token. Without an upload screen outside development
  builds, nothing yet puts those files on a tablet in a real deployment.
- **Three games record nothing if she leaves before the end** (Grandmother's Tale, Family Grove, Morning Rituals). Duck Roll Call and
  Koi record the part she did. Predates this phase.
- **The seeded demo patient shows 0 blooms and no open alert.** The seeder does not recompute the garden, and the alerts in her
  history opened and closed. Phase 5 loads a synthetic cohort with declining and improving patients.
- **A session's weekday in the activity grid comes from the server's clock, its hour from the tablet's.** A sitting near midnight can
  land on the neighbouring day.
- **Audit entries for reads are recorded once a minute per person per patient, not once per request.** A dashboard is five requests.
- **Live updates keep their list of open streams in memory,** so one server only. Behind a proxy the stream must not be buffered; that
  belongs with the proxy in Phase 6.
- **Sessions queued by a version before this phase are dropped on the next sync.** The server could not read them.
