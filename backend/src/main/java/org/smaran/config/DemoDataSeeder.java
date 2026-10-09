package org.smaran.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.AppUser;
import org.smaran.domain.ConsentRecord;
import org.smaran.domain.DoctorGrant;
import org.smaran.domain.CognitiveObjectResult;
import org.smaran.domain.DomainReading;
import org.smaran.domain.Enums.GameType;
import org.smaran.domain.Enums.Mood;
import org.smaran.domain.Enums.PeakWindow;
import org.smaran.domain.Enums.ReminderType;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Enums.SemanticCluster;
import org.smaran.domain.FamilyMember;
import org.smaran.domain.GameSession;
import org.smaran.domain.MeaningfulObject;
import org.smaran.domain.MoodLog;
import org.smaran.domain.Patient;
import org.smaran.domain.ReminderSchedule;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.ConsentRecordRepository;
import org.smaran.repo.DoctorGrantRepository;
import org.smaran.repo.CognitiveObjectResultRepository;
import org.smaran.repo.FamilyMemberRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.MeaningfulObjectRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.repo.ReminderScheduleRepository;
import org.smaran.scoring.Contract;
import org.smaran.scoring.DuckRollCallScoring;
import org.smaran.scoring.LegacyScores;
import org.smaran.service.CognitiveMap;
import org.smaran.service.SessionIngestionService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * A month of history for the `dev` profile, so the dashboard has something
 * honest to draw and the demo opens into a populated pond.
 *
 * The shape of the data is chosen to show the one thing the dashboard exists to
 * surface: visual-semantic recognition declining steadily while every other
 * domain holds. That is the signal a caregiver would otherwise never see.
 *
 * Every session carries the domain readings a real one would: single-domain
 * games read their completion rate, the Lotus Frog reads four domains at
 * once, and Duck Roll Call and Koi Are Jumping read their own domain with
 * the same shape the device produces.
 *
 * All names, objects and memories here are fictional placeholders for content a
 * real caregiver uploads during setup.
 */
@Component
@Profile({"dev", "demo"})
@Slf4j
public class DemoDataSeeder implements CommandLineRunner {

    public static final String PATIENT_ID = "demo-patient";

    private final PatientRepository patients;
    private final AppUserRepository users;
    private final DoctorGrantRepository grants;
    private final ConsentRecordRepository consents;
    private final org.springframework.core.env.Environment environment;
    private final FamilyMemberRepository family;
    private final MeaningfulObjectRepository objects;
    private final CognitiveObjectResultRepository objectResults;
    private final MoodLogRepository moods;
    private final ReminderScheduleRepository reminders;
    private final PasswordEncoder encoder;
    private final ObjectMapper json;
    private final SessionIngestionService ingestion;

    public DemoDataSeeder(
            PatientRepository patients,
            AppUserRepository users,
            DoctorGrantRepository grants,
            ConsentRecordRepository consents,
            org.springframework.core.env.Environment environment,
            FamilyMemberRepository family,
            MeaningfulObjectRepository objects,
            CognitiveObjectResultRepository objectResults,
            MoodLogRepository moods,
            ReminderScheduleRepository reminders,
            PasswordEncoder encoder,
            ObjectMapper json,
            SessionIngestionService ingestion) {
        this.patients = patients;
        this.users = users;
        this.grants = grants;
        this.consents = consents;
        this.environment = environment;
        this.family = family;
        this.objects = objects;
        this.objectResults = objectResults;
        this.moods = moods;
        this.reminders = reminders;
        this.encoder = encoder;
        this.json = json;
        this.ingestion = ingestion;
    }

