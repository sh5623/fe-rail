#!/usr/bin/env node
// [fe-rail] fe-start Phase 6-0 기본 게이트 — build·E2E 명령을 «고르기만» 하고 실행하지 않는다.
//
// 소비자 CLAUDE.md·AGENTS.md 에 푸시 전(무거운) 게이트가 선언돼 있으면 이 스크립트를 쓰지 않는다(SKILL.md 6-0 의 2).
// 레포 루트에서 실행한다: node <fe-start base directory>/scripts/gate-commands.mjs [build] [e2e]
//
// 출력: 한 줄에 하나, 탭 구분 — 실행 순서대로
//   <kind>\t<cwd>\t<명령>          예) e2e	.	pnpm run test:e2e
//   <kind>\t-\t미실행: <사유>
// kind = build | e2e | e2e-setup(브라우저 설치 — FE_RAIL_ALLOW_PW_INSTALL 옵트인일 때만)
//
// 선택 순서 (kind 마다)
//   ① 루트 package.json 의 scripts — build: `build` / e2e: `e2e` → `test:e2e`
//      루트가 합본 검사를 소유하는 구성(`pnpm -r e2e`)을 보존하고, 어떤 러너(Cypress 등)를 쓰든 그대로 부른다.
//   ② 루트에 없으면 워크스페이스 패키지(pnpm-workspace.yaml 의 packages · package.json workspaces) 중
//      그 스크립트가 있는 곳 «전부» — 변경 경로로 좁히지 않는다(공용 패키지 변경을 놓친다).
//   ③ (e2e) 둘 다 없으면 루트 playwright.config.* 와 @playwright/test 의존성이 함께 있을 때만 `playwright test`.
//   ④ 그 외는 미실행 — 하위 폴더에 Playwright 설정이 있으면 사유에 경로를 적는다(«e2e 없음» 과 구분).
//
// 스크립트 존재는 package.json 을 파싱해 scripts 키에서 확인한다. 파일 전체 문자열 검색(grep '"e2e"')은
// `"workspaces": ["e2e"]` 같은 다른 값에 걸려 없는 스크립트를 고르고, `test:e2e` 는 놓쳐 설정 없는
// `playwright test` 로 떨어진다(루트 설정이 없으면 단위 테스트 파일까지 읽어 실패한다 — v1.20.0 계기).
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const NAMES = { build: ['build'], e2e: ['e2e', 'test:e2e'] }
const kinds = process.argv.slice(2)
for (const k of kinds) {
  if (!NAMES[k]) {
    console.error(`[fe-rail] 알 수 없는 kind: ${k} (build | e2e)`)
    process.exit(2)
  }
}

const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)
const readPkg = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}
const rel = (dir) => path.relative(ROOT, dir) || '.'

// 패키지 매니저 — fe-start Phase 3 과 같은 우선순위(pnpm → yarn → bun → npm). bun 의 실행기는 bunx 가 아니라 bun.
const exists = (f) => fs.existsSync(path.join(ROOT, f))
const [PM, PX] = exists('pnpm-lock.yaml')
  ? ['pnpm', 'pnpm']
  : exists('yarn.lock')
    ? ['yarn', 'yarn']
    : exists('bun.lockb') || exists('bun.lock')
      ? ['bun', 'bun']
      : ['npm', 'npx']

