# 코딩 규칙 (React / Next.js)

## 컴포넌트 구조

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

## 데이터 Fetch

```typescript
// ✅ 서버 데이터는 TanStack Query
const { data, isLoading, error } = useQuery({
  queryKey: ['products'],
  queryFn: fetchProducts,
})

// ❌ useEffect fetch 금지
useEffect(() => {
  fetch('/api/products').then(...)
}, [])
```

## RSC / Client 경계 (Next.js App Router)

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

## 타입

```typescript
// ✅ 명시적 인터페이스
interface ProductCardProps {
  product: Product
  onSelect: (id: string) => void
}

// ❌ any 타입 금지
const handleData = (data: any) => {}
```

## 이미지 / 폰트 (Next.js)

```typescript
// ✅ next/image priority 설정 (LCP 요소)
<Image src="/hero.webp" alt="..." priority width={1200} height={600} />

// ✅ next/font로 폰트 로드
import { Pretendard } from 'next/font/local'

// ❌ <img> 태그 직접 사용 금지
// ❌ system-ui / -apple-system 주 폰트 금지
```
