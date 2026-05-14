---
name: fe-build
description: >-
  React/Next.js/Vue/Angular + TypeScript 프로젝트의 프론트엔드 컴포넌트와 페이지를 구현합니다.
  Use when: feature.md 또는 스펙이 승인된 후 구현 시작할 때, 컴포넌트 작성, 페이지 개발.
  Do NOT load for: 스펙 작성, 코드 리뷰, 버그 분석.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

# FE Build 스킬

승인된 스펙을 기반으로 Next.js + TypeScript 코드를 구현합니다.

## When to Use

- `feature.md` 또는 스펙 문서가 승인된 직후
- 컴포넌트/페이지/훅 신규 개발
- 기존 컴포넌트 기능 추가

## Instructions

### Phase 1 — 사전 확인 + 에이전트 위임

구현 시작 전 반드시 확인:
1. `feature.md` 또는 스펙 문서가 존재하고 승인됐는가?
2. 기술 스택 확인 (package.json 참조)

코드베이스 탐색은 직접 하지 않고 에이전트에 위임한다:

| 상황 | 위임 에이전트 |
|------|-------------|
| 3쿼리 이상의 파일·심볼 탐색 필요 | `fe-explorer` — 요약만 반환, 컨텍스트 보호 |
| 테스트 코드 생성 (BDD/TDD) | `fe-test-author` — 시나리오 도출 + 파일 작성 |
| tsc·eslint 오류 수정 | `fe-build-fixer` — 최소 diff 오류 제거 |

### Phase 2 — 구현 순서
반드시 이 순서를 지킵니다:
```

1. 타입 정의 먼저 (types/ 또는 컴포넌트 상단)
2. 비즈니스 로직 분리 (React 훅 / Vue composable / Angular service)
3. 컴포넌트 구현 (UI만 담당, 로직은 분리된 레이어에서)
4. 테스트 작성 (Vitest + RTL)
5. 타입체크 확인 (tsc --noEmit)

```

### Phase 3 — 코딩 규칙

**타입**
```typescript
// ✅ Good
interface CampaignListProps {
  campaigns: Campaign[];
  onSelect: (id: string) => void;
}

// ❌ Bad - any 금지
const handleData = (data: any) => {}
```

**데이터 fetch**
```typescript
// ✅ Good - TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['campaigns'],
  queryFn: fetchCampaigns,
})

// ❌ Bad - useEffect fetch 금지
useEffect(() => {
  fetch('/api/campaigns').then(...)
}, [])
```

**컴포넌트 구조**
```typescript
// ✅ Good - 로직은 훅으로 분리
function CampaignList() {
  const { campaigns, isLoading } = useCampaigns()
  return <Table data={campaigns} />
}

// ❌ Bad - 컴포넌트에 비즈니스 로직 직접 작성
function CampaignList() {
  const [campaigns, setCampaigns] = useState([])
  const filtered = campaigns.filter(c => c.status === 'active')
  // ... 복잡한 로직들
}
```

**UI 컴포넌트 기준**
- 새 UI 컴포넌트 작성 시 변형 2개 이상 먼저 제안
- system-ui / -apple-system 주 폰트 금지
- shadcn/ui 컴포넌트 우선 활용

### Phase 4 — 구현 후 자동 검증
구현 완료 후 반드시 실행:
```bash
pnpm tsc --noEmit          # 타입 에러 확인
pnpm lint                   # ESLint 확인
pnpm test --run             # 테스트 실행
```

**성공 출력은 침묵, 실패만 보고합니다.**

## Anti-patterns
- 타입 먼저 안 잡고 코딩 시작
- 스펙 없이 "대충 이런 방향으로" 구현
- 테스트 없이 완료 선언
- console.log를 코드에 남기기
