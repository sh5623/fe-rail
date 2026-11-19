// [fe-rail] test-verify — Vitest 보고기(실행기가 --reporter 로 함께 넘긴다). 'vitest' 를 import 하지 않는다.
// JSON 보고서는 실패를 문자열로만 주어 «단언 오류인가» 와 «어디서 났나» 를 가를 수 없다. 이 보고기는 오류 객체에서
//   · isAssertion — chai AssertionError, 또는 expect.extend 단언(JestExtendError: __vitest_error_context__.assertionName)
//   · frames — Vitest 가 소스맵으로 풀고 내부 프레임을 걸러 낸 스택(stacks)
// 을 꺼내 FE_RAIL_VERIFY_REPORT 경로에 쓴다. 모듈 수준 오류(파일 로딩 실패 · afterAll 실패)와 미처리 오류도 함께.
import fs from 'node:fs';

// 스냅샷 불일치는 이름이 Error 지만 Vitest 자신도 «Snapshot … mismatched» 메시지로 가린다(실패 요약의 스냅샷 집계).
const SNAPSHOT_MISMATCH = /^Snapshot .* mismatched$/m;

function isAssertion(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.name === 'AssertionError') return true;
  const ctx = e.__vitest_error_context__;
  if (ctx && typeof ctx === 'object' && 'assertionName' in ctx) return true;
  return typeof e.message === 'string' && SNAPSHOT_MISMATCH.test(e.message) && 'expected' in e;
}

function ser(e) {
  return {
    name: String((e && e.name) || 'Error'),
    message: String((e && e.message) || '').slice(0, 1000),
    isAssertion: isAssertion(e),
    frames: Array.isArray(e && e.stacks) ? e.stacks.map((s) => ({ file: s.file, line: s.line, column: s.column })) : [],
  };
}

export default class FeRailVerifyReporter {
  onTestRunEnd(testModules, unhandledErrors, reason) {
    const out = process.env.FE_RAIL_VERIFY_REPORT;
    if (!out) return;
    const files = [];
    for (const m of testModules || []) {
      const cases = [];
      for (const c of m.children.allTests()) {
        const r = c.result();
        cases.push({ fullName: c.fullName, name: c.name, location: c.location || null, state: r.state, errors: (r.errors || []).map(ser) });
      }
      files.push({ file: m.moduleId, state: m.state(), errors: (m.errors() || []).map(ser), cases });
    }
    fs.writeFileSync(out, JSON.stringify({ format: 'fe-rail-vitest/1', reason, unhandled: (unhandledErrors || []).map(ser), files }));
  }
}
