package org.smaran.repo;

/**
 * Repository interfaces live one-per-file alongside this note.
 *
 * Nothing in this package holds business logic — the moment a query needs an
 * opinion about what a number means, that opinion belongs in a service, where
 * it can be read next to the rule it implements.
 */
public final class Repositories {
    private Repositories() {
    }
}
