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
  # jq 미설치: 구조 분리를 못하므로 raw 입력 전체를 검사 대상으로 삼는다.
  # (grep 로 "command" 값만 뽑으면 따옴표 포함 명령이 중간에서 잘려 뒷부분이 미검사되므로,
  #  안전 방향인 "전체 검사"를 택한다 — 오탐이 늘 수 있으나 위험 명령 누락보다 낫다.)
  CMD="$HOOK_INPUT"
fi
CMD="${CMD:-${TOOL_INPUT_COMMAND}}"

[ -z "$CMD" ] && exit 0

# ─── git 전역 옵션 정규화 ────────────────────────────────────────────────────
# `git -C <dir> reset --hard` · `git -c k=v commit -n` · `git --git-dir=x push --force` 처럼 서브커맨드
# 앞에 전역 옵션이 오면 아래 `git[[:space:]]+<sub>` 패턴이 전부 비껴간다(2026-09 교차 리뷰 재현:
# `-C` 를 붙인 reset --hard·push --force 가 exit 0). 값을 받는 옵션과 플래그형 옵션을 걷어내
# `git <sub>` 로 접은 뒤 검사한다. 원문은 CMD_RAW 에 보존한다.
_fe_git_norm() {
  local s="$1" prev="" sq="'"
  while [ "$s" != "$prev" ]; do
    prev="$s"
    s=$(printf '%s\n' "$s" | sed -E "s/git[[:space:]]+(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)([[:space:]]+|=)(\"[^\"]*\"|${sq}[^${sq}]*${sq}|[^[:space:]]+)[[:space:]]+/git /g")
    s=$(printf '%s\n' "$s" | sed -E 's/git[[:space:]]+(--no-pager|--paginate|-p|-P|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-replace-objects|--no-lazy-fetch|--no-advice|--bare)[[:space:]]+/git /g')
  done
  printf '%s\n' "$s"
}
CMD_RAW="$CMD"
CMD=$(_fe_git_norm "$CMD")

# 차단 사유는 stderr 로 출력한다.
# Claude Code 는 exit 2 시 stderr 를 모델에 피드백하므로, stdout 으로 내면 사유가 전달되지 않는다.
block() {
  echo "[fe-rail] BLOCKED: $1" >&2
  exit 2
}

# ─── 차단 패턴 ───────────────────────────────────────────────────────────────

# 1. git add . / git add -A / git add --all / git add ./
#    `.`(또는 `./`) 뒤가 공백·따옴표·행끝일 때만 차단 — `git add ./src`(범위 지정)는 통과.
#    따옴표 허용으로 `bash -c "git add ."` 래핑도 잡는다.
if echo "$CMD" | grep -qE 'git[[:space:]]+add[[:space:]]+(-A|--all|\.\/?)([[:space:]"]|$)'; then
  block "'git add .' / 'git add -A' / 'git add ./' 금지. 파일을 명시적으로 지정하세요."
fi

# 2. git push --force / -f  (--force-with-lease 는 안전하므로 허용)
#    연결 명령("git push --force-with-lease ... && git push --force ...")의 *모든* push 호출을
#    개별 검사한다 — 첫 호출만 보면(head -1) 뒤에 이어붙인 강제 푸시가 우회된다.
if echo "$CMD" | grep -qE 'git[[:space:]]+push[[:space:]].*(--force|-f)([[:space:];&|]|$)'; then
  PUSHES=$(echo "$CMD" | grep -oE 'git[[:space:]]+push[^;&|`$]*')
  while IFS= read -r inv; do
    [ -z "$inv" ] && continue
    # 경계 있는 (--force|-f) 만 매칭 — --force-with-lease 는 "-with-lease" 가 뒤따라 경계에
    # 걸리지 않으므로 자동 제외된다. `--force --force-with-lease` 처럼 둘 다 준 조합에서
    # --force-with-lease 존재만으로 안전 처리하던 우회를 없앤다.
    if echo "$inv" | grep -qE '([[:space:]]|^)(--force|-f)([[:space:];&|]|$)'; then
      block "force push 금지. 원격 히스토리가 손상됩니다. (--force-with-lease 는 허용)"
    fi
  done <<< "$PUSHES"
fi

