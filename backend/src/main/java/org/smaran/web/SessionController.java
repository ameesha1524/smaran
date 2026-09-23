package org.smaran.web;

import org.smaran.config.AccessGuard;
import org.smaran.service.SessionService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Session submission.
 *
 * Always 200, even for a duplicate. A tablet re-sending a week-old queue on a
 * flaky connection must not receive an error it would then retry forever; the
 * response says whether the row was new, and the device does not care either way.
 */
@RestController
@RequestMapping("/api")
public class SessionController {

    private final SessionService sessions;
    private final AccessGuard guard;

    public SessionController(SessionService sessions, AccessGuard guard) {
        this.sessions = sessions;
        this.guard = guard;
    }

    public record SessionAck(String id, boolean duplicate) {
    }

    @PostMapping("/session")
    public SessionAck submit(
            @RequestBody Dto.SessionSubmission body,
            @RequestHeader(value = "X-Smaran-Session", required = false) String sessionKey) {
        guard.requireAccessTo(body.patientId());
        SessionService.Accepted accepted = sessions.submit(body, sessionKey);
        return new SessionAck(accepted.session().getId(), accepted.duplicate());
    }
}
