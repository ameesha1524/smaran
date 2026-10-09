package org.smaran.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The append-only record of who did what.
 *
 * Written for every read or write of patient data by a caregiver, doctor or
 * admin, and for every grant, revoke, pairing and sign-in. The table has no
 * foreign keys, so a record survives the user or patient it names, and a
 * database trigger refuses any UPDATE or DELETE.
 *
 * Details are small structured facts (a target id, a reason), never free text
 * from a patient, and never a token, a password or a pairing code.
 */
@Service
@Slf4j
public class AuditService {

    public enum Actor {
        ADMIN, CAREGIVER, DOCTOR, DEVICE, ANONYMOUS, SYSTEM
    }

    public record Event(
            long id,
            Instant at,
            String actorType,
            String actorId,
            String action,
            String patientId,
            String resource,
            String ip,
            String detail) {
    }

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AuditService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /**
     * Appends one event. A failure to write is not swallowed: an action that
     * cannot be recorded should not silently go ahead.
     */
    public void record(
            Actor actor, String actorId, String action, String patientId, String resource, String ip,
            Map<String, ?> detail) {
        jdbc.update(
                "insert into audit_event (actor_type, actor_id, action, patient_id, resource, ip, detail) "
                        + "values (?, ?, ?, ?, ?, ?, ?::jsonb)",
                actor.name(), actorId, action, patientId, clip(resource, 200), clip(ip, 64), detailJson(detail));
    }

    /**
     * Has this person already been recorded doing this to this patient lately? A
     * dashboard is five requests; recording each would bury the list of who has
     * looked under copies of one visit.
     */
    public boolean recordedWithin(String actorId, String action, String patientId, java.time.Duration window) {
        Integer n = jdbc.queryForObject(
                "select count(*) from audit_event where actor_id = ? and action = ? and patient_id = ? "
                        + "and at > now() - make_interval(secs => ?)",
                Integer.class, actorId, action, patientId, window.toSeconds());
        return n != null && n > 0;
    }

    public List<Event> forPatient(String patientId, int limit) {
        return jdbc.query(
                "select id, at, actor_type, actor_id, action, patient_id, resource, ip, detail::text "
                        + "from audit_event where patient_id = ? order by at desc, id desc limit ?",
                (rs, n) -> map(rs), patientId, clampLimit(limit));
    }

    public List<Event> all(int limit) {
        return jdbc.query(
                "select id, at, actor_type, actor_id, action, patient_id, resource, ip, detail::text "
                        + "from audit_event order by at desc, id desc limit ?",
                (rs, n) -> map(rs), clampLimit(limit));
    }

    private static Event map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Event(
                rs.getLong("id"),
                rs.getTimestamp("at").toInstant(),
                rs.getString("actor_type"),
                rs.getString("actor_id"),
                rs.getString("action"),
                rs.getString("patient_id"),
                rs.getString("resource"),
                rs.getString("ip"),
                rs.getString("detail"));
    }

    private String detailJson(Map<String, ?> detail) {
        if (detail == null || detail.isEmpty()) {
            return null;
        }
        try {
            return json.writeValueAsString(detail);
        } catch (Exception e) {
            log.warn("audit detail not serialisable, recording without it");
            return null;
        }
    }

    private static int clampLimit(int limit) {
        return Math.max(1, Math.min(500, limit));
    }

    private static String clip(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
