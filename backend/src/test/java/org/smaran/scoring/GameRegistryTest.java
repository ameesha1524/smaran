package org.smaran.scoring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.smaran.domain.Enums.GameType;

/** The registry file is read, is consistent with the enum, and only names targets the contract has. */
class GameRegistryTest {

    private final GameRegistry registry;

    GameRegistryTest() throws IOException {
        this.registry = new GameRegistry(new ObjectMapper());
    }

    @Test
    void everyGameTypeHasAnEntryAndEveryEntryAGameType() {
        Set<GameType> seen = new HashSet<>();
        registry.all().forEach(e -> seen.add(e.gameType()));
        assertEquals(Set.of(GameType.values()), seen);
    }

    @Test
    void targetsAreAllKnownAndIncludeThePrimaryDomains() {
        for (GameRegistry.Entry e : registry.all()) {
            assertFalse(e.targets().isEmpty(), e.id());
            for (String t : e.targets()) {
                assertTrue(Contract.TARGET_IDS.contains(t), e.id() + " names unknown target " + t);
            }
            for (String d : e.primaryDomains()) {
                assertTrue(e.targets().contains(d), e.id() + " does not list its primary domain " + d);
            }
        }
    }

    @Test
    void idsAreSlugsAndRoutesFollowThem() {
        for (GameRegistry.Entry e : registry.all()) {
            assertTrue(e.id().matches("[a-z0-9]+(-[a-z0-9]+)*"), e.id());
            assertTrue(e.route().equals("/game/" + e.id()) || e.route().equals("/" + e.id()), e.route());
        }
    }

    @Test
    void theRetiredGameCannotSendSessionsButIsStillKnown() {
        GameRegistry.Entry loom = registry.find("weavers-loom").orElseThrow();
        assertTrue(loom.retired());
        assertEquals(GameType.WEAVERS_LOOM, loom.gameType());
    }
}
