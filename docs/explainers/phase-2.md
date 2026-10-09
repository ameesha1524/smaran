# Phase 2 explained: who is allowed to see what

Before this phase, the server believed a note the tablet or browser carried
("this user can see patients A and B") and the only profile you could run
without a database had security switched off. Now the server decides every
request from its own records, doctors and family members are real accounts, and
every look at a patient's information is written down.

All data here is synthetic. Nothing in this phase makes any clinical claim.

## What changed, in plain words

| Before | After |
|---|---|
| One `caregiver` table holding anyone who signs in | Real accounts: family, doctors, administrators |
| A token listed the patients you could see | The token says only who you are. The server looks up, on every request, whether this patient is yours |
| Anyone with access to a patient could reach nearly everything about her | Each endpoint names one of three permissions; a doctor gets only "read the dashboard and the report" |
| No way to sign up, no way to create a patient | Register; add a patient (with the guardian's consent recorded) |
| A doctor was a caregiver with a different label | A doctor registers, waits for an administrator, and sees a patient only if a family member shares her, for a time the family chooses |
| Nothing recorded who looked | An append-only log of every read, every refusal, every share and every sign-in |
| Refresh token was a long JWT kept in browser storage | An opaque random token in an HttpOnly cookie that rotates, and signs the whole session out if a used one is replayed |

## The three permissions

| Permission | Who has it | Examples |
|---|---|---|
| **CAREGIVE** | The patient's owner, and administrators | Pair a tablet, share with a doctor, edit her objects |
| **PLAY** | Her tablet, her owner, administrators | Submit a game session, read her profile and garden |
| **CLINICAL_READ** | Her owner, administrators, and a doctor she is shared with | The dashboard, the PDF report, the voice trend |

The server answers in a fixed order, and the order matters:

1. **Is this kind of user ever allowed this?** If not: **403**. This does not
   depend on any patient, so it reveals nothing.
2. **Is this particular patient theirs?** If not: **404**, the same answer as for
   a patient who does not exist, so nobody can discover which ids are real.

## How to demo it in 60 seconds

```
cd backend  && mvn verify          # 74 unit + 283 integration tests
cd ../frontend && npm test         # 63 tests
```

Then show the matrix: open `backend/src/test/java/org/smaran/AuthorizationMatrixIT.java`.
It is a table of 8 callers against 30 endpoints, 241 checks, each asserting an
exact status code.

For the part that is most convincing, break it on purpose. In
`AccessGuard.isTheirs`, change the `CAREGIVER` case to `true` and run the matrix.
It fails with lines like `POST /api/patients/{p}/pairing-codes as
OTHER_CAREGIVER ==> expected: <404> but was: <200>`. Put it back.

To see the whole thing working in a browser, follow the header of
`e2e/phase2_ui_flow.py`.

## Five likely interview questions

**1. Why check ownership on every request instead of putting the patient list in the token?**
A token is a snapshot. If it says "patients A and B" and a family member stops
sharing B, the old token still says B until it expires. Looking it up each time
means ending access takes effect on the very next request. It costs one indexed
query. For a doctor's grant with an expiry, this is not optional: an expired
grant must stop working at the moment it expires.

**2. Why 404 for someone else's patient, but 403 for the wrong kind of user?**
A 403 says "this exists, but you may not". For another family's patient that
would confirm the patient exists. So a patient you may not see looks exactly
like a patient that is not there. The role check comes first and has no patient
in it, so its 403 tells you nothing you could not already guess from your own
role.

**3. How do you stop someone stealing a refresh token?**
You cannot stop the theft, but you can make it detectable. Each refresh token
works once and is replaced by the next. If a token that was already used shows
up again, two copies exist, and one is not the owner's. The server then revokes
the whole chain and the person signs in again. The token is also in an HttpOnly,
SameSite=Strict cookie, so page scripts cannot read it and other sites'
requests do not carry it. The short-lived access token stays in memory, never in
storage.

**4. What stops someone guessing passwords?**
Five wrong passwords lock that account for 15 minutes, and one network address
making 20 failed attempts is refused. Every failure returns the same answer, and
a password check runs even when the email is unknown, so neither the response
nor the timing says whether an account exists. The honest cost: locking an
account lets someone keep a known email from signing in. The per-address limit
makes that expensive, not impossible.

**5. How do you know the access rules are right?**
A generated matrix: every endpoint, every kind of caller, one assertion each,
with exact status codes for refusals. Then I checked it can fail: I broke the
ownership check deliberately and it named the broken cases. Tests that cannot
fail prove nothing. The matrix did also find real defects, among them an admin
reaching a nonexistent patient causing a database error.

## Honest limitations

- **A disabled account's access token works for up to 15 minutes.** Its refresh
  tokens end at once. There is no per-request status check.
- **Registering with an existing email returns 409**, so it can be used to test
  whether an email has an account. Rate limiting slows it down.
- **Rate limits and lockouts are in memory on one server.** A restart clears them.
- **Two tabs refreshing at the same instant can sign someone out.** Refresh is
  serialised within a tab, not across tabs.
- **A doctor still sees the family members' names** because the dashboard payload
  includes them. The prompt wants a smaller doctor view; Phase 4 rebuilds it.
- **Security headers (CSP, HSTS) and request size limits are not done.** They
  belong with the proxy in Phase 6.
- **The on-tablet "Setup" screen is refused in real profiles** (it uses family
  permissions with a tablet's token). Phase 3 replaces it with pairing.
- **There is no frontend component or end-to-end test in CI yet.** The browser
  script is a Windows developer tool; Playwright arrives in Phase 7.
- **The demo accounts have a published weak password** (`smaran`). They exist only
  in the `dev` and `demo` profiles, and the seeder refuses to run beside `prod`.
- **I did not review the new screens for accessibility** (contrast, keyboard,
  screen readers). That is a Phase 7 item.
