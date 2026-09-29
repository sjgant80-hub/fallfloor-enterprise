// fallfloor-enterprise · kernel.mjs — the reference design's arithmetic and rules. Pure and total: no I/O, no clock,
// garbage in → a structured refusal, never an exception. The page runs this exact file (tools/make-page.mjs inlines it),
// CI mutation-gates it, and every number the page shows is computed here from sourced inputs.
//
//   sourced figures · capacity (laptop floor + core nodes) · 5-year cost, both sides, every line with its basis ·
//   the compliance map (who holds which duty, on which stack) · the go/no-go board (a dual-map gate per decision,
//   fed by fallfloor's receipted evidence).
//
// The go/no-go board uses dualmap.mjs — a faithful implementation of Gary W. Floyd, Lumiea Systems Research
// Division — ThunderStruck Service LLC — "From GEP Stabilization to Dual-Map Ethical Reasoning," Derivation v0.2.
import { sha256, canon } from './hash.mjs';
import { decide, seal, verifyReceipt } from './dualmap.mjs';

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
// CAPACITY — the laptop floor from MEASURED seconds per item; the core nodes from a bandwidth-bound planning figure
// ══════════════════════════════════════════════════════════════════════════════════════════════════
/** coreSecondsPerItem(tokensIn, tokensOut, core) — read the prompt at prefillTokPerSec, then generate at
 *  decode = efficiency × bandwidth ÷ weights (generation is memory-bandwidth bound). */
export function coreSecondsPerItem(tokensIn, tokensOut, core) {
  if (!isNum(tokensIn) || !isNum(tokensOut) || tokensIn < 0 || tokensOut < 0 || !isObj(core)) return null;
  const { bandwidthGBs, weightsGB, efficiency, prefillTokPerSec } = core;
  if (![bandwidthGBs, weightsGB, efficiency, prefillTokPerSec].every((v) => isNum(v) && v > 0) || efficiency > 1) return null;
  const decode = (efficiency * bandwidthGBs) / weightsGB;
  return { seconds: tokensIn / prefillTokPerSec + tokensOut / decode, decodeTokPerSec: decode };
}

