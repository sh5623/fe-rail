# fe-rail

<div align="right">
  <a href="README.ko.md"><img src="https://img.shields.io/badge/lang-한국어-blue?style=flat-square" alt="한국어"/></a>
  <a href="README.md"><img src="https://img.shields.io/badge/lang-English-lightgrey?style=flat-square" alt="English"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"/></a>
  <a href="https://github.com/sh5623/fe-rail/actions/workflows/eval.yml"><img src="https://img.shields.io/github/actions/workflow/status/sh5623/fe-rail/eval.yml?branch=main&amp;style=flat-square&amp;label=eval" alt="eval"/></a>
  <a href="https://www.claudepluginhub.com/plugins/sh5623-fe-rail?ref=badge"><img src="https://www.claudepluginhub.com/badge/sh5623-fe-rail" alt="Listed on ClaudePluginHub"/></a>
</div>

> 프론트엔드 프로젝트 전용 Claude Code 플러그인
> spec → build → review → PR 자동화 워크플로우. Next.js App Router / Vite SPA(TanStack Router·React Router 7·8) + TypeScript, Tailwind v3/v4와 shadcn/ui를 지원합니다.

## 설치

```bash
claude

/plugin marketplace add sh5623/fe-rail
/plugin install fe-rail@fe-rail-market
```

