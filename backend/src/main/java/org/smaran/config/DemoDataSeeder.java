package org.smaran.config;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.Caregiver;
import org.smaran.domain.CognitiveObjectResult;
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
import org.smaran.repo.CaregiverRepository;
import org.smaran.repo.CognitiveObjectResultRepository;
import org.smaran.repo.FamilyMemberRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.MeaningfulObjectRepository;
import org.smaran.repo.MoodLogRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.repo.ReminderScheduleRepository;
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
 * All names, objects and memories here are fictional placeholders for content a
 * real caregiver uploads during setup.
 */
@Component
@Profile("dev")
@Slf4j
public class DemoDataSeeder implements CommandLineRunner {

    public static final String PATIENT_ID = "demo-patient";

    private final PatientRepository patients;
    private final CaregiverRepository caregivers;
    private final FamilyMemberRepository family;
    private final MeaningfulObjectRepository objects;
    private final GameSessionRepository sessions;
    private final CognitiveObjectResultRepository objectResults;
    private final MoodLogRepository moods;
    private final ReminderScheduleRepository reminders;
    private final PasswordEncoder encoder;

    public DemoDataSeeder(
            PatientRepository patients,
            CaregiverRepository caregivers,
            FamilyMemberRepository family,
            MeaningfulObjectRepository objects,
            GameSessionRepository sessions,
            CognitiveObjectResultRepository objectResults,
            MoodLogRepository moods,
            ReminderScheduleRepository reminders,
            PasswordEncoder encoder) {
        this.patients = patients;
        this.caregivers = caregivers;
        this.family = family;
        this.objects = objects;
        this.sessions = sessions;
        this.objectResults = objectResults;
        this.moods = moods;
        this.reminders = reminders;
        this.encoder = encoder;
    }

    @Override
    public void run(String... args) {
        if (patients.existsById(PATIENT_ID)) {
            return;
        }
        log.info("seeding demo data (dev profile)");

        Caregiver caregiver = new Caregiver();
        caregiver.setId("demo-caregiver");
        caregiver.setName("Rupa Baruah");
        caregiver.setEmail("rupa@example.com");
        caregiver.setPasswordHash(encoder.encode("smaran"));
        caregiver.setRole(Role.CAREGIVER);
        caregiver.getAssignedPatientIds().add(PATIENT_ID);
        caregivers.save(caregiver);

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
            GameType.FAMILY_GROVE, GameType.WEAVERS_LOOM, GameType.GRANDMOTHERS_TALE, GameType.MORNING_RITUALS
        };
        Mood[] moodRotation = {Mood.PEACEFUL, Mood.QUIET, Mood.JOYFUL, Mood.A_LITTLE_LOW, Mood.THINKING};

        for (int day = 29; day >= 0; day--) {
            // Two rest days a week — a real week, not a demo week.
            if (day % 7 == 3 || day % 7 == 6) {
                continue;
            }
            Instant at = Instant.now().minus(Duration.ofDays(day)).minus(Duration.ofHours(2));
            GameType type = rotation[day % rotation.length];
            double progress = (29 - day) / 29d;

            GameSession session = new GameSession();
            session.setPatientId(PATIENT_ID);
            session.setGameType(type);
            session.setStartedAt(at);
            session.setDurationMs(Duration.ofMinutes(9 + (day % 5)).toMillis());
            session.setCompletionRate(
                    type == GameType.WEAVERS_LOOM ? clamp(0.92 - progress * 0.35) : clamp(0.78 + (day % 3) * 0.04));
            session.setDifficultyTier(2);
            session.setCognitiveLoadScore(0.4 + (day % 4) * 0.08);
            session.setMoodAtStart(moodRotation[day % moodRotation.length]);
            sessions.save(session);

            MoodLog mood = new MoodLog();
            mood.setPatientId(PATIENT_ID);
            mood.setMood(session.getMoodAtStart());
            mood.setAt(at);
            mood.setLocalHour(at.atZone(ZoneId.systemDefault()).getHour());
            moods.save(mood);

            if (type == GameType.WEAVERS_LOOM) {
                // The declining cluster is MUSICAL specifically. Everything else
                // holds, which is what makes it a domain signal and not decay.
                objectResults.save(objectResult(session.getId(), at, "Dhol", SemanticCluster.MUSICAL, progress > 0.45));
                objectResults.save(objectResult(session.getId(), at, "Pepa", SemanticCluster.MUSICAL, progress > 0.6));
                objectResults.save(objectResult(session.getId(), at, "Brass lamp", SemanticCluster.DAILY_LIFE, true));
                objectResults.save(objectResult(session.getId(), at, "Tea leaves", SemanticCluster.FOOD, true));
                objectResults.save(objectResult(session.getId(), at, "Kopou phool", SemanticCluster.NATURE, day % 5 != 0));
            }
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
