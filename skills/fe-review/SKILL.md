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
| `fe-test-runner` | 테스트 실행·실패 분류 | 항상 (스택트레이스는 에이전트 내부에서 처리) |
| `fe-refactor-advisor` | 리팩토링 방향 분석 | 명시적 요청 시 |

모든 에이전트는 READ-ONLY — 메인 세션이 결과를 받아 수정 여부를 결정한다.

### Phase 2 — 리뷰 결과 보고 (합산 판정)

`fe-reviewer` 의 출력을 본문으로 전달하되, **"커밋 준비 완료" 판정은 메인이 합산해서 내린다** — reviewer BLOCK 0
**그리고** `fe-test-runner` exit 0 **그리고** 추가 감사(a11y·perf) BLOCK 0 일 때만. 테스트가 실패했는데 reviewer
BLOCK 이 0 이라고 "준비 완료" 로 적지 않는다. 요약 줄에 각 소스의 결과를 나란히 적는다:
`리뷰 BLOCK 0 · 테스트 exit 0 (42/42) · a11y BLOCK 0 → 커밋 준비 완료` / `리뷰 BLOCK 0 · 테스트 exit 1 (2 실패) → 수정 후 재검토`.
위임 컨텍스트에는 **변경 파일 목록(신규 파일 포함)** 을 넘긴다 — 에이전트는 tracked diff ∪ untracked 와 교차 확인한다.

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
