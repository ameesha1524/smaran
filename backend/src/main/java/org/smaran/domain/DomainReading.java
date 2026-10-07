package org.smaran.domain;

/**
 * What one session says about one cognitive domain.
 *
 * {@code score} is 0–1, how that domain did this session. {@code confidence} is
 * 0–1, how much evidence the session produced for it; a thin reading moves the
 * profile less. A value type, not an entity — stored as JSON on the session and
 * mirrored by {@code DomainReading} in frontend/src/lib/types.ts.
 */
public record DomainReading(double score, double confidence) {
}
