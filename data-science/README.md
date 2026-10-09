# Smaran data science

Read this before you read a number from `results/`.

**Everything here is simulated.** There is no patient in this directory and no real score in it. A simulator invents
a cohort whose course is known (who declines, when, how fast), and the questions are about the *rules*: how soon does an
alert rule catch a real decline, how often does it cry wolf, how reliable is a score, can a late-day dip be found. A
rule that does well here has shown it can find what the simulation put in. It has not shown it works on people.

What the results do and do not show is at the end of this page. The short version: **they show how these rules behave
under the assumptions below, and nothing about how people with dementia actually score or change.** Every parameter is
an assumption chosen so the effects are present at plausible sizes. None is an estimate from data.

## Run it

```bash
pip install -r data-science/requirements.txt        # pinned; Python 3.14 was used
make ds                                             # tests, then every table and figure (about ten minutes)
make ds-small                                       # the small-N version CI runs (about two minutes)
make ds-export                                      # the evaluation code on data the real API exported
```

Without `make`: `cd data-science && python -m pytest -q && PYTHONPATH=src python src/run_all.py`.

Seeds are fixed (`SimParams.seed`), so a run is the same run. Results are the same up to floating-point noise in the last
digits; the figures are not byte-identical between machines. `SMARAN_DS_BOOT` sets the bootstrap resamples (1000 for the
committed results), `SMARAN_DS_SMALL=1` the small cohort, `SMARAN_DS_RESULTS` where output goes.

```
data-science/
  src/scoring_core.py     the scoring engine in Python, held to golden-vectors.json
  src/params.py           every assumption, with its reason
  src/simulate.py         the cohort generator; writes the API's JSON and a de-identified CSV
  src/replay.py           the engine run over a cohort, one patient and domain at a time
  src/rules.py            the four alert rules as sweepable scores, and the metrics that judge them
  src/evaluate_rules.py   Appendix C: the alert-rule comparison
  src/ablations.py        the confidence gate, EMA alpha, prior SD, SD floor, baseline window, abandoned sessions
  src/reliability.py      test-retest ICC on stable patients
  src/practice.py         practice effects, with a mixed-effects model (statsmodels)
  src/sundowning.py       the late-day-dip detector, evaluated against ground truth
  src/federated_sim.py    federated learning of a small head, compared with local-only and centralised
  src/clustering.py       do course shapes group together (PCA, k-means)
  src/run_on_export.py    the evaluation on the CSV the admin export returns
  src/run_all.py          all of the above; writes results/SUMMARY.md
  tests/                  pytest: golden parity, shared vectors, ground truth, metrics worked by hand
  results/                every table (CSV) and figure (PNG, with a JSON sidecar of its seed and parameters)
```

This is a set of scripts, not notebooks. The specification asks for "notebooks and scripts"; a notebook cannot be
re-run by `make ds` without extra machinery, and everything a notebook would show is in the script and its figure.

## The scoring engine, in Python

`src/scoring_core.py` is a line-for-line port of `frontend/src/lib/scoring/engine.ts` (and so of the Java
`ScoringEngine`). All three are held to `golden-vectors.json`: `tests/test_golden.py` replays all 16 cases and
fails if any number differs by more than 1e-9. The evaluation therefore measures the engine that ships, not a
re-implementation of it that happens to be similar. The same holds for the sundowning rule: `sundowning-vectors.json` is
written by the Python and checked by the Java detector's test (`SundowningDetectorTest.sharedVectors`).

## The simulation

For each patient the simulator decides what is *true* first, and what the games *saw* second.

1. **Who she is.** A level for each of the six domains (patients differ a lot from each other; a person's domains
   differ a little from her own mean).
2. **What changes, and when.** One of five courses:
   *stable*; *slow decline* (every domain, ~22 points over a year); *fast decline* (every domain, ~7.5 points a month until
   a cap); *single-domain decline* (one domain falls, the rest hold); *improving* (a gain that levels off). The onset day of
   each domain is recorded: that is the ground truth the alert rules are judged against.
