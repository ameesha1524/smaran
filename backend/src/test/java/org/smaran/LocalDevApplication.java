package org.smaran;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;

/**
 * Runs the backend for local development on a machine with no Docker.
 *
 *   mvn spring-boot:test-run
 *
 * Starts a real PostgreSQL 16 as a child process (binaries from the test
 * classpath), points the application at it, and starts the `dev` profile:
 * Flyway migrations, seeded demo data, API open. The data directory is
 * target/local-postgres, so it survives a restart and is cleared by
 * `mvn clean`. Set -Dsmaran.local.pg.dir=... to keep it elsewhere, for example
 * outside a OneDrive folder, whose sync can lock a live database's files.
 *
 * With Docker, prefer `docker compose up -d db` and the normal
 * `mvn spring-boot:run -Dspring-boot.run.profiles=dev`.
 *
 * Lives in src/test so none of this, and no embedded database, is ever in the
 * production jar.
 */
public class LocalDevApplication {

    public static void main(String[] args) throws Exception {
        EmbeddedPostgres postgres = EmbeddedPostgres.builder()
                .setDataDirectory(Path.of(System.getProperty("smaran.local.pg.dir", "target/local-postgres")))
                .setCleanDataDirectory(false)
                .setPort(Integer.getInteger("smaran.local.pg.port", 54329))
                .start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                postgres.close();
            } catch (Exception ignored) {
                // the JVM is going away regardless
            }
        }));

        System.setProperty("spring.datasource.url", postgres.getJdbcUrl("postgres", "postgres"));
        System.setProperty("spring.datasource.username", "postgres");
        System.setProperty("spring.datasource.password", "postgres");
        if (System.getProperty("spring.profiles.active") == null && System.getenv("SPRING_PROFILES_ACTIVE") == null) {
            System.setProperty("spring.profiles.active", "dev");
        }
        SpringApplication.run(SmaranApplication.class, args);
    }
}
