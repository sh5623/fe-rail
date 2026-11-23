// [fe-rail] test-verify — 훅. turn-start(UserPromptSubmit) 는 턴 시작 상태를 기록하고, stop(Stop) 은 이번 턴에
// 바뀐 단위 테스트를 수정 전 코드에서 확인한 기록이 없거나, 이번 턴에 바뀐 제품 코드를 실제로 대조한 기록이 없을 때 한 번 막는다.
// 판단할 수 없으면 막지 않는다.
import path from 'node:path';
import { toPosix } from './classify.mjs';
import { candidateTests, contextCache, coverage, splitChanged } from './coverage.mjs';
import { changedSince, toplevel, treeId } from './git.mjs';
import { cleanupStale, extrasFingerprint } from './isolate.mjs';
import { isVerified } from './project.mjs';
import { satisfaction } from './record.mjs';
import { commandSignature } from './run.mjs';
import { readTurn, saveTurn, snapshot, changedThisTurn } from './turn.mjs';
import { applicableProducts, DOC, PLUGIN_ROOT } from './verify.mjs';

const MAX_TESTS = () => {
  const v = process.env.FE_RAIL_VERIFY_MAX_TESTS;
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : 10;
};
const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

export function turnStart(input) {
  const root = toplevel(input.cwd || process.cwd());
  if (!root || !input.session_id) return null;
  try {
    cleanupStale();
  } catch {
    /* 정리는 부수 작업 */
  }
  saveTurn(root, input.session_id, snapshot(root));
  return null;
}


// 마지막 답변에 «테스트 확인: 생략 — <이유>» 줄이 있으면 막지 않는다(이유가 비어 있으면 인정하지 않는다).
// Stop 훅 입력의 last_assistant_message(Claude Code 가 넘기는 마지막 답변 본문)를 읽는다. 없으면 생략 줄도 없는 것으로 본다.
const SKIP_LINE = /^[ \t>*-]*\**테스트 확인\**[ \t]*:[ \t]*\**생략\**[ \t]*[—–-]+[ \t]*\S/m;
export const hasSkipLine = (msg) => typeof msg === 'string' && SKIP_LINE.test(msg);
const LIST_MAX = 10;

