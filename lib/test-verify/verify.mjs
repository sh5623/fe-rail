// [fe-rail] test-verify — 실행 흐름(base · mutate · status). 설계: docs/test-verify.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, toPosix } from './classify.mjs';
import { blobAt, changedSince, listWorkFiles, modeAt, revParse, toplevel, treeId } from './git.mjs';
import {
  IsolationError, LimitError, attachNodeModules, buildOutputEntries, cleanupStale, cloneTree, copyExtra, copyWorkTree,
  extrasFingerprint, makeWorkDir, removeWorkDir, resolutionLeaks, safeTarget,
} from './isolate.mjs';
import { estimateNew, judgeTarget, matchCases, othersFlipped, summarize } from './judge.mjs';
import { dependencyClosure, detectRunner, isVerified, nearestPackageDir, ownerPackage, projectInfo, readDeclaration, readJson, workspacePackages } from './project.mjs';
import { RECORD_VERSION, saveRecord, satisfaction } from './record.mjs';
import { readTurn } from './turn.mjs';
import { buildCommand, commandSignature, execute, normalize } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(HERE, '..', '..');
export const DOC = path.join(PLUGIN_ROOT, 'docs', 'test-verify.md');
export const PLUGIN_VERSION = (readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')) || {}).version || '?';

const TIMEOUT = () => (Number(process.env.FE_RAIL_VERIFY_TIMEOUT) || 120) * 1000;
const MAX_SOURCES = () => Number(process.env.FE_RAIL_VERIFY_MAX_SOURCES) || 50;
const short = (sha) => (sha ? sha.slice(0, 9) : '-');

export class UsageError extends Error {}

// 테스트 패키지 하나의 맥락: 프로젝트 · 선언 · 러너 · 워크스페이스 의존 묶음.
export function packageContext(root, pkgDir, { cmd, format } = {}) {
  const project = projectInfo(pkgDir, root);
  const decl = readDeclaration([pkgDir, project.root, root]);
  const runnerInfo = cmd
    ? { kind: 'declared', runner: ['vitest', 'jest'].includes(format) ? format : null, format: ['vitest', 'jest'].includes(format) ? format : 'exit-code', command: cmd, version: null, viaFlag: true }
    : detectRunner(pkgDir, project, root, decl);
  let packages = workspacePackages(project);
  if (!packages.some((p) => p.dir === pkgDir)) packages = [...packages, { name: (readJson(path.join(pkgDir, 'package.json')) || {}).name || path.relative(root, pkgDir), dir: pkgDir, pkg: readJson(path.join(pkgDir, 'package.json')) || {}, isRoot: false }];
  const closure = dependencyClosure(packages, pkgDir);
  const declBase = decl._from ? path.dirname(decl._from) : pkgDir;
  return { pkgDir, project, decl, runnerInfo, packages, closure, declBase, runDir: runnerDir(pkgDir, project.root, runnerInfo) };
}

// 러너를 돌릴 폴더 — 테스트 패키지에서 프로젝트 루트까지 올라가며 러너 설정이 처음 보이는 곳(없으면 패키지 폴더).
// 설정이 루트에만 있는 워크스페이스에서 패키지 폴더로 돌리면 러너가 설정을 못 찾는다(Vitest 는 위로 찾지 않는다).
// 선언 command 는 패키지 폴더에서 돈다.
function runnerDir(pkgDir, top, runnerInfo) {
  if (runnerInfo.kind !== 'auto') return pkgDir;
  const re = runnerInfo.runner === 'vitest' ? /^(vitest|vite)\.config\.[cm]?[jt]s$/ : /^jest\.config\.[cm]?[jt]s(on)?$/;
  let d = pkgDir;
  while (true) {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      /* 무시 */
    }
    if (names.some((n) => re.test(n))) return d;
    if (runnerInfo.runner === 'jest' && (readJson(path.join(d, 'package.json')) || {}).jest) return d;
    if (d === top || d === path.dirname(d)) return pkgDir;
    d = path.dirname(d);
  }
}

