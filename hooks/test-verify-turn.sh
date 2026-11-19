#!/bin/bash
# [fe-rail] test-verify-turn.sh — UserPromptSubmit
# 턴 시작 상태(HEAD + 미커밋 파일별 내용 해시)를 세션별로 기록한다(.git 안 · 추적 안 됨). 출력 없음 · 차단 없음.
# 종료 훅(test-verify-stop.sh)이 «이번 턴에 바뀐 파일» 을 구할 때 쓴다. 상세: docs/test-verify.md
# 끄기: FE_RAIL_DISABLED_HOOKS="test-verify" (두 훅이 같은 이름을 쓴다) 또는 FE_RAIL_HOOK_PROFILE=minimal

_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "test-verify" "standard" && exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/bin/fe-rail.mjs" hook turn-start
