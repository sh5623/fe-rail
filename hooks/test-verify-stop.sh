#!/bin/bash
# [fe-rail] test-verify-stop.sh — Stop
# 이번 턴에 바뀐 단위 테스트를 «수정 전 코드에서 실제로 실패하는가» 로 확인한 기록이 없으면 종료를 한 번 막고
# 실행기 명령(fe-rail verify-test)을 지시한다. 두 번째 종료는 막지 않는다(stop_hook_active).
# 판단할 수 없으면 막지 않는다: git 아님 · 턴 기록 없음 · 러너를 모름 · 적용 관계를 모름 · 검증되지 않은 조합(알림만) ·
# 바뀐 테스트가 상한(FE_RAIL_VERIFY_MAX_TESTS, 기본 10)을 넘음(알림만). 상세: docs/test-verify.md
# 끄기: FE_RAIL_DISABLED_HOOKS="test-verify" 또는 FE_RAIL_HOOK_PROFILE=minimal

_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "test-verify" "standard" && exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/bin/fe-rail.mjs" hook stop