// 기준 리비전 이후 바뀐 «제품 소스» 중 이 테스트 패키지와 적용 관계가 있는 것(패키지 자신 + 의존하는 워크스페이스 패키지).
export function applicableProducts(root, ctx, changes) {
  const dirs = new Set(ctx.closure.map((p) => p.dir));
  const products = [];
  const config = [];
  for (const ch of changes) {
    const c = classify(ch.file, ctx.decl, ctx.runnerInfo.runner);
    const abs = path.join(root, ch.file);
    const owner = ownerPackage(ctx.packages, abs);
    if (!owner) continue;
    if (c.kind === 'config' && (dirs.has(owner.dir) || owner.isRoot)) config.push(ch.file); // 루트 설정은 모든 패키지에 닿는다
    else if (c.kind === 'product' && dirs.has(owner.dir)) products.push(ch);
  }
  return { products, config };
}

export function defaultBase(root, explicit, sessionId) {
  if (explicit) {
    const r = revParse(root, explicit);
    if (!r) throw new UsageError(`기준 리비전을 찾지 못함: ${explicit}`);
    return { sha: r, from: '--base' };
  }
  const turn = sessionId ? readTurn(root, sessionId) : null;
  if (turn && turn.head) return { sha: turn.head, from: '턴 시작 HEAD' };
  const head = revParse(root, 'HEAD');
  if (!head) throw new UsageError('HEAD 가 없음(커밋이 하나도 없는 저장소)');
  return { sha: head, from: 'HEAD' };
}

function resolveTests(root, cwd, files, { mustExist = true } = {}) {
  const rels = [];
  for (const f of files) {
    const abs = path.resolve(cwd, f);
    if (!abs.startsWith(root + path.sep)) throw new UsageError(`저장소 밖의 파일: ${f}`);
    if (mustExist && !fs.existsSync(abs)) throw new UsageError(`테스트 파일이 없음: ${f}`);
    rels.push(toPosix(path.relative(root, abs)));
  }
  return [...new Set(rels)];
}

function groupByPackage(root, rels) {
  const groups = new Map();
  for (const rel of rels) {
    const pkgDir = nearestPackageDir(path.join(root, rel), root);
    if (!pkgDir) throw new UsageError(`package.json 을 찾지 못함(적용 관계를 알 수 없음): ${rel}`);
    if (!groups.has(pkgDir)) groups.set(pkgDir, []);
    groups.get(pkgDir).push(rel);
  }
  return groups;
}

// ── status — 종료 훅 · fe-start 가 쓰는 같은 판정 함수 ───────────────────────────
export function statusFor(root, rels, { base, cmd, format, expect, sessionId } = {}) {
  const groups = groupByPackage(root, rels);
  const tree = treeId(root);
  const out = [];
  for (const [pkgDir, files] of groups) {
    const ctx = packageContext(root, pkgDir, { cmd, format });
    const b = defaultBase(root, base, sessionId);
    const req = {
      files,
      tree,
      extrasFp: extrasFingerprint(ctx.declBase, root, ctx.decl.copy),
      base: b.sha,
      commandSig: ctx.runnerInfo.kind === 'unknown' ? null : commandSignature(ctx.runnerInfo),
      prepare: ctx.decl.prepare || null,
      expect,
    };
    out.push({ pkg: toPosix(path.relative(root, pkgDir)) || '.', base: b, ctx, ...satisfaction(root, req) });
  }
  return out;
}

