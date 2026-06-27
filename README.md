# fe-rail

<div align="right">
  <a href="README.md"><img src="https://img.shields.io/badge/lang-한국어-blue?style=flat-square" alt="한국어"/></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/lang-English-lightgrey?style=flat-square" alt="English"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"/></a>
</div>

> 프론트엔드 프로젝트 전용 Claude Code 플러그인
> spec → build → review → PR 자동화 워크플로우. Next.js App Router / Vite SPA(TanStack Router·React Router 7) + TypeScript, Tailwind v3/v4 / shadcn/ui 정식 지원.

## 설치

```bash
claude

/plugin marketplace add sh5623/fe-rail
/plugin install fe-rail@fe-rail-market
```

## 포함된 스킬

| 스킬 | 명령어 | 설명 |
|------|--------|------|
| fe-spec | `/fe-rail:fe-spec` | 기능 요구사항 → 구조화된 스펙 문서 생성. Phase 3 에서 다음 단계(풀 자동·구현만·스펙 수정)를 라디오 UI로 선택 — "풀 자동" 선택 시 fe-start 파이프라인으로 자동 연결 |
| fe-build | `/fe-rail:fe-build` | 프론트엔드 코드 구현 (타입→로직 분리→컴포넌트→테스트) |
| fe-review | `/fe-rail:fe-review` | 타입·성능·a11y·품질 4축 리뷰 |
| fe-start | `/fe-rail:fe-start feature.md` | 위 3개를 하나로 — PR까지 자동화. Phase 1·5 가 라디오 UI로 진행 여부·커밋 방식 확인 |
| fe-doc-sync | `/fe-rail:fe-doc-sync` | **설치된 사용자 프로젝트** 스캔 (라우트·의존성·구조·ENV) → 그 프로젝트의 CLAUDE.md·README.md 수정안 제안 |

## 포함된 Hooks

정책: **위험은 차단(exit 2), 품질은 경고(stderr)**.

| Hook | 이벤트 | 역할 | 차단 |
|------|--------|------|------|
| `session-init.sh` | SessionStart | 원격 버전 체크 + 새 버전 알림 (GitHub, 하루 1회) | — |
| `guard.sh` | PreToolUse:Bash | `git add .`, force push, `--no-verify`, `rm -rf /`, `DROP TABLE`, `git reset --hard` 등 차단 | ✅ |
| `write-guard.sh` | PreToolUse:Write\|Edit\|MultiEdit | `.env*`, `*.pem`, `*.key`, `*.secret(s)`, `*secret(s)*.json`, `*credential(s)*.json` 등 민감 파일 생성·수정 차단 (소스 파일명에 secret/credential 포함된 경우는 통과) | ✅ |
| `read-guard.sh` | PreToolUse:Read | 민감 파일 읽기 시도 경고 출력 (`.env`, `*.pem`, `*.key`, `*credential*` 등) | — |
| `task-guard.sh` | PreToolUse:Task\|Agent | 서브에이전트 프롬프트 내 인젝션 패턴·위험 명령 위임 차단 | ✅ |
| `lint-fix.sh` | PostToolUse:Edit\|Write\|MultiEdit | 소비자 환경 감지 → Biome `check --write` **또는** ESLint `--fix`(+Prettier) 자동 적용 | — |
| `nextjs-guard.sh` | PostToolUse:Edit\|Write\|MultiEdit | Server Component에서 React 훅/브라우저 API/DOM 이벤트 사용 감지, app router의 `page`/`layout`에 `'use client'` 경고 | — |
| `quality-gate.sh` | Stop | 변경 파일에 린터(Biome **또는** ESLint) + typecheck(`typecheck` 스크립트 → `tsc -b` → `tsc --noEmit` 폴백) 실행 후 경고 출력 | — |
| `doc-sync-check.sh` | Stop | 사용자 프로젝트의 코드(src/app/pages/components 등)·package.json·설정 파일 변경 감지 시 `/fe-rail:fe-doc-sync` 실행 안내 (최근 커밋 5개 포함) | — |
| `notify.sh` | (옵션) Notification | macOS terminal-notifier 배너 알림 — `bash hooks/scripts/setup-notifier.sh` 로 활성화 | — |

## 포함된 Agents

각 agent는 별도 컨텍스트에서 동작하여 메인 세션을 노이즈로부터 보호합니다.
frontmatter(`tools`/`disallowedTools`/`model`/`maxTurns`) + XML 태그 구조(`<purpose>`/`<forbidden>`/`<required>`/`<workflow>`/`<output>`)로 구성됩니다.

> **모델 티어는 별칭입니다.** 각 agent의 `model`은 `opus`/`sonnet`/`haiku` **별칭**으로 지정되어, 모델 패밀리 업데이트(예: Opus 4.7 → 4.8) 시 자동으로 최신 티어를 사용합니다. 별도 수정 없이 개선이 반영되는 대신, 플러그인 버전이 동일해도 동작이 변동될 수 있습니다. 재현성이 중요한 경우 릴리스마다 현재 별칭 해상도 기준으로 회귀를 점검하세요.
> 티어 배분: **opus**(고판단 — `fe-analyst`·`fe-architect`·`fe-reviewer`·`fe-refactor-advisor`) / **haiku**(저비용 탐색 — `fe-explorer`) / **sonnet**(나머지 실행·도구 계열).

