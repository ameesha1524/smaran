# Phase 5 explained: finding out whether the alerts are any good

Until now the alert rules were reasoned about, and tested to do what they say. They had never been asked the
question that matters: when someone really does decline, how soon does the rule notice, and how often does it
say something when nothing has changed? There is no real patient data to ask it of, so this phase builds a
world where the answer is known, runs the real rules through it, and reports what happened.

Everything is simulated. No result here says anything about how people with dementia actually score or change.
It says how these rules behave under the assumptions in `data-science/README.md`, each of which is listed with
its reason.

## What changed, in plain words

| Before | After |
|---|---|
| "Two sessions in a row below her usual" was a sensible-sounding rule | It has a measured detection rate and a measured false-alarm rate, with intervals, against three other rules |
| The scoring engine existed in TypeScript and Java | It exists in Python too, and all three are checked against one file of numbers |
| Nobody knew whether the confidence gate, the EMA weight or the prior SD mattered | Each was changed on its own and the effect measured; two of them turn out to matter much less than they look |
| A practice effect (people get better at a game by playing it) was a worry | It is a model, with an estimate that recovers the truth, and a measured way it can hide a decline |
| Demo data was a hand-written month for one patient | A simulator makes a year for two hundred, with a known course for each, and it can be loaded through the real ingestion code |
| Nothing left the system for analysis | An administrator can download a de-identified table, and the analysis code is shown to run on it |

## How the simulation works

First it decides what is **true**: how able she is in each of six areas, every day, and when (and how fast) that starts to
change. Only then does it decide what the games **saw**: her true ability, plus how much she has practised that game, plus
the day's good or bad mood, plus how hard that game is, plus noise, plus a late-afternoon dip for some people. Some days she
does not play. Some sessions she leaves half-way. Each session becomes the same JSON a tablet would send.

Because the truth is recorded, an alert rule can be marked: *you fired within a month of the real onset* (a hit), *you fired
when nothing had changed* (a false alarm), *you never fired* (a miss).

## What was found

- **A fixed cut-off alarms on people who simply score low.** For stable people who usually score in the lowest third, it raised 17.5
  false alarms a year; for the highest third, none. Rules that compare a person with her own usual do not care how high she scores.
  This is the case for the whole design, and it held.
- **The default rule is noisy.** About 22 false alarms per stable patient-year across six domains (4 if only a "decline" alert counts). The
  number grows with how often she plays. That is the result most worth a decision, and it is left for the owner (H9 in `docs/PROGRESS.md`);
  nothing was changed.
- **CUSUM is the best rule at a low false-alarm budget**, by a clear margin at one false alarm a year, and the ordering held across all
  thirteen changes to the assumptions.
- **No rule can find a slow decline quickly.** Thirty days after it starts she has lost about two points against a scatter of nine.
- **Practice can hide a decline.** A true fall of 1.7 points a month looks like 0.1 if practice is ignored, and 1.5 once it is modelled.
- **The sundowning detector separates the two groups well but, repeated weekly, flags most people without a dip at least once in a year.**
- **Federated learning matches pooling the data, and loses to each patient's own model.** Federating costs more network traffic here
  than uploading the data once, and one update reveals how often a patient leaves her sessions unfinished. Secure aggregation is not built.

## How to demo it in 60 seconds

```
cd data-science
python -m pytest -q                              # 83 tests, including the golden vectors and a world with no noise
PYTHONPATH=src python src/run_all.py             # every table and figure (about ten minutes); make ds-small takes two
```

Open `results/SUMMARY.md` and `results/figures/rules_froc.png` (sensitivity against false alarms for each rule) and
`results/figures/rules_example_low_scorer.png` (one stable low scorer, and what each rule says about her).

To see the cohort go through production code, load the committed five-patient fixture into a dev backend:

```
cd backend
mvn spring-boot:test-run -Dspring-boot.run.main-class=org.smaran.LocalDevApplication \
    "-Dspring-boot.run.arguments=--smaran.seed.cohort=file:src/test/resources/cohort/envelopes.json --smaran.seed.per-trajectory=0"
```

Sign in as `cohort@example.com` / `smaran` and open any of the five. The patients who really declined have the engine's alert open.

Then the part that proves a test can fail. In `data-science/src/scoring_core.py` change `ss / (len(xs) - 1)` to `ss / len(xs)` and run
`python -m pytest tests/test_golden.py`: seven golden cases fail. Put it back.

## Six likely interview questions

**1. How do you know the Python engine is the engine that ships?**
It is held to the same file as the other two. `golden-vectors.json` is written by the TypeScript engine and read by the Java and
Python tests, which compare every number to 1e-9. And the alert rules in the evaluation, which are written as sweepable scores so a threshold
can be varied, are checked to fire at exactly the same readings as the engine's own alert at the shipped thresholds. So the evaluation
cannot quietly drift into measuring a different rule.

**2. The simulation decides the answer. Why believe the results?**
It does not decide the answer, it decides the question. The ground truth is what the rules are marked against; how well they do depends on
the noise, the rate of decline and how often she plays, all of which are assumptions, all listed with their reasons. So three things are done: the
conclusions are stated as conditional ("under these assumptions"); thirteen of the assumptions are moved one at a time to see whether the
ordering of the rules survives (it does, the false-alarm rate does not); and a world with no noise is tested to give the exact answers it should. What
it cannot do is show the simulation resembles people, and the README says so.

**3. Why compare rules at the same false-alarm budget?**
Because a rule that fires on everything has high sensitivity and is useless. The single-session rule catches 93% of declines within 90 days and raises
71 false alarms per patient-year. Comparing sensitivity alone would crown it. At one false alarm a year it catches 8%. The matched
comparison asks what each rule can do for the same amount of crying wolf.

**4. Why did you not fix the noisy default?**
Changing it changes what a family is told, which is the owner's decision, and it moves the golden vectors that three implementations share. The
finding, the evidence and the options (show only "decline", require three in a row, cap alerts a month) are in `docs/PROGRESS.md` as decision H9.

**5. What does federated learning give you here, honestly?**
Not accuracy: each patient's own model is better than the shared one, because patients differ in how often they leave a game. Not bandwidth:
sixty rounds cost more than uploading the rows once. It gives the rows staying on the tablet, and a model for a patient with no history. And without
secure aggregation the server sees each update on its own, and one update reveals the patient's abandonment rate (correlation 0.98). That is why the
README says it is not done, and what it would take.

**6. What did the tests find that you were not looking for?**
Three things. The simulator's session times were not always in order (the first load logged "arrived out of order, rebuilding the profile" for some
sessions), and two sittings in the same minute would have been treated by the server as one; times are now strictly increasing and distinct. The server counted a session with no recorded rounds as
a disagreement with the tablet's score, when there was simply nothing to score from. And a test of mine that guarded the shared sundowning vectors
rewrote the file when the code under test was broken, so it could never have caught that breakage; it now compares in memory and never writes.

## Honest limitations

- **It is a simulation, and every parameter is an assumption.** Real progression, real noise and real play patterns are not known to this code.
- **The false-alarm rates depend on how often she plays and how many domains are watched.**
- **People who decline are not modelled as playing less,** and illness, medication and caregiver help on a given day are not modelled at all.
- **The simulator and the engine were written by the same people,** so it may favour the engine in a way nobody noticed.
- **The intervals describe sampling in this cohort, not the assumptions.**
- **Secure aggregation is not implemented,** and the app's federated learning does not average anything today.
- **The export is de-identified, not anonymous, and the consent notice does not mention research.** Do not use it on real data before that is settled.
- **Nothing here is clinical validation.** Smaran is not a medical device.
