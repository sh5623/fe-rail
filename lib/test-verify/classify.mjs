// [fe-rail] test-verify — 변경 파일 분류(실행할 테스트 · 지원 파일 · 제품 소스 · 설정 · 무관).
// 기본값은 Vitest·Jest 의 기본 수집 규칙과 널리 쓰이는 관례다. 소비 프로젝트는 선언으로 경로를 더할 수 있다
// (testPaths · supportPaths · e2ePaths — 접두 경로 또는 * / ** 글롭, 저장소 루트 기준).
import path from 'node:path';

const CODE = 'js|jsx|ts|tsx|mjs|cjs|mts|cts';
// Vitest 기본 include(**/*.{test,spec}.?(c|m)[jt]s?(x)) ∪ Jest 기본 testMatch(**/__tests__/**, **/*.{test,spec}.*)
const TEST_NAME = new RegExp(`\\.(test|spec)\\.(${CODE})$`);
const CODE_EXT = new RegExp(`\\.(${CODE})$`);
const E2E_DIRS = new Set(['e2e', 'playwright', 'cypress']);
const SUPPORT_DIRS = new Set(['__mocks__', '__fixtures__', 'fixtures', '__snapshots__', 'test', 'tests', 'testing', '__tests__', 'test-utils']);
const SETUP_NAME = /^(setup-?tests?|test-?setup|vitest\.setup|jest\.setup|setup-?files?(-after-env)?)\.[cm]?[jt]sx?$/i;
const LOCKS = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
const CONFIG_NAME = /^(package\.json|pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json|[tj]sconfig(\..+)?\.json|.+\.config\.[cm]?[jt]s|.+\.config\.json|\.babelrc(\..+)?|babel\.config\..+|\.swcrc|\.npmrc|\.yarnrc(\.yml)?|\.nvmrc|\.node-version|\.browserslistrc|\.env(\..+)?)$/;
const PRODUCT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|vue|svelte|astro|css|scss|sass|less|styl|json|json5|ya?ml|graphql|gql|html|svg)$/i;

function globRe(pattern) {
  const p = pattern.replace(/^\.\//, '');
  if (!/[*?]/.test(p)) return null;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      re += '.*';
      i++;
      if (p[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(rel, patterns) {
  for (const raw of patterns || []) {
    if (typeof raw !== 'string' || !raw) continue;
    const re = globRe(raw);
    if (re ? re.test(rel) : rel === raw.replace(/^\.\//, '').replace(/\/$/, '') || rel.startsWith(raw.replace(/^\.\//, '').replace(/\/?$/, '/'))) return true;
  }
  return false;
}

// kind: 'test' | 'support' | 'config' | 'product' | 'unrelated'   (e2e 는 support 로, e2e:true 표시)
// runner 를 알면 그 러너의 기본 수집 규칙을 따른다: Vitest 는 __tests__ 아래라도 이름이 *.test.* · *.spec.* 인
// 파일만 수집하고, Jest 는 __tests__ 아래 코드 파일을 전부 수집한다.
export function classify(rel, decl = {}, runner = null) {
  const segs = rel.split('/');
  const base = segs[segs.length - 1];
  const dirs = segs.slice(0, -1);
  const e2e = matchesAny(rel, decl.e2ePaths) || dirs.some((d) => E2E_DIRS.has(d)) || /\.e2e\.[cm]?[jt]sx?$/.test(base) || /^playwright\.config\./.test(base) || /^cypress\.config\./.test(base);
  if (e2e) return { kind: 'support', e2e: true };
  if (matchesAny(rel, decl.testPaths) && CODE_EXT.test(base)) return { kind: 'test' };
  if (TEST_NAME.test(base) || (runner !== 'vitest' && dirs.includes('__tests__') && CODE_EXT.test(base))) return { kind: 'test' };
  if (matchesAny(rel, decl.supportPaths) || dirs.some((d) => SUPPORT_DIRS.has(d)) || /\.snap$/.test(base) || SETUP_NAME.test(base)) return { kind: 'support' };
  if (LOCKS.has(base) || CONFIG_NAME.test(base)) return { kind: 'config' };
  if (PRODUCT_EXT.test(base)) return { kind: 'product' };
  return { kind: 'unrelated' };
}

// 동작을 담을 수 있는 «제품 코드» — 제품 소스 중 JS·TS 계열(타입 선언 *.d.ts 제외). 종료 훅이 «이번 턴에 바뀐 제품 코드» 를
// 셀 때 쓴다. 스타일 · 데이터 · 마크업 파일은 제품 소스지만 여기에 들지 않는다(그 파일만 바뀐 턴은 훅이 침묵한다).
const DECL_TYPES = /\.d\.[cm]?ts$/;
export function isProductCode(rel, decl = {}, runner = null) {
  const base = rel.split('/').pop();
  return classify(rel, decl, runner).kind === 'product' && CODE_EXT.test(base) && !DECL_TYPES.test(base);
}

export const toPosix = (p) => p.split(path.sep).join('/');
