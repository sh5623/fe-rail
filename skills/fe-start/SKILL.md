---
name: fe-start
description: >-
  Takes a feature.md file and automatically runs spec confirmation → implementation → review → commit → PR.
  Use when: the user says "fe-start feature.md" or "start with feature.md".
  Do NOT load for: one-off bug hotfixes, 1-line changes, exploratory work, or tasks where pass/fail signals are ambiguous (a single skill or a direct prompt is better).
  Human checkpoints: two — "Implement now?" and "Commit now?" — when entering via fe-spec's full-auto handoff, only "Commit now?" is asked (the fe-spec Phase 3 choice doubles as the first approval, keeping the total at 2). Can STOP with an exception escalation once the re-delegation cap is exhausted or when the pre-commit step finds out-of-scope changes or the base sync hits a conflict.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
  - Task
  - Agent
---

# FE Start — 원스톱 자동화 스킬

`feature.md` 하나로 PR까지 자동으로 처리합니다.
중간에 딱 두 번만 묻습니다.

## When to Use

- "fe-start feature.md" 실행 시
- "feature.md로 시작해줘" 라고 말할 때
- 자동화 모드로 기능 개발 시작할 때

## When NOT to Use

- 단발 버그 핫픽스 / 1줄·국소 변경 → fe-build 또는 직접 수정
- 탐색·조사성 작업(무엇을 만들지 미정) → 직접 프롬프트
- 통과/실패 신호가 모호해 완료 판정이 어려운 작업 → 풀 파이프라인 부적합

> 반복되고 통과/실패가 명확한 기능 개발에만 풀 파이프라인을 쓴다 (루프 비용 대비 효과).

## Instructions

### Phase 0 — feature.md 읽기 및 분석
```

feature.md 존재 확인 → 없으면: "feature.md가 없습니다. fe-spec 스킬로 먼저 작성해주세요." → 있으면: 파일 읽고 요구사항 파악

```

분석 결과를 요약해서 보여줍니다:
- 구현할 컴포넌트/기능
- 영향받는 파일
- 예상 소요 단계

### Phase 1 — 첫 번째 확인 ⛔ STOP

Phase 0 요약을 보여준 뒤 AskUserQuestion 으로 진행 여부를 묻는다 (자유 텍스트 아님 — 단일 선택 라디오). 승인 전 코드 작성 금지.

```jsonc
// AskUserQuestion 호출 — 단일 선택(라디오)
{
  "questions": [{
    "header": "구현 시작",
    "question": "위 내용으로 구현을 시작할까요?",
    "multiSelect": false,
    "options": [
      { "label": "구현 시작", "description": "스펙대로 Phase 2 부터 구현 진행" },
      { "label": "계획만",    "description": "코드 작성 없이 계획만 확인하고 멈춤 (--plan-only 와 동일)" },
      { "label": "중단",      "description": "시작하지 않고 멈춤" }
    ]
  }]
}
```

- 구현 시작 → Phase 2 로 진행. 그 외(계획만·중단·Other) → 코드 작성 없이 멈추고 사용자 지시를 기다린다.

> 예외 (중복 확인 방지): fe-spec Phase 3 의 "풀 자동" 선택으로 진입한 경우, 구현 시작 승인을 이미 받은 것이므로 이 질문은 생략하고 Phase 2 부터 시작한다. (standalone fe-start feature.md 진입은 그대로 이 확인을 거친다.)

---

### Phase 2 — 구현 (fe-build 스킬 기준 적용)
0. **프레임워크 규칙 로드** (fe-build Phase 1 ④ 와 동일) — 이 스킬의 base directory 기준 `../../docs/framework-rules.md` 에서 «공통 규칙» 절 + 감지한 프레임워크 절만 Read 한다(모노레포면 `../../docs/monorepo.md` 도). 소비자 프로젝트 CLAUDE.md 가 우선. **이후 모든 에이전트 위임**(fe-architect·fe-build-fixer·fe-reviewer·fe-perf-auditor·fe-a11y-auditor)에 그 **절대경로를 브리프로 넘긴다** — 에이전트는 플러그인 트리 위치를 모른다.
1. 관련 기존 코드 탐색
2. 타입 정의
3. 커스텀 훅 작성
4. 컴포넌트 구현
5. 테스트 작성 — 기존 코드의 결함을 고치는 변경이면 `fe-test-author` 를 `regression` 모드로 위임해 회귀 테스트를 쓰고 **수정 전 코드에서 실제로 실패하는지** 실행기로 확인한다(`fe-rail verify-test` — 격리본에서만 바꾸고 작업 트리는 건드리지 않는다 · 상세는 이 스킬의 base directory 기준 `../../docs/test-verify.md`, 위임 시 그 절대경로를 넘긴다). 기존 테스트가 이미 그 동작을 지키고 있어 테스트를 고치지 않는 경우에도, 그 케이스를 `--test` 로 지정해 이번 변경을 깨뜨렸을 때 실패하는지 확인한다(같은 문서 §10 — 결함 수정은 `base --only`, 새 기능 · 섞인 수정은 `mutate`)