// 워크스페이스 패키지 목록 — 단순 glob(`apps/*`, `packages/*-ui`)만 펼친다. `**` 는 한 단계로 본다.
function workspaceGlobs() {
  const globs = []
  const ws = readPkg(ROOT)?.workspaces
  if (Array.isArray(ws)) globs.push(...ws)
  else if (Array.isArray(ws?.packages)) globs.push(...ws.packages)
  let yaml = ''
  try {
    yaml = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  } catch {}
  // packages: 목록만 읽는다 — 설정(minimumReleaseAge 등)만 있는 파일은 워크스페이스가 아니다.
  let inPackages = false
  for (const line of yaml.split('\n')) {
    if (/^packages:\s*(#.*)?$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const m = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*(#.*)?$/)
    if (m) globs.push(m[1].trim())
    else if (/^\S/.test(line)) inPackages = false
  }
  return globs.filter((g) => !g.startsWith('!'))
}
function expand(base, parts, out) {
  if (!parts.length) {
    if (base !== ROOT && fs.existsSync(path.join(base, 'package.json'))) out.add(base)
    return
  }
  const [head, ...tail] = parts
  if (!head.includes('*')) return expand(path.join(base, head), tail, out)
  const re = new RegExp(`^${head.replace(/\*\*/g, '*').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  let entries = []
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {}
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.') && re.test(e.name)) {
      expand(path.join(base, e.name), tail, out)
    }
  }
}
function workspaceDirs() {
  const out = new Set()
  for (const g of workspaceGlobs()) expand(ROOT, g.replace(/^\.\//, '').replace(/\/+$/, '').split('/'), out)
  return [...out].sort()
}

// 하위 폴더의 Playwright 설정(최대 2단계 · node_modules/.git 제외) — 미실행 사유에 경로를 남기는 용도.
function nestedPlaywrightConfigs() {
  const found = []
  const walk = (dir, depth) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {}
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < 2 && e.name !== 'node_modules' && e.name !== '.git') walk(path.join(dir, e.name), depth + 1)
      } else if (depth > 0 && /^playwright\.config\.[cm]?[jt]s$/.test(e.name)) {
        found.push(rel(path.join(dir, e.name)))
      }
    }
  }
  walk(ROOT, 0)
  return found.sort()
}

const firstScript = (dir, names) => {
  const scripts = readPkg(dir)?.scripts
  return names.find((n) => has(scripts, n))
}
const usesPlaywright = (dir) => {
  const p = readPkg(dir)
  return has(p?.devDependencies, '@playwright/test') || has(p?.dependencies, '@playwright/test')
}

function pick(kind) {
  const names = NAMES[kind]
  const rootScript = firstScript(ROOT, names)
  if (rootScript) return [{ cwd: ROOT, cmd: `${PM} run ${rootScript}` }]
  const subs = workspaceDirs()
    .map((dir) => ({ dir, name: firstScript(dir, names) }))
    .filter((s) => s.name)
  if (subs.length) return subs.map((s) => ({ cwd: s.dir, cmd: `${PM} run ${s.name}` }))
  if (kind === 'build') return [{ skip: 'package.json scripts 에 build 없음(루트·워크스페이스)' }]
  const rootConfig = fs.readdirSync(ROOT).find((f) => /^playwright\.config\.[cm]?[jt]s$/.test(f))
  if (rootConfig && usesPlaywright(ROOT)) return [{ cwd: ROOT, cmd: `${PX} playwright test` }]
  if (rootConfig) return [{ skip: `${rootConfig} 는 있으나 @playwright/test 의존성이 없음` }]
  const nested = nestedPlaywrightConfigs()
  if (nested.length) {
    return [
      {
        skip: `scripts 에 ${names.join('·')} 없음 · 루트 설정 없음 — 하위 설정 ${nested.slice(0, 3).join(', ')}${nested.length > 3 ? ` 외 ${nested.length - 3}` : ''} 의 실행 명령을 정할 수 없음(프로젝트가 게이트를 선언하거나 scripts.e2e 를 둔다)`,
      },
    ]
  }
  return [{ skip: `scripts 에 ${names.join('·')} 없음 · Playwright 설정 없음` }]
}

const lines = []
for (const kind of kinds.length ? kinds : ['build', 'e2e']) {
  for (const s of pick(kind)) {
    if (s.skip) {
      lines.push(`${kind}\t-\t미실행: ${s.skip}`)
      continue
    }
    // 브라우저 자동 설치는 옵트인 — 수백 MB 다운로드이고 --with-deps 는 root 권한을 요구한다.
    // npm exec 는 --with-deps 같은 플래그를 삼키므로 실행기($PX = npx/pnpm/yarn/bun)로 부른다.
    // 루트 스크립트가 앱에 위임하는 구성(의존성은 앱에만)도 잡도록 루트면 워크스페이스 패키지까지 본다.
    const pw = usesPlaywright(s.cwd) || (s.cwd === ROOT && workspaceDirs().some(usesPlaywright))
    if (kind === 'e2e' && process.env.FE_RAIL_ALLOW_PW_INSTALL && pw) {
      lines.push(`e2e-setup\t${rel(s.cwd)}\t${PX} playwright install --with-deps chromium`)
    }
    lines.push(`${kind}\t${rel(s.cwd)}\t${s.cmd}`)
  }
}
console.log(lines.join('\n'))
