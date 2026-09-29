import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASES, SIDES, sourced, exVat, toGbp, apiCostPerItem, floorRates, floorSeconds, capacity, tco, plan, seatShareBreakEven, CORPORATE_MODES, LEVERS, sensitivity,
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

test('floorRates: per-token laptop seconds fitted to the measured workloads', () => {
  const r = floorRates([{ tokensIn: 100, tokensOut: 0, seconds: 1 }, { tokensIn: 0, tokensOut: 10, seconds: 2 }]);
  assert.deepEqual(r, { ok: true, perIn: 0.01, perOut: 0.2 });
  const exact = floorRates([{ tokensIn: 100, tokensOut: 10, seconds: 3 }, { tokensIn: 200, tokensOut: 10, seconds: 4 }, { tokensIn: 50, tokensOut: 20, seconds: 4.5 }]);
  assert.ok(Math.abs(exact.perIn - 0.01) < 1e-12 && Math.abs(exact.perOut - 0.2) < 1e-12);
  assert.deepEqual(floorRates([{ tokensIn: 10, tokensOut: 1, seconds: 1 }, { tokensIn: 0, tokensOut: 2, seconds: 2 }]), { ok: true, perIn: 0, perOut: 1 });
  assert.deepEqual(floorRates([{ tokensIn: 1, tokensOut: 0, seconds: 1 }, { tokensIn: 0, tokensOut: 1, seconds: 0 }]), { ok: true, perIn: 1, perOut: 0 });
  assert.match(floorRates([{ tokensIn: 10, tokensOut: 1, seconds: 5 }, { tokensIn: 20, tokensOut: 2, seconds: 10 }]).why, /do not separate/);
  assert.match(floorRates([{ tokensIn: 0, tokensOut: 0, seconds: 1 }, { tokensIn: 0, tokensOut: 0, seconds: 1 }]).why, /do not separate/);
  assert.match(floorRates([{ tokensIn: 10, tokensOut: 1, seconds: 0 }, { tokensIn: 0, tokensOut: 1, seconds: 5 }]).why, /negative rate/);
  assert.match(floorRates([{ tokensIn: 1, tokensOut: 0, seconds: 5 }, { tokensIn: 1, tokensOut: 1, seconds: 0 }]).why, /negative rate/);
  assert.match(floorRates([{ tokensIn: 1, tokensOut: 1, seconds: 1 }]).why, /at least two/);
  assert.match(floorRates('x').why, /at least two/);
  for (const bad of [null, { tokensIn: -1, tokensOut: 1, seconds: 1 }, { tokensIn: 1, tokensOut: 'x', seconds: 1 }, { tokensIn: 1, tokensOut: 1, seconds: -1 }])
    assert.match(floorRates([bad, { tokensIn: 1, tokensOut: 1, seconds: 1 }]).why, /each measured workload/);
  const m = floorRates([{ tokensIn: 0, tokensOut: 0, seconds: 0 }, { tokensIn: 100, tokensOut: 0, seconds: 1 }, { tokensIn: 0, tokensOut: 10, seconds: 2 }]);
  assert.deepEqual(m, { ok: true, perIn: 0.01, perOut: 0.2 });
});

test('floorSeconds: the planning estimate from the fitted rates', () => {
  const R = { perIn: 0.01, perOut: 0.2 };
  assert.equal(floorSeconds(1000, 100, R), 30);
  assert.equal(floorSeconds(0, 0, R), 0);
  for (const [i, o, r] of [[-1, 1, R], [1, -1, R], ['1', 1, R], [1, '1', R], [1, 1, null], [1, 1, { perIn: 'x', perOut: 1 }], [1, 1, { perIn: 1, perOut: 'x' }]]) assert.equal(floorSeconds(i, o, r), null);
});

