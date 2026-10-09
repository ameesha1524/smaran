package org.smaran.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.AppUser;
import org.smaran.domain.ConsentRecord;
import org.smaran.domain.Enums.PeakWindow;
import org.smaran.domain.Enums.Role;
import org.smaran.domain.Patient;
import org.smaran.repo.AppUserRepository;
import org.smaran.repo.ConsentRecordRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.scoring.Contract.SessionEnvelope;
import org.smaran.service.SessionIngestionService;
import org.springframework.core.io.Resource;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Loads the data-science layer's synthetic cohort (data-science/src/simulate.py) <em>through
 * {@link SessionIngestionService}</em>, the same service a tablet's request ends in.
 *
 * Nothing here writes a profile, a snapshot or an alert. It creates a caregiver and the patients (with the
 * consent record every patient has), and hands each patient's sessions to ingestion in time order, in batches,
 * exactly as a tablet's queue would arrive. So the dashboards that follow show what the production code
 * makes of that history, and an alert that opens for a simulated decline opens because the engine opened it.
 *
 * The file's dates are shifted by a whole number of weeks so its last day is yesterday: the server refuses
 * sessions older than 400 days, and a whole number of weeks keeps every weekday where the simulator put it.
 *
 * Never available beside the prod profile (see {@link CohortLoader}); the accounts it creates have a
 * published password.
 */
@Component
@Slf4j
public class CohortImport {

    public static final String OWNER_EMAIL = "cohort@example.com";
    static final int BATCH = 200;

    private final PatientRepository patients;
    private final AppUserRepository users;
    private final ConsentRecordRepository consents;
    private final SessionIngestionService ingestion;
    private final PasswordEncoder encoder;
    private final ObjectMapper json;
    private final Clock clock;

    public CohortImport(
            PatientRepository patients,
            AppUserRepository users,
            ConsentRecordRepository consents,
            SessionIngestionService ingestion,
            PasswordEncoder encoder,
            ObjectMapper json,
            Clock clock) {
        this.patients = patients;
        this.users = users;
        this.consents = consents;
        this.ingestion = ingestion;
        this.encoder = encoder;
        this.json = json;
        this.clock = clock;
    }

    /** One patient as loaded: her id here, the simulator's id and the trajectory it gave her. */
    public record Loaded(String patientId, String simulatedId, String trajectory, int accepted, int duplicates, int rejected) {
    }

    public record Summary(int shiftDays, List<Loaded> patients) {
        public int sessionsAccepted() {
            return patients.stream().mapToInt(Loaded::accepted).sum();
        }
    }

    /**
     * @param perTrajectory take at most this many patients of each trajectory (0 = all)
     */
    public Summary load(Resource file, int perTrajectory) throws IOException {
        JsonNode root;
        try (InputStream in = file.getInputStream()) {
            root = json.readTree(in);
        }
        List<JsonNode> chosen = choose(root.get("patients"), perTrajectory);
        if (chosen.isEmpty()) {
            return new Summary(0, List.of());
        }

        LocalDate last = LocalDate.MIN;
        for (JsonNode p : chosen) {
            for (JsonNode e : p.get("envelopes")) {
                LocalDate d = Instant.parse(e.get("startedAt").asText()).atOffset(ZoneOffset.UTC).toLocalDate();
                if (d.isAfter(last)) {
                    last = d;
                }
            }
        }
        LocalDate yesterday = clock.instant().atOffset(ZoneOffset.UTC).toLocalDate().minusDays(1);
        long gap = ChronoUnit.DAYS.between(last, yesterday);
        int shift = (int) (Math.max(0, gap) / 7 * 7);

        AppUser owner = owner();
        List<Loaded> loaded = new ArrayList<>();
        for (JsonNode p : chosen) {
            String simulated = p.get("patientId").asText();
            String id = "cohort-" + simulated.replace("sim-", "");
            if (patients.existsById(id)) {
                log.info("cohort patient {} is already here, skipped", id);
                continue;
            }
            createPatient(id, simulated, owner);
            int accepted = 0;
            int duplicates = 0;
            int rejected = 0;
            List<SessionEnvelope> batch = new ArrayList<>();
            for (JsonNode e : p.get("envelopes")) {
                SessionEnvelope in = json.treeToValue(e, SessionEnvelope.class);
                batch.add(shifted(in, id, shift));
                if (batch.size() == BATCH) {
                    int[] c = send(id, batch);
                    accepted += c[0];
                    duplicates += c[1];
                    rejected += c[2];
                    batch.clear();
                }
            }
            if (!batch.isEmpty()) {
                int[] c = send(id, batch);
                accepted += c[0];
                duplicates += c[1];
                rejected += c[2];
            }
            loaded.add(new Loaded(id, simulated, p.get("trajectory").asText(), accepted, duplicates, rejected));
            log.info("cohort patient {} ({}): {} sessions accepted, {} rejected", id, p.get("trajectory").asText(), accepted, rejected);
        }
        return new Summary(shift, loaded);
    }

