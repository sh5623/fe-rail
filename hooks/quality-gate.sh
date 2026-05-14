#!/bin/bash
# [fe-rail] quality-gate.sh — Stop
# 응답 종료 전 변경 파일에 ESLint + tsc --noEmit 일괄 실행. 차단 없음(exit 0).

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 변경 파일 수집 (staged + unstaged + 신규 untracked, 최대 20개)
CHANGED_FILES=$(
  { git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$' \
  | sort -u \
  | head -20
)

[ -z "$CHANGED_FILES" ] && exit 0

OUTPUT=""

# ── ESLint ──────────────────────────────────────────────────────────────────
ESLINT_BIN=""
if [ -x "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
  ESLINT_BIN="$PROJECT_ROOT/node_modules/.bin/eslint"
elif command -v npx >/dev/null 2>&1; then
  for cfg in .eslintrc.js .eslintrc.json .eslintrc.cjs .eslintrc.yml .eslintrc.yaml \
             eslint.config.js eslint.config.mjs eslint.config.ts; do
    if [ -f "$PROJECT_ROOT/$cfg" ]; then
      ESLINT_BIN="npx eslint"
      break
    fi
  done
fi

if [ -n "$ESLINT_BIN" ]; then
  LINT_OUT=$(echo "$CHANGED_FILES" | xargs $ESLINT_BIN --quiet 2>&1)
  if [ -n "$LINT_OUT" ]; then
    OUTPUT="${OUTPUT}[ESLint]\n${LINT_OUT}\n"
  fi
fi

# ── TypeScript ───────────────────────────────────────────────────────────────
TSC_BIN=""
if [ -x "$PROJECT_ROOT/node_modules/.bin/tsc" ]; then
  TSC_BIN="$PROJECT_ROOT/node_modules/.bin/tsc"
elif command -v npx >/dev/null 2>&1 && [ -f "$PROJECT_ROOT/tsconfig.json" ]; then
  TSC_BIN="npx tsc"
fi

if [ -n "$TSC_BIN" ] && [ -f "$PROJECT_ROOT/tsconfig.json" ]; then
  TSC_OUT=$($TSC_BIN --noEmit --pretty false --project "$PROJECT_ROOT/tsconfig.json" 2>&1 | head -20)
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
