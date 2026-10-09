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

    Optional<GameSession> findByClientSessionId(String clientSessionId);

    /** Every session, oldest first: the order the engine must see them in to rebuild a profile. */
    List<GameSession> findByPatientIdOrderByStartedAtAsc(String patientId);

    Optional<GameSession> findTopByPatientIdOrderByStartedAtDesc(String patientId);

    List<GameSession> findByPatientIdOrderByStartedAtDesc(String patientId, org.springframework.data.domain.Pageable page);

    long countByPatientIdAndStartedAtAfter(String patientId, Instant after);

    /** The first two sessions are the onboarding; routing needs to know where she is. */
    long countByPatientId(String patientId);
}
