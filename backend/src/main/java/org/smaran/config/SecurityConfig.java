package org.smaran.config;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Security.
 *
 * Stateless, JWT-bearing, CSRF disabled because there is no cookie to forge.
 * Role-based access is coarse here (who may call what) and fine in
 * {@link AccessGuard} (whose data they may touch), which is the split that
 * keeps the interesting rule readable.
 *
 * `smaran.security.open-demo` opens the API without auth. It exists so the PWA
 * and the pitch demo can run end-to-end with no accounts, it is set only in the
 * `dev` profile, and the application logs a warning on every start when it is on.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtFilter;

    @Value("${smaran.security.open-demo:false}")
    private boolean openDemo;

    @Value("${smaran.cors.allowed-origins:http://localhost:5173}")
    private List<String> allowedOrigins;

    public SecurityConfig(JwtAuthFilter jwtFilter) {
        this.jwtFilter = jwtFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // No sign-in is a 401, not Spring's default 403, so a client can
                // tell "sign in" from "you may not".
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .authorizeHttpRequests(auth -> {
                    // /me needs a sign-in; the rest of /api/auth is how you get one.
                    auth.requestMatchers("/api/auth/me").authenticated();
                    auth.requestMatchers("/api/auth/**", "/actuator/health").permitAll();
                    // Spring re-dispatches a thrown status to /error without the
                    // caller's token. Left closed, every 404 and 401 above came
                    // back as a bare 403 — including the deliberate "404, not
                    // 403" in AccessGuard, and a wrong pairing code.
                    auth.requestMatchers("/error").permitAll();
                    // A tablet redeeming a pairing code has no token yet — the
                    // code is the credential, and PairingService rate-limits it.
                    auth.requestMatchers(HttpMethod.POST, "/api/pairing/redeem").permitAll();
                    auth.requestMatchers(HttpMethod.OPTIONS, "/**").permitAll();
                    if (openDemo) {
                        auth.anyRequest().permitAll();
                    } else {
                        // Doctors read the dashboard and the report, and nothing
                        // else: not sessions, objects, family media or journal.
                        // The URL layer is the coarse net; AccessGuard decides the
                        // rest, per patient, on every request.
                        auth.requestMatchers("/api/report/**").hasAnyRole("DOCTOR", "CAREGIVER", "ADMIN");
                        auth.requestMatchers("/api/caregiver/**").hasAnyRole("CAREGIVER", "DOCTOR", "ADMIN");
                        auth.requestMatchers("/api/admin/**").hasRole("ADMIN");
                        auth.requestMatchers("/api/doctor/**").hasRole("DOCTOR");
                        // The tablet's own surface. Nothing else accepts a device token
                        // (AccessGuard refuses it), and nothing here accepts a person's.
                        auth.requestMatchers("/api/device/**").hasRole("DEVICE");
                        auth.anyRequest().authenticated();
                    }
                })
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(allowedOrigins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