    @Override
    public void run(String... args) {
        if (patients.existsById(PATIENT_ID)) {
            return;
        }
        log.info("seeding synthetic demo data");

        // These accounts have weak, published passwords. They exist only in the
        // dev and demo profiles, and this refuses to run beside prod.
        if (environment.acceptsProfiles(org.springframework.core.env.Profiles.of("prod"))) {
            throw new IllegalStateException("Demo accounts must never be created with the prod profile active.");
        }

        AppUser caregiver = account("demo-caregiver", "Rupa Baruah", "rupa@example.com", Role.CAREGIVER);
        AppUser doctor = account("demo-doctor", "Dr. Meera Das", "meera.das@example.com", Role.DOCTOR);
        account("demo-admin", "Demo Admin", "admin@example.com", Role.ADMIN);

        Patient patient = new Patient();
        patient.setId(PATIENT_ID);
        patient.setName("Anima Baruah");
        patient.setLanguageCode("as");
        patient.setKinshipTerm("আইতা");
        patient.setRegion("Jorhat, Assam");
        patient.setFaith("Vaishnavite");
        patient.setPeakWindow(PeakWindow.MORNING);
        patient.setCaregiverId(caregiver.getId());
        patients.save(patient);

        ConsentRecord consent = new ConsentRecord();
        consent.setPatientId(PATIENT_ID);
        consent.setGivenBy(caregiver.getId());
        consent.setNoticeVersion("2026-10");
        consent.setGuardianName("Rupa Baruah");
        consents.save(consent);

        DoctorGrant grant = new DoctorGrant();
        grant.setPatientId(PATIENT_ID);
        grant.setDoctorUserId(doctor.getId());
        grant.setGrantedBy(caregiver.getId());
        grant.setExpiresAt(Instant.now().plus(Duration.ofDays(365)));
        grants.save(grant);

        family.saveAll(List.of(
                member("Rupa", "Daughter", "Jiyori", "She brings you tea in the blue cup every morning.", 3),
                member("Nabin", "Son", "Lora", "He fixed the radio that plays Bihu songs.", 2),
                member("Mitali", "Granddaughter", "Natini", "She lives in Bangalore and calls on Sunday evenings.", 1),
                member("Bhaskar", "Brother", "Bhai", "You both grew up beside the Bhogdoi river.", 1),
                member("Jyoti", "Neighbour", "Baideu", "She waters your plants when it is very hot.", 1)));

        objects.saveAll(List.of(
                object("Brass lamp", SemanticCluster.DAILY_LIFE, "🪔"),
                object("Dhol", SemanticCluster.MUSICAL, "🥁"),
                object("Gamosa", SemanticCluster.CRAFT, "🧣"),
                object("Tea leaves", SemanticCluster.FOOD, "🍃"),
                object("Kopou phool", SemanticCluster.NATURE, "🌺"),
                object("Xorai", SemanticCluster.DAILY_LIFE, "🏺"),
                object("Pepa", SemanticCluster.MUSICAL, "🎺"),
                object("Rice bowl", SemanticCluster.FOOD, "🍚")));

        reminders.saveAll(List.of(
                reminder(ReminderType.MEDICINE, "08:00", "{kin}, it is time for the small white tablet."),
                reminder(ReminderType.HYDRATION, "10:00", "{kin}, a little water?"),
                reminder(ReminderType.MEDICINE, "20:00", "{kin}, the evening tablet, with food.")));

        seedHistory();
        log.info("demo data ready — sign in as rupa@example.com / smaran");
    }

