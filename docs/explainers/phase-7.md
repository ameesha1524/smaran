# Phase 7 explained: playing the whole thing through, and fixing what that showed

The earlier phases each proved their own piece. This phase asks a different question: if someone who has never seen
Smaran sat down and went through it from start to finish, would it hold together? The answer was "mostly", and the
"mostly" is the useful part, because it turned up things no single piece's tests could.

## What was done

**The demonstration was written down as a test.** `docs/MASTER_PROMPT.md` describes a walk-through: a family member
sees a populated dashboard, adds a patient, pairs a tablet with a code, the patient plays two games and the dashboard
updates by itself, a tablet that is offline plays and catches up later without double-counting, a doctor sees only
what was shared with them, and a removed tablet is quietly refused. That is now `e2e/playwright/tests/showcase.spec.ts`:
three real browsers (a family member, a tablet, a doctor) driven through those steps, against the whole stack. It is run
by `make e2e` and by CI on every change.

**`make demo` starts it.** One command starts the database, the backend and the app, loads twelve simulated patients
(75 days each, from the data-science simulator, the same ones every time) and creates demo accounts. The demo
accounts exist only in the development and demo profiles; the production profile cannot create them.

**The API describes itself.** `/v3/api-docs` is a machine-readable description of every endpoint (OpenAPI). It is
readable only by an administrator, and switched off entirely in production.

**An accessibility pass** on the family, doctor and administrator screens, using an automated checker (axe-core, WCAG
2.1 levels A and AA) and a keyboard-only walk through the main screen.

**A load test** (`loadtest/`), with the numbers it gave on one laptop, and what those numbers do and do not mean.

**The README was rewritten** to describe the app that exists now. The old one described an earlier app.

## What playing it through found

| Found | What it was | Fixed by |
|---|---|---|
| Action buttons were too faint | The green of the main buttons had 3.6 : 1 contrast with the white text (4.5 : 1 is the line) | A slightly darker green for text-bearing buttons only |
| The small print at the foot was too faint | 3.5 : 1 | Less transparent |
| On a phone the dashboard scrolled sideways | The week-by-hour heatmap forced the whole page wider than the screen | The grid is allowed to shrink; the heatmap scrolls inside its own box |
| That scrolling box could not be reached from the keyboard | A scroll area with no way to focus it | It is focusable and has a name |
| Rolling back a bad deploy could leave the site down | If the backend was slow to start, the rollback gave up before starting the front door | The rollback keeps going until the public address is healthy; the time limits were widened |
| The backend printed a generated password in its log at start-up | Spring's default, unused here | A user service that knows nobody replaces it |
| Several of my own checks in the new test could not fail | e.g. looking for the words "Duck Roll Call" on a page where they are printed before anyone has played | Rewritten to look at what only a played game produces |

Most of these were found by running the thing, not by reading it. That is the argument for this phase.

## The load test, in plain words

A tablet that is online sends each session as it happens; the server adds it and moves on. That is cheap: on this
laptop about one tenth of a second at the slow end, up to twenty sessions a second. A tablet that has been offline
for days sends a pile of old sessions at once, and for each one the server rebuilds that patient's whole profile from
her history, about ten times the cost. Rebuilding once per pile instead of once per session is the obvious
improvement, and it is a decision for later rather than a change made at the end of a hardening phase.

For the pilot this is built for (a few hundred tablets, a few sessions each per day) none of this is close to a limit.
The numbers are from a laptop running the load generator and every service together; they say where the code starts to
bend, not what a server will do.

## What is still not shown

- **Nothing here has run on a real server or a real web address.** The deploy is rehearsed on one machine with the real scripts.
  Showcase step 8 (CI green, deploy smoke test) is therefore proven for CI and for the rehearsal, and not for a VM.
- **Accessibility was checked by software and by keyboard, not with a screen reader.** Software finds roughly a third of
  the problems; a person using a screen reader, ideally someone who uses one every day, is still owed. The patient's own
  screens were not part of this pass: they are judged against her, not against a checklist.
- **The media half of a restore** (family photographs and voice notes) has still not been run.
- **The decisions that are not mine** are unchanged and still open: how often the family is alerted, the sundowning
  guard, research consent, the export salt, the three accepted framework vulnerabilities, and everything that needs a
  server and a domain. They are in `docs/PROGRESS.md`, "Needs the human".
