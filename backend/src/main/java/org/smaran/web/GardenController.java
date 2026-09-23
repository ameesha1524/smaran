package org.smaran.web;

import org.smaran.config.AccessGuard;
import org.smaran.domain.GardenState;
import org.smaran.service.DashboardService;
import org.smaran.service.GardenStateService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The garden.
 *
 * `POST /water` is separate from session submission on purpose: the family
 * WebSocket should fire even in the case where the session row was the thing
 * that failed to send, because the flower opening is what the granddaughter in
 * Bangalore is waiting for, not the telemetry.
 */
@RestController
@RequestMapping("/api/garden")
public class GardenController {

    private final GardenStateService gardens;
    private final DashboardService dashboard;
    private final AccessGuard guard;

    public GardenController(GardenStateService gardens, DashboardService dashboard, AccessGuard guard) {
        this.gardens = gardens;
        this.dashboard = dashboard;
        this.guard = guard;
    }

    @GetMapping("/{patientId}")
    public Dto.GardenDto state(@PathVariable String patientId) {
        guard.requireAccessTo(patientId);
        GardenState state = gardens.forPatient(patientId);
        return dashboard.toGardenDto(state);
    }

    @PostMapping("/{patientId}/water")
    public Dto.GardenDto water(@PathVariable String patientId, @RequestBody Dto.WaterRequest body) {
        guard.requireAccessTo(patientId);
        double completion = body.completionRate() == null ? 1.0 : body.completionRate();
        return dashboard.toGardenDto(gardens.computeGrowth(patientId, body.gameType(), completion));
    }
}
