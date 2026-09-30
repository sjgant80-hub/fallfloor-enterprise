import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEPLOYMENTS, STATUSES, CONDITIONS, AI_KINDS, BUILT_BY, ANNEX_III, TIERS, obligations, declare, tierOf, complianceMap } from './comply.mjs';

const LAW = JSON.parse(readFileSync(new URL('./law/law.json', import.meta.url), 'utf8'));
const ASOF = '2026-09-30';
const base = { declared: true, system: 'A page that drafts replies with a local model', ai: 'generative', builtBy: 'self', personalData: true, euOutput: true, deployment: 'local' };
const ids = (m) => m.items.map((i) => i.id);

test('the vocabulary', () => {
  assert.deepEqual(DEPLOYMENTS, ['local', 'cloud', 'saas']);
  assert.deepEqual(STATUSES, ['removed', 'eased', 'yours', 'shared', 'unchanged']);
  assert.deepEqual(AI_KINDS, ['none', 'narrow', 'generative']);
  assert.deepEqual(BUILT_BY, ['self', 'vendor']);
  assert.deepEqual(TIERS, ['prohibited', 'high', 'limited', 'minimal']);
  assert.equal(ANNEX_III.length, 9);
  assert.ok(CONDITIONS.includes('aiSystem') && CONDITIONS.includes('generatesContent') && CONDITIONS.includes('prohibited'));
});

