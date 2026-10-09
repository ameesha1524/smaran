package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.GameSession;
import org.smaran.domain.GardenState;
import org.smaran.domain.ProfileSnapshot;
import org.smaran.repo.CognitiveProfileRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.ProfileSnapshotRepository;
import org.smaran.scoring.CognitiveScoringService;
import org.smaran.scoring.Contract;
import org.smaran.scoring.Contract.Reading;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.smaran.scoring.Contract.SessionMarkers;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.scoring.EnvelopeValidator;
import org.smaran.scoring.GameRegistry;
import org.smaran.scoring.ScoringEngine;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accepting finished sessions from a tablet.
 *
 * <b>Idempotent.</b> A session is the same session if its {@code clientSessionId}
 * or its (patient, startedAt) matches one already stored, and then the server's
 * copy wins and the incoming one is dropped. That is what lets a tablet that
 * has been offline for three days re-send its whole queue as often as it likes.
 * The profile row is locked first, so two batches racing for one patient are
 * handled one after the other and cannot both think a session is new.
 *
 * <b>In order, or rebuilt.</b> A session newer than everything stored is folded
 * into the profile in one step. One older than something already stored
 * (a tablet that synced late) cannot be: the engine's baseline depends on the
 * order of what came before. So the whole profile is rebuilt by replaying every
 * session oldest first, and every snapshot is rewritten. A replayed rebuild and
 * an incremental fold give the same numbers; a test holds them to it.
 *
 * <b>Trust.</b> The contributions were computed on the tablet. They are checked
 * ({@link EnvelopeValidator}) and stored as {@code scoring_trust = device}; they
 * are not recomputed here except for games the server can re-score
 * ({@link Rescorer}).
 *
 * Nothing leaves this class that a dashboard may not read: events carry ids only.
 */
@Service
@Slf4j
public class SessionIngestionService {

    public enum Status {
        ACCEPTED, DUPLICATE, REJECTED
    }

    public record Outcome(String clientSessionId, Status status, String reason, String sessionId) {
    }

    public record BatchResult(List<Outcome> outcomes, GardenState garden) {
        public int count(Status s) {
            return (int) outcomes.stream().filter(o -> o.status() == s).count();
        }
    }

    private static final TypeReference<Map<String, Double>> DOUBLES = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, String>> STRINGS = new TypeReference<>() {
    };

    private final GameSessionRepository sessions;
    private final CognitiveProfileRepository profileRepo;
    private final ProfileSnapshotRepository snapshots;
    private final CognitiveProfileService profiles;
    private final CognitiveScoringService scoring;
    private final GardenStateService gardens;
    private final AlertService alerts;
    private final DashboardEvents events;
    private final EnvelopeValidator validator;
    private final GameRegistry registry;
    private final SessionRecords records;
    private final Rescorer rescorer;
    private final Clock clock;
    private final JdbcTemplate jdbc;

    public SessionIngestionService(
            GameSessionRepository sessions,
            CognitiveProfileRepository profileRepo,
            ProfileSnapshotRepository snapshots,
            CognitiveProfileService profiles,
            CognitiveScoringService scoring,
            GardenStateService gardens,
            AlertService alerts,
            DashboardEvents events,
            EnvelopeValidator validator,
            GameRegistry registry,
            SessionRecords records,
            Rescorer rescorer,
            Clock clock,
            JdbcTemplate jdbc) {
        this.sessions = sessions;
        this.profileRepo = profileRepo;
        this.snapshots = snapshots;
        this.profiles = profiles;
        this.scoring = scoring;
        this.gardens = gardens;
        this.alerts = alerts;
        this.events = events;
        this.validator = validator;
        this.registry = registry;
        this.records = records;
        this.rescorer = rescorer;
        this.clock = clock;
        this.jdbc = jdbc;
    }

    /** One tablet's queue. The garden is recomputed once, from the deduplicated history, at the end. */
    @Transactional
    public BatchResult ingestBatch(String patientId, String deviceId, List<SessionEnvelope> envelopes) {
        List<Outcome> outcomes = new ArrayList<>();
        for (SessionEnvelope e : envelopes == null ? List.<SessionEnvelope>of() : envelopes) {
            outcomes.add(ingest(patientId, deviceId, e));
        }
        BatchResult result = new BatchResult(outcomes, null);
        GardenState garden = result.count(Status.ACCEPTED) > 0 ? recomputeGarden(patientId) : gardens.forPatient(patientId);
        log.info("sessions for {}: {} accepted, {} duplicates, {} rejected",
                patientId, result.count(Status.ACCEPTED), result.count(Status.DUPLICATE), result.count(Status.REJECTED));
        return new BatchResult(outcomes, garden);
    }

