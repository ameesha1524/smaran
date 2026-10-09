package org.smaran.journal;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.smaran.scoring.Contract;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.service.SessionIngestionService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Her journal entry, read for how it feels, never kept.
 *
 * <ul>
 *   <li>The model is asked on the server, with a prompt held on the server.</li>
 *   <li>What comes back is validated and clamped ({@link JournalSignals#parse}).</li>
 *   <li>Only the <b>signals</b> are stored: valence, arousal, a few theme words, any
 *       concern flags, a one-sentence gist, and the entry's length. The entry's
 *       <b>text is never stored</b>, in the database, in a log or in an audit record.
 *       It exists on the tablet she wrote it on, and for the length of one request.</li>
 *   <li>The reading also reaches the AFFECTIVE domain, through the same door every game
 *       uses (a session of the "journal" pseudo-game), so it is idempotent, rebuilt in
 *       order with everything else, and shows on the dashboard like any other session.
 *       It is a weak signal and is weighted as one: confidence rises with the length of
 *       the entry and is capped at 0.5.</li>
 *   <li>With no key, no network or an unreadable answer, nothing is stored and the
 *       caller is told there are no signals. The entry still saves on her tablet.</li>
 * </ul>
 *
 * Honest limit: the one-sentence gist is written by a model from her words. It is told
 * not to quote her, but a model can echo, so it is stored short and shown to no one
 * outside the family dashboard's sentiment panel, which omits it.
 */
@Service
@Slf4j
public class JournalService {

    /** Longest entry accepted. A journal line, not a document: cost and abuse are both bounded by it. */
    public static final int MAX_TEXT = 4000;
    /** Per patient per hour. */
    static final int MAX_PER_HOUR = 30;

    private final ModelClient model;
    private final ObjectMapper json;
    private final JdbcTemplate jdbc;
    private final SessionIngestionService ingestion;
    private final Clock clock;

    public JournalService(
            ModelClient model, ObjectMapper json, JdbcTemplate jdbc, SessionIngestionService ingestion, Clock clock) {
        this.model = model;
        this.json = json;
        this.jdbc = jdbc;
        this.ingestion = ingestion;
        this.clock = clock;
    }

    /** @return the signals, or empty if there are none to give (no key, no answer, nothing usable) */
    public Optional<JournalSignals> analyse(String patientId, String deviceId, String text, Integer localHour) {
        if (text == null || text.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "There is nothing to read.");
        }
        if (text.length() > MAX_TEXT) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That entry is too long to read.");
        }
        Instant now = clock.instant();
        Integer recent = jdbc.queryForObject(
                "select count(*) from journal_signal where patient_id = ? and at > ?",
                Integer.class, patientId, java.sql.Timestamp.from(now.minus(Duration.ofHours(1))));
        if (recent != null && recent >= MAX_PER_HOUR) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "That is a lot of writing for one hour.");
        }

        Optional<JournalSignals> read = model.complete(JournalSignals.SYSTEM_PROMPT, text)
                .flatMap(out -> JournalSignals.parse(out, json));
        if (read.isEmpty()) {
            return Optional.empty();
        }
        JournalSignals s = read.get();

        jdbc.update(
                "insert into journal_signal (id, patient_id, at, valence, arousal, themes, concern_flags, summary, "
                        + "entry_length, model) values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?)",
                UUID.randomUUID().toString(), patientId, java.sql.Timestamp.from(now), s.valence(), s.arousal(),
                write(s.themes()), write(s.concernFlags()), s.summary(), text.length(), model.modelName());

        feedAffective(patientId, deviceId, s, text.length(), now, localHour);
        return read;
    }

    private void feedAffective(String patientId, String deviceId, JournalSignals s, int length, Instant now, Integer localHour) {
        double confidence = Math.min(0.5, Math.max(0.1, length / 800.0));
        String tone = s.valence() >= 0.3 ? "warm" : s.valence() <= -0.3 ? "low" : "neutral";
        ScoreContribution c = new ScoreContribution(
                "AFFECTIVE",
                (s.valence() + 1) / 2 * 100,
                confidence,
                "A journal entry read as %s%s. This is a light signal from her own words, weighed lightly."
                        .formatted(tone, s.concernFlags().isEmpty() ? "" : ", with a note of " + String.join(" and ", s.concernFlags()).toLowerCase()));
        int hour = localHour != null && localHour >= 0 && localHour <= 23
                ? localHour
                : now.atZone(ZoneId.systemDefault()).getHour();
        Contract.SessionEnvelope envelope = new Contract.SessionEnvelope(
                UUID.randomUUID().toString(), patientId, "journal", now.toString(), 0, true, false, hour, null,
                new Contract.Difficulty(1, Map.of()), List.of(), List.of(c), null, false, Contract.ENGINE_VERSION);
        SessionIngestionService.Outcome out = ingestion.ingest(patientId, deviceId, envelope);
        if (out.status() == SessionIngestionService.Status.REJECTED) {
            log.warn("a journal reading was not added to the profile: {}", out.reason());
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            return "[]";
        }
    }
}
