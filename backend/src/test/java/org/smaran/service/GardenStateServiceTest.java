package org.smaran.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Enums.GameType;

/**
 * The garden's promises, as tests.
 *
 * These are the rules that make Smaran what it claims to be, so they are
 * asserted rather than trusted: growth never goes backwards, showing up always
 * counts for something, and the stage boundaries match the device's copy in
 * frontend/src/lib/gardenEngine.ts.
 */
class GardenStateServiceTest {

    @Test
    @DisplayName("showing up at all waters the garden")
    void floorIsOne() {
        assertTrue(GardenStateService.growthFor(GameType.WEAVERS_LOOM, 0.0) >= 1);
        assertTrue(GardenStateService.growthFor(GameType.MORNING_RITUALS, 0.1) >= 1);
    }

    @Test
    @DisplayName("the emotional core earns a little more than the others")
    void groveEarnsMore() {
        assertTrue(
                GardenStateService.growthFor(GameType.FAMILY_GROVE, 1.0)
                        > GardenStateService.growthFor(GameType.WEAVERS_LOOM, 1.0));
    }

    @Test
    @DisplayName("stage thresholds match the device's copy exactly")
    void stages() {
        assertEquals(1, GardenStateService.stageFor(0));
        assertEquals(1, GardenStateService.stageFor(5));
        assertEquals(2, GardenStateService.stageFor(6));
        assertEquals(2, GardenStateService.stageFor(15));
        assertEquals(3, GardenStateService.stageFor(16));
        assertEquals(3, GardenStateService.stageFor(31));
        assertEquals(4, GardenStateService.stageFor(32));
        assertEquals(4, GardenStateService.stageFor(4000));
    }

    @Test
    @DisplayName("growth is monotonic — no input reduces it")
    void monotonic() {
        int previous = 0;
        for (double completion = 0; completion <= 1.0; completion += 0.05) {
            int points = previous + GardenStateService.growthFor(GameType.GRANDMOTHERS_TALE, completion);
            assertTrue(points >= previous, "growth must never decrease");
            previous = points;
        }
    }
}