/** capacity(input) → per year: laptop-floor hours and utilisation, core hours and the nodes needed (N + spare). */
export function capacity(input) {
  if (!isObj(input) || !Array.isArray(input.workloads) || input.workloads.length === 0) return fail('capacity needs workloads');
  const { workloads, floor, core, growth, years } = input;
  if (!isObj(floor) || ![floor.laptops, floor.nodeShare, floor.hoursPerDay, floor.daysPerMonth].every((v) => isNum(v) && v >= 0) || floor.nodeShare > 1) return fail('floor: laptops, nodeShare (0–1), hoursPerDay, daysPerMonth');
  if (!isObj(core) || !isNum(core.hoursPerMonth) || core.hoursPerMonth <= 0 || !isNum(core.targetUtil) || core.targetUtil <= 0 || core.targetUtil > 1 || !Number.isInteger(core.spare) || core.spare < 0) return fail('core: hoursPerMonth, targetUtil (0–1], spare');
  if (!isNum(growth) || growth < -0.5 || growth > 5 || !Number.isInteger(years) || years < 1 || years > 10) return fail('growth and years (1–10)');
  const per = [];
  for (const w of workloads) {
    if (!isObj(w) || !isStr(w.id) || !['laptop', 'core'].includes(w.tier) || !isNum(w.perMonth) || w.perMonth < 0) return fail('each workload: id, tier (laptop|core), perMonth');
    if (w.tier === 'laptop') {
      if (!isNum(w.secondsPerItem) || w.secondsPerItem < 0) return fail(w.id + ': a laptop workload needs its measured seconds per item');
      per.push({ id: w.id, tier: 'laptop', secondsPerItem: w.secondsPerItem, perMonth: w.perMonth });
    } else {
      const c = coreSecondsPerItem(w.tokensIn, w.tokensOut, core);
      if (c === null) return fail(w.id + ': a core workload needs tokensIn, tokensOut and a valid core node');
      per.push({ id: w.id, tier: 'core', secondsPerItem: r2(c.seconds), perMonth: w.perMonth });
    }
  }
  const avail = floor.laptops * floor.nodeShare * floor.hoursPerDay * floor.daysPerMonth;
  const perYear = [];
  for (let y = 0; y < years; y++) {
    const f = Math.pow(1 + growth, y);
    let lap = 0, cor = 0;
    for (const p of per) { const h = (p.perMonth * f * p.secondsPerItem) / 3600; if (p.tier === 'laptop') lap += h; else cor += h; }
    const nodes = cor > 0 ? Math.ceil(cor / (core.hoursPerMonth * core.targetUtil)) + core.spare : 0;
    perYear.push({ year: y + 1, laptopHours: r2(lap), laptopUtil: avail > 0 ? Math.round((lap / avail) * 1000) / 1000 : null, coreHours: r2(cor), coreNodes: nodes, floorOverloaded: lap > avail });
  }
  const dec = coreSecondsPerItem(1, 1, core);
  return { ok: true, laptopHoursAvailable: r2(avail), decodeTokPerSec: dec ? r2(dec.decodeTokPerSec) : null, perWorkload: per, perYear };
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

/** plan(m) — the whole design from its inputs: capacity → cost lines → tco. m = { company, prices, evidence, choices }. */
export function plan(m) {
  if (!isObj(m) || !isObj(m.company) || !isObj(m.prices) || !isObj(m.evidence)) return fail('plan needs company, prices and evidence');
  const C = m.company, P = m.prices, E = m.evidence;
  const ch = { ...(isObj(C.choices) ? C.choices : {}), ...(isObj(m.choices) ? m.choices : {}) };
  const years = C.years, growth = isObj(C.growth) ? C.growth.value : undefined;
  const fx = isObj(P.fx) ? P.fx.gbpPerUsd : undefined, vatRate = isObj(P.vatRate) ? P.vatRate.value : undefined;
  if (!isNum(fx) || !isNum(vatRate)) return fail('prices need fx and vatRate');
  if (!Array.isArray(C.workloads)) return fail('company.workloads');
  // workloads with their tokens and (for the floor) measured seconds
  const wl = [];
  for (const w of C.workloads) {
    if (!isObj(w) || !isStr(w.id)) return fail('each workload needs an id');
    if (w.tokens === 'measured') {
      const ev = E[w.evidence];
      if (!isObj(ev) || !isNum(ev.tokensIn) || !isNum(ev.tokensOut) || !isNum(ev.laptopSecondsPerItem)) return fail(w.id + ': its evidence (' + String(w.evidence) + ') is missing');
      wl.push({ ...w, tokensIn: ev.tokensIn, tokensOut: ev.tokensOut, secondsPerItem: ev.laptopSecondsPerItem, tokenBasis: 'measured' });
    } else if (w.tokens === 'estimate') wl.push({ ...w, tokenBasis: 'estimate' });
    else return fail(w.id + ': tokens must be measured or estimate');
  }
  const node = P.coreNode, core = C.core;
  if (!isObj(node) || !isObj(core) || !isObj(core.model)) return fail('core node and core settings');
  const coreIn = { bandwidthGBs: node.bandwidthGBs, weightsGB: core.model.weightsGB, efficiency: core.efficiency && core.efficiency.value, prefillTokPerSec: core.prefillTokPerSec && core.prefillTokPerSec.value,
    hoursPerMonth: core.hoursPerMonth && core.hoursPerMonth.value, targetUtil: core.targetUtil && core.targetUtil.value, spare: core.spare && core.spare.value };
  const fl = C.floor || {};
  const cap = capacity({ workloads: wl, floor: { laptops: C.profile && C.profile.laptops, nodeShare: fl.nodeShare && fl.nodeShare.value, hoursPerDay: fl.hoursPerDay && fl.hoursPerDay.value, daysPerMonth: fl.daysPerMonth && fl.daysPerMonth.value }, core: coreIn, growth, years });
  if (!cap.ok) return cap;
  const Y = (fn) => Array.from({ length: years }, (_, i) => fn(i));
  const grow = (i) => Math.pow(1 + growth, i);
  const lines = [];

  // ── the corporate / cloud side ──
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
  lines.push({ id: 'cloud-seats', side: 'cloud', label: seatsN + ' × ' + seat.product + ' (' + seat.per + ')', basis: 'list-price', source: seat.source, checked: seat.checked, perYear: Y(() => seatsN * seatGbp * 12) });
  const api = (P.api || []).find((a) => a.id === ch.apiModel);
  if (!api) return fail('unknown API model: ' + String(ch.apiModel));
  for (const w of wl) {
    const viaApi = w.cloud === 'api' || (w.cloud === 'seats' && seat.plusUsage === true);
    if (!viaApi) continue;
    const per = apiCostPerItem(w.tokensIn, w.tokensOut, api, fx);
    if (per === null) return fail(w.id + ': tokens');
    const line = { id: 'cloud-api-' + w.id, side: 'cloud', label: w.name + ' — ' + api.provider + ' ' + api.model + ' at list price', perYear: Y((i) => w.perMonth * grow(i) * 12 * per) };
    if (w.tokenBasis === 'measured') lines.push({ ...line, basis: 'list-price', source: api.source, checked: api.checked });
    else lines.push({ ...line, basis: 'estimate', why: 'list price × estimated tokens per item (' + w.tokensIn + ' in / ' + w.tokensOut + ' out)' });
  }
  // ── staff and compliance, both sides ──
  const S = C.staff, sal = P.salaries && P.salaries.roles;
  if (!isObj(S) || !isObj(sal) || !isObj(S.onCost) || !isNum(S.onCost.value) || S.onCost.value < 1) return fail('staff and salaries');
  for (const side of SIDES) {
    let cost = 0;
    for (const r of S[side] || []) {
      if (!isObj(r) || !isNum(r.fte) || r.fte < 0 || !isObj(sal[r.soc]) || !isNum(sal[r.soc].median)) return fail(side + ' staff: each role needs fte and an ONS occupation code with a median');
      cost += r.fte * sal[r.soc].median * S.onCost.value;
    }
    const fte = (S[side] || []).reduce((a, r) => a + r.fte, 0);
    lines.push({ id: side + '-staff', side, label: fte + ' FTE (' + (S[side] || []).map((r) => r.role).join('; ') + ')', basis: 'estimate', why: 'ONS ASHE 2025 median salaries × ' + S.onCost.value + ' on-cost; team size is this design\'s assumption', perYear: Y(() => cost) });
  }
  const CP = C.compliance;
  if (!isObj(CP) || !isObj(CP.dayRate) || !isNum(CP.dayRate.value) || CP.dayRate.value < 0) return fail('compliance');
  for (const side of SIDES) {
    const d = CP[side];
    if (!isObj(d) || !isNum(d.daysYear1) || !isNum(d.daysPerYear) || d.daysYear1 < 0 || d.daysPerYear < 0) return fail(side + ' compliance days');
    lines.push({ id: side + '-compliance', side, label: 'Compliance work: ' + d.why, basis: 'assumption', why: d.daysYear1 + ' days in year 1, then ' + d.daysPerYear + ' a year, at ' + CP.dayRate.value + ' a day', perYear: Y((i) => (i === 0 ? d.daysYear1 : d.daysPerYear) * CP.dayRate.value) });
  }
  // ── the local-first side ──
  const nodeGbp = toGbp(exVat(node.price, node.vat, vatRate), node.currency, fx);
  if (nodeGbp === null || !isObj(core.lifeYears) || !Number.isInteger(core.lifeYears.value) || core.lifeYears.value < 1) return fail('core node price and lifeYears');
  const life = core.lifeYears.value;
  const bought = [];          // nodes bought per year (new capacity + replacements at end of life)
  for (let i = 0; i < years; i++) {
    const need = cap.perYear[i].coreNodes;
    const alive = bought.reduce((a, b, j) => a + (i - j < life ? b : 0), 0);
    bought.push(Math.max(0, need - alive));
  }
  lines.push({ id: 'local-core-nodes', side: 'local', label: 'Core nodes: ' + node.product + ', bought as capacity grows and replaced every ' + life + ' years', basis: 'list-price', source: node.source, checked: node.checked, perYear: bought.map((b) => b * nodeGbp) });
  const el = P.electricity, lp = P.laptopPower;
  if (!isObj(el) || !isNum(el.pencePerKwh) || !isObj(lp) || !isNum(lp.wattsHigh) || !isNum(node.maxWatts)) return fail('electricity, laptop power, node power');
  lines.push({ id: 'local-core-power', side: 'local', label: 'Core node electricity at the published maximum power, every powered hour', basis: 'estimate', why: node.maxWatts + ' W (Apple spec, maximum continuous) × ' + coreIn.hoursPerMonth + ' h a month × ' + el.pencePerKwh + 'p/kWh (DESNZ) — an upper bound', perYear: Y((i) => cap.perYear[i].coreNodes * node.maxWatts * coreIn.hoursPerMonth * 12 / 1000 * el.pencePerKwh / 100) });
  lines.push({ id: 'local-floor-power', side: 'local', label: 'Laptop electricity for the AI work on the floor', basis: 'estimate', why: 'measured laptop-hours × ' + lp.wattsHigh + ' W (the chip\'s maximum turbo power) × ' + el.pencePerKwh + 'p/kWh (DESNZ) — an upper bound', perYear: Y((i) => cap.perYear[i].laptopHours * 12 * lp.wattsHigh / 1000 * el.pencePerKwh / 100) });
  lines.push({ id: 'local-laptops', side: 'local', label: 'Laptops: already owned and refreshed on the normal cycle', basis: 'assumption', why: 'no new laptops are bought for this; wear is not costed', perYear: Y(() => 0) });
  lines.push({ id: 'local-models', side: 'local', label: 'Model licences: Qwen2.5 Instruct weights under Apache 2.0', basis: 'list-price', source: 'https://huggingface.co/Qwen/Qwen2.5-32B-Instruct', checked: P.checked, perYear: Y(() => 0) });
  const t = tco(lines, years);
  if (!t.ok) return t;
  return { ok: true, capacity: cap, tco: t, seats: seatsN, seatProduct: seat.product, apiModel: api.provider + ' ' + api.model, nodesBought: bought, warnings };
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
// THE COMPLIANCE MAP — for one workload on one stack: which duties apply, from when, and what the stack does to them
// ══════════════════════════════════════════════════════════════════════════════════════════════════
export const DEPLOYMENTS = ['local', 'cloud', 'saas'];
export const STATUSES = ['removed', 'eased', 'yours', 'shared', 'unchanged'];
const CONDITIONS = ['always', 'personalData', 'interactsWithPublic', 'significantDecision', 'highRisk', 'creditScoring', 'euOutput', 'providerAbroad', 'trainsOnPersonalData'];

/** obligations(workload, deployment, duties, ctx) — ctx: { asOf: 'YYYY-MM-DD', providerAbroad: bool }. */
export function obligations(workload, deployment, duties, ctx) {
  if (!isObj(workload) || !isObj(workload.flags)) return fail('a workload with flags');
  if (!DEPLOYMENTS.includes(deployment)) return fail('deployment must be local, cloud or saas');
  if (!Array.isArray(duties)) return fail('duties must be a list');
  if (!isObj(ctx) || !DATE.test(ctx.asOf || '')) return fail('ctx.asOf must be a date');
  const f = { ...workload.flags, always: true, providerAbroad: ctx.providerAbroad === true };   // shown on every stack, so the local column can say 'removed'
  const items = [];
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const d of duties) {
    if (!isObj(d) || !isStr(d.id) || !CONDITIONS.includes(d.appliesIf) || !isObj(d.status) || !STATUSES.includes(d.status[deployment]) || !DATE.test(d.from || '') || !HTTPS.test(d.url || '') || !DATE.test(d.checked || '')) return fail('duty ' + String(d && d.id) + ' is malformed (condition, status per stack, from, https url, checked)');
    if (f[d.appliesIf] !== true) continue;
    const status = d.status[deployment];
    counts[status]++;
    items.push({ id: d.id, ref: d.ref, title: d.title, status, inForce: d.from <= ctx.asOf, from: d.from, note: isObj(d.note) ? d.note[deployment] : '', url: d.url, checked: d.checked });
  }
  const role = deployment === 'saas' ? 'deployer (the vendor is the provider of its assistant)' : 'provider and deployer (the company puts its own AI system into service)';
  return { ok: true, deployment, role, items, counts, applying: items.length };
}

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

export { verifyReceipt, decide };
