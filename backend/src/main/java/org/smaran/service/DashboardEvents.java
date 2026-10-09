package org.smaran.service;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import lombok.extern.slf4j.Slf4j;
import org.smaran.config.AccessGuard;
import org.smaran.config.AccessGuard.Capability;
import org.smaran.config.JwtAuthFilter.SmaranPrincipal;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Live updates for the dashboards, over server-sent events.
 *
 * An event says only that something changed, with the ids to ask about; the
 * dashboard then reads the new data through the ordinary, authorised
 * endpoints. So an event cannot leak anything a dashboard may not already read.
 *
 * Access is checked twice: once when the stream is opened, and again before
 * every event is sent, against the database. A grant that ends, or a patient
 * who is moved, takes effect on the next event, and the stream is closed.
 *
 * Streams live thirty minutes and the browser reconnects with a fresh token,
 * so a long-open stream never outlives a person's sign-in by much. Events are
 * sent only after the transaction that caused them has committed.
 */
@Service
@Slf4j
public class DashboardEvents {

    static final long LIFETIME_MS = 30 * 60 * 1000L;

    private record Subscriber(SseEmitter emitter, SmaranPrincipal principal) {
    }

    private final Map<String, List<Subscriber>> byPatient = new ConcurrentHashMap<>();
    private final AccessGuard guard;

    public DashboardEvents(AccessGuard guard) {
        this.guard = guard;
    }

    /** Open a stream for a caller the controller has already authorised for this patient. */
    public SseEmitter open(String patientId, SmaranPrincipal principal) {
        SseEmitter emitter = new SseEmitter(LIFETIME_MS);
        Subscriber sub = new Subscriber(emitter, principal);
        List<Subscriber> list = byPatient.computeIfAbsent(patientId, k -> new CopyOnWriteArrayList<>());
        list.add(sub);
        Runnable drop = () -> list.remove(sub);
        emitter.onCompletion(drop);
        emitter.onTimeout(drop);
        emitter.onError(e -> drop.run());
        try {
            emitter.send(SseEmitter.event().name("ready").data("{}"));
        } catch (IOException e) {
            drop.run();
        }
        return emitter;
    }

    /** Tell everyone watching this patient. Sent once the current transaction commits, if there is one. */
    public void publish(String patientId, String type, Map<String, ?> data) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send(patientId, type, data);
                }
            });
        } else {
            send(patientId, type, data);
        }
    }

    private void send(String patientId, String type, Map<String, ?> data) {
        List<Subscriber> list = byPatient.get(patientId);
        if (list == null) {
            return;
        }
        for (Subscriber sub : list) {
            if (!guard.allows(sub.principal(), patientId, Capability.CLINICAL_READ)) {
                // Their access has ended since they connected.
                sub.emitter().complete();
                list.remove(sub);
                continue;
            }
            try {
                sub.emitter().send(SseEmitter.event().name(type).data(data));
            } catch (IOException | IllegalStateException e) {
                list.remove(sub);
            }
        }
    }

    /** A comment line keeps proxies from closing an idle stream, and finds the ones that have died. */
    @Scheduled(fixedRate = 25_000)
    void heartbeat() {
        byPatient.forEach((patientId, list) -> {
            for (Subscriber sub : list) {
                try {
                    sub.emitter().send(SseEmitter.event().comment("keep-alive"));
                } catch (IOException | IllegalStateException e) {
                    list.remove(sub);
                }
            }
        });
    }

    /** For tests: how many streams are open for a patient. */
    int subscribers(String patientId) {
        return byPatient.getOrDefault(patientId, List.of()).size();
    }
}
