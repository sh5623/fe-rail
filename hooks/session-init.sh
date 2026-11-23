#!/bin/bash
# [fe-rail] session-init.sh — SessionStart
#   ① 원격 버전 체크(새 버전 안내) · ② 훅 프로파일 안내 · ③ 권장 권한 미설정 안내
# 무소음 원칙: 알릴 게 없으면 아무것도 출력하지 않는다.

# ── ① 원격 버전 체크 (GitHub raw · 하루 1회 · 무소음) ─────────────────────────
# 새 버전이 있을 때만 안내하고, 그 외(이미 최신·조회 실패·curl 없음·타임아웃)는 무소음.
# 끄기: FE_RAIL_NO_UPDATE_CHECK=1 (사내망·오프라인처럼 외부 조회를 막아야 하는 환경)
# 함수로 감싼다 — 조건이 안 맞을 때 exit 하면 아래 ②·③ 안내까지 건너뛴다.
_fe_semver() {  # stdin(plugin.json 텍스트)에서 "version" 값 추출
  grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
    | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//'
}
# semver 세 자리(x.y.z)를 순수 bash 산술로 비교 — 외부 프로세스 없이 이식성 확보.
# (sort -V 는 GNU 확장이라 구버전 macOS BSD sort 등에서 미지원일 수 있음)
_fe_is_newer() {  # $2(원격)가 $1(로컬)보다 최신이면 0
  local IFS=.
  local -a lp=($1) rp=($2)
  local i l r
  for i in 0 1 2; do
    l="${lp[i]:-0}"; r="${rp[i]:-0}"
    if (( 10#$r > 10#$l )); then return 0; fi
    if (( 10#$r < 10#$l )); then return 1; fi
  done
  return 1
}
_fe_update_check() {
  [ -n "${FE_RAIL_NO_UPDATE_CHECK:-}" ] && return 0
  [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local pj="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
  [ -f "$pj" ] || return 0
  local local_ver; local_ver=$(_fe_semver < "$pj")
  [ -n "$local_ver" ] || return 0

  local cache="$HOME/.claude/fe-rail-version-check.cache"
  mkdir -p "$(dirname "$cache")" 2>/dev/null || return 0
  local url="https://raw.githubusercontent.com/sh5623/fe-rail/main/.claude-plugin/plugin.json"

  # 하루 1회만 원격 조회
  local stale=1 last now
  if [ -f "$cache" ]; then
    last=$(stat -f "%m" "$cache" 2>/dev/null || stat -c "%Y" "$cache" 2>/dev/null)
    now=$(date +%s 2>/dev/null)
    [ -n "$last" ] && [ -n "$now" ] && [ $((now - last)) -le 86400 ] && stale=0
  fi
  if [ "$stale" = 1 ]; then
    local raw ver
    raw=$(curl -sf --max-time 5 "$url" 2>/dev/null)
    ver=$(printf '%s' "$raw" | _fe_semver)
    [ -n "$ver" ] && printf '%s' "$ver" > "$cache"
  fi

  local remote_ver; remote_ver=$(cat "$cache" 2>/dev/null)
  case "$remote_ver" in
    [0-9]*.[0-9]*.[0-9]*) ;;   # x.y.z 형태일 때만 비교
    *) return 0 ;;
  esac
  # 원격이 로컬보다 "더 최신일 때만" 안내한다. 단순 != 비교는 로컬이 앞선 개발 체크아웃에서
  # 다운그레이드를 새 버전으로 오인해 매 세션 오보를 낸다.
  if [ "$remote_ver" != "$local_ver" ] && _fe_is_newer "$local_ver" "$remote_ver"; then
    echo "[fe-rail] 새 버전 v${remote_ver} 이 있습니다 (현재 v${local_ver})"
    echo "[fe-rail] 업데이트: /plugin update fe-rail@fe-rail-market"
  fi
}
_fe_update_check

# [fe-rail] 훅 프로파일 안내 — 기본(standard)이 아니거나 비활성 훅이 설정돼 있으면 알린다.
#   제어: FE_RAIL_HOOK_PROFILE(minimal|standard|strict) · FE_RAIL_DISABLED_HOOKS="a,b"
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
if [ -f "$_FE_PLIB" ]; then
  . "$_FE_PLIB"
  _FE_PROF=$(fe_active_profile)
  if [ "$_FE_PROF" != "standard" ] || [ -n "$FE_RAIL_DISABLED_HOOKS" ]; then
    echo "[fe-rail][session] 훅 프로파일: ${_FE_PROF}${FE_RAIL_DISABLED_HOOKS:+ · 비활성: ${FE_RAIL_DISABLED_HOOKS}}" >&2
  fi
fi

# 제품 코드 변경 확인 안내(v1.22.0) — 이 한 줄만 stdout(= 세션 컨텍스트)으로 낸다. 종료 훅(test-verify)이 켜져 있고
#   git + package.json 프로젝트일 때만. 종료 전에 Claude 가 스스로 확인하게 해 차단 왕복을 줄인다. 상세: docs/test-verify.md §10
if command -v fe_hook_enabled >/dev/null 2>&1 && fe_hook_enabled "test-verify" "standard"; then
  _FE_TOP="$(git rev-parse --show-toplevel 2>/dev/null)"
  if [ -n "$_FE_TOP" ] && { [ -f "$_FE_TOP/package.json" ] || [ -f "package.json" ]; }; then
    echo "[fe-rail] JS·TS 제품 코드를 고친 턴은 끝내기 전에, 그 수정이 보장하려는 동작을 깨뜨렸을 때 그 동작을 지키는 테스트(고치지 않은 기존 테스트 포함)가 실패하는지 \`fe-rail verify-test base --only <소스> --test \"<케이스>\" --intent \"<깨뜨린 동작>\" -- <테스트>\`(결함 수정) 또는 \`mutate\`(새 기능 · 섞인 수정)로 확인하고 \`fe-rail verify-test report\` 줄을 요약하지 말고 그대로 답변에 싣는다(줄마다 깨뜨린 동작 · 케이스 · 관측값 · 판정). 동작 변화가 없거나 작업 중이면 마지막 줄에 \`테스트 확인: 생략 — <이유>\` — 둘 다 없으면 종료 훅이 한 번 막는다."
  fi
fi

# 권장 Bash 권한 미설정 안내 (소비자 프로젝트 기준). 이미 설정됐거나 opt-out 이면 조용히 넘어간다.
# - SessionStart 훅은 비대화형이라 설치/선택은 못 하고 1회 안내만 한다.
# - 실제 설정: hooks/scripts/setup-permissions.sh (호스트 감지 → settings.local.json 병합).
# - MCP 는 훅에서 연결 여부를 알 수 없어 여기서 다루지 않는다 → 각 에이전트가 사용 시점에 JIT 안내.
if [ -z "${FE_RAIL_SKIP_SETUP_NUDGE:-}" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  _FE_PROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  _FE_SETUP="${CLAUDE_PLUGIN_ROOT}/hooks/scripts/setup-permissions.sh"
  case "$_FE_SETUP/" in
    "$_FE_PROOT"/*) : ;;  # 플러그인이 프로젝트 안 = 이 저장소 자체(개발 체크아웃) → 넛지 생략
    *)
      _FE_HAS_PERM=0
      for _f in "$_FE_PROOT/.claude/settings.local.json" "$_FE_PROOT/.claude/settings.json"; do
        [ -f "$_f" ] && grep -q '"Bash(git' "$_f" 2>/dev/null && _FE_HAS_PERM=1
      done
      if [ "$_FE_HAS_PERM" -eq 0 ]; then
        echo "[fe-rail][session] 권장 Bash 권한이 설정돼 있지 않습니다 — PR 단계에서 매번 권한 프롬프트가 뜹니다." >&2
        echo "[fe-rail][session] 설정: bash \"$_FE_SETUP\" (끄기: FE_RAIL_SKIP_SETUP_NUDGE=1)" >&2
      fi
      ;;
  esac
fi

exit 0
