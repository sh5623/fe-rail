# 프레임워크별 코딩 규칙

## React / Next.js

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

## Vue 3

```typescript
// ✅ Composition API + composable 분리
const { products, isLoading } = useProducts()

// ✅ defineProps/defineEmits에 타입 명시
const props = defineProps<{ items: Product[] }>()

// ❌ Options API 금지 (레거시 코드 유지 보수 시 예외)
// ❌ any 타입 금지
```

## Angular

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