3. **What a game sees.** Her true ability that day, plus a saturating **practice curve** for that game, plus the **day's
   shared good or bad mood** (autocorrelated, touches every game she plays that day), plus how hard that game is, plus a
   **late-day dip** for a subgroup, plus **observation noise** (larger for a game's secondary domains and for sessions she
   leaves part-way). Scores are rounded to one decimal, as the tablet does.
4. **When she plays.** A two-state process gives **missed days** and runs of them; some patients stop entirely
   (**dropout**); each active day has one to three sittings at plausible hours; **abandonment** of a session depends on
   the hour, a late-day dip, having just abandoned, recent low scores, low mood and difficulty, with a different baseline
   for every patient (non-IID).
5. **What goes to the server.** Each session becomes a `SessionEnvelope`, valid for the server's real registry (a
   game only contributes to the domains the registry lists for it), and a de-identified CSV with no ground truth in it.

Sub-signals (working-memory span and the like) are not simulated: they are a second reading of the same latent domain
and would add rows without adding a question. Raw trials are not simulated either, so the simulated envelopes carry
scores and no trials and the server cannot re-score them (it leaves them marked `device`, which is true).

### Every assumption

<!-- assumptions:start (generated by `python src/params.py --write-readme`; do not edit by hand) -->

| Parameter | Value | Why |
|---|---|---|
| `n_patients` | 200 | Enough that a 95% interval on a sensitivity is not enormous; small enough to run in minutes. |
| `days` | 365 | A year: long enough for a slow decline to show and for 14- and 30-day windows to be meaningful. |
| `seed` | 20261009 | Fixed so every run is the same run. |
| `start_date` | 2025-01-06 | Arbitrary. A fixed calendar so weekday and hour are real quantities. |
| `p_stable` | 0.4 | Most people using a reminiscence app are not changing month to month. Includes stable low scorers, who are the point of the absolute-level rule's comparison. |
| `p_slow_decline` | 0.2 | Gradual change is the common pattern in the early-to-moderate stages. |
| `p_fast_decline` | 0.1 | A minority decline quickly (an acute illness, a stroke, a medication change). |
| `p_single_domain` | 0.15 | One domain falls while the rest hold: the signal the dashboard exists to surface. |
| `p_improving` | 0.15 | People also get better (treatment of depression, a new routine). A rule that cries wolf on recovery is wrong too. |
| `level_mean` | 58.0 | Mid-scale, so there is room to fall and to rise. |
| `level_sd_between` | 14.0 | People differ a lot from one another; this is what makes a single absolute cut-off a poor idea. |
| `level_sd_domain` | 6.0 | One person is better at some things than others. |
| `level_floor` | 15.0 | Nobody the games can score sits at zero. |
| `level_ceiling` | 90.0 | Leaves room for the practice effect without every score hitting 100. |
| `onset_min_day` | 60 | At least two months of baseline before anything changes, so the first alert cannot be a warm-up artefact. |
| `onset_max_day` | 200 | Leaves at least 165 days after the latest onset to be detected in. |
| `slow_rate` | 0.06 | About 22 points over a year. Chosen so slow decline is visible in months, not an estimate of how fast anyone declines. |
| `fast_rate` | 0.25 | About 7.5 points a month until the cap. |
| `single_rate` | 0.15 | Between the two: one domain falling at a moderate rate. |
| `improve_rate` | 0.08 | Gentler than a decline; improvement is slower than loss. |
| `slow_max_drop` | 40.0 | A decline does not run to zero within the year. |
| `fast_max_drop` | 35.0 | A rapid fall that then plateaus. |
| `single_max_drop` | 35.0 | As above. |
| `improve_max_gain` | 15.0 | A recovery that levels off. |
| `rate_jitter` | 0.4 | Domains do not fall in lockstep. |
| `onset_jitter_days` | 10 | Nor start on the same day. |
| `day_sd` | 3.0 | Good days and bad days that touch every game she plays that day. Without it every sitting would be independent noise, which flatters every rule. |
| `day_phi` | 0.6 | A bad day tends to follow a bad day. |
| `noise_sd_primary` | 7.0 | Session-to-session scatter of a game's main score. Sets how large a change must be before it stands out. |
| `noise_sd_secondary` | 11.0 | A game's other domains are a weaker read of the same thing. |
| `game_bias_sd` | 4.0 | A hard game scores lower than an easy one. The engine pools games within a domain, so this is real extra scatter. |
| `abandoned_noise_mult` | 1.5 | A sitting she leaves is less reliable. |
| `abandoned_shift` | -4.0 | And a little lower. |
| `practice_max_mean` | 10.0 | Repetition raises scores a few points before it stops. The size is an assumption; that it saturates is well established for repeated cognitive tasks. |
| `practice_max_sd` | 3.0 | People differ in how much they gain. |
| `practice_tau_median` | 10.0 | About ten sittings of a game to get most of it. |
| `practice_tau_sigma` | 0.3 | Games differ in how fast they are learned. |
| `lapse_start_mean` | 0.12 | With the next number gives about 71% of days active. |
| `lapse_end_mean` | 0.3 | A lapse lasts about three days on average. |
| `sessions_extra_mean` | 0.5 | Most active days have one or two sittings. |
| `dropout_share` | 0.08 | Some people stop, and a rule is judged on those it must not miss while they are still there. |
| `p_morning` | 0.4 | Her morning routine. |
| `p_midday` | 0.2 | After lunch. |
| `p_afternoon` | 0.35 | The late-afternoon window the sundowning detector looks at. |
| `abandon_logit_mean` | -3.4 | With the effects below, roughly one sitting in ten is left unfinished. |
| `abandon_logit_sd` | 0.8 | Patients differ in how often they leave a game: the non-IID that makes federated learning interesting. |
| `abandon_late_effect` | 0.8 | Late-day sittings are left more often. |
| `abandon_sundown_extra` | 1.2 | Especially by the late-day-dip subgroup. |
| `abandon_after_abandon` | 0.9 | Leaving once makes leaving again more likely. |
| `abandon_low_recent` | 0.5 | She leaves more when she has been scoring low. |
| `abandon_low_mood` | 0.6 | And when she begins low. |
| `abandon_tier` | 0.3 | And when the game is hard. |
| `abandoned_conf_lo` | 0.15 | A part-played sitting is a thin reading. |
| `abandoned_conf_hi` | 0.45 | A part-played sitting is a thin reading. |
| `sundowner_share` | 0.2 | Prevalence is a guess; it is high enough to evaluate the detector and low enough to be a subgroup. |
| `sundown_lo` | 6.0 | Small enough to be hard, large enough to find in a month. |
| `sundown_hi` | 14.0 | Upper end of the same range. |
| `afternoon_sd_others` | 1.5 | Nobody is exactly constant across the day; this is the null the detector must not trip over. |
| `conf_lo` | 0.7 | A finished sitting is mostly trustworthy. |
| `conf_hi` | 1.0 | A finished sitting is mostly trustworthy. |
| `conf_secondary_mult` | 0.6 | A game's other domains carry less weight. |

