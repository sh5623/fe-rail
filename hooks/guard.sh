#!/bin/bash
# [fe-rail] guard.sh — PreToolUse:Bash
# 비가역적 위험 명령어를 차단합니다. exit 2 = 도구 실행 차단.

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "guard" "minimal" && exit 0

# Claude Code 는 hook 입력을 stdin JSON 으로 전달한다.
# 환경변수 fallback 은 로컬 테스트 전용 — 실제 실행 시에는 stdin 이 사용된다.
HOOK_INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  CMD=$(printf '%s' "$HOOK_INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
        | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi
CMD="${CMD:-${TOOL_INPUT_COMMAND}}"

[ -z "$CMD" ] && exit 0

# ─── 차단 패턴 ───────────────────────────────────────────────────────────────

# 1. git add . / git add -A / git add --all
if echo "$CMD" | grep -qE 'git[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$)'; then
  echo "[fe-rail] BLOCKED: 'git add .' / 'git add -A' 금지. 파일을 명시적으로 지정하세요."
  exit 2
fi

# 2. git push --force / -f  (--force-with-lease 는 안전하므로 허용)
# allowlist 체크는 git push 호출 자체에만 적용 —
# "git push --force && echo '--force-with-lease'" 같은 연결 명령 우회 방지
if echo "$CMD" | grep -qE 'git[[:space:]]+push[[:space:]].*(--force|-f)([[:space:];&|]|$)'; then
  PUSH_INVOC=$(echo "$CMD" | grep -oE 'git[[:space:]]+push[^;&|`$]*' | head -1)
  if ! echo "$PUSH_INVOC" | grep -qF -- '--force-with-lease'; then
    echo "[fe-rail] BLOCKED: force push 금지. 원격 히스토리가 손상됩니다. (--force-with-lease 는 허용)"
    exit 2
  fi
fi

# 3. git commit --no-verify
if echo "$CMD" | grep -qE 'git[[:space:]]+commit[[:space:]].*--no-verify'; then
  echo "[fe-rail] BLOCKED: '--no-verify' 금지. 린트 오류를 수정하세요."
  exit 2
fi

# 4. git stash drop / git stash clear
if echo "$CMD" | grep -qE 'git[[:space:]]+stash[[:space:]]+(drop|clear)'; then
  echo "[fe-rail] BLOCKED: 'git stash drop/clear' 금지. 작업 내용이 영구 손실됩니다."
  exit 2
fi

# 5. yarn/npm/pnpm publish
if echo "$CMD" | grep -qE '(yarn|npm|pnpm)[[:space:]]+publish'; then
  echo "[fe-rail] BLOCKED: 패키지 배포 금지. 수동으로 실행하세요."
  exit 2
fi

# 6. rm -rf / rm -fr 루트·홈 디렉토리
if echo "$CMD" | grep -qE 'rm[[:space:]]+(-rf|-fr)[[:space:]]+(/|~|\$HOME)([[:space:]]|$)'; then
  echo "[fe-rail] BLOCKED: 루트/홈 디렉토리 삭제 금지."
  exit 2
fi

# 7. DROP TABLE / DROP DATABASE (대소문자 무시)
if echo "$CMD" | grep -iqE 'DROP[[:space:]]+(TABLE|DATABASE)'; then
  echo "[fe-rail] BLOCKED: DROP TABLE/DATABASE 금지. 수동으로 실행하세요."
  exit 2
fi

# 8. git reset --hard
if echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  echo "[fe-rail] BLOCKED: 'git reset --hard' 금지. 변경사항이 손실됩니다."
  exit 2
fi

# 9. git checkout . / git restore .
if echo "$CMD" | grep -qE 'git[[:space:]]+(checkout|restore)[[:space:]]+\.([[:space:]]|$)'; then
  echo "[fe-rail] BLOCKED: 모든 변경사항 되돌리기 금지. 파일을 명시적으로 지정하세요."
  exit 2
fi

exit 0
