// dual-map · dualmap.test.mjs (vendored from sjgant80-hub/dual-map @ 3ca840f) — the falsification program from
// Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC, "From GEP Stabilization to
// Dual-Map Ethical Reasoning," v0.2, §28, plus the non-compensating veto (§13), the escort
// minority-visibility mechanism (§4), and receipt forgery-rejection (§24). Every test is one of
// Gary's own attacks turned into an assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, seal, verifyReceipt, escortPositive, toaGate, negativeMap } from './dualmap.mjs';

// a well-supported, clean action (all gates clear) — the baseline PASS we perturb from.
const clean = () => ({
  action: 'clean-action',
  positive: [{ id: 'p1', support: 0.9, weight: 5 }, { id: 'p2', support: 0.85, weight: 3 }],
  negative: {
    observed: { score: 0.05, class: 'observed' },
    sensitivity: { score: 0.1, class: 'counterfactual-bounded' },
    stable: { score: 0.1, class: 'derived' },
    persistence: { score: 0.05, class: 'observed' },
    irreversibility: { score: 0.05, class: 'observed' },
    unknown: { score: 0.05, class: 'unknown' },
  },
  toa: { truth: 0.9, openness: 0.9, accountability: 0.9 },
  law: { status: 1, nonlegalCoverage: 0.8 },
  coverage: 0.85,
  humanReviewRequired: false,
});

test('baseline: all gates clear -> PASS with no reasons', () => {
  const d = decide(clean());
  assert.equal(d.verdict, 'PASS');
  assert.deepEqual(d.reasons, []);
});

// ── §4: escort weighting keeps minority counterevidence visible ──
test('§4 escort: at q=0.7 a low-weight dissenter pulls E⁺ down MORE than linear q=1', () => {
  const items = [{ support: 1, weight: 10 }, { support: 0, weight: 1 }];
  const linear = escortPositive(items, 1).value;
  const escort = escortPositive(items, 0.7).value;
  assert.ok(escort < linear, `escort ${escort} should be below linear ${linear}`);
  assert.equal(escortPositive([], 0.7).value, 0);
  assert.equal(escortPositive([{ support: 1, weight: 0 }], 0.7).value, 0); // zero weight => no support
});

// ── §11: TOA is a hard gate ──
test('§11 TOA gate is hard: one dimension below threshold blocks PASS', () => {
  assert.equal(toaGate({ truth: 0.9, openness: 0.9, accountability: 0.2 }).pass, false);
  const d = decide({ ...clean(), toa: { truth: 0.9, openness: 0.9, accountability: 0.2 } });
  assert.notEqual(d.verdict, 'PASS');
  assert.ok(d.reasons.some((r) => r.includes('TOA')), 'a TOA reason must be present');
});

// ── §12/§13: the negative map is a max, and the non-compensating veto ──
test('§13 non-compensating: a perfect E⁺ CANNOT buy back one severe evidence-backed E⁻', () => {
  const c = clean();
  c.positive = [{ id: 'p', support: 1, weight: 100 }]; // E⁺ ≈ 1.0, maximal support
  c.negative.observed = { score: 0.9, class: 'observed' }; // one severe, evidence-backed harm
  const d = decide(c);
  assert.equal(d.verdict, 'BLOCK');
  assert.equal(d.dominantNegative, 'observed');
  assert.ok(d.positiveScore > 0.95, 'E⁺ really was near-perfect');
  assert.notEqual(d.verdict, 'PASS');
});

test('negativeMap takes the max of the six and refuses to average', () => {
  const n = negativeMap({ observed: { score: 0.2, class: 'observed' }, stable: { score: 0.7, class: 'derived' } });
  assert.equal(n.Eminus, 0.7);
  assert.equal(n.dominant, 'stable');
});

