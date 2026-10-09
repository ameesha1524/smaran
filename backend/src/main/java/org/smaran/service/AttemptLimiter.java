package org.smaran.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A sliding-window counter per key (an address, usually).
 *
 * In memory and per node: a restart clears it and two servers do not share it.
 * That is enough to slow a guessing script and is stated as a limit in the
 * docs; Redis is the upgrade when there is more than one node.
 */
public class AttemptLimiter {

    private final int max;
    private final Duration window;
    private final Clock clock;
    private final ConcurrentHashMap<String, Deque<Instant>> attempts = new ConcurrentHashMap<>();

    public AttemptLimiter(int max, Duration window, Clock clock) {
        this.max = max;
        this.window = window;
        this.clock = clock;
    }

    /** Is this key still under the limit? Does not count anything. */
    public boolean allowed(String key) {
        return count(key) < max;
    }

    /** Counts one attempt. */
    public void record(String key) {
        Deque<Instant> q = attempts.computeIfAbsent(keyOf(key), k -> new ArrayDeque<>());
        synchronized (q) {
            prune(q);
            q.addLast(clock.instant());
        }
    }

    /** Counts one attempt if the key is under the limit; false (and nothing counted) if not. */
    public boolean tryRecord(String key) {
        Deque<Instant> q = attempts.computeIfAbsent(keyOf(key), k -> new ArrayDeque<>());
        synchronized (q) {
            prune(q);
            if (q.size() >= max) {
                return false;
            }
            q.addLast(clock.instant());
            return true;
        }
    }

    private int count(String key) {
        Deque<Instant> q = attempts.get(keyOf(key));
        if (q == null) {
            return 0;
        }
        synchronized (q) {
            prune(q);
            return q.size();
        }
    }

    private void prune(Deque<Instant> q) {
        Instant cutoff = clock.instant().minus(window);
        while (!q.isEmpty() && q.peekFirst().isBefore(cutoff)) {
            q.removeFirst();
        }
    }

    private static String keyOf(String key) {
        return key == null ? "unknown" : key;
    }
}
