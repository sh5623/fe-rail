# fe-rail — Claude 에이전트 컨텍스트

> **하네스 엔지니어링 원칙**: Agent = Model + Harness
> 이 저장소는 프론트엔드 프로젝트 전용 Claude Code 플러그인이다.
> 다른 프로젝트에 설치하여 사용하는 **하네스(Harness)** 이지, 그 자체가 애플리케이션 프로젝트가 아니다.

---

## 이 저장소의 목적

`fe-rail`은 프론트엔드 개발 워크플로우를 표준화하는 Claude Code 플러그인이다.
React + TypeScript 환경(Next.js App Router / Vite SPA 모두)을 대상으로 하며,
**spec → build → review → PR** 사이클을 강제하여 에이전트 출력 품질을 일관되게 유지한다.

---

## 하네스 구조 (Harness Layers)

```
fe-rail/
├── CLAUDE.md              ← 에이전트 컨텍스트 (이 파일)
├── agents/                ← 14개 서브에이전트 (spec·build·review·PR 단계별)
│   ├── fe-analyst.md      ← spec: 요구사항 갭 분석
│   ├── fe-vision.md       ← spec: Figma·스크린샷 분석
│   ├── fe-researcher.md   ← spec: 외부 문서 조사
│   ├── fe-architect.md    ← spec: 아키텍처 자문
│   ├── fe-explorer.md     ← build: 코드베이스 탐색
│   ├── fe-test-author.md  ← build: BDD·TDD 테스트 작성
│   ├── fe-build-fixer.md  ← build: tsc·린터(ESLint/Biome) 오류 수정
│   ├── fe-reviewer.md     ← review: 4축 코드 리뷰
│   ├── fe-a11y-auditor.md ← review: a11y 정밀 감사
│   ├── fe-perf-auditor.md ← review: 성능 정밀 감사
│   ├── fe-test-runner.md  ← review: 테스트 실행·분류
│   ├── fe-refactor-advisor.md ← review: 리팩토링 분석
│   ├── fe-git-operator.md ← PR: 커밋 분리·스테이징
│   └── fe-pr-author.md    ← PR: PR 본문 작성·생성
├── hooks/
│   └── hooks.json         ← Pre/PostToolUse·Stop 훅
├── skills/
│   ├── fe-spec/           ← 기획 → 스펙 변환
│   ├── fe-build/          ← 스펙 → 코드 구현
│   ├── fe-review/         ← 4축 코드 리뷰
│   ├── fe-start/          ← 원스톱 자동화 (spec→PR)
│   └── fe-doc-sync/       ← 설치된 사용자 프로젝트 스캔 → 그 프로젝트의 CLAUDE.md·README.md 동기화
└── .claude/
    └── settings.local.json ← Bash 권한 화이트리스트
```

### 레이어별 역할

| 레이어 | 파일 | 역할 |
|--------|------|------|
| **CLAUDE.md** | 이 파일 | 에이전트가 프로젝트를 이해하는 최우선 컨텍스트 |
| **Skills** | `skills/*/SKILL.md` | 작업 유형별 전문화된 지침 (도구 제한 포함) |
| **Agents** | `agents/*.md` | spec·build·review·PR 단계별 격리 서브에이전트 (14개) |
| **Hooks** | `hooks/hooks.json` | Pre/PostToolUse·Stop 이벤트 자동 실행 사이드이펙트 |
| **Permissions** | `settings.local.json` | Bash 명령어 화이트리스트로 에이전트 권한 제한 |

---

## 지원 MCP 플러그인

하네스가 최적으로 동작하려면 다음 MCP 플러그인이 설치되어 있어야 한다.
각 플러그인은 특정 에이전트의 `tools` 목록에 등록되어 있으며, 없으면 해당 에이전트가 fallback 동작으로 전환된다.

| MCP | 설치 형태 | 연결 에이전트 | 도구 접두사 | 없을 때 fallback |
|-----|----------|-------------|-----------|----------------|
| **Figma** | 프로젝트/사용자 `.mcp.json` 서버 (이름: `Figma`) | `fe-vision` | `mcp__Figma__get_figma_data`<br>`mcp__Figma__download_figma_images` | 로컬 스크린샷(PNG/JPG)만 분석 |
| **Context7** | Claude Code 플러그인 | `fe-researcher` | `mcp__plugin_context7_context7__resolve-library-id`<br>`mcp__plugin_context7_context7__query-docs` | WebSearch + WebFetch로 문서 조회 |

