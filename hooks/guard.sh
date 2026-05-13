#!/bin/bash
# [fe-rail] guard.sh — PreToolUse:Bash
# 비가역적 위험 명령어를 차단합니다. exit 2 = 도구 실행 차단.

# 명령어 추출: TOOL_INPUT_COMMAND 우선, fallback으로 TOOL_INPUT JSON 파싱
CMD="${TOOL_INPUT_COMMAND}"
if [ -z "$CMD" ] && [ -n "$TOOL_INPUT" ]; then
  CMD=$(echo "$TOOL_INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
        | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

# 명령어가 비어 있으면 통과
[ -z "$CMD" ] && exit 0

# ─── 차단 패턴 9개 ───────────────────────────────────────────────────────────

# 1. git add . / git add -A / git add --all
if echo "$CMD" | grep -qE 'git[[:space:]]+add[[:space:]]+(-A|--all|\.)([[:space:]]|$)'; then
  echo "[fe-rail] BLOCKED: 'git add .' / 'git add -A' 금지. 파일을 명시적으로 지정하세요."
  exit 2
fi

# 2. git push --force / --force-with-lease / -f
if echo "$CMD" | grep -qE 'git[[:space:]]+push[[:space:]].*(--force|--force-with-lease|-f)([[:space:]]|$)'; then
  echo "[fe-rail] BLOCKED: force push 금지. 원격 히스토리가 손상됩니다."
  exit 2
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
