import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASES, SIDES, sourced, exVat, toGbp, apiCostPerItem, coreSecondsPerItem, capacity, tco, plan, seatShareBreakEven,
  DEPLOYMENTS, STATUSES, obligations, DECISIONS, gateCase, board, verifyReceipt,
} from './kernel.mjs';

const J = (f) => JSON.parse(readFileSync(new URL('./' + f, import.meta.url), 'utf8'));
const COMPANY = J('data/company.json'), PRICES = J('sources/prices.json'), EVIDENCE = J('evidence/fallfloor.json'), LAW = J('sources/law.json');

test('sourced: every figure says where it came from', () => {
  assert.deepEqual(BASES, ['list-price', 'measured', 'estimate', 'assumption']);
  assert.deepEqual(SIDES, ['local', 'cloud']);
  assert.deepEqual(sourced({ basis: 'list-price', source: 'https://x.example/p', checked: '2026-09-29' }), { ok: true });
  assert.match(sourced({ basis: 'list-price', source: 'http://x.example/p', checked: '2026-09-29' }).why, /https source/);
  assert.equal(sourced({ basis: 'list-price', source: 'https://x.example/p', checked: '29 Sep' }).ok, false);
  assert.equal(sourced({ basis: 'list-price', checked: '2026-09-29' }).ok, false);
  assert.equal(sourced({ basis: 'list-price', source: 'https://x y', checked: '2026-09-29' }).ok, false);
  assert.deepEqual(sourced({ basis: 'measured', source: 'receipt:floor-2026-09-29' }), { ok: true });
  assert.match(sourced({ basis: 'measured' }).why, /names where/);
  assert.deepEqual(sourced({ basis: 'estimate', why: 'because' }), { ok: true });
  assert.equal(sourced({ basis: 'assumption', why: 'because' }).ok, true);
  assert.equal(sourced({ basis: 'assumption', why: '' }).why, 'an assumption says why, in words');
  assert.equal(sourced({ basis: 'estimate' }).why, 'an estimate says why, in words');
  assert.match(sourced({ basis: 'guess', why: 'x' }).why, /basis must be one of list-price, measured, estimate, assumption/);
  assert.equal(sourced(null).ok, false);
});

