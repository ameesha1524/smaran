package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The session table, one row per score, with nothing in it that says who she is.
 *
 * <p>This is what the data-science code in {@code data-science/} reads, so the evaluation of the
 * alert rules can be run on what the system really stored. What it leaves out is the point:
 *
 * <ul>
 *   <li><b>No identity.</b> The patient is a keyed hash (HMAC-SHA256 of her id under a secret salt, first 16 hex
 *       characters). Without the salt it cannot be reversed or matched to an account; with the salt the
 *       operator can re-derive it, which is what a re-contact for a study would need.</li>
 *   <li><b>No dates.</b> A session is placed by days since her first session and by weekday and hour,
 *       not by calendar date, which is the easiest thing to link to a diary.</li>
 *   <li><b>No free text.</b> The plain-language reasons shown on the dashboard, journal text and
 *       trials never leave the database.</li>
 *   <li><b>No names or devices, no mood.</b></li>
 * </ul>
 *
 * De-identified is not anonymous: someone with a few weeks of one person's sittings could recognise her
 * pattern. The export is for the operator's own evaluation and an approved study, never for release.
 * The consent notice in this build does not yet mention research use; see docs/PROGRESS.md.
 *
 * <p>Only sessions that carry their own scores (an envelope) are exported. The columns are exactly the ones
 * {@code data-science/src/simulate.py} writes for the simulated cohort, so one reader serves both.
 */
@Service
@Slf4j
public class ExportService {

    public static final String HEADER =
            "patient_hash,session_seq,day_offset,weekday,hour_of_day,game_id,completed,abandoned,target,raw,confidence";

    private static final TypeReference<List<Map<String, Object>>> CONTRIBUTIONS = new TypeReference<>() {
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final byte[] salt;

    public ExportService(
            JdbcTemplate jdbc,
            ObjectMapper json,
            @Value("${smaran.export.salt:${smaran.security.jwt-secret}}") String salt) {
        this.jdbc = jdbc;
        this.json = json;
        this.salt = salt.getBytes(StandardCharsets.UTF_8);
    }

    /** HMAC-SHA256 of the patient id under the salt, first 16 hex characters. */
    public String pseudonym(String patientId) {
        return pseudonym(salt, patientId);
    }

    static String pseudonym(byte[] salt, String patientId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(salt, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(patientId.getBytes(StandardCharsets.UTF_8))).substring(0, 16);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    public record Result(int patients, int sessions, int rows) {
    }

    /** Writes the header and every row, grouped by patient hash and ordered by session. */
    public Result write(Writer out) throws IOException {
        List<String> ids = jdbc.queryForList(
                "select distinct patient_id from game_session where contributions is not null", String.class);
        List<Map.Entry<String, String>> byHash = new ArrayList<>();
        for (String id : ids) {
            byHash.add(Map.entry(pseudonym(id), id));
        }
        byHash.sort(Map.Entry.comparingByKey());

        out.write(HEADER);
        out.write('\n');
        int sessions = 0;
        int rows = 0;
        for (Map.Entry<String, String> p : byHash) {
            List<Map<String, Object>> sittings = jdbc.queryForList(
                    "select started_at, game_id, hour_of_day, completed, abandoned, contributions::text as contributions "
                            + "from game_session where patient_id = ? and contributions is not null order by started_at, id",
                    p.getValue());
            LocalDate first = null;
            int seq = 0;
            for (Map<String, Object> s : sittings) {
                LocalDate day = ((Timestamp) s.get("started_at")).toInstant().atOffset(ZoneOffset.UTC).toLocalDate();
                if (first == null) {
                    first = day;
                }
                List<Map<String, Object>> contributions = readContributions((String) s.get("contributions"));
                contributions.sort(Comparator.comparing(c -> String.valueOf(c.get("target"))));
                for (Map<String, Object> c : contributions) {
                    out.write(String.join(",",
                            p.getKey(),
                            Integer.toString(seq),
                            Long.toString(ChronoUnit.DAYS.between(first, day)),
                            Integer.toString(day.getDayOfWeek().getValue() - 1),
                            s.get("hour_of_day") == null ? "" : s.get("hour_of_day").toString(),
                            safe(s.get("game_id")),
                            Boolean.toString(Boolean.TRUE.equals(s.get("completed"))),
                            Boolean.toString(Boolean.TRUE.equals(s.get("abandoned"))),
                            safe(c.get("target")),
                            number(c.get("raw")),
                            number(c.get("confidence"))));
                    out.write('\n');
                    rows++;
                }
                seq++;
                sessions++;
            }
        }
        out.flush();
        return new Result(byHash.size(), sessions, rows);
    }

    private List<Map<String, Object>> readContributions(String text) {
        try {
            return new ArrayList<>(json.readValue(text, CONTRIBUTIONS));
        } catch (Exception e) {
            log.warn("export: unreadable contributions skipped: {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    /** A value that goes into a CSV cell: identifiers from our own registry, never free text. */
    private static String safe(Object value) {
        String s = value == null ? "" : value.toString();
        return s.replaceAll("[^A-Za-z0-9_.-]", "");
    }

    private static String number(Object value) {
        if (value instanceof Number n) {
            return Double.toString(n.doubleValue());
        }
        return "";
    }
}
