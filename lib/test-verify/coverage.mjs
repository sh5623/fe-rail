// [fe-rail] test-verify — «이번 변경의 제품 코드를 실제로 대조한 기록이 있는가» (파일 단위 덮임) 와 보고(report).
// 종료 훅과 `fe-rail verify-test report` 가 같은 함수를 쓴다. 설계: docs/test-verify.md §6.1
//
// 기록 R 이 제품 코드 파일 F 를 덮는다 ⇔ 셋 다:
//   ① 현재 트리와 같다 — 검증 트리 id + 선언한 추가 입력(copy)의 내용 지문. 실행 뒤 무엇이든 고치면 무효
//   ② F 가 실제 대조 대상이었다 — base 기록이면 대조 소스 목록(--only 로 좁혔으면 좁힌 것)에 F 가 있고,
//      mutate 기록이면 변이를 넣은 파일이 F 다. 같은 턴에 고친 다른 파일까지 덮지 않는다
//   ③ 무언가를 쟀다 — 대상 케이스가 하나 이상이다(판정은 묻지 않는다 — 검출 · 미검출 · 원인 미확인 · 측정 불가 모두 «실행함»).
//      격리 · 빌드 결과물 등으로 실행 전에 측정 불가가 된 기록도 «실행함» 이다. 대상 케이스를 정하지 못한 기록은 덮지 않는다
// --intent(설명)는 판정에 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, isProductCode, toPosix } from './classify.mjs';
import { changedSince, revParse, treeId } from './git.mjs';
import { extrasFingerprint } from './isolate.mjs';
import { LABEL } from './judge.mjs';
import { nearestPackageDir } from './project.mjs';
import { loadRecords } from './record.mjs';
import { changedThisTurn, readTurn } from './turn.mjs';
import { DOC, mutationText, packageContext, statusFor } from './verify.mjs';

const short = (sha) => (sha ? sha.slice(0, 9) : '-');
const NO_MATCH = Symbol('no-match');

export function contrasted(rec, file) {
  if (rec.kind === 'mutate') return !!rec.mutation && rec.mutation.file === file;
  return Array.isArray(rec.sources) && rec.sources.includes(file);
}

export function measuredSomething(rec) {
  if ((rec.targets || []).length) return true;
  if (!rec.fatal) return false;
  return !(rec.fatalCode === 'no-target' || /^대상 케이스 없음/.test(rec.fatal));
}

// 패키지 맥락 캐시 — 훅 · report 안에서 같은 패키지를 여러 번 읽지 않는다.
export function contextCache(root) {
  const m = new Map();
  return (pkgDir) => {
    if (!m.has(pkgDir)) m.set(pkgDir, packageContext(root, pkgDir));
    return m.get(pkgDir);
  };
}

// 파일 목록(저장소 루트 기준 상대 경로) → 파일마다 { file, covered, entries: [{ rec, target|null }] }
export function coverage(root, files, { tree = null, ctxFor = contextCache(root), records = null } = {}) {
  if (!files.length) return [];
  const t = tree || treeId(root);
  const fpCache = new Map();
  const fpFor = (rec) => {
    const key = rec.pkg || '.';
    if (!fpCache.has(key)) {
      let fp = NO_MATCH;
      try {
        const ctx = ctxFor(path.join(root, key === '.' ? '' : key));
        fp = extrasFingerprint(ctx.declBase, root, ctx.decl.copy) || null;
      } catch {
        /* 기록의 패키지를 더 읽을 수 없음(지워짐 등) — 그 기록은 현재 상태와 맞는지 알 수 없으니 덮지 않는다 */
      }
      fpCache.set(key, fp);
    }
    return fpCache.get(key);
  };
  const valid = (records || loadRecords(root)).filter((r) => r.tree === t && measuredSomething(r) && (r.extrasFp || null) === fpFor(r));
  return files.map((file) => {
    const recs = valid.filter((r) => contrasted(r, file));
    // 같은 대조(종류 · 변이 또는 기준 · 범위) × 같은 케이스는 마지막 기록이 이긴다(기록은 시간순)
    const latest = new Map();
    for (const r of recs) {
      const key = r.kind === 'mutate' ? `m|${r.mutation.find}|${r.mutation.replace}` : `b|${r.base}|${(r.sources || []).join(',')}`;
      if (r.fatal && !(r.targets || []).length) latest.set(`${key}|<fatal>`, { rec: r, target: null });
      for (const tg of r.targets || []) latest.set(`${key}|${tg.file}|${tg.name}`, { rec: r, target: tg });
    }
    return { file, covered: recs.length > 0, entries: [...latest.values()] };
  });
}

