package org.smaran.observability;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.LayoutBase;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One JSON object per log line, with the request id from the MDC.
 *
 * Written against Jackson, which is already here, so a message with a quote, a newline or a control
 * character is escaped and cannot break the line or forge another one. A stack trace is one string field,
 * cut at 4,000 characters.
 */
public class JsonLogLayout extends LayoutBase<ILoggingEvent> {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_TRACE = 4000;

    @Override
    public String doLayout(ILoggingEvent event) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("ts", Instant.ofEpochMilli(event.getTimeStamp()).toString());
        line.put("level", event.getLevel().toString());
        line.put("logger", event.getLoggerName());
        line.put("thread", event.getThreadName());
        line.put("message", event.getFormattedMessage());
        Map<String, String> mdc = event.getMDCPropertyMap();
        if (mdc != null) {
            mdc.forEach((k, v) -> line.put(k, v));
        }
        IThrowableProxy t = event.getThrowableProxy();
        if (t != null) {
            String trace = ThrowableProxyUtil.asString(t);
            line.put("exception", trace.length() > MAX_TRACE ? trace.substring(0, MAX_TRACE) + "..." : trace);
        }
        try {
            return JSON.writeValueAsString(line) + "\n";
        } catch (JsonProcessingException e) {
            return "{\"level\":\"ERROR\",\"message\":\"log line could not be written\"}\n";
        }
    }
}
