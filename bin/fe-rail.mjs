#!/usr/bin/env node
// [fe-rail] 명령 진입점. Claude Code 는 플러그인 bin/ 을 Bash 도구의 PATH 에 올린다.
// 일반 셸 · CI 에서는 `node <플러그인 경로>/bin/fe-rail.mjs …` 로 직접 부른다.
import path from 'node:path';
import { stop, turnStart } from '../lib/test-verify/hook.mjs';
import { DOC, PLUGIN_VERSION, UsageError, formatRecord, statusFor, verify } from '../lib/test-verify/verify.mjs';
import { toplevel } from '../lib/test-verify/git.mjs';

const HELP = `fe-rail ${PLUGIN_VERSION}

  fe-rail verify-test base   [--base <rev>] [--only <소스>]… [--test <케이스 전체 이름>]… [--expect <문자열>]
                             [--cmd <명령 틀> [--format vitest|jest|exit-code]] [--json] [--keep] -- <테스트 파일>…
  fe-rail verify-test mutate --file <소스> --find <원문> --replace <바꿀 내용> [--test …] [--expect …] [--cmd …] -- <테스트 파일>…
  fe-rail verify-test status [--base <rev>] [--expect <문자열>] [--cmd …] [--json] -- <테스트 파일>…

  base    현재 작업 내용의 격리본 둘을 만들고, 하나는 그대로(현재 소스) · 하나는 제품 소스를 기준 리비전 내용으로
          바꿔(대조 소스) 같은 테스트를 돌린다. 사용자 작업 트리와 스테이징은 읽기만 한다.
          기준 기본값 = 이 세션의 턴 시작 HEAD(없으면 HEAD).
  mutate  대조 소스를 «현재 소스의 지정한 한 곳을 바꾼 것» 으로 만든다(--find 원문은 그 파일에 정확히 한 번).
  status  현재 상태에서 요청을 충족하는 기록이 있는지(종료 훅 · fe-start 가 쓰는 같은 판정).

  판정(케이스마다): 검출 · 미검출 · 원인 미확인 · 측정 불가 — 해석: ${DOC}`;

function parse(argv) {
  const o = { files: [], only: [], tests: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest) {
      o.files.push(a);
      continue;
    }
    const val = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} 에 값이 없음`);
      return argv[++i];
    };
    switch (a) {
      case '--': rest = true; break;
      case '--base': o.base = val(); break;
      case '--only': o.only.push(val()); break;
      case '--test': o.tests.push(val()); break;
      case '--expect': o.expect = val(); break;
      case '--cmd': o.cmd = val(); break;
      case '--format': o.format = val(); break;
      case '--file': o.file = val(); break;
      case '--find': o.find = val(); break;
      case '--replace': o.replace = val(); break;
      case '--json': o.json = true; break;
      case '--keep': o.keep = true; break;
      case '-h': case '--help': o.help = true; break;
      default:
        if (a.startsWith('-')) throw new UsageError(`알 수 없는 옵션: ${a}`);
        o.files.push(a);
    }
  }
  return o;
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (cmd === 'hook') {
    // 훅은 어떤 경우에도 세션을 깨뜨리지 않는다 — 오류는 삼키고 exit 0.
    try {
      const input = await readStdin();
      if (sub === 'turn-start') turnStart(input);
      else if (sub === 'stop') {
        const r = stop(input);
        for (const n of r.notices) process.stderr.write(`${n}\n`);
        if (r.block) process.stdout.write(JSON.stringify(r.block));
      }
    } catch (e) {
      if (process.env.FE_RAIL_VERIFY_DEBUG) process.stderr.write(`[fe-rail][test-verify] 훅 오류: ${e.stack || e}\n`);
    }
    return 0;
  }
  if (cmd !== 'verify-test' || !sub || ['-h', '--help'].includes(sub)) {
    process.stdout.write(`${HELP}\n`);
    return cmd ? (['-h', '--help'].includes(cmd) || ['-h', '--help'].includes(sub) ? 0 : 2) : 0;
  }
  const o = parse(rest);
  if (o.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  if (sub === 'status') {
    const root = toplevel(process.cwd());
    if (!root) throw new UsageError('git 저장소가 아님');
    if (!o.files.length) throw new UsageError('테스트 파일을 -- 뒤에 하나 이상 주십시오');
    const files = o.files.map((f) => {
      const abs = path.resolve(process.cwd(), f);
      if (!abs.startsWith(root + path.sep)) throw new UsageError(`저장소 밖의 파일: ${f}`);
      return path.relative(root, abs).split(path.sep).join('/');
    });
    const res = statusFor(root, files, { base: o.base, cmd: o.cmd, format: o.format, expect: o.expect, sessionId });
    if (o.json) {
      process.stdout.write(`${JSON.stringify(res.map(({ ctx, ...r }) => r), null, 1)}\n`);
    } else {
      for (const r of res) {
        process.stdout.write(`${r.pkg}: ${r.satisfied ? '충족' : '미충족'} (기준 ${r.base.sha.slice(0, 9)} · ${r.base.from}) · 검출 ${r.summary.detected} · 미검출 ${r.summary.undetected} · 원인 미확인 ${r.summary.unconfirmed} · 측정 불가 ${r.summary.unmeasurable}\n`);
        for (const p of r.perFile) process.stdout.write(`  ${p.ok ? '✓' : '✗'} ${p.file}${p.fatal ? ` — 측정 불가: ${p.fatal}` : ''}${!p.ok ? (p.missing ? ` — 확인 안 된 케이스: ${p.missing.join(' | ')}` : ' — 기록 없음') : ''}\n`);
      }
    }
    return res.every((r) => r.satisfied) ? 0 : 3;
  }
  if (sub !== 'base' && sub !== 'mutate') throw new UsageError(`알 수 없는 하위 명령: ${sub}`);
  const r = await verify({
    cwd: process.cwd(), mode: sub, base: o.base, only: o.only, tests: o.tests, expect: o.expect, cmd: o.cmd, format: o.format,
    files: o.files, keep: o.keep, sessionId, mutation: sub === 'mutate' ? { file: o.file, find: o.find, replace: o.replace } : null,
  });
  if (o.json) process.stdout.write(`${JSON.stringify({ record: r.file, ...r.rec }, null, 1)}\n`);
  else process.stdout.write(`${formatRecord(r.rec, r.file, r.root)}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => {
    if (e instanceof UsageError) {
      process.stderr.write(`fe-rail: ${e.message}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`fe-rail: 내부 오류 — ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 1;
    }
  },
);
