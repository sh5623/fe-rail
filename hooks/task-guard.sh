#!/bin/bash
# [fe-rail] task-guard.sh — PreToolUse:Task|Agent
# 서브에이전트(Task/Agent) 프롬프트 내 위험 패턴을 감지합니다.
# 에이전트 체인 탈출: Task 도구는 별도 세션으로 실행되어 guard.sh가 적용되지 않으므로
# 프롬프트 자체를 검사합니다.
# 정책: 인젝션/위험 명령 위임 → exit 2 차단 / 민감 파일 접근 패턴 → 경고

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "task-guard" "minimal" && exit 0

HOOK_INPUT=$(cat)

# 프롬프트 추출: jq 는 긴 프롬프트도 정확히 파싱함.
# jq 미설치 시 raw stdin 전체를 검색 대상으로 사용 (구조 필드에 위험 패턴이 올 가능성 낮음)
PROMPT=""
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(printf '%s' "$HOOK_INPUT" | jq -r '(.tool_input.prompt // .tool_input.description // empty)' 2>/dev/null)
fi
PROMPT="${PROMPT:-${TOOL_INPUT_PROMPT}}"

# 검색 대상: PROMPT 추출 성공 시 프롬프트만, 미성공 시 raw stdin
SEARCH_IN="${PROMPT:-$HOOK_INPUT}"
[ -z "$SEARCH_IN" ] && exit 0

SEARCH_LOWER=$(echo "$SEARCH_IN" | tr '[:upper:]' '[:lower:]')

# ── 차단: 프롬프트 인젝션·가드 우회 시도 ────────────────────────────────────
for pattern in \
  "ignore previous" \
  "ignore all instructions" \
  "disregard your instructions" \
  "forget your rules" \
  "override instructions" \
  "jailbreak" \
  "do anything now" \
  "dan mode" \
  "new instructions:"; do
  if echo "$SEARCH_LOWER" | grep -qF -- "$pattern"; then
    echo "[fe-rail] ❌ BLOCKED [task-guard]: 서브에이전트 프롬프트에 인젝션 패턴 감지"
    echo "[fe-rail]   패턴: $pattern"
    echo "[fe-rail]   에이전트 체인을 통한 가드 우회 시도는 차단됩니다."
    exit 2
  fi
done

# ── 차단: 서브에이전트에 위험 명령 위임 시도 ─────────────────────────────────
# 코드 펜스(```) 내부는 코드 예시로 보고 검사에서 제외.
# 펜스 외부에서 위험 명령어가 발견되면 실행 동사 불문 무조건 차단.
# (exec 동사만 체크하면 "next step: rm -rf" 같은 변형으로 우회 가능)
fe_strip_fences() {
  printf '%s\n' "$1" | awk '/^```/{f=!f;next} !f{print}'
}
SEARCH_NO_FENCE=$(fe_strip_fences "$SEARCH_IN")
SEARCH_NO_FENCE_LOWER=$(echo "$SEARCH_NO_FENCE" | tr '[:upper:]' '[:lower:]')

for pattern in \
  "rm -rf" \
  "git push --force" \
  "git reset --hard" \
  "drop table" \
  "drop database" \
  "--no-verify" \
  "git stash drop" \
  "git stash clear"; do
  if echo "$SEARCH_NO_FENCE_LOWER" | grep -qF -- "$pattern"; then
    echo "[fe-rail] ❌ BLOCKED [task-guard]: 서브에이전트에 위험 명령 위임 감지"
    echo "[fe-rail]   패턴: $pattern"
    echo "[fe-rail]   guard.sh 차단 대상 명령을 Task를 통해 우회할 수 없습니다."
    echo "[fe-rail]   코드 예시라면 \`\`\` 펜스 블록 안에 넣어 주세요."
    exit 2
  fi
done

# ── 경고: 민감 파일 접근 위임 패턴 ──────────────────────────────────────────
for pattern in \
  ".env" \
  ".pem" \
  ".key" \
  "secret" \
  "credential" \
  "api_key" \
  "api key" \
  "access token"; do
  if echo "$SEARCH_LOWER" | grep -qF -- "$pattern"; then
    echo "[fe-rail] ⚠️  WARNING [task-guard]: 서브에이전트 프롬프트에 민감 정보 접근 패턴 감지" >&2
    echo "[fe-rail]   패턴: $pattern" >&2
    echo "[fe-rail]   서브에이전트가 민감한 파일이나 정보를 다루지 않도록 확인하세요." >&2
    break
  fi
done

exit 0
