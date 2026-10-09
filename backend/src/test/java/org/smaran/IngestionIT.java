package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Alert;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.Patient;
import org.smaran.repo.AlertRepository;
import org.smaran.repo.FamilyMemberRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.ProfileSnapshotRepository;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.smaran.scoring.Contract.SessionMarkers;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.scoring.DuckRollCallScoring;
import org.smaran.service.AlertService;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.SessionIngestionService;
import org.smaran.service.SessionIngestionService.Outcome;
import org.smaran.service.SessionIngestionService.Status;
import org.smaran.support.ApiTest;
import org.smaran.support.Envelopes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Sessions from a tablet to the profile, snapshots, alerts and dashboards,
 * against real PostgreSQL: what is accepted, what is refused, what happens when
 * a session arrives late, and who is told.
 */
class IngestionIT extends ApiTest {

    @Autowired
    SessionIngestionService ingestion;

    @Autowired
    CognitiveProfileService profiles;

    @Autowired
    GameSessionRepository sessions;

    @Autowired
    ProfileSnapshotRepository snapshots;

    @Autowired
    AlertRepository alertRepo;

    @Autowired
    AlertService alerts;

    @Autowired
    FamilyMemberRepository familyMembers;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MeterRegistry meters;

    private static Instant ago(long hours) {
        return Instant.now().minus(hours, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS);
    }

    private Patient patient() {
        return newPatient(newUser(Role.CAREGIVER));
    }

    private Map<String, TargetState> state(Patient p) {
        return profiles.scoringState(profiles.forPatient(p.getId()));
    }

    /* ------------------------------------------------------- accepting */

    @Test
    @DisplayName("a session is stored whole: trials, contributions, markers, difficulty, and who vouches for it")
    void storedWhole() {
        Patient p = patient();
        SessionEnvelope e = Envelopes.withMarkers(
                Envelopes.withTrials(Envelopes.of(p.getId(), "duck-roll-call", ago(2),
                        Envelopes.c("EXECUTIVE", 60, 0.5), Envelopes.c("WORKING_MEMORY_SPAN", 60, 0.5)),
                        List.of(Map.of("spanLength", 3, "correctFirstAttempt", true))),
                new SessionMarkers(4.0, null, null));
        Outcome out = ingestion.ingest(p.getId(), null, e);
        assertEquals(Status.ACCEPTED, out.status(), out.reason());

        Map<String, Object> row = jdbc.queryForMap(
                "select game_id, client_session_id, completed, abandoned, hour_of_day, scoring_trust, engine_version, "
                        + "trials::text as trials, contributions::text as contributions, markers::text as markers, "
                        + "difficulty::text as difficulty from game_session where id = ?", out.sessionId());
        assertEquals("duck-roll-call", row.get("game_id"));
        assertEquals(e.clientSessionId(), row.get("client_session_id"));
        assertEquals("device", row.get("scoring_trust"), "the tablet's scores are the tablet's until the server agrees");
        assertTrue(row.get("trials").toString().contains("spanLength"));
        assertTrue(row.get("contributions").toString().contains("WORKING_MEMORY_SPAN"));
        assertTrue(row.get("markers").toString().contains("workingMemorySpan"));
        assertEquals(1, snapshots.countByPatientId(p.getId()));
    }

