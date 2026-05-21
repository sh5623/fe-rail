# 코딩 규칙 (React / Next.js / Vite SPA + Tailwind / shadcn/ui)

> **프레임워크 감지**: 에이전트는 `package.json`을 먼저 읽어 프레임워크를 확인한 후
> 해당 섹션의 규칙만 적용한다. Next.js(`next`) ↔ Vite SPA(`vite` + `@tanstack/react-router`) 섹션이 다르다.
> 스타일링(Tailwind + shadcn/ui)은 두 프레임워크 모두에 동일하게 적용되는 **공통 규칙**이다.
> 감지 기준: `tailwindcss` 의존성이 있으면 Tailwind 규칙, `class-variance-authority` + `components/ui/` 가 있으면 shadcn/ui 규칙을 함께 적용한다.

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

> `package.json`에 `"vite"` + `"@tanstack/react-router"` 의존성이 있을 때만 적용한다.

### 라우팅 (TanStack Router)

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
