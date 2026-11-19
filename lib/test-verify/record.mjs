// [fe-rail] test-verify — 실행 기록과 «요청을 충족하는가» 판정. 종료 훅과 fe-start 가 같은 함수(status)를 쓴다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gitPath } from './git.mjs';
import { rejudge, summarize } from './judge.mjs';

export const RECORD_VERSION = 1;
const KEEP = 300;

export const recordsDir = (root) => gitPath(root, 'fe-rail/verify/records');

export function saveRecord(root, rec) {
  const dir = recordsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${new Date(rec.createdAt).toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const file = path.join(dir, `${id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...rec, id }, null, 1));
  fs.renameSync(tmp, file);
  const all = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  for (const n of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(dir, n), { force: true });
  return file;
}

export function loadRecords(root) {
  const dir = recordsDir(root);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      if (r && r.version === RECORD_VERSION) out.push(r);
    } catch {
      /* 깨진 기록은 무시 */
    }
  }
  return out;
}

// 기록이 요청을 충족하는 조건(설계 §7.8):
//   ① 입력이 같다 — 검증 트리 id + 선언한 추가 입력의 내용 지문
//   ② 기준 · 명령 · 준비 명령이 같다(지정 변이 기록은 기준 대신 같은 트리에서의 변이로 인정)
//   ③ 범위가 전체다(부분 대조 기록은 전체 확인 요청을 충족하지 않는다)
//   ④ 그 파일에서 확인해야 할 케이스(새 케이스 추정) 전부를 유효한 기록들의 대상이 덮는다
// --expect 는 저장한 실패 근거로 다시 판정해 결과에 반영한다(재실행 없이).
export function satisfaction(root, req) {
  const valid = loadRecords(root).filter((r) =>
    r.tree === req.tree
    && (r.extrasFp || null) === (req.extrasFp || null)
    && r.commandSig === req.commandSig
    && (r.prepare || null) === (req.prepare || null)
    && r.scope === 'full'
    && (r.kind === 'mutate' || r.base === req.base));
  const perFile = req.files.map((file) => {
    const recs = valid.filter((r) => (r.testFiles || []).includes(file));
    if (!recs.length) return { file, ok: false, records: 0, missing: null, targets: [] };
    if (recs.some((r) => r.fatal)) {
      const f = recs.find((r) => r.fatal);
      return { file, ok: true, records: recs.length, missing: [], targets: [], fatal: f.fatal };
    }
    const required = new Set(recs.flatMap((r) => (r.newCases && r.newCases[file]) || []));
    const latest = new Map(); // 같은 케이스를 여러 번 돌렸으면 마지막 기록이 이긴다
    for (const r of recs) for (const t of r.targets || []) if (t.file === file) latest.set(t.name, req.expect !== undefined ? rejudge(t, req.expect) : t);
    const targets = [...latest.values()];
    const covered = new Set(latest.keys());
    const missing = [...required].filter((n) => !covered.has(n));
    return { file, ok: missing.length === 0, records: recs.length, missing, targets };
  });
  const targets = perFile.flatMap((p) => p.targets);
  return { satisfied: perFile.every((p) => p.ok), perFile, summary: summarize(targets) };
}
