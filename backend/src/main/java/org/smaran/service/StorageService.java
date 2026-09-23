package org.smaran.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Photographs and voice notes.
 *
 * S3-compatible object storage is the target (AWS, or NIC cloud for a
 * government pilot; the brief leaves the provider open). This implementation
 * writes to a local directory behind the same key-based interface, so the whole
 * family-upload loop works on a laptop and swapping in an S3 client means
 * replacing two methods.
 *
 * What is stored here: faces and five-second voice notes the family chose to
 * record, encrypted at rest by the volume in a real deployment. What is never
 * stored here: the patient's own voice. Her audio is analysed on her device and
 * discarded — see AcousticVector.
 */
@Service
@Slf4j
public class StorageService {

    private final Path root;

    public StorageService(@Value("${smaran.storage.dir:./storage}") String dir) {
        this.root = Paths.get(dir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            log.warn("could not create storage directory {}: {}", root, e.getMessage());
        }
    }

    /** Returns the key to persist on the entity, or null when nothing was sent. */
    public String store(MultipartFile file, String patientId, String kind) {
        if (file == null || file.isEmpty()) {
            return null;
        }
        String extension = extensionOf(file.getOriginalFilename());
        String key = "%s/%s-%s%s".formatted(patientId, kind, UUID.randomUUID(), extension);
        try {
            Path target = root.resolve(key).normalize();
            if (!target.startsWith(root)) {
                throw new IOException("path traversal attempt");
            }
            Files.createDirectories(target.getParent());
            file.transferTo(target);
            return key;
        } catch (IOException e) {
            log.error("failed to store {} for {}: {}", kind, patientId, e.getMessage());
            return null;
        }
    }

    public Path resolve(String key) {
        Path target = root.resolve(key).normalize();
        return target.startsWith(root) ? target : null;
    }

    /** The URL the device uses. Swapped for a signed S3 URL in a deployment. */
    public String urlFor(String key) {
        return key == null ? null : "/api/media/" + key;
    }

    private static String extensionOf(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        return dot >= 0 && dot < filename.length() - 1 ? filename.substring(dot).toLowerCase() : "";
    }
}