> 위 순서는 기본값이다. 레포의 모범 파일이 다른 순서를 쓰거나 프로젝트가 테스트를 먼저 쓰는 방식(TDD — `fe-test-author` 의 Red-Green)이면 그것을 따른다.

> **재위임 상한·실패 출구 (Phase 3·4·4.5·6-0 공통)**
> 자동 수정/리뷰 재위임은 **같은 항목 군(群) 기준 누적 3회**까지. 3회 후 미해소면 루프를 멈추고
> **사람에게 에스컬레이션** — 미해소 항목·시도 이력(각 회차 무엇을 바꿨고 왜 막혔는지)·추정 원인을
> STOP 으로 보고한다. (개별 에이전트 `maxTurns` 는 단일 호출 경계라 이 오케스트레이션 루프를 못 막는다.)
> **반복 신호 전달**: 직전 회차 미해소 사유를 다음 위임 컨텍스트에 넣어 같은 접근의 재시도를 막는다.

### Phase 3 — 자동 검증

먼저 lock 파일로 패키지 매니저를 감지한다 (pnpm 고정 금지):
```bash
if   [ -f pnpm-lock.yaml ]; then PM=pnpm; PX=pnpm
elif [ -f yarn.lock ];      then PM=yarn; PX=yarn
elif [ -f bun.lockb ] || [ -f bun.lock ]; then PM=bun; PX=bun
else                              PM=npm; PX=npx
fi
```

감지된 `$PM`으로 검증을 실행한다. **`package.json`의 `scripts` 존재 여부를 먼저 확인**하고 정의된 것만 실행한다 — `||` 폴백은 스크립트 실패 시에도 우측을 실행해 타입체크/테스트가 이중 실행되므로 쓰지 않는다:
```bash
# 타입: typecheck 스크립트 우선 → 없고 솔루션 스타일 tsconfig(references)면 tsc -b → 그 외 tsc --noEmit
# (bare tsc --noEmit 은 files:[]+references 구성에서 아무 파일도 검사하지 않는 no-op — fe-build-fixer 등과 동일 기준)
# 바이너리+플래그 실행은 반드시 $PX 로 — `npm exec tsc -b` 는 npm 이 -b 를 자기 설정으로 삼켜 bare tsc 로 만들어 no-op 이 된다
if grep -q '"typecheck"' package.json; then $PM run typecheck
elif grep -q '"references"' tsconfig.json 2>/dev/null; then $PX tsc -b
else $PX tsc --noEmit; fi
# 린트: 스크립트가 있을 때만 (없으면 건너뜀 — 검증 중단 방지)
if grep -q '"lint"' package.json; then $PM run lint; fi
# 테스트: test 스크립트가 있으면 그것만, 없으면 vitest 폴백 (watch 비활성: --run)
if grep -q '"test"' package.json; then $PM run test; else $PX vitest run; fi
```

실패 시 `fe-build-fixer` 에이전트에 위임하여 최소 diff로 오류 수정 후 재검증.
**같은 오류 군 3회 초과 시 → 위 "재위임 상한·실패 출구"로** (무한 수정 루프 차단).

> **검증 결과 객체 (Phase 3·4.5·6-0 공통 — 최종 코드까지 이어지는 계약)**
> 실행한 검사마다 아래 필드를 기록한다: `kind`(typecheck/lint/test/build/e2e/visual) · `command` · `cwd` ·
> `status`(통과/실패/미실행) · `exit_code` · `대상 리비전`(`git rev-parse HEAD` + 아래 **검증 트리 id**) ·
> `skip 사유`. **판정은 exit_code 로만** 한다(로그 요약은 그다음).
> **코드가 바뀌면 그 이전 결과는 무효다** — 트리 id 가 지금과 다른 결과는 재사용하지 않고 재실행한다.
> 같은 트리 id 에 대한 중복 실행만 생략한다. 이 객체는 Phase 5 보고와 Phase 6-2 의 PR 위임 입력으로 그대로 전달된다.
> ```bash
> # 검증 트리 id — 추적 파일과 untracked(무시 제외) 파일 전체의 경로·내용·모드를 한 값으로. 실제 index 는 건드리지 않는다.
> # (`git diff HEAD | shasum` 은 untracked 파일을 못 봐서 신규 파일을 고쳐도 지문이 그대로였다 — v1.19.1 에서 교체)
> T=$(mktemp -d)/index; cp "$(git rev-parse --git-path index)" "$T"
> git ls-files -z -m -d -o --exclude-standard | GIT_INDEX_FILE=$T git update-index -z --add --remove --stdin
> GIT_INDEX_FILE=$T git write-tree; rm -rf "$(dirname "$T")"
> ```
> 작업 트리가 깨끗하면 이 값은 `git rev-parse HEAD^{tree}` 와 같다. 그래서 6-0 의 결과를 커밋에 이어 붙일 수 있는지를
> 커밋 트리와 직접 비교해 판정한다(6-0 의 5).

