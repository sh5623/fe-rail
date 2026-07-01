#!/bin/bash
# [fe-rail] doc-sync-check.sh — Stop
# 사용자 프로젝트(이 플러그인이 설치된 프로젝트)의 코드 구조·의존성 변경이
# 감지되면 fe-doc-sync 실행을 안내합니다. 차단 없음(exit 0).
#
# 트리거 디렉토리:
#   - src/ app/ pages/ components/ hooks/ lib/ services/ stores/ api/ features/
#   - apps/ packages/ docs/   (모노레포)
# 트리거 파일:
#   - package.json (의존성·scripts 변경)
#   - tsconfig*.json next.config.* vite.config.* tailwind.config.* (설정 변경)
#   - .env.example (환경 변수 키 변경)
# 제외:
#   - CLAUDE.md / README.md (스킬이 수정하는 대상)
#   - node_modules / .next / dist / build / .git
#
# 워킹트리 변경 + 최근 5개 커밋의 변경 파일을 합집합으로 검사
# (커밋 직후에도 한 번은 안내되도록).

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "doc-sync-check" "standard" && exit 0

CHANGED=$(
  {
    git diff HEAD --name-only 2>/dev/null
    git log --name-only --pretty=format: -5 2>/dev/null
  } \
  | grep -vE '^(node_modules|\.next|dist|build|\.git)/' \
  | grep -E '^(src/|app/|pages/|components/|hooks/|lib/|services/|stores/|api/|features/|apps/|packages/|docs/)|^(package\.json|tsconfig.*\.json|next\.config\.|vite\.config\.|tailwind\.config\.|\.env\.example)$' \
  | grep -vE '(CLAUDE\.md|README\.md)$' \
  | sort -u \
  | head -20
)

[ -z "$CHANGED" ] && exit 0

COUNT=$(echo "$CHANGED" | wc -l | tr -d ' ')
FILES=$(echo "$CHANGED" | head -5 | sed 's/^/    /')

echo "[fe-rail][doc-sync] 프로젝트 구조·의존성 변경 감지 (${COUNT}개 파일):"
echo "$FILES"
echo "[fe-rail][doc-sync] CLAUDE.md / README.md 업데이트가 필요할 수 있습니다."
echo "[fe-rail][doc-sync] → /fe-rail:fe-doc-sync 가 프로젝트 전반을 스캔해 누락·불일치를 분석하고 수정안을 제안합니다."

exit 0
