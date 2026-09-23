package org.smaran.service;

import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.CognitiveObjectResult;
import org.smaran.domain.GameSession;
import org.smaran.repo.CognitiveObjectResultRepository;
import org.smaran.repo.GameSessionRepository;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accepting a finished session.
 *
 * Idempotent by (patientId, startedAt). That single constraint is what lets a
 * tablet that has been offline for three days re-send its entire queue as often
 * as it likes without the garden inflating or a trend being double-counted.
 */
@Service
@Slf4j
public class SessionService {

    private final GameSessionRepository sessions;
    private final CognitiveObjectResultRepository objectResults;
    private final CognitiveProfileService profiles;
    private final GardenStateService gardens;
    private final CognitiveAdaptationService adaptation;

    public SessionService(
            GameSessionRepository sessions,
            CognitiveObjectResultRepository objectResults,
            CognitiveProfileService profiles,
            GardenStateService gardens,
            CognitiveAdaptationService adaptation) {
        this.sessions = sessions;
        this.objectResults = objectResults;
        this.profiles = profiles;
        this.gardens = gardens;
        this.adaptation = adaptation;
    }

    public record Accepted(GameSession session, boolean duplicate) {
    }

    /**
     * @param sessionKey the client-side session id, used only to look up whether
     *                   the adaptive layer eased this session mid-flight.
     */
    @Transactional
    public Accepted submit(Dto.SessionSubmission body, String sessionKey) {
        var existing = sessions.findByPatientIdAndStartedAt(body.patientId(), body.startedAt());
        if (existing.isPresent()) {
            // A retry, not a new session. The server's copy wins, exactly as
            // the offline-sync contract promises.
            return new Accepted(existing.get(), true);
        }

        GameSession session = new GameSession();
        session.setPatientId(body.patientId());
        session.setGameType(body.gameType());
        session.setStartedAt(body.startedAt());
        session.setDurationMs(body.durationMs());
        session.setCompletionRate(clamp(body.completionRate()));
        session.setDifficultyTier(body.difficultyTier());
        session.setCognitiveLoadScore(clamp(body.cognitiveLoadScore()));
        session.setMoodAtStart(body.moodAtStart());
        session.setEasedMidSession(sessionKey != null && adaptation.wasEased(sessionKey));
        sessions.save(session);

        if (body.objectResults() != null) {
            List<CognitiveObjectResult> rows = body.objectResults().stream()
                    .map(r -> {
                        CognitiveObjectResult row = new CognitiveObjectResult();
                        row.setSessionId(session.getId());
                        row.setPatientId(body.patientId());
                        row.setObjectName(r.objectName());
                        row.setSemanticCluster(r.semanticCluster());
                        row.setTappedMs(r.tappedMs());
                        row.setWasCorrect(r.wasCorrect());
                        row.setCapturedAt(body.startedAt());
                        return row;
                    })
                    .toList();
            objectResults.saveAll(rows);
        }

        profiles.updateFromSession(session);
        gardens.computeGrowth(body.patientId(), body.gameType(), session.getCompletionRate());
        return new Accepted(session, false);
    }

    private static double clamp(double v) {
        return Math.max(0, Math.min(1, v));
    }
}
