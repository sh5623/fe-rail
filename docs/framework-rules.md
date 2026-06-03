# 코딩 규칙 (React / Next.js / Vite SPA + Tailwind / shadcn/ui)

> **프레임워크 감지**: 에이전트는 `package.json`을 먼저 읽어 프레임워크를 확인한 후
> 해당 섹션의 규칙만 적용한다. Next.js(`next`) ↔ Vite SPA(`vite`) 섹션이 다르다.
> Vite SPA 의 라우터는 `@tanstack/react-router`(TanStack Router) **또는** `react-router`(React Router 7) 둘 다 지원하며, 설치된 쪽 라우팅 규칙을 적용한다(상태·에셋 규칙은 공통).
> 스타일링(Tailwind + shadcn/ui)은 두 프레임워크 모두에 동일하게 적용되는 **공통 규칙**이다.
> 감지 기준: `tailwindcss` 의존성이 있으면 Tailwind 규칙(`tailwindcss` major 버전으로 **v3 ↔ v4 분기**), `class-variance-authority` + `components/ui/` 가 있으면 shadcn/ui 규칙을 함께 적용한다.

---

## 공통 규칙 (프레임워크 무관)

### 컴포넌트 구조

```typescript
// ✅ 로직은 커스텀 훅으로 분리
function ProductList() {
  const { products, isLoading } = useProducts()
  return <Table data={products} loading={isLoading} />
}

// ❌ 컴포넌트에 비즈니스 로직 직접 작성 금지
function ProductList() {
  const [products, setProducts] = useState([])
  const filtered = products.filter(p => p.status === 'active')
  // ...
}
```

### 데이터 Fetch

```typescript
// ✅ 클라이언트 사이드 데이터 페치는 TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['products'],
  queryFn: fetchProducts,
})

// ❌ useEffect fetch 금지
useEffect(() => {
  fetch('/api/products').then(...)
}, [])
```

### 타입

```typescript
// ✅ 명시적 인터페이스
interface ProductCardProps {
  product: Product
  onSelect: (id: string) => void
}

// ❌ any 타입 금지
const handleData = (data: any) => {}
```

### 스타일링 — Tailwind CSS

> `package.json` 에 `"tailwindcss"` 의존성이 있을 때 적용. Next.js / Vite SPA 모두에 동일하게 적용된다.

```typescript
// ✅ 조건부 클래스는 cn() (clsx + tailwind-merge) 으로 조합
import { cn } from '@/lib/utils'

<button
  className={cn(
    'rounded font-medium',
    isActive ? 'bg-primary text-white' : 'bg-transparent text-primary',
    className, // 외부 override 가능
  )}
/>

// ❌ 문자열 직접 조합 — 충돌 시 어떤 클래스가 이기는지 불명확
<button className={`rounded ${isActive ? 'bg-primary' : ''} ${className}`} />

// ❌ 인라인 style 과 Tailwind 혼용 — 우선순위 추적 불가
<div style={{ padding: 16 }} className="p-2" />
```

```typescript
// ✅ 디자인 토큰 우선 — tailwind.config.* 의 theme 확장 사용
<div className="bg-primary text-foreground p-4 rounded-lg" />

// ❌ 임의값 남용 — 토큰이 있는데도 사용
<div className="bg-[#2563EB] text-[#0F172A] p-[16px] rounded-[8px]" />

// ✅ 예외: 디자인 시스템에 없는 일회성 값에만 임의값 허용 (주석으로 사유 명시)
<div className="grid-cols-[200px_1fr_auto]" />
```

```typescript
// ✅ 변수형 클래스는 정적 매핑 — Tailwind JIT 가 인식 가능
const variantClass = {
  primary: 'bg-primary text-white',
  ghost: 'bg-transparent text-primary',
} as const

<button className={variantClass[variant]} />

// ❌ 보간으로 클래스 생성 금지 — Tailwind JIT 가 감지 못 함
<button className={`bg-${color}-500`} />
```

