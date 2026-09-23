package org.smaran.repo;

import java.time.Instant;
import java.util.List;
import org.smaran.domain.GardenState;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GardenStateRepository extends JpaRepository<GardenState, String> {

    /** Used by the nightly sweep that looks for gardens to put to sleep. */
    List<GardenState> findByLastActivityBefore(Instant before);
}
