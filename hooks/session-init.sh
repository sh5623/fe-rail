#!/bin/bash
# [fe-rail] session-init.sh — SessionStart
# 플러그인 버전 체크 + 캐시 자동 동기화. 무소음 원칙: 정상 상태는 무출력.

PROFILE_JSON=".claude/profile.json"
LOCAL_MD=".claude/fe-rail.local.md"
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT:-.}/.claude-plugin/plugin.json"
CACHE_BASE="$HOME/.claude/plugins/cache/fe-rail-market/fe-rail"

[ -z "$CLAUDE_PLUGIN_ROOT" ] && exit 0

# profile.json 없으면 첫 실행 안내
if [ ! -f "$PROFILE_JSON" ]; then
  echo "[fe-rail] /fe-rail:fe-spec 으로 스펙부터 시작할 수 있습니다"
  exit 0
fi

[ ! -f "$PLUGIN_JSON" ] && exit 0

# 현재 플러그인 버전 추출
PLUGIN_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_JSON" | head -1 \
                 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

[ -z "$PLUGIN_VERSION" ] && exit 0

# 캐시 디렉토리가 존재하면 동기화 검사
if [ -d "$CACHE_BASE" ]; then
  CACHE_VERSION=""
  CACHE_DIR=""

  # 하위 디렉토리 순회 — 마지막으로 발견된 캐시 버전 보관
  for dir in "$CACHE_BASE"/*/; do
    [ -d "$dir" ] || continue
    v=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$dir/.claude-plugin/plugin.json" 2>/dev/null \
        | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
    if [ -n "$v" ]; then
      CACHE_VERSION="$v"
      CACHE_DIR="$dir"
    fi
  done

  if [ -n "$CACHE_DIR" ]; then
    if [ "$CACHE_VERSION" != "$PLUGIN_VERSION" ]; then
      # 버전 불일치 → 즉시 동기화
      rsync -a --delete \
        --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
        "$CLAUDE_PLUGIN_ROOT/" "$CACHE_DIR"
      # 새 버전 디렉토리도 생성·동기화
      mkdir -p "$CACHE_BASE/$PLUGIN_VERSION"
      rsync -a --delete \
        --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
        "$CLAUDE_PLUGIN_ROOT/" "$CACHE_BASE/$PLUGIN_VERSION/"
      echo "[fe-rail] v${CACHE_VERSION} → v${PLUGIN_VERSION} 동기화 완료"
    else
      # 버전 일치 → mtime 비교
      SRC_MTIME=$(find "$CLAUDE_PLUGIN_ROOT" -name '*.md' -o -name '*.json' -o -name '*.sh' 2>/dev/null \
                  | head -50 | xargs stat -f '%m' 2>/dev/null | sort -rn | head -1)
      CACHE_MTIME=$(find "$CACHE_DIR" -name '*.md' -o -name '*.json' -o -name '*.sh' 2>/dev/null \
                    | head -50 | xargs stat -f '%m' 2>/dev/null | sort -rn | head -1)
      if [ -n "$SRC_MTIME" ] && [ -n "$CACHE_MTIME" ] && [ "$SRC_MTIME" -gt "$CACHE_MTIME" ]; then
        rsync -a --delete \
          --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
          "$CLAUDE_PLUGIN_ROOT/" "$CACHE_DIR"
        echo "[fe-rail] 캐시 동기화 완료 (소스 변경 감지)"
      fi
    fi
  fi
fi

# LOCAL_MD 버전 체크
if [ -f "$LOCAL_MD" ]; then
  LOCAL_VERSION=$(awk '/^version:/{print $2; exit}' "$LOCAL_MD")
  if [ -n "$LOCAL_VERSION" ] && [ "$LOCAL_VERSION" != "$PLUGIN_VERSION" ]; then
    echo "[fe-rail] CLAUDE.md 재생성이 필요할 수 있습니다"
  fi
fi

exit 0