<!-- assumptions:end -->

`tests/test_simulate.py` fails if a parameter is added to `params.py` and not listed here, or the table is edited by
hand and drifts from the code.

## What was evaluated

Every table is a CSV in `results/`, every figure a PNG beside a JSON file with its seed and parameters, and
`results/SUMMARY.md` has the headline tables with their intervals (95%, patient-level bootstrap, 1000 resamples,
fixed seed). The cohort is 200 patients for 365 days: 80 stable, 40 slow decline, 20 fast decline, 30 single-domain
decline, 30 improving; about 77,000 sessions and 150,000 scores.

### 1. Alert rules (Appendix C): `rules_*.csv`, `rules_froc.png`, `rules_roc_pr.png`, `rules_delay_cdf.png`

Four rules, each with and without the confidence gate, judged against the known onset day of each decline. As shipped
(an alert at "watch" or worse, the confidence gate on):

| Rule | Detected within 30 days | within 90 days | Median delay (days) | Points she had lost | False alarms per stable patient-year |
|---|---|---|---|---|---|
| R0 Absolute level (level at or below 40) | 7% (4 to 11) | 20% (13 to 28) | 100 | 16.5 | 5.8 (3.6 to 8.5) |
| R1 Single-session velocity | 75% (69 to 81) | 93% (88 to 97) | 11 | 1.1 | 70.6 (66.3 to 75.3) |
| R2 Two-consecutive velocity (the default) | 35% (30 to 41) | 73% (68 to 80) | 44 | 4.8 | 22.2 (19.8 to 25.1) |
| R3 CUSUM | 37% (31 to 43) | 76% (69 to 82) | 42 | 4.6 | 22.5 (20.5 to 24.8) |

