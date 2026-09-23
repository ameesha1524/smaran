# Build and run the Smaran backend.
#
# Two stages so the runtime image carries a JRE and a jar, not a JDK and a
# Maven cache — this is meant to run on a modest VM (AWS EC2 or NIC cloud),
# not a build server.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Dependencies first: a code change must not re-download the internet.
COPY pom.xml .
RUN mvn -B -q dependency:go-offline

COPY src ./src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Never run as root; the storage volume is owned by this user.
RUN addgroup -S smaran && adduser -S smaran -G smaran
COPY --from=build /build/target/smaran-backend-*.jar app.jar
RUN mkdir -p /app/storage && chown -R smaran:smaran /app
USER smaran

EXPOSE 8080
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
