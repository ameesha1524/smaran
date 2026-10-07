package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.smaran.domain.AppUser;
import org.smaran.domain.AppUser.Status;
import org.smaran.domain.Enums.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AppUserRepository extends JpaRepository<AppUser, String> {

    Optional<AppUser> findByEmail(String email);

    boolean existsByEmail(String email);

    boolean existsByRole(Role role);

    List<AppUser> findByStatusOrderByCreatedAtAsc(Status status);

    List<AppUser> findAllByOrderByCreatedAtAsc();

    /** Records a failed sign-in atomically, so concurrent guesses cannot undercount. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AppUser u set u.failedLogins = u.failedLogins + 1 where u.id = :id")
    int recordFailure(@Param("id") String id);

    /** Locks the account and restarts its failure count. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AppUser u set u.lockedUntil = :until, u.failedLogins = 0 where u.id = :id")
    int lock(@Param("id") String id, @Param("until") Instant until);

    /** A successful sign-in clears the count and any expired lock. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AppUser u set u.failedLogins = 0, u.lockedUntil = null, u.lastLoginAt = :now where u.id = :id")
    int recordSuccess(@Param("id") String id, @Param("now") Instant now);
}
