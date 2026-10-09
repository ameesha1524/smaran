package org.smaran.journal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The Anthropic Messages API, called from the server.
 *
 * The key is configured in the environment ({@code ANTHROPIC_API_KEY}) and never
 * leaves the server. With no key this returns empty and the pipeline degrades to
 * "no signals". The text sent is the journal entry, in the language she wrote it;
 * it is sent for this one request and is not stored here or by Smaran.
 */
@Component
@Slf4j
public class AnthropicModelClient implements ModelClient {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json;
    private final String apiKey;
    private final String model;
    private final String baseUrl;
    private final Duration timeout;

    public AnthropicModelClient(
            ObjectMapper json,
            @Value("${smaran.journal.api-key:}") String apiKey,
            @Value("${smaran.journal.model:claude-haiku-4-5-20251001}") String model,
            @Value("${smaran.journal.base-url:https://api.anthropic.com}") String baseUrl,
            @Value("${smaran.journal.timeout-seconds:20}") long timeoutSeconds) {
        this.json = json;
        this.apiKey = apiKey;
        this.model = model;
        this.baseUrl = baseUrl;
        this.timeout = Duration.ofSeconds(timeoutSeconds);
    }

    @Override
    public String modelName() {
        return model;
    }

    @Override
    public Optional<String> complete(String system, String user) {
        if (apiKey == null || apiKey.isBlank()) {
            return Optional.empty();
        }
        try {
            String body = json.writeValueAsString(Map.of(
                    "model", model,
                    "max_tokens", 400,
                    "system", system,
                    "messages", List.of(Map.of("role", "user", "content", user))));
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
                    .timeout(timeout)
                    .header("content-type", "application/json")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                // Never log the body: an error response can echo the request.
                log.warn("journal model call refused: HTTP {}", res.statusCode());
                return Optional.empty();
            }
            JsonNode content = json.readTree(res.body()).path("content");
            StringBuilder text = new StringBuilder();
            for (JsonNode part : content) {
                if ("text".equals(part.path("type").asText())) {
                    text.append(part.path("text").asText());
                }
            }
            return text.length() == 0 ? Optional.empty() : Optional.of(text.toString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (Exception e) {
            log.warn("journal model call failed: {}", e.getClass().getSimpleName());
            return Optional.empty();
        }
    }
}
