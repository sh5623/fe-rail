#!/bin/bash
# [fe-rail] config-protection.sh — PreToolUse:Write|Edit|MultiEdit
# 린터/포매터/TS 설정 파일의 "약화(weakening)" 편집만 차단한다. exit 2 = 도구 실행 차단.
#
# 정책: fe-rail 은 "위험은 차단, 품질은 경고" 원칙이며 설정 파일 편집을 *전면* 막지 않는다.
#   경로 alias 추가·플러그인 추가 같은 정상 편집은 통과시키고,
#   품질 게이트를 무력화하는 편집(타입 strict 해제·recommended 룰셋 off·@ts-nocheck)만 차단한다.
#   → 에이전트가 "설정을 약화해 오류를 없애는" 우회를 막고 코드를 고치게 유도한다.
#   (guard.sh 가 `--no-verify` 로 훅 자체를 우회하는 것을 막듯, 이 훅은 설정 약화 우회를 막는다.)
#
# 대상 설정 파일: tsconfig*.json · eslint 설정 · biome.json(c)
#   (prettier 는 포맷 전용이라 "약화" 신호가 없어 대상에서 제외)
#
# 판정 단위는 «편집 조각» 이 아니라 «파일 전체의 편집 전 ↔ 후» 다. 조각만 보면 `old_string:"true" →
# new_string:"false"` 처럼 값만 바꾸는 Edit 과 strict 키를 통째로 빼고 덮어쓰는 Write 를 놓친다
# (2026-09 교차 리뷰 재현: 둘 다 exit 0). 파일이 디스크에 있으면 실제 내용에 편집을 적용한 결과를
# 만들어 비교하고, 없으면(신규 생성·fixture) 조각 자체를 전/후로 쓴다.

# [fe-rail] 프로파일/비활성 토글 (profile-lib.sh; 없으면 fail-open)
_FE_PLIB="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/profile-lib.sh"
[ -f "$_FE_PLIB" ] && . "$_FE_PLIB" && ! fe_hook_enabled "config-protection" "minimal" && exit 0

HOOK_INPUT=$(cat)

# ── 입력 추출 (jq 우선, 없으면 grep/raw 폴백) ────────────────────────────────
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
  # 편집 후 텍스트: Write=content, Edit=new_string, MultiEdit=edits[].new_string 를 모두 합침
  NEW_TEXT=$(printf '%s' "$HOOK_INPUT" | jq -r '
    [ .tool_input.content, .tool_input.new_string, (.tool_input.edits[]?.new_string) ]
    | map(select(. != null)) | join("\n")' 2>/dev/null)
  # 편집 전 텍스트: Edit=old_string, MultiEdit=edits[].old_string (약화 "제거" 감지용)
  OLD_TEXT=$(printf '%s' "$HOOK_INPUT" | jq -r '
    [ .tool_input.old_string, (.tool_input.edits[]?.old_string) ]
    | map(select(. != null)) | join("\n")' 2>/dev/null)
else
  FILE_PATH=$(printf '%s' "$HOOK_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
              | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
  # jq 미설치: 구조 분리를 못하므로 raw 입력 전체를 편집후 텍스트로 간주(약화 토큰은 어차피 원문에 존재)
  NEW_TEXT="$HOOK_INPUT"
  OLD_TEXT=""
fi
FILE_PATH="${FILE_PATH:-${TOOL_INPUT_FILE_PATH}}"

[ -z "$FILE_PATH" ] && exit 0

BASE=$(basename "$FILE_PATH")

# 차단 사유는 stderr 로 출력한다 (exit 2 시 stderr 만 모델에 피드백됨).
block() {
  {
    echo "[fe-rail] BLOCKED [config-protection]: 설정 약화 편집이 감지되었습니다 — $BASE"
    echo "[fe-rail]   사유: $1"
    echo "[fe-rail]   품질 게이트(타입/린트)를 무력화하는 대신 코드를 수정하세요."
    echo "[fe-rail]   의도적 설정 변경이라면 에이전트가 아니라 직접(수동) 편집하세요."
  } >&2
  exit 2
}

# 1) 소스 파일에서 @ts-nocheck 검사 (파일 전체 타입체크 무력화 방지)
#    tsconfig 등 "설정 파일"이 아니라 .ts/.tsx/.js/.jsx 소스 상단에 오는 지시어라
#    아래 IS_CONFIG 조기 종료보다 먼저 검사해야 한다.
case "$BASE" in
  *.ts|*.tsx|*.js|*.jsx)
    printf '%s\n' "$NEW_TEXT" | grep -qE '@ts-nocheck' && block "@ts-nocheck (파일 전체 타입체크 비활성화)"
    ;;
esac

# ── 대상 설정 파일인가? (basename 기준) ──────────────────────────────────────
IS_CONFIG=0
case "$BASE" in
  tsconfig.json|tsconfig.*.json) IS_CONFIG=1 ;;                                                               # TypeScript
  .eslintrc|.eslintrc.*|eslint.config.js|eslint.config.mjs|eslint.config.cjs|eslint.config.ts) IS_CONFIG=1 ;; # ESLint
  biome.json|biome.jsonc) IS_CONFIG=1 ;;                                                                      # Biome
