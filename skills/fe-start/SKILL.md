---
name: fe-start
description: >-
  feature.md 파일을 받아 스펙 확인 → 구현 → 리뷰 → 커밋 → PR까지 자동으로 진행합니다.
  Use when: "fe-start feature.md" 또는 "feature.md로 시작해줘"라고 말할 때.
  사람 개입은 두 번: "구현할까요?", "커밋할까요?"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

# FE Start — 원스톱 자동화 스킬

`feature.md` 하나로 PR까지 자동으로 처리합니다.
중간에 딱 두 번만 묻습니다.

## When to Use

- "fe-start feature.md" 실행 시
- "feature.md로 시작해줘" 라고 말할 때
- 자동화 모드로 기능 개발 시작할 때

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
> **"위 내용으로 구현을 시작할까요?"**

사용자 승인 전 코드 작성 금지.

---

### Phase 2 — 구현 (fe-build 스킬 기준 적용)
1. 관련 기존 코드 탐색
2. 타입 정의
3. 커스텀 훅 작성
4. 컴포넌트 구현
5. 테스트 작성

### Phase 3 — 자동 검증
```bash
pnpm tsc --noEmit && pnpm lint && pnpm test --run
```
실패 시 자동 수정 후 재검증.

### Phase 4 — 리뷰 요약 출력
통과/경고/블록 항목 간략 보고.

### Phase 5 — 두 번째 확인 ⛔ STOP
> **"검증 완료. 커밋하고 PR 생성할까요?"**

---

### Phase 6 — 커밋 & PR
```bash
git status
git add -A
git commit -m "feat: [기능명]

- [주요 변경사항 1]
- [주요 변경사항 2]

Closes #[이슈번호]"

git push origin HEAD

gh pr create \
  --title "feat: [기능명]" \
  --body "## 변경사항
[변경사항 설명]

## 완료 기준
- [x] TypeScript 타입 에러 없음
- [x] ESLint 통과
- [x] 테스트 통과
" \
  --draft
```

PR은 기본 draft로 생성합니다. 준비되면 직접 ready for review로 전환하세요.

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--plan-only` | Phase 1까지만 (계획 확인만) |
| `--no-pr` | 커밋까지만, PR 생성 안 함 |
| `--no-draft` | PR을 바로 ready 상태로 생성 |
