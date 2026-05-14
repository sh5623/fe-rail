# fe-rail — Claude 에이전트 컨텍스트

> **하네스 엔지니어링 원칙**: Agent = Model + Harness
> 이 저장소는 프론트엔드 프로젝트 전용 Claude Code 플러그인이다.
> 다른 프로젝트에 설치하여 사용하는 **하네스(Harness)** 이지, 그 자체가 애플리케이션 프로젝트가 아니다.

---

## 이 저장소의 목적

`fe-rail`은 프론트엔드 개발 워크플로우를 표준화하는 Claude Code 플러그인이다.
모노레포 환경과 React / Vue / Angular 멀티 프레임워크를 지원하며,
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
│   ├── fe-build-fixer.md  ← build: tsc/eslint 오류 수정
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
│   └── fe-doc-sync/       ← CLAUDE.md·README.md 문서 동기화
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
/fe-rail:fe-doc-sync  # 변경사항 → CLAUDE.md·README.md 동기화
```

### 대상 프로젝트 유형

이 플러그인은 다음 환경에서 동작한다:

| 환경 | 지원 여부 | 비고 |
|------|----------|------|
| React + TypeScript | ✅ | Next.js 포함, 기본 최적화 대상 |
| Vue 3 + TypeScript | ✅ | Composition API 기준 |
| Angular | ✅ | standalone component 기준 |
| 모노레포 | ✅ | 아래 별도 섹션 참조 |
| Vite / Webpack | ✅ | 번들러 무관 |

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
| 린트 | ESLint 경고 0개 |
| 테스트 | Vitest + Testing Library, 주요 인터랙션 커버 |
| 접근성 | WCAG AA — `aria-label`, 키보드 네비게이션 |
| 반응형 | 375px / 768px / 1280px 기준 |
| 성능 | 이미지 최적화, 불필요한 리렌더링 없음 |

### 검증 명령어

```bash
# 프로젝트 루트 또는 앱 디렉토리에서 실행
pnpm tsc --noEmit    # 타입 에러
pnpm lint            # ESLint
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
