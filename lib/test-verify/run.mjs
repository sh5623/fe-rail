// [fe-rail] test-verify — 테스트 명령 구성 · 실행 · 보고서 정규화.
// 정규화 결과: { exitCode, timedOut, parsed, unattributed[], files: Map<rel, { state, errors[], cases[] }> }
//   case = { fullName, name, location:{line,column}|null, state, errors:[{ name, message, isAssertion, frames:[{file,line,column}] }] }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VITEST_REPORTER = path.join(HERE, 'vitest-reporter.mjs');

const shq = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

// 실행할 명령. 자동 감지면 러너를 직접 부르고(스냅샷 읽기 전용 · 커버리지 끔 · 재시도 끔),
// 선언 command 면 {files} {out} {reporter} 자리표시자를 채워 셸로 부른다.
export function buildCommand(runnerInfo, relFiles, outJson, ourReport) {
  if (runnerInfo.kind === 'auto' && runnerInfo.runner === 'vitest') {
    return {
      file: process.execPath,
      args: [runnerInfo.entry, 'run', ...relFiles, '--reporter=json', `--outputFile=${outJson}`, `--reporter=${VITEST_REPORTER}`,
        '--includeTaskLocation', '--update=none', '--coverage.enabled=false', '--retry=0', '--watch=false'],
      env: { FE_RAIL_VERIFY_REPORT: ourReport },
      display: `vitest run <files> --update=none --coverage.enabled=false --retry=0`,
    };
  }
  if (runnerInfo.kind === 'auto' && runnerInfo.runner === 'jest') {
    return {
      file: process.execPath,
      args: [runnerInfo.entry, '--json', `--outputFile=${outJson}`, '--testLocationInResults', '--ci', '--coverage=false',
        '--watchman=false', '--watchAll=false', '--runTestsByPath', ...relFiles],
      env: {},
      display: `jest --ci --coverage=false --runTestsByPath <files>`,
    };
  }
  const cmd = runnerInfo.command
    .replace(/\{files\}/g, relFiles.map(shq).join(' '))
    .replace(/\{out\}/g, shq(outJson))
    .replace(/\{reporter\}/g, shq(VITEST_REPORTER));
  return { file: '/bin/sh', args: ['-c', cmd], env: { FE_RAIL_VERIFY_REPORT: ourReport }, display: runnerInfo.command };
}

export function commandSignature(runnerInfo) {
  if (runnerInfo.kind === 'auto') return `auto:${runnerInfo.runner}@${runnerInfo.version}`;
  return `declared:${runnerInfo.format}:${runnerInfo.command}`;
}

// 격리본 안의 명령에 늘 넣는 환경. 격리본의 node_modules 는 원본을 링크로 보므로, 패키지 매니저가 «의존성이 낡았다» 며
// 스스로 설치를 시작하면 링크를 따라 원본에 쓸 수 있다. pnpm 의 실행 전 의존성 확인(verify-deps-before-run)은
// 원본 경로를 담은 상태 파일 때문에 격리본에서 늘 «낡음» 으로 판정하고 install 을 시도한다(실측 · pnpm 11) — 끈다.
const ISOLATED_ENV = {
  FORCE_COLOR: '0',
  NO_COLOR: '1',
  pnpm_config_verify_deps_before_run: 'false',
  npm_config_verify_deps_before_run: 'false',
};

// 프로세스 그룹째 실행해 시간 상한에 걸리면 워커까지 함께 끝낸다.
export function execute(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const child = spawn(cmd.file, cmd.args, {
      cwd,
      env: { ...process.env, ...ISOLATED_ENV, ...cmd.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (b) => {
      out += b.toString();
      if (out.length > 200000) out = out.slice(-100000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ exitCode: null, timedOut, output: String(e.message), ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!timedOut) {
        try {
          process.kill(-child.pid, 'SIGKILL'); // 남은 워커 정리
        } catch {
          /* 이미 끝남 */
        }
      }
      resolve({ exitCode: code, timedOut, output: out, ms: Date.now() - started });
    });
  });
}

// ── 보고서 정규화 ────────────────────────────────────────────────────────────

const FRAME = /^\s*at\s+(?:.*?\()?((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^():]*?):(\d+):(\d+)\)?\s*$/;