# 3. git commit --no-verify / -n  (커밋 훅 우회)
#    `-[a-zA-Z]*n` 짧은 플래그만 공백 선행 + 트레일링 경계를 요구해 `--dry-run`·`--gpg-sign`
#    (끝 글자 n)의 부분 오탐을 막는다. `--no-verify` 는 트레일링 경계를 요구하지 않는다 —
#    이전 회귀: (.*[[:space:]])? 로 두 분기 모두에 트레일링 경계를 강제했더니
#    `git commit --no-verify;git push` 처럼 뒤에 공백 없이 다른 명령이 이어지면
#    빠져나갔다(치명적 우회). `--no-verify` 는 완전한 리터럴이라 부분매칭 위험이 없으므로
#    경계 없이 어디서든 매칭해야 우회를 막는다.
#    커밋 메시지 인수(`-m`/`--message` 의 값)만 제거해 검사한다 — `-m "... -n ..."` 같은 메시지 내용
#    오탐 방지. 종전처럼 «따옴표 안 전부» 를 지우면 `bash -c "git commit --no-verify -m fix"` 같은
#    셸 래핑의 실제 명령까지 사라져 우회됐다(2026-09 교차 리뷰 재현: exit 0).
#    v1.24.2 — 정규식 대신 셸처럼 읽는 작은 파서(awk)로 판정한다. 정규식으로는 두 방향 다 막을 수 없었다:
#    · 오탐(v1.24.0 까지): `git commit (.*)?-n` 의 `.*` 가 명령 경계를 넘어 `git commit -m x && sed -n 1p f` 처럼 뒤 명령의
#      `-n` 을 커밋 플래그로 읽었다. 메시지는 맨 `-m` 뒤만 지워 `-qm "drop the -n flag"` 도 막혔다.
#    · 우회: 묶음 가운데 n(`-nm "wip"` · `-anm`) · 따옴표로 감싼 플래그(`"-n"` · `-n""` · `-nm"wip"`) · 축약(`--no-veri`).
#      v1.24.1 의 조각 정규식은 따옴표 · 리다이렉션 안의 `;` `&` 로 나누고(`--author="a;b" -n` · `2>&1 -n`) 마지막
#      `git commit` 뒤만 봐서(`-n -m x # git commit`) 새 우회를 만들었다(보안 검토 지적).
#    파서가 하는 일: ① 따옴표 밖의 `;` `|` `&`(리다이렉션 `2>&1` · `>&2` · `&>` 은 제외) · 줄바꿈 · 주석(`#`)으로 명령 조각을
#    나누고 줄 끝 `\` 이어 쓰기는 합친다 ② 조각을 셸처럼 낱말로 나누며 따옴표를 걷는다 ③ `git`(경로 · `$(` · `(` 접두 포함)
#    다음 `commit` 이 오는 «첫» 자리부터 인수를 git 처럼 읽는다 — 짧은 묶음에서 n 이 나오면 우회, 값을 받는 c C F m t 가
#    나오면 묶음의 나머지가 값(묶음 끝이면 다음 낱말이 값), u S 는 붙은 선택 값, `--` 뒤는 경로, 값을 받는 긴 옵션은 다음
#    낱말을 건너뛴다 ④ 값으로 쓰이지 않은 낱말에 공백이 있고 git · commit 이 들어 있으면(`bash -c "…"` · `sh -c '…'`) 그 안을
#    다시 읽는다 ⑤ 명령 어디든 커밋이 있고 값이 아닌 낱말이 `--no-veri`·`--no-verif`·`--no-verify` 면 막는다(종전처럼).
#    v1.24.3 — 모르면 막는다(보안 검토 2 · 3차 지적): ⑥ 커밋 인수 중 값이 아닌 자리(낱말 첫 글자 · 짧은 묶음의 플래그 자리 ·
#    긴 옵션 이름)에 파서가 풀 수 없는 확장 — 따옴표 밖이나 큰따옴표 안의 `$` · 백틱, 따옴표 밖의 `{` `*` `?` `[`(글롭은
#    `-n` 이라는 파일로 펼쳐질 수 있다), `$'…'` · `$"…"` — 이 오면 막는다(`$'-n'` · `"$FLAG"` · `{-n,}` · `-$X` · `*`).
#    값(`-m "$MSG"` · `--author="$A"`)과 `--` 뒤 경로는 보지 않는다 ⑦ `$'…'` 은 `\'` 가 이스케이프인 별도 따옴표로 읽는다
#    ⑧ `git` 뒤 전역 옵션(`-Crepo` · `-c"k=v"` · `--git-dir x` …)을 건너뛰고 하위 명령을 찾는다 — 하위 명령 자리가 확장이면
#    막고, 조각 안의 «모든» `git … commit` 을 각각 읽는다(괄호 안 `git commit -m x -- f; git commit -n` 의 둘째 커밋)
#    ⑨ `-n` 없이 훅을 끄는 설정도 막는다 — `-c` · `--config-env` 의 `core.hooksPath` · `alias.*`, 환경변수
#    `GIT_CONFIG_PARAMETERS` · `GIT_CONFIG_GLOBAL` · `GIT_CONFIG_SYSTEM` · `GIT_CONFIG` · `GIT_CONFIG_KEY_n=core.hooksPath|alias.*`,
#    다른 설정 파일 끌어오기(`include.path` · `includeIf.*.path`), `git config` 로 `core.hooksPath` · `alias.*` · include 에
#    값 쓰기(읽기 · `--unset` 은 통과) ⑩ `(`…`)` · 백틱 안에서는 조각을 나누지 않는다 ⑪ 다시 읽을 낱말이 16개를 넘으면 막는다.
#    남는 한계: 셸 변수에 담아 둔 하위 명령 · git 별칭 설정 파일 · 도구별 환경변수(`HUSKY=0` 등)는 이 규칙이 보지 않는다.
_FE_SQ="'"
if printf '%s\n' "$CMD_RAW" | awk -v SQ="$_FE_SQ" -v DQ='"' '
function flush() { if (seg ~ /[^ \t]/) segs[++ns] = seg; seg = "" }
function split_segments(s,    n, i, c, q, nx, p, depth, bq) {
  ns = 0; seg = ""; q = ""; depth = 0; bq = 0; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (q == "") {
      if (c == "\\") { nx = substr(s, i + 1, 1); i++; if (nx != "\n") seg = seg c nx; continue }
      if (c == "$" && substr(s, i + 1, 1) == SQ) { q = "A"; seg = seg c SQ; i++; continue }
      if (c == SQ || c == DQ) { q = c; seg = seg c; continue }
      if (c == "`") { bq = !bq; seg = seg c; continue }
      if (c == "(") { depth++; seg = seg c; continue }
      if (c == ")") { if (depth > 0) depth--; seg = seg c; continue }
      if (depth > 0 || bq) { seg = seg c; continue }
      if (c == "#" && (seg == "" || substr(seg, length(seg), 1) ~ /[ \t]/)) { while (i < n && substr(s, i + 1, 1) != "\n") i++; continue }
      if (c == "\n" || c == ";" || c == "|") { flush(); continue }
      if (c == "&") {
        p = (i > 1) ? substr(s, i - 1, 1) : ""; nx = substr(s, i + 1, 1)
        if (p == ">" || p == "<" || nx == ">") { seg = seg c; continue }
        flush(); continue
      }
      seg = seg c
    } else if (q == "A") {
      if (c == "\\") { seg = seg c substr(s, i + 1, 1); i++; continue }
      if (c == SQ) q = ""
      seg = seg c
    } else {
      if (q == DQ && c == "\\") { seg = seg c substr(s, i + 1, 1); i++; continue }
      if (c == q) q = ""
      seg = seg c
    }
  }
  flush()
}
function tokenize(s,    n, i, c, q, tok, has, nx, d) {
  nt = 0; tok = ""; q = ""; has = 0; d = 0; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (q == "") {
      nx = substr(s, i + 1, 1)
      if (c == "\\") { tok = tok nx; i++; has = 1; continue }
      if (c == "$" && nx == SQ) { if (!d) d = length(tok) + 1; tok = tok c; q = "A"; i++; has = 1; continue }
      if (c == "$" && nx == DQ) { if (!d) d = length(tok) + 1; tok = tok c; has = 1; continue }
      if (c == SQ || c == DQ) { q = c; has = 1; continue }
      if (c == " " || c == "\t" || c == "\n") { if (has) { toks[++nt] = tok; dyn[nt] = d; tok = ""; has = 0; d = 0 } continue }
      if (index("$`{*?[", c) && !d) d = length(tok) + 1
      tok = tok c; has = 1
    } else if (q == SQ) {
      if (c == SQ) { q = ""; continue }
      tok = tok c
    } else if (q == "A") {
      if (c == "\\") { tok = tok substr(s, i + 1, 1); i++; continue }
      if (c == SQ) { q = ""; continue }
      tok = tok c
    } else {
      if (c == "\\") { nx = substr(s, i + 1, 1); if (nx == DQ || nx == "\\" || nx == "$" || nx == "`") { tok = tok nx; i++; continue } }
      if (c == DQ) { q = ""; continue }
      if ((c == "$" || c == "`") && !d) d = length(tok) + 1
      tok = tok c
    }
  }
  if (has) { toks[++nt] = tok; dyn[nt] = d }
}
# 설정 키가 훅을 끄거나 별칭을 만들거나 다른 설정 파일을 끌어오는가(core.hooksPath · alias.* · include.path ·
# includeIf.*.path). 키 자리가 확장이면 알 수 없으니 그렇다고 본다.
function badkey(k) { k = tolower(k); return (k == "core.hookspath" || k ~ /^alias\./ || k == "include.path" || k ~ /^includeif\..*\.path$/) }
function badcfg(v, d,    eq) {
  eq = index(v, "=")
  if (d && (!eq || d <= eq)) return 1
  return badkey(eq ? substr(v, 1, eq - 1) : v)
}
# 한 커밋의 인수 읽기 — `--` 는 «이» 커밋의 인수만 끝낸다.
function scanargs(start,    j, k, L, t, ch, skip, eq, name) {
  skip = 0
  for (j = start; j <= nt; j++) {
    t = toks[j]
    if (skip) { skip = 0; used[j] = 1; continue }
    if (t == "--") return
    if (t ~ /^--/) {
      eq = index(t, "="); name = eq ? substr(t, 1, eq - 1) : t
      if (dyn[j] && dyn[j] <= length(name)) { found = 1; return }
      if (name ~ /^--no-veri(f|fy)?$/) { found = 1; return }
      if (!eq && name ~ /^--(message|file|author|date|template|reuse-message|reedit-message|fixup|squash|trailer|cleanup|pathspec-from-file)$/) skip = 1
      continue
    }
    if (length(t) > 1 && substr(t, 1, 1) == "-") {
      L = length(t)
      for (k = 2; k <= L; k++) {
        if (dyn[j] == k) { found = 1; return }
        ch = substr(t, k, 1)
        if (ch == "n") { found = 1; return }
        if (ch ~ /[cCFmt]/) { if (k == L) skip = 1; break }
        if (ch ~ /[uS]/) break
      }
      continue
    }
    if (dyn[j] == 1) { found = 1; return }
  }
}
# git config 로 core.hooksPath · alias.* 에 값을 쓰는가(읽기 · --unset 은 통과).
function scanconfig(start,    j, t, k) {
  for (j = start; j <= nt; j++) {
    t = toks[j]
    if (t ~ /^-/) continue
    if (badkey(t) && j < nt) { found = 1; return }
    if (dyn[j]) { found = 1; return }
  }
}
function scan(    i, j, g, t) {
  for (j = 1; j <= nt; j++) used[j] = 0
  for (j = 1; j <= nt; j++) {
    t = toks[j]
    # 환경변수로 git 설정을 주입하거나 설정 파일을 바꾸는가
    if (t ~ /^(GIT_CONFIG_PARAMETERS|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG)=/) cfgenv = 1
    if (t ~ /^GIT_CONFIG_KEY_[0-9]+=/ && (badkey(substr(t, index(t, "=") + 1)) || dyn[j])) cfgenv = 1
  }
  for (i = 1; i <= nt; i++) {
    if (toks[i] !~ /(^|[^A-Za-z0-9_.-])git$/) continue
    gitseen = 1
    for (g = i + 1; g <= nt; g++) {
      t = toks[g]
      if (t == "-c" || t == "--config-env") { if (g < nt && badcfg(toks[g + 1], dyn[g + 1])) found = 1; g++; continue }
      if (t ~ /^-c./) { if (badcfg(substr(t, 3), dyn[g] ? dyn[g] - 2 : 0)) found = 1; continue }
      if (t ~ /^--config-env=/) { if (badcfg(substr(t, 14), dyn[g] ? dyn[g] - 13 : 0)) found = 1; continue }
      if (t ~ /^(-C|--git-dir|--work-tree|--namespace|--super-prefix|--attr-source)$/) { g++; continue }
      if (t ~ /^-/) continue
      break
    }
    if (g > nt) continue
    if (dyn[g] == 1) { found = 1; continue }
    if (toks[g] == "commit") { hascommit = 1; scanargs(g + 1) }
    else if (toks[g] == "config") scanconfig(g + 1)
  }
  for (j = 1; j <= nt; j++) {
    if (used[j]) continue
    if (toks[j] ~ /^--no-veri(f|fy)?$/) noverify = 1
    if (toks[j] ~ /[ \t\n]/ && toks[j] ~ /git/ && tolower(toks[j]) ~ /commit|config|alias|hookspath|include/) queue[++qt] = toks[j]
  }
}
{ input = input (NR > 1 ? "\n" : "") $0 }
END {
  qt = 1; queue[1] = input; found = 0; noverify = 0; hascommit = 0; gitseen = 0; cfgenv = 0
  for (qh = 1; qh <= qt && qh <= 16; qh++) {
    split_segments(queue[qh])
    for (si = 1; si <= ns; si++) { tokenize(segs[si]); scan() }
  }
  if (qt > 16) found = 1
  exit ((found || (hascommit && noverify) || (gitseen && cfgenv)) ? 0 : 1)
}'; then
  block "'--no-verify' / 'git commit -n' / 훅을 끄는 설정(core.hooksPath · alias) 금지. 린트·타입 오류를 수정하세요."