// ── §28 Test 1: the legal-only trap ──
test('§28.1 legal-only trap: L=1 with insufficient non-legal coverage does NOT produce PASS', () => {
  const c = clean();
  c.law = { status: 1, nonlegalCoverage: 0.1 }; // legal, but no independent ethical coverage
  const d = decide(c);
  assert.notEqual(d.verdict, 'PASS');
  assert.equal(d.verdict, 'PENDING');
  assert.ok(d.reasons.some((r) => r.includes('legal-only')));
  assert.equal(d.legalIsDispositive, false);
});

// ── §15: law is evidence, not the verdict — L=0 with strong ethics can still PASS ──
test('§15 law is evidence: an ILLEGAL action with strong independent ethics is not auto-blocked', () => {
  const c = clean();
  c.law = { status: 0, nonlegalCoverage: 0.9 }; // not legally permitted, but ethically well-supported
  const d = decide(c);
  assert.equal(d.verdict, 'PASS'); // L=0 ⇏ unethical
  assert.equal(d.legalStatus, 0);
});

// ── §28 Test 2 / §14: stable-wrong-authority — high E⁺ but severe assumption/stable sensitivity ──
test('§28.2 stable-wrong-state: strong positive but severe evidence-backed stable-sensitivity -> BLOCK', () => {
  const c = clean();
  c.positive = [{ id: 'p', support: 0.96, weight: 20 }];
  c.negative.stable = { score: 0.91, class: 'derived' }; // §14 worked example: E⁺=0.96, E⁻=0.91
  const d = decide(c);
  assert.equal(d.verdict, 'BLOCK');
  assert.equal(d.dominantNegative, 'stable');
});

// ── §28 Test 6: positive/negative disagreement below the block line -> PENDING ──
test('§28.6 E⁺≫τ⁺ AND E⁻ above tolerance but below block -> PENDING, never PASS', () => {
  const c = clean();
  c.positive = [{ id: 'p', support: 0.95, weight: 20 }];
  c.negative.sensitivity = { score: 0.6, class: 'counterfactual-bounded' }; // > tauMinus(0.5), < tauBlock(0.8)
  const d = decide(c);
  assert.equal(d.verdict, 'PENDING');
  assert.notEqual(d.verdict, 'PASS');
  assert.notEqual(d.verdict, 'BLOCK');
});

// ── §28 Test 7 / §12.6: unknown is not guilt — a critical unknown -> PENDING, not BLOCK, not PASS ──
test('§28.7 critical unknown -> PENDING (not fabricated PASS, and not BLOCK — unknown is not guilt)', () => {
  const c = clean();
  c.negative.unknown = { score: 0.75, class: 'unknown' }; // a materially missing fact
  const d = decide(c);
  assert.equal(d.verdict, 'PENDING');
  assert.notEqual(d.verdict, 'BLOCK'); // §12.6: unknown is evidence against certainty, not of guilt
  assert.ok(d.reasons.some((r) => r.includes('unknown')));
});

test('§22 an unbounded "possible" (no valid evidence class) cannot manufacture a BLOCK', () => {
  const c = clean();
  c.negative.observed = { score: 0.95, class: 'speculation' }; // invalid class -> downgraded to unknown
  const d = decide(c);
  assert.notEqual(d.verdict, 'BLOCK'); // cannot convert "possible" into "true"
  assert.equal(d.negative.observed.class, 'unknown');
  assert.equal(d.negative.observed.backed, false);
});

// ── §19: PENDING / "I DON'T KNOW" is first-class; no support -> never PASS ──
test('§19 no positive evidence at all -> PENDING, never a guessed PASS', () => {
  const d = decide({ ...clean(), positive: [] });
  assert.equal(d.verdict, 'PENDING');
});

test('human review required forces PENDING even when every score is clean', () => {
  const d = decide({ ...clean(), humanReviewRequired: true });
  assert.equal(d.verdict, 'PENDING');
  assert.ok(d.reasons.some((r) => r.includes('human')));
});