// ── base · mutate ────────────────────────────────────────────────────────────
export async function verify(opts) {
  const cwd = opts.cwd || process.cwd();
  const root = toplevel(cwd);
  if (!root) throw new UsageError('git 저장소가 아님');
  if (!opts.files.length) throw new UsageError('테스트 파일을 -- 뒤에 하나 이상 주십시오');
  cleanupStale();
  const rels = resolveTests(root, cwd, opts.files);
  const groups = groupByPackage(root, rels);
  if (groups.size > 1) throw new UsageError(`테스트 파일이 여러 패키지에 걸쳐 있음(${[...groups.keys()].map((d) => path.relative(root, d) || '.').join(', ')}) — 패키지마다 따로 실행하십시오`);
  const [[pkgDir, testFiles]] = [...groups];
  const ctx = packageContext(root, pkgDir, opts);
  const started = Date.now();
  const rec = {
    version: RECORD_VERSION, createdAt: started, plugin: PLUGIN_VERSION, kind: opts.mode, base: null, baseFrom: null, mutation: null,
    scope: opts.only && opts.only.length ? 'partial' : 'full', sources: [], configChanged: [], tree: null,
    extrasFp: extrasFingerprint(ctx.declBase, root, ctx.decl.copy), commandSig: null, command: null, format: ctx.runnerInfo.format || null,
    prepare: ctx.decl.prepare || null, expect: opts.expect ?? null, pm: ctx.project.pm, runner: ctx.runnerInfo.runner || null,
    runnerVersion: ctx.runnerInfo.version || null, verified: isVerified(ctx.project.pm, ctx.runnerInfo), pkg: toPosix(path.relative(root, pkgDir)) || '.',
    testFiles, newCases: {}, targets: [], others: [], runs: {}, summary: null, fatal: null, fatalCode: null, notes: [], durationMs: 0,
    // 사람이 결과를 읽기 위한 설명(«중복 제출 가드 제거» 등). 기록이 무엇을 덮는가의 판정에는 쓰지 않는다 — 판정은 실제 대조 대상과 트리로 한다.
    intent: typeof opts.intent === 'string' && opts.intent.trim() ? opts.intent.trim() : null,
  };
  // fatalCode: 'no-target' = 대상 케이스를 정하지 못해 아무것도 재지 않음(덮임으로 치지 않는다) · 'env' = 그 밖의 측정 불가
  const finish = (fatal, code = 'env') => {
    if (fatal) {
      rec.fatal = fatal;
      rec.fatalCode = code;
    }
    rec.summary = summarize(rec.targets);
    rec.durationMs = Date.now() - started;
    const file = saveRecord(root, rec);
    return { root, rec, file };
  };

  rec.tree = treeId(root);
  if (ctx.runnerInfo.kind === 'unknown') return finish(ctx.runnerInfo.reason);
  rec.commandSig = commandSignature(ctx.runnerInfo);
  if (ctx.project.pm === 'yarn-pnp') return finish('Yarn PnP 는 첫 릴리스에서 자동 지원하지 않음(node_modules 가 없어 격리본에 의존성을 이을 수 없음)');

  // 대조할 제품 소스
  let sources;
  if (opts.mode === 'mutate') {
    const m = opts.mutation;
    if (!m || !m.file || m.find === undefined || m.replace === undefined) throw new UsageError('mutate 에는 --file · --find · --replace 가 필요합니다');
    const rel = resolveTests(root, cwd, [m.file])[0];
    const count = fs.readFileSync(path.join(root, rel), 'utf8').split(m.find).length - 1;
    if (!m.find || count !== 1) throw new UsageError(`--find 원문이 ${rel} 에 ${count}번 나옴 — 정확히 한 번이어야 합니다(아무것도 바꾸지 않음)`);
    rec.mutation = { file: rel, find: m.find, replace: m.replace };
    sources = [rel];
  } else {
    const b = defaultBase(root, opts.base, opts.sessionId);
    rec.base = b.sha;
    rec.baseFrom = b.from;
    const changes = changedSince(root, b.sha);
    const { products, config } = applicableProducts(root, ctx, changes);
    rec.configChanged = config;
    let list = products.map((p) => p.file);
    if (rec.scope === 'partial') {
      const want = new Set(resolveTests(root, cwd, opts.only, { mustExist: false }));
      const missing = [...want].filter((w) => !list.includes(w));
      if (missing.length) rec.notes.push(`--only 중 기준 이후 바뀐 제품 소스가 아니어서 뺀 것: ${missing.join(', ')}`);
      list = list.filter((p) => want.has(p));
    }
    if (!list.length) return finish(`대조할 제품 소스 차이 없음(기준 ${short(b.sha)} · ${b.from}) — 수정을 이미 커밋했다면 --base <수정 커밋의 부모> 를 주십시오`);
    if (list.length > MAX_SOURCES()) return finish(`대조할 제품 소스가 ${list.length}개로 상한(${MAX_SOURCES()})을 넘음 — --only 로 좁히십시오`);
    sources = list;
  }
  rec.sources = sources;

  const work = makeWorkDir();
  const name = path.basename(root);
  const A = path.join(work, 'a', name);
  const B = path.join(work, 'b', name);
  try {
    // 격리본 만들기
    const files = listWorkFiles(root);
    try {
      copyWorkTree(root, files, A);
    } catch (e) {
      if (e instanceof LimitError) return finish(e.message);
      throw e;
    }
    try {
      copyExtra(ctx.declBase, root, ctx.decl.copy, A);
    } catch (e) {
      if (e instanceof IsolationError) return finish(e.message);
      throw e;
    }
    attachNodeModules(root, files, A);
    const pkgA = path.join(A, path.relative(root, pkgDir));
    const names = ctx.packages.filter((p) => !p.isRoot && p.dir !== pkgDir).map((p) => p.name);
    const leaks = resolutionLeaks(A, root, pkgA, names);
    if (leaks.length) return finish(`격리 불가 — 워크스페이스 패키지가 원본 소스로 풀림(${leaks.map((l) => `${l.name} → ${l.resolved}`).join(', ')})`);
    const fileSet = new Set(files);
    const changedPkgs = ctx.closure.filter((p) => p.dir !== pkgDir && sources.some((s) => path.join(root, s).startsWith(p.dir + path.sep)));
    const built = buildOutputEntries(changedPkgs, root, fileSet);
    if (built.length && !ctx.decl.prepare) return finish(`대조 소스가 실행에 반영됐는지 확인할 수 없음 — 빌드 결과물을 내보내는 워크스페이스 패키지(${built.map((b) => `${b.name}: ${b.target}`).join(', ')}). 준비 명령(prepare)을 선언하면 양쪽 격리본에서 각각 빌드합니다`);
    cloneTree(path.join(work, 'a'), path.join(work, 'b'));

    // 둘째 격리본에 대조 내용 적용 — 쓰기 전에 경로의 모든 마디가 링크가 아닌지 본다(safeTarget)
    try {
      if (opts.mode === 'mutate') {
        const p = safeTarget(B, rec.mutation.file);
        const text = fs.readFileSync(p, 'utf8');
        const count = text.split(rec.mutation.find).length - 1;
        if (count !== 1) throw new UsageError(`--find 원문이 ${rec.mutation.file} 에 ${count}번 나옴 — 정확히 한 번이어야 합니다(아무것도 바꾸지 않음)`);
        fs.writeFileSync(p, text.replace(rec.mutation.find, () => rec.mutation.replace));
      } else {
        for (const s of sources) {
          if (modeAt(root, rec.base, s) === '120000') throw new IsolationError(`격리 불가 — 기준 리비전에서 심볼릭 링크인 소스는 대조하지 않음: ${s}`);
          const p = safeTarget(B, s);
          const blob = blobAt(root, rec.base, s);
          if (blob) {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, blob);
          } else fs.rmSync(p, { force: true });
        }
      }
    } catch (e) {
      if (e instanceof IsolationError) return finish(e.message);
      throw e;
    }

    // 준비 명령(선언한 경우) — 양쪽에서 각각
    if (ctx.decl.prepare) {
      for (const [label, dir] of [['현재', A], ['대조', B]]) {
        const r = await execute({ file: '/bin/sh', args: ['-c', String(ctx.decl.prepare)], env: {} }, path.join(dir, path.relative(root, ctx.project.root)), TIMEOUT());
        if (r.timedOut || r.exitCode !== 0) return finish(`준비 명령이 ${label} 격리본에서 실패(종료 코드 ${r.exitCode}${r.timedOut ? ' · 시간 초과' : ''}): ${r.output.trim().split('\n').slice(-2).join(' / ')}`);
      }
    }

    // 보정 실행(현재 소스)
    const relFromPkg = testFiles.map((f) => toPosix(path.relative(ctx.runDir, path.join(root, f))));
    const roots = (dir) => [dir, fs.realpathSync(dir)];
    const run = async (dir, tag) => {
      const out = path.join(work, `${tag}.json`);
      const ours = path.join(work, `${tag}.fe-rail.json`);
      const cmd = buildCommand(ctx.runnerInfo, relFromPkg, out, ours);
      rec.command = cmd.display;
      const exec = await execute(cmd, path.join(dir, path.relative(root, ctx.runDir)), TIMEOUT());
      return normalize(ctx.runnerInfo.format, { outJson: out, ourReport: ours, exec, copyRoots: roots(dir) });
    };
    const resA = await run(A, 'current');
    rec.runs.current = runSummary(resA);
    if (ctx.runnerInfo.format !== 'exit-code' && !resA.parsed) return finish(`보정 실행의 보고서를 읽지 못함(종료 코드 ${resA.exitCode}${resA.timedOut ? ' · 시간 초과' : ''}): ${resA.tail.trim().split('\n').slice(-3).join(' / ')}`);

    // 대상 케이스
    const targets = [];
    for (const f of testFiles) {
      const baseRev = rec.base || revParse(root, 'HEAD');
      const baseBuf = baseRev ? blobAt(root, baseRev, f) : null;
      rec.newCases[f] = ctx.runnerInfo.format === 'exit-code' ? [] : estimateNew(resA.files.get(f), baseBuf ? baseBuf.toString('utf8') : null);
    }
    if (ctx.runnerInfo.format === 'exit-code') {
      for (const f of testFiles) targets.push({ file: f, name: '(파일 전체 · 종료 코드)', chosen: 'exit-code' });
    } else if (opts.tests && opts.tests.length) {
      for (const n of opts.tests) {
        const hit = testFiles.filter((f) => matchCases(resA.files.get(f), n).length);
        if (!hit.length) targets.push({ file: testFiles[0], name: n, chosen: 'specified', missing: true });
        for (const f of hit) targets.push({ file: f, name: matchCases(resA.files.get(f), n)[0].fullName, chosen: 'specified' });
      }
    } else {
      for (const f of testFiles) for (const n of rec.newCases[f]) targets.push({ file: f, name: n, chosen: 'estimated' });
    }
    if (!targets.length) return finish('대상 케이스 없음 — 기준 대비 새 케이스를 추정하지 못함(기존 케이스를 고쳤거나 손대지 않은 기존 케이스로 이번 소스 변경을 재려면 --test "<전체 이름>" 으로 지정)', 'no-target');

    // 대조 실행 — 현재 소스에서 통과한 대상이 하나라도 있을 때만
    const anyPass = ctx.runnerInfo.format === 'exit-code' ? resA.exitCode === 0 : targets.some((t) => !t.missing && matchCases(resA.files.get(t.file), t.name).some((c) => c.state === 'passed'));
    const resB = anyPass ? await run(B, 'contrast') : null;
    if (resB) rec.runs.contrast = runSummary(resB);
    for (const t of targets) {
      if (t.missing) {
        rec.targets.push({ file: t.file, name: t.name, chosen: t.chosen, verdict: 'unmeasurable', reason: '보정 실행에서 케이스를 찾지 못함(--test 이름 확인 — 전체 이름은 « > » 로 잇습니다)', current: null, contrast: null, failure: null });
        continue;
      }
      const sourceB = readText(path.join(B, t.file));
      const j = judgeTarget({ rel: t.file, name: t.name, A: resA, B: resB, expect: opts.expect, sourceB, kind: opts.mode, format: ctx.runnerInfo.format });
      rec.targets.push({ ...j, chosen: t.chosen });
    }
    if (resB) for (const f of testFiles) rec.others.push(...othersFlipped(resA, resB, f, new Set(rec.targets.map((t) => t.name))));
    return finish(null);
  } finally {
    if (!opts.keep) removeWorkDir(work);
    else rec.notes.push(`격리본 보존: ${work}`);
  }
}

