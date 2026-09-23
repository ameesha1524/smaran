package org.smaran.web;

import java.time.Duration;
import org.smaran.config.AccessGuard;
import org.smaran.domain.Enums.Mood;
import org.smaran.service.CognitiveAdaptationService;
import org.smaran.service.CognitiveProfileService;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * The reactive pair: samples in, ease events out.
 *
 * `/sample` receives a scalar load score and three proxy numbers derived from
 * face-mesh geometry *on the device*. No video, no landmarks and no audio reach
 * this endpoint, which is what lets the privacy claim be architectural.
 *
 * `/stream` is the Flux the game subscribes to. Spring MVC streams it through
 * the reactive adapter; there is no separate reactive server here.
 */
@RestController
@RequestMapping("/api")
public class CognitiveController {

    private final CognitiveAdaptationService adaptation;
    private final CognitiveProfileService profiles;
    private final AccessGuard guard;

    public CognitiveController(
            CognitiveAdaptationService adaptation, CognitiveProfileService profiles, AccessGuard guard) {
        this.adaptation = adaptation;
        this.profiles = profiles;
        this.guard = guard;
    }

    @GetMapping(value = "/cognitive/stream/{sessionId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Dto.DifficultyEaseEvent>> stream(@PathVariable String sessionId) {
        // The session id is `{patientId}:{gameType}:{timestamp}` — the patient
        // portion is what the guard checks.
        guard.requireAccessTo(patientOf(sessionId));
        return adaptation
                .stream(sessionId)
                .map(event -> ServerSentEvent.<Dto.DifficultyEaseEvent>builder()
                        .event(event.loadScore() < 0 ? "heartbeat" : "ease")
                        .data(event)
                        .retry(Duration.ofSeconds(5))
                        .build());
    }

    @PostMapping("/cognitive/sample")
    public void sample(@RequestBody Dto.LoadSample body) {
        String patientId = patientOf(body.sessionId());
        guard.requireAccessTo(patientId);
        adaptation.sample(patientId, body);
    }

    /** Today's route. The device calls this on open and caches the answer. */
    @GetMapping("/game/{patientId}/route")
    public Dto.GameRouteDto route(
            @PathVariable String patientId, @RequestParam(required = false) Mood mood) {
        guard.requireAccessTo(patientId);
        return profiles.deriveGameRoute(patientId, mood);
    }

    private static String patientOf(String sessionId) {
        if (sessionId == null) {
            return "";
        }
        int colon = sessionId.indexOf(':');
        return colon > 0 ? sessionId.substring(0, colon) : sessionId;
    }
}