```typescript
// ✅ 반응형은 모바일 우선 (sm → md → lg → xl)
<div className="text-sm md:text-base lg:text-lg" />

// ❌ 데스크탑 기준으로 작성한 뒤 모바일 override
<div className="text-lg md:text-base sm:text-sm" />
```

```typescript
// ✅ dark mode 클래스는 한 줄에 묶어 의도 명확화
<div className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" />

// ❌ dark mode 토큰을 별도 컴포넌트로 분기 (런타임 비용)
```

**`@apply` 사용 기준**:
- ✅ 디자인 시스템 전역 패턴(`.btn`, `.card` 등 베이스 클래스)에만 제한적 사용
- ❌ 컴포넌트 내부 1회성 스타일에 사용 금지 — Tailwind 의 의도와 충돌
- ❌ shadcn/ui 컴포넌트를 `@apply` 로 재구성 금지

**content / purge 경로**:
- ✅ 모노레포에서는 `tailwind.config.*` 의 `content` 가 사용처(`apps/*/src/**`, `packages/ui/src/**`) 를 모두 포함해야 한다
- ❌ 동적 문자열로만 사용된 클래스는 purge 됨 — safelist 또는 정적 매핑 필요

> 위 규칙은 v3·v4 공통. 아래는 v4 전용 추가 규칙이다.

### 스타일링 — Tailwind v4 추가 규칙 (감지 시)

> `package.json` 의 `tailwindcss` 가 **major 4 이상**일 때, 위 Tailwind 규칙에 더해 적용한다.
> v4 는 **CSS-first 설정**이라 `tailwind.config.js` 가 아예 없을 수 있다 — 설정·토큰은 CSS 의 `@theme` 에 있다. 먼저 진입 CSS 와 `tailwindcss` 버전을 확인하고 v3/v4 를 판별한 뒤 지적한다.

```css
/* ✅ CSS 진입점 — 단일 import */
@import "tailwindcss";

/* ❌ v3 디렉티브 — v4 에서 동작하지 않음 */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

```css
/* ✅ 테마 토큰은 CSS @theme 에 정의 (디자인 토큰의 단일 소스) */
@theme {
  --color-primary: oklch(0.62 0.19 260);
  --font-sans: "Pretendard", sans-serif;
}
/* JS config 가 꼭 필요하면 명시적 로드: @config "../tailwind.config.js"; */

/* ❌ v4 인데 tailwind.config.js 의 theme.extend 에만 의존 — 자동 로드 안 됨 */
```

```typescript
// ✅ 그라디언트 유틸 — v4 새 이름
<div className="bg-linear-to-r from-primary to-accent" />
<div className="bg-radial" />  // bg-conic 도 동일

// ❌ v3 이름 — v4 에서 deprecated (마이그레이션 시 rename 대상)
<div className="bg-gradient-to-r from-primary to-accent" />
```

```typescript
// ✅ 이름·스케일 변경된 유틸 (v4 기준)
<div className="shadow-xs rounded-xs outline-hidden shrink-0 grow" />