esac
[ "$IS_CONFIG" -eq 0 ] && exit 0

# ── 편집 전 ↔ 후 «파일 전체» 재구성 ─────────────────────────────────────────
PRE=""; POST=""
if [ -f "$FILE_PATH" ] && command -v jq >/dev/null 2>&1; then
  PRE=$(cat "$FILE_PATH"; printf x); PRE=${PRE%x}
  TOOL_NAME=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
  if [ "$TOOL_NAME" = "Write" ] || printf '%s' "$HOOK_INPUT" | jq -e '.tool_input.content != null' >/dev/null 2>&1; then
    POST=$(printf '%s' "$HOOK_INPUT" | jq -j '.tool_input.content // ""' 2>/dev/null)
  else
    # Edit(old/new 1쌍) 또는 MultiEdit(edits[]) 를 순서대로 실제 내용에 적용한다.
    # 치환은 awk + ENVIRON 으로 — 정규식·백슬래시·`&` 를 해석하지 않는 순수 문자열 치환(bash 3.2 호환).
    POST="$PRE"
    EDITS=$(printf '%s' "$HOOK_INPUT" | jq -c '
      if .tool_input.edits then .tool_input.edits[] | {o:(.old_string//""), n:(.new_string//""), a:(.replace_all//false)}
      elif .tool_input.old_string != null then {o:.tool_input.old_string, n:(.tool_input.new_string//""), a:(.tool_input.replace_all//false)}
      else empty end' 2>/dev/null)
    while IFS= read -r e; do
      [ -z "$e" ] && continue
      o=$(printf '%s' "$e" | jq -j '.o'); n=$(printf '%s' "$e" | jq -j '.n'); a=$(printf '%s' "$e" | jq -r '.a')
      POST=$(CONTENT="$POST" OLD="$o" NEW="$n" ALL="$a" awk 'BEGIN{
        s=ENVIRON["CONTENT"]; o=ENVIRON["OLD"]; n=ENVIRON["NEW"]; all=(ENVIRON["ALL"]=="true"); out=""
        if (length(o)==0) { printf "%s", s; exit }
        while ((i=index(s,o))>0) { out=out substr(s,1,i-1) n; s=substr(s,i+length(o)); if (!all) break }
        printf "%s", out s }')
    done <<< "$EDITS"
  fi
else
  # 파일 없음(신규 생성) 또는 jq 없음 → 조각 기준(종전 동작)
  PRE="$OLD_TEXT"; POST="$NEW_TEXT"
fi

# ── 약화 신호 검사 (전 ↔ 후 의미 비교) ───────────────────────────────────────
# ["']? 로 따옴표를 선택적으로 허용 — JSON(`"strict":false`)·JS flat config(무따옴표/홑따옴표 키) 모두 매칭.
# \b 는 대상 단어 자체의 경계(예: "strict" 가 "unstrict" 의 일부로 오탐되지 않도록).
# 계수 비교(후 > 전)라서 «이미 false 인 옵션이 있는 파일의 무관한 편집» 은 통과한다.
_weak_count() { printf '%s\n' "$1" | grep -cE "[\"']?\\b(strict|noImplicitAny|strictNullChecks|strictFunctionTypes|strictBindCallApply|noImplicitThis|alwaysStrict)\\b[\"']?[[:space:]]*:[[:space:]]*false"; }
_rec_count()  { printf '%s\n' "$1" | grep -cE "[\"']?\\brecommended\\b[\"']?[[:space:]]*:[[:space:]]*false"; }
_strict_true(){ printf '%s\n' "$1" | grep -qE "[\"']?\\bstrict\\b[\"']?[[:space:]]*:[[:space:]]*true"; }

# 2) TypeScript strict 계열 플래그를 false 로 설정 (새로 생김)
[ "$(_weak_count "$POST")" -gt "$(_weak_count "$PRE")" ] && block "TypeScript strict 계열 옵션을 false 로 설정"

# 3) 린터 recommended 룰셋 통째로 off (ESLint/Biome 공통 약화 신호)
[ "$(_rec_count "$POST")" -gt "$(_rec_count "$PRE")" ] && block "린터 recommended 룰셋 비활성화"

# 4) strict:true 를 제거/뒤집기 (편집 전엔 있었는데 편집 후 사라짐 — 값만 바꾸는 Edit·키를 뺀 Write 포함)
if _strict_true "$PRE" && ! _strict_true "$POST"; then
  block "기존 \"strict\": true 를 제거/변경"
fi

exit 0
