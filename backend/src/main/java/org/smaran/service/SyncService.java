package org.smaran.service;

import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.smaran.domain.GardenState;
import org.smaran.repo.GameSessionRepository;
import org.smaran.web.Dto;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Offline queue merge.
 *
 * The conflict rule, stated once and implemented once: if a session with the
 * same (patientId, startedAt) already exists on the server, **the server record
 * wins and the incoming one is discarded**. Anything else risks two versions of
 * the same afternoon in her history.
 *
 * Afterwards the garden is recomputed from the full deduplicated session list
 * rather than from the queued events — a derived garden cannot be inflated by a
 * replayed batch, which is the whole reason it is derived.
 */
@Service
@Slf4j
public class SyncService {

    private final SessionService sessionService;
    private final GameSessionRepository sessions;
    private final AudioBiomarkerService biomarkers;
    private final GardenStateService gardens;

    public SyncService(
            SessionService sessionService,
            GameSessionRepository sessions,
            AudioBiomarkerService biomarkers,
            GardenStateService gardens) {
        this.sessionService = sessionService;
        this.sessions = sessions;
        this.biomarkers = biomarkers;
        this.gardens = gardens;
    }

    @Transactional
    public Dto.SyncResponse merge(Dto.SyncRequest request) {
        int accepted = 0;
        int duplicates = 0;

        for (Dto.SessionSubmission s : safe(request.sessions())) {
            if (!request.patientId().equals(s.patientId())) {
                // A payload claiming another patient's id is dropped silently;
                // the caller has no business knowing whether it existed.
                continue;
            }
            SessionService.Accepted result = sessionService.submit(s, null);
            if (result.duplicate()) {
                duplicates++;
            } else {
                accepted++;
            }
        }

        for (Dto.AcousticVectorDto v : safe(request.vectors())) {
            if (request.patientId().equals(v.patientId())) {
                biomarkers.store(v);
            }
        }

        // Blooms queued offline are deliberately *not* applied as increments:
        // the sessions above already carry that growth, and the recompute below
        // is the truth. The queued bloom list exists only so the device can
        // show a flower immediately, offline, before any of this runs.
        GardenState garden = recompute(request.patientId());

        log.info("sync {}: {} accepted, {} duplicates, {} vectors",
                request.patientId(), accepted, duplicates, safe(request.vectors()).size());

        return new Dto.SyncResponse(
                accepted,
                duplicates,
                new Dto.GardenDto(
                        garden.getPatientId(),
                        garden.getBloomStage(),
                        garden.getGrowthPoints(),
                        garden.isRestingPhase(),
                        garden.getLastActivity(),
                        garden.getBloomCount()));
    }

    private GardenState recompute(String patientId) {
        List<GardenStateService.SessionFact> facts = sessions
                .findTop50ByPatientIdOrderByStartedAtDesc(patientId)
                .stream()
                .map(s -> new GardenStateService.SessionFact(s.getGameType(), s.getCompletionRate(), s.getStartedAt()))
                .toList();
        return gardens.recomputeFrom(patientId, facts);
    }

    private static <T> List<T> safe(List<T> list) {
        return list == null ? List.of() : list;
    }
}