// 바뀐 파일 목록 → { products: [제품 코드], tests: [실행할 테스트] } (지운 파일 제외 · 패키지를 모르는 파일 제외)
export function splitChanged(root, changed, ctxFor = contextCache(root)) {
  const products = [];
  const tests = [];
  for (const ch of changed) {
    if (ch.deleted || ch.status === 'D') continue;
    const abs = path.join(root, ch.file);
    if (!fs.existsSync(abs)) continue;
    const pkgDir = nearestPackageDir(abs, root);
    if (!pkgDir) continue;
    const ctx = ctxFor(pkgDir);
    const runner = ctx.runnerInfo.runner;
    if (classify(ch.file, ctx.decl, runner).kind === 'test') tests.push({ file: ch.file, pkgDir });
    else if (isProductCode(ch.file, ctx.decl, runner)) products.push({ file: ch.file, pkgDir });
  }
  return { products, tests };
}

// 제품 코드 F 를 지킬 법한 테스트 후보(힌트일 뿐 — 판정에 쓰지 않는다): 같은 폴더 · __tests__ 의 같은 이름 테스트,
// 그다음 F 를 가져오는(import · require) 테스트. 저장소 루트 기준 상대 경로.
export function candidateTests(root, rel, limit = 3) {
  const out = [];
  const add = (p) => {
    if (!out.includes(p) && out.length < limit) out.push(p);
  };
  const dir = path.posix.dirname(rel);
  const stem = path.posix.basename(rel).replace(/\.[^.]+$/, '');
  const near = (d) => {
    try {
      return fs.readdirSync(path.join(root, d)).filter((n) => n.startsWith(`${stem}.`) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(n)).map((n) => path.posix.join(d, n));
    } catch {
      return [];
    }
  };
  for (const p of [...near(dir), ...near(path.posix.join(dir, '__tests__'))]) add(p);
  if (out.length >= limit) return out;
  const name = stem === 'index' ? path.posix.basename(dir) : stem;
  if (!name || name === '.' || !/^[\w.@-]+$/.test(name)) return out;
  const esc = name.replace(/[.]/g, '\\.');
  const re = stem === 'index' ? `/${esc}(/index)?(\\.[cm]?[jt]sx?)?['"]` : `/${esc}(\\.[cm]?[jt]sx?)?['"]`;
  const r = spawnSync('git', ['grep', '-l', '-I', '--untracked', '-E', '-e', re, '--', ':(glob)**/*.test.*', ':(glob)**/*.spec.*', ':(glob)**/__tests__/**'], {
    cwd: root, encoding: 'utf8', timeout: 4000, maxBuffer: 1 << 24,
  });
  if (r.status === 0 && r.stdout) {
    for (const p of r.stdout.split('\n').filter(Boolean)) if (classify(p).kind === 'test') add(toPosix(p));
  }
  return out;
}

// ── report ───────────────────────────────────────────────────────────────────
// 대상: --base 를 주면 그 리비전 이후 바뀐 파일, 아니면 이 세션의 이번 턴에 바뀐 파일(턴 기록이 없으면 HEAD 이후).
export function reportFor(root, { base, sessionId } = {}) {
  let changed;
  let scope;
  let baseSha = null;
  if (base) {
    baseSha = revParse(root, base);
    if (!baseSha) throw new Error(`기준 리비전을 찾지 못함: ${base}`);
    changed = changedSince(root, baseSha);
    scope = `기준 ${short(baseSha)} 이후`;
  } else {
    const turn = sessionId ? readTurn(root, sessionId) : null;
    const viaTurn = turn && !turn.overflow && turn.head ? changedThisTurn(root, turn) : null;
    if (viaTurn) {
      changed = viaTurn;
      baseSha = turn.head;
      scope = '이번 턴';
    } else {
      baseSha = revParse(root, 'HEAD');
      changed = baseSha ? changedSince(root, baseSha) : [];
      scope = 'HEAD 이후(이 세션의 턴 기록 없음)';
    }
  }
  const ctxFor = contextCache(root);
  const { products, tests } = splitChanged(root, changed, ctxFor);
  const tree = treeId(root);
  const cov = coverage(root, products.map((p) => p.file), { tree, ctxFor });
  const testStatus = tests.length ? statusFor(root, tests.map((t) => t.file), { base: baseSha, sessionId }).map(({ ctx, ...r }) => r) : [];
  return { scope, base: baseSha, products: cov, tests: testStatus };
}