> **도구 접두사는 설치 형태에 따라 달라진다.** 플러그인으로 설치하면 `mcp__plugin_<플러그인>_<서버>__*`, 사용자/프로젝트 `.mcp.json`으로 등록하면 `mcp__<서버>__*` 형식이다. 에이전트 `tools` 목록의 접두사가 실제 설치 형태와 일치해야 도구가 인식되며, 불일치 시 fallback으로만 동작한다. (위 표는 각각의 설치 형태 기준으로 검증된 접두사다.)

### 설치

- **Context7** (플러그인): `/plugin install context7@<marketplace>` → `/reload-plugins`. 도구는 `mcp__plugin_context7_context7__*` 로 등록된다.
- **Figma** (프로젝트 MCP 서버): 프로젝트 `.mcp.json` 에 `Figma` 라는 이름으로 서버를 등록한다 (예: `figma-developer-mcp`, 토큰은 환경변수로 주입). 도구는 `mcp__Figma__*` 로 등록된다.

---

## 모델 티어 정책

각 에이전트의 `model`은 **별칭**(`opus`/`sonnet`/`haiku`)으로 지정한다. 풀 버전 ID를 고정하지 않는다.

| 티어 | 에이전트 | 기준 |
|------|---------|------|
| **opus** | fe-analyst · fe-architect · fe-reviewer · fe-refactor-advisor | 추론·판단 집약, 게이트 역할 (오탐/누락 비용 큼) |
| **sonnet** | 위·아래를 제외한 실행·도구 계열 전부 | 구현·수정·실행 등 |
| **haiku** | fe-explorer | 단순 코드 탐색, 비용 효율 우선 |

- **별칭의 의미**: 모델 패밀리 업데이트(예: Opus 4.7 → 4.8) 시 자동으로 최신 티어를 사용한다. 별도 수정 없이 개선이 반영되지만, 플러그인 버전이 같아도 동작이 변동될 수 있다.
- **재현성 점검**: 안정성이 중요한 경우 릴리스마다 현재 별칭 해상도 기준으로 회귀를 확인한다.
- **티어 변경 원칙**: "전부 opus화" 금지. 고판단 게이트만 선별 상향하고, 탐색·기계적 작업은 저비용 티어를 유지한다.

---

## 워크플로우

```
사용자 요청
    │
    ▼
fe-spec  →  feature.md 생성 (사용자 승인 필요)
            └─ 에이전트: fe-analyst·fe-vision·fe-researcher·fe-architect
    │
    ▼
fe-build →  타입 → 비즈니스 로직 분리 → 컴포넌트 → 테스트 순서로 구현
            └─ 에이전트: fe-explorer·fe-test-author·fe-build-fixer
    │
    ▼
fe-review → 4축 검토 (타입·성능·a11y·품질)
            └─ 에이전트: fe-reviewer·fe-a11y-auditor·fe-perf-auditor·fe-test-runner·fe-refactor-advisor
    │
    ▼
커밋 & PR  →  git + gh CLI (사용자 승인 필요)
            └─ 에이전트: fe-git-operator·fe-pr-author
```

**원스톱 자동화**: `fe-start` 스킬이 위 전체 흐름을 자동으로 처리한다.
사람 개입은 "구현할까요?"와 "커밋할까요?" 두 번뿐이다.

---

## 다른 프로젝트에 적용하기

### 설치 방법

```bash
# Claude Code 내에서
/plugin marketplace add sh5623/fe-rail
/plugin install fe-rail@fe-rail-market
```

### 스킬 호출

```bash
/fe-rail:fe-spec     # 기능 요구사항 → feature.md
/fe-rail:fe-build    # feature.md → 코드 구현
/fe-rail:fe-review   # 코드 리뷰
/fe-rail:fe-start feature.md  # 원스톱 자동화
/fe-rail:fe-doc-sync  # 설치된 프로젝트 스캔 → 그 프로젝트의 CLAUDE.md·README.md 동기화
```

