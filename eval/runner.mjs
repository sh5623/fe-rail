#!/usr/bin/env node
// [fe-rail] eval/runner.mjs — 회귀 테스트 확인(test-verify) 실제 러너 eval. 고정 버전 fixture 를 설치해 실제 러너로 돈다.
// 검증된 조합(lib/test-verify/project.mjs 의 VERIFIED)을 «전부» 돈다 — 이 eval 을 통과한 조합만 종료 훅이 자동으로 막는다.
// 도구가 없으면 건너뛰지 않고 실패한다(«검증됨» 주장의 근거가 이 eval 이기 때문). 첫 설치에 네트워크가 필요하다.
//   사용: node eval/runner.mjs [--only <pm>-<runner>-<major>]… [--keep]
//   pnpm 저장소: FE_RAIL_EVAL_PNPM_STORE (기본 <임시 폴더>/fe-rail-eval-pnpm-store)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFIED } from '../lib/test-verify/project.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'fe-rail.mjs');
const argv = process.argv.slice(2);
const only = argv.flatMap((a, i) => (a === '--only' ? [argv[i + 1]] : []));
const keep = argv.includes('--keep');
let PASS = 0;
let FAIL = 0;
const ok = (l) => { PASS++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ng = (l, d = '') => { FAIL++; console.log(`  \x1b[31m✗\x1b[0m ${l}${d ? ` — ${String(d).slice(0, 600)}` : ''}`); };
const check = (c, l, d) => (c ? ok(l) : ng(l, d));

const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-rail-runner-eval-')));
if (!keep) process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }));
const STORE = process.env.FE_RAIL_EVAL_PNPM_STORE || path.join(fs.realpathSync(os.tmpdir()), 'fe-rail-eval-pnpm-store');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FE_RAIL_VERIFY|CLAUDE_CODE_SESSION_ID|CLAUDE_SESSION_ID|NODE_OPTIONS|VITEST|JEST_WORKER_ID)/.test(k)));

