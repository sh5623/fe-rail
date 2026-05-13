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
├── agents/
│   └── fe-reviewer.md     ← 읽기 전용 리뷰 서브에이전트
├── hooks/
│   └── hooks.json         ← PostToolUse 훅 (파일 수정 감지)
├── skills/
│   ├── fe-spec/           ← 기획 → 스펙 변환
│   ├── fe-build/          ← 스펙 → 코드 구현
│   ├── fe-review/         ← 4축 코드 리뷰
│   └── fe-start/          ← 원스톱 자동화 (spec→PR)
└── .claude/
    └── settings.local.json ← Bash 권한 화이트리스트
```

### 레이어별 역할

| 레이어 | 파일 | 역할 |
|--------|------|------|
| **CLAUDE.md** | 이 파일 | 에이전트가 프로젝트를 이해하는 최우선 컨텍스트 |
| **Skills** | `skills/*/SKILL.md` | 작업 유형별 전문화된 지침 (도구 제한 포함) |
| **Subagent** | `agents/fe-reviewer.md` | 역할 격리된 리뷰 전담 에이전트 |
| **Hooks** | `hooks/hooks.json` | 도구 사용 후 자동 실행되는 사이드이펙트 |
| **Permissions** | `settings.local.json` | Bash 명령어 화이트리스트로 에이전트 권한 제한 |

---

## 워크플로우

```
사용자 요청
    │
    ▼
fe-spec  →  feature.md 생성 (사용자 승인 필요)
    │
    ▼
fe-build →  타입 → 훅 → 컴포넌트 → 테스트 순서로 구현
    │
    ▼
fe-review → 4축 검토 (타입·성능·a11y·품질) — fe-reviewer 서브에이전트 활용
    │
    ▼
커밋 & PR  →  git + gh CLI (사용자 승인 필요)
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

모노레포 환경에서 에이전트를 사용할 때는 아래 규칙을 따른다.

### 디렉토리 구조 관례

```
my-monorepo/
├── apps/
│   ├── web/          ← React / Next.js 앱
│   ├── admin/        ← Vue 3 앱
│   └── mobile-web/   ← React Native Web
├── packages/
│   ├── ui/           ← 공유 컴포넌트
│   ├── utils/        ← 공통 유틸
│   └── types/        ← 공유 타입 정의
└── CLAUDE.md         ← 루트 컨텍스트 (프로젝트별로 별도 작성 권장)
```

### 에이전트 행동 규칙 (모노레포)

1. **작업 범위 확인 먼저** — 기능을 구현하기 전에 어느 `app` 또는 `package`에 속하는지 명시한다.
2. **공유 패키지 우선 탐색** — `packages/ui`, `packages/utils` 등 이미 존재하는 공통 모듈을 확인한 후 새 코드를 작성한다.
3. **패키지 경계 존중** — 앱 간 직접 import 금지. 공유 로직은 반드시 `packages/`로 분리한다.
4. **각 앱의 package.json 기준** — 기술 스택 확인 시 루트가 아닌 해당 앱의 `package.json`을 참조한다.

### feature.md 위치 (모노레포)

```
apps/web/feature.md      ← 앱별로 분리 작성
apps/admin/feature.md
```

---

## 프레임워크별 코딩 규칙

### React / Next.js

```typescript
// ✅ 로직은 커스텀 훅으로 분리
function ProductList() {
  const { products, isLoading } = useProducts()
  return <Table data={products} loading={isLoading} />
}

// ✅ 서버 데이터는 TanStack Query
const { data } = useQuery({ queryKey: ['products'], queryFn: fetchProducts })

// ❌ useEffect fetch 금지
// ❌ any 타입 금지
// ❌ 컴포넌트에 비즈니스 로직 직접 작성 금지
```

### Vue 3

```typescript
// ✅ Composition API + composable 분리
const { products, isLoading } = useProducts()

// ✅ defineProps/defineEmits에 타입 명시
const props = defineProps<{ items: Product[] }>()

// ❌ Options API 금지 (레거시 코드 유지 보수 시 예외)
// ❌ any 타입 금지
```

### Angular

```typescript
// ✅ standalone component 기본
@Component({ standalone: true, ... })

// ✅ inject() 함수로 의존성 주입 (constructor inject 대신)
private productService = inject(ProductService)

// ✅ signal 기반 상태 관리 (Angular 17+)
products = signal<Product[]>([])

// ❌ any 타입 금지
// ❌ ngModel 양방향 바인딩 남용 금지
```

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
- 리뷰 에이전트가 코드 직접 수정

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
