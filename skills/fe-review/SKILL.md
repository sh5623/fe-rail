---
name: fe-review
description: >-
  Reviews implemented frontend code from multiple angles.
  Use when: after implementation is done, before committing, before creating a PR, or when code quality needs checking.
  Do NOT load for: writing specs, implementing new features.
allowed-tools:
  - Read
  - Bash
  - Task
  - Agent
---

# FE Review 스킬

구현된 코드를 타입·성능·a11y·품질 4개 축으로 병렬 검토합니다.

## When to Use

- 구현 완료 직후
- 커밋 전 마지막 품질 게이트
- PR 생성 전

## Instructions

### Phase 1 — 에이전트 위임

리뷰는 직접 수행하지 않고 전담 에이전트에 위임한다:

| 에이전트 | 역할 | 위임 조건 |
|---------|------|---------|
| `fe-reviewer` | 타입·성능·a11y·품질 4축 기본 리뷰 | 항상 |
| `fe-a11y-auditor` | WCAG AA 정밀 감사 | fe-reviewer에서 접근성(a11y) BLOCK/WARN 발생 시 |
| `fe-perf-auditor` | 번들·Image·Font·Tailwind purge 정밀 감사 (Next.js / Vite SPA 공통) | fe-reviewer에서 성능 BLOCK/WARN 발생 시 |
| `fe-test-runner` | 테스트 실행·실패 분류 | 항상 (스택트레이스는 에이전트 내부에서 처리) — 단 같은 세션에 **같은 검증 트리 id·명령·cwd** 의 결과가 이미 있으면(fe-start 검증 결과 객체) 다시 돌리지 않고 그 결과를 인용한다. 트리 id 가 다르거나 명령·cwd 가 다르면 재실행 |
| `fe-refactor-advisor` | 리팩토링 방향 분석 | 명시적 요청 시 |

모든 에이전트는 READ-ONLY — 메인 세션이 결과를 받아 수정 여부를 결정한다.

### Phase 2 — 리뷰 결과 보고 (합산 판정)

`fe-reviewer` 의 출력을 본문으로 전달하되, **"커밋 준비 완료" 판정은 메인이 합산해서 내린다** — reviewer BLOCK 0
**그리고** `fe-test-runner` exit 0 **그리고** 추가 감사(a11y·perf) BLOCK 0 일 때만. 테스트가 실패했는데 reviewer
BLOCK 이 0 이라고 "준비 완료" 로 적지 않는다. 요약 줄에 각 소스의 결과를 나란히 적는다:
`리뷰 BLOCK 0 · 테스트 exit 0 (42/42) · a11y BLOCK 0 → 커밋 준비 완료` / `리뷰 BLOCK 0 · 테스트 exit 1 (2 실패) → 수정 후 재검토`.
변경 파일에 단위 테스트가 있으면 `fe-rail verify-test status -- <테스트 파일…>` 로 회귀 테스트 확인 기록을 함께 적는다(합산 판정의 조건은 아니다 —
`테스트 확인: 검출 2 · 미검출 1` / `테스트 확인: 기록 없음`). 미검출 · 원인 미확인은 `fe-reviewer` 의 «테스트 판별력» 축과 함께 보고한다.
위임 컨텍스트에는 **변경 파일 목록(신규 파일 포함)** 을 넘긴다 — 에이전트는 tracked diff ∪ untracked 와 교차 확인한다.
그리고 **`docs/framework-rules.md` 의 절대경로**(이 스킬이 로드될 때 주어진 base directory 기준 `../../docs/framework-rules.md`)를 함께 넘긴다 — `fe-reviewer`·`fe-perf-auditor` 는 그 파일의 «공통 규칙» 절 + 해당 프레임워크 절을 판정 근거로 쓴다(소비자 프로젝트 CLAUDE.md 가 우선). 에이전트는 플러그인 트리 위치를 모르므로 경로 없이 위임하면 내장 기준만으로 판정하고 그 사실을 보고 첫 줄에 적는다. 모노레포면 `../../docs/monorepo.md` 경로도 넘긴다.

형식:

```
## 코드 리뷰 결과

### BLOCK (커밋 전 반드시 수정)
- [축] file:line — 문제
  - Before: ...
  - After: ...

### WARN (권장 수정)
- [축] file:line — 문제

### INFO (참고)
- [축] file:line — 내용

---
요약: BLOCK N개 / WARN N개 / INFO N개 · 테스트 exit N (Pass/Fail) · 추가 감사 BLOCK N개
전부 0 이면 "커밋 준비 완료", 하나라도 남으면 "N개 수정 후 재검토"
```

BLOCK 항목이 있으면 수정 후 에이전트 재위임합니다.