### Phase 4 — 리뷰 (에이전트 위임)

`fe-reviewer` 에이전트에 위임하여 4축(타입·성능·a11y·품질) 리뷰를 수행한다.
접근성(a11y) BLOCK/WARN 발생 시 → `fe-a11y-auditor` 추가 위임.
성능 BLOCK/WARN 발생 시 → `fe-perf-auditor` 추가 위임 (Tailwind 감지 시 purge·@apply 감사 포함).

위임 컨텍스트에 **Phase 2 의 파일 목록**(신규 파일 포함)과 **Phase 2 ⓪ 에서 잡은 `framework-rules.md` 절대경로**를 넘긴다 — 리뷰어는 tracked diff ∪ untracked 와 교차 확인하고, 규칙 파일의 해당 프레임워크 절을 판정 근거로 쓴다.
결과를 받아 BLOCK/WARN/INFO 항목을 간략 보고한다.
BLOCK이 있으면 수정 후 재위임하되 **같은 BLOCK 군 3회 초과 시 → "재위임 상한·실패 출구"로**.
**리뷰 수정으로 코드가 바뀌었으면 Phase 3 의 검증 결과 객체는 무효다** — 타입·린트·단위를 최종 코드에서
재실행해 객체를 갱신한 뒤 Phase 4.5 로 간다(트리 id 가 같을 때만 재사용).
BLOCK 0 은 **Phase 4.5 진행의 필요조건**일 뿐, 최종 종료 판정은 완료 기준 통과(Phase 4.5 의 가벼운 묶음 +
Phase 6-0 의 무거운 게이트)로 한다 (BLOCK 0 = "리뷰어가 그만 지적함" ≠ "완료").

### Phase 4.5 — 완료 기준 게이트 (STOP 2 앞 · 가벼운 묶음)

> **"완료"의 정의는 `feature.md` 의 '완료 기준'(Acceptance Criteria)이다.** (fe-spec 생성 feature.md 는 항상 포함.)
> 자동 항목은 두 지점에서 나눠 검증한다. 여기(STOP 2 앞)서는 **가벼운 묶음**(타입·린트·단위 전체 + 고증 화면의
> 시각 충실도)만 돌고, **무거운 묶음(build·E2E)은 Phase 6-0(커밋 직전)에서 1회** 돈다.