    /** Store one session and fold it into the profile. The caller has authorised the patient. */
    @Transactional
    public Outcome ingest(String patientId, String deviceId, SessionEnvelope in) {
        Instant now = clock.instant();
        String key = in == null ? null : in.clientSessionId();

        Optional<String> bad = validator.reject(in, now);
        if (bad.isPresent()) {
            return new Outcome(key, Status.REJECTED, bad.get(), null);
        }
        Instant startedAt = Instant.parse(in.startedAt());

        // The lock comes first: everything below assumes nobody else is changing this profile.
        // An advisory lock serialises two batches even for a patient whose profile row does not exist
        // yet (both would try to create it); the row lock below then guards the profile itself.
        jdbc.queryForObject("select cast(pg_advisory_xact_lock(hashtext(?)) as text)", String.class, patientId);
        profiles.forPatient(patientId);
        CognitiveProfile profile = profileRepo.lockFor(patientId).orElseThrow();

        Optional<GameSession> sameKey = sessions.findByClientSessionId(in.clientSessionId());
        if (sameKey.isPresent()) {
            if (!sameKey.get().getPatientId().equals(patientId)) {
                return new Outcome(key, Status.REJECTED, "that session id is already in use", null);
            }
            return new Outcome(key, Status.DUPLICATE, null, sameKey.get().getId());
        }
        Optional<GameSession> sameTime = sessions.findByPatientIdAndStartedAt(patientId, startedAt);
        if (sameTime.isPresent()) {
            return new Outcome(key, Status.DUPLICATE, null, sameTime.get().getId());
        }

        Optional<GameSession> latest = sessions.findTopByPatientIdOrderByStartedAtDesc(patientId);
        boolean inOrder = latest.isEmpty() || startedAt.isAfter(latest.get().getStartedAt());

        // saveAndFlush returns the managed copy (the id is assigned, so Spring merges); changes
        // made to the original after this point would be silently lost.
        GameSession session = sessions.saveAndFlush(build(patientId, deviceId, in, startedAt, now));

        // A game the server can score from its raw trials is scored again, and a
        // disagreement is counted. What is stored is still the tablet's, until the
        // two agree often enough to change that (see Rescorer).
        rescorer.check(session);

        List<Reading> readings;
        Map<String, TargetState> state;
        if (inOrder) {
            CognitiveScoringService.Applied applied = scoring.applyContributions(
                    profile.getScoringState(), profiles.scores(profile), contributionsOf(session));
            state = applied.state();
            readings = applied.readings();
            snapshots.save(snapshotAfter(session, state, readings, snapshots.findTopByPatientIdOrderByAtDesc(patientId)));
            profiles.storeState(profile, state);
            profiles.refreshDerived(profile, session);
            alerts.observe(patientId, state, readings, startedAt);
        } else {
            log.info("session {} for {} arrived out of order, rebuilding the profile", session.getId(), patientId);
            rebuild(profile, patientId, startedAt);
        }
        profileRepo.save(profile);

        alerts.sawActivity(patientId, latest.isPresent() && !inOrder ? latest.get().getStartedAt() : startedAt, now);
        alerts.observeSundowning(patientId, now);

        events.publish(patientId, "session", Map.of(
                "sessionId", session.getId(), "gameId", in.gameId(), "at", startedAt.toString()));
        return new Outcome(key, Status.ACCEPTED, null, session.getId());
    }

    /* ------------------------------------------------------------ storing */

    private GameSession build(String patientId, String deviceId, SessionEnvelope in, Instant startedAt, Instant now) {
        GameRegistry.Entry game = registry.find(in.gameId()).orElseThrow();
        List<ScoreContribution> cleaned = new ArrayList<>();
        for (ScoreContribution c : in.contributions() == null ? List.<ScoreContribution>of() : in.contributions()) {
            cleaned.add(new ScoreContribution(c.target(), c.raw(), c.confidence(), EnvelopeValidator.cleanBecause(c.because())));
        }

        GameSession s = new GameSession();
        s.setPatientId(patientId);
        s.setGameType(game.gameType());
        s.setGameId(game.id());
        s.setClientSessionId(in.clientSessionId());
        s.setDeviceId(deviceId);
        s.setStartedAt(startedAt);
        s.setDurationMs(in.durationMs());
        s.setCompleted(in.completed());
        s.setAbandoned(in.abandoned());
        s.setHourOfDay(in.hourOfDay());
        s.setMoodAtStart(EnvelopeValidator.moodOf(in.moodAtStart()));
        s.setDifficultyTier(in.difficulty() == null ? 1 : in.difficulty().tier());
        s.setDifficulty(records.write(in.difficulty() == null ? new Contract.Difficulty(1, Map.of()) : in.difficulty()));
        // How much of the session she did: the garden grows by it. An envelope has no such number, so it is read
        // off whether she finished, left, or neither.
        s.setCompletionRate(in.completed() ? 1.0 : in.abandoned() ? 0.25 : 0.6);
        s.setCognitiveLoadScore(0);
        s.setTrials(records.write(in.trials() == null ? List.of() : in.trials()));
        s.setContributions(records.write(cleaned));
        s.setMarkers(in.markers() == null ? null : records.write(in.markers()));
        s.setPrecomputedReading(Boolean.TRUE.equals(in.precomputedReading()) || game.precomputed());
        s.setEngineVersion(in.engineVersion());
        s.setScoringTrust("device");
        s.setReceivedAt(now);
        return s;
    }