const clip = (s, n = 200) => {
  const one = String(s || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s*\n\s*/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
// 실제 관측값 — 실패 메시지 전체를 한 줄로(Jest 는 첫 줄이 «toHaveBeenCalledTimes(expected)» 뿐이고 «Received …» 가 다음 줄에 온다).
// Testing Library 가 덧붙이는 DOM 덤프(«Ignored nodes: …» · <html>…)는 걷어 낸다 — 관측값이 아니고 보고 줄을 덮는다.
export const stripDomDump = (m) => String(m || '').split(/\n\s*Ignored nodes:/)[0].split(/\n\s*<(?:html|body|div|main|section)[\s>]/)[0];
const observed = (t) => clip(stripDomDump((t.raw && t.raw.err && t.raw.err.message) || (t.failure && t.failure.message)), 220);

// 한 줄: «깨뜨린 동작 → 케이스 → 실제 관측값 → 판정»
export function entryLine(file, { rec, target }) {
  const what = rec.intent || (rec.kind === 'mutate' ? `변이 ${mutationText(rec.mutation)}` : `수정 전 내용으로 되돌림(기준 ${short(rec.base)})`);
  const how = rec.kind === 'mutate' ? '지정 변이' : `수정 전 대조${rec.scope === 'partial' ? ' · 부분' : ''}`;
  const mixed = rec.kind === 'base' && (rec.sources || []).length > 1
    ? ` · 함께 되돌린 소스 ${rec.sources.length}개 — 어느 수정이 이 결과를 냈는지는 이 기록으로 가를 수 없음` : '';
  if (!target) return `- ${file}: ${what} → 측정 불가 — ${clip(rec.fatal)} [${how}${mixed}]`;
  let seen;
  if (target.verdict === 'undetected') seen = '대조에서도 통과';
  else if (target.failure && target.failure.message) seen = `${observed(target)}${target.failure.at ? ` (${target.failure.at})` : ''}${target.verdict === 'unconfirmed' ? ` — ${clip(target.reason, 120)}` : ''}`;
  else seen = clip(target.reason, 160) || '-';
  return `- ${file}: ${what} → ${target.file} › ${target.name} → ${seen} → ${LABEL[target.verdict]} [${how}${mixed}]`;
}

export function formatReport(r) {
  const L = [];
  L.push(`테스트 확인 (${r.scope} · 제품 코드 ${r.products.length}개 · 바뀐 단위 테스트 ${r.tests.reduce((n, t) => n + t.perFile.length, 0)}개)`);
  const count = { detected: 0, undetected: 0, unconfirmed: 0, unmeasurable: 0 };
  let ran = 0;
  for (const p of r.products) {
    if (!p.covered) {
      L.push(`- ${p.file}: 미실행 — 이 파일을 대조한 기록이 현재 트리에 없음`);
      continue;
    }
    ran++;
    for (const e of p.entries) {
      L.push(entryLine(p.file, e));
      count[e.target ? e.target.verdict : 'unmeasurable']++;
    }
  }
  for (const t of r.tests) {
    for (const pf of t.perFile) {
      if (pf.fatal) L.push(`- 바뀐 테스트 ${pf.file}: 측정 불가 — ${clip(pf.fatal)}`);
      else if (!pf.ok) L.push(`- 바뀐 테스트 ${pf.file}: 미실행 — ${pf.missing ? `확인 안 된 새 케이스: ${pf.missing.join(' | ')}` : '수정 전 대조 기록 없음'}`);
      else for (const tg of pf.targets) L.push(`- 바뀐 테스트 ${pf.file} › ${tg.name} → ${tg.failure?.message ? observed(tg) : clip(tg.reason, 160)} → ${LABEL[tg.verdict]}`);
    }
  }
  if (!r.products.length && !r.tests.length) L.push('- 대상 없음 — 바뀐 제품 코드(JS·TS) · 단위 테스트가 없다');
  const notRun = r.products.length - ran;
  L.push(`집계: 제품 코드 ${r.products.length}개 중 실행 ${ran} · 미실행 ${notRun} — 검출 ${count.detected} · 미검출 ${count.undetected} · 원인 미확인 ${count.unconfirmed} · 측정 불가 ${count.unmeasurable}`);
  if (count.undetected || count.unconfirmed || count.unmeasurable) L.push(`해석: ${DOC}`);
  return L.join('\n');
}

export const reportIncomplete = (r) => r.products.some((p) => !p.covered) || r.tests.some((t) => !t.satisfied);
