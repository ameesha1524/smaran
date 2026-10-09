package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.smaran.config.CohortImport;
import org.smaran.domain.AppUser;
import org.smaran.domain.Enums.Role;
import org.smaran.repo.AlertRepository;
import org.smaran.repo.ProfileSnapshotRepository;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.ExportService;
import org.smaran.support.ApiTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The data-science layer's synthetic cohort, in through the real ingestion service and out through the export.
 *
 * The cohort is the committed fixture (data-science/src/simulate.py --fixture): five simulated patients, one on
 * each trajectory. {@link CohortImport} loads them and writes nothing a tablet's request would not, and then an
 * administrator downloads GET /api/admin/export/sessions.csv. The test checks that nothing was lost or invented on
 * the way through the database, that the export identifies no one, and that only an administrator can have it.
 * It also writes the CSV (and the key to the hashes, which only this test knows) under the build directory, where
 * data-science/src/run_on_export.py reads them to show the Python evaluation runs on exported data.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestPropertySource(properties = "smaran.export.salt=cohort-export-test-salt")
class CohortExportIT extends ApiTest {

    private static final String SALT = "cohort-export-test-salt";

    @Autowired
    CohortImport importer;

    @Autowired
    ProfileSnapshotRepository snapshots;

    @Autowired
    AlertRepository alerts;

    @Autowired
    CognitiveProfileService profiles;

    @Autowired
    ExportService export;

    @Autowired
    JdbcTemplate jdbc;

    CohortImport.Summary loaded;
    JsonNode fixture;
    String adminToken;

    @BeforeAll
    void load() throws Exception {
        ClassPathResource file = new ClassPathResource("cohort/envelopes.json");
        fixture = json.readTree(file.getInputStream());
        loaded = importer.load(file, 0);
        adminToken = tokenFor(newUser(Role.ADMIN));
    }

    private static int envelopes(JsonNode patient) {
        return patient.get("envelopes").size();
    }

