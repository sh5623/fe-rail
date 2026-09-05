#!/bin/bash
# [fe-rail] lint-lib.sh — 공유 린터/포매터 감지·실행 로직
# lint-fix.sh(PostToolUse) / quality-gate.sh(Stop) 가 source 하여 사용한다.
#
# API:
#   fe_has_biome    "$root"         → exit 0(있음) / 1(없음)
#   fe_run_biome    "$root" [args]  → 감지된 바이너리로 실행
#   fe_has_eslint   "$root"         → exit 0 / 1
#   fe_run_eslint   "$root" [args]  → 실행
#   fe_has_prettier "$root"         → exit 0 / 1
#   fe_run_prettier "$root" [args]  → 실행
#
# 설계 원칙:
#   - 바이너리 경로를 문자열 변수에 담아 비인용 실행($BIN cmd) 하지 않는다.
#     fe_run_xxx 함수 내부에서 "quoted path" 로 exec 하므로 경로 공백에 안전.
#   - fe_run_xxx 는 subshell 에서 project root 로 cd 후 실행한다.
#     ESLint v9 flat config 등 CWD 기준으로 설정 파일을 탐색하는 도구에 필요.
#   - config 파일이 없는 도구는 감지 실패 → 설정 없는 린터 "no config" 오류 방지.
#   - 로컬 바이너리(node_modules/.bin) 우선, 없으면 npx fallback(FE_RAIL_ALLOW_NPX=1 옵트인 시에만).
#   - Biome 감지 시 Prettier 는 호출부에서 skip(이중 포맷 충돌 방지).

# npx 폴백은 옵트인(FE_RAIL_ALLOW_NPX=1)일 때만 허용한다 — 기본은 로컬 바이너리 전용.
# 자동 훅(lint-fix=PostToolUse / quality-gate=Stop)이 매번 네트워크 다운로드나 미고정
# 최신버전 실행을 유발하지 않도록. 로컬도 npx 도 없으면 fe_has_* 가 실패 → 해당 도구 skip.
fe_npx_ok() { [ "${FE_RAIL_ALLOW_NPX:-0}" = 1 ] && command -v npx >/dev/null 2>&1; }

# ── 경로 유틸 (Git 루트 ≠ 패키지 루트 — 모노레포 대응, 2026-09 교차 리뷰) ──────
# fe_pkg_root <dir> <top> — <dir> 에서 위로 올라가며 첫 package.json 이 있는 디렉터리(패키지 루트).
#   <top>(보통 Git 루트)을 넘지 않으며, 없으면 <top> 을 돌려준다. apps/web 에만 설정·도구가 있는
#   모노레포에서 Git 루트를 패키지 루트로 쓰면 도구 호출이 0회로 조용히 통과한다.
fe_pkg_root() {
  local d="$1" top="$2"
  d=${d%/.}; top=${top%/.}
  while :; do
    [ -f "$d/package.json" ] && { printf '%s\n' "$d"; return 0; }
    [ "$d" = "$top" ] || [ "$d" = "/" ] || [ "$d" = "." ] && break
    d=$(dirname "$d")
  done
  printf '%s\n' "$top"
}
# fe_find_bin <root> <name> — <root>/node_modules/.bin/<name> 부터 상위로 올라가며 실행 가능한 바이너리를
#   찾아 경로를 출력한다(없으면 1). 상한은 FE_BIN_TOP(기본 /) — 호출부가 Git 루트로 설정하면 모노레포의
#   root-hoisted 도구(루트 node_modules)를 앱 디렉터리에서도 찾는다.
fe_find_bin() {
  local d="$1" name="$2" top="${FE_BIN_TOP:-/}"
  while :; do
    [ -x "$d/node_modules/.bin/$name" ] && { printf '%s\n' "$d/node_modules/.bin/$name"; return 0; }
    [ "$d" = "$top" ] || [ "$d" = "/" ] || [ "$d" = "." ] && return 1
    d=$(dirname "$d")
  done
}

# ── Biome ──────────────────────────────────────────────────────────────────

# 설정 파일 존재만 판정 (바이너리 가용성과 분리 — quality-gate 의 "설치 안내"용).
fe_has_biome_config() {
  local root="$1"
  for cfg in biome.json biome.jsonc; do
    [ -f "$root/$cfg" ] && return 0
  done
  return 1
}

fe_has_biome() {
  fe_has_biome_config "$1" || return 1
  fe_find_bin "$1" biome >/dev/null || fe_npx_ok
}

fe_run_biome() {
  local root="$1"; shift
  local bin; bin=$(fe_find_bin "$root" biome)
  ( cd "$root" && \
    if [ -n "$bin" ]; then
      "$bin" "$@"
    else
      npx @biomejs/biome "$@"
    fi
  )
}

# ── ESLint ─────────────────────────────────────────────────────────────────

fe_has_eslint_config() {
  local root="$1"
  for cfg in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
             .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml .eslintrc; do
    [ -f "$root/$cfg" ] && return 0
  done
  return 1
}

fe_has_eslint() {
  fe_has_eslint_config "$1" || return 1
  fe_find_bin "$1" eslint >/dev/null || fe_npx_ok
}

fe_run_eslint() {
  local root="$1"; shift
  local bin; bin=$(fe_find_bin "$root" eslint)
  ( cd "$root" && \
    if [ -n "$bin" ]; then
      "$bin" "$@"
    else
      npx eslint "$@"
    fi
  )
}

# ── Prettier ───────────────────────────────────────────────────────────────

fe_has_prettier() {
  local root="$1" found=0
  for cfg in .prettierrc .prettierrc.js .prettierrc.cjs .prettierrc.mjs \
             .prettierrc.json .prettierrc.yml .prettierrc.yaml .prettierrc.toml \
             prettier.config.js prettier.config.cjs prettier.config.mjs; do
    [ -f "$root/$cfg" ] && found=1 && break
  done
  [ "$found" -eq 0 ] && return 1
  fe_find_bin "$root" prettier >/dev/null || fe_npx_ok
}

fe_run_prettier() {
  local root="$1"; shift
  local bin; bin=$(fe_find_bin "$root" prettier)
  ( cd "$root" && \
    if [ -n "$bin" ]; then
      "$bin" "$@"
    else
      npx prettier "$@"
    fi
  )
}
