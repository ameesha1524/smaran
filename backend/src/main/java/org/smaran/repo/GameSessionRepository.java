package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.GameSession;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GameSessionRepository extends JpaRepository<GameSession, String> {

    /** The idempotency check that makes offline sync safe to retry. */
    Optional<GameSession> findByPatientIdAndStartedAt(String patientId, Instant startedAt);

    List<GameSession> findByPatientIdAndStartedAtAfterOrderByStartedAtAsc(String patientId, Instant after);

    List<GameSession> findTop50ByPatientIdOrderByStartedAtDesc(String patientId);

    long countByPatientIdAndStartedAtAfter(String patientId, Instant after);
}
