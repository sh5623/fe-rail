// [fe-rail] test-verify — git 보조 함수.
// 이 모듈은 사용자 작업 트리와 스테이징(index)에 쓰지 않는다. 읽기와, 임시 index 로 트리 id 를 계산할 때의
// 객체 저장(.git/objects)만 한다 — fe-start 의 «검증 트리 id» 와 같은 방식이다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX = 1 << 30;

export function git(cwd, args, { input, env, buffer = false, allowFail = false } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    input,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: buffer ? 'buffer' : 'utf8',
    maxBuffer: MAX,
  });
  if (r.error) {
    if (allowFail) return { ok: false, out: buffer ? Buffer.alloc(0) : '', err: String(r.error.message) };
    throw new Error(`git ${args[0]}: ${r.error.message}`);
  }
  if (r.status !== 0) {
    if (allowFail) return { ok: false, out: r.stdout, err: String(r.stderr) };
    throw new Error(`git ${args.join(' ')} 실패: ${String(r.stderr).trim().split('\n').slice(-2).join(' / ')}`);
  }
  return allowFail ? { ok: true, out: r.stdout, err: String(r.stderr) } : r.stdout;
}

export function toplevel(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return r.ok ? r.out.trim() : null;
}

// 워크트리마다 따로인 git 디렉터리 안의 경로(추적되지 않는다).
export function gitPath(root, rel) {
  const p = git(root, ['rev-parse', '--git-path', rel]).trim();
  return path.isAbsolute(p) ? p : path.join(root, p);
}

export function revParse(root, rev) {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true });
  return r.ok ? r.out.trim() : null;
}

const splitZ = (s) => s.split('\0').filter(Boolean);

// 작업 트리에 있는 추적 파일 + 무시되지 않은 미추적 파일(중복 제거 · 정렬).
export function listWorkFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return [...new Set(splitZ(out))].sort();
}

export function listUntracked(root) {
  return splitZ(git(root, ['ls-files', '-z', '--others', '--exclude-standard']));
}

// base 리비전과 현재 작업 트리(스테이징 + 미스테이징 + 미추적)의 차이. 이름 바꾸기는 삭제 + 추가로 본다.
export function changedSince(root, base) {
  const out = git(root, ['diff', '--name-status', '-z', '--no-renames', base, '--']);
  const parts = splitZ(out);
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i + 1], parts[i][0]);
  for (const p of listUntracked(root)) map.set(p, 'A');
  return [...map.entries()].map(([file, status]) => ({ file, status })).sort((a, b) => a.file.localeCompare(b.file));
}

export function changedBetween(root, a, b) {
  if (a === b) return [];
  return splitZ(git(root, ['diff', '--name-only', '-z', '--no-renames', a, b, '--']));
}

// rev:path 의 내용(Buffer). 없으면 null.
export function blobAt(root, rev, file) {
  const r = git(root, ['cat-file', 'blob', `${rev}:${file}`], { buffer: true, allowFail: true });
  return r.ok ? r.out : null;
}

// rev 에서 여러 경로의 blob id. 없는 경로는 결과에 없다.
export function blobIdsAt(root, rev, files) {
  const ids = new Map();
  for (let i = 0; i < files.length; i += 400) {
    const chunk = files.slice(i, i + 400);
    const r = git(root, ['ls-tree', '-z', rev, '--', ...chunk], { allowFail: true });
    if (!r.ok) continue;
    for (const line of splitZ(r.out)) {
      const tab = line.indexOf('\t');
      const [, type, id] = line.slice(0, tab).split(' ');
      if (type === 'blob') ids.set(line.slice(tab + 1), id);
    }
  }
  return ids;
}

// 작업 트리 파일의 blob id(git 의 clean 필터 적용 — git add 와 같은 값). 없는 파일은 결과에 없다.
export function hashWorkFiles(root, files) {
  const ids = new Map();
  const present = files.filter((f) => !f.includes('\n') && isFile(path.join(root, f)));
  for (let i = 0; i < present.length; i += 400) {
    const chunk = present.slice(i, i + 400);
    const out = git(root, ['hash-object', '--stdin-paths'], { input: chunk.join('\n') + '\n' });
    const hashes = out.trim().split('\n');
    chunk.forEach((f, k) => ids.set(f, hashes[k]));
  }
  return ids;
}

function isFile(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isFile() || st.isSymbolicLink();
  } catch {
    return false;
  }
}

// 커밋되지 않은 경로(스테이징·미스테이징·미추적). 이름 바꾸기는 둘로 본다.
export function dirtyPaths(root) {
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  return splitZ(out).map((e) => e.slice(3));
}

// fe-start «검증 결과 객체» 의 검증 트리 id 와 같은 계산: 실제 index 를 복사한 임시 index 에
// 수정·삭제·미추적 파일을 반영해 write-tree. 실제 index 는 건드리지 않는다.
export function treeId(root) {
  const real = gitPath(root, 'index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-rail-idx-'));
  const tmp = path.join(dir, 'index');
  try {
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    const list = git(root, ['ls-files', '-z', '-m', '-d', '-o', '--exclude-standard']);
    if (list) git(root, ['update-index', '-z', '--add', '--remove', '--stdin'], { input: list, env });
    return git(root, ['write-tree'], { env }).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
