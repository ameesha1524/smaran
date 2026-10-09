package org.smaran.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Component;

/**
 * Runs {@link CohortImport} at start-up when {@code smaran.seed.cohort} names a file, for example
 *
 * <pre>
 *   mvn spring-boot:run -Dspring-boot.run.profiles=dev \
 *       -Dspring-boot.run.arguments="--smaran.seed.cohort=file:../data-science/out/cohort/envelopes.json"
 * </pre>
 *
 * (written by {@code python data-science/src/simulate.py}). Off unless asked for, and never with the
 * prod profile: it creates an account with a published password.
 */
@Component
@Profile("!prod")
@ConditionalOnExpression("'${smaran.seed.cohort:}' != ''")
@Slf4j
public class CohortLoader implements CommandLineRunner {

    private final CohortImport importer;
    private final ResourceLoader resources;
    private final String location;
    private final int perTrajectory;

    public CohortLoader(
            CohortImport importer,
            ResourceLoader resources,
            @Value("${smaran.seed.cohort}") String location,
            @Value("${smaran.seed.per-trajectory:2}") int perTrajectory) {
        this.importer = importer;
        this.resources = resources;
        this.location = location;
        this.perTrajectory = perTrajectory;
    }

    @Override
    public void run(String... args) throws Exception {
        log.info("loading the synthetic cohort from {} ({} patients per trajectory)", location, perTrajectory == 0 ? "all" : perTrajectory);
        CohortImport.Summary s = importer.load(resources.getResource(location), perTrajectory);
        log.info("synthetic cohort loaded: {} patients, {} sessions, dates shifted {} days. Sign in as {} / smaran",
                s.patients().size(), s.sessionsAccepted(), s.shiftDays(), CohortImport.OWNER_EMAIL);
    }
}
