package org.smaran.web;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Lets a deliberate status error say why, and nothing else.
 *
 * Spring hides every error message by default, which is right for an unexpected
 * exception and wrong for "use at least 10 characters". The controllers and
 * services throw {@link ResponseStatusException} with a sentence written for a
 * person; only those are passed through, as {@code {"message": "..."}}.
 * Anything unexpected still gets the bare status, so a stack trace, an SQL
 * fragment or a class name never reaches a client.
 *
 * A status with no reason (the guard's 401, 403 and 404) stays an empty body.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> handle(ResponseStatusException e) {
        if (e.getReason() == null || e.getReason().isBlank()) {
            return ResponseEntity.status(e.getStatusCode()).build();
        }
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("message", e.getReason()));
    }
}
