# fe-rail

> 프론트엔드 프로젝트 전용 Claude Code 플러그인
> spec → build → review → PR 자동화 워크플로우. Next.js + TypeScript 환경 최적화.

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
| fe-build | `/fe-rail:fe-build` | Next.js/TS 코드 구현 (타입→훅→컴포넌트→테스트) |
| fe-review | `/fe-rail:fe-review` | 타입·성능·a11y·품질 4축 리뷰 |
| fe-start | `/fe-rail:fe-start feature.md` | 위 3개를 하나로 — PR까지 자동화 |

## 워크플로우
```

원스톱 자동화
feature.md 작성 → /fe-rail:fe-start feature.md → "구현할까요?" 승인 → "커밋할까요?" 승인 → PR 생성 완료
단계별 수동 제어
/fe-rail:fe-spec /fe-rail:fe-build /fe-rail:fe-review git commit && gh pr create

```

## 전제 조건

- Claude Code
- pnpm
- gh CLI (PR 자동 생성 시)
- Next.js 14+ / TypeScript strict mode

## 기반 레퍼런스

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [Chachamaru127/claude-code-harness](https://github.com/Chachamaru127/claude-code-harness)
- [garrytan/gstack](https://github.com/garrytan/gstack)