What the data says, including where it disagrees with what was expected:

- **The absolute-level rule does cry wolf on people who simply score low, and the velocity rules do not care how
  high she scores.** Among stable patients, R0 raised 17.5 false alarms per patient-year (11.9 to 23.4) for the lowest
  third by usual level, 0.3 for the middle third and none for the highest. R2 raised 23.4, 23.3 and 20.0 across the same
  thirds: a personal baseline makes the rule indifferent to level (`rules_low_scorers.csv`, `rules_example_low_scorer.png`).
  R0 is also the rule that finds the least: by the time a fixed level is crossed she has typically lost 16 points.
- **But the rules as shipped raise a lot of false alarms.** About 22 per stable patient-year for the default rule
  (roughly one every two weeks across six domains), and 71 for the single-session rule. Counting only a "decline"
  alert (velocity at or below -1.5 twice in a row) it is 4.1 (3.6 to 4.7) for R2, at the price of catching 35% (28 to 42) of
  declines within 90 days instead of 73%. This follows from checking six domains on a patient who plays about once a day, and it
  grows with how often she plays (below). It is a finding about the defaults under these assumptions, not a
  measurement of real families; see the decisions in `docs/PROGRESS.md`.
- **At the same false-alarm budget CUSUM is best, clearly at a low budget.** At 1 false alarm per patient-year CUSUM catches 26%
  (19 to 35) within 90 days; the other three catch 7 to 9%. At 4 per year it is 38% (31 to 46) against 33% (27 to 40) for R2,
  which is not a difference this cohort can resolve (`rules_matched_false_alarms.csv`).
- **Early detection is limited by the size of the change, not the rule.** In the 30 days after a slow decline starts she has lost
  about two points against a session-to-session scatter of about nine. At a budget of 2 false alarms per patient-year no rule catches
  more than about 4% within 30 days. Window-level AUC is 0.52 to 0.56 for the 30-day horizon and 0.56 to 0.65 for the 90-day (`rules_roc_pr.csv`).
  A fast decline is found in a median of 28 days (R2), a slow one in 57 days with about 3.5 points lost.
- **The confidence gate buys quiet in the first weeks and nothing later.** It cuts false alarms in a stable patient's first
  three weeks from 1.5 to 0.65 per patient with no change in 90-day sensitivity (73.3%); over a year it changes little (23.3 to
  22.2 per patient-year). It does what it was built for and no more (`ablation_gate.csv`).
- **The EMA weight alpha does not touch a velocity rule.** The baseline is the mean of raw scores, so alpha only moves the
  displayed level and the absolute-level rule: R2 is identical at every alpha, R0 goes from 7% to 37% sensitivity
  (and from 1.8 to 14 false alarms per patient-year) as alpha goes from 0.05 to 0.9. The level tracks true ability best near the shipped
  0.25 (`ablation_alpha.csv`).
- **The prior SD and the SD floor barely matter** while the gate is closed (the prior SD is used for one reading after it
  opens); with the gate off the prior SD changes first-weeks false alarms from 2.4 (prior 4) to 0.75 (prior 24).
  A floor under 6 changes nothing.
- **A short baseline window chases a decline and catches more of it, at the price of more false alarms**: window 8, 29.3 false
  alarms and 79% within 90 days; window 30 (shipped), 22.2 and 73%; window 120, 17.4 and 68%. Those are positions on one curve.
- **Showing the engine only finished sessions changes little; filtering on confidence trades alarms for sensitivity**
  (finished only: 20.2 false alarms, 73% detected; confidence at least 0.5: 15.2 and 64%).

### 2. Do the conclusions survive other assumptions? `sensitivity.csv`