test('money: VAT out, dollars to pounds, a token bill per item', () => {
  assert.equal(exVat(120, 'included', 0.2), 100);
  assert.equal(exVat(120, 'excluded', 0.2), 120);
  assert.equal(exVat(120, 'not stated', 0.2), 120);
  assert.equal(exVat(0, 'included', 0), 0);
  assert.equal(exVat(120, 'maybe', 0.2), null);
  assert.equal(exVat(-1, 'excluded', 0.2), null);
  assert.equal(exVat(1, 'excluded', -0.1), null);
  assert.equal(exVat('1', 'excluded', 0.2), null);
  assert.equal(exVat(1, 'excluded', 'x'), null);
  assert.equal(toGbp(10, 'GBP', 0.5), 10);
  assert.equal(toGbp(10, 'USD', 0.5), 5);
  assert.equal(toGbp(10, 'EUR', 0.5), null);
  assert.equal(toGbp(10, 'USD', 0), null);
  assert.equal(toGbp('10', 'USD', 0.5), null);
  assert.equal(toGbp(10, 'USD', 'x'), null);
  assert.equal(apiCostPerItem(1e6, 1e6, { inPerM: 1, outPerM: 3 }, 0.5), 2);
  assert.equal(apiCostPerItem(0, 0, { inPerM: 0, outPerM: 0 }, 0.5), 0);
  assert.equal(apiCostPerItem(-1, 0, { inPerM: 1, outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(0, -1, { inPerM: 1, outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem('1', 0, { inPerM: 1, outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, '0', { inPerM: 1, outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: -1, outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: 1, outPerM: -1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: 'x', outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: 1, outPerM: 'x' }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, null, 0.5), null);
  assert.equal(apiCostPerItem(1, 0, { inPerM: 1, outPerM: 'x' }, 0.5), null);
  assert.equal(apiCostPerItem(0, 1, { inPerM: 'x', outPerM: 1 }, 0.5), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: 1, outPerM: 1 }, 0), null);
  assert.equal(apiCostPerItem(1, 1, { inPerM: 1, outPerM: 1 }, 'x'), null);
  assert.equal(apiCostPerItem(1e6, 0, { inPerM: 2, outPerM: 0 }, 1e-9), 2e-9);
});

const CORE = { bandwidthGBs: 1200, weightsGB: 18, efficiency: 0.3, prefillTokPerSec: 300 };
test('coreSecondsPerItem: read the prompt, then generate at a bandwidth-bound rate', () => {
  const c = coreSecondsPerItem(600, 40, CORE);
  assert.equal(c.decodeTokPerSec, 20);
  assert.equal(c.seconds, 4);
  assert.equal(coreSecondsPerItem(0, 0, CORE).seconds, 0);
  assert.equal(coreSecondsPerItem(600, 40, { ...CORE, efficiency: 1 }).decodeTokPerSec, 1200 / 18);
  assert.equal(coreSecondsPerItem(600, 40, { ...CORE, efficiency: 1.01 }), null);
  for (const k of ['bandwidthGBs', 'weightsGB', 'efficiency', 'prefillTokPerSec']) { assert.equal(coreSecondsPerItem(1, 1, { ...CORE, [k]: 0 }), null, k); assert.equal(coreSecondsPerItem(1, 1, { ...CORE, [k]: 'x' }), null, k); }
  assert.equal(coreSecondsPerItem(-1, 1, CORE), null);
  assert.equal(coreSecondsPerItem(1, -1, CORE), null);
  assert.equal(coreSecondsPerItem('1', 1, CORE), null);
  assert.equal(coreSecondsPerItem(1, '1', CORE), null);
  assert.equal(coreSecondsPerItem(1, 1, null), null);
});

const FLOOR = { laptops: 100, nodeShare: 0.5, hoursPerDay: 4, daysPerMonth: 20 };
const CAPCORE = { ...CORE, hoursPerMonth: 100, targetUtil: 0.5, spare: 1 };
const WL = [{ id: 'a', tier: 'laptop', perMonth: 3600, secondsPerItem: 10 }, { id: 'b', tier: 'core', perMonth: 900, tokensIn: 600, tokensOut: 40 }];
test('capacity: laptop hours from measured seconds; core nodes N + spare; growth by year', () => {
  const c = capacity({ workloads: WL, floor: FLOOR, core: CAPCORE, growth: 1, years: 2 });
  assert.equal(c.laptopHoursAvailable, 4000);
  assert.equal(c.decodeTokPerSec, 20);
  assert.deepEqual(c.perWorkload, [{ id: 'a', tier: 'laptop', secondsPerItem: 10, perMonth: 3600 }, { id: 'b', tier: 'core', secondsPerItem: 4, perMonth: 900 }]);
  assert.deepEqual(c.perYear[0], { year: 1, laptopHours: 10, laptopUtil: 0.003, coreHours: 1, coreNodes: 2, floorOverloaded: false });
  assert.deepEqual(c.perYear[1], { year: 2, laptopHours: 20, laptopUtil: 0.005, coreHours: 2, coreNodes: 2, floorOverloaded: false });
  const big = capacity({ workloads: [{ id: 'b', tier: 'core', perMonth: 45000, tokensIn: 600, tokensOut: 40 }], floor: FLOOR, core: CAPCORE, growth: 0, years: 1 });
  assert.deepEqual([big.perYear[0].coreHours, big.perYear[0].coreNodes], [50, 2]);
  assert.equal(capacity({ workloads: [{ id: 'b', tier: 'core', perMonth: 45001, tokensIn: 600, tokensOut: 40 }], floor: FLOOR, core: CAPCORE, growth: 0, years: 1 }).perYear[0].coreNodes, 3);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1, secondsPerItem: 1 }], floor: FLOOR, core: { ...CAPCORE, spare: 0 }, growth: 0, years: 1 }).perYear[0].coreNodes, 0);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1, secondsPerItem: 1 }], floor: FLOOR, core: { ...CAPCORE, spare: 2 }, growth: 0, years: 1 }).perYear[0].coreNodes, 0);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 5, secondsPerItem: 0 }], floor: FLOOR, core: CAPCORE, growth: 0, years: 1 }).perYear[0].laptopHours, 0);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 0, secondsPerItem: 5 }], floor: { ...FLOOR, laptops: 0 }, core: CAPCORE, growth: 0, years: 1 }).perYear[0].laptopUtil, null);
  const over = capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1440001, secondsPerItem: 10 }], floor: FLOOR, core: CAPCORE, growth: 0, years: 1 });
  assert.equal(over.perYear[0].floorOverloaded, true);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1440000, secondsPerItem: 10 }], floor: FLOOR, core: CAPCORE, growth: 0, years: 1 }).perYear[0].floorOverloaded, false);
  const none = capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1, secondsPerItem: 36 }], floor: { ...FLOOR, laptops: 0 }, core: CAPCORE, growth: 0, years: 1 });
  assert.deepEqual([none.perYear[0].laptopUtil, none.perYear[0].floorOverloaded], [null, true]);
  assert.equal(capacity({ workloads: [{ id: 'a', tier: 'laptop', perMonth: 0, secondsPerItem: 36 }], floor: { ...FLOOR, laptops: 0 }, core: CAPCORE, growth: 0, years: 1 }).perYear[0].floorOverloaded, false);
  for (const [bad, re] of [
    [{ workloads: [] }, /needs workloads/], [{ workloads: [{ id: 'a', tier: 'cloud', perMonth: 1 }] }, /tier/], [{ workloads: [{ id: 'a', tier: 'laptop', perMonth: -1, secondsPerItem: 1 }] }, /perMonth/],
    [{ workloads: [{ tier: 'laptop', perMonth: 1, secondsPerItem: 1 }] }, /id/], [{ workloads: [null] }, /each workload/],
    [{ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1 }] }, /measured seconds/], [{ workloads: [{ id: 'a', tier: 'laptop', perMonth: 1, secondsPerItem: -1 }] }, /measured seconds/],
    [{ workloads: [{ id: 'b', tier: 'core', perMonth: 1, tokensIn: 1 }] }, /tokensIn, tokensOut/],
    [{ floor: { ...FLOOR, nodeShare: 1.1 } }, /floor/], [{ floor: { ...FLOOR, laptops: -1 } }, /floor/], [{ floor: { ...FLOOR, hoursPerDay: 'x' } }, /floor/], [{ floor: null }, /floor/],
    [{ core: { ...CAPCORE, hoursPerMonth: 0 } }, /core/], [{ core: { ...CAPCORE, targetUtil: 0 } }, /core/], [{ core: { ...CAPCORE, targetUtil: 1.01 } }, /core/], [{ core: { ...CAPCORE, spare: -1 } }, /core/], [{ core: { ...CAPCORE, spare: 0.5 } }, /core/], [{ core: null }, /core/], [{ core: { ...CAPCORE, hoursPerMonth: 'x' } }, /core/], [{ core: { ...CAPCORE, targetUtil: 'x' } }, /core/],
    [{ growth: -0.51 }, /growth/], [{ growth: 5.01 }, /growth/], [{ growth: 'x' }, /growth/], [{ years: 0 }, /years/], [{ years: 11 }, /years/], [{ years: 1.5 }, /years/],
  ]) assert.match(capacity({ workloads: WL, floor: FLOOR, core: CAPCORE, growth: 0, years: 1, ...bad }).why, re, JSON.stringify(bad).slice(0, 60));
  assert.equal(capacity({ workloads: WL, floor: FLOOR, core: { ...CAPCORE, targetUtil: 1 }, growth: -0.5, years: 10 }).ok, true);
  assert.equal(capacity({ workloads: WL, floor: { ...FLOOR, nodeShare: 1 }, core: CAPCORE, growth: 5, years: 1 }).ok, true);
  assert.equal(capacity(null).ok, false);
});

