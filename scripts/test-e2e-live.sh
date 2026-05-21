#!/usr/bin/env bash
set -euo pipefail

API_URL="${AICP_E2E_API_URL:-http://localhost:3101}"
REPO_LOCAL_PATH="${AICP_E2E_REPO_PATH:-$(pwd)}"
REPO_OWNER="${AICP_E2E_REPO_OWNER:-newmba}"
REPO_NAME="${AICP_E2E_REPO_NAME:-$(basename "$REPO_LOCAL_PATH")}"
REPO_PLATFORM="${AICP_E2E_REPO_PLATFORM:-github}"
REPO_URL="${AICP_E2E_REPO_URL:-https://github.com/${REPO_OWNER}/${REPO_NAME}}"
PREFERRED_AGENT="${AICP_E2E_AGENT:-claude_code}"
TIMEOUT_SECONDS="${AICP_E2E_TIMEOUT_SECONDS:-240}"
POLL_INTERVAL_SECONDS="${AICP_E2E_POLL_INTERVAL_SECONDS:-3}"

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_bin curl
require_bin jq

log() {
  printf '[e2e] %s\n' "$*"
}

post_json() {
  local path="$1"
  local body="$2"
  curl -fsS -H 'Content-Type: application/json' -d "$body" "${API_URL}${path}"
}

get_json() {
  local path="$1"
  curl -fsS "${API_URL}${path}"
}

log "Checking API availability at ${API_URL}"
get_json "/api/runs" >/dev/null

timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
goal="E2E live verification ${timestamp}: inspect the repository and keep the workspace unchanged. Do not edit files; only validate that the execution pipeline can run safely."

repo_payload="$(
  jq -nc \
    --arg platform "$REPO_PLATFORM" \
    --arg owner "$REPO_OWNER" \
    --arg name "$REPO_NAME" \
    --arg url "$REPO_URL" \
    --arg localPath "$REPO_LOCAL_PATH" \
    '{
      platform: $platform,
      owner: $owner,
      name: $name,
      url: $url,
      defaultBranch: "main",
      localPath: $localPath
    }'
)"

log "Onboarding repository ${REPO_OWNER}/${REPO_NAME}"
repo_response="$(post_json "/api/repos" "$repo_payload")"
repo_id="$(jq -r '.id' <<<"$repo_response")"

task_payload="$(
  jq -nc \
    --arg repoId "$repo_id" \
    --arg goal "$goal" \
    --arg preferredAgent "$PREFERRED_AGENT" \
    '{
      repoId: $repoId,
      source: { type: "manual" },
      goal: $goal,
      scope: {
        allowedPaths: ["apps/api/src/**"],
        forbiddenPaths: []
      },
      doneWhen: [
        "Verification passes",
        "Only allowed files are changed"
      ],
      constraints: [
        "Do not modify files",
        "Use file inspection when git metadata is unavailable"
      ],
      preferredAgent: $preferredAgent
    }'
)"

log "Creating task"
task_response="$(post_json "/api/tasks" "$task_payload")"
task_id="$(jq -r '.id' <<<"$task_response")"

log "Executing task ${task_id}"
execute_response="$(post_json "/api/orchestrator/tasks/${task_id}/execute" '{}')"
execute_status="$(jq -r '.status' <<<"$execute_response")"
if [[ "$execute_status" != "accepted" ]]; then
  echo "Unexpected execute response: $execute_response" >&2
  exit 1
fi

deadline=$((SECONDS + TIMEOUT_SECONDS))
run_id=""
run_status=""

