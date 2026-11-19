import { afterEach, beforeEach, describe, expect, it } from 'vitest'
expect.extend({ toBeFoo(r) { return { pass: r === 'foo', message: () => `expected ${r} to be foo` } } })
function helperCheck(v) { expect(v).toBe(1) }
describe('본문', () => {
  it('본문 단언 실패', () => { expect(1).toBe(2) })
  it('헬퍼 단언 실패', () => { helperCheck(2) })
  it('확장 단언 실패', () => { expect('bar').toBeFoo() })
  it('본문 TypeError', () => { const o = undefined; expect(o.x).toBe(1) })
  it('비동기 단언 실패', async () => { await Promise.resolve(); expect(3).toBe(4) })
  it('통과', () => { expect(1).toBe(1) })
})
describe('준비 단계 예외', () => {
  beforeEach(() => { throw new Error('setup boom') })
  it('대상', () => { expect(1).toBe(1) })
})
describe('준비 단계 단언', () => {
  beforeEach(() => { expect(1).toBe(2) })
  it('대상', () => { expect(1).toBe(1) })
})
describe('시간 초과', () => {
  it('느림', async () => { await new Promise((r) => setTimeout(r, 300)) }, 50)
})
describe('동적', () => {
  for (const n of [1, 1]) it(`같은 이름 ${n}`, () => { expect(n).toBe(1) })
})
