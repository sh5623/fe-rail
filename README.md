# fe-rail

> 프론트엔드 프로젝트 전용 Claude Code 플러그인
> spec → build → review → PR 자동화 워크플로우. Next.js App Router / Vite SPA + TypeScript.

## 설치

```bash
claude

/plugin marketplace add sh5623/fe-rail
/plugin install fe-rail@fe-rail-market
```

## 포함된 스킬

| 스킬 | 명령어 | 설명 |
|------|--------|------|
| fe-spec | `/fe-rail:fe-spec` | 기능 요구사항 → 구조화된 스펙 문서 생성 |
| fe-build | `/fe-rail:fe-build` | 프론트엔드 코드 구현 (타입→로직 분리→컴포넌트→테스트) |
| fe-review | `/fe-rail:fe-review` | 타입·성능·a11y·품질 4축 리뷰 |
| fe-start | `/fe-rail:fe-start feature.md` | 위 3개를 하나로 — PR까지 자동화 |
| fe-doc-sync | `/fe-rail:fe-doc-sync` | 변경사항 분석 후 CLAUDE.md·README.md 수정안 제안 |

## 포함된 Hooks

정책: **위험은 차단(exit 2), 품질은 경고(stderr)**.

| Hook | 이벤트 | 역할 | 차단 |
|------|--------|------|------|
| `session-init.sh` | SessionStart | 플러그인 버전 체크 + 캐시 동기화 + 새 버전 알림 (GitHub, 하루 1회) | — |
| `guard.sh` | PreToolUse:Bash | `git add .`, force push, `--no-verify`, `rm -rf /`, `DROP TABLE`, `git reset --hard` 등 차단 | ✅ |
| `write-guard.sh` | PreToolUse:Write\|Edit\|MultiEdit | `.env*`, `*.pem`, `*.key`, `*secret*` 등 민감 파일 생성·수정 차단 (`.env.example`은 허용) | ✅ |
| `read-guard.sh` | PreToolUse:Read | 민감 파일 읽기 시도 경고 출력 (`.env`, `*.pem`, `*.key`, `*credential*` 등) | — |
| `task-guard.sh` | PreToolUse:Task\|Agent | 서브에이전트 프롬프트 내 인젝션 패턴·위험 명령 위임 차단 | ✅ |
| `lint-fix.sh` | PostToolUse:Edit\|Write\|MultiEdit | ESLint `--fix` + Prettier 자동 적용 | — |
| `nextjs-guard.sh` | PostToolUse:Edit\|Write\|MultiEdit | Server Component에서 React 훅/브라우저 API/DOM 이벤트 사용 감지, app router의 `page`/`layout`에 `'use client'` 경고 | — |
| `quality-gate.sh` | Stop | 변경 파일에 ESLint + `tsc --noEmit` 실행 후 경고 출력 | — |
| `doc-sync-check.sh` | Stop | hooks/skills/agents 변경 감지 시 `/fe-rail:fe-doc-sync` 실행 안내 | — |
| `notify.sh` | (옵션) Notification | macOS terminal-notifier 배너 알림 — `bash hooks/scripts/setup-notifier.sh` 로 활성화 | — |

## 포함된 Agents

각 agent는 별도 컨텍스트에서 동작하여 메인 세션을 노이즈로부터 보호합니다.
frontmatter(`tools`/`disallowedTools`/`model`/`maxTurns`) + XML 태그 구조(`<purpose>`/`<forbidden>`/`<required>`/`<workflow>`/`<output>`)로 구성됩니다.

### spec 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-analyst` | 요구사항 갭 분석 (6갭 / 7섹션) | opus | 책임 (read-only) |
| `fe-vision` | Figma·UI 스크린샷·PDF·다이어그램 분석 | sonnet | 책임 (read-only) |
| `fe-researcher` | 외부 문서·라이브러리 조사 (출처 URL 필수) | sonnet | 도구 (WebSearch/WebFetch) |
| `fe-architect` | React/TS 아키텍처 자문 — Next.js(RSC 경계) / Vite SPA(라우트·Zustand) 프레임워크 감지 | opus | 책임 (read-only) |

### build 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-explorer` | 코드베이스 탐색 3쿼리 이상 | haiku | 컨텍스트 |
| `fe-test-author` | BDD 시나리오 도출 + TDD Red-Green-Refactor | sonnet | 책임 (구현) |
| `fe-build-fixer` | tsc/eslint 오류 최소 diff 수정 | sonnet | 도구 (Edit+Grep, Write/MultiEdit 금지) |

### review 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-reviewer` | 4축 리뷰 (타입·성능·a11y·품질) | sonnet | 책임 (read-only) |
| `fe-a11y-auditor` | a11y 정밀 감사 | sonnet | 책임 (read-only) |
| `fe-perf-auditor` | 성능 정밀 감사 — Next.js(RSC·next/image·next/font) / Vite SPA(loader waterfall·fetchpriority·번들) | sonnet | 책임 (read-only) |
| `fe-test-runner` | 테스트 실행 + 실패 분류 | sonnet | 컨텍스트 |
| `fe-refactor-advisor` | 6차원 리팩토링 분석 + Before/After | sonnet | 책임 (read-only) |

### PR 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-git-operator` | 커밋 분리·메시지 규칙·안전한 스테이징 | sonnet | 도구 (Write/Edit 금지) |
| `fe-pr-author` | PR 본문 작성 + `gh pr create` | sonnet | 컨텍스트 + 도구 |

## 워크플로우

**원스톱 자동화**
```
feature.md 작성 → /fe-rail:fe-start feature.md → "구현할까요?" 승인 → "커밋할까요?" 승인 → PR 생성 완료
```

**단계별 수동 제어**
```
/fe-rail:fe-spec → /fe-rail:fe-build → /fe-rail:fe-review → git commit && gh pr create
```

## 전제 조건

- Claude Code
- pnpm
- gh CLI (PR 자동 생성 시)
- TypeScript strict mode (Next.js / Vite SPA)

## 기반 레퍼런스

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
