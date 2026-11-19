// [fe-rail] test-verify — 케이스 단위 판정.
// 검출 = 대상 케이스가 현재 소스에서 통과했고, 대조 소스에서 그 케이스의 «본문» 단언이 뒤집혔으며,
//        --expect 를 줬다면 실패 메시지가 그 문자열을 담고 있음을 확인했을 때만.
// 확인하지 못한 결과는 검출로 세지 않는다(원인 미확인 · 측정 불가로 그대로 보고).
export const LABEL = { detected: '검출', undetected: '미검출', unconfirmed: '원인 미확인', unmeasurable: '측정 불가' };
const HOOK_CALL = /\b(beforeEach|afterEach|beforeAll|afterAll)\s*\(/;

export function matchCases(fileRes, name) {
  if (!fileRes) return [];
  const full = fileRes.cases.filter((c) => c.fullName === name);
  if (full.length) return full;
  return fileRes.cases.filter((c) => c.name === name);
}

// 파일 · 러너 수준의 오류(정리 단계 실패 · 파일 로딩 실패 · 미처리 오류 · 원인 모를 비정상 종료).
export function fileLevelError(res, rel) {
  if (res.timedOut) return '시간 상한 초과';
  const f = res.files.get(rel);
  if (f && f.errors.length) return `파일 수준 오류: ${firstLine(f.errors[0].message) || f.errors[0].name}`;
  if (f && f.state === 'failed' && !f.cases.some((c) => c.state === 'failed')) return '파일 수준 오류(실패한 케이스 없이 파일이 실패)';
  if (res.unattributed.length) return `미처리 오류: ${firstLine(res.unattributed[0].message) || res.unattributed[0].name}`;
  const anyCaseFailed = [...res.files.values()].some((x) => x.cases.some((c) => c.state === 'failed') || x.errors.length);
  if (res.exitCode !== 0 && !anyCaseFailed) return `러너가 원인 모를 종료 코드 ${res.exitCode} 로 끝남`;
  return null;
}

const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

// 실패가 그 케이스의 «본문» 에서 났는가. 스택에서 테스트 파일을 가리키는 가장 바깥 프레임이
// 케이스 선언 뒤 · 다음 케이스 선언 앞이고, 그 사이에 훅 선언이 없어야 한다.
// (본문 실패의 가장 바깥 테스트 파일 프레임은 러너가 부른 테스트 콜백 자신이고, 준비 단계 실패면 훅 콜백이다.)
export function bodyCheck(c, err, fileCases, rel, sourceText) {
  const own = (err.frames || []).filter((f) => f.file === rel);
  if (!own.length) return { ok: false, why: '실패 스택에 테스트 파일 프레임이 없음' };
  const loc = c.location;
  if (!loc || !loc.line) return { ok: false, why: '보고서에 케이스 선언 위치가 없음' };
  const o = own[own.length - 1];
  const after = o.line > loc.line || (o.line === loc.line && o.column > (loc.column || 0));
  if (!after) return { ok: false, why: `케이스 선언(${loc.line}행) 앞에서 실패 — 준비 단계로 보임`, at: o };
  const next = fileCases.map((x) => x.location && x.location.line).filter((l) => l && l > loc.line).sort((a, b) => a - b)[0];
  if (next && o.line >= next) return { ok: false, why: `다음 케이스 선언(${next}행) 뒤에서 실패`, at: o };
  if (sourceText) {
    const between = sourceText.split('\n').slice(loc.line, o.line).join('\n');
    if (HOOK_CALL.test(between)) return { ok: false, why: '케이스 선언과 실패 위치 사이에 훅 선언이 있음 — 준비·정리 단계로 보임', at: o };
  }
  return { ok: true, at: o };
}

// 대상 하나의 판정. A = 보정 실행(현재 소스) · B = 대조 실행.
export function judgeTarget({ rel, name, A, B, expect, sourceB, kind, format }) {
  const out = { file: rel, name, verdict: 'unmeasurable', reason: '', current: null, contrast: null, failure: null };
  if (format === 'exit-code') {
    out.current = A.exitCode === 0 ? 'passed' : 'failed';
    out.contrast = B ? (B.exitCode === 0 ? 'passed' : 'failed') : null;
    if (A.timedOut || A.exitCode !== 0) return { ...out, reason: A.timedOut ? '보정 실행 시간 상한 초과' : '현재 소스에서 명령이 실패' };
    if (!B || B.timedOut) return { ...out, reason: '대조 실행 시간 상한 초과' };
    if (B.exitCode === 0) return { ...out, verdict: 'undetected', reason: '대조 소스에서도 명령이 성공' };
    return { ...out, verdict: 'unconfirmed', reason: '결과 차이 있음 — 종료 코드만으로는 원인을 가를 수 없음' };
  }
  const a = matchCases(A.files.get(rel), name);
  if (!a.length) return { ...out, reason: '보정 실행에서 케이스를 찾지 못함(이름 · 수집 확인)' };
  if (a.length > 1) return { ...out, reason: '대상 이름 중복 — 어느 케이스인지 가를 수 없음' };
  out.current = a[0].state;
  const aErr = fileLevelError(A, rel);
  if (a[0].state !== 'passed') {
    if (a[0].state !== 'failed') return { ...out, reason: '현재 소스에서 건너뜀' };
    const m = firstLine((a[0].errors[0] || {}).message);
    const snap = /snapshot/i.test(m) ? ' — 스냅샷은 읽기 전용이라 기준 스냅샷이 없거나 다르면 실패합니다' : '';
    return { ...out, reason: `현재 소스에서 실패(격리 환경 불일치 또는 테스트 자체 실패): ${m.slice(0, 160)}${snap}` };
  }
  if (aErr) return { ...out, reason: `보정 실행의 ${aErr}` };
  if (!B) return { ...out, reason: '대조 실행 없음' };
  if (B.timedOut) return { ...out, reason: '대조 실행 시간 상한 초과' };
  const fb = B.files.get(rel);
  const b = matchCases(fb, name);
  if (!b.length) {
    const load = fb && fb.errors.length ? `파일 로딩 실패(${firstLine(fb.errors[0].message)})` : '케이스가 수집되지 않음';
    const hint = kind === 'base' ? ' — 수정 전 코드에 대상이 없다면 지정 변이(mutate)를 쓰십시오' : '';
    return { ...out, reason: `대조 실행에서 ${load}${hint}` };
  }
  if (b.length > 1) return { ...out, reason: '대상 이름 중복 — 어느 케이스인지 가를 수 없음' };
  out.contrast = b[0].state;
  if (b[0].state === 'passed') {
    const bErr = fileLevelError(B, rel);
    if (bErr) return { ...out, reason: `대조 실행의 ${bErr} — 케이스 통과를 믿을 수 없음` };
    return { ...out, verdict: 'undetected', reason: '대조 소스에서도 통과' };
  }
  if (b[0].state !== 'failed') return { ...out, reason: '대조 실행에서 건너뜀' };
  const err = b[0].errors[0] || { name: 'Error', message: '', isAssertion: false, frames: [] };
  const body = bodyCheck(b[0], err, fb.cases, rel, sourceB);
  out.failure = { name: err.name, message: firstLine(err.message), at: body.at ? `${rel}:${body.at.line}:${body.at.column}` : null };
  out.raw = { err: { name: err.name, message: err.message, isAssertion: !!err.isAssertion }, body: { ok: body.ok, why: body.why || '' } };
  return finalize(out, out.raw.err, out.raw.body, expect);
}

function finalize(out, err, body, expect) {
  if (!err.isAssertion) return { ...out, verdict: 'unconfirmed', reason: `결과 차이 있음 — 단언 오류가 아님(${err.name})` };
  if (!body.ok) return { ...out, verdict: 'unconfirmed', reason: `결과 차이 있음 — ${body.why}` };
  if (expect && !String(err.message || '').includes(expect)) return { ...out, verdict: 'unconfirmed', reason: '결과 차이 있음 — 실패 메시지가 --expect 조건과 다름' };
  return { ...out, verdict: 'detected', reason: '본문 단언이 뒤집힘' };
}

// 저장한 실패 근거로 다른 --expect 조건에 대해 다시 판정한다(기록 재사용).
export function rejudge(target, expect) {
  if (!target.failure || !['detected', 'unconfirmed'].includes(target.verdict)) return target;
  if (!target.raw) return target;
  return finalize({ ...target }, target.raw.err, target.raw.body, expect);
}

// --test 를 생략했을 때 «새 케이스» 를 추정한다: 기준 리비전의 테스트 파일에 제목 문자열이 없는 케이스.
export function estimateNew(fileRes, baseText) {
  if (!fileRes) return [];
  if (baseText == null) return fileRes.cases.map((c) => c.fullName);
  return fileRes.cases.filter((c) => c.name && !baseText.includes(c.name)).map((c) => c.fullName);
}

export function summarize(targets) {
  const s = { detected: 0, undetected: 0, unconfirmed: 0, unmeasurable: 0 };
  for (const t of targets) s[t.verdict]++;
  return s;
}

// 대상이 아닌데 뒤집힌 케이스(참고).
export function othersFlipped(A, B, rel, targetNames) {
  const fa = A.files.get(rel);
  const fb = B && B.files.get(rel);
  if (!fa || !fb) return [];
  const out = [];
  for (const c of fa.cases) {
    if (targetNames.has(c.fullName) || c.state !== 'passed') continue;
    const m = fb.cases.filter((x) => x.fullName === c.fullName);
    if (m.length === 1 && m[0].state === 'failed') out.push({ file: rel, name: c.fullName, message: firstLine((m[0].errors[0] || {}).message) });
  }
  return out;
}
