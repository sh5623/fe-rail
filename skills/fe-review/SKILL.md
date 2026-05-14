---
name: fe-review
description: >-
  구현된 프론트엔드 코드를 다각도로 검토합니다.
  Use when: 구현 완료 후 커밋 전, PR 생성 전, 코드 품질 확인이 필요할 때.
  Do NOT load for: 스펙 작성, 신규 기능 구현.
allowed-tools:
  - Read
  - Bash
---

# FE Review 스킬

구현된 코드를 보안·성능·품질·접근성 4개 축으로 병렬 검토합니다.

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
| `fe-a11y-auditor` | WCAG AA 정밀 감사 | fe-reviewer에서 a11y BLOCK/WARN 발생 시 |
| `fe-perf-auditor` | RSC·번들·Image 정밀 감사 | fe-reviewer에서 성능 BLOCK/WARN 발생 시 |
| `fe-test-runner` | 테스트 실행·실패 분류 | 항상 (스택트레이스는 에이전트 내부에서 처리) |
| `fe-refactor-advisor` | 리팩토링 방향 분석 | 명시적 요청 시 |

모든 에이전트는 READ-ONLY — 메인 세션이 결과를 받아 수정 여부를 결정한다.

### Phase 2 — 4축 리뷰 체크리스트 (fe-reviewer 기준)

**① 타입 안전성**
- [ ] `any` 타입 사용 여부
- [ ] 타입 단언(`as`) 남용 여부
- [ ] Props 타입이 정확하게 정의됐는가
- [ ] API 응답 타입이 실제 스키마와 일치하는가

**② 성능**
- [ ] 불필요한 리렌더링 (useMemo/useCallback 필요 여부)
- [ ] 이미지 최적화 (next/image 사용 여부)
- [ ] 번들 사이즈 영향 (동적 import 필요 여부)
- [ ] TanStack Query 캐시 설정 적절한가

**③ 접근성 (a11y)**
- [ ] 인터랙티브 요소에 `aria-label` 또는 텍스트 있는가
- [ ] 키보드 네비게이션 가능한가 (`tabIndex`, `onKeyDown`)
- [ ] 색상 대비 기준 충족 (WCAG AA)
- [ ] `alt` 텍스트 있는가 (이미지)

**④ 코드 품질**
- [ ] 컴포넌트가 단일 책임 원칙을 지키는가
- [ ] 비즈니스 로직이 훅으로 분리됐는가
- [ ] 하드코딩된 문자열/숫자 없는가
- [ ] 에러/로딩 상태 처리됐는가

### Phase 3 — 리뷰 결과 보고

`fe-reviewer` 에이전트의 출력을 그대로 전달한다. 형식:

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
요약: BLOCK N개 / WARN N개 / INFO N개
BLOCK 0이면 "커밋 준비 완료", 있으면 "N개 수정 후 재검토"
```

BLOCK 항목이 있으면 수정 후 에이전트 재위임합니다.
