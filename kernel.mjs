// fallfloor-enterprise · kernel.mjs — the reference design's arithmetic and rules. Pure and total: no I/O, no clock,
// garbage in → a structured refusal, never an exception. The page runs this exact file (tools/make-page.mjs inlines it),
// CI mutation-gates it, and every number the page shows is computed here from sourced inputs.
//
//   sourced figures · capacity (the laptops already owned) · 5-year cost, both sides, every line with its basis ·
//   the rented back office (SaaS) against the estate organs that replace it ·
//   the compliance map (who holds which duty, on which stack) · the go/no-go board (a dual-map gate per decision,
//   fed by fallfloor's receipted evidence).
//
// The go/no-go board uses dualmap.mjs — a faithful implementation of Gary W. Floyd, Lumiea Systems Research
// Division — ThunderStruck Service LLC — "From GEP Stabilization to Dual-Map Ethical Reasoning," Derivation v0.2.
import { sha256, canon } from './hash.mjs';
import { decide, seal, verifyReceipt } from './dualmap.mjs';
import { DEPLOYMENTS, STATUSES, obligations } from './comply.mjs';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const r2 = (x) => Math.round(x * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/\S+$/;
const fail = (why) => ({ ok: false, why });

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SOURCED FIGURES — nothing enters the cost model without saying where it came from
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export const BASES = ['list-price', 'measured', 'estimate', 'assumption'];
export const SIDES = ['local', 'cloud'];

/** sourced(f) — { basis, source?, checked?, why? }: a list price needs an https source and the date checked; a
 *  measured figure needs its source; an estimate or assumption needs the reason in words. */
export function sourced(f) {
  if (!isObj(f) || !BASES.includes(f.basis)) return fail('basis must be one of ' + BASES.join(', '));
  if (f.basis === 'list-price') return HTTPS.test(f.source || '') && DATE.test(f.checked || '') ? { ok: true } : fail('a list price needs its https source and the date it was checked');
  if (f.basis === 'measured') return isStr(f.source) ? { ok: true } : fail('a measured figure names where it was measured');
  return isStr(f.why) ? { ok: true } : fail('an ' + f.basis + ' says why, in words');
}

/** exVat(amount, vat, rate) — list prices compared net of VAT. vat: 'excluded' | 'included' | 'not stated'. */
export function exVat(amount, vat, rate) {
  if (!isNum(amount) || amount < 0 || !isNum(rate) || rate < 0) return null;
  if (vat === 'included') return amount / (1 + rate);
  if (vat === 'excluded' || vat === 'not stated') return amount;
  return null;
}

/** toGbp(amount, currency, gbpPerUsd) */
export function toGbp(amount, currency, gbpPerUsd) {
  if (!isNum(amount) || !isNum(gbpPerUsd) || gbpPerUsd <= 0) return null;
  if (currency === 'GBP') return amount;
  if (currency === 'USD') return amount * gbpPerUsd;
  return null;
}

/** apiCostPerItem(tokensIn, tokensOut, price, gbpPerUsd) — GBP per item at a USD per-million-token list price. */
export function apiCostPerItem(tokensIn, tokensOut, price, gbpPerUsd) {
  if (!isNum(tokensIn) || !isNum(tokensOut) || tokensIn < 0 || tokensOut < 0) return null;
  if (!isObj(price) || !isNum(price.inPerM) || !isNum(price.outPerM) || price.inPerM < 0 || price.outPerM < 0) return null;
  if (!isNum(gbpPerUsd) || gbpPerUsd <= 0) return null;
  return ((tokensIn * price.inPerM + tokensOut * price.outPerM) / 1e6) * gbpPerUsd;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// CAPACITY — everything runs on the laptops the company already owns. Seconds per item are MEASURED (fallfloor) for
// the measured workloads; for the others they come from per-token rates fitted to those same measurements.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
/** floorRates(points) — laptop-seconds per prompt token and per output token, a least-squares fit (no intercept) to
 *  measured workloads [{ tokensIn, tokensOut, seconds }]. */
export function floorRates(points) {
  if (!Array.isArray(points) || points.length < 2) return fail('floorRates needs at least two measured workloads');
  let aa = 0, ab = 0, bb = 0, as = 0, bs = 0;
  for (const p of points) {
    if (!isObj(p) || ![p.tokensIn, p.tokensOut, p.seconds].every((v) => isNum(v) && v >= 0)) return fail('each measured workload: tokensIn, tokensOut and seconds ≥ 0');
    aa += p.tokensIn * p.tokensIn; ab += p.tokensIn * p.tokensOut; bb += p.tokensOut * p.tokensOut;
    as += p.tokensIn * p.seconds; bs += p.tokensOut * p.seconds;
  }
  const det = aa * bb - ab * ab;
  if (!(det > 0)) return fail('the measured workloads do not separate prompt tokens from output tokens');
  const perIn = (as * bb - bs * ab) / det, perOut = (bs * aa - as * ab) / det;
  if (perIn < 0 || perOut < 0) return fail('the fit gave a negative rate — measure more workloads');
  return { ok: true, perIn, perOut };
}

/** floorSeconds(tokensIn, tokensOut, rates) — the planning estimate for a workload that was not itself measured. */
export function floorSeconds(tokensIn, tokensOut, rates) {
  if (!isNum(tokensIn) || !isNum(tokensOut) || tokensIn < 0 || tokensOut < 0 || !isObj(rates) || !isNum(rates.perIn) || !isNum(rates.perOut)) return null;
  return tokensIn * rates.perIn + tokensOut * rates.perOut;
}

/** capacity(input) → per year: laptop-hours of AI work a month, the share of the enrolled floor it uses, and whether it fits. */
export function capacity(input) {
  if (!isObj(input) || !Array.isArray(input.workloads) || input.workloads.length === 0) return fail('capacity needs workloads');
  const { workloads, floor, growth, years } = input;
  if (!isObj(floor) || ![floor.laptops, floor.nodeShare, floor.hoursPerDay, floor.daysPerMonth].every((v) => isNum(v) && v >= 0) || floor.nodeShare > 1) return fail('floor: laptops, nodeShare (0–1), hoursPerDay, daysPerMonth');
  if (!isNum(growth) || growth < -0.5 || growth > 5 || !Number.isInteger(years) || years < 1 || years > 10) return fail('growth and years (1–10)');
  const per = [];
  for (const w of workloads) {
    if (!isObj(w) || !isStr(w.id) || !isNum(w.perMonth) || w.perMonth < 0 || !isNum(w.secondsPerItem) || w.secondsPerItem < 0) return fail('each workload: id, perMonth and seconds per item');
    per.push({ id: w.id, perMonth: w.perMonth, secondsPerItem: r2(w.secondsPerItem), basis: w.basis === 'measured' ? 'measured' : 'estimate' });
  }
  const avail = floor.laptops * floor.nodeShare * floor.hoursPerDay * floor.daysPerMonth;
  const perYear = [];
  for (let y = 0; y < years; y++) {
    const f = Math.pow(1 + growth, y);
    const hours = per.reduce((a, p) => a + (p.perMonth * f * p.secondsPerItem) / 3600, 0);
    perYear.push({ year: y + 1, laptopHours: r2(hours), laptopUtil: avail > 0 ? Math.round((hours / avail) * 1000) / 1000 : null, floorOverloaded: hours > avail });
  }
  return { ok: true, laptopHoursAvailable: r2(avail), perWorkload: per, perYear };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// COST — cash per year for each side, every line carrying its basis; totals, cumulative, break-even, and how much
// of each side's total rests on estimates and assumptions rather than list prices and measurements
// ══════════════════════════════════════════════════════════════════════════════════════════════════
/** tco(lines, years) — lines: [{ id, side, label, basis, source|why, perYear: [gbp × years] }]. */
export function tco(lines, years) {
  if (!Array.isArray(lines) || lines.length === 0 || !Number.isInteger(years) || years < 1) return fail('tco(lines, years)');
  const ids = new Set();
  const perYear = Array.from({ length: years }, (_, i) => ({ year: i + 1, local: 0, cloud: 0 }));
  const total = { local: 0, cloud: 0 };
  const byBasis = { local: {}, cloud: {} };
  const out = [];
  for (const l of lines) {
    if (!isObj(l) || !isStr(l.id) || ids.has(l.id)) return fail('each line needs a unique id');
    ids.add(l.id);
    if (!SIDES.includes(l.side)) return fail(l.id + ': side must be local or cloud');
    if (!isStr(l.label)) return fail(l.id + ': label');
    const s = sourced(l); if (!s.ok) return fail(l.id + ': ' + s.why);
    if (!Array.isArray(l.perYear) || l.perYear.length !== years || !l.perYear.every((v) => isNum(v) && v >= 0)) return fail(l.id + ': perYear must hold ' + years + ' amounts ≥ 0');
    const t = l.perYear.reduce((a, v) => a + v, 0);
    l.perYear.forEach((v, i) => { perYear[i][l.side] += v; });
    total[l.side] += t;
    byBasis[l.side][l.basis] = (byBasis[l.side][l.basis] || 0) + t;
    out.push({ id: l.id, side: l.side, label: l.label, basis: l.basis, total: r2(t), perYear: l.perYear.map(r2) });
  }
  let cl = 0, cc = 0, breakEvenYear = null;
  const cumulative = perYear.map((p) => { cl += p.local; cc += p.cloud; if (breakEvenYear === null && cl <= cc) breakEvenYear = p.year; return { year: p.year, local: r2(cl), cloud: r2(cc) }; });
  const share = (side) => Object.fromEntries(BASES.map((b) => [b, total[side] > 0 ? Math.round(((byBasis[side][b] || 0) / total[side]) * 1000) / 1000 : 0]));
  return {
    ok: true, lines: out, perYear: perYear.map((p) => ({ year: p.year, local: r2(p.local), cloud: r2(p.cloud) })), cumulative,
    total: { local: r2(total.local), cloud: r2(total.cloud), difference: r2(total.cloud - total.local) }, breakEvenYear,
    basisShare: { local: share('local'), cloud: share('cloud') },
  };
}

export const CORPORATE_MODES = ['seats', 'seats+api'];

/** plan(m) — the whole comparison from its inputs. m = { company, prices, evidence, choices }.
 *  Corporate ('seats'): Copilot on every desk — it helps each person, the people still do the work, so their time on it
 *  is on the corporate bill. ('seats+api'): the same seats, with the work automated through a cloud API instead.
 *  Local-first: the open models on the laptops already owned do the work; its extra cost is the electricity.
 *  Hardware is the same on both sides and cancels. Seats, teams, compliance, people's time and power rise with CPI. */
export function plan(m) {
  if (!isObj(m) || !isObj(m.company) || !isObj(m.prices) || !isObj(m.evidence)) return fail('plan needs company, prices and evidence');
  const C = m.company, P = m.prices, E = m.evidence;
  const ch = { ...(isObj(C.choices) ? C.choices : {}), ...(isObj(m.choices) ? m.choices : {}) };
  const years = C.years, growth = isObj(C.growth) ? C.growth.value : undefined;
  const fx = isObj(P.fx) ? P.fx.gbpPerUsd : undefined, vatRate = isObj(P.vatRate) ? P.vatRate.value : undefined;
  const cpi = isObj(P.cpi) ? P.cpi.value : undefined, wage = isObj(P.wage) ? P.wage.value : undefined;
  if (!isNum(fx) || !isNum(vatRate)) return fail('prices need fx and vatRate');
  if (!isNum(cpi) || cpi < -0.1 || cpi > 0.5 || !isNum(wage) || wage < 0) return fail('prices need cpi (−10% to 50%) and the wage');
  if (!CORPORATE_MODES.includes(ch.corporate)) return fail('corporate must be seats or seats+api');
  if (!Array.isArray(C.workloads)) return fail('company.workloads');
  // the measured workloads first: their seconds are measured, and they fit the per-token rates for the rest
  const wl = [];
  for (const w of C.workloads) {
    if (!isObj(w) || !isStr(w.id)) return fail('each workload needs an id');
    if (!isNum(w.secondsSaved) || w.secondsSaved < 0) return fail(w.id + ': seconds of staff time saved per item');
    if (w.tokens === 'measured') {
      const ev = E[w.evidence];
      if (!isObj(ev) || !isNum(ev.tokensIn) || !isNum(ev.tokensOut) || !isNum(ev.laptopSecondsPerItem)) return fail(w.id + ': its evidence (' + String(w.evidence) + ') is missing');
      wl.push({ ...w, tokensIn: ev.tokensIn, tokensOut: ev.tokensOut, secondsPerItem: ev.laptopSecondsPerItem, basis: 'measured' });
    } else if (w.tokens === 'estimate') wl.push({ ...w, basis: 'estimate' });
    else return fail(w.id + ': tokens must be measured or estimate');
  }
  const rates = floorRates(wl.filter((w) => w.basis === 'measured').map((w) => ({ tokensIn: w.tokensIn, tokensOut: w.tokensOut, seconds: w.secondsPerItem })));
  if (!rates.ok) return rates;
  for (const w of wl) if (w.basis === 'estimate') { w.secondsPerItem = floorSeconds(w.tokensIn, w.tokensOut, rates); if (w.secondsPerItem === null) return fail(w.id + ': an estimated workload needs tokensIn and tokensOut'); }
  const fl = isObj(C.floor) ? C.floor : {};
  const cap = capacity({ workloads: wl, floor: { laptops: C.profile && C.profile.laptops, nodeShare: fl.nodeShare && fl.nodeShare.value, hoursPerDay: fl.hoursPerDay && fl.hoursPerDay.value, daysPerMonth: fl.daysPerMonth && fl.daysPerMonth.value }, growth, years });
  if (!cap.ok) return cap;
  const Y = (fn) => Array.from({ length: years }, (_, i) => fn(i));
  const grow = (i) => Math.pow(1 + growth, i), infl = (i) => Math.pow(1 + cpi, i);
  const lines = [];

  // ── the corporate side ──
  const seat = (P.seats || []).find((s) => s.id === ch.seat);
  if (!seat) return fail('unknown seat product: ' + String(ch.seat));
  const seatShare = ch.seatShare;
  if (!isNum(seatShare) || seatShare < 0 || seatShare > 1) return fail('seatShare must be 0–1');
  const seatsN = Math.round((C.profile && C.profile.knowledgeWorkers) * seatShare);
  if (!Number.isInteger(seatsN) || seatsN < 0) return fail('profile.knowledgeWorkers');
  const warnings = [];
  if (seat.maxSeats !== null && seat.maxSeats !== undefined && seatsN > seat.maxSeats) warnings.push(seat.product + ' is sold for up to ' + seat.maxSeats + ' seats; this company needs ' + seatsN + '.');
  const seatGbp = toGbp(exVat(seat.price, seat.vat, vatRate), seat.currency, fx);
  if (seatGbp === null) return fail('seat price');
  lines.push({ id: 'cloud-seats', side: 'cloud', label: seatsN + ' × ' + seat.product + ' (' + seat.per + '), rising with CPI', basis: 'list-price', source: seat.source, checked: seat.checked, perYear: Y((i) => seatsN * seatGbp * 12 * infl(i)) });
  // people's time on the work the AI takes over: minutes per item × volume, less what still goes to a person
  const S = C.staff, ST = C.staffTime;
  if (!isObj(S) || !isObj(S.onCost) || !isNum(S.onCost.value) || S.onCost.value < 1) return fail('staff on-cost');
  if (!isObj(ST) || !isObj(ST.hoursPerFte) || !isNum(ST.hoursPerFte.value) || ST.hoursPerFte.value <= 0) return fail('staffTime.hoursPerFte');
  const kept = (w) => {
    if (!isStr(w.reviewedFrom)) return 1;
    const ev = E[w.reviewedFrom];
    if (!isObj(ev) || !isNum(ev.items) || ev.items <= 0 || !isNum(ev.caught) || !isNum(ev.wronglyFlagged)) return null;
    return 1 - (ev.caught + ev.wronglyFlagged) / ev.items;      // the share the model clears; the flagged share still goes to a person
  };
  const byWork = [];
  for (const w of wl) { const k = kept(w); if (k === null) return fail(w.id + ': the evidence for what still goes to a person is missing'); byWork.push({ id: w.id, hoursPerMonth: (w.secondsSaved / 3600) * w.perMonth * k }); }
  const staffHours = byWork.reduce((a, b) => a + b.hoursPerMonth, 0);
  const api = (P.api || []).find((a) => a.id === ch.apiModel);
  if (!api) return fail('unknown API model: ' + String(ch.apiModel));
  if (ch.corporate === 'seats') {
    lines.push({ id: 'cloud-staff-time', side: 'cloud', label: 'Staff time on the work the AI takes over (' + Math.round(staffHours).toLocaleString('en-GB') + ' hours a month in year 1) — the staff time local-first frees — at the National Living Wage, growing with volume and CPI', basis: 'assumption', why: 'seconds saved per item are floor-level assumptions; the wage is the statutory National Living Wage (' + P.wage.source + ') × on-cost', perYear: Y((i) => staffHours * grow(i) * 12 * wage * S.onCost.value * infl(i)) });
  } else {
    for (const w of wl) {
      const viaApi = w.cloud === 'api' || (w.cloud === 'seats' && seat.plusUsage === true);
      if (!viaApi) continue;
      const per = apiCostPerItem(w.tokensIn, w.tokensOut, api, fx);
      if (per === null) return fail(w.id + ': tokens');
      const line = { id: 'cloud-api-' + w.id, side: 'cloud', label: w.name + ' — ' + api.provider + ' ' + api.model + ' at list price', perYear: Y((i) => w.perMonth * grow(i) * 12 * per) };
      if (w.basis === 'measured') lines.push({ ...line, basis: 'list-price', source: api.source, checked: api.checked });
      else lines.push({ ...line, basis: 'estimate', why: 'list price × estimated tokens per item (' + w.tokensIn + ' in / ' + w.tokensOut + ' out)' });
    }
  }
  // ── the team and the compliance work, both sides, rising with CPI ──
  const sal = P.salaries && P.salaries.roles;
  if (!isObj(sal)) return fail('salaries');
  for (const side of SIDES) {
    let cost = 0;
    for (const r of S[side] || []) {
      if (!isObj(r) || !isNum(r.fte) || r.fte < 0 || !isObj(sal[r.soc]) || !isNum(sal[r.soc].median)) return fail(side + ' staff: each role needs fte and an ONS occupation code with a median');
      cost += r.fte * sal[r.soc].median * S.onCost.value;
    }
    const fte = (S[side] || []).reduce((a, r) => a + r.fte, 0);
    lines.push({ id: side + '-team', side, label: 'The team that runs it: ' + fte + ' FTE (' + (S[side] || []).map((r) => r.role).join('; ') + ')', basis: 'estimate', why: 'ONS ASHE 2025 median salaries × ' + S.onCost.value + ' on-cost, rising with CPI; the team size is this design\'s assumption', perYear: Y((i) => cost * infl(i)) });
  }
  const CP = C.compliance;
  if (!isObj(CP) || !isObj(CP.dayRate) || !isNum(CP.dayRate.value) || CP.dayRate.value < 0) return fail('compliance');
  for (const side of SIDES) {
    const d = CP[side];
    if (!isObj(d) || !isNum(d.daysYear1) || !isNum(d.daysPerYear) || d.daysYear1 < 0 || d.daysPerYear < 0) return fail(side + ' compliance days');
    lines.push({ id: side + '-compliance', side, label: 'Compliance work: ' + d.why, basis: 'assumption', why: d.daysYear1 + ' days in year 1, then ' + d.daysPerYear + ' a year, at ' + CP.dayRate.value + ' a day, rising with CPI', perYear: Y((i) => (i === 0 ? d.daysYear1 : d.daysPerYear) * CP.dayRate.value * infl(i)) });
  }
  // ── the rented back office: SaaS rent on the corporate side; on the local-first side the estate organ that replaces
  //    it, with rent paid until cut-over and a one-off hardening cost set by the organ's rung on the ladder ──
  const saas = [];
  if (C.saas !== undefined) {
    const SA = C.saas, O = m.organs;
    if (!isObj(SA) || !Array.isArray(SA.stack) || !isObj(SA.cutoverYear) || !Number.isInteger(SA.cutoverYear.value) || SA.cutoverYear.value < 1 || !isObj(SA.hardeningDays) || !isObj(SA.syncDays) || !isNum(SA.syncDays.value) || SA.syncDays.value < 0) return fail('company.saas: stack, cutoverYear, hardeningDays and syncDays');
    if (!isObj(O) || !Array.isArray(O.functions)) return fail('the organ map (sources/organs.json) for the SaaS layer');
    const cut = SA.cutoverYear.value, dayRate = CP.dayRate.value;
    let replacedAny = false;
    for (const s of SA.stack) {
      if (!isObj(s) || !isStr(s.fn) || !isStr(s.rent) || !Number.isInteger(s.users) || s.users < 0) return fail('each SaaS line needs fn, rent and whole users');
      const e = (P.saas || []).find((x) => isObj(x) && x.id === s.rent);
      if (!e) return fail(s.fn + ': the prices have no subscription ' + s.rent);
      const monthly = toGbp(exVat(e.price, e.vat, vatRate), e.currency, fx);
      if (monthly === null) return fail(s.fn + ': ' + s.rent + ' cannot be priced in pounds');
      const r = O.functions.find((x) => isObj(x) && x.fn === s.fn);
      if (!r) return fail(s.fn + ': the organ map has no such function');
      const rent = Y((i) => s.users * monthly * 12 * infl(i));
      lines.push({ id: 'cloud-saas-' + s.fn, side: 'cloud', label: s.users + ' × ' + e.product + ' (' + e.per + '), rising with CPI', basis: 'list-price', source: e.source, checked: e.checked, perYear: rent });
      if (r.replaced !== true) {
        lines.push({ id: 'local-saas-' + s.fn, side: 'local', label: e.product + ' kept — ' + (isStr(r.why) ? r.why : 'no estate organ replaces it'), basis: 'list-price', source: e.source, checked: e.checked, perYear: rent });
        saas.push({ fn: s.fn, product: e.product, users: s.users, replaced: false, organ: null, tier: null });
        continue;
      }
      const days = SA.hardeningDays[r.tier];
      if (!isNum(days) || days < 0) return fail(s.fn + ': hardening days for a ' + String(r.tier) + ' organ');
      replacedAny = true;
      lines.push({ id: 'local-saas-' + s.fn, side: 'local', label: e.product + ' rent until ' + (r.organName || r.organ) + ' takes over in year ' + cut, basis: 'list-price', source: e.source, checked: e.checked, perYear: Y((i) => (i < cut - 1 ? rent[i] : 0)) });
      lines.push({ id: 'local-harden-' + s.fn, side: 'local', label: 'Hardening ' + (r.organName || r.organ) + ' for the bank (' + days + ' days, organ ' + r.tier + ' on the ladder)', basis: 'assumption', why: days + ' engineering days for a ' + r.tier + ' organ at ' + dayRate + ' a day, in year 1: its named gaps, single sign-on, the bank\'s connectors and the migration', perYear: Y((i) => (i === 0 ? days * dayRate : 0)) });
      saas.push({ fn: s.fn, product: e.product, users: s.users, replaced: true, organ: r.organ, organName: r.organName || r.organ, tier: r.tier });
    }
    if (replacedAny) lines.push({ id: 'local-saas-sync', side: 'local', label: 'Shared records on the company\'s own mesh for the replaced apps (' + SA.syncDays.value + ' days, once)', basis: 'assumption', why: SA.syncDays.value + ' engineering days at ' + dayRate + ' a day in year 1: the estate apps keep each browser\'s records locally today, so a shared, signed record across the team is built once for all of them', perYear: Y((i) => (i === 0 ? SA.syncDays.value * dayRate : 0)) });
  }
  // ── the local-first side: the AI does the work, on the machines already owned; its extra cost is the power ──
  const el = P.electricity;
  if (!isObj(el) || !isNum(el.pencePerKwh) || !isObj(fl.watts) || !isNum(fl.watts.value) || fl.watts.value < 0) return fail('electricity and the floor watts');
  lines.push({ id: 'local-power', side: 'local', label: 'Electricity for the AI work on the laptops (' + Math.round(cap.perYear[0].laptopHours).toLocaleString('en-GB') + ' laptop-hours a month in year 1)', basis: 'estimate', why: 'laptop-hours (measured and fitted) × ' + fl.watts.value + ' W × ' + el.pencePerKwh + 'p/kWh (DESNZ non-domestic), rising with CPI', perYear: Y((i) => cap.perYear[i].laptopHours * 12 * fl.watts.value / 1000 * el.pencePerKwh / 100 * infl(i)) });
  lines.push({ id: 'local-staff-time', side: 'local', label: 'Staff time on the same work: the AI does it', basis: 'assumption', why: 'the open models on the floor do the triage, screening, routing and extraction; the people who approve and confirm are on both sides and not counted', perYear: Y(() => 0) });
  lines.push({ id: 'local-hardware', side: 'local', label: 'New hardware: none — the same laptops the corporate side runs Copilot on', basis: 'assumption', why: C.hardware && isStr(C.hardware.why) ? C.hardware.why : 'the same laptops on both sides', perYear: Y(() => 0) });
  lines.push({ id: 'local-models', side: 'local', label: 'Model licences: Qwen2.5-1.5B-Instruct under Apache 2.0', basis: 'list-price', source: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct', checked: P.checked, perYear: Y(() => 0) });
  const t = tco(lines, years);
  if (!t.ok) return t;
  const line = (id) => t.lines.find((l) => l.id === id);
  return {
    ok: true, capacity: cap, tco: t, rates: { perIn: rates.perIn, perOut: rates.perOut }, corporate: ch.corporate,
    seats: seatsN, seatProduct: seat.product, apiModel: api.provider + ' ' + api.model,
    staffHoursPerMonth: r2(staffHours), hoursPerYear: r2(staffHours * 12), fte: Math.round((staffHours / ST.hoursPerFte.value) * 10) / 10, staffHoursByWork: byWork.map((b) => ({ id: b.id, hoursPerMonth: r2(b.hoursPerMonth) })),
    aiCost: line('local-power').total, seatCost: line('cloud-seats').total,
    aiVsSeats: line('local-power').total > 0 ? Math.round(line('cloud-seats').total / line('local-power').total) : null,
    saas: { lines: saas, rent: r2(t.lines.filter((l) => l.id.startsWith('cloud-saas-')).reduce((x, l) => x + l.total, 0)), local: r2(t.lines.filter((l) => l.id.startsWith('local-saas-') || l.id.startsWith('local-harden-')).reduce((x, l) => x + l.total, 0)) },
    saving: t.total.difference, savingShare: t.total.cloud > 0 ? Math.round((t.total.difference / t.total.cloud) * 1000) / 1000 : null,
    warnings,
  };
}

/** sensitivity(m, scenarios) — what a CFO will push on. Each scenario sets one or more levers and re-runs the whole
 *  plan. A lever's value is a number (an assumption) or the path of a figure in the prices ('wageMedian.value'), so a
 *  sourced figure keeps its source. worst is the smallest saving across the scenarios. */
export const LEVERS = ['timeSaved', 'wage', 'cpi', 'growth', 'watts', 'cutover', 'hardening'];
const fromPrices = (P, v) => {
  if (isNum(v)) return v;
  if (!isStr(v)) return null;
  let x = P;
  for (const k of v.split('.')) { if (!isObj(x)) return null; x = x[k]; }
  return isNum(x) ? x : null;
};
export function sensitivity(m, scenarios) {
  if (!Array.isArray(scenarios)) return fail('sensitivity needs a list of scenarios');
  const base = plan(m);
  if (!base.ok) return base;
  const rows = [];
  for (const s of scenarios) {
    if (!isObj(s) || !isStr(s.id) || !isObj(s.set) || Object.keys(s.set).length === 0) return fail('each scenario needs an id and at least one lever');
    const v = {};
    for (const [k, raw] of Object.entries(s.set)) {
      if (!LEVERS.includes(k)) return fail(s.id + ': ' + k + ' is not a lever (' + LEVERS.join(', ') + ')');
      v[k] = fromPrices(m.prices, raw);
      if (v[k] === null) return fail(s.id + ': ' + k + ' must be a number or the path of a figure in the prices');
    }
    const C = { ...m.company }, P = { ...m.prices };
    if ('timeSaved' in v) C.workloads = C.workloads.map((w) => ({ ...w, secondsSaved: w.secondsSaved * v.timeSaved }));
    if ('growth' in v) C.growth = { ...C.growth, value: v.growth };
    if ('watts' in v) C.floor = { ...C.floor, watts: { ...C.floor.watts, value: v.watts } };
    if ('wage' in v) P.wage = { ...P.wage, value: v.wage };
    if ('cpi' in v) P.cpi = { ...P.cpi, value: v.cpi };
    if ('cutover' in v || 'hardening' in v) {
      if (!isObj(C.saas)) return fail(s.id + ': the cutover and hardening levers need company.saas');   // a passing base plan has already checked the rest
      const HD = C.saas.hardeningDays;
      C.saas = { ...C.saas, cutoverYear: 'cutover' in v ? { ...C.saas.cutoverYear, value: v.cutover } : C.saas.cutoverYear,
        hardeningDays: 'hardening' in v ? Object.fromEntries(Object.entries(HD).map(([k, d]) => [k, isNum(d) ? d * v.hardening : d])) : HD,
        syncDays: 'hardening' in v && isObj(C.saas.syncDays) ? { ...C.saas.syncDays, value: C.saas.syncDays.value * v.hardening } : C.saas.syncDays };
    }
    const p = plan({ ...m, company: C, prices: P });
    if (!p.ok) return fail(s.id + ': ' + p.why);
    rows.push({ id: s.id, values: v, cloud: p.tco.total.cloud, local: p.tco.total.local, saving: p.saving, savingShare: p.savingShare, fte: p.fte, aiCost: p.aiCost, vsBase: r2(p.saving - base.saving) });
  }
  return { ok: true, base: { cloud: base.tco.total.cloud, local: base.tco.total.local, saving: base.saving, savingShare: base.savingShare, fte: base.fte, aiCost: base.aiCost }, rows, worst: rows.length ? Math.min(...rows.map((r) => r.saving)) : null };
}

/** seatShareBreakEven(m) — what has to be true: the share of knowledge workers who would otherwise get a seat above
 *  which local-first costs less over the horizon. The corporate total is linear in the seat share (everything else
 *  on both sides does not depend on it), so two plans pin the line. null when seats change nothing. */
export function seatShareBreakEven(m) {
  if (!isObj(m)) return fail('seatShareBreakEven needs the same input as plan');
  const at = (s) => plan({ ...m, choices: { ...(isObj(m.choices) ? m.choices : {}), seatShare: s } });
  const p0 = at(0), p1 = at(1);
  if (!p0.ok) return p0;
  if (!p1.ok) return p1;
  const slope = p1.tco.total.cloud - p0.tco.total.cloud;
  if (slope <= 0) return { ok: true, share: null, why: 'seats add nothing to the corporate side' };
  const s = (p0.tco.total.local - p0.tco.total.cloud) / slope;
  return { ok: true, share: Math.round(s * 1000) / 1000, localAlwaysCheaper: s <= 0, cloudAlwaysCheaper: s > 1 };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COMPLIANCE MAP — obligations(), DEPLOYMENTS and STATUSES are the estate compliance kernel (comply.mjs), pulled
// verbatim from fall-euaiact with its tests and law (law/law.json); CI checks the copy against the pinned original.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE GO / NO-GO BOARD — each deployment decision is a dual-map case built from fallfloor's receipted evidence.
// E⁺ (the witness) is what the evidence supports; E⁻ (the adversary) is the evidence-supported way it fails; one
// severe, evidence-backed failure BLOCKs, and an unmeasured risk holds the decision at PENDING (never a BLOCK).
// Method: Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "From GEP Stabilization to
// Dual-Map Ethical Reasoning," Derivation v0.2. The thresholds are this design's policy, published and changeable.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export const DECISIONS = ['support-unsupervised', 'support-assisted', 'screening-auto', 'screening-review', 'hr-routing', 'floor-async', 'credit-decisions'];
const clip = (x) => Math.min(1, Math.max(0, Math.round(x * 1e6) / 1e6));   // rounded: a ratio of 0.15 / 0.3 is 0.5, not 0.5000000000000001
const neg0 = () => ({ observed: { score: 0, class: 'observed' }, sensitivity: { score: 0, class: 'derived' }, stable: { score: 0, class: 'derived' }, persistence: { score: 0, class: 'derived' }, irreversibility: { score: 0, class: 'derived' }, unknown: { score: 0, class: 'unknown' } });

/** gateCase(id, ev, policy) → a dual-map case input (see dualmap.decide). */
export function gateCase(id, ev, policy) {
  if (!DECISIONS.includes(id)) return fail('unknown decision: ' + String(id));
  if (!isObj(ev) || !isObj(ev.support) || !isObj(ev.security) || !isObj(ev.hr)) return fail('evidence needs support, security and hr');
  if (!isObj(policy)) return fail('policy');
  const num = (v) => (isNum(v) ? v : NaN);
  const S = ev.support, X = ev.security, H = ev.hr;
  const noLoss = S.lostChain === 0 && S.lostPool === 0 ? 1 : 0;
  const receipts = isObj(ev.from) && isNum(ev.from.hops) && ev.from.hops > 0 ? 1 : 0;
  const toa = { truth: receipts, openness: isObj(ev.preregistered) ? 1 : 0, accountability: policy.ownerAssigned === true ? 1 : 0 };
  const coverage = (n) => clip(num(n) / num(policy.minItems));
  const c = { action: id, positive: [], negative: neg0(), toa, law: { status: null, nonlegalCoverage: 1 }, coverage: 1, humanReviewRequired: false };
  if (id === 'support-unsupervised') {
    c.positive = [{ id: 'end-to-end accuracy', support: num(S.e2e), weight: 3 }, { id: 'nothing lost', support: noLoss, weight: 1 }, { id: 'receipts verified', support: receipts, weight: 1 }];
    c.negative.observed = { score: clip(num(S.silent) / num(policy.maxSilentErrorRate)), class: 'observed' };
    c.negative.irreversibility = { score: 0.5, class: 'derived' };   // a sent reply cannot be unsent
    c.coverage = coverage(S.items);
  } else if (id === 'support-assisted') {
    c.positive = [{ id: 'end-to-end accuracy', support: num(S.e2e), weight: 3 }, { id: 'reply gate pass rate', support: num(S.replyPass), weight: 1 }, { id: 'nothing lost', support: noLoss, weight: 1 }];
    c.negative.unknown = { score: clip(num(policy.unmeasuredAgentCatch)), class: 'unknown' };   // how often an agent catches a wrong draft: not measured yet
    c.coverage = coverage(S.items);
  } else if (id === 'screening-auto' || id === 'screening-review') {
    const pos = num(X.caught) + num(X.missed), negs = num(X.wronglyFlagged) + num(X.correctlyPassed);
    const recall = pos > 0 ? num(X.caught) / pos : 0, fpr = negs > 0 ? num(X.wronglyFlagged) / negs : 1;
    c.positive = [{ id: 'spam caught', support: recall, weight: 2 }, { id: 'nothing lost', support: noLoss, weight: 1 }];
    const limit = id === 'screening-auto' ? num(policy.maxAutoFalseFlagRate) : num(policy.maxReviewFalseFlagRate);
    c.negative.observed = { score: clip(fpr / limit), class: 'observed' };
    c.negative.unknown = { score: clip(1 - pos / num(policy.minPositiveSamples)), class: 'unknown' };   // too few spam items to trust the catch rate
    c.coverage = coverage(X.items);
  } else if (id === 'hr-routing') {
    c.positive = [{ id: 'routing accuracy', support: num(H.accuracy), weight: 3 }, { id: 'nothing lost', support: noLoss, weight: 1 }, { id: 'receipts verified', support: receipts, weight: 1 }];
    c.negative.observed = { score: clip((1 - num(H.accuracy)) / num(policy.routingMaxErrorRate)), class: 'observed' };
    c.negative.irreversibility = { score: 0.1, class: 'derived' };   // a misrouted question costs one more hop
    c.coverage = coverage(H.items);
  } else if (id === 'floor-async') {
    c.positive = [{ id: 'nothing lost when a node died', support: noLoss, weight: 2 }, { id: 'receipts verified', support: receipts, weight: 2 }, { id: 'cold start inside the bar', support: isNum(ev.coldStartSecMax) && ev.coldStartSecMax <= 600 ? 1 : 0, weight: 1 }];
    c.negative.observed = { score: clip(num(S.p95Sec) / num(policy.asyncP95Sec)), class: 'observed' };
    c.coverage = coverage(S.items);
  } else {   // credit-decisions: no evidence exists, and it is high-risk — unknown is not guilt, so it can only be PENDING
    c.negative.unknown = { score: 1, class: 'unknown' };
    c.coverage = 0;
    c.humanReviewRequired = true;
  }
  if (c.positive.some((p) => !isNum(p.support)) || Object.values(c.negative).some((n) => !isNum(n.score)) || !isNum(c.coverage)) return fail(id + ': the evidence or the policy is missing a number');
  return { ok: true, case: c };
}

/** board(ev, policy, createdAt) — every decision, decided and sealed into a self-verifying receipt. */
export function board(ev, policy, createdAt) {
  if (!isStr(createdAt)) return fail('board needs the time it is sealed at (the kernel has no clock)');
  const rows = [];
  for (const id of DECISIONS) {
    const g = gateCase(id, ev, policy);
    if (!g.ok) return g;
    const s = seal(g.case, { createdAt });
    if (!s.ok) return s;
    rows.push({ id, verdict: s.receipt.verdict, positive: Math.round(s.receipt.positiveScore * 1000) / 1000, negative: Math.round(s.receipt.negativeScore * 1000) / 1000, reasons: s.receipt.reasons, receipt: s.receipt });
  }
  const tally = { PASS: 0, BLOCK: 0, PENDING: 0 };
  for (const r of rows) tally[r.verdict]++;
  return { ok: true, rows, tally, boardHash: sha256(canon(rows.map((r) => r.receipt.receiptHash))).hash };
}

export { verifyReceipt, decide, DEPLOYMENTS, STATUSES, obligations };
