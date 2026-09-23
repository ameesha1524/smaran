package org.smaran.web;

import org.smaran.config.AccessGuard;
import org.smaran.service.AudioBiomarkerService;
import org.smaran.service.FederatedAggregationService;
import org.smaran.service.SyncService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three endpoints a device talks to after being offline: its queue, its
 * voice features, and its share of the federated model.
 */
@RestController
@RequestMapping("/api")
public class SyncController {

    private final SyncService sync;
    private final AudioBiomarkerService biomarkers;
    private final FederatedAggregationService federated;
    private final AccessGuard guard;

    public SyncController(
            SyncService sync,
            AudioBiomarkerService biomarkers,
            FederatedAggregationService federated,
            AccessGuard guard) {
        this.sync = sync;
        this.biomarkers = biomarkers;
        this.federated = federated;
        this.guard = guard;
    }

    @PostMapping("/sync/sessions")
    public Dto.SyncResponse merge(@RequestBody Dto.SyncRequest body) {
        guard.requireAccessTo(body.patientId());
        return sync.merge(body);
    }

    @PostMapping("/biomarker/vector")
    public void vector(@RequestBody Dto.AcousticVectorDto body) {
        guard.requireAccessTo(body.patientId());
        biomarkers.store(body);
    }

    /**
     * Encrypted weight gradients. The response carries the current global model
     * so a device that has been offline for a week catches up in one round trip.
     */
    @PostMapping("/fl/gradients")
    public Dto.GlobalModel gradients(@RequestBody Dto.GradientUpload body) {
        guard.requireAccessTo(body.patientId());
        return federated.receive(body);
    }
}
