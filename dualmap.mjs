// dual-map · dualmap.mjs — a decision gate with TWO maps that cannot average each other away.
//
// WHAT IT IS, in the estate's own words: witness = E⁺ (the positive map — what evidence SUPPORTS
// this action), adversary = E⁻ (the negative map — the evidence-supported conditions under which it
// FAILS). The estate's `witness` attacks CODE (flip an operator, demand the test catch it); this
// attacks a DECISION (assume the trusted reference is wrong, demand the verdict survive). One severe,
// well-supported failure BLOCKS — a high positive score can never buy it back. That non-compensating
// veto is the whole point.
//
// ⚑⚑ CREDIT: this kernel is a faithful implementation of the derivation in
//   Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC — "From GEP Stabilization to
//   Dual-Map Ethical Reasoning," Derivation v0.2 (2026).
// Vendored verbatim from sjgant80-hub/dual-map @ 3ca840f (2026-09-21); only this credit line was expanded to the
// full form the estate uses.
// The positive/negative maps, the non-compensating max aggregator, the TOA hard gate, the
// law-is-evidence-not-verdict constraint, PASS/BLOCK/PENDING with PENDING first-class, the Tsallis
// escort weighting at the nominal Ethical baseline q_E,0 = 0.7, and the audit-receipt schema are all
// Gary's. As he states: 0.7 is a reproducible NOMINAL baseline, NOT a universal moral constant; the
// weights and thresholds here are explicit defaults, auditable and overridable, never claimed optimal.
//
// Pure and total: garbage in -> a structured verdict (never PASS on malformed input) -> never throws.
// No I/O, no clock (timestamps are passed in by the caller, same discipline as every estate receipt).

