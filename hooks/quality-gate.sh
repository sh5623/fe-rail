#!/bin/bash
# [fe-rail] quality-gate.sh — Stop
# 응답 종료 전 변경 파일에 린터(Biome 또는 ESLint) + 타입체크 일괄 실행. 차단 없음(exit 0).
# 소비자 환경을 감지해 설치된 도구만 돌린다. Biome·ESLint 가 모두 있으면 둘 다 실행.
#
# 범위 규칙 — 2026-09 교차 리뷰에서 재현된 «조용한 미검사» 4건을 막는다:
#   1. Git 루트 ≠ 패키지 루트. 변경 파일을 «가장 가까운 package.json» 기준으로 묶어 패키지마다 돌린다
#      (apps/web 에만 설정·도구가 있는 모노레포에서 Git 루트만 보면 도구 호출 0회로 통과했다).
#      바이너리는 패키지 → 상위(root-hoisted) 순으로 Git 루트까지 찾는다 (lint-lib.sh fe_find_bin).
#   2. `typecheck` 스크립트가 있으면 tsconfig.json 유무와 무관하게 그것을 돌린다 (tsconfig.app.json 전용 앱).
#   3. 삭제된 소스도 타입체크 트리거다 (import 하던 파일이 사라지면 깨진다) — 린터에는 넘기지 않는다.
#   4. 검사 범위와 출력 길이를 분리한다 — 파일 목록은 조용히 자르지 않는다(상한 200, 초과분은 «미검사» 로
#      명시), 출력만 자른다. 린터는 파일별 루프 대신 한 번에 여러 파일을 받는다.

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "quality-gate" "standard" && exit 0

GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 공유 감지·실행 로직 로드
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$LIB_DIR/scripts/lint-lib.sh" ] && . "$LIB_DIR/scripts/lint-lib.sh"
command -v fe_pkg_root >/dev/null 2>&1 || exit 0
FE_BIN_TOP="$GIT_ROOT"