function runSummary(res) {
  const fileErrors = [];
  for (const [rel, f] of res.files) if (f.errors.length) fileErrors.push(`${rel}: ${String(f.errors[0].message).split('\n')[0]}`);
  return { exitCode: res.exitCode, timedOut: res.timedOut, parsed: res.parsed, source: res.source, files: res.files.size, fileErrors, unattributed: res.unattributed.map((e) => e.message) };
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ── 사람이 읽는 출력 ──────────────────────────────────────────────────────────
export function formatRecord(rec, file, root) {
  const L = [];
  const head = rec.kind === 'mutate'
    ? `지정 변이 (${rec.mutation ? rec.mutation.file : '-'})`
    : `수정 전 대조 (기준 ${short(rec.base)}${rec.baseFrom ? ` · ${rec.baseFrom}` : ''} · ${rec.scope === 'partial' ? '부분' : '전체'})`;
  const runner = rec.runner ? `${rec.runner}${rec.runnerVersion ? ` ${rec.runnerVersion}` : ''}` : rec.format || '-';
  L.push(`fe-rail verify-test — ${head} · ${runner} · ${rec.pm}${rec.verified ? '' : ' · 검증되지 않은 조합(자동 차단 없음)'}`);
  if (rec.intent) L.push(`깨뜨린 동작(설명): ${rec.intent}`);
  if (rec.mutation) L.push(`변이: ${mutationText(rec.mutation)}`);
  if (rec.sources.length) L.push(`대조한 제품 소스 ${rec.sources.length}개: ${listed(rec.sources)}`);
  if (rec.kind === 'base' && rec.sources.length > 1) L.push(`참고: 소스 ${rec.sources.length}개를 함께 되돌렸다 — 어느 수정이 아래 결과를 냈는지는 이 기록으로 가를 수 없다(가르려면 --only 또는 mutate)`);
  if (rec.configChanged.length) L.push(`설정 변경은 대조에 넣지 않음: ${listed(rec.configChanged)}`);
  for (const n of rec.notes) L.push(`참고: ${n}`);
  if (rec.fatal) {
    L.push('');
    L.push(`측정 불가 — ${rec.fatal}`);
  } else {
    const chosen = rec.targets.some((t) => t.chosen === 'estimated') ? '추정' : rec.targets.some((t) => t.chosen === 'specified') ? '지정' : '파일';
    L.push(`테스트 파일 ${rec.testFiles.length}개 · 대상 케이스 ${rec.targets.length}개(${chosen})`);
    L.push('');
    const LBL = { detected: '검출', undetected: '미검출', unconfirmed: '원인 미확인', unmeasurable: '측정 불가' };
    for (const t of rec.targets) {
      L.push(`${LBL[t.verdict].padEnd(6, ' ')}  ${t.file} › ${t.name}`);
      if (t.failure && t.failure.message) L.push(`        ${t.failure.message}${t.failure.at ? ` (${t.failure.at})` : ''}`);
      if (t.verdict !== 'detected') L.push(`        ${t.reason}`);
    }
    if (rec.others.length) L.push(`참고 — 대상이 아닌데 뒤집힌 케이스 ${rec.others.length}개: ${listed(rec.others.map((o) => o.name))}`);
  }
  const s = rec.summary;
  L.push('');
  L.push(rec.fatal ? '집계: 실행 전 측정 불가 — 판정한 케이스 없음' : `집계: 검출 ${s.detected} · 미검출 ${s.undetected} · 원인 미확인 ${s.unconfirmed} · 측정 불가 ${s.unmeasurable}`);
  L.push(`기록: ${path.relative(root, file)}`);
  if (rec.fatal || s.undetected || s.unconfirmed || s.unmeasurable) L.push(`해석: ${DOC}`);
  return L.join('\n');
}

const listed = (xs, n = 6) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` 외 ${xs.length - n}개` : ''}`;
const clip = (s, n = 48) => {
  const one = String(s).replace(/\n/g, '⏎');
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
export const mutationText = (m) => `${m.file}: «${clip(m.find)}» → «${clip(m.replace)}»`;