export function framesFromStack(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const m = FRAME.exec(line);
    if (!m) continue;
    let file = m[1];
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file);
      } catch {
        continue;
      }
    }
    frames.push({ file, line: Number(m[2]), column: Number(m[3]) });
  }
  return frames;
}

const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';
const errName = (s) => (/^\s*([A-Za-z_$][\w$]*)(?::|$)/.exec(firstLine(s)) || [])[1] || 'Error';
// 스택 줄 앞까지의 메시지 전체(이름 접두 제거 · 1000자 상한). --expect 는 이 전체에서 찾는다.
const msgOf = (s) => {
  const lines = String(s || '').split('\n');
  const cut = lines.findIndex((l) => /^\s+at\s/.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').replace(/^\s*[A-Za-z_$][\w$]*:\s*/, '').trim().slice(0, 1000);
};
const caseState = (s) => (s === 'passed' || s === 'failed' ? s : 'skipped');

function relOf(abs, roots) {
  for (const r of roots) {
    if (abs === r) return '';
    if (abs.startsWith(r + path.sep)) return abs.slice(r.length + 1).split(path.sep).join('/');
  }
  return null;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// copyRoots: 격리본 루트(경로 · 실경로) — 보고서의 절대 경로를 저장소 기준 상대 경로로 바꾼다.
export function normalize(format, { outJson, ourReport, exec, copyRoots }) {
  const res = { exitCode: exec.exitCode, timedOut: exec.timedOut, parsed: false, source: null, unattributed: [], files: new Map(), tail: exec.output.slice(-2000) };
  if (format === 'exit-code') return res;
  const ours = format === 'vitest' ? readJsonSafe(ourReport) : null;
  if (ours && ours.format === 'fe-rail-vitest/1') {
    res.parsed = true;
    res.source = 'fe-rail-reporter';
    for (const f of ours.files) {
      const rel = relOf(f.file, copyRoots);
      if (rel == null) continue;
      res.files.set(rel, {
        state: f.state === 'passed' ? 'passed' : f.state === 'failed' ? 'failed' : 'skipped',
        errors: f.errors.map((e) => ({ ...e, frames: mapFrames(e.frames, copyRoots) })),
        cases: f.cases.map((c) => ({ fullName: c.fullName, name: c.name, location: c.location || null, state: caseState(c.state), errors: c.errors.map((e) => ({ ...e, frames: mapFrames(e.frames, copyRoots) })) })),
      });
    }
    res.unattributed = (ours.unhandled || []).map((e) => ({ name: e.name, message: e.message }));
    return res;
  }
  const j = readJsonSafe(outJson);
  if (!j || !Array.isArray(j.testResults)) return res;
  res.parsed = true;
  res.source = format === 'jest' ? 'jest-json' : 'vitest-json';
  for (const f of j.testResults) {
    const rel = relOf(f.name, copyRoots);
    if (rel == null) continue;
    const msg = String(f.message || '');
    const suiteFailed = format === 'jest' ? (/Test suite failed to run/.test(msg) || !!f.testExecError) : msg.trim().length > 0;
    const cases = (f.assertionResults || []).map((a) => {
      const errors = (a.failureMessages || []).map((m, i) => {
        const det = (a.failureDetails || [])[i];
        const name = errName(m);
        const isAssertion = format === 'jest' ? !!(det && typeof det === 'object' && det.matcherResult) : name === 'AssertionError' || /^\s*Error: Snapshot .* mismatched\s*$/m.test(firstLine(m));
        return { name, message: msgOf(m), isAssertion, frames: mapFrames(framesFromStack(m), copyRoots) };
      });
      const titles = [...(a.ancestorTitles || []), a.title];
      return { fullName: titles.join(' > '), name: a.title, location: a.location || null, state: caseState(a.status), errors };
    });
    res.files.set(rel, {
      state: f.status === 'passed' ? 'passed' : f.status === 'failed' ? 'failed' : 'skipped',
      errors: suiteFailed ? [{ name: errName(msg.replace(/^[\s●]*Test suite failed to run\s*/, '')), message: msgOf(msg.replace(/^[\s●]*Test suite failed to run\s*/, '')) || 'file error', isAssertion: false, frames: [] }] : [],
      cases,
    });
  }
  return res;
}

function mapFrames(frames, copyRoots) {
  return (frames || []).map((fr) => ({ file: relOf(fr.file, copyRoots) ?? fr.file, line: fr.line, column: fr.column }));
}
