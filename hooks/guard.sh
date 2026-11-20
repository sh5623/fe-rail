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

# 3. 커밋 훅 우회 차단 — `git commit -n` / `--no-verify`, 그리고 `-n` 없이 훅을 끄는 설정.
#    정규식으로는 오탐(뒤 명령의 `sed -n` · 메시지 안의 `-n`)과 우회(`-nm` · `"-n"` · `--no-veri`)를 함께 막을 수 없어
#    셸처럼 읽는 작은 파서(awk)로 판정한다. 파서는 앞단 정규화 전 원문(`CMD_RAW`)을 읽는다. 하는 일:
#    ① 따옴표 밖의 `;` `|` `&`(리다이렉션 `2>&1` · `>&2` · `&>` 은 제외) · 줄바꿈 · 주석(`#`)으로 명령 조각을 나눈다.
#      `(`…`)` · `$(`…`)` · 백틱 안에서는 나누지 않고, 줄 끝 `\` 이어 쓰기는 합친다
#    ② 조각을 셸처럼 낱말로 나누며 따옴표를 걷는다. `$'…'` 은 `\` 가 이스케이프인 별도 따옴표로 읽고, 따옴표 밖 `$(…)` ·
#      백틱은 셸처럼 한 낱말로 둔다
#    ③ 조각 안의 «모든» git 호출을 각각 읽는다 — `git` · 경로(`/usr/bin/git`) · `$(which git)` · 백틱, 그리고 같은 명령
#      안에서 `NAME=git`(`/usr/bin/git` · `$(which git)` · `"git commit"` · 다른 git 변수)으로 정한 변수 `$NAME` — 값에
#      전역 옵션 · 확장을 품은 git 변수(`C="git -C x"`), git 변수로 시작해 뒤에 무언가 붙은 낱말(`${G}${E}`)은 값째 읽지
#      못하니 막는다. 명령 밖에서 정한 변수 · 일부만 변수인
#      낱말(`$G` · `${G}t` · `git$X`)은 뒤 하위 명령 자리가 `commit` · `config` 일 때만 git 처럼 읽는다. 전역 옵션(`-C x` ·
#      `-cK=V` · `--git-dir x` …)을 건너뛰고 하위 명령을 찾는다. 대시 붙은 `git-commit` · `git-config` 는 하위 명령이 정해진 git 이다
#    ④ `commit` 의 인수를 git 처럼 읽는다 — 짧은 묶음에서 n 이 나오면 우회, 값을 받는 c C F m t 가 나오면 묶음의 나머지가
#      값(묶음 끝이면 다음 낱말), u S 는 붙은 선택 값, 값을 받는 긴 옵션은 다음 낱말을 건너뛰고, `--` 는 «그» 커밋의
#      인수만 끝낸다
#    ⑤ 모르면 막는다 — 플래그 · 하위 명령 · 전역 옵션 이름 자리에 파서가 풀 수 없는 확장(`$X` · 백틱 · `$'…'` · `$"…"`,
#      따옴표 밖 `{` `*` `?` `[`)이 오거나, git 호출의 `--` 앞 어디든(값 포함) 따옴표 없는 변수 · 명령 치환이 오면 막는다
#      — 낱말로 쪼개져 `-n` 이나 다른 하위 명령이 될 수 있다. 큰따옴표로 감싼 값(`-m "$MSG"` ·
#      `-m "$(cat <<'EOF' …)"` · `-C "$REPO"`)과 `--` 뒤 경로는 통과
#    ⑥ 훅을 끄는 설정 — `-c` · `--config-env` 의 `core.hooksPath` · `alias.*` · `include.path` · `includeIf.*.path`,
#      환경변수 `GIT_CONFIG_PARAMETERS` · `GIT_CONFIG_GLOBAL` · `GIT_CONFIG_SYSTEM` · `GIT_CONFIG` · `GIT_CONFIG_KEY_n`(그 키),
#      `git config` 로 그 키에 값 쓰기(읽기 · `--unset` 은 통과)
#    ⑦ 다시 읽기 — 명령 치환(`$(…)` · 백틱)은 값 자리라도 실행되므로 늘 그 안쪽을 다시 읽고(heredoc 본문도 명령으로
#      읽는다), 바깥 글은 치환 자리를 따옴표 없는 변수로 바꿔 읽는다. 값이 아닌 나머지 낱말은 공백이 있고 따옴표 · 역슬래시를 걷은 글자에 git 과 커밋 · 설정 낱말이 있으면
#      (`bash -c "…"` · `sh -c '…'` · `eval '…'`) 다시 읽는다. 다시 읽을 낱말이 64개를 넘으면 막는다. 명령 어디든 커밋이 있고
#      값이 아닌 낱말이 `--no-veri` · `--no-verif` · `--no-verify` 면 막는다
#      git 인지 알 수 없는 첫 낱말이라도 뒤 전역 옵션 자리에 훅을 끄는 `-c` · `--config-env` 가 있으면 막는다.
#    막을 때는 이유(우회 플래그 · 풀 수 없는 확장 · 쪼개지는 확장 · 훅을 끄는 설정)를 함께 알린다.
#    보장 범위 — 실제 실행 명령을 정적으로 식별할 수 있는 git 호출만 판정한다. 변수나 래퍼를 거쳐 실제 실행 명령을 정적으로
#    식별할 수 없는 경우(`C=$(echo git commit); $C -n` · `bash -c "$G commit -n"` · `$G $SUB -n` 등)는 이 가드의 보장 범위
#    밖이다. commit · config 같은 낱말만으로 실행 대상을 git 으로 볼 수 없고(`npm run config`), 첫 낱말이 변수라는 이유만으로
#    막으면 정상 FE 작업(`"$PM" exec head -n 5`)이 막힌다. 일부러 구성한 새 표현이 발견됐다는 이유만으로 파서를 넓히지 않고,
#    실제 사용 중 놓친 git 호출이나 정상 FE 작업이 막힌 사례가 생겼을 때 다시 검토한다.
#    알려진 한계 — 흔한 형태의 백스톱이지 셸 전체의 보장이 아니다: 하위 명령까지 변수로 부른 git(`$G $SUB` — 첫
#    낱말이 변수라는 이유만으로 막으면 `"$PM" run build` 도 막힌다) · 큰따옴표 안 `$(…)` 속 따옴표 중첩 · `HOME` ·
#    `XDG_CONFIG_HOME` · `GIT_DIR` 로 설정 파일 바꾸기 · `.git/config` 나 `.git/hooks` 를 파일로 직접 고치기 · 셸 alias ·
#    함수 · git 별칭 설정 파일 · 도구별 환경변수(`HUSKY=0` 등). 막는 쪽 오탐: 커밋 메시지를 `-m "$(cat <<'EOF' …)"` 로 넘기고
#    본문에 우회 꼴(`git commit -n` 같은 글)이 있으면 막힌다 — heredoc 본문을 데이터로 보는 판정은 cat 바꿔치기 · eval 같은
#    재해석과 끝없이 어긋나서 두지 않는다. 그런 메시지는 `-F 파일` 로 넘긴다.
_FE_SQ="'"
if _FE_WHY=$(printf '%s\n' "$CMD_RAW" | awk -v SQ="$_FE_SQ" -v DQ='"' '
BEGIN {
  WF = "-n · --no-verify 금지 — 린트·타입 오류를 수정하세요"
  WC = "훅을 끄는 git 설정(core.hooksPath · alias.* · include · GIT_CONFIG_*) 금지 — 린트·타입 오류를 수정하세요"
  WE = "플래그 · 하위 명령 자리에 파서가 풀 수 없는 확장(변수 · 치환 · 글롭 · {…})이 있어 판정할 수 없음"
  WS = "따옴표 없는 변수 · 명령 치환은 낱말로 쪼개져 판정할 수 없음 — \"$X\" 처럼 큰따옴표로 감싸세요"
  WM = "다시 읽을 낱말이 너무 많아 판정할 수 없음"
}
function hit(w) { if (!found) why = w; found = 1 }
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
# 낱말로 나누며 따옴표를 걷는다. dyn = 파서가 풀 수 없는 확장의 첫 위치, uq = 따옴표 밖 변수 · 명령 치환(낱말로 쪼개진다).
# 따옴표 밖 `$(…)` · 백틱은 셸처럼 한 낱말로 둔다 — 안의 따옴표 · 괄호는 그대로 남겨 다시 읽을 때 푼다.
function tokenize(s,    n, i, c, q, tok, has, nx, d, u, pd, bt, rq) {
  nt = 0; tok = ""; q = ""; has = 0; d = 0; u = 0; pd = 0; bt = 0; rq = ""; n = length(s)
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (pd > 0 || bt) {
      tok = tok c
      if (rq != "") { if (c == "\\" && rq == DQ) { tok = tok substr(s, i + 1, 1); i++ } else if (c == rq) rq = ""; continue }
      if (c == "\\") { tok = tok substr(s, i + 1, 1); i++; continue }
      if (c == SQ || c == DQ) { rq = c; continue }
      if (bt && c == "`") { bt = 0; continue }
      if (pd > 0 && c == "(") pd++
      else if (pd > 0 && c == ")") pd--
      continue
    }
    if (q == "") {
      nx = substr(s, i + 1, 1)
      if (c == "\\") { tok = tok nx; i++; has = 1; continue }
      if (c == "$" && nx == "(") { if (!d) d = length(tok) + 1; u = 1; tok = tok "$("; i++; pd = 1; has = 1; continue }
      if (c == "`") { if (!d) d = length(tok) + 1; u = 1; tok = tok c; bt = 1; has = 1; continue }
      if (c == "$" && nx == SQ) { if (!d) d = length(tok) + 1; tok = tok c; q = "A"; i++; has = 1; continue }
      if (c == "$" && nx == DQ) { if (!d) d = length(tok) + 1; tok = tok c; has = 1; continue }
      if (c == SQ || c == DQ) { q = c; has = 1; continue }
      if (c == " " || c == "\t" || c == "\n") { if (has) { toks[++nt] = tok; dyn[nt] = d; uq[nt] = u; tok = ""; has = 0; d = 0; u = 0 } continue }
      if (c == "`" || (c == "$" && nx ~ /[A-Za-z0-9_{(@*#?!$-]/)) u = 1
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
  if (has) { toks[++nt] = tok; dyn[nt] = d; uq[nt] = u }
}
# git 을 부르는 낱말인가 — git · /usr/bin/git · $(which git) 의 git) · 백틱 안 git
function isgit(t) { return (t ~ /(^|[^A-Za-z0-9_.-])git[)`]*$/) }
# 변수 값이 git 호출인가 — 첫 낱말이 git · /usr/bin/git · $(which git) · $(command -v git) · 다른 git 변수.
# 하위 명령은 VSUB 에 두고, 값째 읽지 못하는 꼴(하위 명령 뒤에 낱말이 더 있는 commit · config, 하위 명령을 품은 git
# 변수 뒤의 낱말)은 "-" 로 둔다. 치환 값은 git 경로를 얻는 꼴만 git 이다 — $(git rev-parse …) 는 git 의 «출력» 이다.
function gitval(v,    f, r, k, dp, c, nm, w, n) {
  VSUB = ""
  if (v ~ /^\$\(/) {
    dp = 0
    for (k = 1; k <= length(v); k++) { c = substr(v, k, 1); if (c == "(") dp++; else if (c == ")") { dp--; if (dp == 0) break } }
    f = substr(v, 1, k); r = substr(v, k + 1)
  } else if (v ~ /^`/) {
    k = index(substr(v, 2), "`"); k = k ? k + 1 : length(v); f = substr(v, 1, k); r = substr(v, k + 1)
  } else {
    k = match(v, /[ \t\n]/); f = k ? substr(v, 1, k - 1) : v; r = k ? substr(v, k + 1) : ""
  }
  sub(/^[ \t\n]+/, "", r)
  n = (r == "") ? 0 : split(r, w, /[ \t\n]+/)
  if (f ~ /^(\$\(|`)/) {
    nm = f; gsub(/^(\$\(|`)|[)`]+$/, "", nm)
    if (!(nm ~ /^(which|command|type)[ \t]/ && nm ~ /(^|[ \t\/])git$/)) return 0
  } else if (f ~ /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/) {
    nm = f; gsub(/[${}]/, "", nm)
    if (!(nm in gitvar)) return 0
    if (gitsub[nm] != "") { VSUB = n ? "-" : gitsub[nm]; return 1 }
  } else if (f !~ /(^|\/)git$/) return 0
  if (n >= 1) VSUB = w[1]
  if (n >= 2 && (w[1] == "commit" || w[1] == "config")) VSUB = "-"
  return 1
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
    if (skip) { skip = 0; used[j] = 1; if (uq[j]) { hit(WS); return } continue }
    if (t == "--") return
    if (uq[j]) { hit(WS); return }
    if (t ~ /^--/) {
      eq = index(t, "="); name = eq ? substr(t, 1, eq - 1) : t
      if (dyn[j] && dyn[j] <= length(name)) { hit(WE); return }
      if (name ~ /^--no-veri(f|fy)?$/) { hit(WF); return }
      if (!eq && name ~ /^--(message|file|author|date|template|reuse-message|reedit-message|fixup|squash|trailer|cleanup|pathspec-from-file)$/) skip = 1
      continue
    }
    if (length(t) > 1 && substr(t, 1, 1) == "-") {
      L = length(t)
      for (k = 2; k <= L; k++) {
        if (dyn[j] == k) { hit(WE); return }
        ch = substr(t, k, 1)
        if (ch == "n") { hit(WF); return }
        if (ch ~ /[cCFmt]/) { if (k == L) skip = 1; break }
        if (ch ~ /[uS]/) break
      }
      continue
    }
    if (dyn[j] == 1) { hit(WE); return }
  }
}
# git config 로 core.hooksPath · alias.* · include 에 값을 쓰는가(읽기 · --unset 은 통과).
function scanconfig(start,    j, t) {
  for (j = start; j <= nt; j++) {
    t = toks[j]
    if (t ~ /^-/) continue
    if (badkey(t) && j < nt) { hit(WC); return }
    if (dyn[j]) { hit(WE); return }
  }
}
# i 번째 낱말 뒤 전역 옵션 자리에 훅을 끄는 -c · --config-env 가 있는가
function globalbad(i,    g, t) {
  for (g = i + 1; g <= nt; g++) {
    t = toks[g]
    if (t == "-c" || t == "--config-env") { if (g < nt && badcfg(toks[g + 1], dyn[g + 1])) return 1; g++; continue }
    if (t ~ /^-c./) { if (badcfg(substr(t, 3), dyn[g] ? dyn[g] - 2 : 0)) return 1; continue }
    if (t ~ /^--config-env=/) { if (badcfg(substr(t, 14), dyn[g] ? dyn[g] - 13 : 0)) return 1; continue }
    if (t ~ /^(-C|--git-dir|--work-tree|--namespace|--super-prefix|--attr-source)$/) { g++; continue }
    if (t ~ /^-/) continue
    return 0
  }
  return 0
}
# i 번째 낱말 뒤에서 전역 옵션을 건너뛴 하위 명령 자리(없으면 0)
function subat(i,    g, t) {
  for (g = i + 1; g <= nt; g++) {
    t = toks[g]
    if (t == "-c" || t == "--config-env" || t ~ /^(-C|--git-dir|--work-tree|--namespace|--super-prefix|--attr-source)$/) { g++; continue }
    if (t ~ /^-/) continue
    return g
  }
  return 0
}
function scan(    i, j, k, g, t, v, nm, vs, ne, stop, sb, pf) {
  for (j = 1; j <= nt; j++) used[j] = 0
  for (j = 1; j <= nt; j++) {
    t = toks[j]
    # 환경변수로 git 설정을 주입하거나 설정 파일을 바꾸는가
    if (t ~ /^(GIT_CONFIG_PARAMETERS|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG)=/) cfgenv = 1
    if (t ~ /^GIT_CONFIG_KEY_[0-9]+=/ && (badkey(substr(t, index(t, "=") + 1)) || dyn[j])) cfgenv = 1
    # 같은 명령 안에서 git 을 담은 변수(NAME=git · NAME=$(which git) · NAME="git commit" · NAME=$다른git변수)
    if (t ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
      nm = substr(t, 1, index(t, "=") - 1); v = substr(t, index(t, "=") + 1)
      if (v ~ /^(\$\(|`)/ && v !~ /[)`]$/) { for (k = j + 1; k <= nt && k <= j + 6; k++) { v = v " " toks[k]; if (toks[k] ~ /[)`]$/) break } }
      if (gitval(v)) { gitvar[nm] = 1; gitsub[nm] = VSUB }
      # git 변수를 git 이 아닌 값으로 다시 정한 꼴(다른 명령의 인수 `G=x` 일 수도 있다)은 어느 값인지 모르니 쓰면 막는다
      else if (nm in gitvar) gitsub[nm] = "-"
    }
  }
  for (i = 1; i <= nt; i++) {
    t = toks[i]; vs = ""
    # 대시 붙은 git 명령(/usr/libexec/git-core/git-commit · git-config)은 하위 명령이 정해진 git 이다
    if (t ~ /(^|\/)git-(commit|config)$/) { gitseen = 1; if (t ~ /commit$/) { hascommit = 1; scanargs(i + 1) } else scanconfig(i + 1); continue }
    if (!isgit(t)) {
      nm = t; gsub(/[${}]/, "", nm)
      if (t ~ /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/ && (nm in gitvar)) {
        vs = gitsub[nm]
        # 값에 전역 옵션이나 확장을 품은 git 변수(C="git -C x")는 값째 읽지 못하니 막는다
        if (vs ~ /^-/ || vs ~ /[$`{}*?[]/) { hit(WE); continue }
      } else {
        # git 변수로 시작해 뒤에 무언가 붙은 낱말(${G}${E} · $G"x")은 값째 읽지 못하니 막는다
        if (dyn[i] == 1 && match(t, /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/)) { nm = substr(t, 1, RLENGTH); gsub(/[${}]/, "", nm); if (nm in gitvar) { hit(WE); continue } }
        # 명령 밖에서 정한 변수 · 일부만 변수인 낱말($G · ${G}t · git$X · $(…)it)은 git 인지 알 수 없다 — 첫 낱말이
        # 변수라는 이유만으로 막으면 "$PM" run build 도 막히므로, 뒤 하위 명령 자리가 commit · config 일 때만 git 처럼 읽는다
        if (!dyn[i] || t ~ /^-/ || (index(t, "=") && index(t, "=") < dyn[i])) continue
        # 하위 명령이 무엇이든 전역 옵션 자리의 훅 끄기 설정(-c alias.ci=… ci)은 막는다
        if (globalbad(i)) { hit(WC); continue }
        g = subat(i)
        if (!g || (toks[g] != "commit" && toks[g] != "config")) continue
      }
    }
    gitseen = 1
    if (vs == "commit") { hascommit = 1; scanargs(i + 1); continue }
    if (vs == "config") { scanconfig(i + 1); continue }
    if (vs != "") continue
    stop = 0
    for (g = i + 1; g <= nt; g++) {
      t = toks[g]
      if (uq[g]) { hit(WS); stop = 1; break }
      if (t == "-c" || t == "--config-env") {
        if (g < nt && uq[g + 1]) { hit(WS); stop = 1; break }
        if (g < nt && badcfg(toks[g + 1], dyn[g + 1])) hit(WC)
        g++; continue
      }
      if (t ~ /^-c./) { if (badcfg(substr(t, 3), dyn[g] ? dyn[g] - 2 : 0)) hit(WC); continue }
      if (t ~ /^--config-env=/) { if (badcfg(substr(t, 14), dyn[g] ? dyn[g] - 13 : 0)) hit(WC); continue }
      if (t ~ /^(-C|--git-dir|--work-tree|--namespace|--super-prefix|--attr-source)$/) {
        if (g < nt && uq[g + 1]) { hit(WS); stop = 1; break }
        g++; continue
      }
      if (t ~ /^-/) {
        ne = (t ~ /^-[A-Za-z]./) ? 2 : (index(t, "=") ? index(t, "=") - 1 : length(t))
        if (dyn[g] && dyn[g] <= ne) { hit(WE); stop = 1; break }
        continue
      }
      break
    }
    if (stop || g > nt) continue
    if (dyn[g]) { hit(WE); continue }
    if (toks[g] == "commit") { hascommit = 1; scanargs(g + 1) }
    else if (toks[g] == "config") scanconfig(g + 1)
  }
  for (j = 1; j <= nt; j++) {
    t = toks[j]
    sb = (index(t, "$(") || index(t, "`"))
    # 값으로 쓰인 낱말은 보지 않는다 — 단 값 안의 명령 치환(`-m "$(git commit -n …)"`)은 실행되므로 다시 읽는다
    if (used[j] && !sb) continue
    if (!used[j] && t ~ /^--no-veri(f|fy)?$/) noverify = 1
    # 명령 치환의 안쪽은 글자 검사 없이 늘 다시 읽고, 바깥 글은 치환 자리를 따옴표 없는 변수($_FE)로 바꿔 읽는다
    if (sb) t = subs(t)
    if (t !~ /[ \t\n]/) continue
    # 바깥 글(`bash -c "…"` 등)은 따옴표 · 역슬래시를 걷은 글자로 git 과 커밋 · 설정 낱말을 찾는다(`g""it` · `c\ommit`)
    pf = t; gsub("[\"\\\\" SQ "]", "", pf)
    if (pf ~ /git/ && tolower(pf) ~ /commit|config|alias|hookspath|include/) queue[++qt] = t
  }
}
# 낱말 안의 명령 치환(`$(…)` · 백틱)을 떼어 그 안쪽을 다시 읽기 대기열에 넣고, 치환 자리를 `$_FE` 로 바꾼 바깥 글을 돌려준다
# — 다시 읽을 때 그 자리는 낱말로 쪼개지는 확장으로 판정된다. heredoc 본문도 걷지 않고 명령으로 읽는다(아래 한계).
function subs(t,    n, i, c, rq, dp, st, out, body) {
  n = length(t); out = ""; i = 1
  while (i <= n) {
    c = substr(t, i, 1)
    if (c == "$" && substr(t, i + 1, 1) == "(") {
      dp = 1; rq = ""; st = i + 2; i += 2
      while (i <= n) {
        c = substr(t, i, 1)
        if (rq != "") { if (c == "\\" && rq == DQ) i++; else if (c == rq) rq = "" }
        else if (c == "\\") i++
        else if (c == SQ || c == DQ) rq = c
        else if (c == "(") dp++
        else if (c == ")") { dp--; if (!dp) break }
        i++
      }
      body = substr(t, st, i - st); i++
      queue[++qt] = body; out = out "$_FE"; continue
    }
    if (c == "`") {
      st = i + 1; i++
      while (i <= n && substr(t, i, 1) != "`") { if (substr(t, i, 1) == "\\") i++; i++ }
      body = substr(t, st, i - st); i++
      queue[++qt] = body; out = out "$_FE"; continue
    }
    out = out c; i++
  }
  return out
}
{ input = input (NR > 1 ? "\n" : "") $0 }
END {
  qt = 1; queue[1] = input; found = 0; why = ""; noverify = 0; hascommit = 0; gitseen = 0; cfgenv = 0
  for (qh = 1; qh <= qt && qh <= 64; qh++) {
    split_segments(queue[qh])
    for (si = 1; si <= ns; si++) { tokenize(segs[si]); scan() }
  }
  if (qt > 64) hit(WM)
  if (hascommit && noverify) hit(WF)
  if (gitseen && cfgenv) hit(WC)
  if (found) { print why; exit 0 }
  exit 1
}'); then
  block "커밋 훅 우회 차단: ${_FE_WHY}."
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