> [self-improvement](https://github.com/sh5623/self-improvement)도 같이 쓴다면, 마켓 하나로 두 개 다 설치: [`sh5623/guardrail`](https://github.com/sh5623/guardrail).

![fe-rail 워크플로우: spec, build, review, PR](docs/assets/workflow.svg)

## 사용 예시

```
$ claude
> /fe-rail:fe-spec

[fe-spec] 요구사항 분석 중... (fe-analyst, fe-architect)
✔ feature.md 생성 완료: 7개 섹션, 미해결 질문 3건 해소

다음 단계?
  ❯ 풀 자동 (추천): fe-start 파이프라인으로 자동 연결
    구현만: 스펙 먼저 검토
    스펙 수정

> 풀 자동

[fe-start] Phase 2: 타입 → 훅 → 컴포넌트 → 테스트 구현 중
✔ 12개 파일 생성, tsc 통과, lint 통과, 테스트 8개 통과

커밋하고 PR을 열까요?
  ❯ 예: type별로 분리해서 드래프트 PR 생성
    아니오: 변경사항만 남기고 종료

> 예

✔ 커밋 2개 생성
✔ feat/product-search-autocomplete 브랜치로 푸시
✔ 드래프트 PR: https://github.com/you/your-app/pull/42
```

사람이 개입하는 지점은 "구현할까요?"와 "커밋할까요?" 두 번입니다. 나머지는 전부 자동으로 진행됩니다.

## 포함된 스킬

| 스킬 | 명령어 | 설명 |
|------|--------|------|
| fe-spec | `/fe-rail:fe-spec` | 기능 요구사항 → 구조화된 스펙 문서 생성. Phase 3 에서 다음 단계(풀 자동·구현만·스펙 수정)를 라디오 UI로 선택하고, "풀 자동"을 고르면 fe-start 파이프라인으로 자동 연결 |
| fe-build | `/fe-rail:fe-build` | 프론트엔드 코드 구현 (타입→로직 분리→컴포넌트→테스트) |
| fe-review | `/fe-rail:fe-review` | 타입·성능·a11y·품질 4축 리뷰 |
| fe-start | `/fe-rail:fe-start feature.md` | 위 3개를 하나로 묶어 PR까지 자동화. Phase 1과 5가 라디오 UI로 진행 여부·커밋 방식 확인 |
| fe-doc-sync | `/fe-rail:fe-doc-sync` | **설치된 사용자 프로젝트** 스캔 (라우트·의존성·구조·ENV) → 그 프로젝트의 CLAUDE.md·README.md 수정안 제안 |

## 포함된 Hooks

정책: 위험은 차단(exit 2), 품질은 경고(stderr).

| Hook | 이벤트 | 역할 | 차단 |
|------|--------|------|------|
| `session-init.sh` | SessionStart | 원격 버전 체크 + 새 버전 알림 (GitHub, 하루 1회) | — |
| `guard.sh` | PreToolUse:Bash | `git add .`, force push, `--no-verify`, `rm -rf /`, `DROP TABLE`, `git reset --hard`, `git checkout/restore .` 등 차단. git 전역 옵션(`git -C <dir> …`·`-c k=v`·`--git-dir`)을 먼저 정규화하고 셸 래핑(`bash -c "git commit --no-verify …"`)도 잡는다. 커밋 검사에서 제외하는 것은 `-m` 메시지 값뿐이다. 흔한 형태에 대한 정규식 백스톱이지 임의 셸 전체의 보장은 아니다 | ✅ |
| `write-guard.sh` | PreToolUse:Write\|Edit\|MultiEdit | `.env*`·인증서(`*.pem`/`*.key` 등)·시크릿 페이로드 파일(`*.secret`·`*credentials*.json` 등) 생성·수정 차단 (`.env.example`·`CredentialForm.tsx` 같은 소스 파일은 허용) | ✅ |
| `config-protection.sh` | PreToolUse:Write\|Edit\|MultiEdit | 린터/포매터/TS 설정 **약화** 편집만 차단: `strict:false`·`@ts-nocheck`·린터 `recommended:false`·기존 `strict:true` 제거. 편집 조각이 아니라 실파일의 편집 전 ↔ 후 전체(디스크 내용 + Edit/MultiEdit/Write 페이로드로 재구성)를 비교하므로, 값만 바꾸는 `true → false` Edit 과 `strict` 키를 뺀 Write 도 잡는다. 경로 alias·플러그인 추가 등 정상 편집은 통과 | ✅ |
| `read-guard.sh` | PreToolUse:Read | 민감 파일 읽기 시도 경고 출력 (`.env*`·`.envrc`, `*.pem`/`*.key`/`id_rsa` 등 키, `.npmrc`·`*credential*`. 목록은 write-guard 차단 목록과 대칭) | — |
| `task-guard.sh` | PreToolUse:Task\|Agent | 서브에이전트 프롬프트 내 인젝션 패턴·위험 명령 위임 차단 | ✅ |
| `lint-fix.sh` | PostToolUse:Edit\|Write\|MultiEdit | 소비자 환경 감지 → Biome `check --write` **또는** ESLint `--fix`(+Prettier) 자동 적용. 설정·바이너리는 파일에서 가장 가까운 `package.json`(모노레포 앱 로컬 설정) 기준으로 찾고 바이너리는 root-hoisted 도 탐색 (로컬 바이너리 우선, npx 폴백은 `FE_RAIL_ALLOW_NPX=1` 옵트인) | — |
| `nextjs-guard.sh` | PostToolUse:Edit\|Write\|MultiEdit | App Router 프로젝트(`app/` 존재, Pages Router 는 건너뜀)에서 `'use client'` 없는 파일의 React 훅/브라우저 API/DOM 이벤트를 «import 경계 확인 필요» 로 안내(클라이언트 경계 아래에서만 import 되는 자식은 지시어 불필요, 확정 근거는 `next build`), `page`/`layout`의 `'use client'` 경고 | — |
| `design-nudge.sh` | PostToolUse:Edit\|Write\|MultiEdit | 프론트 편집에 제네릭/템플릿틱(AI slop) 신호(무거운·임의 그림자, 기본 보라/인디고 그라디언트) 감지 시 경고. DESIGN.md 가 있으면 침묵한다(fe-reviewer 의 DESIGN Bans 가 정본) | — |
| `quality-gate.sh` | Stop | 변경 파일에 린터(Biome **또는** ESLint) + 타입체크를 실행하고 경고를 출력한다. 타입체크는 프로젝트 `typecheck` 스크립트를 우선하고(루트 `tsconfig.json` 이 없어도 실행), 솔루션 tsconfig면 `tsc -b`로 폴백한다. 변경 파일을 가장 가까운 `package.json` 별로 묶어 패키지마다 그 설정으로 검사(모노레포), 바이너리는 앱 로컬 → root-hoisted 순. 타입체크는 종료코드로 판정(성공 배너 오탐 없음). `tsconfig*.json`/`package.json` 변경과 소스 삭제도 트리거이며, 검사 범위를 조용히 자르지 않는다(상한 200, 초과분은 미검사로 명시) | — |
| `doc-sync-check.sh` | Stop | 사용자 프로젝트의 코드(src/app/pages/components 등)·package.json·설정 파일 변경 감지 시 `/fe-rail:fe-doc-sync` 실행 안내 (최근 커밋 5개 포함) | — |
| `notify.sh` | (옵션) Notification | macOS terminal-notifier 배너 알림. `bash hooks/scripts/setup-notifier.sh` 로 활성화 | — |

### 훅 프로파일 · 토글 (강도 조절)

훅 강도를 환경변수로 조절할 수 있습니다. 플러그인 파일을 수정할 필요 없이 소비자 프로젝트의 셸이나 `.claude` 환경에서 설정합니다.

| 환경변수 | 값 | 효과 |
|---|---|---|
| `FE_RAIL_HOOK_PROFILE` | `minimal` | 비가역 위험 차단기만 (`guard`·`write-guard`·`task-guard`·`config-protection`). 품질 경고·자동정리·문서동기화 안내는 끔 |
| | `standard` (기본) | 위 + 품질 경고·자동정리·문서동기화 전부 |
| | `strict` | `standard` 상위 티어(현재는 상위집합, 향후 더 엄격한 동작 예약) |
| `FE_RAIL_DISABLED_HOOKS` | `"a,b"` | 특정 훅만 콕 집어 비활성 (예: `"doc-sync-check,design-nudge"`) |
| `FE_RAIL_ALLOW_NPX` | `1` | 로컬 린터·`tsc` 바이너리가 없을 때 npx 폴백 허용. 기본은 로컬 전용이라 자동 훅이 네트워크 다운로드나 미고정 최신버전 실행을 하지 않는다. 프로젝트 자체 `typecheck` 스크립트는 패키지 매니저로 실행되므로 이 옵트인과 무관하게 항상 허용 |
| `FE_RAIL_ALLOW_PW_INSTALL` | `1` | fe-start Phase 4.5 게이트가 Playwright 브라우저를 자동 설치(`playwright install --with-deps chromium`)하도록 허용. 기본은 꺼짐이다. 수백 MB 다운로드에 `--with-deps` 는 root 권한을 요구하므로 무인 파이프라인이 무통보로 유발하지 않게 한다. 꺼진 상태에서 브라우저가 없으면 E2E 는 통과가 아니라 "미실행(브라우저 미설치)" 로 정직하게 보고한다 |

> 프로파일을 `minimal`로 낮춰도 안전 차단기는 꺼지지 않습니다. 차단기를 끄려면 `FE_RAIL_DISABLED_HOOKS` 에 이름을 명시해야 합니다(타협 없는 차단에 명시적 탈출구를 더한 구조). 세션 시작 시 기본이 아닌 프로파일/비활성 목록이 있으면 안내됩니다.

### 회귀 eval

```bash
bash eval/run.sh   # 실패 시 exit 1 (CI 용)
```

라이브 모델 없이 결정적으로 검증합니다.

- 훅 동작: fixture 를 주입해 exit code 와 경고를 단언한다. 차단 사유가 stdout 이 아닌 stderr 로 전달되는지, 비차단 훅 5개의 안내도 stderr 로 나가는지 포함
- 프로파일 토글
- 플러그인 self-lint: agent `model` 값이 유효 범위(별칭 `opus`/`sonnet`/`haiku`/`fable`/`inherit` 또는 전체 모델 ID) 안인지, agent `effort` 값이 설정된 경우 `low`/`medium`/`high`/`xhigh`/`max` 안이고 `haiku`(미지원)에는 설정돼 있지 않은지, skill frontmatter, frontmatter 평문 스칼라의 YAML 안전성(값에 `: `(콜론+공백) 등이 들어가면 파싱이 실패해 `tools`·`disallowedTools`·`model` 이 전부 조용히 드롭된다), `hooks.json` 무결성과 프로파일 배선, 위임을 지시하는 스킬의 `allowed-tools`에 Task/Agent 포함 여부, bun `PX` 감지 일관성, `typecheck` 분기의 `references`(tsc -b) 폴백 동반 여부, 바이너리+플래그 실행이 `$PM exec` 아닌 `$PX`인지

별칭 티어가 모델 업데이트로 바뀌거나 훅과 설정을 고칠 때 회귀를 잡는 용도입니다.

v1.17.0 에 F 절이 추가됐습니다. v1.16.2 에 대한 교차 레포 리뷰가 임시 저장소에서 지적 12개를 재현했고, 그 각각이 이제 회귀로 고정돼 있습니다: git 전역 옵션·셸 래핑이 차단기에 닿는지, 설정 보호가 실파일 전 ↔ 후로 판정하는지, `hooks.json` 의 모든 command 를 공백 포함 설치 경로에서 실제 실행, 모노레포 앱 로컬·root-hoisted 도구가 실제 호출되는지, 루트 `tsconfig.json` 없이 `typecheck` 실행, 소스 삭제의 타입체크 트리거, 변경 파일 21개 중 21개가 린터에 전달되는지, `git commit --only` 격리 계약, 그리고 에이전트 범위(tracked ∪ untracked)·exit code 보존·`$PM run test`·검증 결과 객체 계약·푸시 담당의 self-lint. `ruby` 나 `claude` CLI 가 있으면 실제 YAML 파서로 frontmatter 를 파싱하고 `claude plugin validate --strict` 도 돌립니다.

v1.18.0 은 프레임워크 규칙이 실제로 소비자에게 닿게 합니다. `docs/framework-rules.md`·`docs/monorepo.md` 는 그동안 이 레포 자체의 `CLAUDE.md` 가 `@import` 할 뿐이었는데, 소비자 세션은 그 파일을 로드하지 않으므로 어떤 에이전트도 본 적이 없었습니다. 이제 fe-build, fe-review, fe-start, fe-spec 스킬이 스킬 base directory 기준으로 해당 절(공통 규칙 + 감지한 프레임워크)만 읽고, 위임하는 에이전트(`fe-architect`, `fe-reviewer`, `fe-build-fixer`, `fe-perf-auditor`)에 절대경로를 넘깁니다. 경로가 없으면 플러그인 캐시 glob 으로 폴백하고, 그것도 없으면 보고 첫 줄에 «규칙 파일 미수신» 을 적습니다. 같은 이유로 레포 자체의 `CLAUDE.md` 는 `.claude/CLAUDE.md` 로 옮겼습니다. 루트 `CLAUDE.md` 는 플러그인 트리에 실리면서 로드되지 않는 파일이고, `claude plugin validate --strict` 가 경고하는 것이 정확히 그 지점입니다. eval 은 이제 `--strict` 가 경고 0 으로 통과해야 하며, 루트 파일 부재와 규칙 배선을 self-lint 합니다.

## 포함된 Agents

각 agent는 별도 컨텍스트에서 동작하여 메인 세션을 노이즈로부터 보호합니다.
frontmatter(`tools`/`disallowedTools`/`model`/`maxTurns`) + XML 태그 구조(`<purpose>`/`<forbidden>`/`<required>`/`<workflow>`/`<output>`)로 구성됩니다.

> **모델 티어는 별칭입니다.** 각 agent의 `model`은 `opus`/`sonnet`/`haiku` 별칭으로 지정되어, Anthropic API 기준으로는 모델 패밀리 업데이트(예: Opus 4.8 → Opus 5) 시 자동으로 최신 티어를 사용합니다(2026-07 확인 기준 `opus`=Opus 5·`sonnet`=Sonnet 5·`haiku`=Haiku 4.5). Claude Platform on AWS·Amazon Bedrock·Google Cloud·Microsoft Foundry에서는 같은 별칭이 더 이전 세대를 가리킵니다. 같은 시점 기준 Claude Platform on AWS `sonnet`=Sonnet 4.6, Amazon Bedrock·Google Cloud `sonnet`=Sonnet 4.5, Microsoft Foundry `opus`=Opus 4.6·`sonnet`=Sonnet 4.5 입니다. 소비자의 provider별 정확한 해상도는 Claude Code의 model-config 문서로 확인하세요. 별도 수정 없이 개선이 반영되는 대신, 플러그인 버전이 동일해도 동작이 변동될 수 있습니다. 재현성이 중요한 경우 릴리스마다 현재 별칭 해상도 기준으로 회귀를 점검하세요.
> 티어 배분: **opus**(고판단: `fe-analyst`·`fe-architect`·`fe-reviewer`·`fe-refactor-advisor`) / **haiku**(저비용 탐색: `fe-explorer`) / **sonnet**(나머지 실행·도구 계열).
> **Effort는 세션 상속이 아니라 에이전트별로 고정합니다.** 그렇지 않으면 소비자가 `/effort max`로 세션을 여는 순간 fe-rail 서브에이전트 전체가 max로 돕니다. 판단 게이트·정밀 감사는 `high`, 코드 작성 루프(`fe-build-fixer`·`fe-test-author`)는 `xhigh`, 기계적 도구·조사 에이전트는 `medium`. `fe-explorer`(haiku)는 effort를 지원하지 않아 미설정입니다. 단 `xhigh`는 Sonnet 5·Opus 4.7 이상에서만 유효하므로, `sonnet`이 4.5/4.6으로 해상되는 3P provider에서 `fe-build-fixer`·`fe-test-author`가 effort 관련 오류를 내면 `high`로 낮춰 확인하세요.

### spec 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-analyst` | 요구사항 갭 분석 (6갭 / 7섹션); CLAUDE.md·DESIGN.md·PRODUCT.md·AGENTS.md 병렬 탐색 | opus | 책임 (read-only) |
| `fe-deck-reader` | PPT/기획서 분해: 다중 슬라이드를 정책·화면·흐름으로 (PDF/PNG 변환 경유) | sonnet | 책임 (read-only) |
| `fe-vision` | (추출) Figma·UI 스크린샷·PDF·PPT(변환) 개별 화면 분석 (Figma URL → `get_metadata`·`get_design_context`·`get_variable_defs`·`get_screenshot`; DESIGN.md Bans anti-slop 점검) · (대조) 구현 스크린샷 ↔ 레퍼런스 시각 충실도 판정 (visual-verdict; Figma=픽셀/PPT=구조, fe-start Phase 4.5) | sonnet | 책임 (read-only) |
| `fe-researcher` | 외부 문서·라이브러리 조사 (Context7 MCP 우선, WebSearch/WebFetch fallback) | sonnet | 도구 (Context7/WebSearch/WebFetch) |
| `fe-architect` | React/TS 아키텍처 자문: Next.js(RSC 경계) / Vite SPA(TanStack Router·React Router 7·8·Zustand) + Tailwind v3/v4·shadcn·openapi-fetch (직교 감지) | opus | 책임 (read-only) |

### build 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-explorer` | 코드베이스 탐색 3쿼리 이상 | haiku | 컨텍스트 |
| `fe-test-author` | BDD 시나리오 도출 + TDD Red-Green-Refactor | sonnet | 책임 (구현) |
| `fe-build-fixer` | tsc·린터(ESLint/Biome) 오류 최소 diff 수정 | sonnet | 도구 (Edit+Grep, Write/MultiEdit 금지) |

### review 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-reviewer` | 4축 리뷰 (타입·성능·a11y·품질). 성능 축은 React 훅 런타임 버그(cleanup 누락·async 경쟁조건·무한루프)까지 보고, Tailwind 안티패턴·openapi-fetch 패턴·DESIGN.md 디자인 계약(존재 시)도 점검한다 | opus | 책임 (read-only) |
| `fe-a11y-auditor` | a11y 8축 감사 (Color Contrast 포함, Tailwind 팔레트 기준). `--live` 시 Chrome DevTools MCP로 실제 Lighthouse a11y 감사·접근성 트리 스냅샷 병행, 미설치면 정적 분석만 | sonnet | 책임 (read-only) |
| `fe-perf-auditor` | 성능 정밀 감사: Next.js(RSC·next/image·next/font) / Vite SPA(TanStack loader·RR7·8 TQ prefetch·fetchpriority·번들) / Tailwind v3/v4(purge·@source·@apply). `--live` 시 Chrome DevTools MCP로 dev 서버 실측(LCP 분해·콘솔·네트워크) 병행, 미설치면 정적 분석만 | sonnet | 책임 (read-only) |
| `fe-test-runner` | 테스트 실행 + 실패 분류 | sonnet | 컨텍스트 |
| `fe-refactor-advisor` | 6차원 리팩토링 분석 + Before/After | opus | 책임 (read-only) |

### PR 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-git-operator` | 커밋 분리·사용자가 미리 스테이징한 인덱스를 건드리지 않는 스테이징(`git commit --only -- <파일>`) + 본문 작성 (fix=증상·원인·해결 / feat=추가·핵심·영향) · `git push` 담당 | sonnet | 도구 (Write/Edit 금지) |
| `fe-pr-author` | 검증 결과 객체 기반 PR 본문 작성 (성격별 🐛/✨ 블록 + 리뷰 포인트 위험순. 테스트 체크리스트는 exit code @ SHA 를 적고 추정으로 «통과» 를 쓰지 않는다) + `gh pr create` (푸시는 upstream 이 없을 때만 폴백) | sonnet | 컨텍스트 + 도구 |

## 워크플로우

**원스톱 자동화**
```
feature.md 작성 → /fe-rail:fe-start feature.md → "구현할까요?" 승인 → "커밋할까요?" 승인 → PR 생성 완료
```

> 재위임이 같은 항목을 3회 반복해도 안 풀리면 자동 진행을 멈추고 진단을 보고하는 예외 STOP 이 한 번 더 걸릴 수 있습니다.

**fe-spec 에서 이어가기 (핸드오프)**
```
/fe-rail:fe-spec → "다음 단계"에서 "풀 자동" 선택 → fe-start 자동 실행 → "커밋할까요?" 승인 → PR
```

> fe-spec 의 "다음 단계" 게이트가 첫 승인("구현할까요?")을 대신하므로 fe-start 는 "커밋할까요?"만 묻습니다 (전체 승인 2회 유지).

**단계별 수동 제어**
```
/fe-rail:fe-spec → /fe-rail:fe-build → /fe-rail:fe-review → git commit && gh pr create
```

## 전제 조건

- Claude Code
- 패키지 매니저 (pnpm / npm / yarn / bun, lock 파일로 자동 감지)
- gh CLI (PR 자동 생성 시)
- TypeScript strict mode (Next.js / Vite SPA)

## 설치 후 권장 설정 (소비자 프로젝트)

플러그인의 agent들은 소비자 프로젝트의 컨텍스트를 읽어 동작합니다. 설치 직후 아래를 갖추면 품질이 크게 올라갑니다.

| 항목 | 이유 | 방법 |
|------|------|------|
| **프로젝트 CLAUDE.md** | `fe-analyst`·`fe-architect` 등이 스택·규칙·금지사항을 읽어 추론한다. 없으면 빈손으로 분석한다 (이 레포의 `.claude/CLAUDE.md` 는 소비자 세션에 로드되지 않고, `docs/` 의 프레임워크 규칙은 스킬을 통해서만 에이전트에 닿는다. 위 v1.18.0 참조) | `/init` 또는 `/fe-rail:fe-doc-sync` |
| **Bash 권한** | `fe-git-operator`·`fe-pr-author` 흐름에서 매번 권한 프롬프트 방지 | 자동: 프로젝트 루트에서 `bash <설치경로>/hooks/scripts/setup-permissions.sh`(호스트 감지 → `.claude/settings.local.json` 병합, 확인 1회) · 수동: `.claude/settings.json`의 `permissions.allow`에 `Bash(git *)`·`Bash(gh pr *)` 추가 |
| **MCP (선택)** | `fe-vision`의 Figma 직접 조회, `fe-researcher`의 Context7 문서 조회, `fe-perf-auditor`/`fe-a11y-auditor`의 `--live` 실측 활성화 (미설치 시 각각 로컬 이미지·WebSearch·정적 분석으로 fallback) | Figma: claude.ai 커넥터(`/mcp` → "claude.ai Figma", OAuth) · Context7: 플러그인 설치 · Chrome DevTools: 플러그인 설치. 미설치 시 각 에이전트가 폴백하며 활성화 명령을 그 자리에서 안내(JIT) |
| **검증 스크립트** | Phase 3 자동 검증이 `typecheck`/`lint`/`test` 를, Phase 4.5 완료기준 게이트가 `build`/`e2e`(존재 시)를 사용 | 해당 스크립트 정의 권장 |

## 라이선스

[MIT](LICENSE) © 2026 이승호

## 기반 레퍼런스

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
