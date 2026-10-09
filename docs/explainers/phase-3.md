# Phase 3 explained: handing her a tablet that is only hers

Before this phase, pairing worked but not to the specification. The code was
eight characters and lasted ten minutes, the tablet's credential was a signed
token that only expired, and the tablet reached her information through the same
doors the family uses. Now a tablet has its own small set of doors, holds a
credential the server can cancel instantly, and a family member can hand it over
by reading six characters off a phone.

All data here is synthetic. Nothing in this phase makes any clinical claim.

## What changed, in plain words

| Before | After |
|---|---|
| An 8-character code that lived 10 minutes | A 6-character code (`HJ4K-2M`) that lives 72 hours and works once |
| The tablet's token was a signed JWT, good for 180 days | An opaque random token. The server keeps only a hash of it and looks it up on every request |
| The tablet used the family's endpoints, with a "PATIENT" label | The tablet has its own endpoints under `/api/device`. They name no patient: the server reads her from the token |
| A tablet's token could (in some cases) reach caregiver endpoints | Every caregiver, doctor and admin endpoint refuses a tablet. A matrix test checks all of them |
| Pairing told the tablet her full record | Pairing tells it a first name, a language and how she is addressed. The rest it asks for |
| Guessing limited by an in-memory counter | Guessing limited by a table in the database: 5 failed tries per tablet and 5 per address, per 15 minutes. It survives a restart and is shared between servers |
| Removing a tablet: it showed errors, or kept trying | It goes quiet: nothing alarming on screen, her data stays, and it asks again once an hour |
| Pairing a tablet to a second patient kept the first patient's data on the glass | The tablet wipes the first patient's information before the second one's arrives |

## How pairing works

1. **The family asks for a code** on their own phone (Dashboard → Her tablet).
   Six symbols from a 27-letter alphabet with nothing easily mistaken (no `0 O 1 I L 5 S 8 B`).
   Only a hash of the code, mixed with a server secret, is stored. Asking for a new
   code cancels the old one.
2. **The tablet types it** on `/pair`. Capitals, spaces and the dash don't matter.
3. **The server checks**, in this order: has this tablet or address failed five times
   in the last fifteen minutes (if so, refuse, even if the code is right); is there a
   live code with this hash. Redeeming is one `UPDATE ... WHERE redeemed_at IS NULL`,
   so two tablets racing one code cannot both win.
4. **The tablet gets a token**, shown once and never stored in readable form, plus
   her first name, language and kinship term.
5. **From then on** every request carries the token. The server looks up its hash,
   checks the tablet has not been removed, and takes the patient from that row.

A wrong code, an old one, a used one and one that was replaced all get the same
answer, so a guess learns nothing about which it was.

## How to demo it in 60 seconds

```
cd backend  && mvn verify          # includes PairingIT (23) and the matrix (337)
cd ../frontend && npm test         # 83 tests
```

Then show the part that proves a guard works, by breaking it. In
`PairingCodeRepository.claim`, delete `c.redeemedAt is null and`. Run `PairingIT`:
`singleUse` fails ("expected 404 but was 200"), and so does `concurrentRedemption`
("exactly one tablet may win ==> expected: 1 but was: 8"): all eight racing tablets
paired with one code. Put it back.

To see it with your eyes: run `python e2e/phase3_pairing_flow.py` (set-up is in its
header). It opens two separate browsers, a family's and a tablet's. The tablet is
sent to `/pair`, a wrong code is turned away gently, the right one opens her pond,
and removing the tablet makes its token refuse at once while its screen stays calm.

## Five likely interview questions