// ❌ v3 이름 그대로 — 스케일이 한 칸 이동·rename 되어 의도와 다른 결과
//   shadow-sm→shadow-xs, shadow→shadow-sm, rounded-sm→rounded-xs,
//   outline-none→outline-hidden, flex-shrink-0→shrink-0, flex-grow→grow
<div className="shadow-sm rounded-sm outline-none flex-shrink-0 flex-grow" />
```

**content 경로 (v4)**:
- ✅ v4 는 소스를 **자동 감지** — `content` 배열 불필요. 추가 소스는 CSS 에서 `@source "../../packages/ui/src";`
- ❌ v4 인데 v3 식 `content: [...]` 를 `tailwind.config` 에 적고 동작할 거라 가정

**`@apply` (v4 에서 더 제한적)**:
- ✅ 별도 CSS 파일·CSS Module·SFC `<style>` 에서 `@apply` 를 쓰려면 먼저 `@reference "../app.css";` 로 테마를 참조해야 토큰이 인식된다
- ❌ `@reference` 없이 모듈 CSS 에서 `@apply` — 테마 토큰 인식 실패. 애초에 v4 는 유틸 직접 사용을 권장

**빌드 플러그인 (v4)**:
- ✅ Vite: `@tailwindcss/vite` 플러그인 / PostCSS: `@tailwindcss/postcss`
- ❌ v4 에서 `tailwindcss` 를 PostCSS 플러그인으로 직접 등록 (v3 방식 — v4 에서 분리됨)

### 스타일링 — shadcn/ui

> `package.json` 에 `"class-variance-authority"` + `components/ui/` 디렉토리가 있을 때 적용.
> shadcn/ui 는 Tailwind 위에서 동작하므로 위의 **Tailwind 규칙을 상속**한다.

```typescript
// ✅ shadcn 컴포넌트는 components/ui/ 에 격리 — 직접 수정 금지
// 외부에서 래핑하여 도메인별 컴포넌트로 확장
import { Button as ShadcnButton } from '@/components/ui/button'

export function PrimaryButton({ children, ...props }: Props) {
  return (
    <ShadcnButton variant="default" size="lg" {...props}>
      {children}
    </ShadcnButton>
  )
}

// ❌ shadcn 컴포넌트 소스 직접 수정 — 업그레이드 시 충돌
```

```typescript
// ✅ variant 정의는 cva() 로 — 타입 추론 + Tailwind 클래스 정적 분석 가능
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva('rounded font-medium transition-colors', {
  variants: {
    variant: {
      primary: 'bg-primary text-white hover:bg-primary/90',
      ghost: 'bg-transparent text-primary hover:bg-primary/10',
    },
    size: {
      sm: 'px-3 py-1 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})

type ButtonProps = VariantProps<typeof buttonVariants> &
  React.ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

// ❌ variant 마다 if-else / switch 로 클래스 분기 — cva() 사용
```

---

## Next.js App Router 전용 규칙

> `package.json`에 `"next"` 의존성이 있을 때만 적용한다.

### RSC / Client 경계

```typescript
// ✅ 인터랙션 없는 컴포넌트는 Server Component 기본
async function ProductPage() {
  const products = await fetchProducts()
  return <ProductList products={products} />
}

// ✅ 상태·이벤트 필요할 때만 'use client'
'use client'
function AddToCartButton({ productId }: { productId: string }) {
  const [added, setAdded] = useState(false)
  return <button onClick={() => setAdded(true)}>...</button>
}

// ❌ 필요 없는데 'use client' 남용 금지
```

### 이미지 / 폰트

```typescript
// ✅ next/image priority 설정 (LCP 요소)
<Image src="/hero.webp" alt="..." priority width={1200} height={600} />

// ✅ next/font로 폰트 로드
import localFont from 'next/font/local'
const pretendard = localFont({ src: './fonts/pretendard.woff2' })

// ❌ <img> 태그 직접 사용 금지
// ❌ system-ui / -apple-system 주 폰트 금지
```

---

## Vite + React SPA 전용 규칙

> `package.json`에 `"vite"` 의존성이 있을 때 적용한다.
> 라우터는 `@tanstack/react-router`(TanStack Router) **또는** `react-router`(React Router 7) — **설치된 쪽 라우팅 규칙만** 적용한다. 상태 관리(Zustand)·에셋 규칙은 라우터와 무관한 공통 규칙이다.

### 라우팅 (TanStack Router)

> `package.json` 에 `"@tanstack/react-router"` 가 있을 때 적용.

```typescript
// ✅ createRootRoute / createRoute로 타입 안전 라우트 정의
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

const rootRoute = createRootRoute({ component: RootLayout })
const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/$id',
  component: ProductPage,
})

// ✅ useParams는 라우트 객체에서 직접 — 타입 추론 보장
const { id } = productRoute.useParams()

// ❌ react-router-dom의 useParams 사용 금지 (타입 손실)
// ❌ 라우트 파일에 비즈니스 로직 직접 작성 금지 (컴포넌트로 분리)
```

```typescript
// ✅ 라우트 loader로 데이터 사전 로드 (waterfall 방지)
const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/products/$id',
  loader: ({ params }) => queryClient.ensureQueryData(productQueryOptions(params.id)),
  component: ProductPage,
})