One assumption at a time is moved away from its default, on a 100-patient cohort: noise halved and raised by half, no shared
day effect, declines half and twice as fast, about one session a day or up to three, fewer days played, no practice or double,
games equally hard or very unequal. At a budget of two false alarms per patient-year CUSUM caught the most or tied in all 14 runs
(the defaults and 13 variations), and the order CUSUM, then R2, then R1 and R0 held throughout, with one exception (three sessions a day, where R2 collapses).
The false-alarm *rate* is not robust: it scales with how often she plays (14 per patient-year at one session a day, 31 at up to three),
which is why the defaults need a decision and not just a number.

### 3. Reliability: `reliability.csv`

On stable patients after practice has mostly settled (days 90 to 149): one session against the next, ICC(2,1) 0.67
(0.59 to 0.72); the mean of seven sessions in one month against the next, 0.95 (0.92 to 0.96), against 0.93 predicted from the
single-session figure by Spearman-Brown; the engine's own level (what the dashboard shows) at day 119 against day 149, 0.97
(0.96 to 0.98). A single session is a noisy reading; a month of them is not. These are high partly because the simulation makes
people differ from one another by about 15 points (`level_sd_between` and `level_sd_domain`); change that assumption and the ICC moves.

### 4. Practice effects: `practice_*.csv`, `practice.png`

- A mixed-effects model (random intercept per patient and domain, a fixed effect per game, a saturating curve in how often she has
  played that game) fitted to a separate reference cohort of stable patients recovers the curve: it picks a time constant of 10
  sessions (the simulation's median) and a ceiling of 9.3 points (the simulation's mean is 10).
- **Ignoring practice hides a decline that starts while she is still learning.** For patients whose decline begins in the first
  month, her true ability falls by 1.68 points a month. The trend in her scores, with practice ignored, is -0.14 (-0.25 to -0.04):
  it looks like nothing. With the practice term it is -1.49 (-1.67 to -1.30).
- **Modelling practice improves detection less than it improves the estimate.** Adjusting the scores before the engine sees them
  raises 90-day sensitivity (R2: 61% to 71% for early declines, 73% to 79% overall) and raises false alarms with it (21 to 26 and 22
  to 26 per patient-year); window-level AUC is unchanged overall (0.635 and 0.635) and moves from 0.546 to 0.561 for early declines, inside the
  interval. It moves the operating point more than it improves the rule.

### 5. Sundowning detection: `sundowning_*.csv`, `sundowning.png`

The server's rule (`SundowningDetector`; the Python port is held to `sundowning-vectors.json`, which the Java test also checks) evaluated every week
for every patient: the 39 with a true late-day dip and the 161 without.

- Of weekly evaluations it flagged 88% for patients with a dip and 5.2% for the rest. As a score the effect size separates the two groups well
  (AUC 0.98, 0.97 to 0.98).
- **But repeated every week it flags 58% of patients without a dip at least once in the year.** With six sittings in each
  part an effect size of 0.8 is not rare under no effect. At ten sittings and an effect size of 1.2, 8.5% of patients without a dip are flagged
  at some point, and 65% of weekly evaluations for those with one (`sundowning_guard_and_threshold.csv`).
- **How big a dip is found** (`sundowning_power.csv`): 2 points, 15% of evaluations; 6 points, 56%; 10 points, 88%; 14 points, 98%.
- A steady decline is not mistaken for a late-day dip: patients without a dip who decline are flagged at 3 to 7% of evaluations, as the stable are (5.8%).

### 6. Federated learning: `fl_*.csv`, `fl.png`

A logistic-regression head of the same shape as `frontend/src/lib/federated.ts` (six features, 24 epochs at 0.28, L2 0.01) predicts whether the next
session will be left unfinished, on 159 simulated tablets and 39 held-out patients. The patients differ: the abandonment rate has mean 9.8%
and a standard deviation of 9.0 points between patients.

| Method | AUC | Log-loss | AUC, new patient | Bytes on the wire |
|---|---|---|---|---|
| Base rate for everyone | 0.50 | 0.34 | n/a | 0 |
| Local only | 0.78 | 0.29 | n/a | 0 |
| Centralised | 0.70 | 0.32 | 0.70 | 1.8 MB |
| FedAvg, all clients, 60 rounds | 0.69 | 0.33 | 0.69 | 2.7 MB |
| FedAvg, 25% of clients a round | 0.69 | 0.33 | 0.69 | 0.7 MB |
| FedAvg then local tuning | 0.78 | 0.29 | n/a | 2.7 MB |