    /** Thirty days of sessions. Musical recognition fades; nothing else does. */
    private void seedHistory() {
        GameType[] rotation = {
            GameType.FAMILY_GROVE,
            GameType.LOTUS_FROG,
            GameType.GRANDMOTHERS_TALE,
            GameType.DUCK_ROLL_CALL,
            GameType.MORNING_RITUALS,
            GameType.KOI_ARE_JUMPING,
        };
        Mood[] moodRotation = {Mood.PEACEFUL, Mood.QUIET, Mood.JOYFUL, Mood.A_LITTLE_LOW, Mood.THINKING};

        for (int day = 29; day >= 0; day--) {
            // Two rest days a week — a real week, not a demo week.
            if (day % 7 == 3 || day % 7 == 6) {
                continue;
            }
          // Two sittings on a play day, the earlier one first, so history goes in oldest-first.
          for (int slot = 1; slot >= 0; slot--) {
            Instant at = Instant.now().minus(Duration.ofDays(day)).minus(Duration.ofHours(2L + slot * 5L));
            GameType type = rotation[(day * 2 + slot) % rotation.length];
            double progress = (29 - day) / 29d;
            double steady = clamp(0.78 + (day % 3) * 0.04);

            Map<String, DomainReading> readings = new LinkedHashMap<>();
            double completion;
            switch (type) {
                case LOTUS_FROG -> {
                    // The signal: visual-semantic falls while the pond's other
                    // three readings hold.
                    double visual = clamp(0.92 - progress * 0.35);
                    readings.put("visualSemantic", new DomainReading(visual, 0.9));
                    readings.put("motor", new DomainReading(clamp(0.7 + (day % 2) * 0.04), 0.8));
                    readings.put("affective", new DomainReading(clamp(0.74 + (day % 3) * 0.03), 0.7));
                    readings.put("temporal", new DomainReading(clamp(0.66 + (day % 4) * 0.02), 0.8));
                    completion = visual;
                }
                case DUCK_ROLL_CALL -> {
                    // Span calibrating upward over the month.
                    completion = clamp(0.55 + progress * 0.14);
                    readings.put("executiveFunction", new DomainReading(completion, 1));
                }
                case KOI_ARE_JUMPING -> {
                    completion = clamp(0.68 - progress * 0.05);
                    readings.put("motor", new DomainReading(completion, 1));
                }
                default -> {
                    completion = steady;
                    readings.put(CognitiveMap.primaryDomain(type), new DomainReading(completion, 1));
                }
            }

            Mood sessionMood = moodRotation[(day + slot) % moodRotation.length];
            List<Contract.ScoreContribution> contributions = new java.util.ArrayList<>();
            readings.forEach((domain, r) -> contributions.add(new Contract.ScoreContribution(
                    LegacyScores.DOMAIN_ID_OF.get(domain), r.score() * 100, r.confidence(),
                    "Synthetic demo history.")));
            // Duck Roll Call sends its rounds, and its scores are the ones the game's own rules give
            // them, so the server re-scores these and agrees (and the span marker is real).
            List<Object> trials = List.of();
            Contract.SessionMarkers markers = null;
            if (type == GameType.DUCK_ROLL_CALL) {
                int span = progress < 0.4 ? 3 : progress < 0.75 ? 4 : 5;
                List<Object> rounds = new java.util.ArrayList<>();
                for (int r = 0; r < 4; r++) {
                    boolean clean = (day + r) % 4 != 0;
                    Map<String, Object> round = new LinkedHashMap<>();
                    round.put("spanLength", span);
                    round.put("flashDurationMs", 2000);
                    round.put("correctFirstAttempt", clean);
                    round.put("attempts", clean ? 1 : 2);
                    round.put("firstErrorAtPosition", clean ? null : 2);
                    round.put("timeToFirstTapMs", 1500 + 250 * r + (day % 3) * 200);
                    round.put("completedRound", true);
                    rounds.add(round);
                }
                trials = rounds;
                contributions.clear();
                DuckRollCallScoring.score(rounds).forEach(c -> contributions.add(
                        new Contract.ScoreContribution(c.target(), c.raw(), c.confidence(), "Synthetic demo history.")));
                markers = new Contract.SessionMarkers((double) span, null, null);
            }

            // Through the same door a tablet uses, oldest first, so the demo profile, its
            // snapshots and its alerts are what the engine makes of this history and not
            // a hand-written number.
            String gameId = ingestion.gameIdOf(type).orElseThrow();
            Contract.SessionEnvelope envelope = new Contract.SessionEnvelope(
                    java.util.UUID.randomUUID().toString(),
                    PATIENT_ID,
                    gameId,
                    at.toString(),
                    Duration.ofMinutes(9 + (day % 5)).toMillis(),
                    true,
                    false,
                    at.atZone(ZoneId.systemDefault()).getHour(),
                    sessionMood.name(),
                    new Contract.Difficulty(2, Map.of()),
                    trials,
                    contributions,
                    markers,
                    type == GameType.LOTUS_FROG,
                    Contract.ENGINE_VERSION);
            SessionIngestionService.Outcome outcome = ingestion.ingest(PATIENT_ID, null, envelope);
            if (outcome.status() != SessionIngestionService.Status.ACCEPTED) {
                throw new IllegalStateException("demo session refused: " + outcome.reason());
            }
            String sessionId = outcome.sessionId();

            MoodLog mood = new MoodLog();
            mood.setPatientId(PATIENT_ID);
            mood.setMood(sessionMood);
            mood.setAt(at);
            mood.setLocalHour(at.atZone(ZoneId.systemDefault()).getHour());
            moods.save(mood);

            if (type == GameType.LOTUS_FROG) {
                // The declining cluster is MUSICAL specifically. Everything else
                // holds, which is what makes it a domain signal and not decay.
                // (No current game produces per-object results — the Weaver's
                // Loom did — so these stand in for that history in the demo.)
                objectResults.save(objectResult(sessionId, at, "Dhol", SemanticCluster.MUSICAL, progress > 0.45));
                objectResults.save(objectResult(sessionId, at, "Pepa", SemanticCluster.MUSICAL, progress > 0.6));
                objectResults.save(objectResult(sessionId, at, "Brass lamp", SemanticCluster.DAILY_LIFE, true));
                objectResults.save(objectResult(sessionId, at, "Tea leaves", SemanticCluster.FOOD, true));
                objectResults.save(objectResult(sessionId, at, "Kopou phool", SemanticCluster.NATURE, day % 5 != 0));
            }
        }
          }

    }

