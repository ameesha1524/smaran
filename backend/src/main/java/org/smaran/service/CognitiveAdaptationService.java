package org.smaran.service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * Real-time difficulty adaptation — the reactive half.
 *
 * The device streams a composite load score every few seconds
 * (POST /api/cognitive/sample). This service decides whether the session should
 * get easier, and pushes a DifficultyEaseEvent back down the SSE stream
 * (GET /api/cognitive/stream/{sessionId}).
 *
 * Why the server is involved at all, when the device already eases itself: the
 * server knows this patient's *own* threshold as derived from months of
 * behaviour, and it knows it before the device has finished this session's
 * baseline. The two layers are belt and braces, and both fail safe — toward
 * easier.
 *
 * What is never sent to this endpoint: video, landmarks, or audio. Only a
 * scalar 0–1 and the three proxy numbers behind it.
 */
@Service
@Slf4j
public class CognitiveAdaptationService {

    /** One sink per live session. Removed when the stream is cancelled. */
    private final Map<String, Sinks.Many<Dto.DifficultyEaseEvent>> sinks = new ConcurrentHashMap<>();

    /** Rolling state so a single noisy sample cannot ease a whole session. */
    private final Map<String, SessionLoad> state = new ConcurrentHashMap<>();

    private final CognitiveProfileService profiles;

    public CognitiveAdaptationService(CognitiveProfileService profiles) {
        this.profiles = profiles;
    }

    /**
     * The SSE stream a game subscribes to. A heartbeat keeps proxies from
     * closing an idle connection mid-session.
     */
    public Flux<Dto.DifficultyEaseEvent> stream(String sessionId) {
        Sinks.Many<Dto.DifficultyEaseEvent> sink =
                sinks.computeIfAbsent(sessionId, id -> Sinks.many().multicast().onBackpressureBuffer());
        return sink.asFlux()
                .mergeWith(Flux.interval(Duration.ofSeconds(25)).map(i -> heartbeat(sessionId)))
                .doFinally(signal -> {
                    sinks.remove(sessionId);
                    state.remove(sessionId);
                });
    }

    private Dto.DifficultyEaseEvent heartbeat(String sessionId) {
        return new Dto.DifficultyEaseEvent(sessionId, -1, 0, "heartbeat");
    }

    /**
     * Take one sample. Two consecutive samples above her own threshold ease the
     * session — one is noise, two is a pattern — and the ambient tone drops to
     * 432 Hz at the same moment so the room changes key underneath her.
     */
    public void sample(String patientId, Dto.LoadSample sample) {
        if (sample.sessionId() == null) {
            return;
        }
        double threshold = profiles.forPatient(patientId).getAnxietyThreshold();
        SessionLoad load = state.computeIfAbsent(sample.sessionId(), id -> new SessionLoad());

        if (sample.score() > threshold) {
            load.consecutiveHigh++;
        } else {
            load.consecutiveHigh = 0;
        }

        if (load.consecutiveHigh < 2 || load.eased >= 2) {
            return;
        }

        load.consecutiveHigh = 0;
        load.eased++;
        Dto.DifficultyEaseEvent event = new Dto.DifficultyEaseEvent(
                sample.sessionId(),
                sample.score(),
                432,
                "load %.2f above threshold %.2f for two consecutive samples".formatted(sample.score(), threshold));

        Sinks.Many<Dto.DifficultyEaseEvent> sink = sinks.get(sample.sessionId());
        if (sink != null) {
            sink.tryEmitNext(event);
        }
        log.debug("eased session {} ({})", sample.sessionId(), event.reason());
    }

    /** Whether a session was ever eased — stored on the session row at submit. */
    public boolean wasEased(String sessionId) {
        SessionLoad load = state.get(sessionId);
        return load != null && load.eased > 0;
    }

    private static final class SessionLoad {
        private int consecutiveHigh;
        private int eased;
    }
}
