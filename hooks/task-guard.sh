#!/bin/bash
# [fe-rail] task-guard.sh — PreToolUse:Task
# 서브에이전트(Task) 프롬프트 내 위험 패턴을 감지합니다.
# 에이전트 체인 탈출: Task 도구는 별도 세션으로 실행되어 guard.sh가 적용되지 않으므로
# 프롬프트 자체를 검사합니다.
# 정책: 인젝션/위험 명령 → exit 2 차단 / 민감 파일 접근 패턴 → 경고

# Task 도구 입력에서 프롬프트 추출
# Task 입력 구조: { "prompt": "...", "description": "..." }
PROMPT="${TOOL_INPUT_PROMPT}"
if [ -z "$PROMPT" ] && [ -n "$TOOL_INPUT" ]; then
  PROMPT=$(echo "$TOOL_INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
           | sed 's/.*"prompt"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

[ -z "$PROMPT" ] && exit 0

PROMPT_LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# ── 차단: 프롬프트 인젝션·가드 우회 시도 ────────────────────────────────────
for pattern in \
  "ignore previous" \
  "ignore all instructions" \
  "disregard your instructions" \
  "forget your rules" \
  "override instructions" \
  "you are now" \
  "jailbreak" \
  "do anything now" \
  "dan mode" \
  "new instructions:"; do
  if echo "$PROMPT_LOWER" | grep -qF "$pattern"; then
    echo "[fe-rail] ❌ BLOCKED [task-guard]: 서브에이전트 프롬프트에 인젝션 패턴 감지"
    echo "[fe-rail]   패턴: $pattern"
    echo "[fe-rail]   에이전트 체인을 통한 가드 우회 시도는 차단됩니다."
    exit 2
  fi
done

# ── 차단: 서브에이전트에 위험 명령 위임 시도 ─────────────────────────────────
for pattern in \
  "rm -rf" \
  "git push --force" \
  "git reset --hard" \
  "drop table" \
  "drop database" \
  "--no-verify" \
  "git stash drop" \
  "git stash clear"; do
  if echo "$PROMPT_LOWER" | grep -qF "$pattern"; then
    echo "[fe-rail] ❌ BLOCKED [task-guard]: 서브에이전트에 위험 명령 위임 감지"
    echo "[fe-rail]   패턴: $pattern"
    echo "[fe-rail]   guard.sh 차단 대상 명령을 Task를 통해 우회할 수 없습니다."
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
  if echo "$PROMPT_LOWER" | grep -qF "$pattern"; then
    echo "[fe-rail] ⚠️  WARNING [task-guard]: 서브에이전트 프롬프트에 민감 정보 접근 패턴 감지" >&2
    echo "[fe-rail]   패턴: $pattern" >&2
    echo "[fe-rail]   서브에이전트가 민감한 파일이나 정보를 다루지 않도록 확인하세요." >&2
    break
  fi
done

exit 0