    @Test
    @DisplayName("a session moves the profile once, and a snapshot records where it stood")
    void movesProfileOnce() {
        Patient p = patient();
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(3), 100));
        assertEquals(62.5, state(p).get("MOTOR").level(), 1e-9);
        var snap = snapshots.findTopByPatientIdOrderByAtDesc(p.getId()).orElseThrow();
        assertTrue(snap.getLevels().contains("62.5"), snap.getLevels());
        assertTrue(snap.getStatuses().contains("stable"));
    }

    @Test
    @DisplayName("the same session twice is stored once: by client id, and by start time, and the server's copy wins")
    void idempotent() {
        Patient p = patient();
        Instant at = ago(5);
        SessionEnvelope first = Envelopes.koi(p.getId(), at, 80);
        assertEquals(Status.ACCEPTED, ingestion.ingest(p.getId(), null, first).status());
        assertEquals(Status.DUPLICATE, ingestion.ingest(p.getId(), null, first).status(), "same client id");

        SessionEnvelope sameMoment = Envelopes.koi(p.getId(), at, 10);
        assertEquals(Status.DUPLICATE, ingestion.ingest(p.getId(), null, sameMoment).status(), "same patient and start time");

        assertEquals(1, sessions.countByPatientId(p.getId()));
        assertEquals(List.of(80.0), state(p).get("MOTOR").raws(), "the first copy won");
    }

    @Test
    @DisplayName("another patient's session id is refused, not treated as a duplicate")
    void clientIdBelongsToOnePatient() {
        Patient a = patient();
        Patient b = patient();
        SessionEnvelope e = Envelopes.koi(a.getId(), ago(4), 70);
        ingestion.ingest(a.getId(), null, e);
        Outcome out = ingestion.ingest(b.getId(), null, e);
        assertEquals(Status.REJECTED, out.status());
        assertEquals(0, sessions.countByPatientId(b.getId()));
    }

    @Test
    @DisplayName("whatever patient a session names, it is filed under the one it was sent for")
    void filedUnderTheTabletsPatient() {
        Patient a = patient();
        Patient b = patient();
        SessionEnvelope claimsB = Envelopes.koi(b.getId(), ago(2), 70);
        ingestion.ingest(a.getId(), null, claimsB);
        assertEquals(1, sessions.countByPatientId(a.getId()));
        assertEquals(0, sessions.countByPatientId(b.getId()));
    }

    /* ---------------------------------------------------------- refusing */

    @Test
    @DisplayName("what is out of range, impossible or not that game's to say is refused, with a reason, and not stored")
    void refusals() {
        Patient p = patient();
        Instant at = ago(1);
        Map<String, SessionEnvelope> bad = new java.util.LinkedHashMap<>();
        bad.put("an unknown game", Envelopes.of(p.getId(), "no-such-game", at, Envelopes.c("MOTOR", 50, 1)));
        bad.put("a retired game", Envelopes.of(p.getId(), "weavers-loom", at, Envelopes.c("VISUAL_SEMANTIC", 50, 1)));
        bad.put("a target the game does not measure", Envelopes.of(p.getId(), "koi-are-jumping", at, Envelopes.c("LANGUAGE", 50, 1)));
        bad.put("a score over 100", Envelopes.of(p.getId(), "koi-are-jumping", at, Envelopes.c("MOTOR", 101, 1)));
        bad.put("a score under 0", Envelopes.of(p.getId(), "koi-are-jumping", at, Envelopes.c("MOTOR", -1, 1)));
        bad.put("a confidence over 1", Envelopes.of(p.getId(), "koi-are-jumping", at, Envelopes.c("MOTOR", 50, 1.5)));
        bad.put("not a number", Envelopes.of(p.getId(), "koi-are-jumping", at, Envelopes.c("MOTOR", Double.NaN, 1)));
        bad.put("two scores for one target", Envelopes.of(p.getId(), "koi-are-jumping", at,
                Envelopes.c("MOTOR", 50, 1), Envelopes.c("MOTOR", 60, 1)));
        bad.put("a start in the future", Envelopes.koi(p.getId(), Instant.now().plus(2, ChronoUnit.DAYS), 50));
        bad.put("a start years ago", Envelopes.koi(p.getId(), Instant.now().minus(900, ChronoUnit.DAYS), 50));
        SessionEnvelope good = Envelopes.koi(p.getId(), at, 50);
        bad.put("an id that is not a UUID", new SessionEnvelope("not-a-uuid", good.patientId(), good.gameId(),
                good.startedAt(), good.durationMs(), good.completed(), good.abandoned(), good.hourOfDay(),
                good.moodAtStart(), good.difficulty(), good.trials(), good.contributions(), good.markers(),
                good.precomputedReading(), good.engineVersion()));
        bad.put("an hour of 25", new SessionEnvelope(UUID.randomUUID().toString(), good.patientId(), good.gameId(),
                good.startedAt(), good.durationMs(), good.completed(), good.abandoned(), 25, good.moodAtStart(),
                good.difficulty(), good.trials(), good.contributions(), good.markers(), good.precomputedReading(),
                good.engineVersion()));
        bad.put("a day-long session", new SessionEnvelope(UUID.randomUUID().toString(), good.patientId(), good.gameId(),
                good.startedAt(), 86_400_000L, good.completed(), good.abandoned(), good.hourOfDay(), good.moodAtStart(),
                good.difficulty(), good.trials(), good.contributions(), good.markers(), good.precomputedReading(),
                good.engineVersion()));
        List<Object> manyTrials = new ArrayList<>(Collections.nCopies(600, (Object) Map.of("x", 1)));
        bad.put("too many trials", Envelopes.withTrials(Envelopes.koi(p.getId(), at, 50), manyTrials));
        bad.put("a marker out of range", Envelopes.withMarkers(Envelopes.koi(p.getId(), at, 50), new SessionMarkers(99.0, null, null)));

        for (var entry : bad.entrySet()) {
            Outcome out = ingestion.ingest(p.getId(), null, entry.getValue());
            assertEquals(Status.REJECTED, out.status(), entry.getKey());
            assertNotNull(out.reason(), entry.getKey());
        }
        assertEquals(0, sessions.countByPatientId(p.getId()), "none of them was stored");
        assertEquals(0, snapshots.countByPatientId(p.getId()));
    }

    @Test
    @DisplayName("one bad session does not fail the rest of a batch")
    void partialBatch() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        Patient p = newPatient(owner);
        String device = deviceTokenFor(tokenFor(owner), p.getId());
        List<SessionEnvelope> batch = List.of(
                Envelopes.koi(p.getId(), ago(3), 60),
                Envelopes.of(p.getId(), "no-such-game", ago(2), Envelopes.c("MOTOR", 50, 1)),
                Envelopes.koi(p.getId(), ago(1), 65));
        MvcResult r = mvc.perform(post("/api/device/sessions/batch")
                        .with(from(freshIp()))
                        .header("Authorization", bearer(device))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("sessions", batch))))
                .andReturn();
        assertEquals(200, r.getResponse().getStatus());
        JsonNode body = json.readTree(r.getResponse().getContentAsString());
        assertEquals(2, body.get("accepted").asInt());
        assertEquals(0, body.get("duplicates").asInt());
        assertEquals(1, body.get("rejected").size());
        assertEquals("unknown game", body.get("rejected").get(0).get("reason").asText());
        assertEquals(2, sessions.countByPatientId(p.getId()));

        // Sending the whole queue again is harmless.
        MvcResult again = mvc.perform(post("/api/device/sessions/batch")
                        .with(from(freshIp()))
                        .header("Authorization", bearer(device))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("sessions", batch))))
                .andReturn();
        JsonNode second = json.readTree(again.getResponse().getContentAsString());
        assertEquals(0, second.get("accepted").asInt());
        assertEquals(2, second.get("duplicates").asInt());
    }

    /* ----------------------------------------------------------- order */

    private static void assertSameProfile(Map<String, TargetState> a, Map<String, TargetState> b) {
        assertEquals(a.keySet(), b.keySet());
        a.forEach((target, x) -> {
            TargetState y = b.get(target);
            assertEquals(x.observations(), y.observations(), target);
            assertEquals(x.level(), y.level(), 1e-9, target);
            assertEquals(x.raws(), y.raws(), target);
            assertEquals(x.runWatch(), y.runWatch(), target);
            assertEquals(x.runDecline(), y.runDecline(), target);
            assertEquals(x.cusum(), y.cusum(), 1e-9, target);
        });
    }

    @Test
    @DisplayName("a session that arrives late rebuilds the profile to exactly what it would have been in order")
    void lateArrivalRebuilds() {
        double[] raws = {70, 72, 68, 71, 30, 25, 69, 70, 74, 66};
        List<SessionEnvelope> inOrder = new ArrayList<>();
        Patient ordered = patient();
        Patient shuffled = patient();
        Instant start = ago(200);
        for (int i = 0; i < raws.length; i++) {
            inOrder.add(Envelopes.koi(ordered.getId(), start.plus(i * 6L, ChronoUnit.HOURS), raws[i]));
        }
        inOrder.forEach(e -> assertEquals(Status.ACCEPTED, ingestion.ingest(ordered.getId(), null, e).status()));

        List<SessionEnvelope> order = new ArrayList<>(inOrder);
        Collections.shuffle(order, new Random(7));
        for (SessionEnvelope e : order) {
            // The same sitting, filed under the other patient.
            SessionEnvelope copy = Envelopes.koi(shuffled.getId(), Instant.parse(e.startedAt()), e.contributions().get(0).raw());
            assertEquals(Status.ACCEPTED, ingestion.ingest(shuffled.getId(), null, copy).status());
        }

        assertSameProfile(state(ordered), state(shuffled));

        var a = snapshots.findByPatientIdAndAtAfterOrderByAtAsc(ordered.getId(), Instant.EPOCH);
        var b = snapshots.findByPatientIdAndAtAfterOrderByAtAsc(shuffled.getId(), Instant.EPOCH);
        assertEquals(10, a.size());
        assertEquals(10, b.size(), "a snapshot for every session, none left over from the old order");
        for (int i = 0; i < a.size(); i++) {
            assertEquals(a.get(i).getAt(), b.get(i).getAt());
            Map<String, Double> la = json.convertValue(readTree(a.get(i).getLevels()), new TypeReference<>() { });
            Map<String, Double> lb = json.convertValue(readTree(b.get(i).getLevels()), new TypeReference<>() { });
            assertEquals(la.get("MOTOR"), lb.get("MOTOR"), 1e-9, "snapshot " + i);
        }
    }

    private JsonNode readTree(String s) {
        try {
            return json.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("a replayed batch does not inflate the garden")
    void gardenIsDerived() {
        Patient p = patient();
        List<SessionEnvelope> batch = List.of(
                Envelopes.koi(p.getId(), ago(30), 60), Envelopes.koi(p.getId(), ago(20), 65), Envelopes.koi(p.getId(), ago(10), 70));
        var first = ingestion.ingestBatch(p.getId(), null, batch).garden();
        var second = ingestion.ingestBatch(p.getId(), null, batch).garden();
        assertEquals(first.getGrowthPoints(), second.getGrowthPoints());
        assertEquals(first.getBloomCount(), second.getBloomCount());
    }

    @Test
    @DisplayName("two batches for one patient at once are both handled, one after the other, with no session twice")
    void concurrentBatches() throws Exception {
        Patient p = patient();
        List<SessionEnvelope> batch = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            batch.add(Envelopes.koi(p.getId(), ago(60 - i * 5L), 60 + i));
        }
        ExecutorService pool = Executors.newFixedThreadPool(4);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Integer>> results = new ArrayList<>();
            for (int t = 0; t < 4; t++) {
                Callable<Integer> task = () -> {
                    go.await();
                    return ingestion.ingestBatch(p.getId(), null, batch).count(Status.ACCEPTED);
                };
                results.add(pool.submit(task));
            }
            go.countDown();
            int accepted = 0;
            for (Future<Integer> f : results) {
                accepted += f.get();
            }
            assertEquals(6, accepted, "each session accepted by exactly one of the racing batches");
        } finally {
            pool.shutdownNow();
        }
        assertEquals(6, sessions.countByPatientId(p.getId()));
        assertEquals(6, state(p).get("MOTOR").observations());
    }

    /* ----------------------------------------------------------- alerts */

    private void feed(Patient p, int firstHoursAgo, double... raws) {
        for (int i = 0; i < raws.length; i++) {
            Outcome out = ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(firstHoursAgo - i), raws[i]));
            assertEquals(Status.ACCEPTED, out.status(), out.reason());
        }
    }

    private List<Alert> open(Patient p) {
        return alertRepo.findByPatientIdAndResolvedAtIsNullOrderByOpenedAtDesc(p.getId());
    }

    @Test
    @DisplayName("a decline raises one alert for the episode, however long it lasts, and a recovery ends it")
    void domainDeclineEpisode() {
        Patient p = patient();
        feed(p, 100, 70, 70, 70, 70, 70, 70, 70, 70);
        assertEquals(0, open(p).size(), "a steady patient raises nothing");

        feed(p, 80, 20);
        assertEquals(0, open(p).size(), "one low session is a bad day (two in a row is the rule)");
        feed(p, 70, 20);
        List<Alert> raised = open(p);
        assertEquals(1, raised.size());
        assertEquals("DOMAIN_DECLINE", raised.get(0).getKind());
        assertEquals("MOTOR", raised.get(0).getTarget());
        assertEquals("decline", raised.get(0).getSeverity());
        assertTrue(raised.get(0).getMessage().contains("not a diagnosis"), "an observation, never a conclusion");

        feed(p, 60, 20, 20);
        assertEquals(1, open(p).size(), "the same episode: no duplicates");
        assertEquals(raised.get(0).getId(), open(p).get(0).getId());

        feed(p, 40, 70);
        assertEquals(0, open(p).size(), "she is back to her own usual: the episode ends");
        assertEquals(1, alertRepo.findByPatientIdOrderByOpenedAtDesc(p.getId()).size(), "and stays in the record");
    }

    @Test
    @DisplayName("no alert until a domain has enough readings to trust, however low they are")
    void confidenceGate() {
        Patient p = patient();
        feed(p, 20, 10, 10, 10);
        assertEquals(0, open(p).size());
    }

    @Test
    @DisplayName("an acknowledged alert says who saw it, and a doctor cannot acknowledge")
    void acknowledge() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        AppUser doctor = newUser(Role.DOCTOR);
        Patient p = newPatient(owner);
        grantTo(p, doctor, owner, 30);
        feed(p, 100, 70, 70, 70, 70, 70, 70, 20, 20);
        Alert a = open(p).get(0);

        assertEquals(403, status(post("/api/patients/" + p.getId() + "/alerts/" + a.getId() + "/acknowledge"), tokenFor(doctor)));
        assertEquals(200, status(post("/api/patients/" + p.getId() + "/alerts/" + a.getId() + "/acknowledge"), tokenFor(owner)));
        Alert after = alertRepo.findById(a.getId()).orElseThrow();
        assertNotNull(after.getAcknowledgedAt());
        assertEquals(owner.getId(), after.getAcknowledgedBy());
        assertEquals(1, open(p).size(), "acknowledging is not resolving");
    }

    private int status(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder req, String token) throws Exception {
        return mvc.perform(req.with(from(freshIp())).header("Authorization", bearer(token))).andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("three quiet days raise MISSED_DAYS once, and playing again ends it")
    void missedDays() {
        Patient p = patient();
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), Instant.now().minus(4, ChronoUnit.DAYS), 60));
        alerts.checkMissedDays(Instant.now());
        List<Alert> raised = open(p);
        assertEquals(1, raised.size());
        assertEquals("MISSED_DAYS", raised.get(0).getKind());
        assertTrue(raised.get(0).getMessage().contains("nothing has been lost"));

        alerts.checkMissedDays(Instant.now());
        alerts.checkMissedDays(Instant.now().plus(1, ChronoUnit.DAYS));
        assertEquals(1, open(p).size(), "once, not once a day");

        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(1), 60));
        assertEquals(0, open(p).size(), "she played: it ends");
    }

    @Test
    @DisplayName("a patient who has played within three days is never flagged")
    void notMissed() {
        Patient p = patient();
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), Instant.now().minus(2, ChronoUnit.DAYS), 60));
        alerts.checkMissedDays(Instant.now());
        assertEquals(0, open(p).size());
    }

    /* -------------------------------------------------------- dashboards */

    @Test
    @DisplayName("the dashboard shows what ingestion stored; a doctor sees it without the family; raw trials are never served")
    void dashboards() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        AppUser doctor = newUser(Role.DOCTOR);
        Patient p = newPatient(owner);
        grantTo(p, doctor, owner, 30);
        FamilyMember m = new FamilyMember();
        m.setPatientId(p.getId());
        m.setName("Rupa");
        familyMembers.save(m);

        SessionEnvelope duck = Envelopes.withMarkers(
                Envelopes.withTrials(Envelopes.of(p.getId(), "duck-roll-call", ago(5),
                        Envelopes.c("EXECUTIVE", 55, 0.6), Envelopes.c("WORKING_MEMORY_SPAN", 55, 0.6)),
                        List.of(Map.of("secretTrialDetail", 123))),
                new SessionMarkers(4.0, null, null));
        ingestion.ingest(p.getId(), null, duck);
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(3), 80));

        String ownerToken = tokenFor(owner);
        String doctorToken = tokenFor(doctor);

        JsonNode mine = read("/api/caregiver/dashboard/" + p.getId(), ownerToken);
        assertFalse(mine.get("doctorView").asBoolean());
        assertEquals(1, mine.get("familyPhases").size());
        assertEquals(6, mine.get("domains").size());
        assertEquals(1, mine.get("subSignals").size(), "only the sub-signals that have been measured");
        assertEquals(4.0, mine.get("markers").get("workingMemorySpan").asDouble());
        assertEquals(2, mine.get("sessionsLast7Days").asInt());
        assertTrue(mine.get("games").size() >= 6, "titles and domains come from the registry");

        JsonNode theirs = read("/api/caregiver/dashboard/" + p.getId(), doctorToken);
        assertTrue(theirs.get("doctorView").asBoolean());
        assertEquals(0, theirs.get("familyPhases").size(), "a doctor does not see who visits her");
        assertFalse(theirs.toString().contains("Rupa"));

        for (String token : List.of(ownerToken, doctorToken)) {
            String sessionsJson = read("/api/caregiver/patients/" + p.getId() + "/sessions", token).toString();
            assertFalse(sessionsJson.contains("secretTrialDetail"), "raw trials are never served");
            assertFalse(sessionsJson.toLowerCase().contains("\"trials\""));
            assertTrue(sessionsJson.contains("synthetic"), "each contribution carries its plain-language reason");
        }
        JsonNode series = read("/api/caregiver/patients/" + p.getId() + "/timeseries?days=30", doctorToken);
        assertEquals(2, series.size());
        assertTrue(series.get(1).get("levels").has("MOTOR"));
    }

    private JsonNode read(String path, String token) throws Exception {
        MvcResult r = mvc.perform(get(path).with(from(freshIp())).header("Authorization", bearer(token))).andReturn();
        assertEquals(200, r.getResponse().getStatus(), path + " " + r.getResponse().getContentAsString());
        return json.readTree(r.getResponse().getContentAsString());
    }

    @Test
    @DisplayName("the report is fed from the same real data and names no family member")
    void report() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        Patient p = newPatient(owner);
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(3), 80));
        MvcResult r = mvc.perform(get("/api/report/patient/" + p.getId()).with(from(freshIp()))
                        .header("Authorization", bearer(tokenFor(owner))))
                .andReturn();
        assertEquals(200, r.getResponse().getStatus());
        byte[] pdf = r.getResponse().getContentAsByteArray();
        assertTrue(pdf.length > 1000);
        assertEquals("%PDF", new String(pdf, 0, 4));
    }

    /* ------------------------------------------------------------ events */

    @Test
    @DisplayName("a dashboard is told live when a session arrives, and is cut off when its access ends")
    void liveEvents() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        AppUser doctor = newUser(Role.DOCTOR);
        Patient p = newPatient(owner);
        grantTo(p, doctor, owner, 30);

        MvcResult ownerStream = mvc.perform(get("/api/caregiver/patients/" + p.getId() + "/events")
                        .with(from(freshIp())).header("Authorization", bearer(tokenFor(owner))))
                .andExpect(request().asyncStarted())
                .andReturn();
        MvcResult doctorStream = mvc.perform(get("/api/caregiver/patients/" + p.getId() + "/events")
                        .with(from(freshIp())).header("Authorization", bearer(tokenFor(doctor))))
                .andExpect(request().asyncStarted())
                .andReturn();

        Outcome first = ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(4), 60));
        String ownerText = ownerStream.getResponse().getContentAsString();
        String doctorText = doctorStream.getResponse().getContentAsString();
        assertTrue(ownerText.contains("event:session") && ownerText.contains(first.sessionId()), ownerText);
        assertTrue(doctorText.contains(first.sessionId()), "a doctor with a live grant is told too");
        assertFalse(ownerText.contains("secret"), "an event names ids and nothing else");

        // Her access ends. The next event does not reach her, and her stream is closed.
        jdbc.update("update doctor_grant set expires_at = now() - interval '1 minute' where patient_id = ?", p.getId());
        Outcome second = ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), ago(2), 61));
        assertTrue(ownerStream.getResponse().getContentAsString().contains(second.sessionId()));
        assertFalse(doctorStream.getResponse().getContentAsString().contains(second.sessionId()),
                "an expired grant stops working on the next event");
    }

    @Test
    @DisplayName("nobody who may not read a patient can open her stream")
    void streamIsGuarded() throws Exception {
        AppUser owner = newUser(Role.CAREGIVER);
        Patient p = newPatient(owner);
        String other = tokenFor(newUser(Role.CAREGIVER));
        assertEquals(404, status(get("/api/caregiver/patients/" + p.getId() + "/events"), other));
        assertEquals(401, mvc.perform(get("/api/caregiver/patients/" + p.getId() + "/events").with(from(freshIp())))
                .andReturn().getResponse().getStatus());
    }

    /* --------------------------------------------------------- rescoring */

    private List<Object> duckTrials() {
        return List.of(
                Map.of("spanLength", 3, "flashDurationMs", 2000, "correctFirstAttempt", true, "attempts", 1,
                        "timeToFirstTapMs", 1500, "completedRound", true),
                Map.of("spanLength", 4, "flashDurationMs", 2000, "correctFirstAttempt", false, "attempts", 2,
                        "firstErrorAtPosition", 3, "timeToFirstTapMs", 2500, "completedRound", true));
    }

    private List<ScoreContribution> serverScores(List<Object> trials) {
        return DuckRollCallScoring.score(trials);
    }

    @Test
    @DisplayName("a Duck Roll Call session whose scores the server reproduces from the raw trials is marked as such")
    void rescoredAgrees() {
        Patient p = patient();
        List<Object> trials = duckTrials();
        SessionEnvelope e = Envelopes.withTrials(
                Envelopes.of(p.getId(), "duck-roll-call", ago(2), serverScores(trials).toArray(new ScoreContribution[0])), trials);
        double before = meters.get("scoring_rescored_total").counter().count();
        Outcome out = ingestion.ingest(p.getId(), null, e);
        assertEquals(Status.ACCEPTED, out.status(), out.reason());
        assertEquals("server", jdbc.queryForObject("select scoring_trust from game_session where id = ?", String.class, out.sessionId()));
        assertEquals(before + 1, meters.get("scoring_rescored_total").counter().count());
    }

    @Test
    @DisplayName("a session whose scores the server cannot reproduce is stored as the tablet's and counted as a mismatch")
    void rescoredDisagrees() {
        Patient p = patient();
        List<Object> trials = duckTrials();
        List<ScoreContribution> honest = serverScores(trials);
        ScoreContribution[] inflated = honest.stream()
                .map(c -> new ScoreContribution(c.target(), Math.min(100, c.raw() + 20), c.confidence(), c.because()))
                .toArray(ScoreContribution[]::new);
        SessionEnvelope e = Envelopes.withTrials(Envelopes.of(p.getId(), "duck-roll-call", ago(2), inflated), trials);
        double before = meters.get("scoring_mismatch_total").counter().count();
        Outcome out = ingestion.ingest(p.getId(), null, e);
        assertEquals(Status.ACCEPTED, out.status());
        assertEquals("device", jdbc.queryForObject("select scoring_trust from game_session where id = ?", String.class, out.sessionId()));
        assertEquals(before + 1, meters.get("scoring_mismatch_total").counter().count());
    }

    @Test
    @DisplayName("a session with no recorded rounds has nothing to score from: it stays the tablet's, and is not a mismatch")
    void noRoundsIsNotAMismatch() {
        Patient p = patient();
        SessionEnvelope e = Envelopes.withTrials(
                Envelopes.of(p.getId(), "duck-roll-call", ago(2), Envelopes.c("EXECUTIVE", 61.5, 0.8)), List.of());
        double mismatches = meters.get("scoring_mismatch_total").counter().count();
        double rescored = meters.get("scoring_rescored_total").counter().count();
        Outcome out = ingestion.ingest(p.getId(), null, e);
        assertEquals(Status.ACCEPTED, out.status(), out.reason());
        assertEquals("device", jdbc.queryForObject("select scoring_trust from game_session where id = ?", String.class, out.sessionId()));
        assertEquals(mismatches, meters.get("scoring_mismatch_total").counter().count());
        assertEquals(rescored, meters.get("scoring_rescored_total").counter().count());
    }

    @Test
    @DisplayName("a tablet cannot dodge the re-scoring by calling its own scores precomputed")
    void precomputedFlagDoesNotSkipTheCheck() {
        Patient p = patient();
        List<Object> trials = duckTrials();
        ScoreContribution[] inflated = serverScores(trials).stream()
                .map(c -> new ScoreContribution(c.target(), Math.min(100, c.raw() + 20), c.confidence(), c.because()))
                .toArray(ScoreContribution[]::new);
        SessionEnvelope e = Envelopes.withPrecomputed(
                Envelopes.withTrials(Envelopes.of(p.getId(), "duck-roll-call", ago(2), inflated), trials), true);
        double before = meters.get("scoring_mismatch_total").counter().count();
        Outcome out = ingestion.ingest(p.getId(), null, e);
        assertEquals(Status.ACCEPTED, out.status(), out.reason());
        assertEquals(before + 1, meters.get("scoring_mismatch_total").counter().count());
    }
}