const L = (id, side, basis, perYear, extra = {}) => ({ id, side, label: id, basis, perYear, ...(basis === 'list-price' ? { source: 'https://x.example', checked: '2026-09-29' } : basis === 'measured' ? { source: 'receipt' } : { why: 'w' }), ...extra });
test('tco: sums by side and year, cumulative, break-even, and what share rests on estimates', () => {
  const t = tco([L('seats', 'cloud', 'list-price', [100, 100, 100]), L('staff', 'local', 'estimate', [150, 50, 50]), L('power', 'local', 'measured', [0, 10, 10]), L('api', 'cloud', 'assumption', [0, 0, 100])], 3);
  assert.deepEqual(t.perYear, [{ year: 1, local: 150, cloud: 100 }, { year: 2, local: 60, cloud: 100 }, { year: 3, local: 60, cloud: 200 }]);
  assert.deepEqual(t.cumulative, [{ year: 1, local: 150, cloud: 100 }, { year: 2, local: 210, cloud: 200 }, { year: 3, local: 270, cloud: 400 }]);
  assert.deepEqual(t.total, { local: 270, cloud: 400, difference: 130 });
  assert.equal(t.breakEvenYear, 3);
  assert.deepEqual(t.basisShare.local, { 'list-price': 0, measured: 0.074, estimate: 0.926, assumption: 0 });
  assert.deepEqual(t.basisShare.cloud, { 'list-price': 0.75, measured: 0, estimate: 0, assumption: 0.25 });
  assert.deepEqual(t.lines[1], { id: 'staff', side: 'local', label: 'staff', basis: 'estimate', total: 250, perYear: [150, 50, 50] });
  assert.equal(tco([L('a', 'local', 'estimate', [1]), L('b', 'cloud', 'estimate', [1])], 1).breakEvenYear, 1);
  assert.equal(tco([L('a', 'local', 'estimate', [2]), L('b', 'cloud', 'estimate', [1])], 1).breakEvenYear, null);
  assert.deepEqual(tco([L('a', 'local', 'estimate', [0])], 1).basisShare.local, { 'list-price': 0, measured: 0, estimate: 0, assumption: 0 });
  for (const [lines, re] of [
    [[L('a', 'local', 'estimate', [1]), L('a', 'cloud', 'estimate', [1])], /unique id/], [[{ ...L('a', 'local', 'estimate', [1]), id: '' }], /unique id/], [[null], /unique id/],
    [[L('a', 'both', 'estimate', [1])], /side/], [[{ ...L('a', 'local', 'estimate', [1]), label: '' }], /label/],
    [[L('a', 'local', 'guess', [1])], /basis/], [[{ ...L('a', 'local', 'estimate', [1]), why: '' }], /says why/],
    [[L('a', 'local', 'estimate', [1, 2])], /hold 1 amounts/], [[L('a', 'local', 'estimate', [-1])], /≥ 0/], [[L('a', 'local', 'estimate', ['1'])], /≥ 0/], [[L('a', 'local', 'estimate', 'x')], /perYear/],
  ]) assert.match(tco(lines, 1).why, re);
  for (const [lines, years] of [[[], 1], ['x', 1], [[L('a', 'local', 'estimate', [1])], 0], [[L('a', 'local', 'estimate', [1])], 1.5], [null, 1]]) assert.equal(tco(lines, years).why, 'tco(lines, years)');
});