const FLOOR = { laptops: 100, nodeShare: 0.5, hoursPerDay: 4, daysPerMonth: 20 };
const WL = [{ id: 'a', perMonth: 3600, secondsPerItem: 10, basis: 'measured' }, { id: 'b', perMonth: 900, secondsPerItem: 4 }];
test('capacity: laptop-hours of AI work on the floor the company already owns, by year', () => {
  const c = capacity({ workloads: WL, floor: FLOOR, growth: 1, years: 2 });
  assert.equal(c.laptopHoursAvailable, 4000);
  assert.deepEqual(c.perWorkload, [{ id: 'a', perMonth: 3600, secondsPerItem: 10, basis: 'measured' }, { id: 'b', perMonth: 900, secondsPerItem: 4, basis: 'estimate' }]);
  assert.deepEqual(c.perYear, [{ year: 1, laptopHours: 11, laptopUtil: 0.003, floorOverloaded: false }, { year: 2, laptopHours: 22, laptopUtil: 0.006, floorOverloaded: false }]);
  assert.equal(capacity({ workloads: [{ id: 'a', perMonth: 1440001, secondsPerItem: 10 }], floor: FLOOR, growth: 0, years: 1 }).perYear[0].floorOverloaded, true);
  assert.equal(capacity({ workloads: [{ id: 'a', perMonth: 1440000, secondsPerItem: 10 }], floor: FLOOR, growth: 0, years: 1 }).perYear[0].floorOverloaded, false);
  assert.deepEqual(capacity({ workloads: [{ id: 'a', perMonth: 1, secondsPerItem: 36 }], floor: { ...FLOOR, laptops: 0 }, growth: 0, years: 1 }).perYear[0], { year: 1, laptopHours: 0.01, laptopUtil: null, floorOverloaded: true });
  assert.equal(capacity({ workloads: [{ id: 'a', perMonth: 0, secondsPerItem: 36 }], floor: { ...FLOOR, laptops: 0 }, growth: 0, years: 1 }).perYear[0].floorOverloaded, false);
  assert.equal(capacity({ workloads: [{ id: 'a', perMonth: 5, secondsPerItem: 0 }], floor: FLOOR, growth: 0, years: 1 }).perYear[0].laptopHours, 0);
  for (const [bad, re] of [
    [{ workloads: [] }, /needs workloads/], [{ workloads: [null] }, /each workload/], [{ workloads: [{ perMonth: 1, secondsPerItem: 1 }] }, /each workload/],
    [{ workloads: [{ id: 'a', perMonth: -1, secondsPerItem: 1 }] }, /each workload/], [{ workloads: [{ id: 'a', perMonth: 1 }] }, /each workload/], [{ workloads: [{ id: 'a', perMonth: 1, secondsPerItem: -1 }] }, /each workload/], [{ workloads: [{ id: 'a', perMonth: 'x', secondsPerItem: 1 }] }, /each workload/],
    [{ floor: { ...FLOOR, nodeShare: 1.1 } }, /floor/], [{ floor: { ...FLOOR, laptops: -1 } }, /floor/], [{ floor: { ...FLOOR, hoursPerDay: 'x' } }, /floor/], [{ floor: null }, /floor/],
    [{ growth: -0.51 }, /growth/], [{ growth: 5.01 }, /growth/], [{ growth: 'x' }, /growth/], [{ years: 0 }, /years/], [{ years: 11 }, /years/], [{ years: 1.5 }, /years/],
  ]) assert.match(capacity({ workloads: WL, floor: FLOOR, growth: 0, years: 1, ...bad }).why, re, JSON.stringify(bad).slice(0, 60));
  assert.equal(capacity({ workloads: WL, floor: { ...FLOOR, nodeShare: 1 }, growth: -0.5, years: 10 }).ok, true);
  assert.equal(capacity({ workloads: WL, floor: FLOOR, growth: 5, years: 1 }).ok, true);
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

const base = { company: COMPANY, prices: PRICES, evidence: EVIDENCE };
test('plan: Copilot on every desk vs the AI doing the work on the laptops already owned', () => {
  const p = plan(base);
  assert.equal(p.ok, true);
  assert.deepEqual([p.corporate, p.seats, p.apiModel], ['seats', 1000, 'OpenAI gpt-5-mini']);
  const line = (id) => p.tco.lines.find((l) => l.id === id);
  // seats: £23.10 ex VAT × 1,000 × 12, then CPI every year
  assert.equal(line('cloud-seats').perYear[0], 277200);
  assert.equal(line('cloud-seats').perYear[1], 285793.2);
  assert.equal(line('cloud-seats').total, 1474637.44);
  // people's time: support 60 s, screening 10 s on the 74% the model clears, HR 120 s, KYC 180 s; the assistant 0
  assert.deepEqual(p.staffHoursByWork, [{ id: 'support', hoursPerMonth: 2500 }, { id: 'screening', hoursPerMonth: 822.22 }, { id: 'hr-routing', hoursPerMonth: 266.67 }, { id: 'kyc-extraction', hoursPerMonth: 1500 }, { id: 'knowledge-assistant', hoursPerMonth: 0 }]);
  assert.equal(p.staffHoursPerMonth, 5088.89);
  assert.equal(p.fte, 33.9);
  assert.equal(p.hoursPerYear, 61066.67);
  assert.equal(p.aiVsSeats, 867);
  assert.equal(line('cloud-staff-time').perYear[0], 1009004.53);
  assert.equal(line('cloud-staff-time').total, 7299481.97);
  assert.equal(line('cloud-staff-time').basis, 'assumption');
  assert.equal(line('local-staff-time').total, 0);
  assert.equal(line('local-hardware').total, 0);
  assert.equal(line('local-models').total, 0);
  assert.equal(line('local-team').total, line('cloud-team').total);
  assert.equal(line('cloud-team').total, 1190819.21);
  assert.deepEqual([line('local-compliance').total, line('cloud-compliance').total], [83837.12, 126395.2]);
  assert.equal(line('local-power').total, 1701.74);
  assert.equal(p.aiCost, 1701.74);
  assert.equal(p.seatCost, 1474637.44);
  assert.deepEqual(p.tco.total, { local: 1276358.06, cloud: 10091333.82, difference: 8814975.75 });
  assert.equal(p.saving, 8814975.75);
  assert.equal(p.savingShare, 0.874);
  assert.deepEqual(p.tco.perYear[4], { year: 5, local: 266946.57, cloud: 2582697.61 });
  assert.equal(p.tco.breakEvenYear, 1);
  assert.equal(p.tco.lines.some((l) => l.id.startsWith('cloud-api-')), false);
  assert.deepEqual(p.capacity.perYear.map((y) => y.laptopUtil), [0.169, 0.195, 0.224, 0.257, 0.296]);
  assert.deepEqual(p.capacity.perWorkload.map((w) => [w.id, w.secondsPerItem, w.basis]), [['support', 18.06, 'measured'], ['screening', 4.58, 'measured'], ['hr-routing', 4.97, 'measured'], ['kyc-extraction', 34.93, 'estimate'], ['knowledge-assistant', 64.6, 'estimate']]);
  assert.ok(Math.abs(p.rates.perIn - 0.010537976831231217) < 1e-12 && Math.abs(p.rates.perOut - 0.1275002757344542) < 1e-12);
  assert.deepEqual(p.warnings, []);
});

test('plan: "we\'ll automate it with a cloud API instead" — the seats stay, the work goes to a vendor', () => {
  const q = plan({ ...base, choices: { corporate: 'seats+api' } });
  assert.equal(q.corporate, 'seats+api');
  assert.equal(q.tco.lines.some((l) => l.id === 'cloud-staff-time'), false);
  assert.deepEqual(q.tco.lines.filter((l) => l.id.startsWith('cloud-api-')).map((l) => [l.id, l.basis]), [['cloud-api-support', 'list-price'], ['cloud-api-screening', 'list-price'], ['cloud-api-hr-routing', 'list-price'], ['cloud-api-kyc-extraction', 'estimate']]);
  assert.deepEqual(q.tco.total, { local: 1276358.06, cloud: 2798864.37, difference: 1522506.3 });
  const ent = plan({ ...base, choices: { corporate: 'seats+api', seat: 'claude-enterprise' } });
  assert.ok(ent.tco.lines.find((l) => l.id === 'cloud-api-knowledge-assistant'));
  assert.equal(plan({ ...base, choices: { corporate: 'seats', seat: 'claude-enterprise' } }).tco.lines.some((l) => l.id === 'cloud-api-knowledge-assistant'), false);
  assert.match(plan({ ...base, choices: { corporate: 'cloud' } }).why, /seats or seats\+api/);
});

test('plan: choices change the answer the way they should', () => {
  const half = plan({ ...base, choices: { seatShare: 0.5 } });
  assert.equal(half.seats, 500);
  assert.equal(half.tco.lines.find((l) => l.id === 'cloud-seats').total, 737318.72);
  const team = plan({ ...base, choices: { seat: 'claude-team' } });
  assert.deepEqual(team.warnings, ['Claude Team (standard seat) is sold for up to 150 seats; this company needs 1000.']);
  assert.equal(team.tco.lines.find((l) => l.id === 'cloud-seats').perYear[0], 180000);
  assert.deepEqual(plan({ ...base, choices: { seat: 'claude-team', seatShare: 0.15 } }).warnings, []);
  assert.equal(plan({ ...base, choices: { seat: 'claude-team', seatShare: 0.151 } }).warnings.length, 1);
  assert.equal(plan({ ...base, choices: { seatShare: 0 } }).seats, 0);
  const flat = plan({ ...base, prices: { ...PRICES, cpi: { ...PRICES.cpi, value: 0 } } });
  assert.equal(flat.tco.lines.find((l) => l.id === 'cloud-seats').total, 1386000);
  assert.equal(plan({ ...base, prices: { ...PRICES, cpi: { value: -0.1 } } }).ok, true);
  assert.equal(plan({ ...base, prices: { ...PRICES, cpi: { value: 0.5 } } }).ok, true);
  const noScreenReview = plan({ ...base, company: { ...COMPANY, workloads: COMPANY.workloads.map((w) => ({ ...w, reviewedFrom: undefined })) } });
  assert.equal(noScreenReview.staffHoursPerMonth, 5377.78);
  // nothing on the corporate side: no share to report, never a division by zero
  const nothing = plan({ ...base, choices: { seatShare: 0 }, company: { ...COMPANY, workloads: COMPANY.workloads.map((w) => ({ ...w, secondsSaved: 0 })), staff: { ...COMPANY.staff, cloud: [] }, compliance: { ...COMPANY.compliance, cloud: { ...COMPANY.compliance.cloud, daysYear1: 0, daysPerYear: 0 } } } });
  assert.equal(nothing.tco.total.cloud, 0);
  assert.equal(nothing.savingShare, null);
  for (const [ch, re] of [[{ seat: 'nope' }, /unknown seat/], [{ apiModel: 'nope' }, /unknown API/], [{ seatShare: 1.1 }, /seatShare/], [{ seatShare: -0.1 }, /seatShare/], [{ seatShare: 'x' }, /seatShare/]])
    assert.match(plan({ ...base, choices: ch }).why, re);
});

test('sensitivity: what a CFO will push on, each scenario re-run through the whole plan', () => {
  assert.deepEqual(LEVERS, ['timeSaved', 'wage', 'cpi', 'growth', 'watts']);
  const before = JSON.stringify(base);
  const s = sensitivity(base, COMPANY.sensitivity.scenarios);
  assert.equal(s.ok, true);
  assert.equal(JSON.stringify(base), before, 'the scenarios never change the input');
  assert.deepEqual(s.base, { cloud: 10091333.82, local: 1276358.06, saving: 8814975.75, savingShare: 0.874, fte: 33.9, aiCost: 1701.74 });
  const row = (id) => s.rows.find((r) => r.id === id);
  assert.deepEqual(s.rows.map((r) => [r.id, r.saving, r.savingShare, r.fte, r.aiCost, r.vsBase]), [
    ['time-halved', 5165234.77, 0.802, 17, 1701.74, -3649740.98],
    ['wage-median', 12812174.38, 0.909, 33.9, 1701.74, 3997198.63],
    ['cpi-target', 8602143.44, 0.873, 33.9, 1659.8, -212832.31],
    ['cpi-high', 9194223.77, 0.874, 33.9, 1776.48, 379248.02],
    ['volume-flat', 6883605.98, 0.844, 33.9, 1251.37, -1931369.77],
    ['watts-max', 8810437.79, 0.873, 33.9, 6239.71, -4537.96],
    ['all-down', 4105153.76, 0.766, 17, 4488.55, -4709821.99],
  ]);
  assert.deepEqual(row('wage-median').values, { wage: 19.67 });
  assert.deepEqual(row('all-down').values, { timeSaved: 0.5, cpi: 0.02, growth: 0, watts: 55 });
  assert.deepEqual([row('cpi-high').cloud, row('cpi-high').local], [10519210.99, 1324987.22]);
  assert.equal(s.worst, 4105153.76);
  assert.deepEqual(sensitivity(base, []), { ok: true, base: s.base, rows: [], worst: null });
  // a lever by number, or by the path of a sourced figure
  assert.equal(sensitivity(base, [{ id: 'w', set: { wage: 19.67 } }]).rows[0].saving, 12812174.38);
  assert.equal(sensitivity(base, [{ id: 'g', set: { growth: 'cpi.value' } }]).rows[0].values.growth, 0.031);
  // no power, no ratio
  assert.equal(plan({ ...base, company: { ...COMPANY, floor: { ...COMPANY.floor, watts: { value: 0 } } } }).aiVsSeats, null);
  // refusals
  assert.match(sensitivity(base, 'x').why, /list of scenarios/);
  assert.match(sensitivity({}, []).why, /plan needs/);
  for (const [sc, re] of [
    [null, /an id and at least one lever/], [{ set: { cpi: 0.02 } }, /an id and at least one lever/], [{ id: 'a' }, /an id and at least one lever/],
    [{ id: 'a', set: {} }, /an id and at least one lever/], [{ id: 'a', set: { seats: 2 } }, /a: seats is not a lever/],
    [{ id: 'a', set: { wage: 'wageMedian' } }, /a: wage must be a number or the path/], [{ id: 'a', set: { wage: 'nope.value' } }, /a: wage must be/],
    [{ id: 'a', set: { cpi: 'cpi.value.deeper' } }, /a: cpi must be/], [{ id: 'a', set: { cpi: '' } }, /a: cpi must be/], [{ id: 'a', set: { cpi: true } }, /a: cpi must be/],
    [{ id: 'a', set: { cpi: NaN } }, /a: cpi must be/], [{ id: 'a', set: { timeSaved: -1 } }, /^a: support: seconds of staff time saved/], [{ id: 'a', set: { cpi: 0.9 } }, /^a: prices need cpi/],
  ]) assert.match(sensitivity(base, [{ id: 'ok', set: { cpi: 0.02 } }, sc]).why, re);
});


test('seatShareBreakEven: with the staff time on the bill, local-first is cheaper at any seat coverage', () => {
  assert.deepEqual(seatShareBreakEven(base), { ok: true, share: -4.978, localAlwaysCheaper: true, cloudAlwaysCheaper: false });
  const api = seatShareBreakEven({ ...base, choices: { corporate: 'seats+api' } });
  assert.deepEqual(api, { ok: true, share: -0.032, localAlwaysCheaper: true, cloudAlwaysCheaper: false });
  const noCloudTeam = seatShareBreakEven({ ...base, choices: { corporate: 'seats+api' }, company: { ...COMPANY, staff: { ...COMPANY.staff, cloud: [] } } });
  assert.equal(noCloudTeam.localAlwaysCheaper, false);
  assert.ok(noCloudTeam.share > 0 && noCloudTeam.share < 1);
  const free = seatShareBreakEven({ ...base, prices: { ...PRICES, seats: PRICES.seats.map((s) => ({ ...s, price: 0 })) } });
  assert.deepEqual(free, { ok: true, share: null, why: 'seats add nothing to the corporate side' });
  const tiny = (localDays) => ({ ...base, choices: { corporate: 'seats+api' }, company: { ...COMPANY, profile: { ...COMPANY.profile, knowledgeWorkers: 1 }, growth: { value: 0 }, workloads: [{ ...COMPANY.workloads[0], perMonth: 0 }, { ...COMPANY.workloads[2], perMonth: 0 }],
    staff: { onCost: COMPANY.staff.onCost, local: [], cloud: [] }, compliance: { dayRate: { value: 1386 }, local: { daysYear1: localDays, daysPerYear: 0, why: 'w' }, cloud: { daysYear1: 0, daysPerYear: 0, why: 'w' } } },
    prices: { ...PRICES, cpi: { ...PRICES.cpi, value: 0 } } });
  assert.deepEqual(seatShareBreakEven(tiny(0)), { ok: true, share: 0, localAlwaysCheaper: true, cloudAlwaysCheaper: false });
  assert.deepEqual(seatShareBreakEven(tiny(1)), { ok: true, share: 1, localAlwaysCheaper: false, cloudAlwaysCheaper: false });
  assert.match(seatShareBreakEven({ ...base, choices: { seat: 'nope' } }).why, /unknown seat/);
  assert.match(seatShareBreakEven({ company: COMPANY, prices: PRICES }).why, /plan needs/);
  assert.equal(seatShareBreakEven(null).why, 'seatShareBreakEven needs the same input as plan');
});

test('plan: refuses what it cannot stand behind', () => {
  const C = (patch) => ({ ...base, company: { ...COMPANY, ...patch } });
  const P = (patch) => ({ ...base, prices: { ...PRICES, ...patch } });
  const need = 'plan needs company, prices and evidence';
  assert.equal(plan(null).why, need);
  assert.equal(plan({ company: COMPANY, prices: PRICES }).why, need);
  assert.equal(plan({ prices: PRICES, evidence: EVIDENCE }).why, need);
  assert.equal(plan({ company: COMPANY, evidence: EVIDENCE }).why, need);
  assert.match(plan({ ...base, evidence: { ...EVIDENCE, hr: {} } }).why, /hr-routing: its evidence \(hr\) is missing/);
  for (const k of ['tokensIn', 'tokensOut', 'laptopSecondsPerItem']) assert.match(plan({ ...base, evidence: { ...EVIDENCE, hr: { ...EVIDENCE.hr, [k]: undefined } } }).why, /hr-routing: its evidence/, k);
  assert.match(plan(C({ workloads: [{ ...COMPANY.workloads[0], tokens: 'guess' }] })).why, /measured or estimate/);
  assert.match(plan(C({ workloads: [{ tokens: 'estimate', secondsSaved: 1 }] })).why, /needs an id/);
  assert.match(plan(C({ workloads: [null] })).why, /needs an id/);
  assert.match(plan(C({ workloads: [{ ...COMPANY.workloads[0], secondsSaved: -1 }] })).why, /seconds of staff time saved/);
  assert.match(plan(C({ workloads: [{ ...COMPANY.workloads[0], secondsSaved: 'x' }] })).why, /seconds of staff time saved/);
  assert.equal(plan(C({ workloads: COMPANY.workloads.map((w) => ({ ...w, secondsSaved: 0 })) })).tco.lines.find((l) => l.id === 'cloud-staff-time').total, 0);
  assert.match(plan(C({ workloads: 'x' })).why, /workloads/);
  assert.match(plan(C({ workloads: [COMPANY.workloads[0], COMPANY.workloads[3]] })).why, /at least two/);
  assert.match(plan(C({ workloads: [...COMPANY.workloads.slice(0, 3), { ...COMPANY.workloads[3], tokensIn: undefined }] })).why, /needs tokensIn and tokensOut/);
  assert.match(plan(P({ fx: null })).why, /fx and vatRate/);
  assert.match(plan(P({ vatRate: {} })).why, /fx and vatRate/);
  for (const cpi of [null, { value: 'x' }, { value: -0.11 }, { value: 0.51 }]) assert.match(plan(P({ cpi })).why, /cpi/);
  for (const wage of [null, { value: 'x' }, { value: -1 }]) assert.match(plan(P({ wage })).why, /the wage/);
  assert.equal(plan(P({ wage: { ...PRICES.wage, value: 0 } })).tco.lines.find((l) => l.id === 'cloud-staff-time').total, 0);
  assert.match(plan(C({ profile: { ...COMPANY.profile, knowledgeWorkers: 'x' } })).why, /knowledgeWorkers/);
  assert.match(plan(P({ seats: [{ ...PRICES.seats[0], currency: 'EUR' }] })).why, /seat price/);
  const S = COMPANY.staff;
  assert.match(plan(C({ staff: null })).why, /staff on-cost/);
  assert.match(plan(C({ staff: { ...S, onCost: null } })).why, /staff on-cost/);
  assert.match(plan(C({ staff: { ...S, onCost: { value: 'x' } } })).why, /staff on-cost/);
  assert.match(plan(C({ staff: { ...S, onCost: { value: 0.9 } } })).why, /staff on-cost/);
  assert.equal(plan(C({ staff: { ...S, onCost: { value: 1 } } })).ok, true);
  for (const st of [null, { hoursPerFte: null }, { hoursPerFte: { value: 'x' } }, { hoursPerFte: { value: 0 } }]) assert.match(plan(C({ staffTime: st })).why, /hoursPerFte/);
  assert.match(plan(C({ workloads: COMPANY.workloads.map((w) => ({ ...w, reviewedFrom: w.reviewedFrom ? 'nope' : undefined })) })).why, /still goes to a person/);
  for (const k of ['items', 'caught', 'wronglyFlagged']) assert.match(plan({ ...base, evidence: { ...EVIDENCE, security: { ...EVIDENCE.security, [k]: 'x' } } }).why, /still goes to a person/, k);
  assert.match(plan({ ...base, evidence: { ...EVIDENCE, security: { ...EVIDENCE.security, items: 0 } } }).why, /still goes to a person/);
  assert.match(plan(P({ salaries: {} })).why, /salaries/);
  assert.match(plan(P({ salaries: { roles: { ...PRICES.salaries.roles, 2134: { median: 'x' } } } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, local: [null] } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, local: [{ role: 'x', fte: 'x', soc: '2134' }] } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, local: [{ role: 'x', fte: 1, soc: '9999' }] } })).why, /local staff/);
  assert.match(plan(C({ staff: { ...S, cloud: [{ role: 'x', fte: -1, soc: '2134' }] } })).why, /cloud staff/);
  assert.equal(plan(C({ staff: { ...S, local: [{ role: 'Nobody', fte: 0, soc: '2134' }] } })).tco.lines.find((l) => l.id === 'local-team').total, 0);
  const noCloudTeam = plan(C({ staff: { onCost: S.onCost, local: S.local } }));
  assert.equal(noCloudTeam.tco.lines.find((l) => l.id === 'cloud-team').total, 0);
  assert.match(noCloudTeam.tco.lines.find((l) => l.id === 'cloud-team').label, /: 0 FTE \(\)$/);
  const CP = COMPANY.compliance;
  assert.match(plan(C({ compliance: null })).why, /^compliance$/);
  assert.match(plan(C({ compliance: { ...CP, dayRate: null } })).why, /^compliance$/);
  assert.match(plan(C({ compliance: { ...CP, dayRate: { value: 'x' } } })).why, /^compliance$/);
  assert.match(plan(C({ compliance: { ...CP, dayRate: { value: -1 } } })).why, /^compliance$/);
  assert.equal(plan(C({ compliance: { ...CP, dayRate: { value: 0 } } })).tco.lines.find((l) => l.id === 'local-compliance').total, 0);
  assert.match(plan(C({ compliance: { ...CP, local: null } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 'x', daysPerYear: 1 } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 1, daysPerYear: 'x' } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, local: { daysYear1: 1, daysPerYear: -1 } } })).why, /local compliance days/);
  assert.match(plan(C({ compliance: { ...CP, cloud: { daysYear1: -1, daysPerYear: 1 } } })).why, /cloud compliance days/);
  assert.equal(plan(C({ compliance: { ...CP, local: { daysYear1: 0, daysPerYear: 0, why: 'w' } } })).tco.lines.find((l) => l.id === 'local-compliance').total, 0);
  assert.match(plan(P({ electricity: null })).why, /floor watts/);
  assert.match(plan(P({ electricity: { pencePerKwh: 'x' } })).why, /floor watts/);
  for (const watts of [null, { value: 'x' }, { value: -1 }]) assert.match(plan(C({ floor: { ...COMPANY.floor, watts } })).why, /floor watts/);
  assert.equal(plan(C({ floor: { ...COMPANY.floor, watts: { value: 0 } } })).aiCost, 0);
  assert.match(plan(C({ floor: null })).why, /floor/);
  assert.match(plan(C({ floor: { ...COMPANY.floor, nodeShare: { value: 2 } } })).why, /floor/);
  assert.equal(plan(C({ hardware: null })).tco.lines.find((l) => l.id === 'local-hardware').total, 0);
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