- Federation matches centralised training within about a point (0.69 against 0.70). Both are beaten by **a model each patient trains on her own
  history**, because patients differ in how often they leave a game and one shared set of weights has no per-patient intercept. FedAvg followed by a few
  rounds of local tuning is no better than local alone here (0.78). A global model is what a patient with no history needs: 0.69 on patients who never took part.
- **Federation is not cheaper in bytes at this size.** Sixty rounds from every client cost more than uploading every training row once.
  The reason to federate is that the rows stay on the tablet.
- **Secure aggregation is not implemented, here or in the app, and it matters.** In this simulation the server sees each client's
  update by itself. One update after round one correlates 0.98 (0.98 to 0.99) with that patient's true abandonment rate: from a
  six-number update the server learns how often she leaves her sessions unfinished. In the app today the update is encrypted with a key only the
  tablet has, which keeps the server from reading it but also from averaging it; wiring a real protocol (pairwise masking, or a trusted aggregator) is the first task of a
  federated pilot (`FederatedAggregationService` says so at the top).

### 7. Clustering: `clustering_*.csv`, `clustering.png`

A patient's course (the change in her mean score in each 60-day block, domain by domain, relative to her own first block), PCA, then k-means. Compared
with the true trajectory types, the adjusted Rand index is 0.63 at five clusters (0.64 at six; 0 is chance). PCA only: UMAP would add a dependency for a prettier picture.
The sentiment-against-performance correlation (also P2) is not done: on mock sentiment it would only recover whatever correlation was put in.

### 8. The evaluation runs on data the API exported

`python src/run_on_export.py` reads `GET /api/admin/export/sessions.csv` as the backend's integration test wrote it, after loading the committed
five-patient fixture cohort *through the real ingestion service*. It checks that every score, confidence, hour and flag came back exactly (1,188 rows),
that nothing identifies anyone, and that the engine replay, the rule evaluation and the sundowning evaluation give *identical* numbers on the exported table and on
the cohort it came from. CI runs it after the backend's integration tests.

## What these results do not show

- **It is a simulation.** Every parameter is an assumption. The decline rates are chosen so declines are visible in weeks to months, not estimated from
  anyone's progression. How a real person with dementia scores, varies day to day, learns a game, stops playing or declines is not known to this
  code. A different assumption set could reorder the results; `sensitivity.csv` tries thirteen changes and the ordering of the rules holds, but thirteen
  variations of one model are not the same as a different model.
- **The false-alarm rates are specific to how often she plays and how many domains are watched.** They scale with the number of times a rule looks.
- **A true onset is a modelling convenience.** Real decline does not start on a day; here it starts on a day and drifts linearly, so "delay since onset"
  flatters a rule slightly, and a slow decline is almost invisible for weeks whatever the rule.
- **Not modelled:** that people who decline play less or stop; illness, medication and caregiver help on a given day; heavy-tailed noise; device and screen
  differences; practice that differs by domain; strategies that outlast the practice curve; a late-day dip that comes and goes. Sub-signals and
  raw trials are not simulated.
- **The simulator and the engine were written by the same people**, so the simulator may favour something in the engine without anyone noticing.
  The checks against this are the test that a world with no noise gives exact answers (`tests/test_pipeline.py`) and the sensitivity runs.
- **Intervals describe this cohort, not the assumptions.** A 95% bootstrap interval says how much the numbers would move on another cohort drawn from the
  same simulator; it says nothing about the simulator being right.
- **Detection is judged one domain at a time.** A family sees an alert on one domain; a clinician might prefer one alert per patient.
- **The federated simulation uses a different label from the app today** ("will this session be left" against "did it go well"), the same six
  features, and no secure aggregation.
- **Nothing here is clinical validation.** These are monitoring signals for a person to read, never a diagnosis; Smaran is not a medical device.
- **The export is de-identified, not anonymous,** and the consent notice in this build does not mention research use. It is for the operator's own evaluation
  and for an approved study, and must not be released.
