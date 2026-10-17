#!/usr/bin/env bash
# The smoke test: does the running system do its job, end to end, over the public address?
#
#   BASE_URL=https://smaran.example.org SMOKE_PASSWORD=... deploy/smoke.sh
#
# It signs in as a dedicated smoke account (registered on the first run), pairs a tablet to a
# dedicated smoke patient, has the tablet send one session, and reads the caregiver dashboard to see
# that the session arrived. The tablet is removed again afterwards. The smoke patient and account stay,
# named so nobody mistakes them for a person; they hold one synthetic session per run.
#
# Environment:
#   BASE_URL         required. No trailing slash.
#   SMOKE_PASSWORD   required. At least 10 characters. Keep it in the deploy secrets, not in git.
#   SMOKE_EMAIL      default smoke-ci@smaran.invalid
#   CURL_OPTS        extra curl options, for example -k against a local certificate
# Needs: bash, curl, jq. Exit status 0 means every step held; any other means the first that did not.
set -euo pipefail

BASE_URL="${BASE_URL:?set BASE_URL}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:?set SMOKE_PASSWORD}"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke-ci@smaran.invalid}"
CURL_OPTS="${CURL_OPTS:-}"

[ -n "${SMOKE_DEBUG:-}" ] && set -x
command -v jq >/dev/null || { echo "smoke: jq is needed" >&2; exit 2; }
step=0
say() { step=$((step + 1)); printf 'smoke %d: %s\n' "$step" "$*"; }
fail() { printf 'smoke FAILED at step %d: %s\n' "$step" "$*" >&2; exit 1; }

BODY=$(mktemp); HEAD_FILE="$BODY.head"; trap 'rm -f "$BODY" "$HEAD_FILE"' EXIT
# http METHOD PATH [JSON_BODY] [BEARER_TOKEN] -> prints the status; the body is left in $BODY
http() {
  local method="$1" path="$2" data="${3:-}" token="${4:-}"
  local args=(-sS $CURL_OPTS --max-time 30 -o "$BODY" -D "$HEAD_FILE" -w '%{http_code}' -X "$method" -H 'Accept: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  [ -n "${SMOKE_TRACE:-}" ] && args+=(--trace-ascii "$SMOKE_TRACE")
  curl "${args[@]}" "$BASE_URL$path"
}
expect() { [ "$1" = "$2" ] || fail "$3: expected HTTP $2, got $1 ($(head -c 200 "$BODY"))"; }

say "the app and its health answer over the public address"
expect "$(http GET /actuator/health)" 200 "health"
[ "$(jq -r .status "$BODY")" = "UP" ] || fail "health is not UP"
expect "$(http GET /)" 200 "the app"
grep -q 'id="root"' "$BODY" || fail "the page is not the app: headers [$(tr -d '\r' < "$HEAD_FILE" | tr '\n' '|' | head -c 600)] body [$(head -c 200 "$BODY")]"
headers=$(curl -sSI $CURL_OPTS --max-time 30 "$BASE_URL/service-worker.js") || fail "service worker request"
echo "$headers" | tr -d '\r' | grep -qi '^cache-control:.*no-cache' || fail "the service worker may be cached"
echo "$headers" | tr -d '\r' | grep -qi '^content-security-policy:' || fail "no content security policy"
code=$(http GET /actuator/prometheus); [ "$code" != 200 ] || fail "metrics are public"
# The generated API description is for developers: it is off in production, and the proxy does not forward it.
http GET /v3/api-docs > /dev/null || true
if grep -q '"openapi"' "$BODY"; then fail "the API description is public"; fi
expect "$(http GET /api/caregiver/dashboard/nobody)" 401 "the API refuses an unknown caller"

say "sign in as the smoke account (registering it the first time)"
login=$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" '{email:$e,password:$p}')
code=$(http POST /api/auth/login "$login")
if [ "$code" = 401 ]; then
  reg=$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" '{name:"Smoke Test",email:$e,password:$p,role:"CAREGIVER",phone:""}')
  code=$(http POST /api/auth/register "$reg")
  [ "$code" = 200 ] || [ "$code" = 201 ] || fail "register: HTTP $code ($(head -c 200 "$BODY"))"
  code=$(http POST /api/auth/login "$login")
fi
expect "$code" 200 "login"
TOKEN=$(jq -r .accessToken "$BODY"); [ -n "$TOKEN" ] && [ "$TOKEN" != null ] || fail "no access token"

say "find the smoke patient (creating her the first time)"
expect "$(http GET /api/patients "" "$TOKEN")" 200 "list patients"
PATIENT=$(jq -r '[.[] | select(.name=="Smoke Test Patient")][0].id // empty' "$BODY")
if [ -z "$PATIENT" ]; then
  new='{"name":"Smoke Test Patient","languageCode":"en","kinshipTerm":"Aaita","region":"smoke test","faith":"","peakWindow":"MORNING","guardianConsent":true,"guardianName":"Smoke Test","noticeVersion":"2026-10"}'
  expect "$(http POST /api/patients "$new" "$TOKEN")" 201 "create the smoke patient"
  PATIENT=$(jq -r .id "$BODY")
fi

say "pair a tablet with a code"
expect "$(http POST "/api/patients/$PATIENT/pairing-codes" "" "$TOKEN")" 200 "mint a code"
CODE=$(jq -r .code "$BODY")
redeem=$(jq -nc --arg c "$CODE" --arg f "smoke-$(date +%s)-$RANDOM" '{code:$c,deviceLabel:"smoke tablet",deviceFingerprint:$f}')
expect "$(http POST /api/pairing/redeem "$redeem")" 200 "redeem the code"
DEVICE_TOKEN=$(jq -r .deviceToken "$BODY"); DEVICE_ID=$(jq -r .deviceId "$BODY")
[ "$(jq -r .patient.patientId "$BODY")" = "$PATIENT" ] || fail "the tablet was paired to someone else"

say "the tablet sends a session"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
session=$(jq -nc --arg id "$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || python -c 'import uuid;print(uuid.uuid4())')" --arg at "$now" --arg pid "$PATIENT" '{
  clientSessionId:$id, patientId:$pid, gameId:"koi-are-jumping", startedAt:$at, durationMs:60000, completed:true, abandoned:false,
  hourOfDay:9, moodAtStart:"QUIET", difficulty:{tier:1,params:{}}, trials:[],
  contributions:[{target:"MOTOR",raw:72,confidence:0.9,because:"Smoke test."}], markers:null, precomputedReading:false, engineVersion:"1.0.0"}')
expect "$(http POST /api/device/sessions "$session" "$DEVICE_TOKEN")" 200 "submit the session"
[ "$(jq -r .accepted "$BODY")" = 1 ] || fail "the session was not accepted: $(head -c 200 "$BODY")"

say "the caregiver dashboard shows it"
expect "$(http GET "/api/caregiver/dashboard/$PATIENT" "" "$TOKEN")" 200 "dashboard"
n=$(jq -r '.sessionsLast7Days' "$BODY"); [ "$n" -ge 1 ] || fail "the dashboard shows no sessions"
jq -e '.domains | map(select(.target=="MOTOR")) | length >= 1' "$BODY" >/dev/null || fail "the dashboard has no motor domain"

say "remove the tablet again"
code=$(http DELETE "/api/patients/$PATIENT/devices/$DEVICE_ID" "" "$TOKEN"); expect "$code" 204 "remove the tablet"
expect "$(http POST /api/device/sessions "$session" "$DEVICE_TOKEN")" 401 "a removed tablet is refused"

say "OK"
