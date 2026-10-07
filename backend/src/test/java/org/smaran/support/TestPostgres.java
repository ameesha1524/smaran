package org.smaran.support;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * One real PostgreSQL 16 for the whole test run.
 *
 * With Docker available it is a Testcontainers container, which is what CI
 * uses. Without Docker it is the same PostgreSQL started as a plain process
 * from binaries on the test classpath, so the suite still runs against the
 * real database on a machine that has no Docker. Set
 * {@code SMARAN_TEST_DB=embedded} or {@code =docker} to force one.
 *
 * Started once, lazily, and left for the JVM to stop: Spring caches test
 * contexts, and a database that outlived one test class would otherwise be
 * torn down under the next.
 */
public final class TestPostgres {

    public record Connection(String url, String username, String password, String kind) {
    }

    private static Connection connection;

    private TestPostgres() {
    }

    public static synchronized Connection get() {
        if (connection == null) {
            connection = start();
        }
        return connection;
    }

    private static Connection start() {
        String forced = System.getenv("SMARAN_TEST_DB");
        boolean docker = "docker".equalsIgnoreCase(forced)
                || (!"embedded".equalsIgnoreCase(forced) && dockerAvailable());
        return docker ? startContainer() : startEmbedded();
    }

    private static boolean dockerAvailable() {
        try {
            return DockerClientFactory.instance().isDockerAvailable();
        } catch (Throwable t) {
            return false;
        }
    }

    @SuppressWarnings("resource") // lives for the JVM; Testcontainers' reaper removes it
    private static Connection startContainer() {
        PostgreSQLContainer<?> container = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("smaran")
                .withUsername("smaran")
                .withPassword("smaran");
        container.start();
        return new Connection(
                container.getJdbcUrl(), container.getUsername(), container.getPassword(), "testcontainers");
    }

    private static Connection startEmbedded() {
        try {
            EmbeddedPostgres pg = EmbeddedPostgres.builder().start();
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    pg.close();
                } catch (Exception ignored) {
                    // the JVM is going away regardless
                }
            }));
            return new Connection(pg.getJdbcUrl("postgres", "postgres"), "postgres", "postgres", "embedded");
        } catch (Exception e) {
            throw new IllegalStateException("could not start embedded PostgreSQL", e);
        }
    }
}
