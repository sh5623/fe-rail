// [fe-rail] test-verify — 소비 프로젝트 감지: 패키지 · 패키지 매니저 · 워크스페이스 · 러너 · 선언.
// 표준 표식(package.json · 잠금 파일 · 러너 설정)으로만 판단한다. 특정 프로젝트의 사정은 넣지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export const DECL_KEY = 'fe-rail';

export function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// 파일(또는 디렉터리)에서 가장 가까운 package.json 디렉터리. top(포함)까지만 올라간다.
export function nearestPackageDir(absPath, top) {
  let d = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory() ? absPath : path.dirname(absPath);
  while (inside(d, top)) {
    if (exists(path.join(d, 'package.json'))) return d;
    if (d === top) break;
    d = path.dirname(d);
  }
  return null;
}

const LOCKS = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

// 프로젝트 루트 = 패키지 디렉터리에서 git 루트까지 올라가며 처음 만난 잠금 파일(또는 워크스페이스 선언)의 디렉터리.
export function projectInfo(pkgDir, gitRoot) {
  let d = pkgDir;
  let root = null;
  let pm = null;
  while (inside(d, gitRoot)) {
    for (const [file, name] of LOCKS) {
      if (exists(path.join(d, file))) {
        root = d;
        pm = name;
        break;
      }
    }
    if (root) break;
    const pj = readJson(path.join(d, 'package.json'));
    if (pj && pj.workspaces) {
      root = d;
      break;
    }
    if (exists(path.join(d, 'pnpm-workspace.yaml'))) {
      root = d;
      pm = 'pnpm';
      break;
    }
    if (d === gitRoot) break;
    d = path.dirname(d);
  }
  if (!root) root = pkgDir;
  const rootPkg = readJson(path.join(root, 'package.json')) || {};
  if (!pm && typeof rootPkg.packageManager === 'string') pm = rootPkg.packageManager.split('@')[0] || null;
  if (!pm) pm = 'npm';
  let pnp = false;
  if (pm === 'yarn') {
    const yrc = readText(path.join(root, '.yarnrc.yml'));
    const linker = yrc && /^\s*nodeLinker\s*:\s*["']?([\w-]+)/m.exec(yrc);
    pnp = exists(path.join(root, '.pnp.cjs')) || exists(path.join(root, '.pnp.js')) || (!!yrc && (!linker || linker[1] === 'pnp') && !exists(path.join(root, 'node_modules')));
  }
  return { root, pm: pnp ? 'yarn-pnp' : pm, rootPkg };
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// pnpm-workspace.yaml 의 packages: 목록(최상위 키 아래 «- 값» 줄만).
function pnpmPatterns(root) {
  const y = readText(path.join(root, 'pnpm-workspace.yaml'));
  if (!y) return [];
  const out = [];
  let on = false;
  for (const line of y.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      on = true;
      continue;
    }
    if (on) {
      if (/^\S/.test(line)) break;
      const m = /^\s*-\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(line);
      if (m) out.push(m[1].trim());
    }
  }
  return out;
}

function expandPattern(root, pattern) {
  if (pattern.startsWith('!')) return [];
  const clean = pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  const segs = clean.split('/');
  let dirs = [root];
  for (const seg of segs) {
    const next = [];
    for (const d of dirs) {
      if (seg === '**') {
        next.push(...walkDirs(d, 4));
      } else if (seg.includes('*')) {
        const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
        for (const e of safeDir(d)) if (e.isDirectory() && e.name !== 'node_modules' && re.test(e.name)) next.push(path.join(d, e.name));
      } else {
        const p = path.join(d, seg);
        if (exists(p)) next.push(p);
      }
    }
    dirs = next;
  }
  return dirs.filter((d) => exists(path.join(d, 'package.json')));
}

function walkDirs(d, depth) {
  const out = [d];
  if (depth <= 0) return out;
  for (const e of safeDir(d)) if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) out.push(...walkDirs(path.join(d, e.name), depth - 1));
  return out;
}

function safeDir(d) {
  try {
    return fs.readdirSync(d, { withFileTypes: true });
  } catch {
    return [];
  }
}

// 워크스페이스 패키지 목록 [{ name, dir(절대), pkg }]. 루트 패키지도 포함한다(name 이 없으면 '(root)').
export function workspacePackages(project) {
  const { root, rootPkg } = project;
  const pats = [...pnpmPatterns(root)];
  const ws = rootPkg.workspaces;
  if (Array.isArray(ws)) pats.push(...ws);
  else if (ws && Array.isArray(ws.packages)) pats.push(...ws.packages);
  const dirs = new Set();
  for (const p of pats) for (const d of expandPattern(root, p)) dirs.add(d);
  const list = [{ name: rootPkg.name || '(root)', dir: root, pkg: rootPkg, isRoot: true }];
  for (const d of [...dirs].sort()) {
    if (d === root) continue;
    const pkg = readJson(path.join(d, 'package.json')) || {};
    list.push({ name: pkg.name || path.relative(root, d), dir: d, pkg, isRoot: false });
  }
  return list;
}

const depNames = (pkg) => new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies }));