fi

# 4. git stash drop / git stash clear
if echo "$CMD" | grep -qE 'git[[:space:]]+stash[[:space:]]+(drop|clear)'; then
  block "'git stash drop/clear' 금지. 작업 내용이 영구 손실됩니다."
fi

# 5. yarn/npm/pnpm publish
if echo "$CMD" | grep -qE '(yarn|npm|pnpm)[[:space:]]+publish'; then
  block "패키지 배포 금지. 수동으로 실행하세요."
fi

# 6. rm -rf / rm -fr 루트·홈 디렉토리 (/, /*, ~, ~/, $HOME 은 차단 · /tmp·~/build 등 범위 지정은 통과)
if echo "$CMD" | grep -qE 'rm[[:space:]]+(-rf|-fr|-Rf|-fR)[[:space:]]+(/|~|\$HOME)\/?\*?([[:space:]]|$)'; then
  block "루트/홈 디렉토리 삭제 금지."
fi

# 7. DROP TABLE / DROP DATABASE — DB 실행 문맥(DB 클라이언트)에서만 차단.
#    (git log --grep "drop table" 같은 문자열 검색·문서 인용은 통과시켜 오탐을 줄인다)
if echo "$CMD" | grep -iqE '(psql|mysql|mariadb|sqlite3?|mongosh?|prisma|cockroach|clickhouse-client)' \
   && echo "$CMD" | grep -iqE 'DROP[[:space:]]+(TABLE|DATABASE)'; then
  block "DROP TABLE/DATABASE 금지. 수동으로 실행하세요."
fi

# 8. git reset --hard
if echo "$CMD" | grep -qE 'git[[:space:]]+reset[[:space:]]+--hard'; then
  block "'git reset --hard' 금지. 변경사항이 손실됩니다."
fi

# 9. git checkout . / git restore .  ( `-- .` · `HEAD -- .` · `HEAD .` · 끝의 `./` 변형 포함 )
#    LLM 이 선의로 자주 쓰는 `git checkout -- .`(작업 폐기)·`git checkout ./`(rc=0 우회)까지 잡는다.
if echo "$CMD" | grep -qE 'git[[:space:]]+(checkout|restore)[[:space:]]+(--[[:space:]]+|HEAD[[:space:]]+(--[[:space:]]+)?)?\.\/?([[:space:]"]|$)'; then
  block "모든 변경사항 되돌리기 금지. 파일을 명시적으로 지정하세요."
fi

exit 0
