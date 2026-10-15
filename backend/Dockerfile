# Build and run the Smaran backend.
#
# Two stages: the runtime image carries a JRE and one jar, not a JDK and a Maven
# cache. It runs as an unprivileged user, holds no secret (everything comes from
# the environment at start), and reports its own health.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies first: a code change must not re-download the internet.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q -DskipTests package \
 && mv target/smaran-backend-*.jar app.jar

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Never run as root; the storage volume is owned by this user.
RUN addgroup -S smaran && adduser -S smaran -G smaran
COPY --from=build /build/app.jar app.jar
RUN mkdir -p /app/storage && chown -R smaran:smaran /app
USER smaran

EXPOSE 8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"

HEALTHCHECK --interval=15s --timeout=3s --start-period=120s --retries=8 \
  CMD wget -qO- http://localhost:8080/actuator/health | grep -q '"status":"UP"' || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