// ── purity / totality ──
test('pure & total: garbage in -> a safe verdict, never PASS, never a throw', () => {
  assert.equal(decide(null).ok, false);
  assert.equal(decide(undefined).ok, false);
  assert.equal(decide(42).ok, false);
  assert.equal(decide({}).verdict, 'PENDING');           // empty case is never PASS
  assert.equal(decide({ positive: 'nope', negative: 7, toa: null }).verdict, 'PENDING');
  assert.doesNotThrow(() => decide({ negative: { observed: { score: 'x', class: 5 } } }));
});

// ── §24: the audit receipt is self-verifying; a forged PASS is caught ──
test('§24 receipt seals and verifies; the verdict and every field are hash-bound', () => {
  const sealed = seal(clean(), { createdAt: '2026-09-21T00:00:00Z' });
  assert.equal(sealed.ok, true);
  assert.equal(sealed.receipt.verdict, 'PASS');
  assert.ok(typeof sealed.receipt.receiptHash === 'string' && sealed.receipt.receiptHash.length === 64);
  assert.equal(verifyReceipt(sealed.receipt).valid, true);
});

test('§24 you cannot forge a PASS: flipping a BLOCK verdict (or lowering E⁻) fails verification', () => {
  const c = clean();
  c.negative.observed = { score: 0.9, class: 'observed' }; // this seals as BLOCK
  const sealed = seal(c, { createdAt: '2026-09-21T00:00:00Z' });
  assert.equal(sealed.receipt.verdict, 'BLOCK');
  // hand-edit the receipt to claim a PASS with a harmless negative score
  const forged = { ...sealed.receipt, verdict: 'PASS', negativeScore: 0.05 };
  const v = verifyReceipt(forged);
  assert.equal(v.valid, false);
  assert.ok(v.why.includes('does not match') || v.why.includes('edited'));
});

test('verifyReceipt refuses malformed / wrong-kind objects without throwing', () => {
  assert.equal(verifyReceipt(null).ok, false);
  assert.equal(verifyReceipt({ kind: 'other' }).ok, false);
  assert.doesNotThrow(() => verifyReceipt({ kind: 'dual-map-ethics-receipt', v: 1 }));
});

// ── boundary pinning: every threshold comparison is exact, tested AT the boundary ──
test('boundary: E⁻ exactly at tauBlock, evidence-backed, BLOCKS (>=, not >)', () => {
  const c = clean(); c.negative.observed = { score: 0.8, class: 'observed' };
  assert.equal(decide(c).verdict, 'BLOCK');
});
test('boundary: E⁺ exactly at tauPlus still supports PASS (<, not <=)', () => {
  const c = clean(); c.positive = [{ id: 'p', support: 0.6, weight: 1 }]; // E⁺ = 0.6 exactly
  assert.equal(decide(c).positiveScore, 0.6);
  assert.equal(decide(c).verdict, 'PASS');
});
test('boundary: E⁻ exactly at tauMinus is NOT above tolerance (>, not >=)', () => {
  const c = clean(); c.negative.sensitivity = { score: 0.5, class: 'counterfactual-bounded' };
  assert.equal(decide(c).verdict, 'PASS');
});
test('boundary: coverage exactly at tauC passes (<, not <=)', () => {
  assert.equal(decide({ ...clean(), coverage: 0.5 }).verdict, 'PASS');
});
test('boundary: non-legal coverage exactly at tauC with L=1 passes (<, not <=)', () => {
  assert.equal(decide({ ...clean(), law: { status: 1, nonlegalCoverage: 0.5 } }).verdict, 'PASS');
});
test('boundary: critical unknown exactly at tauMinus forces PENDING (>=, not >)', () => {
  const c = clean(); c.negative.unknown = { score: 0.5, class: 'unknown' };
  assert.equal(decide(c).verdict, 'PENDING');
});
test('boundary: each TOA dimension exactly at threshold passes the gate (<, not <=)', () => {
  assert.equal(decide({ ...clean(), toa: { truth: 0.6, openness: 0.9, accountability: 0.9 } }).verdict, 'PASS');
  assert.equal(decide({ ...clean(), toa: { truth: 0.9, openness: 0.6, accountability: 0.9 } }).verdict, 'PASS');
  assert.equal(decide({ ...clean(), toa: { truth: 0.9, openness: 0.9, accountability: 0.6 } }).verdict, 'PASS');
});
test('max tie-break: equal negatives keep the FIRST listed as dominant (>, not >=)', () => {
  const c = clean();
  c.negative.observed = { score: 0.4, class: 'observed' };
  c.negative.sensitivity = { score: 0.4, class: 'derived' };
  assert.equal(decide(c).dominantNegative, 'observed');
});
test('counterevidencePresent needs a BACKED class AND a score strictly > 0', () => {
  const zero = clean();
  for (const k of ['observed', 'sensitivity', 'stable', 'persistence', 'irreversibility']) zero.negative[k] = { score: 0, class: 'observed' };
  zero.negative.unknown = { score: 0, class: 'unknown' };
  assert.equal(decide(zero).counterevidencePresent, false); // score 0 => none (> 0, not >= 0; && not ||)
  const onlyUnknown = clean();
  for (const k of ['observed', 'sensitivity', 'stable', 'persistence', 'irreversibility']) onlyUnknown.negative[k] = { score: 0, class: 'observed' };
  onlyUnknown.negative.unknown = { score: 0.4, class: 'unknown' };
  assert.equal(decide(onlyUnknown).counterevidencePresent, false); // unknown is not backed
});