1. `## 완료 기준 (Acceptance Criteria)` 섹션을 읽어 **두 부류로** 처리한다 (문구를 명령으로 파싱하지 않고
   고정 체크리스트를 표준 게이트에 매핑). 섹션이 없으면(fe-spec 우회·손작성) "완료 기준 미정의"로 기록하고
   자동 게이트만 돌린 뒤 STOP 에 표기한다.
   - **자동 실행 항목** ← 타입·린트·단위 **전체**(검증 결과 객체의 트리 id 가 현재 코드와 같을 때만 Phase 3 결과 재사용, 다르면 재실행). 빌드·E2E 는 여기서 돌리지 않고 Phase 6-0 으로 넘긴다.
   - **회귀 테스트 확인(test-verify)** ← 이번 작업이 바꾼 단위 테스트 파일 · 제품 코드(JS·TS)가 있으면, 종료 훅과 **같은 판정 함수**로 기록을 본다 — 트리 id 를 따로 비교하지 않는다:
     ```bash
     fe-rail verify-test status --json -- <바뀐 단위 테스트 파일…>     # 종료 코드 0 = 충족 · 3 = 미충족 (PATH 에 없으면 node <플러그인>/bin/fe-rail.mjs)
     fe-rail verify-test report --base <작업 시작 SHA>                 # 바뀐 제품 코드마다 «깨뜨린 동작 → 케이스 → 관측값 → 판정» 또는 «미실행» · 미실행이면 종료 코드 3
     # 미충족 · 미실행이면 실행기를 돌린다(격리본에서만 바꾼다)
     fe-rail verify-test base --base <작업 시작 SHA> -- <그 패키지의 바뀐 테스트 파일…>   # 바뀐 테스트 — 새 기능이라 «파일 로딩 실패 · 측정 불가» 면 mutate
     fe-rail verify-test base --base <작업 시작 SHA> --only <소스> --test "<기존 케이스>" --intent "<깨뜨린 동작>" -- <테스트>   # 미실행 제품 코드(결함 수정)
     fe-rail verify-test mutate --file <소스> --find "<원문>" --replace "<깨뜨린 내용>" --test "<케이스>" --intent "<깨뜨린 동작>" -- <테스트>   # 새 기능 · 섞인 수정
     ```
     어떤 케이스로 무엇을 깨뜨릴지는 `../../docs/test-verify.md` §10(가드 제거 · 경계값 · 분기 목적지 등)을 따른다. 동작 변화가 없는 제품 코드(문구 · 표현 · 타입)는 «미실행 — 동작 변화 없음» 으로 사유를 남긴다.
     결과는 검증 결과 객체에 `kind: test-verify` 로 남긴다 — `status` = 검출 N · 미검출 N · 원인 미확인 N · 측정 불가 N(또는 «기록 없음»), 케이스마다 이름 · 판정 · 실패 메시지 · 사유, 부분 대조면 범위, 그리고 `report` 의 파일별 줄(미실행 파일 포함).
     **미검출 · 원인 미확인 · 측정 불가는 수정 루프에 넣지 않는다** — «통과» 로 뭉개지 않고 Phase 5 보고와 PR 에 그대로 올린다(사람이 테스트를 고칠지 정한다).
     러너를 알 수 없거나 검증되지 않은 조합이면 실행기가 사유를 내고, 그 사유를 그대로 기록한다.
   - **사람 검증 항목** ← 자동 불가: 반응형(그 화면이 지원하는 뷰포트)·접근성(키보드·aria·대비)·다크모드·DESIGN.md Bans
     → 실행하지 않고 STOP 에서 사람 확인 대상으로 노출.
2. **build·E2E 를 STOP 2 앞에서 돌리지 않는 이유** — STOP 2 는 사용자가 로컬에서 동작을 보고 수정을 요청하는
   지점이다. 여기서 돈 build·E2E 는 그 뒤의 수정 반영이나 base 전진(FF/rebase)으로 코드가 바뀌면 전부 무효가 된다
   (실측: 전체 E2E 3회, 약 40분이 상류 1커밋으로 무효가 돼 4회째가 필요했다). 그래서 코드가 더 바뀌지 않는 마지막
   지점, 곧 커밋 직전 base 에 동기화한 트리에서 1회만 돈다(Phase 6-0).
   **단위 테스트는 변경 경로로 좁히지 않는다** — 전 앱을 glob 으로 읽는 대장·스냅샷형 테스트는 경로 매핑으로 원리적으로 고를 수 없다.
3. **(고증 화면 한정) 시각 충실도 게이트** — `화면 흐름` 충실도 등급=**고증 시안** 이고 `레퍼런스` 가 있는 화면만.
   코드가 수렴하는 단계라 STOP 2 앞에 둔다. (와이어프레임·스케치·레퍼런스 없음 → 건너뜀 — 레퍼런스 없이 충실도를 채점하면 환각.)
   - **캡처**: dev 서버(또는 빌드 preview) 기동 후 해당 라우트를 레퍼런스와 **동일 뷰포트**로 스크린샷(Playwright `page.screenshot()` 또는 chrome-devtools MCP). 앱 미기동·라우트 부재면 **"미검증"**(통과 아님)으로 기록.
   - **판정**: `fe-vision` **대조 모드**에 `reference_images`+`generated_screenshot`+`category_hint`(Figma=`figma-hifi` / PPT-PDF=`ppt-layout`)를 넘겨 JSON 판정을 받는다.
   - **판정별 처리** — 점수가 아니라 `verdict` 로 가른다:
     - `pass` → 통과. `revise`(score < 임계) → 아래 루프.
     - `unverified`(레퍼런스·캡처 입력 부족) → **수정 루프에 넣지 않고** "미검증(사유)" 로 기록한다. 판정하지 못한 화면을 0점으로 보고 코드를 고치면 고칠 근거 없이 루프만 돈다.
     - `fail`(`category_match: false` — 힌트와 이미지 종류가 다름) → 코드가 아니라 `category_hint` 를 재검토할 대상이므로 루프 없이 STOP 보고에 올린다.
   - **루프**: `revise` 면 `differences`/`suggestions` 를 `fe-build`(또는 `fe-build-fixer`)에 먹여 타깃 수정 → 재캡처 → 재판정. 위 **"재위임 상한"(같은 화면 3회)** 으로 bound, 초과 시 출구로.
   - 최종 점수·미해결 차이를 Phase 5 보고에 그대로 노출(미달도 정직 보고 — "통과" 단정 금지).
   - 루프로 코드가 바뀌었으면 타입·린트·단위를 최종 코드에서 다시 돌려 검증 결과 객체를 갱신한다(트리 id 규칙).

