package org.smaran.observability;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Gives every request an id, puts it on every log line the request causes, and hands it back in the
 * {@code X-Request-Id} response header, so a person who reports a problem can quote one string and the
 * log can be searched for it.
 *
 * A caller's own id is kept if it is short and plain (a reverse proxy usually makes one); anything else
 * is replaced, so a request id can never be used to put text into the log. One line per request is
 * written afterwards: method, path, status and time. Never the query string and never the body, which
 * carry mood, voice features and family names.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";
    private static final Pattern ACCEPTABLE = Pattern.compile("[A-Za-z0-9._-]{8,64}");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String given = request.getHeader(HEADER);
        String id = given != null && ACCEPTABLE.matcher(given).matches() ? given : UUID.randomUUID().toString();
        MDC.put(MDC_KEY, id);
        response.setHeader(HEADER, id);
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            if (!request.getRequestURI().startsWith("/actuator/health")) {
                log.info("{} {} {} {}ms", request.getMethod(), printable(request.getRequestURI()), response.getStatus(),
                        (System.nanoTime() - start) / 1_000_000);
            }
            MDC.remove(MDC_KEY);
        }
    }

    /**
     * The path as the caller wrote it, which is theirs to choose: control characters (a line break in a
     * plain-text log would forge a line) are replaced and the length is bounded.
     */
    static String printable(String path) {
        String clean = path.replace("\n", "_").replace("\r", "_").replaceAll("\\p{Cntrl}", "_");
        return clean.length() > 200 ? clean.substring(0, 200) + "..." : clean;
    }
}
