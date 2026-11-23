#!/usr/bin/env node
// [fe-rail] eval/test-verify.mjs — 회귀 테스트 확인(test-verify) 모델 없는 eval. eval/run.sh 의 H 절이 부른다.
// 의존성 설치 없이 돈다: «가짜 Vitest»(node_modules/vitest — 버전 4.1.9 로 보이게)가 테스트 파일의 표식 줄
//   // CASE <전체 이름> :: <소스 경로> :: <문자열>      → 그 소스가 문자열을 담으면 통과(본문 단언 실패로 보고)
//   // HOOKCASE …                                    → 같은데 실패 위치가 선언 앞(준비 단계)
//   // FILEERROR <소스 경로> :: <문자열>               → 그 소스가 문자열을 안 담으면 파일 수준 오류(afterAll 실패 꼴)
// 을 읽어 소스 내용에 따라 결과를 낸다(<문자열> 이 !EXISTS 면 «파일이 없으면 통과»). 실제 러너는 eval/runner.mjs 가 잰다.
// 출력: run.sh 와 같은 ✓/✗ 줄 + 마지막 줄 «TV_RESULT <pass> <fail>»
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'fe-rail.mjs');
const FIX = path.join(ROOT, 'eval', 'fixtures', 'test-verify');
let PASS = 0;
let FAIL = 0;
const ok = (l) => { PASS++; console.log(`  \x1b[32m✓\x1b[0m ${l}`); };
const ng = (l, d = '') => { FAIL++; console.log(`  \x1b[31m✗\x1b[0m ${l}${d ? ` — ${String(d).slice(0, 400)}` : ''}`); };
const check = (cond, label, detail) => (cond ? ok(label) : ng(label, detail));

const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-rail-tv-eval-')));
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }));
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FE_RAIL_|CLAUDE_CODE_SESSION_ID|CLAUDE_SESSION_ID)/.test(k)));