# ── 변경 파일 수집 (Git 루트 기준 상대경로) ─────────────────────────────────
# - CHANGED_SRC : 소스 파일(추가·수정) — 린터 + 타입체크 트리거
# - CHANGED_CFG : 타입에 영향 주는 설정(tsconfig*.json·package.json) — 타입체크 트리거
# - DELETED_SRC : 삭제된 소스 — 타입체크 트리거만 (파일이 없으므로 린터 대상 아님)
# 세 명령 모두 `git -C "$GIT_ROOT"` 로 돌린다 — 세션 cwd 가 apps/web 같은 하위 디렉터리면 `git ls-files`
# 는 cwd 기준 상대경로를 내서 `$GIT_ROOT/$f` 가 없는 파일을 가리킨다(모노레포 무출력의 두 번째 원인).
_CHANGED_ALL=$(
  { git -C "$GIT_ROOT" diff --name-only --diff-filter=d HEAD 2>/dev/null; git -C "$GIT_ROOT" ls-files --others --exclude-standard 2>/dev/null; } \
  | sort -u
)
CHANGED_SRC=$(printf '%s\n' "$_CHANGED_ALL" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$')
CHANGED_CFG=$(printf '%s\n' "$_CHANGED_ALL" | grep -E '(^|/)(tsconfig[^/]*\.json|package\.json)$')
DELETED_SRC=$(git -C "$GIT_ROOT" diff --name-only --diff-filter=D HEAD 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|vue)$')

[ -z "$CHANGED_SRC" ] && [ -z "$CHANGED_CFG" ] && [ -z "$DELETED_SRC" ] && exit 0

# 파일 수 상한 — 범위를 «조용히» 자르지 않는다. 초과분은 미검사로 보고한다.
MAX_FILES=200
TOTAL_SRC=$(printf '%s\n' "$CHANGED_SRC" | grep -c .)
NUDGE=""
if [ "$TOTAL_SRC" -gt "$MAX_FILES" ]; then
  NUDGE="${NUDGE}[fe-rail][quality-gate] 변경 소스 ${TOTAL_SRC}개 중 ${MAX_FILES}개만 린트 — 나머지 $((TOTAL_SRC - MAX_FILES))개는 미검사(전체는 \$PM run lint 로 직접 실행).\n"
  CHANGED_SRC=$(printf '%s\n' "$CHANGED_SRC" | head -"$MAX_FILES")
fi

# ── 패키지별로 묶기 ─────────────────────────────────────────────────────────
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/fe-rail-qg.XXXXXX" 2>/dev/null) || exit 0
trap 'rm -rf "$TMPD"' EXIT
_key() { printf '%s' "$1" | cksum | cut -d' ' -f1; }
: > "$TMPD/pkgs"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  p=$(fe_pkg_root "$GIT_ROOT/$(dirname "$f")" "$GIT_ROOT")
  printf '%s\n' "$p" >> "$TMPD/pkgs"
  printf '%s\n' "$GIT_ROOT/$f" >> "$TMPD/src.$(_key "$p")"
done <<< "$CHANGED_SRC"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  p=$(fe_pkg_root "$GIT_ROOT/$(dirname "$f")" "$GIT_ROOT")
  printf '%s\n' "$p" >> "$TMPD/pkgs"
  : >> "$TMPD/tsc.$(_key "$p")"      # 타입체크 트리거 표식(설정 변경·소스 삭제)
done <<< "$(printf '%s\n' "$CHANGED_CFG" "$DELETED_SRC")"

# ── 패키지 단위 실행 헬퍼 ────────────────────────────────────────────────────
_fe_pm() {  # <pkg> — 패키지 매니저 감지 (lock 파일: 패키지 → Git 루트)
  local d
  for d in "$1" "$GIT_ROOT"; do
    if   [ -f "$d/pnpm-lock.yaml" ]; then echo pnpm; return
    elif [ -f "$d/yarn.lock" ];      then echo yarn; return
    elif [ -f "$d/bun.lockb" ] || [ -f "$d/bun.lock" ]; then echo bun; return
    fi
  done
  echo npm
}
_fe_run_tsc() {  # <pkg> [args] — 로컬(패키지→상위) tsc 우선, 없으면 npx (옵트인 확인은 호출부)
  local root="$1"; shift
  local bin; bin=$(fe_find_bin "$root" tsc)
  ( cd "$root" && if [ -n "$bin" ]; then "$bin" "$@"; else npx tsc "$@"; fi )
}

OUTPUT=""
while IFS= read -r PKG; do
  [ -z "$PKG" ] && continue
  K=$(_key "$PKG")
  REL=${PKG#"$GIT_ROOT"}; REL=${REL#/}; [ -z "$REL" ] && REL="."
  FILES=()
  if [ -f "$TMPD/src.$K" ]; then
    while IFS= read -r x; do [ -n "$x" ] && FILES+=("$x"); done < "$TMPD/src.$K"
  fi

  # ── Biome ─────────────────────────────────────────────────────────────────
  # biome check 는 clean 일 때도 요약을 출력하므로 종료코드로 게이트한다.
  if [ ${#FILES[@]} -gt 0 ] && fe_has_biome "$PKG"; then
    out=$(fe_run_biome "$PKG" check --no-errors-on-unmatched "${FILES[@]}" 2>&1); rc=$?
    [ "$rc" -ne 0 ] && [ -n "$out" ] && OUTPUT="${OUTPUT}[Biome $REL]\n${out}\n"
  fi

  # ── ESLint ────────────────────────────────────────────────────────────────
  if [ ${#FILES[@]} -gt 0 ] && fe_has_eslint "$PKG"; then
    out=$(fe_run_eslint "$PKG" --quiet "${FILES[@]}" 2>&1)
    [ -n "$out" ] && OUTPUT="${OUTPUT}[ESLint $REL]\n${out}\n"
  fi

  # ── TypeScript ────────────────────────────────────────────────────────────
  # typecheck 스크립트(프로젝트가 의도한 config — tsconfig.json 이 없어도) → 솔루션 스타일(references)이면
  # `tsc -b` → 그 외 `tsc -p`. bare `tsc -p tsconfig.json` 은 files:[]+references 구성에서 no-op 이다.
  # 타입체크는 종료코드로 판정한다 — 성공(exit 0)해도 배너·요약이 stdout 에 남을 수 있어 «출력 있으면
  # 오류» 로 보면 오탐이 난다. 출력은 실패(rc!=0)일 때만 채택한다.
  TSC_RAN=0; TSC_RC=0; TSC_RAW=""
  if [ -f "$PKG/package.json" ] && grep -q '"typecheck"' "$PKG/package.json"; then
    # PM run 은 프로젝트 자신의 lockfile/node_modules 를 쓰므로 npx 옵트인과 무관하게 항상 허용.
    PM=$(_fe_pm "$PKG")
    TSC_RAW=$( ( cd "$PKG" && "$PM" run typecheck ) 2>&1 ); TSC_RC=$?; TSC_RAN=1
  elif [ -f "$PKG/tsconfig.json" ]; then
    # 로컬 tsc 없이 npx 로 떨어지는 경로는 Biome/ESLint 와 동일하게 FE_RAIL_ALLOW_NPX 옵트인 필요.
    if fe_find_bin "$PKG" tsc >/dev/null || fe_npx_ok; then
      if grep -q '"references"' "$PKG/tsconfig.json"; then
        TSC_RAW=$(_fe_run_tsc "$PKG" -b --pretty false 2>&1); TSC_RC=$?
      else
        TSC_RAW=$(_fe_run_tsc "$PKG" --noEmit --pretty false --project "$PKG/tsconfig.json" 2>&1); TSC_RC=$?
      fi
      TSC_RAN=1
    fi
  fi
  if [ "$TSC_RAN" -eq 1 ] && [ "$TSC_RC" -ne 0 ]; then
    TSC_OUT=$(printf '%s\n' "$TSC_RAW" | head -20)
    [ -n "$TSC_OUT" ] && OUTPUT="${OUTPUT}[TypeScript $REL]\n${TSC_OUT}\n"
  fi

  # ── 설정은 있으나 로컬 미설치 안내 ────────────────────────────────────────
  # npx 자동 폴백을 옵트인으로 바꾼 대신(lint-lib.sh: FE_RAIL_ALLOW_NPX), 설정은 있는데
  # 로컬 바이너리가 없어 검사를 건너뛴 경우를 알린다. Stop 훅이라 응답당 한 번만 나간다.
  if fe_has_biome_config "$PKG" && ! fe_has_biome "$PKG"; then
    NUDGE="${NUDGE}[fe-rail][quality-gate] $REL: biome.json 감지 — 로컬 biome 미설치로 검사 생략. 설치하거나 FE_RAIL_ALLOW_NPX=1 로 npx 허용.\n"
  fi
  if fe_has_eslint_config "$PKG" && ! fe_has_eslint "$PKG"; then
    NUDGE="${NUDGE}[fe-rail][quality-gate] $REL: ESLint 설정 감지 — 로컬 eslint 미설치로 검사 생략. 설치하거나 FE_RAIL_ALLOW_NPX=1 로 npx 허용.\n"
  fi
  if [ -f "$PKG/tsconfig.json" ] && ! grep -q '"typecheck"' "$PKG/package.json" 2>/dev/null \
     && ! fe_find_bin "$PKG" tsc >/dev/null && ! fe_npx_ok; then
    NUDGE="${NUDGE}[fe-rail][quality-gate] $REL: tsconfig.json 감지 — 로컬 tsc 미설치로 타입체크 생략. 설치하거나 FE_RAIL_ALLOW_NPX=1 로 npx 허용.\n"
  fi
done <<< "$(sort -u "$TMPD/pkgs")"

# ── 출력 ────────────────────────────────────────────────────────────────────
if [ -n "$OUTPUT" ]; then
  printf "[fe-rail][quality-gate] 수정된 파일에 오류가 있습니다:\n" >&2
  printf "%b" "$OUTPUT" | head -30 >&2
fi
[ -n "$NUDGE" ] && printf "%b" "$NUDGE" >&2

exit 0
