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
#   - config 파일이 없는 도구는 감지 실패 → 설정 없는 린터 "no config" 오류 방지.
#   - 로컬 바이너리(node_modules/.bin) 우선, 없으면 npx fallback.
#   - Biome 감지 시 Prettier 는 호출부에서 skip(이중 포맷 충돌 방지).

# ── Biome ──────────────────────────────────────────────────────────────────

fe_has_biome() {
  local root="$1" found=0
  for cfg in biome.json biome.jsonc; do
    [ -f "$root/$cfg" ] && found=1 && break
  done
  [ "$found" -eq 0 ] && return 1
  [ -x "$root/node_modules/.bin/biome" ] || command -v npx >/dev/null 2>&1
}

fe_run_biome() {
  local root="$1"; shift
  if [ -x "$root/node_modules/.bin/biome" ]; then
    "$root/node_modules/.bin/biome" "$@"
  else
    npx @biomejs/biome "$@"
  fi
}

# ── ESLint ─────────────────────────────────────────────────────────────────

fe_has_eslint() {
  local root="$1" found=0
  for cfg in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
             .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml .eslintrc; do
    [ -f "$root/$cfg" ] && found=1 && break
  done
  [ "$found" -eq 0 ] && return 1
  [ -x "$root/node_modules/.bin/eslint" ] || command -v npx >/dev/null 2>&1
}

fe_run_eslint() {
  local root="$1"; shift
  if [ -x "$root/node_modules/.bin/eslint" ]; then
    "$root/node_modules/.bin/eslint" "$@"
  else
    npx eslint "$@"
  fi
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
  [ -x "$root/node_modules/.bin/prettier" ] || command -v npx >/dev/null 2>&1
}

fe_run_prettier() {
  local root="$1"; shift
  if [ -x "$root/node_modules/.bin/prettier" ]; then
    "$root/node_modules/.bin/prettier" "$@"
  else
    npx prettier "$@"
  fi
}