// ── guard pinning: malformed inputs are handled, never adopted literally ──
test('guard: an empty-string action is not a valid string -> null (length > 0, not >= 0)', () => {
  assert.equal(decide({ ...clean(), action: '' }).action, null);
});
test('guard: NaN / non-finite scores collapse to 0, never propagate as NaN (isNum uses &&)', () => {
  const c = clean(); c.negative.observed = { score: NaN, class: 'observed' };
  const d = decide(c);
  assert.equal(d.negative.observed.score, 0);
  assert.ok(Number.isFinite(d.negativeScore));
});
test('guard: q ≤ 0 or non-finite falls back to the 0.7 baseline, never adopted (isNum && q>0)', () => {
  assert.equal(decide({ ...clean(), q: 0 }).qOperational, 0.7);
  assert.equal(decide({ ...clean(), q: -3 }).qOperational, 0.7);
  assert.equal(decide({ ...clean(), q: Infinity }).qOperational, 0.7);
  const items = [{ support: 1, weight: 1 }, { support: 0, weight: 100 }];
  assert.equal(escortPositive(items, 0).value, escortPositive(items).value);       // q=0 -> baseline
  assert.equal(escortPositive(items, Infinity).value, escortPositive(items).value); // q=Inf -> baseline
});
test('guard: an Infinity evidence weight is rejected, not allowed to swamp the escort (isNum &&)', () => {
  const withInf = escortPositive([{ support: 0, weight: Infinity }, { support: 1, weight: 2 }], 0.7).value;
  const without = escortPositive([{ support: 1, weight: 2 }], 0.7).value;
  assert.equal(withInf, without); // the Infinity item contributed nothing
});
test('seal tolerates a null/absent meta (createdAt -> null), never throws (meta && meta.createdAt)', () => {
  const s1 = seal(clean(), null);
  assert.equal(s1.ok, true);
  assert.equal(s1.receipt.createdAt, null);
  assert.equal(verifyReceipt(s1.receipt).valid, true);
});
test('verifyReceipt requires BOTH hashes present (|| not &&)', () => {
  assert.equal(verifyReceipt({ kind: 'dual-map-ethics-receipt', v: 1, receiptHash: 'x' }).ok, false);
  assert.equal(verifyReceipt({ kind: 'dual-map-ethics-receipt', v: 1, derivationHash: 'x' }).ok, false);
});