function run(cwd, file, args, { env = {}, input } = {}) {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8', input, env: { ...CLEAN_ENV, ...env }, maxBuffer: 1 << 28 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const git = (cwd, ...a) => run(cwd, 'git', a);
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (content === null) {
      fs.rmSync(p, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function commit(dir, msg = 'c') {
  const list = git(dir, 'ls-files', '-z', '--others', '--exclude-standard', '--modified', '--deleted').out.split('\0').filter(Boolean);
  if (list.length) git(dir, 'add', '-A', '--', ...list);
  return git(dir, 'commit', '-q', '--allow-empty', '-m', msg);
}

const FAKE_VITEST = `#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const argv = process.argv.slice(2);
const files = argv.filter((a) => a !== 'run' && !a.startsWith('-'));
if (process.env.FAKE_SLEEP_MS) { const end = Date.now() + Number(process.env.FAKE_SLEEP_MS); while (Date.now() < end) {} }
const has = (rel, needle) => { const p = path.resolve(rel.trim()); if (needle === '!EXISTS') return !fs.existsSync(p); if (!fs.existsSync(p)) return null; return fs.readFileSync(p, 'utf8').includes(needle); };
const res = { format: 'fe-rail-vitest/1', reason: 'passed', unhandled: [], files: [] };
let bad = false;
for (const f of files) {
  const abs = path.resolve(f); const lines = fs.readFileSync(abs, 'utf8').split('\\n'); let cases = []; const errors = [];
  lines.forEach((line, i) => {
    const fe = /^\\/\\/ FILEERROR (.+?) :: (.+)$/.exec(line);
    if (fe && has(fe[1], fe[2]) === false) errors.push({ name: 'Error', message: 'teardown failed', isAssertion: false, frames: [] });
    const m = /^\\/\\/ (CASE|HOOKCASE) (.+?) :: (.+?) :: (.+)$/.exec(line); if (!m) return;
    const r = has(m[3], m[4]);
    if (r === null) { errors.push({ name: 'Error', message: "Cannot find module '" + m[3] + "'", isAssertion: false, frames: [] }); return; }
    const c = { fullName: m[2], name: m[2].split(' > ').pop(), location: { line: i + 1, column: 1 }, state: r ? 'passed' : 'failed', errors: [] };
    if (!r) c.errors.push({ name: 'AssertionError', message: 'expected source to contain ' + m[4], isAssertion: true, frames: [{ file: abs, line: m[1] === 'HOOKCASE' ? i : i + 1, column: m[1] === 'HOOKCASE' ? 1 : 20 }] });
    cases.push(c);
  });
  if (errors.some((e) => e.message.startsWith('Cannot find'))) cases = [];
  const state = errors.length || cases.some((c) => c.state === 'failed') ? 'failed' : 'passed';
  if (state === 'failed') bad = true;
  res.files.push({ file: abs, state, errors, cases });
}
if (process.env.FE_RAIL_VERIFY_REPORT) fs.writeFileSync(process.env.FE_RAIL_VERIFY_REPORT, JSON.stringify(res));
process.exit(bad || process.env.FAKE_EXIT ? 1 : 0);
`;

function fakeVitest(dir, version = '4.1.9') {
  write(dir, {
    'node_modules/vitest/package.json': JSON.stringify({ name: 'vitest', version, type: 'module' }),
    'node_modules/vitest/vitest.mjs': FAKE_VITEST,
  });
}

function repo(name, files, { vitest = '4.1.9' } = {}) {
  const dir = path.join(T, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.com');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, { '.gitignore': 'node_modules\ndist\n', 'package-lock.json': '{}\n', ...files });
  if (vitest) fakeVitest(dir, vitest);
  commit(dir, 'base');
  return dir;
}

function verify(cwd, args, env = {}) {
  const r = run(cwd, process.execPath, [BIN, 'verify-test', args[0], '--json', ...args.slice(1)], { env });
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    /* 사용법 오류 등 */
  }
  return { ...r, json };
}
const verdicts = (j) => Object.fromEntries((j?.targets || []).map((t) => [t.name, t.verdict]));
function hook(cwd, kind, session, { active = false, env = {}, wrapper = false, msg } = {}) {
  const input = JSON.stringify({ session_id: session, cwd, stop_hook_active: active, hook_event_name: kind, ...(msg !== undefined ? { last_assistant_message: msg } : {}) });
  if (wrapper) return run(cwd, 'bash', [path.join(ROOT, 'hooks', kind === 'stop' ? 'test-verify-stop.sh' : 'test-verify-turn.sh')], { env, input });
  return run(cwd, process.execPath, [BIN, 'hook', kind], { env, input });
}
const blocked = (r) => {
  try {
    return JSON.parse(r.out).decision === 'block';
  } catch {
    return false;
  }
};

function snapshotState(dir) {
  const files = git(dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').out.split('\0').filter(Boolean).sort();
  const content = files.map((f) => {
    try {
      return `${f}:${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
    } catch {
      return `${f}:<missing>`;
    }
  });
  return { work: content.join('\n'), index: git(dir, 'ls-files', '-s').out, cached: git(dir, 'diff', '--cached').out };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('━━━ H. 회귀 테스트 확인(test-verify) — 모델 없는 eval ━━━');

// ── 분류 · 적용 관계(순수 함수) ───────────────────────────────────────────────
{
  const { classify } = await import(path.join(ROOT, 'lib/test-verify/classify.mjs'));
  const k = (p, d = {}, r = null) => classify(p, d, r).kind;
  check(k('src/a.test.ts') === 'test' && k('src/a.spec.tsx') === 'test', 'test-verify 분류: *.test.* · *.spec.* = 실행할 테스트');
  check(k('src/__tests__/price.cjs', {}, 'jest') === 'test' && k('src/__tests__/helper.ts', {}, 'vitest') === 'support',
    'test-verify 분류: __tests__ 아래 코드 파일은 Jest 면 테스트, Vitest 면 지원 파일(러너 기본 수집 규칙)');
  check(k('e2e/login.spec.ts') === 'support' && k('apps/web/playwright/x.spec.ts') === 'support', 'test-verify 분류: E2E 경로의 spec 은 실행할 테스트가 아니다');
  check(k('src/__fixtures__/cart.ts') === 'support' && k('src/__snapshots__/a.test.ts.snap') === 'support' && k('src/setupTests.ts') === 'support',
    'test-verify 분류: 픽스처 · 스냅샷 · 준비 파일 = 지원 파일');
  check(k('package.json') === 'config' && k('pnpm-lock.yaml') === 'config' && k('vite.config.ts') === 'config' && k('tsconfig.app.json') === 'config',
    'test-verify 분류: package.json · 잠금 · *.config.* · tsconfig = 설정(대조에 넣지 않음)');
  check(k('src/price.ts') === 'product' && k('src/a.module.css') === 'product' && k('README.md') === 'unrelated', 'test-verify 분류: 코드 · 스타일 = 제품 소스 · 문서 = 무관');
  check(k('src/checks/price.check.js', { testPaths: ['src/checks/**'] }, 'vitest') === 'test', 'test-verify 분류: 선언 testPaths 로 러너 설정의 수집 규칙을 알려 줄 수 있다');
}

// ── 보고서 해석(실제 러너 보고서 견본) ────────────────────────────────────────
{
  const { normalize } = await import(path.join(ROOT, 'lib/test-verify/run.mjs'));
  const { judgeTarget } = await import(path.join(ROOT, 'lib/test-verify/judge.mjs'));
  const exec = { exitCode: 1, timedOut: false, output: '' };
  const src = fs.readFileSync(path.join(FIX, 'probe.test.js'), 'utf8');
  const ours = normalize('vitest', { outJson: '/nonexistent', ourReport: path.join(FIX, 'vitest-4.1.9-fe-rail.json'), exec, copyRoots: ['/tmp/fx'] });
  const vjson = normalize('vitest', { outJson: path.join(FIX, 'vitest-4.1.9-json.json'), ourReport: '/nonexistent', exec, copyRoots: ['/tmp/fx'] });
  const jjson = normalize('jest', { outJson: path.join(FIX, 'jest-30.2.0-json.json'), ourReport: '/nonexistent', exec, copyRoots: ['/tmp/fx'] });
  const pass = { exitCode: 0, timedOut: false, unattributed: [], files: new Map([['probe.test.js', { state: 'passed', errors: [], cases: (ours.files.get('probe.test.js') || { cases: [] }).cases.map((c) => ({ ...c, state: 'passed', errors: [] })) }]]) };
  const J = (B, name) => judgeTarget({ rel: 'probe.test.js', name, A: pass, B, sourceB: src, kind: 'base', format: 'vitest' }).verdict;
  check(ours.source === 'fe-rail-reporter' && ours.files.size === 3, 'test-verify 보고서: Vitest 4.1.9 — 플러그인 보고기 출력을 읽는다(파일 3개)');
  check(J(ours, '본문 > 본문 단언 실패') === 'detected' && J(ours, '본문 > 헬퍼 단언 실패') === 'detected' && J(ours, '본문 > 확장 단언 실패') === 'detected'
    && J(ours, '본문 > 비동기 단언 실패') === 'detected', 'test-verify 판정(Vitest 실제 보고서): 본문 · 헬퍼 · expect.extend · 비동기 단언 실패 = 검출');
  check(J(ours, '준비 단계 예외 > 대상') === 'unconfirmed' && J(ours, '준비 단계 단언 > 대상') === 'unconfirmed' && J(ours, '본문 > 본문 TypeError') === 'unconfirmed'
    && J(ours, '시간 초과 > 느림') === 'unconfirmed', 'test-verify 판정(Vitest 실제 보고서): beforeEach 예외 · beforeEach 안 단언 · 본문 TypeError · 개별 시간 초과 = 원인 미확인');
  check(J(ours, '동적 > 같은 이름 1') === 'unmeasurable', 'test-verify 판정: 이름이 같은 동적 케이스 둘 = 측정 불가(대상 이름 중복)');
  check((ours.files.get('after.test.js') || {}).errors?.length === 1 && (ours.files.get('load.test.js') || {}).errors?.length === 1,
    'test-verify 보고서: afterAll 실패 · 파일 로딩 실패 = 모듈 수준 오류로 기록');
  check(vjson.source === 'vitest-json' && J(vjson, '본문 > 확장 단언 실패') === 'unconfirmed' && J(vjson, '본문 > 본문 단언 실패') === 'detected',
    'test-verify 보고서: 보고기 없이 Vitest JSON 만 있으면 AssertionError 문자열로만 판정(expect.extend = 원인 미확인)');
  const jpass = { exitCode: 0, timedOut: false, unattributed: [], files: new Map([['probe.test.js', { state: 'passed', errors: [], cases: (jjson.files.get('probe.test.js') || { cases: [] }).cases.map((c) => ({ ...c, state: 'passed', errors: [] })) }]]) };
  const JJ = (name) => judgeTarget({ rel: 'probe.test.js', name, A: jpass, B: jjson, sourceB: src.replace(/^import .*\n/, ''), kind: 'base', format: 'jest' }).verdict;
  check(jjson.source === 'jest-json' && JJ('본문 > 본문 단언 실패') === 'detected' && JJ('본문 > 확장 단언 실패') === 'detected' && JJ('본문 > 헬퍼 단언 실패') === 'detected',
    'test-verify 판정(Jest 30.2.0 실제 보고서): 본문 · expect.extend · 헬퍼 단언 = 검출(matcherResult + 위치)');
  check(JJ('준비 단계 단언 > 대상') === 'unconfirmed' && JJ('준비 단계 예외 > 대상') === 'unconfirmed' && JJ('시간 초과 > 느림') === 'unconfirmed' && JJ('본문 > 본문 TypeError') === 'unconfirmed',
    'test-verify 판정(Jest 실제 보고서): beforeEach 안 단언 · beforeEach 예외 · 시간 초과 · TypeError = 원인 미확인');
  check((jjson.files.get('after.test.js') || {}).errors?.length === 1 && (jjson.files.get('load.test.js') || {}).errors?.length === 1,
    'test-verify 보고서(Jest): «Test suite failed to run»(afterAll · 로딩 실패) = 파일 수준 오류');
}

// ── 실행기 — 작업 트리 · 스테이징 보존, 판정, 기록 ─────────────────────────────
const S = repo('single', {
  'package.json': JSON.stringify({ name: 'single', private: true, devDependencies: { vitest: '4.1.9' } }),
  'src/price.js': 'rate=1.0\n',
  'src/old.js': 'legacy\n',
  'src/price.test.js': '// CASE price > 기존 :: src/price.js :: rate\n',
  'NOTES.md': 'notes\n',
});
{
  write(S, {
    'src/price.js': 'rate=1.1\n',
    'src/fmt.js': 'fmt\n',
    'src/old.js': null,
    'src/price.test.js': '// CASE price > 기존 :: src/price.js :: rate\n// CASE price > 부가세 :: src/price.js :: rate=1.1\n// CASE price > 항상 :: src/price.js :: rate\n// HOOKCASE 준비 > 준비 단계 :: src/price.js :: rate=1.1\n// CASE old > 옛 파일 제거 :: src/old.js :: !EXISTS\n',
    'src/fmt.test.js': '// CASE fmt > 새 모듈 :: src/fmt.js :: fmt\n',
    'src/__fixtures__/a.json': '{}\n',
    'NOTES.md': 'notes 2\n',
  });
  git(S, 'add', 'src/price.js'); // 스테이징된 수정 + 미스테이징 수정 + 미추적 파일이 함께 있는 상태
  const before = snapshotState(S);
  // 이 실행 전용 임시 폴더 — 시스템 임시 폴더를 훑으면 동시에 도는 다른 실행의 격리본이 섞인다
  const VT = path.join(T, 'verify-tmp');
  fs.mkdirSync(VT, { recursive: true });
  const r = verify(S, ['base', '--', 'src/price.test.js', 'src/fmt.test.js'], { TMPDIR: VT });
  const v = verdicts(r.json);
  check(r.code === 0 && v['price > 부가세'] === 'detected', 'test-verify 실행기: 수정 전 소스에서 본문 단언이 뒤집힌 새 케이스 = 검출', r.err || JSON.stringify(v));
  check(v['price > 항상'] === 'undetected', 'test-verify 실행기: 수정 전에도 통과하는 새 케이스 = 미검출');
  check(v['준비 > 준비 단계'] === 'unconfirmed', 'test-verify 실행기: 실패 위치가 케이스 선언 앞 = 원인 미확인');
  check(v['fmt > 새 모듈'] === 'unmeasurable' && /mutate/.test(r.json.targets.find((t) => t.name === 'fmt > 새 모듈')?.reason || ''),
    'test-verify 실행기: 수정이 만든 소스는 대조에서 지워 파일 로딩 실패 = 측정 불가 + 지정 변이 안내');
  check(v['old > 옛 파일 제거'] === 'detected', 'test-verify 실행기: 수정이 지운 소스는 대조에서 되살린다');
  check(!('price > 기존' in v) && r.json.targets.every((t) => t.chosen === 'estimated'), 'test-verify 실행기: --test 를 생략하면 기준에 없던 제목만 «추정» 대상');
  check(r.json.sources.join(',') === 'src/fmt.js,src/old.js,src/price.js', 'test-verify 실행기: 대조 소스 = 제품 소스만(문서 · 지원 파일 · 테스트 제외)', r.json.sources.join(','));
  const after = snapshotState(S);
  check(before.work === after.work && before.index === after.index && before.cached === after.cached,
    'test-verify 실행기: 실행 전후 작업 트리 바이트 · 스테이징(index) 동일 — 스테이징된 수정 · 미추적 파일 포함');
  const left = fs.readdirSync(VT).filter((n) => n.startsWith('fe-rail-'));
  const st = run(S, process.execPath, [BIN, 'verify-test', 'status', '--', 'src/price.test.js']);
  check(st.code === 0 && /충족/.test(st.out), 'test-verify status: 방금 실행한 기록이 현재 상태의 요청을 충족(종료 코드 0)', st.out + st.err);
  const st2 = run(S, process.execPath, [BIN, 'verify-test', 'status', '--expect', 'nothing-like-this', '--json', '--', 'src/price.test.js']);
  let s2 = null;
  try {
    s2 = JSON.parse(st2.out)[0];
  } catch {
    /* */
  }
  check(s2 && s2.summary.detected === 0 && s2.summary.unconfirmed >= 2, 'test-verify status: --expect 가 다르면 저장한 실패 근거로 다시 판정(검출 → 원인 미확인, 재실행 없음)', st2.out);
  write(S, { 'src/__fixtures__/a.json': '{"x":1}\n' });
  const st3 = run(S, process.execPath, [BIN, 'verify-test', 'status', '--', 'src/price.test.js']);
  check(st3.code === 3, 'test-verify status: 지원 파일만 바뀌어도 기록 무효(검증 트리 id) → 미충족(종료 코드 3)', st3.out);
  check(left.length === 0, 'test-verify 실행기: 끝나면 격리본 · 임시 index 를 지운다', left.join(','));
}
{
  // 원본 node_modules 의 캐시 폴더는 격리본에 잇지 않는다 — 링크하면 격리본의 러너가 원본 캐시에 쓴다(Vitest 5 의 .vitest-cache 등)
  write(S, { 'node_modules/.vitest-cache/k': 'x', 'node_modules/.vite/k': 'x', 'node_modules/left-pad/package.json': '{}' });
  const r = verify(S, ['base', '--keep', '--', 'src/price.test.js']);
  const kept = ((r.json?.notes || []).find((n) => n.startsWith('격리본 보존: ')) || '').slice('격리본 보존: '.length);
  const a = path.join(kept, 'a', 'single', 'node_modules');
  const ok = kept && !fs.existsSync(path.join(a, '.vitest-cache')) && !fs.existsSync(path.join(a, '.vite')) && fs.lstatSync(path.join(a, 'left-pad')).isSymbolicLink()
    && !fs.existsSync(path.join(kept, 'b', 'single', 'node_modules', '.vitest-cache'));
  if (kept && path.basename(kept).startsWith('fe-rail-verify-')) fs.rmSync(kept, { recursive: true, force: true });
  check(ok, 'test-verify 격리본: 원본 node_modules 의 캐시 폴더(.vitest-cache · .vite)는 잇지 않고, 패키지 폴더는 원본으로 링크한다', kept || r.err);
}
{
  // 동시 스테이징: 실행 도중 다른 프로세스가 git add 해도 실행기 때문에 달라지는 것이 없다
  write(S, { 'NOTES.md': 'notes 3\n' });
  const child = spawn(process.execPath, [BIN, 'verify-test', 'base', '--json', '--', 'src/price.test.js'], { cwd: S, env: { ...CLEAN_ENV, FAKE_SLEEP_MS: '700' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 350));
  git(S, 'add', 'NOTES.md');
  const staged = git(S, 'show', ':NOTES.md').out;
  await new Promise((r) => child.on('close', r));
  check(staged === 'notes 3\n' && git(S, 'show', ':NOTES.md').out === 'notes 3\n' && fs.readFileSync(path.join(S, 'NOTES.md'), 'utf8') === 'notes 3\n',
    'test-verify 실행기: 실행 도중 다른 프로세스가 스테이징한 내용이 실행 뒤에도 그대로다(작업 트리 · index 에 쓰지 않음)');
}
{
  // 지정 변이
  const before = snapshotState(S);
  const r0 = verify(S, ['mutate', '--file', 'src/price.js', '--find', 'nothing', '--replace', 'x', '--', 'src/price.test.js']);
  const r2 = verify(S, ['mutate', '--file', 'src/price.test.js', '--find', 'CASE', '--replace', 'X', '--', 'src/price.test.js']);
  check(r0.code === 2 && r2.code === 2 && /정확히 한 번/.test(r0.err + r2.err) && snapshotState(S).work === before.work,
    'test-verify mutate: --find 원문이 0번 · 2번 이상이면 거절하고 아무것도 바꾸지 않는다');
  const r1 = verify(S, ['mutate', '--file', 'src/price.js', '--find', 'rate=1.1', '--replace', 'rate=1.2', '--test', 'price > 부가세', '--', 'src/price.test.js']);
  check(r1.code === 0 && verdicts(r1.json)['price > 부가세'] === 'detected' && r1.json.targets.length === 1 && r1.json.targets[0].chosen === 'specified'
    && snapshotState(S).work === before.work, 'test-verify mutate: 격리본에만 적용 · --test 지정 대상만 판정(작업 트리 무변경)', r1.err);
  const r3 = verify(S, ['base', '--only', 'src/price.js', '--', 'src/price.test.js']);
  check(r3.code === 0 && r3.json.scope === 'partial' && r3.json.sources.join() === 'src/price.js', 'test-verify --only: 부분 대조로 기록', r3.err);
}
{
  // 격리본 안의 심볼릭 링크를 따라 격리본 밖에 쓰지 않는다 — 대조로 바꿀 소스가 작업 트리에서 저장소 밖을 가리키는 링크로 바뀐 경우
  const Ln = repo('symlink', {
    'package.json': JSON.stringify({ name: 'symlink', private: true, devDependencies: { vitest: '4.1.9' } }),
    'src/conf.js': 'v1\n',
    'src/conf.test.js': '// CASE c :: src/conf.js :: v1\n',
  });
  const outside = path.join(T, 'outside-target.js');
  fs.writeFileSync(outside, 'OUTSIDE\n');
  fs.rmSync(path.join(Ln, 'src/conf.js'));
  fs.symlinkSync(outside, path.join(Ln, 'src/conf.js'));
  write(Ln, { 'src/conf.test.js': '// CASE c :: src/conf.js :: v1\n// CASE c2 :: src/conf.js :: OUTSIDE\n' });
  const r = verify(Ln, ['base', '--', 'src/conf.test.js']);
  check(fs.readFileSync(outside, 'utf8') === 'OUTSIDE\n' && /심볼릭 링크/.test(r.json?.fatal || ''),
    'test-verify 격리: 대조로 바꿀 소스가 저장소 밖을 가리키는 링크면 쓰지 않고 측정 불가(링크를 따라 원본에 쓰지 않음)', r.err || r.json?.fatal);
  const r2 = verify(Ln, ['mutate', '--file', 'src/conf.js', '--find', 'OUTSIDE', '--replace', 'CHANGED', '--', 'src/conf.test.js']);
  check(fs.readFileSync(outside, 'utf8') === 'OUTSIDE\n' && /심볼릭 링크/.test(r2.json?.fatal || ''),
    'test-verify 격리: 지정 변이 대상이 링크여도 쓰지 않고 측정 불가', r2.err || r2.json?.fatal);
}
{
  // 파일 수준 오류 · 원인 모를 종료 · 종료 코드 방식
  const F = repo('fileerr', {
    'package.json': JSON.stringify({ name: 'fileerr', private: true, devDependencies: { vitest: '4.1.9' } }),
    'src/r.js': 'ready\n',
    'src/r.test.js': '// CASE 기존 :: src/r.js :: ready\n',
  });
  write(F, { 'src/r.js': 'ready extra\n', 'src/r.test.js': '// FILEERROR src/r.js :: extra\n// CASE 기존 :: src/r.js :: ready\n// CASE 새 케이스 :: src/r.js :: ready\n' });
  const r = verify(F, ['base', '--', 'src/r.test.js']);
  check(verdicts(r.json)['새 케이스'] === 'unmeasurable' && /파일 수준 오류/.test(r.json.targets[0].reason), 'test-verify 판정: 대조에서 케이스는 통과로 보고돼도 파일이 정리 단계 실패로 깨졌으면 측정 불가', r.err || JSON.stringify(r.json?.targets));
  write(F, { 'src/r.test.js': '// CASE 기존 :: src/r.js :: ready\n// CASE 새 케이스 :: src/r.js :: ready\n' });
  const r2 = verify(F, ['base', '--', 'src/r.test.js'], { FAKE_EXIT: '1' });
  check(verdicts(r2.json)['새 케이스'] === 'unmeasurable' && /종료 코드|오류/.test(r2.json.targets[0].reason), 'test-verify 판정: 실패 케이스 없이 러너가 비정상 종료하면 측정 불가', JSON.stringify(r2.json?.targets));
  const r3 = verify(F, ['base', '--cmd', 'grep -q extra src/r.js', '--', 'src/r.test.js']);
  check(r3.code === 0 && verdicts(r3.json)['(파일 전체 · 종료 코드)'] === 'unconfirmed', 'test-verify 종료 코드 방식: 현재 0 · 대조 1 = «결과 차이 있음 · 원인 미확인»(검출로 세지 않음)', r3.err || JSON.stringify(r3.json?.targets));
}

// ── 워크스페이스 — 적용 관계 · 격리 자기 점검 · 빌드 결과물 ─────────────────────
const W = repo('ws', {
  'package.json': JSON.stringify({ name: 'ws', private: true, workspaces: ['packages/*', 'apps/*'], devDependencies: { vitest: '4.1.9' } }),
  'packages/ui/package.json': JSON.stringify({ name: '@s/ui', version: '1.0.0', exports: { '.': './src/index.js' } }),
  'packages/ui/src/index.js': 'ui v1\n',
  'packages/kit/package.json': JSON.stringify({ name: '@s/kit', version: '1.0.0', exports: { '.': './dist/index.js' } }),
  'packages/kit/src/index.js': 'kit v1\n',
  'apps/web/package.json': JSON.stringify({ name: 'web', version: '1.0.0', dependencies: { '@s/ui': '*', '@s/kit': '*' } }),
  'apps/web/src/a.test.js': '// CASE 기존 :: ../../packages/ui/src/index.js :: ui\n',
  'apps/admin/package.json': JSON.stringify({ name: 'admin', version: '1.0.0' }),
  'apps/admin/src/x.js': 'x v1\n',
});
fs.mkdirSync(path.join(W, 'node_modules/@s'), { recursive: true });
fs.symlinkSync('../../packages/ui', path.join(W, 'node_modules/@s/ui'));
fs.symlinkSync('../../packages/kit', path.join(W, 'node_modules/@s/kit'));
{
  write(W, { 'packages/ui/src/index.js': 'ui v2\n', 'apps/web/src/a.test.js': '// CASE 기존 :: ../../packages/ui/src/index.js :: ui\n// CASE ui v2 :: ../../packages/ui/src/index.js :: ui v2\n' });
  const r = verify(W, ['base', '--', 'apps/web/src/a.test.js']);
  check(verdicts(r.json)['ui v2'] === 'detected' && r.json.sources.join() === 'packages/ui/src/index.js', 'test-verify 워크스페이스: 의존하는 패키지(@scope 묶음 아래 · 소스 내보냄)의 수정을 대조한다', r.err || JSON.stringify(r.json));
  fs.rmSync(path.join(W, 'node_modules/@s/ui'));
  fs.symlinkSync(path.join(W, 'packages/ui'), path.join(W, 'node_modules/@s/ui')); // 원본을 가리키는 절대 링크
  const leak = verify(W, ['base', '--', 'apps/web/src/a.test.js']);
  check(leak.json && /격리 불가/.test(leak.json.fatal || ''), 'test-verify 격리 자기 점검: 워크스페이스 패키지가 원본 소스로 풀리면 측정 불가(격리 불가)', leak.err || leak.json?.fatal);
  fs.rmSync(path.join(W, 'node_modules/@s/ui'));
  fs.symlinkSync('../../packages/ui', path.join(W, 'node_modules/@s/ui'));
  git(W, 'checkout', '-q', '--', 'packages/ui/src/index.js', 'apps/web/src/a.test.js');
}
{
  write(W, { 'apps/admin/src/x.js': 'x v2\n', 'apps/web/src/a.test.js': '// CASE 기존 :: ../../packages/ui/src/index.js :: ui\n// CASE 새 :: ../../packages/ui/src/index.js :: ui\n' });
  const r = verify(W, ['base', '--', 'apps/web/src/a.test.js']);
  check(r.json && /대조할 제품 소스 차이 없음/.test(r.json.fatal || ''), 'test-verify 적용 관계: 다른 앱의 소스만 바뀌면 이 앱의 테스트로 대조하지 않는다', r.err || r.json?.fatal);
  git(W, 'checkout', '-q', '--', 'apps/admin/src/x.js', 'apps/web/src/a.test.js');
}
{
  write(W, { 'packages/kit/src/index.js': 'kit v2\n', 'apps/web/src/a.test.js': '// CASE 기존 :: ../../packages/ui/src/index.js :: ui\n// CASE kit v2 :: ../../packages/kit/dist/index.js :: kit v2\n' });
  const r = verify(W, ['base', '--', 'apps/web/src/a.test.js']);
  check(r.json && /빌드 결과물/.test(r.json.fatal || ''), 'test-verify 빌드 결과물: 진입 파일이 작업 트리 파일 목록에 없는(dist) 패키지를 고쳤는데 준비 명령이 없으면 측정 불가', r.err || r.json?.fatal);
  const pkg = JSON.parse(fs.readFileSync(path.join(W, 'package.json'), 'utf8'));
  pkg['fe-rail'] = { testVerify: { prepare: 'mkdir -p packages/kit/dist && cp packages/kit/src/index.js packages/kit/dist/index.js' } };
  write(W, { 'package.json': JSON.stringify(pkg) });
  const r2 = verify(W, ['base', '--', 'apps/web/src/a.test.js']);
  check(verdicts(r2.json)['kit v2'] === 'detected' && r2.json.configChanged.includes('package.json'),
    'test-verify 빌드 결과물: 준비 명령을 선언하면 양쪽 격리본에서 각각 빌드해 대조(설정 변경은 «대조에 넣지 않음» 으로 기록)', r2.err || JSON.stringify(r2.json?.targets || r2.json?.fatal));
  git(W, 'checkout', '-q', '--', 'packages/kit/src/index.js', 'apps/web/src/a.test.js', 'package.json');
}
{
  const r = verify(W, ['base', '--', 'apps/web/src/a.test.js', 'apps/admin/package.json']);
  check(r.code === 2 && /여러 패키지/.test(r.err), 'test-verify 실행기: 테스트 파일이 여러 패키지에 걸치면 사용법 오류(패키지마다 따로)');
}

// ── 훅 — 이번 턴 판정 · 막기 · 침묵 ──────────────────────────────────────────
const Hk = repo('hook', {
  'package.json': JSON.stringify({ name: 'hook', private: true, devDependencies: { vitest: '4.1.9' } }),
  'src/price.js': 'rate=1.0\n',
  'src/price.test.js': '// CASE 기존 :: src/price.js :: rate\n',
  'src/b.test.js': '// CASE b :: src/price.js :: rate\n',
  'NOTES.md': 'n\n',
});
{
  const sid = 'eval-1';
  hook(Hk, 'turn-start', sid);
  write(Hk, { 'NOTES.md': 'n2\n' });
  check(!blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 문서만 바꾼 턴 → 침묵');
  hook(Hk, 'turn-start', sid);
  write(Hk, { 'src/price.js': 'rate=1.1\n' });
  const nosrc = hook(Hk, 'stop', sid);
  check(blocked(nosrc) && /제품 코드 1개/.test(nosrc.out) && !/단위 테스트 \d+개를 수정 전/.test(nosrc.out),
    'test-verify 훅: 소스만 바꾸고 테스트를 안 바꾼 턴 → 막음(제품 코드 갈래만 · 바뀐 테스트 갈래는 없음)', nosrc.out + nosrc.err);
  hook(Hk, 'turn-start', sid); // 앞 턴의 소스 수정이 미커밋으로 남은 채 새 턴
  write(Hk, { 'src/price.test.js': '// CASE 기존 :: src/price.js :: rate\n// CASE 부가세 :: src/price.js :: rate=1.1\n' });
  const b1 = hook(Hk, 'stop', sid);
  check(blocked(b1) && /verify-test base --base [0-9a-f]{12} -- src\/price\.test\.js/.test(b1.out), 'test-verify 훅: 앞 턴의 미커밋 소스 + 이번 턴 테스트 → 막고 실행기 명령(--base 턴 시작 HEAD)을 지시', b1.out + b1.err);
  check(!blocked(hook(Hk, 'stop', sid, { active: true })), 'test-verify 훅: 이미 한 번 막은 뒤의 재종료(stop_hook_active) → 막지 않음');
  const head = git(Hk, 'rev-parse', 'HEAD').out.trim();
  verify(Hk, ['base', '--base', head, '--', 'src/price.test.js']);
  check(!blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 요청을 충족하는 기록이 생기면 → 침묵(판정 결과는 묻지 않음)');
  write(Hk, { 'src/price.test.js': '// CASE 기존 :: src/price.js :: rate\n// CASE 부가세 :: src/price.js :: rate=1.1\n// CASE 또 :: src/price.js :: rate=1.1\n' });
  check(blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 기록 뒤 테스트를 다시 고치면 → 다시 막음(기록 무효)');
  verify(Hk, ['base', '--base', head, '--test', '또', '--', 'src/price.test.js']);
  check(blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 새 케이스 중 일부만 확인한 기록은 다른 새 케이스까지 덮지 않는다 → 막음');
  check(!blocked(hook(Hk, 'stop', sid, { env: { FE_RAIL_DISABLED_HOOKS: 'test-verify' }, wrapper: true })), 'test-verify 훅: FE_RAIL_DISABLED_HOOKS=test-verify 면 침묵(래퍼 · 프로파일 배선)');
  check(!blocked(hook(Hk, 'stop', sid, { env: { FE_RAIL_HOOK_PROFILE: 'minimal' }, wrapper: true })), 'test-verify 훅: minimal 프로파일이면 침묵');
  check(blocked(hook(Hk, 'stop', sid, { wrapper: true })), 'test-verify 훅: hooks/test-verify-stop.sh 래퍼로 불러도 같은 판정(막음)');
  const many = hook(Hk, 'stop', sid, { env: { FE_RAIL_VERIFY_MAX_TESTS: '0' } });
  check(!blocked(many) && /상한/.test(many.err), 'test-verify 훅: 바뀐 테스트가 상한을 넘으면 막지 않고 알림만', many.err);
  commit(Hk, 'fix + test');
  hook(Hk, 'turn-start', sid);
  write(Hk, { 'src/b.test.js': '// CASE b :: src/price.js :: rate\n// CASE b2 :: src/price.js :: rate=1.1\n' });
  check(!blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 수정을 앞 턴에 커밋하고 이번 턴에 테스트만 → 침묵(턴 시작 HEAD 대비 소스 차이 없음)');
  hook(Hk, 'turn-start', sid);
  write(Hk, { 'src/price.js': 'rate=1.3\n', 'src/b.test.js': '// CASE b :: src/price.js :: rate\n// CASE b3 :: src/price.js :: rate=1.3\n' });
  commit(Hk, 'in-turn commit');
  check(blocked(hook(Hk, 'stop', sid)), 'test-verify 훅: 턴 안에서 소스 · 테스트를 커밋해도 → 막음(턴 안의 커밋은 이번 턴 변경)');
}
{
  const U = repo('unknown', { 'package.json': JSON.stringify({ name: 'u', private: true }), 'src/a.js': 'a\n', 'src/a.test.js': '// CASE a :: src/a.js :: a\n' }, { vitest: null });
  hook(U, 'turn-start', 's');
  write(U, { 'src/a.js': 'a2\n', 'src/a.test.js': '// CASE a :: src/a.js :: a\n// CASE a2 :: src/a.js :: a2\n' });
  check(!blocked(hook(U, 'stop', 's')), 'test-verify 훅: 러너를 알 수 없으면 → 침묵');
  const V3 = repo('vitest3', { 'package.json': JSON.stringify({ name: 'v3', private: true, devDependencies: { vitest: '3.2.0' } }), 'src/a.js': 'a\n', 'src/a.test.js': '// CASE a :: src/a.js :: a\n' }, { vitest: '3.2.0' });
  hook(V3, 'turn-start', 's');
  write(V3, { 'src/a.js': 'a2\n', 'src/a.test.js': '// CASE a :: src/a.js :: a\n// CASE a2 :: src/a.js :: a2\n' });
  const n = hook(V3, 'stop', 's');
  check(!blocked(n) && /검증된 조합이 아니라/.test(n.err), 'test-verify 훅: 검증되지 않은 조합(Vitest 3) → 막지 않고 알림만', n.err);
  const NG = path.join(T, 'nogit');
  fs.mkdirSync(NG);
  check(!blocked(hook(NG, 'stop', 's')) && hook(NG, 'stop', 's').code === 0, 'test-verify 훅: git 저장소가 아니면 → 침묵 · exit 0');
  hook(W, 'turn-start', 'w');
  write(W, { 'apps/admin/src/x.js': 'x v3\n', 'apps/web/src/a.test.js': '// CASE 기존 :: ../../packages/ui/src/index.js :: ui\n// CASE 새2 :: ../../packages/ui/src/index.js :: ui\n' });
  const wr = hook(W, 'stop', 'w');
  check(blocked(wr) && /apps\/admin\/src\/x\.js/.test(wr.out) && !/verify-test base --base [0-9a-f]{12} -- apps\/web/.test(wr.out),
    'test-verify 훅: 다른 앱의 소스 + 이 앱의 테스트 → 이 앱의 테스트는 요구하지 않고(적용 관계 없음) 다른 앱의 제품 코드만 막음', wr.out + wr.err);
}

// ── 제품 코드 갈래 — 테스트를 안 고친 턴 · 파일 단위 덮임 · 생략 줄 · report (v1.22.0) ─────────
const P = repo('product', {
  'package.json': JSON.stringify({ name: 'product', private: true, devDependencies: { vitest: '4.1.9' } }),
  'src/guard.js': 'guard=on\n',
  'src/price.js': 'rate=1.0\n',
  'src/types.d.ts': 'export type A = 1\n',
  'src/app.css': '.a{}\n',
  'src/data.json': '{}\n',
  // 기존 테스트 — 이 시나리오 내내 고치지 않는다
  'src/submit.test.js': "// import { guard } from './guard.js'\n// CASE submit > 한 번만 :: src/guard.js :: guard=on\n// CASE submit > 엄격 :: src/guard.js :: strict\n",
  'src/price.test.js': '// CASE price > 세율 :: src/price.js :: rate\n',
  'README.md': 'r\n',
});
{
  const sid = 'eval-prod';
  const SENV = { CLAUDE_CODE_SESSION_ID: sid };
  const report = () => run(P, process.execPath, [BIN, 'verify-test', 'report'], { env: SENV });
  hook(P, 'turn-start', sid);
  write(P, { 'src/app.css': '.a{color:red}\n', 'src/data.json': '{"a":1}\n', 'src/types.d.ts': 'export type A = 2\n', 'README.md': 'r2\n' });
  check(!blocked(hook(P, 'stop', sid)), 'test-verify 훅(제품 코드): 스타일 · 데이터 · 타입 선언(*.d.ts) · 문서만 바뀐 턴 → 침묵');
  commit(P, 'non-code');
  const head = git(P, 'rev-parse', 'HEAD').out.trim(); // 다음 턴의 턴 시작 HEAD

  hook(P, 'turn-start', sid);
  write(P, { 'src/guard.js': 'guard=on strict\n', 'src/price.js': 'rate=1.1\n' });
  const b = hook(P, 'stop', sid);
  check(blocked(b) && /제품 코드 2개/.test(b.out) && /src\/guard\.js {2}\(후보 테스트: src\/submit\.test\.js\)/.test(b.out) && /src\/price\.js {2}\(후보 테스트: src\/price\.test\.js\)/.test(b.out),
    'test-verify 훅(제품 코드): 제품 코드만 고치고 테스트는 안 고친 턴 → 막고 파일마다 후보 테스트(같은 이름 · 가져오는 테스트)를 보여 준다', b.out + b.err);
  check(/verify-test base --base [0-9a-f]{12} --only <소스> --test/.test(b.out) && /verify-test mutate --file <소스>/.test(b.out) && /verify-test report/.test(b.out) && /--intent/.test(b.out) && /테스트 확인: 생략 — <이유>/.test(b.out),
    'test-verify 훅(제품 코드): 차단 사유가 절차(기대 동작 → base · mutate → report)와 생략 줄 형식을 지시한다');
  check(!blocked(hook(P, 'stop', sid, { active: true })), 'test-verify 훅(제품 코드): 두 번째 종료(stop_hook_active)는 막지 않는다');
  check(!blocked(hook(P, 'stop', sid, { msg: '정리했습니다.\n\n테스트 확인: 생략 — 작업이 끝나지 않음(다음 턴에 이어서)' })),
    'test-verify 훅: 마지막 답변에 «테스트 확인: 생략 — <이유>» 가 있으면 첫 종료도 막지 않는다(last_assistant_message)');
  check(!blocked(hook(P, 'stop', sid, { msg: '- **테스트 확인**: 생략 — 문구만 바꿈', wrapper: true })),
    'test-verify 훅: 생략 줄은 목록 · 굵게 표기여도 인정한다(래퍼 경유)');
  check(blocked(hook(P, 'stop', sid, { msg: '테스트 확인: 생략 —   ' })) && blocked(hook(P, 'stop', sid, { msg: '테스트 확인은 생략 — 나중에' })),
    'test-verify 훅: 이유가 빈 생략 줄 · 형식이 다른 문장은 인정하지 않는다');

  const nr = report();
  check(nr.code === 3 && /- src\/guard\.js: 미실행/.test(nr.out) && /- src\/price\.js: 미실행/.test(nr.out) && /실행 0 · 미실행 2/.test(nr.out),
    'test-verify report: 기록이 없으면 파일마다 «미실행» · 종료 코드 3', nr.out + nr.err);

  const none = verify(P, ['base', '--base', head, '--', 'src/price.test.js']);
  check(none.json?.fatalCode === 'no-target' && blocked(hook(P, 'stop', sid)) && /제품 코드 2개/.test(hook(P, 'stop', sid).out),
    'test-verify 덮임: 손대지 않은 테스트로 --test 없이 돌려 «대상 케이스 없음» 이면 아무것도 덮지 않는다', none.err || none.json?.fatal);

  const m = verify(P, ['mutate', '--file', 'src/guard.js', '--find', 'guard=on', '--replace', 'guard=off', '--test', 'submit > 한 번만', '--intent', '중복 제출 가드 제거', '--', 'src/submit.test.js']);
  check(verdicts(m.json)['submit > 한 번만'] === 'detected' && m.json.intent === '중복 제출 가드 제거', 'test-verify mutate: 손대지 않은 기존 테스트 + --test 로 검출 · --intent 를 기록에 남긴다', m.err || JSON.stringify(m.json?.targets));
  const m2 = verify(P, ['mutate', '--file', 'src/guard.js', '--find', 'strict', '--replace', 'loose', '--test', 'submit > 엄격', '--intent', '가격 세율 변경 확인', '--', 'src/submit.test.js']);
  const b2 = hook(P, 'stop', sid);
  check(verdicts(m2.json)['submit > 엄격'] === 'detected' && blocked(b2) && /제품 코드 1개/.test(b2.out) && /- src\/price\.js/.test(b2.out) && !/- src\/guard\.js/.test(b2.out),
    'test-verify 덮임: guard.js 만 변이한 기록은 같은 턴의 price.js 를 덮지 않는다(--intent 문구가 가격을 말해도 판정에 쓰지 않음)', b2.out + b2.err);

  const pb = verify(P, ['base', '--base', head, '--only', 'src/price.js', '--test', 'price > 세율', '--', 'src/price.test.js']);
  check(pb.json?.scope === 'partial' && verdicts(pb.json)['price > 세율'] === 'undetected' && !blocked(hook(P, 'stop', sid)),
    'test-verify 덮임: --only 로 좁힌 부분 대조도 그 파일은 덮는다 · 판정이 미검출이어도 «실행함»(훅 침묵)', pb.err || JSON.stringify(pb.json?.targets));
  const r1 = report();
  check(r1.code === 0 && /- src\/guard\.js: 중복 제출 가드 제거 → src\/submit\.test\.js › submit > 한 번만 → expected source to contain guard=on \(src\/submit\.test\.js:2:20\) → 검출 \[지정 변이\]/.test(r1.out),
    'test-verify report: «깨뜨린 동작 → 케이스 → 실제 관측값 → 판정» 한 줄(검출)', r1.out + r1.err);
  check(/- src\/price\.js: 수정 전 내용으로 되돌림\(기준 [0-9a-f]{9}\) → src\/price\.test\.js › price > 세율 → 대조에서도 통과 → 미검출 \[수정 전 대조 · 부분\]/.test(r1.out) && /실행 2 · 미실행 0 — 검출 2 · 미검출 1/.test(r1.out) && /해석: /.test(r1.out),
    'test-verify report: 미검출은 케이스와 함께 «미검출» 로(미실행과 구분) · 집계 · 해석 문서', r1.out);

  write(P, { 'src/guard.js': 'guard=on strict v2\n' });
  const b3 = hook(P, 'stop', sid);
  check(blocked(b3) && /제품 코드 2개/.test(b3.out), 'test-verify 덮임: 실행 뒤 소스를 다시 고치면 모든 기록이 무효(현재 트리 기준) → 다시 막음', b3.out);
  const mix = verify(P, ['base', '--base', head, '--test', 'submit > 엄격', '--intent', '엄격 모드 추가 되돌림', '--', 'src/submit.test.js']);
  const r2 = report();
  check(verdicts(mix.json)['submit > 엄격'] === 'detected' && mix.json.sources.join() === 'src/guard.js,src/price.js' && !blocked(hook(P, 'stop', sid))
    && /- src\/price\.js: 엄격 모드 추가 되돌림 → src\/submit\.test\.js › submit > 엄격 → .* → 검출 \[수정 전 대조 · 함께 되돌린 소스 2개 — 어느 수정이 이 결과를 냈는지는 이 기록으로 가를 수 없음\]/.test(r2.out),
  'test-verify report: 소스 여러 개를 함께 되돌린 base 의 검출은 어느 수정 탓인지 단정하지 않는다(두 파일 모두 «실행함»)', r2.out + mix.err);
  check(/소스 2개를 함께 되돌렸다/.test(run(P, process.execPath, [BIN, 'verify-test', 'base', '--base', head, '--test', 'submit > 엄격', '--', 'src/submit.test.js']).out),
    'test-verify 출력: 소스 여러 개를 함께 되돌린 base 는 사람이 읽는 출력에도 귀속 한계를 적는다');
  commit(P, 'guard + price');

  hook(P, 'turn-start', sid);
  write(P, { 'src/price.js': 'rate=1.2\n' });
  commit(P, 'in-turn');
  check(blocked(hook(P, 'stop', sid)), 'test-verify 훅(제품 코드): 턴 안에서 커밋한 제품 코드 변경도 이번 턴 변경 → 막음');
  hook(P, 'turn-start', sid);
  check(!blocked(hook(P, 'stop', sid)), 'test-verify 훅(제품 코드): 앞 턴의 변경만 남은 새 턴(이번 턴 변경 없음) → 침묵');

  const V3p = repo('product-v3', { 'package.json': JSON.stringify({ name: 'v3p', private: true, devDependencies: { vitest: '3.2.0' } }), 'src/a.js': 'a\n', 'src/a.test.js': '// CASE a :: src/a.js :: a\n' }, { vitest: '3.2.0' });
  hook(V3p, 'turn-start', 's');
  write(V3p, { 'src/a.js': 'a2\n' });
  const n3 = hook(V3p, 'stop', 's');
  check(!blocked(n3) && /검증된 조합이 아니라/.test(n3.err) && n3.err.split('\n').filter(Boolean).length === 1, 'test-verify 훅(제품 코드): 검증되지 않은 조합 → 막지 않고 알림만(패키지당 한 번)', n3.err);
  const Up = repo('product-unknown', { 'package.json': JSON.stringify({ name: 'up', private: true }), 'src/a.js': 'a\n' }, { vitest: null });
  hook(Up, 'turn-start', 's');
  write(Up, { 'src/a.js': 'a2\n' });
  const nu = hook(Up, 'stop', 's');
  check(!blocked(nu) && !nu.err.trim(), 'test-verify 훅(제품 코드): 러너를 알 수 없는 프로젝트 → 침묵');
}

{
  const { entryLine } = await import(path.join(ROOT, 'lib/test-verify/coverage.mjs'));
  const rec = { kind: 'mutate', intent: '가드 제거', mutation: { file: 'src/a.js', find: 'x', replace: 'y' } };
  const tg = { file: 'src/a.test.js', name: 'a > 한 번', verdict: 'detected', failure: { message: 'expected [ …(2) ] to have a length of 1 but got 2', at: 'src/a.test.js:9:3' },
    raw: { err: { message: 'expected [ …(2) ] to have a length of 1 but got 2\n\nIgnored nodes: comments, script, style\n<html>\n  <body>\n    <div>긴 DOM</div>' } } };
  const line = entryLine('src/a.js', { rec, target: tg });
  check(line === '- src/a.js: 가드 제거 → src/a.test.js › a > 한 번 → expected [ …(2) ] to have a length of 1 but got 2 (src/a.test.js:9:3) → 검출 [지정 변이]',
    'test-verify report: 관측값에서 Testing Library 의 DOM 덤프(Ignored nodes · <html>…)를 걷어 낸다', line);
}

// ── 정리 · 자체 점검 ──────────────────────────────────────────────────────────
{
  const { cleanupStale, PREFIX } = await import(path.join(ROOT, 'lib/test-verify/isolate.mjs'));
  // 이 실행 전용 임시 폴더에서 — 시스템 임시 폴더의 고정 이름은 동시에 도는 다른 실행과 부딪힌다(EEXIST)
  const base = path.join(T, 'stale-tmp');
  fs.mkdirSync(base, { recursive: true });
  const prevTmp = process.env.TMPDIR;
  process.env.TMPDIR = base;
  const old = path.join(base, `${PREFIX}evalold`);
  fs.mkdirSync(path.join(old, 'a'), { recursive: true });
  const real = path.join(T, 'keep-me');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'f'), 'x');
  fs.symlinkSync(real, path.join(old, 'a', 'link')); // 원본을 가리키는 링크 — 지울 때 따라가면 안 된다
  const t = new Date(Date.now() - 8 * 3600 * 1000);
  fs.utimesSync(old, t, t);
  try {
    cleanupStale();
  } finally {
    if (prevTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prevTmp;
  }
  check(!fs.existsSync(old) && fs.existsSync(path.join(real, 'f')), 'test-verify 정리: 6시간 지난 격리본은 지우고, 안의 링크가 가리키는 원본은 남긴다');
}
{
  const { VERIFIED } = await import(path.join(ROOT, 'lib/test-verify/project.mjs'));
  const doc = fs.readFileSync(path.join(ROOT, 'docs/test-verify.md'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'eval/runner.mjs'), 'utf8');
  check(VERIFIED.every((v) => doc.includes(v.pinned) && doc.includes(`${v.runner === 'vitest' ? 'Vitest' : 'Jest'} ${v.major}`)) && /VERIFIED/.test(runner),
    'test-verify 자체 점검: 검증된 조합(VERIFIED)이 docs/test-verify.md 지원 표에 있고, eval/runner.mjs 가 그 목록으로 돈다');
  const files = ['bin/fe-rail', 'bin/fe-rail.mjs', 'docs/test-verify.md', 'hooks/test-verify-turn.sh', 'hooks/test-verify-stop.sh', ...fs.readdirSync(path.join(ROOT, 'lib/test-verify')).map((n) => `lib/test-verify/${n}`)];
  // 고정 패턴은 개인 경로뿐이다. 특정 소비 프로젝트 · 조직 이름은 이 공개 코드에 적지 않고 FE_RAIL_EVAL_FORBIDDEN(쉼표 구분)으로 받는다.
  const words = (process.env.FE_RAIL_EVAL_FORBIDDEN || '').split(',').map((w) => w.trim()).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const forbid = new RegExp([String.raw`(?:^|[\s'"(])/(?:Users|home)/[A-Za-z0-9._-]+/`, ...words.map((w) => (/^\w+$/.test(w) ? `\\b${w}\\b` : w))].join('|'), 'i');
  const hit = files.filter((f) => forbid.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  check(!hit.length, `test-verify 자체 점검: 기능 파일에 개인 경로${words.length ? ` · 지정 금지어 ${words.length}개` : ''}가 없다(범용성)`, hit.join(', '));
  const ta = fs.readFileSync(path.join(ROOT, 'agents/fe-test-author.md'), 'utf8');
  const rv = fs.readFileSync(path.join(ROOT, 'agents/fe-reviewer.md'), 'utf8');
  const fs_ = fs.readFileSync(path.join(ROOT, 'skills/fe-start/SKILL.md'), 'utf8');
  check(/`regression`/.test(ta) && /verify-test/.test(ta) && /테스트 판별력/.test(rv) && /verify-test status/.test(fs_) && /test-verify/.test(fs_),
    'test-verify 자체 점검: fe-test-author regression 모드 · fe-reviewer 판별력 축 · fe-start(status · kind test-verify) 배선');
  const si = fs.readFileSync(path.join(ROOT, 'hooks/session-init.sh'), 'utf8');
  const hk = fs.readFileSync(path.join(ROOT, 'lib/test-verify/hook.mjs'), 'utf8');
  check(/### 6\.1 /.test(doc) && /## 10\. /.test(doc) && /verify-test report/.test(doc) && /verify-test report/.test(fs_) && /verify-test report/.test(rv) && /verify-test report/.test(si) && /§10/.test(hk),
    'test-verify 자체 점검(v1.22.0): 덮임 정의(§6.1) · 변이 고르기(§10) 문서 · fe-start · fe-reviewer · session-init 의 report 배선 · 훅 메시지의 §10 참조');
}

console.log(`TV_RESULT ${PASS} ${FAIL}`);
process.exitCode = FAIL ? 1 : 0;