### Phase 5 — 두 번째 확인 ⛔ STOP

**먼저** 실제 실행된 검증만 텍스트로 보고하고("검증 완료" 같은 포괄 표현 금지 — Phase 3·4.5 결과를 그대로 채운다), **그다음 `AskUserQuestion` 으로 커밋·PR 여부를 묻는다** (단일 선택 라디오).

보고(질문 앞 본문):
> **"자동 검증 — 타입·린트·단위: {통과/실패}{, 테스트 확인: 검출 N · 미검출 N · 원인 미확인 N · 측정 불가 N — 바뀐 단위 테스트가 있을 때}{, 시각 충실도: {점수/미검증} — 고증 화면 시}.
> 빌드·E2E: 커밋 직전 1회로 미룸(Phase 6-0){ — `--skip-e2e`: E2E 미검증 / `--ci-live`: push 후 CI 에서 검증}.
> 사람 확인 필요 — 반응형·접근성·다크모드{·DESIGN}."**
>
> **변경 동작별 근거** — feature.md `정책/규칙` 의 `인터랙션` 항목(이번 변경이 만들거나 바꾸는 동작 · 시작 상태 → 입력·조건 → 관찰 가능한 결과)마다
> 그 결과를 확인한 근거를 하나 붙인다: 테스트(파일·테스트 이름) / 브라우저 관찰(무엇을 발동하고 무엇을 봤는지) / 사람 확인 필요.
> 근거가 없으면 그 동작만 "미확인" 으로 적는다. 문구·색상만 바꾼 작업처럼 인터랙션 항목이 없으면 이 줄을 생략한다.
> 시각 충실도 점수는 배치·간격·타이포 차이를 찾는 용도이고, 동작의 통과 근거로 쓰지 않는다.

```jsonc
// AskUserQuestion 호출 — 단일 선택(라디오)
{
  "questions": [{
    "header": "커밋·PR",
    "question": "로컬에서 동작을 직접 확인하셨다면, 커밋·PR 을 진행할까요?",
    "multiSelect": false,
    "options": [
      { "label": "커밋·PR 진행", "description": "base 동기화 → 빌드·E2E 1회 → 커밋·푸시 → PR 생성 (Phase 6 전체)" },
      { "label": "커밋·푸시만",  "description": "base 동기화 → 빌드·E2E 1회 → 커밋·push, PR 은 만들지 않음 (--no-pr 와 동일)" },
      { "label": "중단",         "description": "커밋하지 않고 멈춤 (빌드·E2E 도 돌지 않는다)" }
    ]
  }]
}
```

- **커밋·PR 진행** → Phase 6 전체(6-0 → 6-1 → 6-2). **커밋·푸시만** → 6-0 → 6-1(PR 생략). **중단** → 커밋하지 않고 멈춘다(빌드·E2E 는 미실행으로 보고).
- **Other 로 수정을 요청하면** 반영 → Phase 3(가벼운 묶음) 재실행(리뷰 대상 변경이면 Phase 4, 고증 화면이면 시각 충실도까지) → 다시 이 STOP 2 로 돌아온다. 수정을 몇 번 반복해도 무거운 게이트는 6-0 에서 1회다.
- 역할은 한 곳에서 정한다: **커밋과 push = fe-git-operator(6-1)**, **PR 생성 = fe-pr-author(6-2)**. `--no-pr` 는 6-2 만 건너뛰므로 push 는 항상 실행된다.
- `--no-pr` 가 이미 켜져 있으면 "커밋·PR 진행" 대신 "커밋 진행"으로 좁혀 묻는다(PR 항목 제외).

---

### Phase 6 — 커밋 & PR (에이전트 위임)

본문에서 git/gh 명령을 직접 실행하지 않고 전담 에이전트에 순차 위임합니다.
이렇게 하면 `hooks/guard.sh` 의 위험 명령 차단 정책과 자연스럽게 일치하고,
메인 세션 컨텍스트가 diff·커밋 메시지로 오염되지 않습니다.
(6-0 의 base 동기화도 git 작업이라 fe-git-operator 가 맡고, build·E2E 실행은 Phase 3 처럼 메인 세션이 한다.)