    private int[] send(String patientId, List<SessionEnvelope> batch) {
        SessionIngestionService.BatchResult r = ingestion.ingestBatch(patientId, null, new ArrayList<>(batch));
        return new int[] {
            r.count(SessionIngestionService.Status.ACCEPTED),
            r.count(SessionIngestionService.Status.DUPLICATE),
            r.count(SessionIngestionService.Status.REJECTED)
        };
    }

    private static SessionEnvelope shifted(SessionEnvelope e, String patientId, int shiftDays) {
        String at = Instant.parse(e.startedAt()).plus(Duration.ofDays(shiftDays)).toString();
        return new SessionEnvelope(e.clientSessionId(), patientId, e.gameId(), at, e.durationMs(), e.completed(),
                e.abandoned(), e.hourOfDay(), e.moodAtStart(), e.difficulty(), e.trials(), e.contributions(), e.markers(),
                e.precomputedReading(), e.engineVersion());
    }

    private static List<JsonNode> choose(JsonNode all, int perTrajectory) {
        List<JsonNode> out = new ArrayList<>();
        Map<String, Integer> taken = new HashMap<>();
        for (JsonNode p : all) {
            String kind = p.get("trajectory").asText();
            int n = taken.merge(kind, 1, Integer::sum);
            if (perTrajectory <= 0 || n <= perTrajectory) {
                out.add(p);
            }
        }
        return out;
    }

    private AppUser owner() {
        return users.findByEmail(OWNER_EMAIL).orElseGet(() -> {
            AppUser u = new AppUser();
            u.setId("cohort-caregiver");
            u.setEmail(OWNER_EMAIL);
            u.setName("Cohort owner (synthetic)");
            u.setPasswordHash(encoder.encode("smaran"));
            u.setRole(Role.CAREGIVER);
            return users.save(u);
        });
    }

    private void createPatient(String id, String simulatedId, AppUser owner) {
        Patient patient = new Patient();
        patient.setId(id);
        patient.setName("Simulated " + simulatedId.replace("sim-", ""));
        patient.setLanguageCode("as");
        patient.setKinshipTerm("আইতা");
        patient.setRegion("Synthetic");
        patient.setFaith("");
        patient.setPeakWindow(PeakWindow.MORNING);
        patient.setCaregiverId(owner.getId());
        patients.save(patient);

        ConsentRecord consent = new ConsentRecord();
        consent.setPatientId(id);
        consent.setGivenBy(owner.getId());
        consent.setNoticeVersion("2026-10");
        consent.setGuardianName("Synthetic cohort");
        consents.save(consent);
    }

    /** The loaded patients in a stable order, for reports. */
    public static Map<String, String> byTrajectory(Summary s) {
        Map<String, String> m = new LinkedHashMap<>();
        s.patients().forEach(p -> m.put(p.patientId(), p.trajectory()));
        return m;
    }
}