    private AppUser account(String id, String name, String email, Role role) {
        AppUser user = new AppUser();
        user.setId(id);
        user.setName(name);
        user.setEmail(email);
        user.setPasswordHash(encoder.encode("smaran"));
        user.setRole(role);
        return users.save(user);
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }

    /* ------------------------------------------------------- fragments */

    private FamilyMember member(String name, String relationship, String kin, String hint, int phase) {
        FamilyMember m = new FamilyMember();
        m.setPatientId(PATIENT_ID);
        m.setName(name);
        m.setRelationship(relationship);
        m.setKinshipTermLocal(kin);
        m.setContextHint(hint);
        m.setCurrentPhase(phase);
        return m;
    }

    private MeaningfulObject object(String name, SemanticCluster cluster, String glyph) {
        MeaningfulObject o = new MeaningfulObject();
        o.setPatientId(PATIENT_ID);
        o.setName(name);
        o.setSemanticCluster(cluster);
        o.setGlyph(glyph);
        return o;
    }

    private ReminderSchedule reminder(ReminderType type, String time, String template) {
        ReminderSchedule r = new ReminderSchedule();
        r.setPatientId(PATIENT_ID);
        r.setType(type);
        r.setScheduledTime(time);
        r.setMessageTemplate(template);
        r.setLanguageCode("as");
        return r;
    }

    private CognitiveObjectResult objectResult(
            String sessionId, Instant at, String name, SemanticCluster cluster, boolean correct) {
        CognitiveObjectResult r = new CognitiveObjectResult();
        r.setSessionId(sessionId);
        r.setPatientId(PATIENT_ID);
        r.setObjectName(name);
        r.setSemanticCluster(cluster);
        r.setTappedMs(correct ? 1800 : 0);
        r.setWasCorrect(correct);
        r.setCapturedAt(at);
        return r;
    }

    private static double clamp(double v) {
        return Math.max(0.2, Math.min(1, Math.round(v * 100) / 100d));
    }
}