test('the law registry: every duty quoted, linked, dated, and conditioned on known facts', () => {
  assert.ok(LAW.duties.length >= 20);
  for (const d of LAW.duties) {
    assert.ok(/^https:\/\//.test(d.url) && /^\d{4}-\d{2}-\d{2}$/.test(d.checked) && /^\d{4}-\d{2}-\d{2}$/.test(d.from), d.id);
    assert.ok(typeof d.quote === 'string' && d.quote.length > 20, d.id + ' quote');
    for (const c of [].concat(d.appliesIf)) assert.ok(CONDITIONS.includes(c), d.id + ' ' + c);
    for (const dep of DEPLOYMENTS) assert.ok(STATUSES.includes(d.status[dep]), d.id + ' ' + dep);
  }
  assert.deepEqual(LAW.dates.map((d) => d.date), [...LAW.dates.map((d) => d.date)].sort());
});

test('declare: the facts, and every way a declaration is refused', () => {
  const d = declare(base);
  assert.equal(d.ok, true);
  assert.deepEqual(d.flags, { aiSystem: true, personalData: true, interactsWithPublic: false, generatesContent: false, significantDecision: false, highRisk: false, creditScoring: false, prohibited: false, euOutput: true, providerAbroad: false, trainsOnPersonalData: false });
  assert.deepEqual([d.system, d.ai, d.builtBy, d.deployment, d.annexIII, d.prohibited], [base.system, 'generative', 'self', 'local', null, null]);
  const full = declare({ ...base, deployment: 'cloud', providerAbroad: true, interactsWithPublic: true, generatesContent: true, significantDecision: true, trainsOnPersonalData: true, annexIII: 'creditworthiness', prohibited: '5(1)(c)' });
  assert.deepEqual(full.flags, { aiSystem: true, personalData: true, interactsWithPublic: true, generatesContent: true, significantDecision: true, highRisk: true, creditScoring: true, prohibited: true, euOutput: true, providerAbroad: true, trainsOnPersonalData: true });
  assert.deepEqual([declare({ ...base, annexIII: 'employment' }).flags.highRisk, declare({ ...base, annexIII: 'employment' }).flags.creditScoring], [true, false]);
  assert.equal(declare({ ...base, ai: 'none' }).flags.aiSystem, false);
  assert.equal(declare({ ...base, ai: 'narrow' }).flags.aiSystem, true);
  assert.equal(declare({ ...base, annexIII: null, prohibited: null }).ok, true);
  for (const [d2, re] of [
    [null, /a declaration object/], [[], /a declaration object/], [{ ...base, declared: false }, /not declared yet/], [{ ...base, declared: 'yes' }, /not declared yet/],
    [{ ...base, system: '' }, /system: one line/], [{ ...base, ai: 'maybe' }, /ai must be/], [{ ...base, builtBy: 'them' }, /builtBy must be/],
    [{ ...base, deployment: 'edge' }, /deployment must be/], [{ ...base, personalData: 'no' }, /personalData must be true or false/], [{ ...base, euOutput: undefined }, /euOutput must be true or false/],
    [{ ...base, interactsWithPublic: 1 }, /interactsWithPublic must be true or false when given/], [{ ...base, trainsOnPersonalData: 'y' }, /trainsOnPersonalData must be/],
    [{ ...base, annexIII: 'banking' }, /annexIII must be one of/], [{ ...base, prohibited: '5(1)(z)' }, /prohibited must name/], [{ ...base, prohibited: 'x5(1)(a)' }, /prohibited must name/], [{ ...base, prohibited: '5(1)(a)x' }, /prohibited must name/],
    [{ ...base, ai: 'none', interactsWithPublic: true }, /needs an AI system/], [{ ...base, ai: 'none', generatesContent: true }, /needs an AI system/],
    [{ ...base, ai: 'none', annexIII: 'education' }, /needs an AI system/], [{ ...base, ai: 'none', prohibited: '5(1)(a)' }, /needs an AI system/],
    [{ ...base, providerAbroad: true }, /providerAbroad cannot be true/], [{ ...base, personalData: false, trainsOnPersonalData: true }, /trainsOnPersonalData needs personalData/],
  ]) assert.match(declare(d2).why, re);
  assert.equal(declare({ ...base, ai: 'none' }).ok, true);
  assert.equal(declare({ ...base, deployment: 'saas', providerAbroad: true }).ok, true);
});

test('tierOf: prohibited > high > limited > minimal; no AI system, no tier', () => {
  const f = (o) => ({ aiSystem: true, ...o });
  assert.equal(tierOf(f({ prohibited: true, highRisk: true, interactsWithPublic: true })), 'prohibited');
  assert.equal(tierOf(f({ highRisk: true, interactsWithPublic: true })), 'high');
  assert.equal(tierOf(f({ interactsWithPublic: true })), 'limited');
  assert.equal(tierOf(f({ generatesContent: true })), 'limited');
  assert.equal(tierOf(f({})), 'minimal');
  assert.equal(tierOf(f({ prohibited: 'yes', highRisk: 1, interactsWithPublic: 'x' })), 'minimal');
  assert.equal(tierOf({ aiSystem: false, prohibited: true }), null);
  assert.equal(tierOf({ aiSystem: 'true' }), null);
  assert.equal(tierOf(null), null);
  assert.equal(tierOf([]), null);
});

test('obligations: which duties apply on which stack, in force or from when', () => {
  const duty = (o) => ({ id: 'd', regime: 'R', ref: 'Art 1', title: 'T', quote: 'q', url: 'https://x.y', checked: '2026-09-30', from: '2026-09-30', appliesIf: 'personalData', status: { local: 'removed', cloud: 'yours', saas: 'shared' }, note: { local: 'nl', cloud: 'nc', saas: 'ns' }, ...o });
  const o = obligations({ flags: { personalData: true } }, 'cloud', [duty({})], { asOf: '2026-09-30', providerAbroad: false });
  assert.deepEqual(o, { ok: true, deployment: 'cloud', role: 'provider and deployer (the company puts its own AI system into service)', items: [{ id: 'd', regime: 'R', ref: 'Art 1', title: 'T', status: 'yours', inForce: true, from: '2026-09-30', note: 'nc', quote: 'q', url: 'https://x.y', checked: '2026-09-30' }], counts: { removed: 0, eased: 0, yours: 1, shared: 0, unchanged: 0 }, applying: 1 });
  assert.equal(obligations({ flags: { personalData: true } }, 'local', [duty({})], { asOf: '2026-09-29' }).items[0].inForce, false);
  assert.equal(obligations({ flags: { personalData: true } }, 'saas', [duty({ note: 'plain' })], { asOf: '2026-09-30' }).items[0].note, '');
  assert.equal(obligations({ flags: {} }, 'saas', [duty({})], { asOf: '2026-09-30' }).role, 'deployer (the vendor is the provider of its assistant)');
  // conditions: one, all of a list, always; providerAbroad comes from ctx, never the flags
  assert.equal(obligations({ flags: {} }, 'local', [duty({ appliesIf: 'always' })], { asOf: ASOF }).applying, 1);
  assert.equal(obligations({ flags: { aiSystem: true } }, 'local', [duty({ appliesIf: ['aiSystem', 'euOutput'] })], { asOf: ASOF }).applying, 0);
  assert.equal(obligations({ flags: { aiSystem: true, euOutput: true } }, 'local', [duty({ appliesIf: ['aiSystem', 'euOutput'] })], { asOf: ASOF }).applying, 1);
  assert.equal(obligations({ flags: { providerAbroad: true } }, 'local', [duty({ appliesIf: 'providerAbroad' })], { asOf: ASOF }).applying, 0);
  assert.equal(obligations({ flags: {} }, 'local', [duty({ appliesIf: 'providerAbroad' })], { asOf: ASOF, providerAbroad: true }).applying, 1);
  assert.equal(obligations({ flags: { personalData: 'yes' } }, 'local', [duty({})], { asOf: ASOF }).applying, 0);
  // malformed input is refused, never thrown
  for (const [args, re] of [
    [[null, 'local', [], { asOf: ASOF }], /a workload with flags/], [[{ flags: [] }, 'local', [], { asOf: ASOF }], /a workload with flags/],
    [[{ flags: {} }, 'edge', [], { asOf: ASOF }], /deployment must be/], [[{ flags: {} }, 'local', {}, { asOf: ASOF }], /duties must be a list/],
    [[{ flags: {} }, 'local', [], { asOf: '30/09/2026' }], /ctx.asOf/], [[{ flags: {} }, 'local', [], null], /ctx.asOf/],
  ]) assert.match(obligations(...args).why, re);
  for (const bad of [null, { ...duty({}), id: '' }, duty({ appliesIf: 'weather' }), duty({ appliesIf: [] }), duty({ appliesIf: ['personalData', 'weather'] }), duty({ status: { local: 'gone' } }), duty({ status: null }),
    duty({ from: 'soon' }), duty({ from: undefined }), duty({ url: 'http://x.y' }), duty({ url: undefined }), duty({ checked: 'today' }), duty({ checked: undefined })])
    assert.match(obligations({ flags: { personalData: true } }, 'cloud', [bad], { asOf: ASOF }).why, /is malformed/);
});

test('complianceMap: a local generative AI system, built in-house, on personal data, output used in the EU', () => {
  const m = complianceMap(base, LAW, ASOF);
  assert.equal(m.ok, true);
  assert.deepEqual([m.v, m.system, m.asOf, m.lawChecked, m.ai, m.deployment, m.annexIII], [1, base.system, ASOF, LAW.checked, 'generative', 'local', null]);
  assert.deepEqual(m.aiAct, { applies: true, role: 'provider (Art 3(3)) — it builds the AI system and puts it into service under its own name', tier: 'minimal' });
  assert.equal(m.gdpr.applies, true);
  assert.deepEqual(ids(m), ['aia-scope', 'aia-provider', 'aia-4', 'aia-99', 'gdpr-5', 'gdpr-6', 'gdpr-25', 'gdpr-28', 'gdpr-32', 'gdpr-35', 'ico-ai']);
  assert.equal(m.items.find((i) => i.id === 'gdpr-28').status, 'removed');
  assert.deepEqual(m.counts, { removed: 1, eased: 2, yours: 2, shared: 0, unchanged: 6 });
  assert.deepEqual([m.applying, m.inForce, m.upcoming], [11, 11, []]);
  assert.deepEqual(m.blocking, []);
});

test('complianceMap: tiers, roles, scope and the things that block shipping', () => {
  const none = complianceMap({ ...base, ai: 'none', personalData: false }, LAW, ASOF);
  assert.deepEqual([none.aiAct.applies, none.gdpr.applies, none.applying], [false, false, 0]);
  assert.match(none.aiAct.why, /No AI system \(Art 3\(1\)\)/);
  assert.match(none.gdpr.why, /No personal data/);
  const outside = complianceMap({ ...base, euOutput: false, interactsWithPublic: true }, LAW, ASOF);
  assert.deepEqual([outside.aiAct.applies, outside.aiAct.tier], [false, 'limited']);
  assert.match(outside.aiAct.why, /outside the AI Act/);
  assert.equal(ids(outside).some((i) => i.startsWith('aia-scope')), false);
  const chat = complianceMap({ ...base, interactsWithPublic: true, generatesContent: true }, LAW, ASOF);
  assert.equal(chat.aiAct.tier, 'limited');
  assert.ok(ids(chat).includes('aia-50') && ids(chat).includes('aia-50-2'));
  const vendor = complianceMap({ ...base, builtBy: 'vendor', deployment: 'saas', providerAbroad: true }, LAW, ASOF);
  assert.match(vendor.aiAct.role, /^deployer \(Art 3\(4\)\)/);
  assert.ok(ids(vendor).includes('gdpr-44'));
  const credit = complianceMap({ ...base, annexIII: 'creditworthiness', significantDecision: true }, LAW, ASOF);
  assert.equal(credit.aiAct.tier, 'high');
  assert.deepEqual(credit.upcoming, [{ id: 'aia-highrisk', from: '2027-12-02' }, { id: 'aia-26', from: '2027-12-02' }, { id: 'aia-27', from: '2027-12-02' }]);
  assert.equal(credit.inForce, credit.applying - 3);
  const banned = complianceMap({ ...base, prohibited: '5(1)(c)' }, LAW, ASOF);
  assert.equal(banned.aiAct.tier, 'prohibited');
  assert.deepEqual(banned.blocking, ['A prohibited AI practice (Art 5(1)(c)): it may not be placed on the market, put into service or used in the EU.']);
  assert.deepEqual(complianceMap({ ...base, prohibited: '5(1)(c)', euOutput: false }, LAW, ASOF).blocking, []);
  // refusals pass through, never throw
  assert.match(complianceMap({ ...base, declared: false }, LAW, ASOF).why, /not declared yet/);
  for (const law of [null, [], { ...LAW, duties: {} }, { ...LAW, dates: null }, { ...LAW, checked: 'x' }]) assert.match(complianceMap(base, law, ASOF).why, /law must carry/);
  assert.match(complianceMap(base, LAW, '2026/09/30').why, /asOf must be a date/);
  assert.match(complianceMap(base, { ...LAW, duties: [{ id: 'bad' }] }, ASOF).why, /is malformed/);
});

test('fuzz: garbage in, a refusal out — never a throw', () => {
  const junk = [undefined, null, 0, -1, NaN, '', 'x', [], {}, [1, 2], { declared: true }, () => 1, Symbol('s')];
  for (const a of junk) for (const b of junk) assert.doesNotThrow(() => { declare(a); tierOf(a); complianceMap(a, b, '2026-09-30'); complianceMap(base, a, b); obligations(a, b, a, b); });
});
