// [fe-rail] test-verify — 격리본. 현재 작업 내용을 임시 폴더에 재현하고, 실행기는 그 안에서만 파일을 바꾼다.
// 사용자 작업 트리 · 스테이징 · 원본 node_modules 에는 쓰지 않는다. 격리본은 버리는 것이라 복구 절차가 없다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PREFIX = 'fe-rail-verify-';
const CACHE_DIRS = new Set(['.cache', '.vite', '.vite-temp', '.vitest', '.vitest-cache', '.tmp', '.turbo', '.parcel-cache']);
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

export function tmpBase() {
  return fs.realpathSync(os.tmpdir());
}

// 강제 종료로 남은 격리본을 나이로 가려 지운다(기본 6시간).
export function cleanupStale(maxAgeMs = 6 * 3600 * 1000) {
  const base = tmpBase();
  let removed = 0;
  for (const e of safeDir(base)) {
    if (!e.isDirectory() || !e.name.startsWith(PREFIX)) continue;
    const p = path.join(base, e.name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) {
        fs.rmSync(p, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* 다른 프로세스가 지우는 중 */
    }
  }
  return removed;
}

function safeDir(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function makeWorkDir() {
  return fs.mkdtempSync(path.join(tmpBase(), PREFIX));
}

// rmSync 는 심볼릭 링크를 따라가지 않는다 — node_modules 미러의 링크를 지워도 원본은 남는다.
export function removeWorkDir(dir) {
  if (dir && path.basename(dir).startsWith(PREFIX)) fs.rmSync(dir, { recursive: true, force: true });
}

const limits = () => ({
  files: Number(process.env.FE_RAIL_VERIFY_MAX_FILES) || 100000,
  bytes: (Number(process.env.FE_RAIL_VERIFY_MAX_MB) || 4096) * 1024 * 1024,
});

function copyFile(src, dst, st) {
  try {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  } catch {
    fs.copyFileSync(src, dst);
  }
  fs.chmodSync(dst, st.mode & 0o777);
}

// 작업 트리의 파일 목록(git 추적 + 무시되지 않은 미추적)을 dest 에 그대로 복사한다.
export function copyWorkTree(gitRoot, files, dest) {
  const lim = limits();
  if (files.length > lim.files) throw new LimitError(`격리본 상한 초과: 파일 ${files.length}개 > ${lim.files}(FE_RAIL_VERIFY_MAX_FILES)`);
  const made = new Set();
  let bytes = 0;
  const skipped = [];
  for (const rel of files) {
    const src = path.join(gitRoot, rel);
    const dst = path.join(dest, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue; // 작업 트리에서 지워진 추적 파일
    }
    const dir = path.dirname(dst);
    if (!made.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      made.add(dir);
    }
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isFile()) {
      bytes += st.size;
      if (bytes > lim.bytes) throw new LimitError(`격리본 상한 초과: ${Math.round(bytes / 1048576)}MB(FE_RAIL_VERIFY_MAX_MB)`);
      copyFile(src, dst, st);
    } else skipped.push(rel); // 서브모듈 등
  }
  return { files: files.length, bytes, skipped };
}

// 선언한 추가 입력(git 이 무시하는 파일 · 폴더)을 복사한다. 원본에 없으면 건너뛴다.
export function copyExtra(baseDir, gitRoot, entries, dest) {
  const copied = [];
  for (const e of entries || []) {
    if (typeof e !== 'string' || !e || path.isAbsolute(e) || e.split(/[\\/]/).includes('..')) continue;
    const src = path.join(baseDir, e);
    if (!inside(src, gitRoot) || !fs.existsSync(src)) continue;
    const dst = path.join(dest, path.relative(gitRoot, src));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, force: true });
    copied.push(path.relative(gitRoot, src).split(path.sep).join('/'));
  }
  return copied;
}

// 선언한 추가 입력의 내용 지문. git 이 무시하는 파일은 바뀌어도 검증 트리 id 가 그대로라 따로 비교한다.
export function extrasFingerprint(baseDir, gitRoot, entries) {
  const h = crypto.createHash('sha256');
  const list = (entries || []).filter((e) => typeof e === 'string' && e && !path.isAbsolute(e)).sort();
  if (!list.length) return null;
  const walk = (p, rel) => {
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      h.update(`missing:${rel}\0`);
      return;
    }
    if (st.isDirectory()) for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n), `${rel}/${n}`);
    else if (st.isSymbolicLink()) h.update(`link:${rel}:${fs.readlinkSync(p)}\0`);
    else {
      h.update(`file:${rel}\0`);
      h.update(fs.readFileSync(p));
    }
  };
  for (const e of list) walk(path.join(baseDir, e), e);
  return h.digest('hex').slice(0, 20);
}