// 반환: { block: {decision, reason} | null, notices: string[] }
// 두 갈래를 한 번에 본다 — ① 이번 턴에 바뀐 단위 테스트를 수정 전 코드에서 확인한 기록 ② 이번 턴에 바뀐 제품 코드(JS·TS)를
// 실제로 대조한 기록(테스트 파일을 고쳤는지와 무관 · docs/test-verify.md §6.1). 둘 중 하나라도 비면 첫 종료를 한 번 막는다.
export function stop(input) {
  const res = { block: null, notices: [] };
  if (input.stop_hook_active) return res;
  const root = toplevel(input.cwd || process.cwd());
  if (!root || !input.session_id) return res;
  const start = readTurn(root, input.session_id);
  if (!start || start.overflow || !start.head) return res;
  const changed = changedThisTurn(root, start);
  if (!changed || !changed.length) return res;

  const ctxFor = contextCache(root);
  const { products, tests } = splitChanged(root, changed, ctxFor);
  if (!products.length && !tests.length) return res;

  const usable = new Map(); // pkgDir → 막을 수 있는 패키지인가(검증된 조합) — 알림은 패키지마다 한 번
  const gate = (pkgDir) => {
    if (usable.has(pkgDir)) return usable.get(pkgDir);
    const ctx = ctxFor(pkgDir);
    let ok = !(ctx.runnerInfo.kind === 'unknown' || ctx.project.pm === 'yarn-pnp');
    if (ok && !isVerified(ctx.project.pm, ctx.runnerInfo)) {
      const pkgRel = toPosix(path.relative(root, pkgDir)) || '.';
      res.notices.push(`[fe-rail][test-verify] ${pkgRel}: ${ctx.project.pm} + ${ctx.runnerInfo.runner || ctx.runnerInfo.format} ${ctx.runnerInfo.version || ''} 는 검증된 조합이 아니라 막지 않습니다 — 이번 턴의 변경(바뀐 테스트 · 제품 코드)은 \`fe-rail verify-test base|mutate\` 로 직접 확인할 수 있습니다.`);
      ok = false;
    }
    usable.set(pkgDir, ok);
    return ok;
  };
  let tree = null;
  const treeNow = () => (tree = tree || treeId(root));

  // ① 바뀐 단위 테스트 — 패키지별
  const testGroups = new Map();
  for (const t of tests) {
    if (!testGroups.has(t.pkgDir)) testGroups.set(t.pkgDir, []);
    testGroups.get(t.pkgDir).push(t.file);
  }
  let changesSinceStart = null;
  const pendingTests = [];
  for (const [pkgDir, files0] of testGroups) {
    const ctx = ctxFor(pkgDir);
    if (ctx.runnerInfo.kind === 'unknown' || ctx.project.pm === 'yarn-pnp') continue;
    changesSinceStart = changesSinceStart || changedSince(root, start.head);
    if (!applicableProducts(root, ctx, changesSinceStart).products.length) continue;
    if (!gate(pkgDir)) continue;
    const st = satisfaction(root, {
      files: files0, tree: treeNow(), extrasFp: extrasFingerprint(ctx.declBase, root, ctx.decl.copy), base: start.head,
      commandSig: commandSignature(ctx.runnerInfo), prepare: ctx.decl.prepare || null,
    });
    if (st.satisfied) continue;
    const files = st.perFile.filter((p) => !p.ok).map((p) => p.file);
    const pkgRel = toPosix(path.relative(root, pkgDir)) || '.';
    if (files.length > MAX_TESTS()) {
      res.notices.push(`[fe-rail][test-verify] ${pkgRel}: 이번 턴에 바뀐 단위 테스트가 ${files.length}개로 상한(${MAX_TESTS()})을 넘어 막지 않습니다 — 새로 쓴 회귀 테스트는 \`fe-rail verify-test base -- <파일>\` 로 확인하십시오.`);
      continue;
    }
    pendingTests.push({ pkgRel, files: files.map((f) => rel(input, root, f)) });
  }

  // ② 바뀐 제품 코드 — 파일마다 «실제로 대조한 기록» 이 있는가
  const blockable = products.filter((p) => gate(p.pkgDir));
  const uncovered = blockable.length ? coverage(root, blockable.map((p) => p.file), { tree: treeNow(), ctxFor }).filter((c) => !c.covered).map((c) => c.file) : [];

  if (!pendingTests.length && !uncovered.length) return res;
  if (hasSkipLine(input.last_assistant_message)) return res;

  const bin = path.join(PLUGIN_ROOT, 'bin', 'fe-rail');
  const head = start.head.slice(0, 12);
  const parts = [];
  if (pendingTests.length) {
    const cmds = pendingTests.map((p) => `fe-rail verify-test base --base ${head} -- ${p.files.map(shq).join(' ')}`);
    parts.push(`[fe-rail][test-verify] 이번 턴에 바뀐 단위 테스트 ${pendingTests.reduce((n, p) => n + p.files.length, 0)}개를 수정 전 코드에서 확인한 기록이 없습니다. `
      + `격리본에서 현재 소스와 수정 전 소스로 같은 테스트를 돌려 «그 테스트가 수정 전 코드에서 실제로 실패하는가» 를 확인하십시오(작업 트리는 건드리지 않습니다):\n`
      + cmds.map((c) => `  ${c}`).join('\n')
      + `\n새로 쓴 케이스는 \`--test "<describe > it 전체 이름>"\` 으로 지정하면 정확합니다. 새 기능이라 수정 전 코드에 대상이 없으면(측정 불가 · 파일 로딩 실패) \`fe-rail verify-test mutate --file <소스> --find <원문> --replace <바꿀 내용> -- <테스트>\` 를 쓰십시오.`);
  }
  if (uncovered.length) {
    const lines = uncovered.slice(0, LIST_MAX).map((f) => {
      const cands = candidateTests(root, f).map((c) => rel(input, root, c));
      return `  - ${rel(input, root, f)}${cands.length ? `  (후보 테스트: ${cands.join(', ')})` : '  (후보 테스트를 찾지 못함 — 이 동작을 지키는 테스트를 직접 찾거나 쓰십시오)'}`;
    });
    if (uncovered.length > LIST_MAX) lines.push(`  - 외 ${uncovered.length - LIST_MAX}개`);
    parts.push(`[fe-rail][test-verify] 이번 턴에 바뀐 제품 코드 ${uncovered.length}개를 실제로 대조한 기록이 없습니다(테스트 파일을 고쳤는지와 무관합니다):\n${lines.join('\n')}\n`
      + `이번 수정이 보장하려는 동작을 일부러 깨뜨렸을 때 그 동작을 지키는 테스트가 실제로 실패하는지 확인하십시오(격리본에서만 바꿉니다):\n`
      + `  1) 변경에서 기대 동작(예: «처리 중 다시 눌러도 요청은 한 번만 나간다»)을 짚고, 그것을 단언하는 기존 케이스를 찾는다 — 없으면 테스트를 쓴다.\n`
      + `  2) 결함 수정이면 수정 전 대조: fe-rail verify-test base --base ${head} --only <소스> --test "<케이스 전체 이름>" --intent "<깨뜨린 동작>" -- <테스트 파일>\n`
      + `     새 기능이거나 여러 수정이 섞여 원인을 갈라야 하면 조건 하나만 깨뜨리는 지정 변이: fe-rail verify-test mutate --file <소스> --find "<원문>" --replace "<깨뜨린 내용>" --test "<케이스>" --intent "<깨뜨린 동작>" -- <테스트 파일>\n`
      + `     (가드 제거 · 경계값 이동 · 분기 목적지 교체 · 호출 키 고정 등 — 고르는 법: ${DOC} §10)\n`
      + `  3) 끝나면 \`fe-rail verify-test report\` 를 돌려 그 줄(깨뜨린 동작 → 케이스 → 실제 관측값 → 판정)을 요약하지 말고 종료 답변에 그대로 싣는다(«검출 N» 같은 집계만으로는 무엇을 깨뜨렸고 어떤 단언이 반응했는지 남지 않는다). `
      + `실행하지 않은 파일은 «미실행», 실행했는데 변이를 잡지 못했으면 «미검출» 과 그 케이스를 적는다. 파일 로딩 오류 같은 측정 불가는 검출이 아니다.\n`
      + `동작 변화가 없으면(문구 · 표현 · 타입 · 이름만 바꿈 — TSX 안의 순수 표현 변경 포함) 대조할 동작이 없으니 생략 줄로 마칩니다.`);
  }
  parts.push(`결과(검출 · 미검출 · 원인 미확인 · 측정 불가)는 그대로 보고하고, 미검출 · 원인 미확인이면 출력의 «해석» 문서를 읽으십시오. `
    + `\`fe-rail\` 이 PATH 에 없으면 \`${bin}\` 를 쓰십시오. 지금 확인할 수 없거나 확인할 동작 변화가 없으면(사용자가 원치 않음 · 작업 미완 · 질문 중 · 동작 변화 없음) 마지막 줄에 \`테스트 확인: 생략 — <이유>\` 를 적으십시오.`);
  res.block = { decision: 'block', reason: parts.join('\n\n') };
  return res;
}

const rel = (input, root, f) => toPosix(path.relative(input.cwd || root, path.join(root, f)));
