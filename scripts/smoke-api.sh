#!/usr/bin/env bash
# Smoke checklist for examflex-api.
# Usage: BASE_URL=http://localhost:3000 ./scripts/smoke-api.sh
# Optional: AUTH_TOKEN=<jwt> for protected GET routes.

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_HEADER=()
if [[ -n "${AUTH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

check() {
  local method="$1"
  local path="$2"
  local expected="${3:-200}"
  local url="${BASE_URL}${path}"
  local code
  code=$(curl -sS -o /tmp/examflex-smoke-body -w "%{http_code}" \
    -X "$method" "${AUTH_HEADER[@]}" "$url" || true)
  # 401/403 still prove the route exists and Nest is routing
  if [[ "$code" == "$expected" || "$code" == "401" || "$code" == "403" || "$code" == "400" ]]; then
    echo "OK  $method $path -> $code"
  else
    echo "FAIL $method $path -> $code (expected $expected, 401, 403, or 400)"
    head -c 500 /tmp/examflex-smoke-body || true
    echo
    exit 1
  fi
}

echo "Smoke against ${BASE_URL}"
check GET /api/v1
check GET /api/v1/health
check GET /api/docs
check GET /api/v1/auth/profile
check GET /api/v1/users
check GET /api/v1/categories
check GET /api/v1/exams
check GET /api/v1/exam-groups
check GET /api/v1/subjects
check GET /api/v1/topics
check GET /api/v1/tags
check GET /api/v1/questions
check GET /api/v1/search
check GET /api/v1/mock-tests
check GET /api/v1/full-mock-tests
check GET /api/v1/mock-test-attempts/my-attempts
check GET /api/v1/analytics/dashboard
check GET /api/v1/imports/uploads
check POST /api/v1/files/signed-url
echo "Smoke passed"