    private static String hmac(String salt, String patientId) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(patientId.getBytes(StandardCharsets.UTF_8))).substring(0, 16);
    }

    @Test
    @DisplayName("every simulated session goes in through ingestion and none is refused")
    void everySessionIsAccepted() {
        assertEquals(5, loaded.patients().size());
        int expected = 0;
        for (JsonNode p : fixture.get("patients")) {
            expected += envelopes(p);
        }
        assertEquals(expected, loaded.sessionsAccepted());
        loaded.patients().forEach(p -> {
            assertEquals(0, p.rejected(), p.patientId());
            assertEquals(0, p.duplicates(), p.patientId());
        });
        assertTrue(expected > 400, "a fixture this small would prove little");
    }

    @Test
    @DisplayName("what the profile and the snapshots hold is what ingestion made of the history")
    void profilesAndSnapshotsComeFromIngestion() {
        for (CohortImport.Loaded l : loaded.patients()) {
            JsonNode patient = null;
            for (JsonNode p : fixture.get("patients")) {
                if (p.get("patientId").asText().equals(l.simulatedId())) {
                    patient = p;
                }
            }
            assertNotNull(patient);
            assertEquals(envelopes(patient), snapshots.countByPatientId(l.patientId()), "one snapshot per session");
            Map<String, Integer> perTarget = new TreeMap<>();
            for (JsonNode e : patient.get("envelopes")) {
                for (JsonNode c : e.get("contributions")) {
                    perTarget.merge(c.get("target").asText(), 1, Integer::sum);
                }
            }
            var state = profiles.scoringState(profiles.forPatient(l.patientId()));
            perTarget.forEach((target, n) ->
                    assertEquals(n, state.get(target).observations(), l.patientId() + " " + target));
        }
    }

    @Test
    @DisplayName("patients who really decline have alerts the engine raised, through the production code path")
    void decliningPatientsAreAlertedByTheEngine() {
        List<String> decliners = loaded.patients().stream()
                .filter(l -> l.trajectory().equals("fast_decline") || l.trajectory().equals("slow_decline"))
                .map(CohortImport.Loaded::patientId)
                .toList();
        assertEquals(2, decliners.size());
        for (String id : decliners) {
            long raised = alerts.findAll().stream()
                    .filter(a -> a.getPatientId().equals(id) && a.getKind().equals("DOMAIN_DECLINE"))
                    .count();
            assertTrue(raised >= 1, id + " really declines in the fixture, so the engine should have opened an alert for her");
        }
    }

    @Test
    @DisplayName("dates shift by whole weeks, so the newest session is recent and every weekday is where it was")
    void datesShiftByWholeWeeks() {
        assertEquals(0, loaded.shiftDays() % 7);
        Instant newest = jdbc.queryForObject(
                "select max(started_at) from game_session where patient_id like 'cohort-%'", java.sql.Timestamp.class).toInstant();
        long daysAgo = ChronoUnit.DAYS.between(newest, Instant.now());
        assertTrue(daysAgo >= 0 && daysAgo <= 9, "newest session is " + daysAgo + " days old");
    }

    @Test
    @DisplayName("the export has the agreed columns, one row per stored score, and nothing that says who she is")
    void exportRoundTrip() throws Exception {
        MvcResult r = mvc.perform(get("/api/admin/export/sessions.csv").header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andReturn();
        assertTrue(r.getResponse().getContentType().startsWith("text/csv"));
        assertTrue(r.getResponse().getHeader("Content-Disposition").startsWith("attachment"));
        assertTrue(r.getResponse().getHeader("Cache-Control").contains("no-store"));

        String csv = r.getResponse().getContentAsString(StandardCharsets.UTF_8);
        List<String> lines = List.of(csv.split("\n"));
        assertEquals(ExportService.HEADER, lines.get(0));
        assertFalse(csv.contains("cohort-"), "no patient id");
        assertFalse(csv.toLowerCase().contains("simulated session"), "no explanation text");
        assertFalse(csv.contains("@"), "no email");

        // The cohort's rows: map each hash back to the simulated patient, and compare with the fixture.
        Map<String, String> hashMap = new LinkedHashMap<>();
        for (CohortImport.Loaded l : loaded.patients()) {
            hashMap.put(hmac(SALT, l.patientId()), l.simulatedId());
            assertEquals(hmac(SALT, l.patientId()), export.pseudonym(l.patientId()));
        }
        List<String> mine = new ArrayList<>();
        mine.add(lines.get(0));
        for (String line : lines.subList(1, lines.size())) {
            String[] f = line.split(",", -1);
            assertEquals(11, f.length, line);
            assertTrue(f[0].matches("[0-9a-f]{16}"), line);
            if (hashMap.containsKey(f[0])) {
                mine.add(line);
            }
        }

        int contributions = 0;
        Map<String, List<Double>> want = new TreeMap<>();
        for (JsonNode p : fixture.get("patients")) {
            for (JsonNode e : p.get("envelopes")) {
                for (JsonNode c : e.get("contributions")) {
                    contributions++;
                    want.computeIfAbsent(p.get("patientId").asText() + "|" + c.get("target").asText(), k -> new ArrayList<>())
                            .add(c.get("raw").asDouble() * 1000 + c.get("confidence").asDouble());
                }
            }
        }
        assertEquals(contributions, mine.size() - 1, "one row per stored score");

        Map<String, List<Double>> got = new TreeMap<>();
        Map<String, Integer> firstDay = new TreeMap<>();
        for (String line : mine.subList(1, mine.size())) {
            String[] f = line.split(",", -1);
            String sim = hashMap.get(f[0]);
            got.computeIfAbsent(sim + "|" + f[8], k -> new ArrayList<>())
                    .add(Double.parseDouble(f[9]) * 1000 + Double.parseDouble(f[10]));
            int offset = Integer.parseInt(f[2]);
            assertTrue(offset >= 0 && offset < 400);
            firstDay.merge(sim, offset, Math::min);
            assertTrue(Integer.parseInt(f[3]) >= 0 && Integer.parseInt(f[3]) <= 6, "weekday 0 to 6");
        }
        want.values().forEach(Collections::sort);
        got.values().forEach(Collections::sort);
        assertEquals(want, got, "every score and confidence arrives exactly as it went in");
        firstDay.forEach((sim, d) -> assertEquals(0, d, sim + " starts at day 0"));

        // For data-science/src/run_on_export.py.
        Path dir = Path.of(System.getProperty("smaran.build.dir", "target"));
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("export-sessions.csv"), String.join("\n", mine) + "\n", StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("export-hash-map.json"), json.writeValueAsString(hashMap), StandardCharsets.UTF_8);
    }

    @Test
    @DisplayName("only an administrator can have it, and each export is recorded in the audit log with its size")
    void onlyAdminsAndAudited() throws Exception {
        mvc.perform(get("/api/admin/export/sessions.csv")).andExpect(status().isUnauthorized());
        AppUser caregiver = newUser(Role.CAREGIVER);
        mvc.perform(get("/api/admin/export/sessions.csv").header("Authorization", bearer(tokenFor(caregiver))))
                .andExpect(status().isForbidden());
        AppUser doctor = newUser(Role.DOCTOR);
        mvc.perform(get("/api/admin/export/sessions.csv").header("Authorization", bearer(tokenFor(doctor))))
                .andExpect(status().isForbidden());

        AppUser admin = newUser(Role.ADMIN);
        mvc.perform(get("/api/admin/export/sessions.csv").header("Authorization", bearer(tokenFor(admin))))
                .andExpect(status().isOk());
        Map<String, Object> row = jdbc.queryForMap(
                "select detail::text as detail from audit_event where action = 'EXPORT_SESSIONS' and actor_id = ?", admin.getId());
        JsonNode detail = json.readTree(row.get("detail").toString());
        int fixtureRows = 0;
        for (JsonNode p : fixture.get("patients")) {
            for (JsonNode e : p.get("envelopes")) {
                fixtureRows += e.get("contributions").size();
            }
        }
        assertTrue(detail.get("rows").asInt() >= fixtureRows && detail.get("patients").asInt() >= 5, detail.toString());
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from audit_event where action = 'EXPORT_SESSIONS' and actor_id in (?, ?)", Integer.class,
                caregiver.getId(), doctor.getId()), "a refused request is not an export");
    }

    @Test
    @DisplayName("the salt changes the hash: the same patient under another salt is a different key")
    void saltChangesTheHash() throws Exception {
        String a = export.pseudonym("cohort-0001");
        assertEquals(16, a.length());
        assertFalse(a.equals(hmac("another-salt", "cohort-0001")));
    }
}