// 원본의 node_modules 를 격리본에 이어 붙인다. 폴더를 통째로 링크하지 않고 항목마다:
//   · 링크 항목 → 링크를 그대로 복제(상대 링크는 격리본 안에서 다시 풀린다 — 워크스페이스 패키지가 격리본을 가리킨다)
//   · @scope 같은 묶음 폴더 → 격리본에 폴더를 만들고 그 안을 같은 규칙으로(통째로 링크하면 안의 워크스페이스 링크가 원본으로 풀린다)
//   · .bin → 그대로 복사 · 캐시 폴더 → 가져오지 않음(러너가 원본 캐시에 쓰지 않게)
//   · 그 밖의 실제 폴더·파일 → 원본으로 링크
function mirrorNodeModules(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of safeDir(src)) {
    if (CACHE_DIRS.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    const st = fs.lstatSync(s);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else if (st.isDirectory() && e.name === '.bin') fs.cpSync(s, d, { recursive: true, verbatimSymlinks: true });
    else if (st.isDirectory() && e.name.startsWith('@')) mirrorScope(s, d);
    else fs.symlinkSync(s, d);
  }
}

function mirrorScope(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of safeDir(src)) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    const st = fs.lstatSync(s);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.symlinkSync(s, d);
  }
}

// package.json 이 있는 모든 디렉터리(+ git 루트)의 node_modules 를 이어 붙인다.
export function attachNodeModules(gitRoot, files, dest) {
  const dirs = new Set(['']);
  for (const rel of files) {
    if (rel === 'package.json' || rel.endsWith('/package.json')) {
      if (!rel.split('/').includes('node_modules')) dirs.add(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));
    }
  }
  const attached = [];
  for (const d of [...dirs].sort()) {
    const src = path.join(gitRoot, d, 'node_modules');
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    const dst = path.join(dest, d, 'node_modules');
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isDirectory()) mirrorNodeModules(src, dst);
    attached.push(d || '.');
  }
  return attached;
}

// 두 격리본이 같은 입력에서 시작하도록 첫째를 그대로 복제한다(링크는 링크로).
export function cloneTree(src, dst) {
  fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
}

// 자기 점검 ① — 테스트 패키지 위치에서 워크스페이스 패키지 이름을 Node 해석 순서로 찾아 최종 경로를 본다.
// 원본 저장소의 제품 소스(원본 node_modules 바깥)로 풀리면 격리가 깨진 것이다.
export function resolutionLeaks(copyRoot, gitRoot, fromDir, names) {
  const copyReal = fs.realpathSync(copyRoot);
  const gitReal = fs.realpathSync(gitRoot);
  const leaks = [];
  for (const name of names) {
    let d = fromDir;
    while (true) {
      const cand = path.join(d, 'node_modules', name);
      let found = false;
      try {
        fs.lstatSync(cand);
        found = true;
      } catch {
        /* 다음 상위 */
      }
      if (found) {
        let real;
        try {
          real = fs.realpathSync(cand);
        } catch {
          break; // 끊긴 링크 — 해석 실패는 러너가 드러낸다
        }
        if (!inside(real, copyReal) && inside(real, gitReal) && !real.split(path.sep).includes('node_modules')) leaks.push({ name, resolved: real });
        break;
      }
      if (d === copyRoot || d === path.dirname(d)) break;
      d = path.dirname(d);
    }
  }
  return leaks;
}

function exportTargets(pkg) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) if (k !== 'types' && k !== 'typings') walk(v[k]);
  };
  if (pkg.exports !== undefined) walk(pkg.exports);
  for (const k of ['module', 'main']) if (typeof pkg[k] === 'string') out.push(pkg[k]);
  if (typeof pkg.browser === 'string') out.push(pkg.browser);
  return [...new Set(out)];
}

// 자기 점검 ② — 대조로 내용이 바뀌는 워크스페이스 패키지가 «빌드 결과물» 을 내보내는가.
// 진입 파일이 작업 트리 파일 목록(git 추적 + 무시되지 않은 미추적)에 없으면 빌드 결과물(dist 등)로 본다.
// 그러면 대조 소스를 바꿔도 테스트는 기존 결과물을 읽어 통과할 수 있다 — 준비 명령이 없으면 측정 불가.
export function buildOutputEntries(pkgs, gitRoot, fileSet) {
  const found = [];
  for (const p of pkgs) {
    const relDir = path.relative(gitRoot, p.dir).split(path.sep).join('/');
    const pre = relDir ? `${relDir}/` : '';
    for (const t of exportTargets(p.pkg)) {
      if (!t.startsWith('./') && !/^[\w@]/.test(t)) continue;
      const clean = path.posix.normalize(t.replace(/^\.\//, ''));
      if (clean.startsWith('..')) continue;
      const star = clean.indexOf('*');
      const target = pre + (star >= 0 ? clean.slice(0, star) : clean);
      const tracked = star >= 0 ? [...fileSet].some((f) => f.startsWith(target)) : fileSet.has(target) || [...fileSet].some((f) => f.startsWith(target.replace(/\/?$/, '/')));
      if (!tracked) found.push({ name: p.name, target: t });
    }
  }
  return found;
}

export class LimitError extends Error {}
