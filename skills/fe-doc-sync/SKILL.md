---
name: fe-doc-sync
description: >
  CLAUDE.md 와 README.md 를 코드 변경사항에 맞게 동기화합니다.
  hooks/skills/agents 파일이 추가·수정됐을 때 사용하세요.
  git diff 를 분석해 누락된 항목을 찾고, 구체적인 수정 diff 를 제안한 뒤 승인 후 적용합니다.
tools: Read, Bash, Edit
---

# fe-doc-sync — 문서 동기화 스킬

`hooks/`, `skills/`, `agents/` 변경사항을 감지하여
`CLAUDE.md`와 `README.md`를 정확하게 최신 상태로 유지합니다.

---

## Phase 1: 변경 내용 파악

```bash
# 마지막 커밋 이후 변경된 파일
git diff HEAD --name-only

# 실제 변경 내용 (hooks·skills·agents 한정)
git diff HEAD -- hooks/ skills/ agents/
```

수집할 정보:
- 추가/수정/삭제된 훅 스크립트 (hooks/*.sh)
- 추가/수정된 스킬 디렉토리 (skills/*/SKILL.md)
- 추가/수정된 서브에이전트 (agents/*.md)
- hooks.json 변경 (matcher·timeout·이벤트 추가)

---

## Phase 2: 현재 문서 읽기

`CLAUDE.md`와 `README.md` 전체를 읽어 **현재 문서화된 내용**을 파악한다.

체크 대상:
- 스킬 목록 테이블 (skills/)
- 훅 목록 테이블 (hooks/)
- 워크플로우 다이어그램
- 하네스 구조 설명

---

## Phase 3: 갭 분석

코드 실제 상태와 문서 내용을 대조하여 **불일치 항목**을 식별한다.

| 항목 | 코드 상태 | 문서 상태 | 조치 |
|------|-----------|-----------|------|
| 신규 훅 | 존재함 | 미기재 | 추가 필요 |
| 삭제된 훅 | 없음 | 기재됨 | 삭제 필요 |
| matcher 변경 | 변경됨 | 구버전 | 수정 필요 |
| 신규 스킬 | 존재함 | 미기재 | 추가 필요 |

---

## Phase 4: 수정안 출력 (승인 전 반드시 먼저 출력)

아래 형식으로 각 파일별 수정 diff 를 출력한다.

```
## 문서 동기화 보고서

### 요약
- 감지된 변경: X개 파일
- 문서 불일치: X개 항목
- 수정 필요 파일: CLAUDE.md / README.md

---

### [CLAUDE.md] 수정안

**이유:** read-guard.sh, task-guard.sh 가 추가되었으나 하네스 구조 표에 미기재

\`\`\`diff
  | **Hooks** | `hooks/hooks.json` | 도구 사용 후 자동 실행되는 사이드이펙트 |
+ | **Guards** | `hooks/read-guard.sh` | 민감 파일 읽기 경고 |
+ | **Guards** | `hooks/task-guard.sh` | 서브에이전트 프롬프트 인젝션 차단 |
\`\`\`

---

### [README.md] 수정안

**이유:** 훅 목록에 read-guard / task-guard 누락

\`\`\`diff
+ | `read-guard.sh`  | PreToolUse:Read  | 민감 파일 읽기 시도 경고 출력 (차단 없음) | — |
+ | `task-guard.sh`  | PreToolUse:Task  | 서브에이전트 프롬프트 인젝션·위험 명령 차단 | ✅ |
\`\`\`
```

---

## Phase 5: 사용자 승인 요청

수정안 출력 후 반드시 묻는다:

> 위 수정안을 CLAUDE.md와 README.md에 적용할까요?

- **승인** → Phase 6 실행
- **거절** → 종료. 파일 수정 없음.
- **일부 승인** → 승인된 항목만 적용

---

## Phase 6: 수정 적용

Edit 도구로 각 파일의 해당 위치에만 최소한으로 삽입·수정한다.

**원칙:**
- 기존 내용 구조는 그대로 유지
- 표 삽입 시 형식(컬럼 너비 등)을 기존 행에 맞춤
- 삭제된 항목은 명시적으로 제거
- 한 번에 한 파일씩 수정하고 결과를 확인

적용 완료 후:
```
✅ CLAUDE.md 업데이트 완료 (X줄 추가)
✅ README.md 업데이트 완료 (X줄 추가)
```

---

## 품질 기준

| 항목 | 기준 |
|------|------|
| 완전성 | 모든 hooks/*.sh가 README 훅 테이블에 존재 |
| 완전성 | 모든 skills/*/SKILL.md가 README 스킬 테이블에 존재 |
| 정확성 | hooks.json 의 matcher가 README 설명과 일치 |
| 정확성 | CLAUDE.md 하네스 구조 파일 목록이 실제 디렉토리와 일치 |
| 간결성 | 추가 설명은 1줄 이내 — 자명한 내용 반복 금지 |

---

## 주의

- **수정 전 반드시 Phase 4 출력 → Phase 5 승인** 순서를 지킨다.
- 승인 없이 파일을 수정하지 않는다.
- CLAUDE.md의 워크플로우 다이어그램은 실제 기능 변경이 있을 때만 수정한다.