// ❌ 컴포넌트 마운트 후 fetch (loader 대신 useEffect)
```

### 라우팅 (React Router 7)

> `package.json` 에 `"react-router"`(v7) 가 있고 `"@tanstack/react-router"` 가 **없을 때** 적용.
> **핵심 원칙: React Router 는 라우팅·레이아웃만 담당, 서버 데이터는 TanStack Query 가 단독 소유한다.**

```typescript
// ✅ 라우팅은 RR7, 서버 데이터는 컴포넌트/훅에서 useQuery — 단일 소스
import { useParams } from 'react-router'

function ProductPage() {
  const { id } = useParams()
  const { data, isLoading } = useQuery(productQueryOptions(id))
  return <ProductDetail product={data} loading={isLoading} />
}

// ❌ RR7 loader/action 에서 직접 데이터 fetch — TQ 캐시와 소유권이 갈려 이중 캐시·동기화 문제
const router = createBrowserRouter([
  { path: '/products/:id', loader: ({ params }) => fetchProduct(params.id) },
])
// loader 를 꼭 써야 하면 TanStack Query 에 위임만:
//   loader: ({ params }) => queryClient.ensureQueryData(productQueryOptions(params.id))
```

```typescript
// ✅ import 출처는 react-router 단일 (v7 에서 통합)
import { useParams, Link, Outlet, useNavigate } from 'react-router'

// ❌ react-router-dom 에서 import — v7 에서는 react-router 가 정식 (dom 은 호환 re-export)
import { useParams } from 'react-router-dom'
```

```typescript
// ✅ 데이터 모드(createBrowserRouter)로 중첩 라우트·Outlet 레이아웃 구성, 로직은 컴포넌트로 분리
const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />, // Outlet 으로 자식 렌더
    children: [{ path: 'products/:id', element: <ProductPage /> }],
  },
])

// ❌ 라우트 정의 파일에 비즈니스 로직 직접 작성 (컴포넌트로 분리)
```

```typescript
// ✅ RR7 useParams 는 string | undefined — 사용처에서 좁혀 검증
const { id } = useParams()
if (!id) return <NotFound />

// ❌ non-null 단언으로 무검증 사용
const { id } = useParams()
useQuery(productQueryOptions(id!)) // 런타임에 undefined 가능
```

### 상태 관리 (Zustand)

```typescript
// ✅ 도메인별 slice로 분리, devtools 미들웨어 적용
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface CartStore {
  items: CartItem[]
  addItem: (item: CartItem) => void
  removeItem: (id: string) => void
}

export const useCartStore = create<CartStore>()(
  devtools(
    (set) => ({
      items: [],
      addItem: (item) => set((s) => ({ items: [...s.items, item] })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
    }),
    { name: 'cart' }
  )
)

// ✅ 셀렉터로 구독 범위 최소화 (불필요한 리렌더링 방지)
const items = useCartStore((s) => s.items)

// ❌ 스토어 전체 구독
const store = useCartStore()

// ❌ 서버 상태(API 응답)를 Zustand에 저장 — TanStack Query 캐시 사용
```

### 이미지 / 에셋

```typescript
// ✅ Vite의 정적 에셋 import — 번들 해시 자동 적용
import heroImage from '@/assets/hero.webp'
<img src={heroImage} alt="..." loading="lazy" decoding="async" />

// ✅ LCP 이미지는 fetchpriority="high"
<img src={heroImage} alt="..." fetchpriority="high" />

// ❌ public/ 경로 하드코딩 (캐시 무효화 불가)
<img src="/assets/hero.webp" alt="..." />
```