test('plan: the modelled bank, end to end, from the committed inputs', () => {
  const p = plan({ company: COMPANY, prices: PRICES, evidence: EVIDENCE });
  assert.equal(p.ok, true);
  assert.equal(p.seats, 1000);
  assert.equal(p.apiModel, 'OpenAI gpt-5-mini');
  assert.deepEqual(p.nodesBought, [7, 1, 1, 2, 8]);
  assert.deepEqual(p.capacity.perYear.map((y) => y.coreNodes), [7, 8, 9, 11, 12]);
  assert.equal(p.capacity.decodeTokPerSec, 23.33);
  assert.deepEqual(p.tco.total, { local: 2073772.31, cloud: 2638201.7, difference: 564429.4 });
  assert.equal(p.tco.breakEvenYear, 1);
  const line = (id) => p.tco.lines.find((l) => l.id === id);
  assert.equal(line('cloud-seats').total, 1386000);
  assert.equal(line('cloud-seats').perYear[0], 277200);
  assert.equal(line('cloud-seats').basis, 'list-price');
  assert.equal(line('local-core-nodes').perYear[0], 32077.5);
  assert.equal(line('local-core-nodes').basis, 'list-price');
  assert.equal(line('cloud-api-support-triage').basis, 'list-price');
  assert.equal(line('cloud-api-support-replies').basis, 'estimate');
  assert.equal(line('cloud-api-knowledge-assistant'), undefined);
  assert.equal(line('local-laptops').total, 0);
  assert.equal(line('local-models').total, 0);
  assert.deepEqual(p.warnings, []);
});

test('plan: choices change the answer the way they should', () => {
  const base = { company: COMPANY, prices: PRICES, evidence: EVIDENCE };
  const half = plan({ ...base, choices: { seatShare: 0.5 } });
  assert.equal(half.seats, 500);
  assert.equal(half.tco.lines.find((l) => l.id === 'cloud-seats').total, 693000);
  const team = plan({ ...base, choices: { seat: 'claude-team' } });
  assert.deepEqual(team.warnings, ['Claude Team (standard seat) is sold for up to 150 seats; this company needs 1000.']);
  assert.equal(team.tco.lines.find((l) => l.id === 'cloud-seats').perYear[0], 180000);
  const ent = plan({ ...base, choices: { seat: 'claude-enterprise' } });
  assert.ok(ent.tco.lines.find((l) => l.id === 'cloud-api-knowledge-assistant'));
  assert.equal(ent.tco.lines.find((l) => l.id === 'cloud-seats').perYear[0], 1000 * 20 * 0.75396 * 12);
  assert.equal(plan({ ...base, choices: { seatShare: 0 } }).seats, 0);
  assert.deepEqual(plan({ ...base, choices: { seat: 'claude-team', seatShare: 0.15 } }).warnings, []);
  assert.equal(plan({ ...base, choices: { seat: 'claude-team', seatShare: 0.151 } }).warnings.length, 1);
  assert.equal(plan({ ...base, choices: { seatShare: 1 } }).ok, true);
  for (const [ch, re] of [[{ seat: 'nope' }, /unknown seat/], [{ apiModel: 'nope' }, /unknown API/], [{ seatShare: 1.1 }, /seatShare/], [{ seatShare: -0.1 }, /seatShare/], [{ seatShare: 'x' }, /seatShare/]])
    assert.match(plan({ ...base, choices: ch }).why, re);
});