function run(cwd, file, args, { env = {}, input, timeout = 600000 } = {}) {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8', input, env: { ...ENV, ...env }, maxBuffer: 1 << 28, timeout });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const git = (cwd, ...a) => run(cwd, 'git', a);
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(p, { force: true, recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function commit(dir, msg) {
  const list = git(dir, 'ls-files', '-z', '--others', '--exclude-standard', '--modified', '--deleted').out.split('\0').filter(Boolean);
  if (list.length) git(dir, 'add', '-A', '--', ...list);
  git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
}
const reset = (dir) => {
  git(dir, 'reset', '-q', '--hard');
  git(dir, 'clean', '-qfd');
};
function verify(cwd, args, env = {}) {
  const r = run(cwd, process.execPath, [BIN, 'verify-test', args[0], '--json', ...args.slice(1)], { env });
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    /* 사용법 오류 */
  }
  return { ...r, json };
}
const V = (r) => Object.fromEntries((r.json?.targets || []).map((t) => [t.name, t.verdict]));
const detail = (r) => r.err || JSON.stringify(r.json?.fatal || (r.json?.targets || []).map((t) => [t.name, t.verdict, t.reason, t.failure?.message]));

// ── fixture ──────────────────────────────────────────────────────────────────
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function vitestFixture(combo) {
  const dir = path.join(T, `${combo.id}`);
  initRepo(dir);
  const wsDep = combo.pm === 'pnpm' ? 'workspace:*' : '*';
  const root = { name: 'fx', private: true, type: 'module', devDependencies: { vitest: combo.pinned } };
  if (combo.pm === 'npm') root.workspaces = ['packages/*', 'apps/*'];
  write(dir, {
    '.gitignore': 'node_modules\ndist\n',
    'package.json': JSON.stringify(root, null, 2),
    ...(combo.pm === 'pnpm' ? { 'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n  - "apps/*"\n' } : {}),
    'packages/ui/package.json': JSON.stringify({ name: '@fx/ui', version: '1.0.0', type: 'module', exports: { '.': './src/index.js' } }),
    'packages/ui/src/index.js': 'export const label = (n) => `n=${n}`\n',
    'packages/kit/package.json': JSON.stringify({ name: '@fx/kit', version: '1.0.0', type: 'module', exports: { '.': './dist/index.js' }, scripts: { build: 'node build.mjs' } }),
    'packages/kit/build.mjs': "import fs from 'node:fs'\nfs.mkdirSync('dist', { recursive: true })\nfs.copyFileSync('src/index.js', 'dist/index.js')\n",
    'packages/kit/src/index.js': 'export const twice = (n) => n * 2\n',
    'apps/web/package.json': JSON.stringify({ name: 'web', version: '1.0.0', type: 'module', dependencies: { '@fx/ui': wsDep, '@fx/kit': wsDep } }),
    'apps/web/src/price.js': 'export const price = (n) => n\n',
    'apps/admin/package.json': JSON.stringify({ name: 'admin', version: '1.0.0', type: 'module' }),
    'apps/admin/src/x.js': 'export const x = 1\n',
  });
  const inst = combo.pm === 'pnpm'
    ? run(dir, 'pnpm', ['install', '--store-dir', STORE, '--config.minimum-release-age=0', '--reporter=silent'])
    : run(dir, 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
  if (inst.code !== 0) return { dir, error: `${combo.pm} install 실패: ${(inst.err || inst.out).trim().split('\n').slice(-3).join(' / ')}` };
  commit(dir, 'base');
  return { dir };
}

function jestFixture(combo) {
  const dir = path.join(T, `${combo.id}`);
  initRepo(dir);
  write(dir, {
    '.gitignore': 'node_modules\n',
    'package.json': JSON.stringify({ name: 'fxj', private: true, devDependencies: { jest: combo.pinned } }, null, 2),
    'src/price.js': 'exports.price = (n) => n\n',
  });
  const inst = run(dir, 'npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
  if (inst.code !== 0) return { dir, error: `npm install 실패: ${(inst.err || inst.out).trim().split('\n').slice(-3).join(' / ')}` };
  commit(dir, 'base');
  return { dir };
}

// ── Vitest 조합 ──────────────────────────────────────────────────────────────
const VT = (body) => `import { afterAll, beforeEach, describe, expect, it } from 'vitest'\nimport { existsSync, writeFileSync } from 'node:fs'\n${body}\n`;

async function vitestScenarios(combo, dir) {
  const tag = `${combo.pm} + Vitest ${combo.pinned}`;
  const W = 'apps/web/src';
  // 1) 판정 경계 — 한 파일에 모아 한 번에(같은 실행 안에서 케이스마다 판정)
  write(dir, {
    [`${W}/conf.js`]: 'export const conf = () => undefined\n',
    [`${W}/wait.js`]: 'export const wait = () => new Promise(() => {})\n',
    [`${W}/ready.js`]: 'export const ready = false\n',
    [`${W}/price.test.js`]: VT("import { price } from './price.js'\nit('0 은 0', () => { expect(price(0)).toBe(0) })\nit('부가세 기존', () => { expect(price(100)).toBe(110) })"),
  });
  commit(dir, 's1-base');
  write(dir, {
    [`${W}/price.js`]: 'export const price = (n) => Math.round(n * 1.1)\n',
    [`${W}/conf.js`]: 'export const conf = () => ({ rate: 1 })\n',
    [`${W}/wait.js`]: 'export const wait = () => Promise.resolve(1)\n',
    [`${W}/ready.js`]: 'export const ready = true\n',
    [`${W}/price.test.js`]: VT([
      "import { price } from './price.js'",
      "import { conf } from './conf.js'",
      "import { wait } from './wait.js'",
      "import { ready } from './ready.js'",
      "it('0 은 0', () => { expect(price(0)).toBe(0) })",
      "it('부가세 기존', () => { expect(price(100)).toBe(110) })",
      "it('본문 단언', () => { expect(price(200)).toBe(220) })",
      "it('숫자를 돌려준다', () => { expect(typeof price(5)).toBe('number') })",
      "describe('준비 예외', () => {\n  beforeEach(() => { if (price(10) !== 11) throw new Error('setup') })\n  it('대상', () => { expect(1).toBe(1) })\n})",
      "describe('준비 단언', () => {\n  beforeEach(() => { expect(price(10)).toBe(11) })\n  it('대상', () => { expect(1).toBe(1) })\n})",
      "it('본문 TypeError', () => { expect(conf().rate).toBe(1) })",
      "it('개별 시간 초과', async () => { expect(await wait()).toBe(1) }, 300)",
      "it('사전조건 먼저', () => { expect(ready).toBe(true); expect(price(100)).toBe(110) })",
      "for (const n of [1, 1]) it(`중복 ${n}`, () => { expect(price(100)).toBe(110) })",
    ].join('\n')),
  });
  const r1 = verify(dir, ['base', '--', `${W}/price.test.js`]);
  const v = V(r1);
  check(v['본문 단언'] === 'detected' && v['사전조건 먼저'] === 'detected', `${tag}: 본문 단언 실패(사전조건 단언 포함 · --expect 없음) = 검출`, detail(r1));
  check(v['준비 예외 > 대상'] === 'unconfirmed' && v['준비 단언 > 대상'] === 'unconfirmed', `${tag}: beforeEach 일반 예외 · beforeEach 안 단언 실패 = 원인 미확인`, detail(r1));
  check(v['본문 TypeError'] === 'unconfirmed' && v['개별 시간 초과'] === 'unconfirmed', `${tag}: 본문 일반 예외 · 개별 시간 초과 = 원인 미확인`, detail(r1));
  check(v['숫자를 돌려준다'] === 'undetected' && !('부가세 기존' in v) && (r1.json?.others || []).some((o) => o.name === '부가세 기존'),
    `${tag}: 기존 케이스만 뒤집히고 새 케이스는 통과 → 통과 = 새 케이스 미검출 + 참고 1건`, detail(r1));
  check(v['중복 1'] === 'unmeasurable', `${tag}: 이름이 같은 동적 케이스 둘 = 측정 불가`, detail(r1));
  const r2 = verify(dir, ['base', '--test', '사전조건 먼저', '--expect', 'expected 100 to be 110', '--', `${W}/price.test.js`]);
  check(V(r2)['사전조건 먼저'] === 'unconfirmed', `${tag}: 같은 경우에 회귀 단언 문자열로 --expect 지정 = 원인 미확인`, detail(r2));
  reset(dir);

  // 2) 파일 로딩 실패(새 모듈) · 정리 단계 실패 · 같은 소스 대조의 상태 파일
  write(dir, {
    [`${W}/fmt.js`]: 'export const fmt = (n) => `#${n}`\n',
    [`${W}/fmt.test.js`]: VT("import { fmt } from './fmt.js'\nit('형식', () => { expect(fmt(1)).toBe('#1') })"),
  });
  const r3 = verify(dir, ['base', '--', `${W}/fmt.test.js`]);
  check(V(r3)['형식'] === 'unmeasurable' && /mutate/.test(r3.json?.targets?.[0]?.reason || ''), `${tag}: 대조에서 파일 로딩 실패(새 모듈) = 측정 불가 + 지정 변이 안내`, detail(r3));
  const r3m = verify(dir, ['mutate', '--file', `${W}/fmt.js`, '--find', '`#${n}`', '--replace', '`*${n}`', '--', `${W}/fmt.test.js`]);
  check(V(r3m)['형식'] === 'detected', `${tag}: 같은 테스트를 지정 변이로 재면 검출`, detail(r3m));
  reset(dir);
  write(dir, { [`${W}/ready2.js`]: 'export const ok = () => true\n' });
  commit(dir, 's2-base');
  write(dir, {
    [`${W}/ready2.js`]: 'export const ok = () => true\nexport const extra = 1\n',
    [`${W}/ready2.test.js`]: VT("import * as m from './ready2.js'\nafterAll(() => { if (m.extra !== 1) throw new Error('정리 실패') })\nit('준비됨', () => { expect(m.ok()).toBe(true) })"),
  });
  const r4 = verify(dir, ['base', '--', `${W}/ready2.test.js`]);
  check(V(r4)['준비됨'] === 'unmeasurable' && /파일 수준 오류/.test(r4.json?.targets?.[0]?.reason || ''), `${tag}: 대조에서 afterAll 실패 · 케이스는 통과로 보고 = 측정 불가`, detail(r4));
  reset(dir);
  write(dir, {
    [`${W}/state.test.js`]: VT("import { price } from './price.js'\nit('상태 파일', () => { const p = new URL('./.state', import.meta.url); const had = existsSync(p); writeFileSync(p, '1'); expect(had).toBe(false); expect(price(1)).toBe(1) })"),
  });
  const r5 = verify(dir, ['mutate', '--file', `${W}/price.js`, '--find', '(n) => n', '--replace', '(n) => n', '--', `${W}/state.test.js`]);
  check(V(r5)['상태 파일'] === 'undetected', `${tag}: 제품 소스가 같은 대조 + 첫 실행이 상태 파일을 남김 → 뒤집힘 0건(깨끗한 격리본 둘)`, detail(r5));
  reset(dir);

  // 3) 워크스페이스 — 소스 내보냄 · 빌드 결과물 · 다른 앱
  write(dir, {
    'packages/ui/src/index.js': 'export const label = (n) => `값=${n}`\n',
    [`${W}/label.test.js`]: VT("import { label } from '@fx/ui'\nit('라벨', () => { expect(label(3)).toBe('값=3') })"),
  });
  const r6 = verify(dir, ['base', '--', `${W}/label.test.js`]);
  check(V(r6)['라벨'] === 'detected', `${tag}: 워크스페이스 패키지(@scope 묶음 아래 · 소스 내보냄) 수정 → 대조 실행이 격리본의 대조 코드를 읽어 검출`, detail(r6));
  reset(dir);
  write(dir, {
    'packages/kit/src/index.js': 'export const twice = (n) => n + n + 1\n',
    [`${W}/kit.test.js`]: VT("import { twice } from '@fx/kit'\nit('두 배 + 1', () => { expect(twice(2)).toBe(5) })"),
  });
  const r7 = verify(dir, ['base', '--', `${W}/kit.test.js`]);
  check(/빌드 결과물/.test(r7.json?.fatal || ''), `${tag}: 빌드 결과물을 내보내는 패키지 수정 · 준비 명령 없음 = 측정 불가`, detail(r7));
  reset(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg['fe-rail'] = { testVerify: { prepare: combo.pm === 'pnpm' ? 'pnpm --filter @fx/kit run build' : 'npm run build -w @fx/kit --silent' } };
  write(dir, { 'package.json': JSON.stringify(pkg, null, 2) });
  commit(dir, 's3-prepare');
  write(dir, {
    'packages/kit/src/index.js': 'export const twice = (n) => n + n + 1\n',
    [`${W}/kit.test.js`]: VT("import { twice } from '@fx/kit'\nit('두 배 + 1', () => { expect(twice(2)).toBe(5) })"),
  });
  const r8 = verify(dir, ['base', '--', `${W}/kit.test.js`]);
  check(V(r8)['두 배 + 1'] === 'detected', `${tag}: 같은 경우 · 준비 명령 선언 → 양쪽에서 빌드해 대조 소스로 만든 결과물을 읽어 검출`, detail(r8));
  reset(dir);
  write(dir, {
    'apps/admin/src/x.js': 'export const x = 2\n',
    [`${W}/price.test.js`]: fs.readFileSync(path.join(dir, `${W}/price.test.js`), 'utf8') + "it('다른 앱 소스', () => { expect(1).toBe(1) })\n",
  });
  const r9 = verify(dir, ['base', '--', `${W}/price.test.js`]);
  check(/대조할 제품 소스 차이 없음/.test(r9.json?.fatal || ''), `${tag}: 다른 앱의 소스 + 이 앱의 테스트 = 대조 대상 아님`, detail(r9));
  reset(dir);

  // 3-b) 러너 설정이 루트에만 있는 워크스페이스 — 설정이 있는 폴더에서 러너를 돌린다(Vitest 는 설정을 위로 찾지 않는다)
  write(dir, { 'vitest.config.js': "export default { test: { include: ['apps/**/*.test.js'], globals: true } }\n" });
  commit(dir, 's3b-root-config');
  write(dir, {
    [`${W}/price.js`]: 'export const price = (n) => n + 1\n',
    [`${W}/globals.test.js`]: "import { price } from './price.js'\nit('전역 it · 하나 더', () => { expect(price(1)).toBe(2) })\n",
  });
  const r9b = verify(dir, ['base', '--', `${W}/globals.test.js`]);
  check(V(r9b)['전역 it · 하나 더'] === 'detected', `${tag}: 러너 설정이 루트에만 있으면(전역 it · include) 그 폴더에서 러너를 돌려 검출`, detail(r9b));
  reset(dir);
  write(dir, { 'vitest.config.js': null });
  commit(dir, 's3b-remove-root-config');

  // 4) 스냅샷 — 읽기 전용
  write(dir, {
    [`${W}/price.js`]: 'export const price = (n) => Math.round(n * 1.15)\n',
    [`${W}/snap.test.js`]: VT("import { price } from './price.js'\nit('가격 스냅샷', () => { expect({ total: price(100) }).toMatchSnapshot() })"),
  });
  const r10 = verify(dir, ['base', '--', `${W}/snap.test.js`]);
  check(V(r10)['가격 스냅샷'] === 'unmeasurable' && !fs.existsSync(path.join(dir, W, '__snapshots__')), `${tag}: 기준 스냅샷이 없는 스냅샷 테스트 = 측정 불가 · 어디에도 스냅샷을 쓰지 않음`, detail(r10));
  const vit = path.join(dir, 'node_modules', 'vitest', 'vitest.mjs');
  run(path.join(dir, 'apps/web'), process.execPath, [vit, 'run', 'src/snap.test.js', '-u']); // 현재 상태의 기준 스냅샷을 만든다
  const r11 = verify(dir, ['base', '--', `${W}/snap.test.js`]);
  check(fs.existsSync(path.join(dir, W, '__snapshots__')) && V(r11)['가격 스냅샷'] === 'detected', `${tag}: 기준 스냅샷이 있고 대조 소스가 다른 값을 렌더링 = 검출`, detail(r11));
  reset(dir);

  // 5) 실행 도중의 스테이징 보존
  write(dir, { [`${W}/price.js`]: 'export const price = (n) => n + 0\n', 'NOTES.md': 'a\n', [`${W}/p2.test.js`]: VT("import { price } from './price.js'\nit('p2', async () => { await new Promise((r) => setTimeout(r, 800)); expect(price(1)).toBe(1) })") });
  git(dir, 'add', `${W}/price.js`);
  const before = git(dir, 'ls-files', '-s').out + git(dir, 'diff').out;
  const child = spawn(process.execPath, [BIN, 'verify-test', 'base', '--json', '--', `${W}/p2.test.js`], { cwd: dir, env: ENV, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  write(dir, { 'NOTES.md': 'b\n' });
  git(dir, 'add', 'NOTES.md');
  const staged = git(dir, 'show', ':NOTES.md').out;
  await new Promise((r) => child.on('close', r));
  const after = git(dir, 'ls-files', '-s').out;
  check(staged === 'b\n' && git(dir, 'show', ':NOTES.md').out === 'b\n' && git(dir, 'show', `:${W}/price.js`).out === 'export const price = (n) => n + 0\n'
    && before.split('\n').filter((l) => l.includes('price.js')).join() === after.split('\n').filter((l) => l.includes('price.js')).join(),
  `${tag}: 실행 도중 다른 프로세스가 스테이징해도 실행 뒤 index · 작업 트리가 그대로`);
  reset(dir);

  // 6) 제품 코드만 고치고 기존 테스트는 손대지 않은 턴(v1.22.0) — 훅이 막고 · 기존 케이스 지정으로 대조 · report 한 줄
  write(dir, {
    [`${W}/submit.js`]: 'export function createSubmitter(send) {\n  return () => send()\n}\n',
    [`${W}/submit.test.js`]: [
      "import { expect, it, vi } from 'vitest'",
      "import { createSubmitter } from './submit.js'",
      "it('처리 중 다시 눌러도 요청은 한 번', async () => {",
      '  let release',
      '  const send = vi.fn(() => new Promise((r) => { release = r }))',
      '  const submit = createSubmitter(send)',
      '  const first = submit()',
      '  submit()',
      '  expect(send).toHaveBeenCalledTimes(1)',
      '  release()',
      '  await first',
      '})',
    ].join('\n') + '\n',
  });
  commit(dir, 's6-base');
  const sid6 = `runner-${combo.id}-6`;
  run(dir, process.execPath, [BIN, 'hook', 'turn-start'], { input: JSON.stringify({ session_id: sid6, cwd: dir }) });
  write(dir, { [`${W}/submit.js`]: 'export function createSubmitter(send) {\n  let pending = false\n  return async () => {\n    if (pending) return\n    pending = true\n    try { await send() } finally { pending = false }\n  }\n}\n' });
  const h6 = run(dir, process.execPath, [BIN, 'hook', 'stop'], { input: JSON.stringify({ session_id: sid6, cwd: dir, stop_hook_active: false }) });
  check(/"decision":"block"/.test(h6.out) && /제품 코드 1개/.test(h6.out) && /apps\/web\/src\/submit\.js {2}\(후보 테스트: apps\/web\/src\/submit\.test\.js\)/.test(h6.out),
    `${tag}: 제품 코드만 고친 턴 → 종료 훅이 막고 같은 이름의 기존 테스트를 후보로 보여 준다`, h6.out + h6.err);
  const r12 = verify(dir, ['base', '--test', '처리 중 다시 눌러도 요청은 한 번', '--intent', '중복 제출 가드 추가 되돌림', '--', `${W}/submit.test.js`], { CLAUDE_CODE_SESSION_ID: sid6 });
  check(V(r12)['처리 중 다시 눌러도 요청은 한 번'] === 'detected' && /called 1 times, but got 2 times/.test(r12.json?.targets?.[0]?.raw?.err?.message || ''),
    `${tag}: 손대지 않은 기존 케이스를 --test 로 지정한 수정 전 대조 = 요청 횟수 단언(기대 1 · 실제 2)이 뒤집혀 검출`, detail(r12));
  const r13 = verify(dir, ['mutate', '--file', `${W}/submit.js`, '--find', '    if (pending) return\n', '--replace', '', '--test', '처리 중 다시 눌러도 요청은 한 번', '--intent', '중복 제출 가드 제거', '--', `${W}/submit.test.js`]);
  check(V(r13)['처리 중 다시 눌러도 요청은 한 번'] === 'detected', `${tag}: 같은 케이스로 가드 한 줄만 지운 지정 변이 = 검출`, detail(r13));
  const h6b = run(dir, process.execPath, [BIN, 'hook', 'stop'], { input: JSON.stringify({ session_id: sid6, cwd: dir, stop_hook_active: false }) });
  const rep6 = run(dir, process.execPath, [BIN, 'verify-test', 'report'], { env: { CLAUDE_CODE_SESSION_ID: sid6 } });
  check(!/"decision":"block"/.test(h6b.out) && rep6.code === 0
    && /- apps\/web\/src\/submit\.js: 중복 제출 가드 제거 → apps\/web\/src\/submit\.test\.js › 처리 중 다시 눌러도 요청은 한 번 → .*called 1 times, but got 2 times.* → 검출 \[지정 변이\]/.test(rep6.out),
  `${tag}: 대조 기록이 생기면 훅은 침묵하고, report 가 «깨뜨린 동작 → 케이스 → 실제 관측값 → 판정» 을 낸다`, h6b.out + rep6.out + rep6.err);
  reset(dir);
}

// ── Jest 조합 ────────────────────────────────────────────────────────────────
async function jestScenarios(combo, dir) {
  const tag = `${combo.pm} + Jest ${combo.pinned}`;
  write(dir, {
    'src/conf.js': 'exports.conf = () => undefined\n',
    'src/wait.js': 'exports.wait = () => new Promise(() => {})\n',
    'src/__tests__/price.cjs': "const { price } = require('../price')\nit('0 은 0', () => { expect(price(0)).toBe(0) })\nit('부가세 기존', () => { expect(price(100)).toBe(110) })\n",
  });
  commit(dir, 'j-base');
  write(dir, {
    'src/price.js': 'exports.price = (n) => Math.round(n * 1.1)\n',
    'src/conf.js': 'exports.conf = () => ({ rate: 1 })\n',
    'src/wait.js': 'exports.wait = () => Promise.resolve(1)\n',
    'src/__tests__/price.cjs': [
      "const { price } = require('../price')",
      "const { conf } = require('../conf')",
      "const { wait } = require('../wait')",
      "expect.extend({ toBeTaxed(r) { return { pass: r === 110, message: () => `expected ${r} to be taxed` } } })",
      "it('0 은 0', () => { expect(price(0)).toBe(0) })",
      "it('부가세 기존', () => { expect(price(100)).toBe(110) })",
      "it('본문 단언', () => { expect(price(200)).toBe(220) })",
      "it('확장 단언', () => { expect(price(100)).toBeTaxed() })",
      "it('숫자를 돌려준다', () => { expect(typeof price(5)).toBe('number') })",
      "describe('준비 예외', () => {\n  beforeEach(() => { if (price(10) !== 11) throw new Error('setup') })\n  it('대상', () => { expect(1).toBe(1) })\n})",
      "describe('준비 단언', () => {\n  beforeEach(() => { expect(price(10)).toBe(11) })\n  it('대상', () => { expect(1).toBe(1) })\n})",
      "it('본문 TypeError', () => { expect(conf().rate).toBe(1) })",
      "it('개별 시간 초과', async () => { expect(await wait()).toBe(1) }, 300)",
      "for (const n of [1, 1]) it(`중복 ${n}`, () => { expect(price(100)).toBe(110) })",
    ].join('\n') + '\n',
  });
  const r1 = verify(dir, ['base', '--', 'src/__tests__/price.cjs']);
  const v = V(r1);
  check(v['본문 단언'] === 'detected' && v['확장 단언'] === 'detected', `${tag}: 본문 단언 · expect.extend 단언 실패 = 검출(이름 관례 밖 __tests__/*.cjs)`, detail(r1));
  check(v['준비 예외 > 대상'] === 'unconfirmed' && v['준비 단언 > 대상'] === 'unconfirmed' && v['본문 TypeError'] === 'unconfirmed' && v['개별 시간 초과'] === 'unconfirmed',
    `${tag}: beforeEach 예외 · beforeEach 안 단언 · 본문 TypeError · 개별 시간 초과 = 원인 미확인`, detail(r1));
  check(v['숫자를 돌려준다'] === 'undetected' && v['중복 1'] === 'unmeasurable' && (r1.json?.others || []).some((o) => o.name === '부가세 기존'),
    `${tag}: 새 케이스 미검출 + 기존 케이스 참고 · 이름 중복 = 측정 불가`, detail(r1));
  const r2 = verify(dir, ['base', '--test', '본문 단언', '--expect', 'Received: 200', '--', 'src/__tests__/price.cjs']);
  const r2b = verify(dir, ['base', '--test', '본문 단언', '--expect', 'Received: 999', '--', 'src/__tests__/price.cjs']);
  check(V(r2)['본문 단언'] === 'detected' && V(r2b)['본문 단언'] === 'unconfirmed', `${tag}: --expect 가 실패 메시지에 있으면 검출 · 없으면 원인 미확인`, detail(r2b));
  reset(dir);
  write(dir, { 'src/fmt.js': 'exports.fmt = (n) => `#${n}`\n', 'src/__tests__/fmt.cjs': "const { fmt } = require('../fmt')\nit('형식', () => { expect(fmt(1)).toBe('#1') })\n" });
  const r3 = verify(dir, ['base', '--', 'src/__tests__/fmt.cjs']);
  check(V(r3)['형식'] === 'unmeasurable', `${tag}: 대조에서 파일 로딩 실패 = 측정 불가`, detail(r3));
  reset(dir);
  write(dir, { 'src/ready.js': 'exports.ok = () => true\n' });
  commit(dir, 'j2');
  write(dir, {
    'src/ready.js': 'exports.ok = () => true\nexports.extra = 1\n',
    'src/__tests__/ready.cjs': "const m = require('../ready')\nafterAll(() => { if (m.extra !== 1) throw new Error('정리 실패') })\nit('준비됨', () => { expect(m.ok()).toBe(true) })\n",
  });
  const r4 = verify(dir, ['base', '--', 'src/__tests__/ready.cjs']);
  check(V(r4)['준비됨'] === 'unmeasurable', `${tag}: 대조에서 afterAll 실패 = 측정 불가`, detail(r4));
  reset(dir);
  write(dir, { 'src/price.js': 'exports.price = (n) => Math.round(n * 1.15)\n', 'src/__tests__/snap.cjs': "const { price } = require('../price')\nit('가격 스냅샷', () => { expect({ total: price(100) }).toMatchSnapshot() })\n" });
  const r5 = verify(dir, ['base', '--', 'src/__tests__/snap.cjs']);
  check(V(r5)['가격 스냅샷'] === 'unmeasurable' && !fs.existsSync(path.join(dir, 'src/__tests__/__snapshots__')), `${tag}: 기준 스냅샷 없음 = 측정 불가 · 스냅샷을 쓰지 않음(--ci)`, detail(r5));
  reset(dir);
  // 훅: Jest 의 이름 관례 밖 __tests__/*.cjs 도 «실행할 테스트» 로 보고 막는다(검증된 조합)
  const sid = 'runner-eval';
  run(dir, process.execPath, [BIN, 'hook', 'turn-start'], { input: JSON.stringify({ session_id: sid, cwd: dir }) });
  write(dir, { 'src/price.js': 'exports.price = (n) => n + 1\n', 'src/__tests__/plus.cjs': "const { price } = require('../price')\nit('하나 더', () => { expect(price(1)).toBe(2) })\n" });
  const h = run(dir, process.execPath, [BIN, 'hook', 'stop'], { input: JSON.stringify({ session_id: sid, cwd: dir, stop_hook_active: false }) });
  check(/"decision":"block"/.test(h.out) && /__tests__\/plus\.cjs/.test(h.out), `${tag}: 종료 훅이 __tests__/*.cjs(Jest 기본 수집)를 바뀐 테스트로 보고 막는다`, h.out + h.err);
  reset(dir);
  // 제품 코드만 고치고 기존 테스트는 손대지 않은 턴(v1.22.0)
  write(dir, {
    'src/submit.js': 'exports.createSubmitter = (send) => () => send()\n',
    'src/submit.test.js': [
      "const { createSubmitter } = require('./submit')",
      "it('처리 중 다시 눌러도 요청은 한 번', async () => {",
      '  let release',
      '  const send = jest.fn(() => new Promise((r) => { release = r }))',
      '  const submit = createSubmitter(send)',
      '  const first = submit()',
      '  submit()',
      '  expect(send).toHaveBeenCalledTimes(1)',
      '  release()',
      '  await first',
      '})',
    ].join('\n') + '\n',
  });
  commit(dir, 'j6-base');
  const sid6 = `runner-${combo.id}-6`;
  run(dir, process.execPath, [BIN, 'hook', 'turn-start'], { input: JSON.stringify({ session_id: sid6, cwd: dir }) });
  write(dir, { 'src/submit.js': 'exports.createSubmitter = (send) => {\n  let pending = false\n  return async () => {\n    if (pending) return\n    pending = true\n    try { await send() } finally { pending = false }\n  }\n}\n' });
  const h6 = run(dir, process.execPath, [BIN, 'hook', 'stop'], { input: JSON.stringify({ session_id: sid6, cwd: dir, stop_hook_active: false }) });
  check(/"decision":"block"/.test(h6.out) && /src\/submit\.js {2}\(후보 테스트: src\/submit\.test\.js\)/.test(h6.out), `${tag}: 제품 코드만 고친 턴 → 종료 훅이 막고 기존 테스트를 후보로 보여 준다`, h6.out + h6.err);
  const r6 = verify(dir, ['mutate', '--file', 'src/submit.js', '--find', '    if (pending) return\n', '--replace', '', '--test', '처리 중 다시 눌러도 요청은 한 번', '--intent', '중복 제출 가드 제거', '--', 'src/submit.test.js']);
  const rep6 = run(dir, process.execPath, [BIN, 'verify-test', 'report'], { env: { CLAUDE_CODE_SESSION_ID: sid6 } });
  check(V(r6)['처리 중 다시 눌러도 요청은 한 번'] === 'detected' && rep6.code === 0
    && /- src\/submit\.js: 중복 제출 가드 제거 → src\/submit\.test\.js › 처리 중 다시 눌러도 요청은 한 번 → .*Received number of calls: 2.* → 검출 \[지정 변이\]/.test(rep6.out),
  `${tag}: 손대지 않은 기존 케이스로 가드 제거 변이 = 검출 · report 의 관측값에 «Received number of calls: 2» 가 실린다`, detail(r6) + rep6.out);
  reset(dir);
}

// 원본 node_modules 의 최상위 항목 · 링크 대상 · 패키지 매니저 메타데이터 파일 내용(캐시 폴더 제외).
function nodeModulesFingerprint(dir) {
  const nm = path.join(dir, 'node_modules');
  const lines = [];
  for (const n of fs.readdirSync(nm).sort()) {
    if (['.cache', '.vite', '.vite-temp', '.vitest', '.vitest-cache', '.tmp'].includes(n)) continue; // eval 이 원본에서 직접 돌린 러너의 캐시
    const p = path.join(nm, n);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) lines.push(`${n} -> ${fs.readlinkSync(p)}`);
    else if (st.isFile()) lines.push(`${n} = ${fs.readFileSync(p).toString('base64').slice(0, 2000)}`);
    else lines.push(`${n}/ ${fs.readdirSync(p).length}`);
  }
  return lines.join('\n');
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log('━━━ test-verify 실제 러너 eval (고정 버전 fixture) ━━━');
const combos = VERIFIED.map((v) => ({ ...v, id: `${v.pm}-${v.runner}-${v.major}` })).filter((c) => !only.length || only.includes(c.id));
for (const c of combos) {
  const tool = c.pm === 'pnpm' ? run(T, 'pnpm', ['--version']) : run(T, 'npm', ['--version']);
  if (tool.code !== 0) {
    ng(`${c.id}: ${c.pm} 가 없어 이 조합을 검증하지 못함(«검증된 조합» 은 이 eval 을 통과해야 한다)`);
    continue;
  }
  const t0 = Date.now();
  const fx = c.runner === 'vitest' ? vitestFixture(c) : jestFixture(c);
  if (fx.error) {
    ng(`${c.id}: fixture 설치 실패`, fx.error);
    continue;
  }
  const installed = JSON.parse(fs.readFileSync(path.join(fx.dir, 'node_modules', c.runner, 'package.json'), 'utf8')).version;
  check(installed === c.pinned, `${c.id}: 설치된 ${c.runner} = 고정 버전 ${c.pinned}`, installed);
  const nmBefore = nodeModulesFingerprint(fx.dir);
  if (c.runner === 'vitest') await vitestScenarios(c, fx.dir);
  else await jestScenarios(c, fx.dir);
  const nmAfter = nodeModulesFingerprint(fx.dir);
  const nmDiff = [...nmBefore.split('\n').filter((l) => !nmAfter.split('\n').includes(l)).map((l) => `- ${l.slice(0, 120)}`), ...nmAfter.split('\n').filter((l) => !nmBefore.split('\n').includes(l)).map((l) => `+ ${l.slice(0, 120)}`)];
  check(!nmDiff.length, `${c.id}: 모든 시나리오 뒤에도 원본 node_modules(최상위 항목 · 패키지 매니저 메타데이터)가 그대로 — 격리본의 링크를 따라 원본에 쓰지 않았다`, nmDiff.join(' | '));
  console.log(`    (${c.id} ${Math.round((Date.now() - t0) / 1000)}초)`);
}
console.log(`\nRUNNER_RESULT ${PASS} ${FAIL}`);
process.exitCode = FAIL ? 1 : 0;
