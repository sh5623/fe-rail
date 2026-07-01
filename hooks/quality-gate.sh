#!/bin/bash
# [fe-rail] quality-gate.sh — Stop
# 응답 종료 전 변경 파일에 린터(Biome 또는 ESLint) + tsc --noEmit 일괄 실행. 차단 없음(exit 0).
# 소비자 환경을 감지해 설치된 도구만 돌린다. Biome·ESLint 가 모두 있으면 둘 다 실행.
# xargs 는 shell function 을 직접 호출할 수 없어 파일별 루프로 실행한다.

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "quality-gate" "standard" && exit 0

PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 변경 파일 수집 (staged + unstaged + 신규 untracked, 최대 20개)
CHANGED_FILES=$(
  { git diff --name-only --diff-filter=d HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$' \
  | sort -u \
  | head -20
)

[ -z "$CHANGED_FILES" ] && exit 0

# 공유 감지·실행 로직 로드
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$LIB_DIR/scripts/lint-lib.sh" ] && . "$LIB_DIR/scripts/lint-lib.sh"

OUTPUT=""

# ── Biome ───────────────────────────────────────────────────────────────────
# biome check 는 clean 일 때도 요약을 출력하므로 종료코드로 게이트한다.
if fe_has_biome "$PROJECT_ROOT"; then
  BIOME_OUT="" BIOME_FAIL=0
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    out=$(fe_run_biome "$PROJECT_ROOT" check --no-errors-on-unmatched "$f" 2>&1); rc=$?
    [ "$rc" -ne 0 ] && BIOME_FAIL=1 && BIOME_OUT="${BIOME_OUT}${out}"$'\n'
  done <<< "$CHANGED_FILES"
  [ "$BIOME_FAIL" -ne 0 ] && [ -n "$BIOME_OUT" ] && OUTPUT="${OUTPUT}[Biome]\n${BIOME_OUT}"
fi

# ── ESLint ──────────────────────────────────────────────────────────────────
if fe_has_eslint "$PROJECT_ROOT"; then
  LINT_OUT=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    out=$(fe_run_eslint "$PROJECT_ROOT" --quiet "$f" 2>&1)
    [ -n "$out" ] && LINT_OUT="${LINT_OUT}${out}"$'\n'
  done <<< "$CHANGED_FILES"
  [ -n "$LINT_OUT" ] && OUTPUT="${OUTPUT}[ESLint]\n${LINT_OUT}"
fi

# ── TypeScript ───────────────────────────────────────────────────────────────
# 솔루션 스타일 tsconfig(files:[]+references)에서는 bare `tsc -p tsconfig.json` 가
# 아무 파일도 검사하지 않으므로(no-op), typecheck 스크립트 → `tsc -b` → `tsc -p` 순으로 폴백한다.
# 바이너리/PM 경로를 문자열 변수에 담아 비인용 실행하지 않음(공백 안전).
_fe_pm() {  # 패키지 매니저 감지 (lock 파일 기준)
  if   [ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]; then echo pnpm
  elif [ -f "$PROJECT_ROOT/yarn.lock" ];      then echo yarn
  elif [ -f "$PROJECT_ROOT/bun.lockb" ] || [ -f "$PROJECT_ROOT/bun.lock" ]; then echo bun
  else echo npm; fi
}
_fe_has_tsc() {
  [ -f "$PROJECT_ROOT/tsconfig.json" ] || return 1
  [ -x "$PROJECT_ROOT/node_modules/.bin/tsc" ] || command -v npx >/dev/null 2>&1
}
_fe_run_tsc() {
  ( cd "$PROJECT_ROOT" && \
    if [ -x "$PROJECT_ROOT/node_modules/.bin/tsc" ]; then
      "$PROJECT_ROOT/node_modules/.bin/tsc" "$@"
    else
      npx tsc "$@"
    fi
  )
}

if _fe_has_tsc; then
  if grep -q '"typecheck"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
    # 프로젝트가 의도한 config 사용 — 가장 안전 (예: tsc -p tsconfig.app.json)
    PM=$(_fe_pm)
    TSC_OUT=$( ( cd "$PROJECT_ROOT" && "$PM" run typecheck ) 2>&1 | head -20)
  elif grep -q '"references"' "$PROJECT_ROOT/tsconfig.json" 2>/dev/null; then
    # 솔루션 스타일 → build 모드라야 참조 프로젝트를 검사
    TSC_OUT=$(_fe_run_tsc -b --pretty false 2>&1 | head -20)
  else
    TSC_OUT=$(_fe_run_tsc --noEmit --pretty false --project "$PROJECT_ROOT/tsconfig.json" 2>&1 | head -20)
  fi
  [ -n "$TSC_OUT" ] && OUTPUT="${OUTPUT}[TypeScript]\n${TSC_OUT}\n"
fi

# ── 출력 ────────────────────────────────────────────────────────────────────
if [ -n "$OUTPUT" ]; then
  printf "[fe-rail][quality-gate] 수정된 파일에 오류가 있습니다:\n" >&2
  printf "%b" "$OUTPUT" | head -30 >&2
fi

exit 0