test('seatShareBreakEven: the seat coverage above which local-first costs less', () => {
  const base = { company: COMPANY, prices: PRICES, evidence: EVIDENCE };
  const b = seatShareBreakEven(base);
  assert.deepEqual(b, { ok: true, share: 0.593, localAlwaysCheaper: false, cloudAlwaysCheaper: false });
  const at = (s) => plan({ ...base, choices: { seatShare: s } }).tco.total;
  assert.ok(at(0.6).local < at(0.6).cloud);
  assert.ok(at(0.59).local > at(0.59).cloud);
  const cheapLocal = seatShareBreakEven({ ...base, company: { ...COMPANY, staff: { ...COMPANY.staff, local: [] } } });
  assert.equal(cheapLocal.localAlwaysCheaper, true);
  assert.ok(cheapLocal.share <= 0);
  const pricey = seatShareBreakEven({ ...base, prices: { ...PRICES, coreNode: { ...PRICES.coreNode, price: 5e7 } } });
  assert.equal(pricey.cloudAlwaysCheaper, true);
  const free = seatShareBreakEven({ ...base, prices: { ...PRICES, seats: PRICES.seats.map((s) => ({ ...s, price: 0 })) } });
  assert.deepEqual(free, { ok: true, share: null, why: 'seats add nothing to the corporate side' });
  assert.equal(seatShareBreakEven({ ...base, choices: { seatShare: 0.2 } }).share, 0.593);
  // exact ties: a one-person company whose only costs are one seat (cloud) and one compliance day (local)
  const tiny = (localDays) => ({ ...base, company: { ...COMPANY, profile: { ...COMPANY.profile, knowledgeWorkers: 1 }, growth: { value: 0 }, workloads: [{ ...COMPANY.workloads[2], perMonth: 0 }],
    staff: { onCost: COMPANY.staff.onCost, local: [], cloud: [] }, compliance: { dayRate: { value: 1386 }, local: { daysYear1: localDays, daysPerYear: 0, why: 'w' }, cloud: { daysYear1: 0, daysPerYear: 0, why: 'w' } } } });
  assert.deepEqual(seatShareBreakEven(tiny(0)), { ok: true, share: 0, localAlwaysCheaper: true, cloudAlwaysCheaper: false });
  assert.deepEqual(seatShareBreakEven(tiny(1)), { ok: true, share: 1, localAlwaysCheaper: false, cloudAlwaysCheaper: false });
  assert.match(seatShareBreakEven({ ...base, choices: { seat: 'nope' } }).why, /unknown seat/);
  assert.match(seatShareBreakEven({ company: COMPANY, prices: PRICES }).why, /plan needs/);
  assert.equal(seatShareBreakEven(null).why, 'seatShareBreakEven needs the same input as plan');
});

