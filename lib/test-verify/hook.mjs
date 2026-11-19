// [fe-rail] test-verify — 훅. turn-start(UserPromptSubmit) 는 턴 시작 상태를 기록하고, stop(Stop) 은 이번 턴에
// 바뀐 단위 테스트를 수정 전 코드에서 확인한 기록이 없을 때 한 번 막는다. 판단할 수 없으면 막지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { classify, toPosix } from './classify.mjs';
import { changedSince, toplevel, treeId } from './git.mjs';
import { cleanupStale } from './isolate.mjs';
import { isVerified, nearestPackageDir } from './project.mjs';
import { satisfaction } from './record.mjs';
import { commandSignature } from './run.mjs';
import { readTurn, saveTurn, snapshot, changedThisTurn } from './turn.mjs';
import { applicableProducts, packageContext, PLUGIN_ROOT } from './verify.mjs';
import { extrasFingerprint } from './isolate.mjs';

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

// 반환: { block: {decision, reason} | null, notices: string[] }
export function stop(input) {
  const res = { block: null, notices: [] };
  if (input.stop_hook_active) return res;
  const root = toplevel(input.cwd || process.cwd());
  if (!root || !input.session_id) return res;
  const start = readTurn(root, input.session_id);
  if (!start || start.overflow || !start.head) return res;
  const changed = changedThisTurn(root, start);
  if (!changed || !changed.length) return res;

  // 이번 턴에 바뀐 «실행할 테스트» 를 패키지별로
  const groups = new Map();
  for (const ch of changed) {
    if (ch.deleted) continue;
    const abs = path.join(root, ch.file);
    if (!fs.existsSync(abs)) continue;
    const pkgDir = nearestPackageDir(abs, root);
    if (!pkgDir) continue; // 적용 관계를 알 수 없음
    if (!groups.has(pkgDir)) groups.set(pkgDir, { ctx: null, tests: [] });
    const g = groups.get(pkgDir);
    if (!g.ctx) g.ctx = packageContext(root, pkgDir);
    if (classify(ch.file, g.ctx.decl, g.ctx.runnerInfo.runner).kind === 'test') g.tests.push(ch.file);
  }
  let changesSinceStart = null;
  let tree = null;
  const pending = [];
  for (const [pkgDir, g] of groups) {
    if (!g.tests.length) continue;
    const ctx = g.ctx;
    if (ctx.runnerInfo.kind === 'unknown' || ctx.project.pm === 'yarn-pnp') continue;
    changesSinceStart = changesSinceStart || changedSince(root, start.head);
    if (!applicableProducts(root, ctx, changesSinceStart).products.length) continue;
    const pkgRel = toPosix(path.relative(root, pkgDir)) || '.';
    if (!isVerified(ctx.project.pm, ctx.runnerInfo)) {
      res.notices.push(`[fe-rail][test-verify] ${pkgRel}: ${ctx.project.pm} + ${ctx.runnerInfo.runner || ctx.runnerInfo.format} ${ctx.runnerInfo.version || ''} 는 검증된 조합이 아니라 막지 않습니다 — 바뀐 테스트 ${g.tests.length}개는 \`fe-rail verify-test base -- <파일>\` 로 직접 확인할 수 있습니다.`);
      continue;
    }
    tree = tree || treeId(root);
    const st = satisfaction(root, {
      files: g.tests, tree, extrasFp: extrasFingerprint(ctx.declBase, root, ctx.decl.copy), base: start.head,
      commandSig: commandSignature(ctx.runnerInfo), prepare: ctx.decl.prepare || null,
    });
    if (st.satisfied) continue;
    const files = st.perFile.filter((p) => !p.ok).map((p) => p.file);
    if (files.length > MAX_TESTS()) {
      res.notices.push(`[fe-rail][test-verify] ${pkgRel}: 이번 턴에 바뀐 단위 테스트가 ${files.length}개로 상한(${MAX_TESTS()})을 넘어 막지 않습니다 — 새로 쓴 회귀 테스트는 \`fe-rail verify-test base -- <파일>\` 로 확인하십시오.`);
      continue;
    }
    pending.push({ pkgRel, files: files.map((f) => toPosix(path.relative(input.cwd || root, path.join(root, f)))) });
  }
  if (!pending.length) return res;
  const bin = path.join(PLUGIN_ROOT, 'bin', 'fe-rail');
  const cmds = pending.map((p) => `fe-rail verify-test base --base ${start.head.slice(0, 12)} -- ${p.files.map(shq).join(' ')}`);
  res.block = {
    decision: 'block',
    reason: `[fe-rail][test-verify] 이번 턴에 바뀐 단위 테스트 ${pending.reduce((n, p) => n + p.files.length, 0)}개를 수정 전 코드에서 확인한 기록이 없습니다. `
      + `격리본에서 현재 소스와 수정 전 소스로 같은 테스트를 돌려 «그 테스트가 수정 전 코드에서 실제로 실패하는가» 를 확인하십시오(작업 트리는 건드리지 않습니다):\n`
      + cmds.map((c) => `  ${c}`).join('\n')
      + `\n새로 쓴 케이스는 \`--test "<describe > it 전체 이름>"\` 으로 지정하면 정확합니다. 새 기능이라 수정 전 코드에 대상이 없으면(측정 불가 · 파일 로딩 실패) \`fe-rail verify-test mutate --file <소스> --find <원문> --replace <바꿀 내용> -- <테스트>\` 를 쓰십시오. `
      + `결과(검출 · 미검출 · 원인 미확인 · 측정 불가)는 그대로 보고하고, 미검출 · 원인 미확인이면 출력의 «해석» 문서를 읽으십시오. `
      + `\`fe-rail\` 이 PATH 에 없으면 \`${bin}\` 를 쓰십시오. 지금 확인할 수 없으면(사용자가 원치 않음 · 작업 미완 · 질문 중) 마지막 줄에 \`테스트 확인: 생략 — <이유>\` 를 적으십시오.`,
  };
  return res;
}
