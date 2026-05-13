#!/bin/bash
# [fe-rail] doc-sync-check.sh — Stop
# hooks/ skills/ agents/ 하위 파일 변경이 감지되면 CLAUDE.md / README.md 업데이트를 제안합니다.
# 차단 없음(exit 0).

CHANGED=$(git diff HEAD --name-only 2>/dev/null \
  | grep -E '^(hooks/|skills/|agents/)' \
  | grep -vE '(CLAUDE\.md|README\.md)$' \
  | head -10)

[ -z "$CHANGED" ] && exit 0

COUNT=$(echo "$CHANGED" | wc -l | tr -d ' ')
FILES=$(echo "$CHANGED" | head -5 | sed 's/^/    /')

echo "[fe-rail][doc-sync] 플러그인 구조 변경 감지 (${COUNT}개 파일):"
echo "$FILES"
echo "[fe-rail][doc-sync] CLAUDE.md / README.md 업데이트가 필요할 수 있습니다."
echo "[fe-rail][doc-sync] → /fe-rail:fe-doc-sync 를 실행하면 변경 내용을 분석하고 수정안을 제안합니다."

exit 0