while (( SECONDS < deadline )); do
  runs_response="$(get_json "/api/runs")"
  run_summary="$(
    jq -c --arg taskId "$task_id" '
      map(select(.taskId == $taskId))
      | sort_by(.createdAt // .startedAt // .updatedAt // "")
      | last
    ' <<<"$runs_response"
  )"

  if [[ "$run_summary" != "null" ]]; then
    run_id="$(jq -r '.id' <<<"$run_summary")"
    run_status="$(jq -r '.status' <<<"$run_summary")"
    log "Run ${run_id} status=${run_status}"

    if [[ "$run_status" == "completed" || "$run_status" == "failed" || "$run_status" == "stopped" ]]; then
      break
    fi
  else
    log "Waiting for run record to be created"
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

if [[ -z "$run_id" ]]; then
  echo "Timed out waiting for run creation" >&2
  exit 1
fi

run_detail="$(get_json "/api/runs/${run_id}")"
run_status="$(jq -r '.status' <<<"$run_detail")"

if [[ "$run_status" != "completed" ]]; then
  echo "Run did not complete successfully: status=${run_status}" >&2
  jq '{
    id,
    status,
    finishedAt,
    lastEvents: (.events | map({type, data}) | .[-8:])
  }' <<<"$run_detail" >&2
  exit 1
fi

verification_json="$(jq -c 'first(.events[] | select(.type == "verification_completed").data)' <<<"$run_detail")"
review_json="$(jq -c 'first(.events[] | select(.type == "review_completed").data)' <<<"$run_detail")"
evidence_json="$(jq -c 'first(.events[] | select(.type == "evidence_generated").data)' <<<"$run_detail")"

if [[ "$verification_json" == "null" || "$review_json" == "null" || "$evidence_json" == "null" ]]; then
  echo "Missing verification/review/evidence events" >&2
  jq '{
    id,
    status,
    eventTypes: (.events | map(.type))
  }' <<<"$run_detail" >&2
  exit 1
fi

verification_passed="$(jq -r '.passed' <<<"$verification_json")"
review_verdict="$(jq -r '.verdict' <<<"$review_json")"
schema_version="$(jq -r '.schemaVersion' <<<"$evidence_json")"
changed_files="$(jq -r '.diffSummary.changedFiles // 0' <<<"$run_detail")"
lint_status="$(jq -r '.checks.lint // "missing"' <<<"$verification_json")"
typecheck_status="$(jq -r '.checks.typecheck // "missing"' <<<"$verification_json")"
build_status="$(jq -r '.checks.build // "missing"' <<<"$verification_json")"
unit_tests_status="$(jq -r '.checks.unit_tests // "missing"' <<<"$verification_json")"

if [[ "$verification_passed" != "true" ]]; then
  echo "Verification did not pass" >&2
  jq '.' <<<"$verification_json" >&2
  exit 1
fi

if [[ "$review_verdict" != "approved" ]]; then
  echo "Unexpected review verdict: ${review_verdict}" >&2
  jq '.' <<<"$review_json" >&2
  exit 1
fi

if [[ "$schema_version" != "1.0" ]]; then
  echo "Unexpected evidence schema version: ${schema_version}" >&2
  jq '.' <<<"$evidence_json" >&2
  exit 1
fi

if [[ "$changed_files" != "0" ]]; then
  echo "Expected zero changed files, got ${changed_files}" >&2
  jq '{diffSummary, filesChanged}' <<<"$run_detail" >&2
  exit 1
fi

log "E2E completed successfully"
jq -n \
  --arg repoId "$repo_id" \
  --arg taskId "$task_id" \
  --arg runId "$run_id" \
  --arg status "$run_status" \
  --arg lint "$lint_status" \
  --arg typecheck "$typecheck_status" \
  --arg build "$build_status" \
  --arg unitTests "$unit_tests_status" \
  --arg verdict "$review_verdict" \
  --arg schemaVersion "$schema_version" \
  '{
    repoId: $repoId,
    taskId: $taskId,
    runId: $runId,
    status: $status,
    verification: {
      lint: $lint,
      typecheck: $typecheck,
      build: $build,
      unit_tests: $unitTests
    },
    reviewVerdict: $verdict,
    evidenceSchemaVersion: $schemaVersion
  }'
