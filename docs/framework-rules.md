# 코딩 규칙 (React / Next.js / Vite SPA)

> **프레임워크 감지**: 에이전트는 `package.json`을 먼저 읽어 프레임워크를 확인한 후
> 해당 섹션의 규칙만 적용한다. Next.js(`next`) ↔ Vite SPA(`vite` + `@tanstack/react-router`) 섹션이 다르다.

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

### UI (shadcn/ui)

```typescript
// ✅ cn() 유틸리티로 조건부 클래스 조합
import { cn } from '@/lib/utils'

function Button({ className, variant, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}

// ✅ shadcn 컴포넌트를 직접 수정하지 않고 래핑
// ✅ 공통 variant/size는 cva()로 정의
import { cva } from 'class-variance-authority'

const buttonVariants = cva('rounded font-medium', {
  variants: {
    variant: { primary: 'bg-primary text-white', ghost: 'bg-transparent' },
    size: { sm: 'px-3 py-1 text-sm', md: 'px-4 py-2' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})

// ❌ tailwind 클래스 문자열 직접 조합 (충돌 위험)
// ❌ shadcn 컴포넌트 소스 직접 수정 (업그레이드 불가)
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