**1. Six characters is guessable. Why did you accept that?**
The specification asked for it (decision D2, which the project owner confirmed), so the
question is what makes it safe enough. The code space is 27⁶, about 387 million (28.5
bits). The defences: the code is single use and lives 72 hours; five failed tries per
tablet and per address per 15 minutes, counted in the database; a locked client is refused
even when its next try is right; only a peppered hash is stored. Numbers: one address
gets 5 tries per 15 minutes, so about 1,440 in the life of a code, a chance of 0.0004%
against one live code. An attacker with 10,000 addresses, who also invents a fresh
tablet id for each try, gets 14 million tries in 72 hours, about 3.7%. That is not zero,
and it multiplies by the number of live codes. It is why I say per-client limits are the
control and not a guarantee, and why the answer to a botnet is a global alarm, which is
a Phase 6 item.

**2. Why an opaque token and not another JWT?**
A signed token cannot be cancelled before it expires without a list of cancelled ones,
and that list is a database lookup anyway. So: a random token, stored as a hash, looked
up on every request. Removal takes effect on the next request on every server. A copy of
the database cannot be used to act as a tablet, because the hash cannot be turned back
into the token. The cost is one indexed read per request, which for a tablet making a
request every few seconds is nothing.

**3. How do you know two tablets can't both redeem the same code?**
The redemption is a single conditional UPDATE, and the database serialises two of those
on one row. Then I tested it with eight real threads against real PostgreSQL: exactly one
wins and there is exactly one device row. Then I broke the condition on purpose and
confirmed the same test fails with all eight winning. A test that cannot fail proves
nothing.

**4. What does the patient see when the family removes her tablet?**
Nothing. That is the design, not an omission. A person with dementia must not meet an
error she cannot fix. The tablet treats the refusal exactly like having no signal: she
keeps her pond and everything on the tablet, unsent sessions stay queued, and it asks the
server again once an hour in case the removal was a mistake. If the family pairs it again
to the same patient, everything resumes. If they pair it to a different patient, the tablet
wipes the first patient's journal, photographs and unsent sessions before the second
patient's arrive.

**5. What did you find that you were not looking for?**
The service worker cached API responses by address alone, not by who asked. So a tablet
re-paired to a different patient could have been shown the previous patient's profile from
cache, and a doctor whose access had ended could have been shown a cached dashboard. It
predates this phase and I only found it while working out what "wipe before re-pairing"
must clear. It now never caches API responses; offline reads come from the page's own
store, which is wiped when the tablet changes hands.

## Honest limitations

- **A tablet paired under the old scheme must be paired again.** Its old token is not
  honoured. It keeps her pond and its local data (the re-pair is to the same patient, so
  nothing is wiped), but it stays quiet until the family pairs it, and nothing tells the
  family it is quiet other than the empty tablet list.
- **Behind a proxy, every client looks like one address** until forwarded headers are
  configured. Then five failed tries from anyone would lock out everyone. This must be
  fixed with the proxy in Phase 6, and I have written it there.
- **Family photographs and voice notes do not load on the tablet yet.** The tablet's
  media path exists and is scoped to her files, but a plain image tag cannot send a token.
  Phase 4 (item 10) fetches them with the token. They did not load before this phase
  either, once Phase 2 put authentication on the media path.
- **The reactive difficulty stream does not work for tablets.** It uses a browser feature
  that cannot send a token, and the specification's device surface does not list it.
- **A language chosen while offline is not queued.** The next time the server answers, its
  value wins. This predates the phase.
- **The old caregiver-side copies of the tablet's endpoints remain** (`/api/session`,
  `/api/garden/{id}` and the like). Only family and admin can use them now. Phase 4 rebuilds
  ingestion and removes them.
- **The family-side paths are `/api/patients/{id}/pairing-codes` and `/devices`**, not the
  prompt's `/api/caregiver/patients/...`. A path under `/api/caregiver` falls in the
  dashboard's URL rule, which doctors also pass; keeping pairing with the other patient
  access controls avoided widening it.
- **Two tabs on one tablet** each hold the same token; I did not test that.
- **No tablet component test or Playwright test runs in CI yet.** The browser script is a
  Windows developer tool; Playwright arrives in Phase 7.
