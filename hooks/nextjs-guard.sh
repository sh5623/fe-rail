#!/bin/bash
# [fe-rail] nextjs-guard.sh — PostToolUse:Edit|Write|MultiEdit
# Next.js RSC 경계 위반(훅·브라우저 API·DOM 이벤트)을 감지합니다. 차단 없음(exit 0).

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "nextjs-guard" "standard" && exit 0

HOOK_INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
else
  FILE_PATH=$(printf '%s' "$HOOK_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
              | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi
FILE_PATH="${FILE_PATH:-${TOOL_INPUT_FILE_PATH}}"

[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

# Next.js 프로젝트만 대상 — next.config.* 를 «파일에서 가장 가까운 package.json»(패키지 루트)에서 먼저,
# 없으면 Git 루트에서 찾는다(apps/web 에만 next.config 가 있는 모노레포는 Git 루트만 보면 무출력).
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$LIB_DIR/scripts/lint-lib.sh" ] && . "$LIB_DIR/scripts/lint-lib.sh"
command -v fe_pkg_root >/dev/null 2>&1 || fe_pkg_root() { printf '%s\n' "$2"; }
GIT_ROOT=$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel 2>/dev/null || pwd)
PKG_ROOT=$(fe_pkg_root "$(cd "$(dirname "$FILE_PATH")" && pwd)" "$GIT_ROOT")
NEXT_ROOT=""
for root in "$PKG_ROOT" "$GIT_ROOT"; do
  for cfg in next.config.js next.config.ts next.config.mjs; do
    [ -f "$root/$cfg" ] && NEXT_ROOT="$root" && break 2
  done
done
[ -z "$NEXT_ROOT" ] && exit 0

# App Router 인가 — RSC 규칙은 app/ (또는 src/app/) 이 있을 때만 성립한다. pages/ 만 있는 프로젝트
# (Pages Router)에는 Server Component 가 없으므로 종료. (next 의존성만으로 App Router 를 단정하지 않는다)
APP_ROUTER=0
for d in app src/app; do [ -d "$NEXT_ROOT/$d" ] && APP_ROUTER=1 && break; done
[ "$APP_ROUTER" -eq 0 ] && exit 0

# .tsx / .jsx 만 대상
case "$FILE_PATH" in
  *.tsx|*.jsx) ;;
  *) exit 0 ;;
esac

WARNINGS=""

# 'use client' 여부 확인 (첫 40줄 — 긴 라이선스 헤더가 앞에 와도 지시어를 놓치지 않도록)
USE_CLIENT=0
if head -40 "$FILE_PATH" | grep -qE "^[[:space:]]*['\"]use client['\"]"; then
  USE_CLIENT=1
fi

# ── Case 1: 'use client' 없는 파일에서 클라이언트 전용 API 사용 ──────────────
# 이 훅은 import 경계를 추적하지 못한다. Next 는 'use client' 경계 «아래» 에서 import 된 모듈을 자동으로
# 클라이언트 번들에 넣으므로, 이미 Client Component 의 자식으로만 쓰이는 파일에는 지시어가 필요 없다.
# 그래서 «추가 필요» 로 단정하지 않고 «경계 확인 필요» 로 알린다 — 확정 근거는 `next build` 진단이다.
if [ "$USE_CLIENT" -eq 0 ]; then

  # 그룹 1: 클라이언트 훅 (useMemo/useCallback/useId/use 는 RSC에서 안전하므로 제외)
  HOOK_MATCHES=$(grep -nE '\b(useState|useEffect|useRef|useContext|useReducer|useLayoutEffect|useImperativeHandle|useTransition|useDeferredValue|useOptimistic|useSyncExternalStore)[[:space:]]*\(' "$FILE_PATH" 2>/dev/null | head -3)
  if [ -n "$HOOK_MATCHES" ]; then
    WARNINGS="${WARNINGS}  [RSC] 클라이언트 훅 사용, 'use client' 없음 — Server Component 가 이 파일을 직접 import 하면 지시어가 필요하고, 'use client' 컴포넌트 아래에서만 import 되면 불필요. import 경계를 확인하라(확정 근거: next build):\n"
    while IFS= read -r line; do
      WARNINGS="${WARNINGS}    $line\n"
    done <<< "$HOOK_MATCHES"
  fi

  # 그룹 2: 브라우저 API
  BROWSER_MATCHES=$(grep -nE '\b(window\.|document\.|localStorage|sessionStorage|navigator\.|addEventListener[[:space:]]*\()' "$FILE_PATH" 2>/dev/null | head -3)
  if [ -n "$BROWSER_MATCHES" ]; then
    WARNINGS="${WARNINGS}  [RSC] 브라우저 API 사용, 'use client' 없음 — Server Component 라면 'use client' 또는 useEffect 내부로 이동, 클라이언트 경계 아래면 무관. 경계 확인 필요:\n"
    while IFS= read -r line; do
      WARNINGS="${WARNINGS}    $line\n"
    done <<< "$BROWSER_MATCHES"
  fi

  # 그룹 3: DOM 이벤트 props
  EVENT_MATCHES=$(grep -nE 'on(Click|Change|Submit|KeyDown|KeyUp|Blur|Focus|MouseOver|MouseEnter|Input|Scroll|Wheel)[[:space:]]*=' "$FILE_PATH" 2>/dev/null | head -3)
  if [ -n "$EVENT_MATCHES" ]; then
    WARNINGS="${WARNINGS}  [RSC] DOM 이벤트 핸들러, 'use client' 없음 — Server Component 라면 Client Component 로 분리, 클라이언트 경계 아래면 무관. 경계 확인 필요:\n"
    while IFS= read -r line; do
      WARNINGS="${WARNINGS}    $line\n"
    done <<< "$EVENT_MATCHES"
  fi
fi

# ── Case 2: app router page/layout 에 'use client' ────────────────────────
if [ "$USE_CLIENT" -eq 1 ]; then
  IS_PAGE_LAYOUT=0
  case "$FILE_PATH" in
    */app/page.tsx|*/app/page.jsx|*/app/layout.tsx|*/app/layout.jsx|\
    */app/*/page.tsx|*/app/*/page.jsx|*/app/*/layout.tsx|*/app/*/layout.jsx|\
    */app/**/page.tsx|*/app/**/page.jsx|*/app/**/layout.tsx|*/app/**/layout.jsx)
      IS_PAGE_LAYOUT=1
      ;;
  esac
  if [ "$IS_PAGE_LAYOUT" -eq 1 ]; then
    WARNINGS="${WARNINGS}  [App Router] page/layout 에 'use client' — 클라이언트 로직은 내부 컴포넌트로 분리 권장 (RSC + Streaming 손실)\n"
  fi
fi

# ── 경고 출력 ────────────────────────────────────────────────────────────────
if [ -n "$WARNINGS" ]; then
  printf "[fe-rail][nextjs-guard] %s\n" "$FILE_PATH" >&2
  printf "%b" "$WARNINGS" >&2
fi

exit 0