#### 6-0. 커밋 직전 — base 동기화 + 무거운 게이트(build·E2E) 1회

STOP 2 승인 뒤 커밋 전에 한 번만 돈다. 코드가 더 바뀌지 않는 마지막 지점이므로 여기서 낸 결과가 PR `## 테스트` 의 근거가 된다.

0. **범위 확인 (먼저)** — `git status --porcelain --untracked-files=all` 의 경로 중 작업 범위(Phase 2 파일 목록 ∪ feature.md ∪
   6-0 게이트 수정) **밖**의 변경(staged·unstaged·untracked)이 있으면 ⛔ STOP 한다. 이유 둘:
   ① 6-1 은 범위 파일만 커밋하므로(`commit --only`) 그 변경이 섞인 트리에서 돈 build·E2E 는 커밋의 근거가 될 수 없다
   (작업 트리에서 통과한 검사가 커밋만 꺼내면 실패하는 경우가 재현됐다). ② 1 의 autostash 는 staged 변경을 unstaged 로 풀어
   버린다(내용은 보존되지만 사용자의 index 상태가 사라진다). 범위 밖 경로를 보여 주고 `AskUserQuestion` 으로 묻는다 —
   «정리 후 계속»(사용자가 직접 커밋·stash 해 치운 뒤 0 부터 다시) / «동기화 없이 진행»(1 을 건너뛰고 2~4 만 — 결과는 커밋에
   이어 붙이지 않고 PR 에 «미검증 — 범위 밖 변경이 섞인 트리» 로 적는다) / «중단». 범위 밖 변경이 없으면 묻지 않는다.
1. **base 동기화** — `fe-git-operator` 를 **동기화 모드**(커밋·푸시 없음)로 위임한다. 넘길 것: PR base(지정이 없으면 에이전트가 `origin/HEAD` 로 감지). 받을 것: 동기화 대상 · 가져온 커밋 수 · 전후 HEAD · 충돌 여부.
   - 대상은 현재 브랜치의 upstream(`@{u}`)이 있으면 그것, 없으면 `origin/<base>` 다. 뒤처졌으면 `git rebase --autostash <대상>` 으로 맞춘다(로컬 커밋이 없으면 FF 와 같다).
   - **충돌이면 ⛔ STOP** — 자동 해소하지 않는다. 충돌 파일과 상태(동기화 전으로 되돌렸는지, 미커밋 변경이 stash 에 보존돼 있는지)를 보고하고 사람 지시를 기다린다. 이미 진행 중인 rebase·merge 나 staged 변경이 있어 에이전트가 손대지 않고 돌아온 경우도 같은 STOP 이다.
   - 이미 push 된 브랜치에서 base 만 앞서 있으면 rebase 하지 않는다(공개 히스토리 재작성 = force push). 뒤처진 커밋 수만 기록하고 통합 검증은 PR(CI)에 맡긴다.
   - 원격이 없거나 fetch 가 실패하면 "동기화 생략(사유)" 로 기록하고 2 로 간다.
