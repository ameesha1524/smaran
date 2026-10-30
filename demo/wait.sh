#!/usr/bin/env bash
# Wait until the demo stack has finished loading its synthetic cohort, then say how to sign in.
#
#   demo/wait.sh [BASE_URL]          default http://localhost:8081
#
# The backend answers "healthy" as soon as it is listening, and loads the cohort straight after, so a
# health check is not enough: this signs in as the demo caregiver and waits until she can see every patient
# (the demo patient and the 12 of the cohort). Needs bash and curl only.
set -euo pipefail

BASE="${1:-http://localhost:8081}"
EXPECT="${EXPECT_PATIENTS:-13}"
DEADLINE=$(( $(date +%s) + ${WAIT_SECONDS:-600} ))
last=0

while :; do
  login=$(curl -fsS --max-time 10 -H 'Content-Type: application/json' \
    --data '{"email":"rupa@example.com","password":"smaran"}' "$BASE/api/auth/login" 2>/dev/null || true)
  token=$(printf '%s' "$login" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
  if [ -n "$token" ]; then
    list=$(curl -fsS --max-time 10 -H "Authorization: Bearer $token" "$BASE/api/patients" 2>/dev/null || true)
    last=$(printf '%s' "$list" | grep -o '"caregiverId"' | wc -l | tr -d ' ')
    [ "$last" -ge "$EXPECT" ] && break
  fi
  [ "$(date +%s)" -lt "$DEADLINE" ] || { echo "demo: gave up waiting; the caregiver can see $last of $EXPECT patients" >&2; exit 1; }
  printf 'demo: waiting for the cohort to load (%s of %s patients so far)\n' "$last" "$EXPECT"
  sleep 5
done

cat <<EOF

The demo is ready: $BASE

  caregiver  rupa@example.com        / smaran    (13 patients: the demo patient and the cohort)
  doctor     meera.das@example.com   / smaran    (sees only the patients who granted access)
  admin      admin@example.com       / smaran

Everything in it is synthetic. The patient tablet is /pair on a second browser profile; mint a code on
the caregiver's dashboard (a patient's page, the "Her tablet" panel, "Get a pairing code").
EOF