import { sha256, canon } from './hash.mjs';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isArr = Array.isArray;
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v) => (isNum(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

// Gary W. Floyd, Dual-Map v0.2, §2: the NOMINAL Ethical baseline. Explicitly NOT a universal constant.
export const Q_BASELINE = 0.7;
const P_FLOOR = 1e-9; // §3 zero-collapse guard so p^q stays finite.

// The six negative-evidence components (§12). E⁻ = max of these (§13, non-compensating).
export const NEGATIVE_KEYS = ['observed', 'sensitivity', 'stable', 'persistence', 'irreversibility', 'unknown'];
// §22 evidence classes. Only these three are "evidence-backed"; `unknown` is the fourth class —
// evidence AGAINST unwarranted certainty (§12.6: "Unknown is not evidence of guilt"), so it can force
// PENDING but must never on its own manufacture a BLOCK. A missing/invalid class is downgraded to
// `unknown` — you cannot convert an unbounded "possible" into "true" (§22).
const EVIDENCE_BACKED = ['observed', 'derived', 'counterfactual-bounded'];

export const DEFAULT_THRESHOLDS = Object.freeze({
  tauPlus: 0.6,   // E⁺ must reach this to support PASS
  tauMinus: 0.5,  // E⁻ above this blocks PASS (=> PENDING)
  tauBlock: 0.8,  // E⁻ at/above this, evidence-backed, is a hard BLOCK
  tauT: 0.6, tauO: 0.6, tauA: 0.6, // TOA gate thresholds
  tauC: 0.5,      // evidence-coverage floor (also the non-legal coverage floor)
});

/** escortPositive(items, q) — Gary §4/§10: the q-weighted positive map
 *  E⁺_q = Σ p_i^q s_i / Σ p_i^q (Tsallis escort). For q<1 it flattens the weighting, so a low-prior
 *  but strong item keeps real pull — minority counterevidence stays visible. items: [{support, weight}]
 *  with support s ∈ [0,1], weight p ≥ 0. Returns { ok, value } (value 0 when no admissible evidence). */
export function escortPositive(items, q = Q_BASELINE) {
  if (!isArr(items)) return { ok: false, why: 'positive evidence must be an array' };
  const qq = isNum(q) && q > 0 ? q : Q_BASELINE;
  let num = 0, den = 0, n = 0;
  for (const it of items) {
    if (!isObj(it)) continue;
    const s = clamp01(it.support);
    const p = isNum(it.weight) && it.weight > 0 ? it.weight : 0;
    if (p <= 0) continue;
    const w = Math.pow(Math.max(p, P_FLOOR), qq);
    num += w * s;
    den += w;
    n += 1;
  }
  if (den <= 0) return { ok: true, value: 0, count: 0 }; // no admissible support => no positive case
  return { ok: true, value: num / den, count: n };
}

/** toaGate(toa, th) — Gary §11: Truth / Openness / Accountability is a HARD gate, never a score to
 *  average. G_TOA = 1 iff all three clear their thresholds. If it fails, PASS is impossible. */
export function toaGate(toa, th = DEFAULT_THRESHOLDS) {
  const t = clamp01(isObj(toa) ? toa.truth : undefined);
  const o = clamp01(isObj(toa) ? toa.openness : undefined);
  const a = clamp01(isObj(toa) ? toa.accountability : undefined);
  const failed = [];
  if (t < th.tauT) failed.push('truth');
  if (o < th.tauO) failed.push('openness');
  if (a < th.tauA) failed.push('accountability');
  return { pass: failed.length === 0, truth: t, openness: o, accountability: a, failed };
}

/** negativeMap(neg) — Gary §12/§13: the adversary. E⁻ = max(N_obs, N_sens, N_stable, N_persist,
 *  N_irr, N_unknown). Each component is { score ∈ [0,1], class }. A component whose class is not an
 *  evidence-backed class (observed / derived / counterfactual-bounded) is admitted only as `unknown`
 *  — it can raise PENDING but not, by itself, a BLOCK. */
export function negativeMap(neg) {
  const src = isObj(neg) ? neg : {};
  const components = {};
  let Eminus = 0, dominant = null, dominantClass = 'unknown';
  let unknownScore = 0, evidenceBackedPresent = false;
  for (const key of NEGATIVE_KEYS) {
    const c = isObj(src[key]) ? src[key] : {};
    const score = clamp01(c.score);
    let cls = isStr(c.class) ? c.class : 'unknown';
    // `unknown` component is inherently the unknown class; everything else must EARN an evidence class.
    if (key === 'unknown') cls = 'unknown';
    else if (!EVIDENCE_BACKED.includes(cls)) cls = 'unknown'; // §22: "possible" is not "true"
    const backed = EVIDENCE_BACKED.includes(cls);
    if (backed && score > 0) evidenceBackedPresent = true;
    if (cls === 'unknown') unknownScore = Math.max(unknownScore, score);
    components[key] = { score, class: cls, backed };
    if (score > Eminus) { Eminus = score; dominant = key; dominantClass = cls; }
  }
  return { ok: true, Eminus, dominant, dominantClass, unknownScore, evidenceBackedPresent, components };
}

/**
 * decide(caseInput) — run both maps and return the verdict + every field a receipt needs.
 * caseInput = {
 *   action, positive:[{id,support,weight}], negative:{observed,sensitivity,stable,persistence,
 *   irreversibility,unknown each {score,class}}, toa:{truth,openness,accountability},
 *   law:{status:0|1, nonlegalCoverage}, coverage, humanReviewRequired, q, thresholds
 * }
 * verdict ∈ PASS | BLOCK | PENDING, and PENDING ("I DON'T KNOW", §19) is a first-class result.
 */
export function decide(caseInput) {
  if (!isObj(caseInput)) return { ok: false, why: 'a decision case is an object' };
  const th = { ...DEFAULT_THRESHOLDS, ...(isObj(caseInput.thresholds) ? caseInput.thresholds : {}) };
  const q = isNum(caseInput.q) && caseInput.q > 0 ? caseInput.q : Q_BASELINE;

  const pos = escortPositive(isArr(caseInput.positive) ? caseInput.positive : [], q);
  const Eplus = pos.ok ? pos.value : 0;
  const toa = toaGate(caseInput.toa, th);
  const neg = negativeMap(caseInput.negative);
  const Eminus = neg.Eminus;

  const law = isObj(caseInput.law) ? caseInput.law : {};
  const legal = law.status === 1 ? 1 : law.status === 0 ? 0 : null;
  const nonlegalCoverage = clamp01(law.nonlegalCoverage);
  const coverage = clamp01(caseInput.coverage);
  const humanReviewRequired = caseInput.humanReviewRequired === true;

  // ── the decision, in order (§16/§19). E⁺ can only ADD the requirement E⁺≥τ⁺; it can never
  //    lift the verdict over a failed gate or a severe adversary. Non-compensating by construction. ──
  let verdict, reasons = [];

  // 1. Hard BLOCK: an evidence-backed severe failure. Unknown-class severe is NOT a block (§12.6).
  if (Eminus >= th.tauBlock && EVIDENCE_BACKED.includes(neg.dominantClass)) {
    verdict = 'BLOCK';
    reasons.push(`severe evidence-backed negative (${neg.dominant}=${Eminus.toFixed(2)} ≥ ${th.tauBlock}) — non-compensating`);
  } else {
    // 2. Not blocked — is it a clean PASS, or PENDING ("I don't know")?
    if (!toa.pass) reasons.push('TOA gate failed: ' + toa.failed.join(', '));
    if (Eplus < th.tauPlus) reasons.push(`positive support below threshold (E⁺=${Eplus.toFixed(2)}, need ${th.tauPlus})`);
    if (Eminus > th.tauMinus) reasons.push(`negative evidence above tolerance (E⁻=${Eminus.toFixed(2)}, limit ${th.tauMinus})`);
    if (coverage < th.tauC) reasons.push(`evidence coverage insufficient (C=${coverage.toFixed(2)}, need ${th.tauC})`);
    if (legal === 1 && nonlegalCoverage < th.tauC) reasons.push('legal-only: legal but independent non-legal ethical coverage is insufficient (law is evidence, not a PASS)');
    if (neg.unknownScore >= th.tauMinus) reasons.push(`critical unknown unresolved (N_unknown=${neg.unknownScore.toFixed(2)})`);
    if (humanReviewRequired) reasons.push('human ethical approval required');
    verdict = reasons.length === 0 ? 'PASS' : 'PENDING';
  }

  return {
    ok: true,
    verdict,
    action: isStr(caseInput.action) ? caseInput.action : null,
    positiveScore: Eplus,               // E⁺ — the witness
    negativeScore: Eminus,              // E⁻ — the adversary
    negative: neg.components,           // the six components, each with its evidence class
    dominantNegative: neg.dominant,
    toa: { truth: toa.truth, openness: toa.openness, accountability: toa.accountability, gate: toa.pass ? 1 : 0 },
    legalStatus: legal,
    legalIsDispositive: false,          // §15: law is one evidence channel, never the verdict
    nonlegalCoverage,
    evidenceCoverage: coverage,
    counterevidencePresent: neg.evidenceBackedPresent,
    criticalUnknown: neg.unknownScore,
    humanReviewRequired,
    qBaseline: Q_BASELINE,
    qOperational: q,
    thresholds: th,
    reasons,
  };
}

// The receipt body: every field a verdict is derived from + the verdict, in a stable order, so the
// receipt_hash covers the whole thing (a tamper to any field is caught on the way back in).
function receiptBody(decision, meta) {
  return {
    kind: 'dual-map-ethics-receipt', v: 1,
    createdAt: isStr(meta && meta.createdAt) ? meta.createdAt : null,
    action: decision.action,
    verdict: decision.verdict,
    positiveScore: decision.positiveScore,
    negativeScore: decision.negativeScore,
    negative: decision.negative,
    dominantNegative: decision.dominantNegative,
    toa: decision.toa,
    legalStatus: decision.legalStatus,
    legalIsDispositive: decision.legalIsDispositive,
    nonlegalCoverage: decision.nonlegalCoverage,
    evidenceCoverage: decision.evidenceCoverage,
    counterevidencePresent: decision.counterevidencePresent,
    criticalUnknown: decision.criticalUnknown,
    humanReviewRequired: decision.humanReviewRequired,
    qBaseline: decision.qBaseline,
    qOperational: decision.qOperational,
    thresholds: decision.thresholds,
    reasons: decision.reasons,
  };
}

/** seal(caseInput, meta) — decide, then bind it into a self-verifying audit receipt (§24). The
 *  derivation_hash pins the exact inputs; the receipt_hash pins the whole verdict body. meta.createdAt
 *  is the caller's timestamp (this kernel has no clock). */
export function seal(caseInput, meta) {
  const decision = decide(caseInput);
  if (!decision.ok) return decision;
  const dh = sha256(canon(caseInput));
  if (!dh.ok) return { ok: false, why: 'could not hash the decision inputs' };
  const body = { ...receiptBody(decision, meta), derivationHash: dh.hash };
  const rh = sha256(canon(body));
  if (!rh.ok) return { ok: false, why: 'could not hash the receipt body' };
  return { ok: true, receipt: { ...body, receiptHash: rh.hash } };
}

/** verifyReceipt(receipt) — recompute the receipt hash over every field and refuse on any
 *  disagreement. A verdict flipped from BLOCK to PASS, or a lowered negativeScore, is caught here —
 *  never trusts the receipt's own claim about itself. */
export function verifyReceipt(receipt) {
  if (!isObj(receipt)) return { ok: false, why: 'not a dual-map receipt' };
  if (receipt.kind !== 'dual-map-ethics-receipt') return { ok: false, why: 'not a dual-map-ethics-receipt' };
  if (receipt.v !== 1) return { ok: false, why: `unknown receipt version ${String(receipt.v)}` };
  if (!isStr(receipt.receiptHash) || !isStr(receipt.derivationHash)) return { ok: false, why: 'the receipt carries no hash' };
  const { receiptHash, ...body } = receipt;
  const rh = sha256(canon(body));
  if (!rh.ok) return { ok: true, valid: false, why: 'could not recompute the receipt hash' };
  if (rh.hash !== receiptHash) return { ok: true, valid: false, why: 'the receipt hash does not match its fields — the receipt was edited after it was sealed' };
  return { ok: true, valid: true, verdict: receipt.verdict, why: 'receipt intact — verdict and every field agree with the sealed hash' };
}