2. **무거운 게이트 1회** — 동기화된 트리에서 돈다. 가져온 커밋이 있으면 코드가 바뀐 것이므로 타입·린트·단위도 이 트리에서 다시 돈다(트리 id 규칙).
   회귀 테스트 확인도 같다 — 가져온 커밋이 있으면 `fe-rail verify-test status` 가 미충족이 되므로 `--base <동기화 대상 SHA>` 로 다시 돌린다
   (동기화 전 HEAD 를 기준으로 두면 가져온 상류 변경까지 «수정 전» 으로 되돌려 대조한다).
   **명령은 소비자 프로젝트가 정한다** — 소비자 CLAUDE.md·AGENTS.md 에 푸시 전(무거운) 게이트 명령이 선언돼 있으면 그것을 쓴다
   (변경→spec 매핑·preview 모드·앱 범위는 프로젝트가 더 잘 안다). 선언이 없으면 기본 선택기가 고른 명령, 곧 **전체 build + 전체 E2E** 다.
   기본을 휴리스틱으로 좁히지 않는다 — 플러그인은 변경→spec 매핑을 모르고, 좁히면 셸·공용 모듈 변경을 놓친다.
   ```bash
   # 레포 루트에서. 이 스킬의 base directory 기준 scripts/gate-commands.mjs — 명령을 고르기만 하고 실행하지 않는다.
   node "<fe-start base directory>/scripts/gate-commands.mjs" build e2e
   # 출력 한 줄 = <kind> TAB <cwd> TAB <명령>   예) build	.	pnpm run build  /  e2e	apps/web	pnpm run e2e
   #           또는 <kind> TAB - TAB 미실행: <사유>
   ```
   선택 순서(kind 마다 · 근거는 스크립트 머리 주석):
   ① 루트 `package.json` 의 `scripts` — build 는 `build`, E2E 는 `e2e` → `test:e2e`. 루트가 합본 검사를 소유하는 구성(`pnpm -r e2e`)을
   보존하고 앱 단위로 좁히지 않는다. 스크립트가 어떤 러너를 쓰든(Cypress 등) 그대로 부른다.
   ② 루트에 없으면 워크스페이스(`pnpm-workspace.yaml` 의 `packages` · `package.json` `workspaces`) 패키지 중 그 스크립트가 있는 곳 **전부**.
   ③ (E2E) 둘 다 없으면 루트 `playwright.config.*` 와 `@playwright/test` 의존성이 함께 있을 때만 `playwright test`.
   ④ 그 외는 미실행 — 하위 폴더에 Playwright 설정이 있으면 사유에 경로를 적는다(설정이 있는 프로젝트를 «e2e 없음» 으로 분류하지 않는다).
   스크립트 존재는 `package.json` 을 파싱해 `scripts` 키에서 확인한다. 파일 전체 문자열 검색(`grep '"e2e"'`)은 `"workspaces": ["e2e"]` 같은 값에
   걸려 없는 스크립트를 고르고, `test:e2e` 는 놓쳐 설정 없는 `playwright test` 로 떨어진다 — 루트 설정이 없는 레포에서는 단위 테스트 파일까지 읽어
   E2E 가 «실패» 로 끝나고 4 의 수정 루프로 들어갔다(v1.20.0 계기).
   **실행**: 출력된 명령을 위에서부터 한 줄씩 그 `cwd` 에서 돌리고, 줄마다 검증 결과 객체(kind·command·cwd·exit_code)를 하나씩 남긴다.
   `e2e-setup`(브라우저 설치) 줄은 `FE_RAIL_ALLOW_PW_INSTALL` 옵트인일 때만 나온다 — 수백 MB 다운로드이고 `--with-deps` 는 root 권한을
   요구하므로, 자동 파이프라인이 임의로 네트워크·시스템을 건드리지 않는다(`FE_RAIL_ALLOW_NPX` 와 같은 원칙). `--skip-e2e` 면 `e2e*` 줄은 돌리지 않는다.
3. 결과를 **통과/실패/미실행(사유: 선택기의 미실행 사유·브라우저·포트 등 환경 미비)** 로 구분 기록한다.
   **미실행을 통과로 표기하지 않는다.** 브라우저 미설치로 E2E 가 실패하면 그 사유를 그대로 적고
   해소 방법을 함께 노출한다 — `FE_RAIL_ALLOW_PW_INSTALL=1`(자동 설치 허용) 또는 `npx playwright install` 수동 실행.
4. **빨강이면** `fe-build-fixer` 에 실패 요약을 넘겨 최소 수정 → **같은 지점에서** 게이트를 1회 다시 돈다(코드가 바뀌었으므로
   가벼운 묶음 포함). 같은 실패 군 3회 초과 → "재위임 상한·실패 출구"로. 이 단계의 수정은 STOP 2 에서 사용자가 본 코드가
   아니므로, 6-1 보고와 PR 에 «6-0 게이트 수정» 으로 파일·이유를 따로 적는다.
5. 6-0 과 6-1 사이에는 코드를 바꾸지 않는다. 6-1 이 끝나면 **커밋 트리(`git rev-parse HEAD^{tree}`)가 6-0 의 검증 트리 id 와
   같을 때만** 검증 결과 객체의 대상 리비전을 push SHA 로 이어 붙인다(`6-0 검증 트리 <id> = 커밋 <SHA> 의 트리`).
   «편집이 없었다» 는 판단으로 잇지 않는다 — 트리 비교만이 근거다. 다르면:
   작업 트리가 커밋과 같아졌으면(`git status --porcelain` 이 비어 있음 · 예: 커밋 훅이 파일을 고치고 다시 스테이징) 그 SHA 에서
   2~4 를 다시 돌고, 아니면 이어 붙이지 않고 PR 에 «미검증 — 커밋 트리 ≠ 검사 트리» 로 적는다. 같은 dirty 작업 트리에서
   다시 돌리는 것으로는 해결되지 않는다(검사 트리가 또 커밋과 다르다).

