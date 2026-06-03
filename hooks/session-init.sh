#!/bin/bash
# [fe-rail] session-init.sh — SessionStart
# 원격 버전 체크 (하루 1회). 무소음 원칙: 정상 상태는 무출력.

[ -z "$CLAUDE_PLUGIN_ROOT" ] && exit 0

PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
[ ! -f "$PLUGIN_JSON" ] && exit 0

PLUGIN_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON" | head -1 \
                 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

[ -z "$PLUGIN_VERSION" ] && exit 0

# 원격 버전 체크 (GitHub, 하루 1회)
REMOTE_CHECK_CACHE="$HOME/.claude/fe-rail-version-check.cache"
REMOTE_URL="https://raw.githubusercontent.com/sh5623/fe-rail/main/.claude-plugin/plugin.json"

_is_stale() {
  [ ! -f "$1" ] && return 0
  local last now
  last=$(stat -f "%m" "$1" 2>/dev/null || stat -c "%Y" "$1" 2>/dev/null)
  now=$(date +%s)
  [ $((now - last)) -gt 86400 ] && return 0
  return 1
}

if _is_stale "$REMOTE_CHECK_CACHE"; then
  REMOTE_RAW=$(curl -sf --max-time 5 "$REMOTE_URL" 2>/dev/null)
  if [ -n "$REMOTE_RAW" ]; then
    REMOTE_VER=$(printf '%s' "$REMOTE_RAW" \
      | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
      | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
    [ -n "$REMOTE_VER" ] && printf '%s' "$REMOTE_VER" > "$REMOTE_CHECK_CACHE"
  fi
fi

REMOTE_VER=$(cat "$REMOTE_CHECK_CACHE" 2>/dev/null)
if [ -n "$REMOTE_VER" ] && [ -n "$PLUGIN_VERSION" ] && [ "$REMOTE_VER" != "$PLUGIN_VERSION" ]; then
  echo "[fe-rail] 새 버전 v${REMOTE_VER} 이 있습니다 (현재 v${PLUGIN_VERSION})"
  echo "[fe-rail] 업데이트: /plugin update fe-rail@fe-rail-market"
fi

exit 0
