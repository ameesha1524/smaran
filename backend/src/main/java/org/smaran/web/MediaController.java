package org.smaran.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.smaran.config.AccessGuard;
import org.smaran.service.StorageService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerMapping;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;

/**
 * Serves family photographs and voice notes.
 *
 * The key's first segment is the patient id, which is exactly what the access
 * guard checks — a caregiver cannot walk another family's faces by guessing a
 * UUID. A long cache lifetime is deliberate: the Service Worker keeps these
 * forever so the grove works with no signal.
 */
@RestController
@RequestMapping("/api/media")
public class MediaController {

    private final StorageService storage;
    private final AccessGuard guard;

    public MediaController(StorageService storage, AccessGuard guard) {
        this.storage = storage;
        this.guard = guard;
    }

    @GetMapping("/**")
    public ResponseEntity<Resource> fetch(HttpServletRequest request) throws IOException {
        String full = (String) request.getAttribute(HandlerMapping.PATH_WITHIN_HANDLER_MAPPING_ATTRIBUTE);
        String key = full == null ? "" : full.replaceFirst("^/api/media/", "");
        if (key.isBlank() || key.contains("..")) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        guard.requireAccessTo(key.substring(0, Math.max(0, key.indexOf('/'))));

        Path path = storage.resolve(key);
        if (path == null || !Files.isReadable(path)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }

        String contentType = Files.probeContentType(path);
        return ResponseEntity.ok()
                .contentType(contentType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(contentType))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePrivate())
                .body(new FileSystemResource(path));
    }
}