> **CI 위임(A안)**: `--ci-live` 면 1(동기화)은 그대로 하고, 2 의 build·e2e 는 로컬 실행 대신 "CI(push 후)에서 검증" 으로 위임한다.
> 기본(플래그 없음)은 로컬 실행(B안)이 floor — `buildspec.yml`·`.github/workflows` 등 *설정 파일 존재*만으로
> CI 가 살아있다고 가정하지 않는다.
> **건너뛰기**: `--skip-e2e` 면 2 에서 e2e 만 생략하고(build 는 돈다) 6-1 보고·PR 에 "E2E 미검증" 을 명시한다.
> 6-1 보고에는 6-0 결과를 그대로 노출한다 — 예: "빌드: 통과 · E2E: 미실행(브라우저 미설치)" / "빌드·E2E: push 후 CI 에서 검증".

#### 6-1. `fe-git-operator` 위임 — 커밋 & 푸시

전달할 컨텍스트:
- Phase 2에서 작성/수정한 **파일 목록** (명시적 스테이징 대상 — 신규 파일 포함 · 6-0 게이트 수정 파일 포함)
- 기능명, 주요 변경사항 요약, 관련 이슈 번호
- 6-0 게이트 수정(있으면) — 커밋 본문에 «6-0 게이트 수정» 으로 드러낸다

에이전트가 책임지는 것:
- 시작 상태 기록 — 사용자가 먼저 staged 해 둔 범위 밖 파일은 커밋에 넣지 않고 그대로 둔다(`git commit --only -- <파일>`)
- 명시적 파일 스테이징 (절대 `git add -A` / `git add .` 사용 금지)
- 논리 단위별 커밋 분리, 컨벤셔널 커밋 메시지 작성
- `git push -u origin HEAD` (기본 브랜치 직접 push 금지) → **push 완료 SHA·브랜치·remote** 를 결과로 돌려준다

#### 6-2. `fe-pr-author` 위임 — PR 생성

전달할 컨텍스트:
- feature.md 경로
- 커밋 범위 (base..HEAD) · 브랜치/remote/base · 6-1 의 push 완료 SHA
- Phase 4 리뷰 요약 (통과/경고 항목)
- **검증 결과 객체** (Phase 3·4.5·6-0 최종 — 6-0 의 5 에서 커밋 트리가 검증 트리와 같아 push SHA 에 이어 붙인 것 · 미검증 사유·skip 포함) — PR 의 `## 테스트` 체크리스트는 이것으로 채운다
- 6-0 동기화 결과(대상·가져온 커밋 수) · 6-0 게이트 수정(있으면 — `## 리뷰 포인트` 에 «STOP 2 이후 수정» 으로 올린다)
- 플래그: `--ci-live` / `--skip-e2e` / `--no-draft`

에이전트가 책임지는 것:
- PR 제목·본문 작성 (변경사항·완료 기준 체크리스트 포함 — 검증 객체에 없는 항목은 [x] 로 표기하지 않는다, `--ci-live` 분은 "CI 대기")
- 호스트 감지 후 PR 생성 (GitHub `gh pr create --draft` / CodeCommit `aws codecommit create-pull-request` / 그 외 호스트는 만들지 않고 보고) — push 는 6-1 에서 끝났으므로 미푸시일 때만 폴백
- 메인 세션은 **PR URL만** 결과로 받음

> PR은 기본 draft로 생성합니다. 준비되면 직접 ready for review로 전환하세요.
> `--no-pr` 플래그가 켜져 있으면 6-2는 건너뜁니다.

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--plan-only` | Phase 1까지만 (계획 확인만) |
| `--no-pr` | 커밋·푸시까지만(6-0 → 6-1), PR 생성(6-2) 안 함 |
| `--no-draft` | PR을 바로 ready 상태로 생성 |
| `--ci-live` | push 후 CI 가 build·e2e 를 실제로 돌린다고 선언 → Phase 6-0 의 무거운 게이트를 로컬 대신 CI 에 위임 (base 동기화는 그대로) |
| `--skip-e2e` | Phase 6-0 로컬 E2E 생략 (build 는 실행 · STOP 2·6-1 보고·PR 에 "E2E 미검증" 명시) |

> 환경변수 `FE_RAIL_ALLOW_PW_INSTALL=1` — Phase 6-0 에서 Playwright 브라우저를 자동 설치(`playwright install --with-deps chromium`)하도록 허용한다. 기본은 꺼짐(수백 MB 다운로드 + `--with-deps` 의 root 권한 요구를 자동 파이프라인이 무통보로 유발하지 않기 위함). 꺼진 상태에서 브라우저가 없으면 E2E 는 "미실행(브라우저 미설치)" 로 정직 보고된다.

> **신규 도입 순서(권장)**: `--plan-only`(계획만) → `--no-pr`(커밋까지) → 풀 파이프라인.
> 핵심 워크플로에 전면 적용하기 전, 제한 범위에서 비용·효과를 먼저 확인한다.