### 설치 후 권장 설정 (소비자 프로젝트)

에이전트는 **소비자 프로젝트의 컨텍스트를 읽어** 추론한다. 설치 직후 아래를 갖추면 출력 품질이 크게 올라간다.

1. **프로젝트 CLAUDE.md 생성** — `fe-analyst`·`fe-architect`는 소비자 프로젝트의 CLAUDE.md에서 스택·규칙을 읽는다. 이 플러그인의 CLAUDE.md는 소비자 세션에 로드되지 않으므로, 소비자가 자체 CLAUDE.md를 두지 않으면 에이전트가 빈손으로 분석한다. → `/init` 또는 `/fe-rail:fe-doc-sync` 실행.
2. **Bash 권한 허용** — 소비자 `.claude/settings.json`의 `permissions.allow`에 `Bash(git *)`·`Bash(gh pr *)`를 추가하면 PR 단계 에이전트가 매번 권한 프롬프트 없이 동작한다.
3. **MCP (선택)** — Figma·Context7 미설치 시 `fe-vision`·`fe-researcher`는 fallback(로컬 이미지·WebSearch)으로 동작한다. 위 "지원 MCP 플러그인" 참조.

### 대상 프로젝트 유형

이 플러그인은 다음 환경에서 동작한다:

| 환경 | 지원 여부 | 비고 |
|------|----------|------|
| Next.js + TypeScript | ✅ | App Router 기준, RSC 최적화 포함 |
| Vite + React + TanStack Router | ✅ | Zustand 규칙 내장 |
| Tailwind CSS (직교) | ✅ | 디자인 토큰·`cn()`·`@apply` 정책·content/purge·대비 점검 — Next.js / Vite 공통 |
| shadcn/ui (직교) | ✅ | UI primitives 격리·`cva()` variant·래핑 패턴 — Tailwind 위에서 동작 |
| 모노레포 | ✅ | 아래 별도 섹션 참조 |

---

## 모노레포 지원

@docs/monorepo.md

---

## 프레임워크별 코딩 규칙

@docs/framework-rules.md

---

## 공통 품질 기준 (프레임워크 무관)

모든 구현은 다음 기준을 충족해야 커밋이 허용된다.

| 항목 | 기준 |
|------|------|
| TypeScript | `any` 타입 0개, strict mode |
| 린트 | 린터(ESLint 또는 Biome) 경고 0개 |
| 테스트 | Vitest + Testing Library, 주요 인터랙션 커버 |
| 접근성 | WCAG AA — `aria-label`, 키보드 네비게이션 |
| 반응형 | 375px / 768px / 1280px 기준 |
| 성능 | 이미지 최적화, 불필요한 리렌더링 없음 |

### 검증 명령어

```bash
# 프로젝트 루트 또는 앱 디렉토리에서 실행
pnpm tsc --noEmit    # 타입 에러
pnpm lint            # 린트 (ESLint 또는 Biome — 프로젝트 설정에 따라)
pnpm test --run      # 테스트
```

---

## 에이전트 행동 원칙

### 반드시 지킬 것

- **스펙 먼저** — `feature.md` 없이 코드 작성 시작 금지
- **사용자 승인 두 번** — 구현 시작 전, 커밋 전
- **타입 먼저** — 구현 순서: 타입 정의 → 훅/서비스 → 컴포넌트 → 테스트
- **검증 후 보고** — 자동 검증(`tsc`, `lint`, `test`) 통과 후 완료 선언

### 하지 말 것

- `any` 타입 사용
- 스펙 없이 "대충 이런 방향으로" 구현
- 테스트 없이 완료 선언
- `console.log`를 코드에 남기기
- 패키지 경계를 무시한 직접 import (모노레포)
- 에이전트가 자신의 격리 범위(`disallowedTools`)를 벗어나 행동

---

## 권한 및 보안

`settings.local.json`에 정의된 허용 명령어 외 Bash 실행은 사용자 확인을 받는다.

현재 허용된 명령어:
- `git *` — 버전 관리 전 범위
- `gh repo *` — GitHub CLI PR/리포지토리 관련

---

## 기반 레퍼런스

- [Harness Engineering for Coding Agents — Humanlayer](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
