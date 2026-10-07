package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AttemptLimiterTest {

    /** A clock the test moves by hand. */
    static final class Manual extends Clock {
        Instant now = Instant.parse("2026-10-07T00:00:00Z");

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    @DisplayName("allows up to the limit, then refuses, then forgives after the window")
    void windowSlides() {
        Manual clock = new Manual();
        AttemptLimiter limiter = new AttemptLimiter(3, Duration.ofMinutes(15), clock);
        for (int i = 0; i < 3; i++) {
            assertTrue(limiter.allowed("a"));
            limiter.record("a");
        }
        assertFalse(limiter.allowed("a"));
        assertTrue(limiter.allowed("b"), "another key is unaffected");

        clock.advance(Duration.ofMinutes(16));
        assertTrue(limiter.allowed("a"));
    }

    @Test
    @DisplayName("tryRecord counts only what it lets through")
    void tryRecord() {
        Manual clock = new Manual();
        AttemptLimiter limiter = new AttemptLimiter(2, Duration.ofHours(1), clock);
        assertTrue(limiter.tryRecord("x"));
        assertTrue(limiter.tryRecord("x"));
        assertFalse(limiter.tryRecord("x"));
        assertFalse(limiter.tryRecord("x"));
        clock.advance(Duration.ofHours(2));
        assertTrue(limiter.tryRecord("x"));
    }

    @Test
    @DisplayName("a missing key is a key, not an error")
    void nullKey() {
        AttemptLimiter limiter = new AttemptLimiter(1, Duration.ofMinutes(1), new Manual());
        assertTrue(limiter.tryRecord(null));
        assertFalse(limiter.tryRecord(null));
    }
}