test('plan: refuses what it cannot stand behind', () => {
  const base = { company: COMPANY, prices: PRICES, evidence: EVIDENCE };
  const C = (patch) => ({ ...base, company: { ...COMPANY, ...patch } });
  const P = (patch) => ({ ...base, prices: { ...PRICES, ...patch } });
  assert.match(plan({ ...base, evidence: { ...EVIDENCE, hr: {} } }).why, /hr-routing: its evidence \(hr\) is missing/);
  assert.match(plan(C({ workloads: [{ ...COMPANY.workloads[0], tokens: 'guess' }] })).why, /measured or estimate/);
  assert.match(plan(C({ workloads: [{ tokens: 'estimate' }] })).why, /needs an id/);
  assert.match(plan(C({ workloads: 'x' })).why, /workloads/);
  assert.match(plan(P({ fx: null })).why, /fx and vatRate/);
  assert.match(plan(P({ vatRate: {} })).why, /fx and vatRate/);
  assert.match(plan(P({ coreNode: null })).why, /core node/);
  assert.match(plan(C({ core: { ...COMPANY.core, model: null } })).why, /core node/);
  assert.match(plan(C({ profile: { ...COMPANY.profile, knowledgeWorkers: 'x' } })).why, /knowledgeWorkers/);
  assert.match(plan(P({ seats: [{ ...PRICES.seats[0], currency: 'EUR' }] })).why, /seat price/);
  assert.match(plan(C({ staff: { ...COMPANY.staff, onCost: { value: 0.9 } } })).why, /staff and salaries/);
  assert.match(plan(C({ staff: { ...COMPANY.staff, local: [{ role: 'x', fte: 1, soc: '9999' }] } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...COMPANY.staff, cloud: [{ role: 'x', fte: -1, soc: '2134' }] } })).why, /cloud staff/);
  assert.match(plan(P({ salaries: {} })).why, /staff and salaries/);
  assert.match(plan(C({ compliance: { ...COMPANY.compliance, dayRate: { value: -1 } } })).why, /compliance/);
  assert.match(plan(C({ compliance: { ...COMPANY.compliance, local: { daysYear1: 1 } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...COMPANY.compliance, cloud: { daysYear1: -1, daysPerYear: 1 } } })).why, /cloud compliance days/);
  assert.match(plan(P({ coreNode: { ...PRICES.coreNode, currency: 'EUR' } })).why, /core node price/);
  assert.match(plan(C({ core: { ...COMPANY.core, lifeYears: { value: 0 } } })).why, /lifeYears/);
  assert.match(plan(P({ electricity: {} })).why, /electricity/);
  assert.match(plan(P({ coreNode: { ...PRICES.coreNode, maxWatts: 'x' } })).why, /node power/);
  assert.match(plan(C({ floor: { ...COMPANY.floor, nodeShare: { value: 2 } } })).why, /floor/);
  assert.match(plan(C({ workloads: [{ ...COMPANY.workloads[3], tokensIn: undefined }] })).why, /tokensIn/);
  const need = 'plan needs company, prices and evidence';
  assert.equal(plan(null).why, need);
  assert.equal(plan({ company: COMPANY, prices: PRICES }).why, need);
  assert.equal(plan({ prices: PRICES, evidence: EVIDENCE }).why, need);
  assert.equal(plan({ company: COMPANY, evidence: EVIDENCE }).why, need);
  for (const k of ['tokensIn', 'tokensOut', 'laptopSecondsPerItem']) assert.match(plan({ ...base, evidence: { ...EVIDENCE, hr: { ...EVIDENCE.hr, [k]: undefined } } }).why, /hr-routing: its evidence/, k);
  const S = COMPANY.staff;
  assert.match(plan(C({ staff: null })).why, /staff and salaries/);
  assert.match(plan(C({ staff: { ...S, onCost: null } })).why, /staff and salaries/);
  assert.match(plan(C({ staff: { ...S, onCost: { value: 'x' } } })).why, /staff and salaries/);
  assert.equal(plan(C({ staff: { ...S, onCost: { value: 1 } } })).ok, true);
  assert.match(plan(P({ salaries: { roles: { ...PRICES.salaries.roles, 2134: { median: 'x' } } } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, local: [null] } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, local: [{ role: 'x', fte: 'x', soc: '2134' }] } })).why, /local staff/);
  const zeroFte = plan(C({ staff: { ...S, local: [{ role: 'Nobody', fte: 0, soc: '2134' }] } }));
  assert.equal(zeroFte.tco.lines.find((l) => l.id === 'local-staff').total, 0);
  const noCloudTeam = plan(C({ staff: { onCost: S.onCost, local: S.local } }));
  assert.equal(noCloudTeam.tco.lines.find((l) => l.id === 'cloud-staff').total, 0);
  assert.match(noCloudTeam.tco.lines.find((l) => l.id === 'cloud-staff').label, /^0 FTE \(\)$/);
  const CP = COMPANY.compliance;
  assert.match(plan(C({ compliance: null })).why, /^compliance$/);
  assert.match(plan(C({ compliance: { ...CP, dayRate: null } })).why, /^compliance$/);
  assert.match(plan(C({ compliance: { ...CP, dayRate: { value: 'x' } } })).why, /^compliance$/);
  assert.equal(plan(C({ compliance: { ...CP, dayRate: { value: 0 } } })).tco.lines.find((l) => l.id === 'local-compliance').total, 0);
  assert.match(plan(C({ compliance: { ...CP, local: null } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 'x', daysPerYear: 1 } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 1, daysPerYear: 'x' } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 1, daysPerYear: -1 } } })).why, /local compliance days/);
  const zeroDays = plan(C({ compliance: { ...CP, local: { daysYear1: 0, daysPerYear: 0, why: 'w' } } }));
  assert.equal(zeroDays.tco.lines.find((l) => l.id === 'local-compliance').total, 0);
  assert.match(plan(C({ core: { ...COMPANY.core, lifeYears: null } })).why, /lifeYears/);
  assert.match(plan(C({ core: { ...COMPANY.core, lifeYears: { value: 1.5 } } })).why, /lifeYears/);
  assert.deepEqual(plan(C({ core: { ...COMPANY.core, lifeYears: { value: 1 } } })).nodesBought, [7, 8, 9, 11, 12]);
  assert.match(plan(P({ electricity: null })).why, /electricity/);
  assert.match(plan(P({ laptopPower: null })).why, /electricity/);
  assert.match(plan(P({ laptopPower: { wattsHigh: 'x' } })).why, /electricity/);
});

