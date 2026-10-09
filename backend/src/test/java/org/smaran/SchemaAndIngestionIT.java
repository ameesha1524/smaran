package org.smaran;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.CognitiveProfile;
import org.smaran.domain.Patient;
import org.smaran.repo.GameSessionRepository;
import org.smaran.repo.PatientRepository;
import org.smaran.scoring.Contract.TargetState;
import org.smaran.service.CognitiveProfileService;
import org.smaran.service.SessionIngestionService;
import org.smaran.support.Envelopes;
import org.smaran.support.PostgresIntegrationTest;
import org.smaran.support.TestPostgres;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The application on a real PostgreSQL: the migrations apply to an empty
 * database, the entities match them, and a session travels the real path from
 * submission to the stored profile.
 */
class SchemaAndIngestionIT extends PostgresIntegrationTest {

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PatientRepository patients;

    @Autowired
    GameSessionRepository sessions;

    @Autowired
    SessionIngestionService ingestion;

    @Autowired
    CognitiveProfileService profiles;

    private Patient newPatient() {
        Patient p = new Patient();
        p.setName("Synthetic Patient " + UUID.randomUUID().toString().substring(0, 8));
        p.setKinshipTerm("Aaita");
        return patients.save(p);
    }

    @Test
    @DisplayName("this is PostgreSQL 16, not a stand-in")
    void realPostgres() {
        String version = jdbc.queryForObject("select version()", String.class);
        assertTrue(version.startsWith("PostgreSQL 16"), version + " via " + TestPostgres.get().kind());
    }

    @Test
    @DisplayName("every migration applied, in order, with none failed")
    void migrationsApplied() {
        List<String> versions = jdbc.queryForList(
                "select version from flyway_schema_history where success order by installed_rank", String.class);
        assertEquals(List.of("1", "2", "3", "4", "5"), versions);
        Integer failed = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where not success", Integer.class);
        assertEquals(0, failed);
    }

    @Test
    @DisplayName("the tables later phases need exist")
    void plannedTablesExist() {
        List<String> tables = jdbc.queryForList(
                "select table_name from information_schema.tables where table_schema = 'public'", String.class);
        for (String expected : List.of(
                "app_user", "refresh_token", "consent_record", "doctor_grant", "audit_event", "device",
                "pairing_code", "pairing_attempt", "profile_snapshot", "alert", "journal_signal", "voice_note",
                "patient", "game_session", "cognitive_profile", "garden_state", "family_member")) {
            assertTrue(tables.contains(expected), "missing table " + expected);
        }
    }

    @Test
    @DisplayName("the old caregiver tables are gone and accounts live in app_user")
    void caregiverTablesReplaced() {
        List<String> tables = jdbc.queryForList(
                "select table_name from information_schema.tables where table_schema = 'public'", String.class);
        assertFalse(tables.contains("caregiver"));
        assertFalse(tables.contains("caregiver_patient"));
        assertTrue(tables.contains("app_user"));
    }

    @Test
    @DisplayName("a patient cannot name an owner who is not an account")
    void ownerIsAForeignKey() {
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "insert into patient (id, name, language_code, kinship_term, peak_window, profile_version, caregiver_id) "
                        + "values (?, 'x', 'en', '', 'MORNING', '1.0', 'no-such-user')", UUID.randomUUID().toString()));
    }

    @Test
    @DisplayName("a session moves the stored profile through the engine, exactly once")
    void sessionReachesProfile() {
        Patient p = newPatient();
        Instant at = Instant.now().minusSeconds(3600).truncatedTo(ChronoUnit.MILLIS);

        var first = Envelopes.koi(p.getId(), at, 100);
        assertEquals(SessionIngestionService.Status.ACCEPTED, ingestion.ingest(p.getId(), null, first).status());

        CognitiveProfile profile = profiles.forPatient(p.getId());
        Map<String, TargetState> state = profiles.scoringState(profile);
        assertEquals(62.5, state.get("MOTOR").level(), 1e-12);
        assertEquals(1, state.get("MOTOR").observations());
        assertEquals(0, state.get("LANGUAGE").observations());
        assertEquals(0.625, profiles.scores(profile).get("motor"));

        // The same sitting again, as a replayed offline queue would send it.
        assertEquals(SessionIngestionService.Status.DUPLICATE, ingestion.ingest(p.getId(), null, first).status());
        assertEquals(1, profiles.scoringState(profiles.forPatient(p.getId())).get("MOTOR").observations());
        assertEquals(1, sessions.countByPatientId(p.getId()));
    }

    @Test
    @DisplayName("the engine state survives the database: a second session sees the first")
    void stateRoundTripsThroughPostgres() {
        Patient p = newPatient();
        Instant at = Instant.now().minusSeconds(7200).truncatedTo(ChronoUnit.MILLIS);
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), at, 80));
        ingestion.ingest(p.getId(), null, Envelopes.koi(p.getId(), at.plusSeconds(3600), 60));

        TargetState motor = profiles.scoringState(profiles.forPatient(p.getId())).get("MOTOR");
        assertEquals(2, motor.observations());
        assertEquals(List.of(80.0, 60.0), motor.raws());
    }

    @Test
    @DisplayName("the database itself refuses a second row for the same sitting")
    void dedupeIsAConstraint() {
        Patient p = newPatient();
        String insert = "insert into game_session (id, patient_id, game_type, started_at, duration_ms, "
                + "completion_rate, difficulty_tier, cognitive_load_score, eased_mid_session) "
                + "values (?, ?, 'KOI_ARE_JUMPING', '2026-10-06T04:30:00Z', 1, 1, 1, 0, false)";
        jdbc.update(insert, UUID.randomUUID().toString(), p.getId());
        assertThrows(DataAccessException.class, () -> jdbc.update(insert, UUID.randomUUID().toString(), p.getId()));
    }

    @Test
    @DisplayName("a session for a patient who does not exist cannot be stored")
    void foreignKeyHolds() {
        assertThrows(DataAccessException.class, () -> jdbc.update(
                "insert into game_session (id, patient_id, game_type, started_at, duration_ms, completion_rate, "
                        + "difficulty_tier, cognitive_load_score, eased_mid_session) "
                        + "values (?, 'nobody', 'KOI_ARE_JUMPING', now(), 1, 1, 1, 0, false)",
                UUID.randomUUID().toString()));
    }

    @Test
    @DisplayName("the audit log is append-only at the database")
    void auditIsAppendOnly() {
        jdbc.update("insert into audit_event (actor_type, action) values ('SYSTEM', 'TEST')");
        assertThrows(DataAccessException.class, () -> jdbc.update("update audit_event set action = 'EDITED'"));
        assertThrows(DataAccessException.class, () -> jdbc.update("delete from audit_event"));
    }

    @Test
    @DisplayName("only one open alert per patient, kind and target")
    void oneOpenAlertPerEpisode() {
        Patient p = newPatient();
        String insert = "insert into alert (id, patient_id, kind, target, severity, message) "
                + "values (?, ?, 'DOMAIN_DECLINE', 'MOTOR', 'watch', 'synthetic')";
        jdbc.update(insert, UUID.randomUUID().toString(), p.getId());
        assertThrows(DataAccessException.class, () -> jdbc.update(insert, UUID.randomUUID().toString(), p.getId()));
        // Once resolved, a new episode may open.
        jdbc.update("update alert set resolved_at = now() where patient_id = ?", p.getId());
        jdbc.update(insert, UUID.randomUUID().toString(), p.getId());
    }
}