// 패키지 P 와, P 가 (전이적으로) 의존하는 워크스페이스 패키지 묶음.
export function dependencyClosure(packages, startDir) {
  const byName = new Map(packages.filter((p) => !p.isRoot).map((p) => [p.name, p]));
  const start = packages.find((p) => p.dir === startDir);
  if (!start) return [];
  const seen = new Map([[start.dir, start]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of depNames(cur.pkg)) {
      const dep = byName.get(n);
      if (dep && !seen.has(dep.dir)) {
        seen.set(dep.dir, dep);
        queue.push(dep);
      }
    }
  }
  return [...seen.values()];
}

// 파일의 소유 패키지 = 그 파일을 담은 가장 깊은 패키지 디렉터리.
export function ownerPackage(packages, absFile) {
  let best = null;
  for (const p of packages) if (inside(absFile, p.dir) && (!best || p.dir.length > best.dir.length)) best = p;
  return best;
}

// 소비 프로젝트 선언: 테스트 패키지 → 프로젝트 루트 → git 루트 순으로 package.json 의 "fe-rail".testVerify.
export function readDeclaration(dirs) {
  for (const d of dirs) {
    const pj = readJson(path.join(d, 'package.json'));
    const decl = pj && pj[DECL_KEY] && pj[DECL_KEY].testVerify;
    if (decl && typeof decl === 'object') return { ...decl, _from: path.join(d, 'package.json') };
  }
  return {};
}

// node_modules 를 위로 거슬러 패키지 디렉터리를 찾는다(Node 해석 순서). top 의 바깥은 보지 않는다.
export function findInstalled(fromDir, name, top) {
  let d = fromDir;
  while (true) {
    const cand = path.join(d, 'node_modules', name);
    if (exists(path.join(cand, 'package.json'))) return cand;
    if (d === top || d === path.dirname(d) || !inside(d, top)) return null;
    d = path.dirname(d);
  }
}

// 러너 판정. 선언 command 가 있으면 그것을, 없으면 의존성·설정·test 스크립트로 Vitest/Jest 를 고른다.
export function detectRunner(pkgDir, project, gitRoot, decl) {
  if (decl.command) {
    const format = ['vitest', 'jest', 'exit-code'].includes(decl.format) ? decl.format : 'exit-code';
    return { kind: 'declared', runner: format === 'exit-code' ? null : format, format, command: String(decl.command), version: null };
  }
  const chain = [];
  let d = pkgDir;
  while (inside(d, project.root)) {
    const pj = readJson(path.join(d, 'package.json'));
    if (pj) chain.push({ dir: d, pkg: pj });
    if (d === project.root) break;
    d = path.dirname(d);
  }
  const has = (name) => chain.some(({ pkg }) => depNames(pkg).has(name));
  const cfg = (re) => chain.some(({ dir }) => safeDir(dir).some((e) => e.isFile() && re.test(e.name)));
  const vitest = has('vitest') || cfg(/^vitest\.(config|workspace)\.[cm]?[jt]s$/);
  const jest = has('jest') || cfg(/^jest\.config\.[cm]?[jt]s(on)?$/) || chain.some(({ pkg }) => pkg.jest);
  let runner = null;
  if (vitest && !jest) runner = 'vitest';
  else if (jest && !vitest) runner = 'jest';
  else if (vitest && jest) {
    const script = String(chain[0]?.pkg?.scripts?.test || '');
    if (/\bvitest\b/.test(script) && !/\bjest\b/.test(script)) runner = 'vitest';
    else if (/\bjest\b/.test(script) && !/\bvitest\b/.test(script)) runner = 'jest';
    else return { kind: 'unknown', reason: 'Vitest 와 Jest 가 함께 있어 러너를 정할 수 없음(선언 command 로 지정)' };
  }
  if (!runner) return { kind: 'unknown', reason: '러너를 알 수 없음(Vitest·Jest 의존성·설정 없음 — 선언 command 로 지정)' };
  const dir = findInstalled(pkgDir, runner, gitRoot);
  if (!dir) return { kind: 'unknown', reason: `${runner} 가 설치돼 있지 않음(의존성 설치 필요)` };
  const real = fs.realpathSync(dir);
  const version = (readJson(path.join(real, 'package.json')) || {}).version || null;
  const entry = runner === 'vitest' ? path.join(real, 'vitest.mjs') : path.join(real, 'bin', 'jest.js');
  if (!exists(entry)) return { kind: 'unknown', reason: `${runner} 실행 파일을 찾지 못함(${entry})` };
  return { kind: 'auto', runner, format: runner, version, entry, installedAt: dir };
}

// 자동 차단을 켜는 «검증된 조합». 고정 버전 실제 러너 eval(eval/runner.sh)을 통과한 조합만 여기에 둔다.
// 같은 메이저면 같은 조합으로 본다(eval 은 그 메이저의 고정 버전 하나로 돈다).
export const VERIFIED = [
  { pm: 'npm', runner: 'vitest', major: 4, pinned: '4.1.9' },
  { pm: 'pnpm', runner: 'vitest', major: 4, pinned: '4.1.9' },
  { pm: 'npm', runner: 'vitest', major: 5, pinned: '5.1.0' },
  { pm: 'pnpm', runner: 'vitest', major: 5, pinned: '5.1.0' },
  { pm: 'npm', runner: 'jest', major: 30, pinned: '30.2.0' },
];

export function isVerified(pm, runnerInfo) {
  if (!runnerInfo || runnerInfo.kind !== 'auto' || !runnerInfo.version) return false;
  const major = Number(String(runnerInfo.version).split('.')[0]);
  return VERIFIED.some((v) => v.pm === pm && v.runner === runnerInfo.runner && v.major === major);
}
