package org.smaran.scoring;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.smaran.domain.Enums.GameType;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * The games the server knows (docs/MASTER_PROMPT.md, Appendix A.3).
 *
 * Read from {@code game-registry.json}. The server accepts a session only for a
 * game listed here, and only with contributions to the targets listed for that
 * game, which is what stops a tablet from sending a language score for a game
 * that does not measure language. The device's copy is
 * frontend/src/games/registry.ts; a test on each side holds them together.
 *
 * Titles and domains travel to the dashboards from here, so a new game appears
 * on them without a dashboard change.
 */
@Component
public class GameRegistry {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Entry(
            String id,
            GameType gameType,
            String title,
            String route,
            List<String> primaryDomains,
            List<String> targets,
            boolean precomputed,
            boolean retired) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record File(List<Entry> games) {
    }

    private final Map<String, Entry> byId = new LinkedHashMap<>();
    private final Map<GameType, Entry> byType = new LinkedHashMap<>();

    public GameRegistry(ObjectMapper json) throws IOException {
        try (InputStream in = new ClassPathResource("game-registry.json").getInputStream()) {
            for (Entry e : json.readValue(in, File.class).games()) {
                if (byId.put(e.id(), e) != null) {
                    throw new IllegalStateException("duplicate game id " + e.id());
                }
                byType.put(e.gameType(), e);
            }
        }
    }

    public Optional<Entry> find(String id) {
        return Optional.ofNullable(id == null ? null : byId.get(id));
    }

    public Optional<Entry> of(GameType type) {
        return Optional.ofNullable(byType.get(type));
    }

    public List<Entry> all() {
        return List.copyOf(byId.values());
    }
}
