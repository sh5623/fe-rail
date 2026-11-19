// [fe-rail] test-verify — 턴 기록. 턴 시작 때 «HEAD + 미커밋 파일별 내용 해시» 를 세션별로 저장하고,
// 종료 때 «이번 턴에 내용이 바뀐 파일» 을 구한다(턴 안에서 커밋한 변경 포함 · 앞 턴의 미커밋 변경 제외).
import fs from 'node:fs';
import path from 'node:path';
import { blobIdsAt, changedBetween, dirtyPaths, gitPath, hashWorkFiles, revParse } from './git.mjs';

const MAX_DIRTY = () => Number(process.env.FE_RAIL_VERIFY_MAX_DIRTY) || 2000;
const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

export const turnsDir = (root) => gitPath(root, 'fe-rail/verify/turns');

export function snapshot(root) {
  const head = revParse(root, 'HEAD');
  const dirty = [...new Set(dirtyPaths(root))];
  if (dirty.length > MAX_DIRTY()) return { head, overflow: true, dirty: {} };
  const ids = hashWorkFiles(root, dirty);
  const map = {};
  for (const p of dirty) map[p] = ids.get(p) || null; // null = 작업 트리에 없음(삭제)
  return { head, overflow: false, dirty: map };
}

export function saveTurn(root, sessionId, snap) {
  const id = safeId(sessionId);
  if (!id) return null;
  const dir = turnsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...snap, at: new Date().toISOString() }));
  fs.renameSync(`${file}.tmp`, file);
  // 오래된 세션 기록 정리(7일)
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 7 * 86400000) fs.rmSync(p, { force: true });
    } catch {
      /* 무시 */
    }
  }
  return file;
}

export function readTurn(root, sessionId) {
  const id = safeId(sessionId);
  if (!id) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(turnsDir(root), `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// 이번 턴에 내용이 바뀐 파일(저장소 루트 기준 상대 경로). 지워진 파일은 deleted 로 표시한다.
export function changedThisTurn(root, start) {
  const cur = snapshot(root);
  if (cur.overflow || !start.head || !cur.head) return null;
  const cand = new Set([...Object.keys(start.dirty), ...Object.keys(cur.dirty), ...changedBetween(root, start.head, cur.head)]);
  const list = [...cand];
  const startIds = blobIdsAt(root, start.head, list);
  const curIds = cur.head === start.head ? startIds : blobIdsAt(root, cur.head, list);
  const out = [];
  for (const p of list) {
    const a = p in start.dirty ? start.dirty[p] : startIds.get(p) || null;
    const b = p in cur.dirty ? cur.dirty[p] : curIds.get(p) || null;
    if (a !== b) out.push({ file: p, deleted: b === null });
  }
  return out.sort((x, y) => x.file.localeCompare(y.file));
}
