package org.smaran.journal;

import java.util.Optional;

/**
 * Asks a language model one question and returns its answer as text.
 *
 * Behind an interface so the journal pipeline can be tested without a network and
 * without a key, and so the provider can change without touching the pipeline.
 * Returns empty when the model cannot be asked (no key configured, a timeout, an
 * error): the journal entry is then simply not analysed, which is a normal outcome
 * and never an error for the person writing it.
 */
public interface ModelClient {

    /** @param system what the model is told; held on the server and never taken from a client */
    Optional<String> complete(String system, String user);

    /** The model's name, recorded beside each stored reading so a change of model is visible in the data. */
    String modelName();
}