const WK = { flags: { personalData: true, interactsWithPublic: true, significantDecision: false, highRisk: false, euOutput: true } };
test('obligations: which duties apply, on which stack, and what the stack does to them', () => {
  const loc = obligations(WK, 'local', LAW.duties, { asOf: '2026-09-29', providerAbroad: true });
  const cl = obligations(WK, 'cloud', LAW.duties, { asOf: '2026-09-29', providerAbroad: true });
  const saas = obligations(WK, 'saas', LAW.duties, { asOf: '2026-09-29', providerAbroad: true });
  const st = (o, id) => o.items.find((i) => i.id === id).status;
  assert.equal(st(loc, 'gdpr-28'), 'removed');
  assert.equal(st(loc, 'gdpr-44'), 'removed');
  assert.equal(st(cl, 'gdpr-44'), 'shared');
  assert.equal(st(loc, 'gdpr-32'), 'yours');
  assert.equal(st(saas, 'aia-50'), 'shared');
  assert.equal(st(loc, 'aia-50'), 'yours');
  assert.deepEqual(loc.counts, { removed: 2, eased: 2, yours: 3, shared: 0, unchanged: 6 });
  assert.equal(loc.applying, 13);
  assert.match(loc.role, /^provider and deployer/);
  assert.match(saas.role, /^deployer/);
  assert.equal(loc.items.find((i) => i.id === 'aia-50').inForce, true);
  assert.equal(obligations(WK, 'local', LAW.duties, { asOf: '2026-08-01' }).items.find((i) => i.id === 'aia-50').inForce, false);
  assert.equal(obligations(WK, 'local', LAW.duties, { asOf: '2026-08-02' }).items.find((i) => i.id === 'aia-50').inForce, true);
  assert.equal(obligations(WK, 'local', LAW.duties, { asOf: '2026-09-29' }).items.some((i) => i.id === 'gdpr-44'), false);
  const hr = obligations({ flags: { personalData: true, highRisk: true, creditScoring: true } }, 'local', LAW.duties, { asOf: '2026-09-29' });
  assert.equal(hr.items.find((i) => i.id === 'aia-highrisk').inForce, false);
  assert.equal(hr.items.find((i) => i.id === 'aia-highrisk').from, '2027-12-02');
  assert.ok(hr.items.some((i) => i.id === 'aia-27'));
  assert.equal(obligations({ flags: {} }, 'local', LAW.duties, { asOf: '2026-09-29' }).applying, 2);
  assert.deepEqual(DEPLOYMENTS, ['local', 'cloud', 'saas']);
  assert.deepEqual(STATUSES, ['removed', 'eased', 'yours', 'shared', 'unchanged']);
  const d0 = LAW.duties[0];
  for (const [bad, re] of [[{ ...d0, appliesIf: 'sometimes' }, /malformed/], [{ ...d0, status: { local: 'gone' } }, /malformed/], [{ ...d0, from: '2026' }, /malformed/], [{ ...d0, url: 'http://x' }, /malformed/], [{ ...d0, checked: 'x' }, /malformed/], [{ ...d0, id: '' }, /malformed/], [{ ...d0, status: null }, /malformed/], [null, /malformed/]])
    assert.match(obligations(WK, 'local', [bad], { asOf: '2026-09-29' }).why, re);
  assert.equal(obligations(WK, 'local', [{ ...d0, note: 'x' }], { asOf: '2026-09-29' }).items[0].note, '');
  assert.match(obligations(WK, 'edge', LAW.duties, { asOf: '2026-09-29' }).why, /deployment/);
  assert.match(obligations(WK, 'local', 'x', { asOf: '2026-09-29' }).why, /list/);
  assert.match(obligations(WK, 'local', LAW.duties, { asOf: 'today' }).why, /asOf/);
  assert.match(obligations(WK, 'local', LAW.duties, null).why, /asOf/);
  assert.match(obligations({}, 'local', LAW.duties, { asOf: '2026-09-29' }).why, /flags/);
});

