package org.smaran.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.DomainReading;
import org.smaran.domain.GameSession;
import org.smaran.scoring.Contract.ScoreContribution;
import org.smaran.scoring.Contract.SessionMarkers;
import org.smaran.scoring.LegacyScores;
import org.springframework.stereotype.Component;

/**
 * Reading a stored session back into the contract's types.
 *
 * A session stored with an envelope carries its contributions. One stored
 * before the envelope existed carries only 0–1 domain readings (or just a
 * completion rate), and is read through the legacy bridge, so old rows keep
 * counting toward the profile they were always part of.
 */
@Component
@Slf4j
public class SessionRecords {

    private static final TypeReference<List<ScoreContribution>> CONTRIBUTIONS = new TypeReference<>() {
    };

    private final ObjectMapper json;

    public SessionRecords(ObjectMapper json) {
        this.json = json;
    }

    /** What the session said about each target, in the order it said it. */
    public List<ScoreContribution> contributionsOf(GameSession s, Map<String, DomainReading> legacyReadings) {
        if (s.getContributions() != null && !s.getContributions().isBlank()) {
            try {
                return json.readValue(s.getContributions(), CONTRIBUTIONS);
            } catch (Exception e) {
                log.warn("unreadable contributions on session {}, using its legacy readings: {}", s.getId(), e.getMessage());
            }
        }
        return LegacyScores.contributionsFrom(legacyReadings);
    }

    /** True if this session carries its own contributions (an envelope), not legacy readings. */
    public boolean hasEnvelope(GameSession s) {
        return s.getContributions() != null && !s.getContributions().isBlank();
    }

    public SessionMarkers markersOf(GameSession s) {
        if (s.getMarkers() == null || s.getMarkers().isBlank()) {
            return null;
        }
        try {
            return json.readValue(s.getMarkers(), SessionMarkers.class);
        } catch (Exception e) {
            return null;
        }
    }

    public String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("could not serialise " + value.getClass().getSimpleName(), e);
        }
    }

    public <T> T read(String text, TypeReference<T> type, T fallback) {
        if (text == null || text.isBlank()) {
            return fallback;
        }
        try {
            return json.readValue(text, type);
        } catch (Exception e) {
            return fallback;
        }
    }
}
