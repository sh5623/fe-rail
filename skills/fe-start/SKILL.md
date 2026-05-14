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
실패 시 `fe-build-fixer` 에이전트에 위임하여 최소 diff로 오류 수정 후 재검증.

### Phase 4 — 리뷰 (에이전트 위임)

`fe-reviewer` 에이전트에 위임하여 4축(타입·성능·a11y·품질) 리뷰를 수행한다.
접근성(a11y) BLOCK/WARN 발생 시 → `fe-a11y-auditor` 추가 위임.
성능 BLOCK/WARN 발생 시 → `fe-perf-auditor` 추가 위임.

결과를 받아 BLOCK/WARN/INFO 항목을 간략 보고한다.
BLOCK이 있으면 수정 후 재위임, BLOCK 0이 되어야 Phase 5로 진행.

### Phase 5 — 두 번째 확인 ⛔ STOP
> **"검증 완료. 커밋하고 PR 생성할까요?"**

---

### Phase 6 — 커밋 & PR (에이전트 위임)

본문에서 git/gh 명령을 직접 실행하지 않고 전담 에이전트에 순차 위임합니다.
이렇게 하면 `hooks/guard.sh` 의 위험 명령 차단 정책과 자연스럽게 일치하고,
메인 세션 컨텍스트가 diff·커밋 메시지로 오염되지 않습니다.

#### 6-1. `fe-git-operator` 위임 — 커밋 & 푸시

전달할 컨텍스트:
- Phase 2에서 작성/수정한 **파일 목록** (명시적 스테이징 대상)
- 기능명, 주요 변경사항 요약, 관련 이슈 번호

에이전트가 책임지는 것:
- 명시적 파일 스테이징 (절대 `git add -A` / `git add .` 사용 금지)
- 논리 단위별 커밋 분리, 컨벤셔널 커밋 메시지 작성
- `git push origin HEAD`

#### 6-2. `fe-pr-author` 위임 — PR 생성

전달할 컨텍스트:
- feature.md 경로
- 커밋 범위 (base..HEAD)
- Phase 4 리뷰 요약 (통과/경고 항목)

에이전트가 책임지는 것:
- PR 제목·본문 작성 (변경사항·완료 기준 체크리스트 포함)
- `gh pr create --draft` 실행
- 메인 세션은 **PR URL만** 결과로 받음

> PR은 기본 draft로 생성합니다. 준비되면 직접 ready for review로 전환하세요.
> `--no-pr` 플래그가 켜져 있으면 6-2는 건너뜁니다.

## 플래그

| 플래그 | 설명 |
|--------|------|
| `--plan-only` | Phase 1까지만 (계획 확인만) |
| `--no-pr` | 커밋까지만, PR 생성 안 함 |
| `--no-draft` | PR을 바로 ready 상태로 생성 |
