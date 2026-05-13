#!/bin/bash
# [fe-rail] quality-gate.sh — Stop
# 응답 종료 전 변경 파일에 ESLint + tsc --noEmit 일괄 실행. 차단 없음(exit 0).

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 변경 파일 수집 (staged + unstaged, 최대 20개)
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$' \
  | head -20)

[ -z "$CHANGED_FILES" ] && exit 0

OUTPUT=""

# ── ESLint ──────────────────────────────────────────────────────────────────
if [ -x "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
  LINT_OUT=$(echo "$CHANGED_FILES" | xargs "$PROJECT_ROOT/node_modules/.bin/eslint" --quiet 2>&1)
  if [ -n "$LINT_OUT" ]; then
    OUTPUT="${OUTPUT}[ESLint]\n${LINT_OUT}\n"
  fi
fi

# ── TypeScript ───────────────────────────────────────────────────────────────
if [ -x "$PROJECT_ROOT/node_modules/.bin/tsc" ]; then
  TSC_OUT=$("$PROJECT_ROOT/node_modules/.bin/tsc" --noEmit --pretty false 2>&1 | head -20)
  if [ -n "$TSC_OUT" ]; then
    OUTPUT="${OUTPUT}[TypeScript]\n${TSC_OUT}\n"
  fi
fi

# ── 출력 ────────────────────────────────────────────────────────────────────
if [ -n "$OUTPUT" ]; then
  printf "[fe-rail][quality-gate] 수정된 파일에 오류가 있습니다:\n" >&2
  printf "%b" "$OUTPUT" | head -30 >&2
fi

exit 0