### spec 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-analyst` | 요구사항 갭 분석 (6갭 / 7섹션); CLAUDE.md·DESIGN.md·PRODUCT.md·AGENTS.md 병렬 탐색 | opus | 책임 (read-only) |
| `fe-vision` | Figma·UI 스크린샷·PDF 개별 화면 분석 (Figma URL → `get_metadata`·`get_design_context`·`get_variable_defs`·`get_screenshot`; DESIGN.md Bans anti-slop 점검) | sonnet | 책임 (read-only) |
| `fe-researcher` | 외부 문서·라이브러리 조사 (Context7 MCP 우선, WebSearch/WebFetch fallback) | sonnet | 도구 (Context7/WebSearch/WebFetch) |
| `fe-architect` | React/TS 아키텍처 자문 — Next.js(RSC 경계) / Vite SPA(TanStack Router·React Router 7·Zustand) + Tailwind v3/v4·shadcn (직교 감지) | opus | 책임 (read-only) |

### build 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-explorer` | 코드베이스 탐색 3쿼리 이상 | haiku | 컨텍스트 |
| `fe-test-author` | BDD 시나리오 도출 + TDD Red-Green-Refactor | sonnet | 책임 (구현) |
| `fe-build-fixer` | tsc·린터(ESLint/Biome) 오류 최소 diff 수정 | sonnet | 도구 (Edit+Grep, Write/MultiEdit 금지) |

### review 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-reviewer` | 4축 리뷰 (타입·성능·a11y·품질, Tailwind 안티패턴 포함) | opus | 책임 (read-only) |
| `fe-a11y-auditor` | a11y 8축 감사 (Color Contrast — Tailwind 팔레트 기준 포함) | sonnet | 책임 (read-only) |
| `fe-perf-auditor` | 성능 정밀 감사 — Next.js(RSC·next/image·next/font) / Vite SPA(TanStack loader·RR7 TQ prefetch·fetchpriority·번들) / Tailwind v3/v4(purge·@source·@apply) | sonnet | 책임 (read-only) |
| `fe-test-runner` | 테스트 실행 + 실패 분류 | sonnet | 컨텍스트 |
| `fe-refactor-advisor` | 6차원 리팩토링 분석 + Before/After | opus | 책임 (read-only) |

### PR 단계
| Agent | 위임 시점 | 모델 | 격리 |
|-------|----------|------|------|
| `fe-git-operator` | 커밋 분리·안전한 스테이징 + 본문 작성 (fix=증상·원인·해결 / feat=추가·핵심·영향) | sonnet | 도구 (Write/Edit 금지) |
| `fe-pr-author` | PR 본문 작성 (성격별 🐛/✨ 블록) + `gh pr create` | sonnet | 컨텍스트 + 도구 |

## 워크플로우

**원스톱 자동화 (fe-start)**
```
feature.md 작성 → /fe-rail:fe-start feature.md → [라디오] "구현할까요?" → [라디오] "커밋할까요?" → PR 생성 완료
```

**fe-spec → 풀 자동 핸드오프**
```
/fe-rail:fe-spec → [라디오] "풀 자동" 선택 → fe-start Phase 2 바로 진행 → [라디오] "커밋할까요?" → PR 생성 완료
```
> fe-spec Phase 3 "풀 자동" 선택이 구현 시작 승인을 겸하므로, fe-start Phase 1 확인은 생략됩니다. 사람 개입은 2회 유지.

**단계별 수동 제어**
```
/fe-rail:fe-spec → /fe-rail:fe-build → /fe-rail:fe-review → git commit && gh pr create
```

## 전제 조건

- Claude Code
- 패키지 매니저 (pnpm / npm / yarn / bun — lock 파일로 자동 감지)
- gh CLI (PR 자동 생성 시)
- TypeScript strict mode (Next.js / Vite SPA)

## 설치 후 권장 설정 (소비자 프로젝트)

플러그인의 agent들은 **소비자 프로젝트의 컨텍스트를 읽어** 동작합니다. 설치 직후 아래를 갖추면 품질이 크게 올라갑니다.

| 항목 | 이유 | 방법 |
|------|------|------|
| **프로젝트 CLAUDE.md** | `fe-analyst`·`fe-architect` 등이 스택·규칙·금지사항을 읽어 추론 — 없으면 빈손으로 분석 (플러그인의 CLAUDE.md는 소비자 세션에 로드되지 않음) | `/init` 또는 `/fe-rail:fe-doc-sync` |
| **Bash 권한** | `fe-git-operator`·`fe-pr-author` 흐름에서 매번 권한 프롬프트 방지 | `.claude/settings.json`의 `permissions.allow`에 `Bash(git *)`·`Bash(gh pr *)` 추가 |
| **MCP (선택)** | `fe-vision`의 Figma 직접 조회, `fe-researcher`의 Context7 문서 조회 활성화 (미연결 시 로컬 이미지·WebSearch로 fallback) | Figma: claude.ai 설정에서 Figma OAuth 커넥터 연결 / Context7: 플러그인 설치 |
| **검증 스크립트** | Phase 3 자동 검증이 `package.json`의 `typecheck`/`lint`/`test` 스크립트를 사용 | 해당 스크립트 정의 권장 |

## 라이선스

[MIT](LICENSE) © 2026 이승호

## 기반 레퍼런스

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