const POLICY = COMPANY.policy;
test('gateCase: each decision built from the receipted evidence and the published policy', () => {
  const g = (id, ev = EVIDENCE, pol = POLICY) => gateCase(id, ev, pol);
  const un = g('support-unsupervised').case;
  assert.deepEqual(un.positive, [{ id: 'end-to-end accuracy', support: 0.39, weight: 3 }, { id: 'nothing lost', support: 1, weight: 1 }, { id: 'receipts verified', support: 1, weight: 1 }]);
  assert.deepEqual(un.negative.observed, { score: 1, class: 'observed' });
  assert.deepEqual(un.negative.irreversibility, { score: 0.5, class: 'derived' });
  assert.deepEqual([un.coverage, un.toa, un.humanReviewRequired], [1, { truth: 1, openness: 1, accountability: 1 }, false]);
  assert.equal(g('support-unsupervised', EVIDENCE, { ...POLICY, maxSilentErrorRate: 1.04 }).case.negative.observed.score, 0.5);
  assert.deepEqual(g('support-assisted').case.negative.unknown, { score: 0.7, class: 'unknown' });
  assert.equal(g('support-assisted').case.positive[1].support, 0.91);
  const auto = g('screening-auto').case, rev = g('screening-review').case;
  assert.deepEqual(auto.positive[0], { id: 'spam caught', support: 1, weight: 2 });
  assert.equal(auto.negative.observed.score, 1);
  assert.equal(rev.negative.observed.score, 0.652174);
  assert.equal(rev.negative.unknown.score, 0.733333);
  const hr = g('hr-routing').case;
  assert.equal(hr.negative.observed.score, 0.5);
  assert.deepEqual(hr.negative.irreversibility, { score: 0.1, class: 'derived' });
  assert.equal(g('floor-async').case.negative.observed.score, 0.206667);
  assert.equal(g('floor-async', { ...EVIDENCE, coldStartSecMax: 601 }).case.positive[2].support, 0);
  assert.equal(g('floor-async', { ...EVIDENCE, coldStartSecMax: 600 }).case.positive[2].support, 1);
  const cr = g('credit-decisions').case;
  assert.deepEqual([cr.positive, cr.negative.unknown.score, cr.coverage, cr.humanReviewRequired], [[], 1, 0, true]);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, support: { ...EVIDENCE.support, lostPool: 1 } }).case.positive[1].support, 0);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, support: { ...EVIDENCE.support, lostChain: 1 } }).case.positive[1].support, 0);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, from: { hops: 0 } }).case.toa.truth, 0);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, from: null }).case.toa.truth, 0);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, preregistered: null }).case.toa.openness, 0);
  assert.equal(g('support-unsupervised', EVIDENCE, { ...POLICY, ownerAssigned: 'yes' }).case.toa.accountability, 0);
  assert.equal(g('support-unsupervised', { ...EVIDENCE, support: { ...EVIDENCE.support, items: 50 } }).case.coverage, 0.5);
  assert.equal(g('screening-auto', { ...EVIDENCE, security: { ...EVIDENCE.security, caught: 0, missed: 0 } }).case.positive[0].support, 0);
  assert.equal(g('screening-auto', { ...EVIDENCE, security: { ...EVIDENCE.security, wronglyFlagged: 0, correctlyPassed: 0 } }).case.negative.observed.score, 1);
  assert.equal(g('screening-review', { ...EVIDENCE, security: { ...EVIDENCE.security, caught: 30 } }).case.negative.unknown.score, 0);
  assert.match(g('support-unsupervised', { ...EVIDENCE, support: { ...EVIDENCE.support, e2e: 'x' } }).why, /missing a number/);
  assert.match(g('hr-routing', EVIDENCE, { ...POLICY, routingMaxErrorRate: undefined }).why, /missing a number/);
  assert.match(g('floor-async', EVIDENCE, { ...POLICY, minItems: undefined }).why, /missing a number/);
  assert.match(g('nope').why, /unknown decision/);
  assert.match(g('hr-routing', { support: {}, security: {} }).why, /evidence needs/);
  assert.match(g('hr-routing', { support: {}, hr: {} }).why, /evidence needs/);
  assert.match(g('hr-routing', { security: {}, hr: {} }).why, /evidence needs/);
  assert.match(g('hr-routing', null).why, /evidence needs/);
  assert.match(g('hr-routing', EVIDENCE, null).why, /policy/);
  assert.deepEqual(DECISIONS, ['support-unsupervised', 'support-assisted', 'screening-auto', 'screening-review', 'hr-routing', 'floor-async', 'credit-decisions']);
});

test('board: verdicts from the evidence, each sealed; a forged verdict is caught', () => {
  const b = board(EVIDENCE, POLICY, EVIDENCE.finished);
  assert.deepEqual(b.rows.map((r) => [r.id, r.verdict]), [['support-unsupervised', 'BLOCK'], ['support-assisted', 'PENDING'], ['screening-auto', 'BLOCK'], ['screening-review', 'PENDING'], ['hr-routing', 'PASS'], ['floor-async', 'PASS'], ['credit-decisions', 'PENDING']]);
  assert.deepEqual(b.tally, { PASS: 2, BLOCK: 2, PENDING: 3 });
  assert.equal(b.rows[4].positive, 0.922);
  assert.equal(b.rows[0].negative, 1);
  for (const r of b.rows) assert.equal(verifyReceipt(r.receipt).valid, true);
  const forged = { ...b.rows[0].receipt, verdict: 'PASS' };
  assert.equal(verifyReceipt(forged).valid, false);
  assert.equal(board(EVIDENCE, POLICY, EVIDENCE.finished).boardHash, b.boardHash);
  assert.notEqual(board(EVIDENCE, POLICY, '2026-01-01T00:00:00Z').boardHash, b.boardHash);
  assert.match(board(EVIDENCE, POLICY, '').why, /clock/);
  assert.equal(board({}, POLICY, 'x').ok, false);
  const strict = board(EVIDENCE, { ...POLICY, ownerAssigned: false }, 'x');
  assert.equal(strict.rows.find((r) => r.id === 'hr-routing').verdict, 'PENDING');
});