    private List<ScoreContribution> contributionsOf(GameSession s) {
        return records.contributionsOf(s, profiles.legacyReadingsOf(s));
    }

    /* ------------------------------------------------------------ rebuild */

    /** Replay every session, oldest first, from a profile that has seen nothing; rewrite every snapshot. */
    private void rebuild(CognitiveProfile profile, String patientId, Instant arrivedStartedAt) {
        List<GameSession> all = sessions.findByPatientIdOrderByStartedAtAsc(patientId);
        snapshots.deleteAllFor(patientId);

        Map<String, TargetState> state = Map.of();
        ProfileSnapshot previous = null;
        Map<String, Reading> lastReading = new LinkedHashMap<>();
        for (GameSession s : all) {
            ScoringEngine.SessionResult result =
                    ScoringEngine.applySession(state, contributionsOf(s), scoring.config());
            state = result.state();
            for (Reading r : result.readings()) {
                lastReading.put(r.target(), r);
            }
            previous = snapshots.save(snapshotAfter(s, state, result.readings(), Optional.ofNullable(previous)));
        }
        profiles.storeState(profile, state);
        if (!all.isEmpty()) {
            profiles.refreshDerived(profile, all.get(all.size() - 1));
        }
        // Alerts for what the profile says now. Re-raising an episode that already ended
        // would only duplicate it, so past sessions are not asked again.
        alerts.observe(patientId, state, new ArrayList<>(lastReading.values()), all.get(all.size() - 1).getStartedAt());
    }

    /* ---------------------------------------------------------- snapshots */

    private ProfileSnapshot snapshotAfter(
            GameSession session,
            Map<String, TargetState> state,
            List<Reading> readings,
            Optional<ProfileSnapshot> previous) {
        Map<String, Double> velocities = previous
                .map(p -> records.read(p.getVelocities(), DOUBLES, new LinkedHashMap<String, Double>()))
                .map(LinkedHashMap::new).orElseGet(LinkedHashMap::new);
        Map<String, String> statuses = previous
                .map(p -> records.read(p.getStatuses(), STRINGS, new LinkedHashMap<String, String>()))
                .map(LinkedHashMap::new).orElseGet(LinkedHashMap::new);
        for (Reading r : readings) {
            velocities.put(r.target(), r.velocity());
            statuses.put(r.target(), r.status().label());
        }
        Map<String, Double> levels = new LinkedHashMap<>();
        Map<String, Double> confidences = new LinkedHashMap<>();
        state.forEach((target, t) -> {
            levels.put(target, t.level());
            confidences.put(target, Math.min(1, (double) t.observations() / scoring.config().fullConfidenceObservations()));
        });

        SessionMarkers carried = previous.map(p -> records.read(p.getMarkers(), new TypeReference<SessionMarkers>() { }, null))
                .orElse(null);
        SessionMarkers merged = mergeMarkers(carried, records.markersOf(session));

        ProfileSnapshot snap = new ProfileSnapshot();
        snap.setPatientId(session.getPatientId());
        snap.setSessionId(session.getId());
        snap.setAt(session.getStartedAt());
        snap.setLevels(records.write(levels));
        snap.setVelocities(records.write(velocities));
        snap.setStatuses(records.write(statuses));
        snap.setConfidences(records.write(confidences));
        snap.setMarkers(merged == null ? null : records.write(merged));
        snap.setEngineVersion(session.getEngineVersion() == null ? Contract.ENGINE_VERSION : session.getEngineVersion());
        return snap;
    }

    /** A marker the new session measured replaces the old; one it did not measure is kept. */
    static SessionMarkers mergeMarkers(SessionMarkers previous, SessionMarkers next) {
        if (previous == null) {
            return next;
        }
        if (next == null) {
            return previous;
        }
        return new SessionMarkers(
                next.workingMemorySpan() != null ? next.workingMemorySpan() : previous.workingMemorySpan(),
                next.inhibitionBreakdownTier() != null ? next.inhibitionBreakdownTier() : previous.inhibitionBreakdownTier(),
                next.trajectoryPrecisionMs() != null ? next.trajectoryPrecisionMs() : previous.trajectoryPrecisionMs());
    }

    /* -------------------------------------------------------------- garden */

    /** From the whole deduplicated history, not from the events: a replayed batch cannot inflate it. */
    private GardenState recomputeGarden(String patientId) {
        List<GardenStateService.SessionFact> facts = sessions
                .findTop50ByPatientIdOrderByStartedAtDesc(patientId)
                .stream()
                .map(s -> new GardenStateService.SessionFact(s.getGameType(), s.getCompletionRate(), s.getStartedAt()))
                .toList();
        GardenState garden = gardens.recomputeFrom(patientId, facts);
        events.publish(patientId, "garden", Map.of("bloomStage", garden.getBloomStage()));
        return garden;
    }

    /** For tests and the seeder: the registry id of a game type. */
    public Optional<String> gameIdOf(GameType type) {
        return registry.of(type).map(GameRegistry.Entry::id);
    }
}
