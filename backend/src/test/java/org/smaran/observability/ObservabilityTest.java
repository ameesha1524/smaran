package org.smaran.observability;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ObservabilityTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static LoggingEvent event(String message, Map<String, String> mdc, Throwable t) {
        LoggerContext ctx = (LoggerContext) LoggerFactory.getILoggerFactory();
        Logger logger = ctx.getLogger("org.smaran.test");
        LoggingEvent e = new LoggingEvent("x", logger, Level.INFO, message, t, null);
        e.setMDCPropertyMap(mdc);
        return e;
    }

    @Test
    @DisplayName("a log line is one JSON object, with the request id, however nasty the message")
    void oneJsonObjectPerLine() throws Exception {
        String nasty = "quote \" newline \n and {\"level\":\"FORGED\"} tab \t";
        String line = new JsonLogLayout().doLayout(event(nasty, Map.of("requestId", "abc12345"), null));
        assertTrue(line.endsWith("\n"));
        assertEquals(1, line.strip().split("\n").length, "a newline in the message must not make a second line");
        JsonNode node = JSON.readTree(line);
        assertEquals("INFO", node.get("level").asText());
        assertEquals("abc12345", node.get("requestId").asText());
        assertEquals(nasty, node.get("message").asText());
        assertEquals("org.smaran.test", node.get("logger").asText());
    }

    @Test
    @DisplayName("a stack trace is one bounded field")
    void exceptionIsOneField() throws Exception {
        String line = new JsonLogLayout().doLayout(event("boom", Map.of(), new IllegalStateException("bad " + "x".repeat(9000))));
        JsonNode node = JSON.readTree(line);
        assertTrue(node.get("exception").asText().startsWith("java.lang.IllegalStateException"));
        assertTrue(node.get("exception").asText().length() <= 4003);
    }

    private static MockHttpServletResponse run(String header) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/x");
        if (header != null) {
            request.addHeader(RequestIdFilter.HEADER, header);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        new RequestIdFilter().doFilter(request, response, new MockFilterChain());
        return response;
    }

    @Test
    @DisplayName("every response carries a request id; a plain one from the proxy is kept; anything else is replaced")
    void requestIds() throws Exception {
        String generated = run(null).getHeader(RequestIdFilter.HEADER);
        assertTrue(generated.matches("[0-9a-f-]{36}"));
        assertNotEquals(generated, run(null).getHeader(RequestIdFilter.HEADER));
        assertEquals("proxy-id-12345", run("proxy-id-12345").getHeader(RequestIdFilter.HEADER));
        String replaced = run("bad id\r\nX-Evil: 1").getHeader(RequestIdFilter.HEADER);
        assertFalse(replaced.contains("Evil"));
        assertTrue(replaced.matches("[0-9a-f-]{36}"));
        assertNotEquals("short", run("short").getHeader(RequestIdFilter.HEADER), "too short to be an id");
    }

    @Test
    @DisplayName("the id is gone from the log context once the request is over")
    void idDoesNotLeakToTheNextRequest() throws Exception {
        run("proxy-id-12345");
        assertEquals(null, org.slf4j.MDC.get(RequestIdFilter.MDC_KEY));
    }

    @Test
    @DisplayName("the request line in the log cannot be forged or made enormous by the path")
    void pathIsPrintable() throws Exception {
        assertEquals("/api/x__FORGED_ line", RequestIdFilter.printable("/api/x\r\nFORGED\u0007 line"));
        assertEquals(203, RequestIdFilter.printable("/" + "a".repeat(5000)).length());

        Logger logger = (Logger) LoggerFactory.getLogger(RequestIdFilter.class);
        ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/x\nINFO forged");
            new RequestIdFilter().doFilter(request, new MockHttpServletResponse(), new MockFilterChain());
            assertEquals(1, appender.list.size());
            String message = appender.list.get(0).getFormattedMessage();
            assertFalse(message.contains("\n"), message);
            assertTrue(message.contains("/api/x_INFO forged"), message);
        } finally {
            logger.detachAppender(appender);
        }
    }
}
