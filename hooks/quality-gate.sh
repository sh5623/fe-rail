#!/bin/bash
# [fe-rail] quality-gate.sh — Stop
# 응답 종료 전 변경 파일에 린터(Biome 또는 ESLint) + tsc --noEmit 일괄 실행. 차단 없음(exit 0).
# 소비자 환경을 감지해 설치된 도구만 돌린다. Biome·ESLint 가 모두 있으면 둘 다 실행.

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 변경 파일 수집 (staged + unstaged + 신규 untracked, 최대 20개)
CHANGED_FILES=$(
  { git diff --name-only --diff-filter=d HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$' \
  | sort -u \
  | head -20
)

[ -z "$CHANGED_FILES" ] && exit 0

# 공유 감지 로직 로드
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$LIB_DIR/scripts/lint-lib.sh" ] && . "$LIB_DIR/scripts/lint-lib.sh"

BIOME=""; ESLINT=""
if command -v fe_detect_biome >/dev/null 2>&1; then
  BIOME=$(fe_detect_biome "$PROJECT_ROOT")
  ESLINT=$(fe_detect_eslint "$PROJECT_ROOT")
fi

OUTPUT=""

# ── Biome ───────────────────────────────────────────────────────────────────
# biome check 는 clean 일 때도 요약을 출력하므로 종료코드로 게이트한다.
if [ -n "$BIOME" ]; then
  BIOME_OUT=$(echo "$CHANGED_FILES" | xargs $BIOME check --no-errors-on-unmatched 2>&1)
  if [ $? -ne 0 ] && [ -n "$BIOME_OUT" ]; then
    OUTPUT="${OUTPUT}[Biome]\n${BIOME_OUT}\n"
  fi
fi

# ── ESLint ──────────────────────────────────────────────────────────────────
if [ -n "$ESLINT" ]; then
  LINT_OUT=$(echo "$CHANGED_FILES" | xargs $ESLINT --quiet 2>&1)
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
