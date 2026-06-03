#!/bin/bash
# [fe-rail] lint-lib.sh — 공유 린터/포매터 감지 로직
# lint-fix.sh(PostToolUse) / quality-gate.sh(Stop) 가 source 하여 사용한다.
# 소비자 프로젝트가 Biome 또는 ESLint(+Prettier) 중 무엇을 쓰는지 자동 감지한다.
#
# 각 함수는 감지된 실행 커맨드를 stdout 으로 출력하고(없으면 빈 문자열),
# 호출부는 `BIN=$(fe_detect_xxx "$PROJECT_ROOT")` 로 받아 `[ -n "$BIN" ]` 분기한다.
# 로컬 바이너리(node_modules/.bin) 우선, 없으면 npx fallback. 단, config 파일이
# 없는 도구는 감지하지 않는다(설정 없는 린터 실행 → 무의미한 오류 방지).

# ── Biome ──────────────────────────────────────────────────────────────────
# biome.json / biome.jsonc 가 있고 바이너리가 잡힐 때만 감지.
# Biome 은 lint + format 통합 도구이므로 감지되면 Prettier 를 대체한다.
fe_detect_biome() {
  local root="$1"
  local has_cfg=0
  for cfg in biome.json biome.jsonc; do
    [ -f "$root/$cfg" ] && has_cfg=1 && break
  done
  [ "$has_cfg" -eq 0 ] && return 0

  if [ -x "$root/node_modules/.bin/biome" ]; then
    printf '%s' "$root/node_modules/.bin/biome"
  elif command -v npx >/dev/null 2>&1; then
    printf '%s' "npx @biomejs/biome"
  fi
}

# ── ESLint ─────────────────────────────────────────────────────────────────
# flat config(eslint.config.*) / legacy(.eslintrc.*) 어느 쪽이든 config 가
# 있을 때만 감지. config 없이 eslint 를 돌리면 "no config" 오류만 난다.
fe_detect_eslint() {
  local root="$1"
  local has_cfg=0
  for cfg in eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts \
             .eslintrc.js .eslintrc.cjs .eslintrc.json .eslintrc.yml .eslintrc.yaml .eslintrc; do
    [ -f "$root/$cfg" ] && has_cfg=1 && break
  done
  [ "$has_cfg" -eq 0 ] && return 0

  if [ -x "$root/node_modules/.bin/eslint" ]; then
    printf '%s' "$root/node_modules/.bin/eslint"
  elif command -v npx >/dev/null 2>&1; then
    printf '%s' "npx eslint"
  fi
}

# ── Prettier ───────────────────────────────────────────────────────────────
# config 파일이 있을 때만 감지. Biome 감지 시에는 호출부에서 skip 하여
# 이중 포맷 충돌(서로 다른 스타일로 번갈아 덮어쓰기)을 방지한다.
fe_detect_prettier() {
  local root="$1"
  local has_cfg=0
  for cfg in .prettierrc .prettierrc.js .prettierrc.cjs .prettierrc.mjs \
             .prettierrc.json .prettierrc.yml .prettierrc.yaml .prettierrc.toml \
             prettier.config.js prettier.config.cjs prettier.config.mjs; do
    [ -f "$root/$cfg" ] && has_cfg=1 && break
  done
  [ "$has_cfg" -eq 0 ] && return 0

  if [ -x "$root/node_modules/.bin/prettier" ]; then
    printf '%s' "$root/node_modules/.bin/prettier"
  elif command -v npx >/dev/null 2>&1; then
    printf '%s' "npx prettier"
  fi
}
