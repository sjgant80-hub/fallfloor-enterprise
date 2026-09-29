#!/usr/bin/env node
// tools/evidence-from-fallfloor.mjs — derive evidence/fallfloor.json from fallfloor's committed, receipted run,
// using fallfloor's OWN gated kernel at the pinned commit (fetched from GitHub), so the numbers here are the
// receipts' numbers and nobody types them.
//   node tools/evidence-from-fallfloor.mjs [--write]      (without --write: compare with the committed file, exit 1 on any difference)
// CI runs it without --write: the evidence this design stands on must still re-derive from fallfloor's receipts.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'sjgant80-hub/fallfloor', COMMIT = 'e4d3b91303a6a1d68c5dec622581551c3fcaef52', RUN = 'floor-2026-09-29';
const RAW = (p) => 'https://raw.githubusercontent.com/' + REPO + '/' + COMMIT + '/' + p;
async function get(p) { const r = await fetch(RAW(p)); if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.text(); }

const summary = JSON.parse(await get('runs/' + RUN + '/summary.json'));
const ledger = JSON.parse(await get('runs/' + RUN + '/ledger.json'));
const secData = JSON.parse(await get('data/security.json'));
// fallfloor's own kernel, at the pinned commit
const dir = mkdtempSync(join(tmpdir(), 'ffk-'));
writeFileSync(join(dir, 'kernel.mjs'), await get('kernel.mjs'));
const FK = await import(pathToFileURL(join(dir, 'kernel.mjs')).href);
const gold = Object.fromEntries(secData.heldOut.map((x) => [x.id, x.gold]));
const secRecs = ledger.items.filter((x) => x.key === 'security').map((x) => ({ item: x.item, gold: gold[x.item], out: FK.outcomeFromHops('security', x.arm, x.hops).out }));
const b = FK.labelBreakdown(secRecs, 'spam');
const A = summary.arms, J = summary.jobs, P = Object.fromEntries(summary.prereg.rules.map((r) => [r.id, r]));
const cold = Math.max(...summary.nodes.filter((n) => typeof n.coldStartSec === 'number').map((n) => n.coldStartSec));
const evidence = {
  kind: 'fallfloor-enterprise-evidence', v: 1,
  from: {
    repo: 'https://github.com/' + REPO, commit: COMMIT, run: RUN, ledgerHash: summary.ledgerHash, hops: summary.hops,
    page: 'https://sjgant80-hub.github.io/fallfloor/', ci: 'https://github.com/sjgant80-hub/fallfloor/actions/runs/36598070217',
    how: 'Derived by tools/evidence-from-fallfloor.mjs from the pinned commit\'s summary and signed ledger, using fallfloor\'s own kernel (outcomeFromHops, labelBreakdown). fallfloor\'s CI re-verifies every hop and signature of that ledger.',
  },
  machine: 'one laptop: Intel Core i7-1255U, Iris Xe graphics, 16 GB — separate Chrome processes as nodes, real WebRTC between them',
  preregistered: { rulesPassed: summary.prereg.passed, rulesOf: summary.prereg.of, failed: summary.prereg.rules.filter((r) => !r.pass).map((r) => r.id) },
  support: {
    items: A.chain.n, e2e: A.chain.e2e, silent: A.chain.silent, caught: A.chain.caught, replyPass: A.chain.replyPass, teamAcc: A.chain.teamAcc, intentAcc: A.chain.intentAcc,
    lostChain: A.chain.lost, lostPool: A.pool.lost, p95Sec: Math.round(A.chain.latencyMs.p95 / 100) / 10,
    tokensIn: summary.costPerItem.support.promptTokens, tokensOut: summary.costPerItem.support.completionTokens, laptopSecondsPerItem: summary.costPerItem.support.gpuSeconds,
    baselineE2e: A.baseline.e2e,
  },
  security: {
    items: J.security.n, accuracy: J.security.accuracy, caught: b.caught, missed: b.missed, wronglyFlagged: b.wronglyFlagged, correctlyPassed: b.correctlyPassed, majorityAccuracy: b.majorityAccuracy,
    tokensIn: summary.costPerItem.security.promptTokens, tokensOut: summary.costPerItem.security.completionTokens, laptopSecondsPerItem: summary.costPerItem.security.gpuSeconds,
  },
  hr: {
    items: J.hr.n, accuracy: J.hr.accuracy,
    tokensIn: summary.costPerItem.hr.promptTokens, tokensOut: summary.costPerItem.hr.completionTokens, laptopSecondsPerItem: summary.costPerItem.hr.gpuSeconds,
  },
  coldStartSecMax: cold,
  latencyRule: { pass: P.latency.pass, value: P.latency.value },
  unplannedRestarts: (summary.faults && summary.faults.unplannedRestarts || []).length,
  finished: summary.finished,
};
// ── the data boundary, read from the code that ran at the pinned commit: every network path the floor can take ──
// The claim on the page ("no prompt, no customer record, nothing goes to an AI vendor") stands only if this holds:
// every fetch is to the page's own origin, the only import is the WebLLM runtime library, STUN is off by default
// (LAN candidates only), no other channel exists, and no AI API host appears anywhere in the code.
const AI_API = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.mistral\.ai|api\.cohere\.(?:ai|com)|openrouter\.ai|api\.groq\.com|api\.together\.xyz|api-inference\.huggingface\.co|router\.huggingface\.co|openai\.azure\.com|bedrock-runtime/g;
const floorCode = { 'runtime.js': await get('runtime.js'), 'index.html': await get('index.html') };
const uniq = (a) => [...new Set(a)].sort();
const fetchTargets = uniq(Object.values(floorCode).flatMap((t) => [...t.matchAll(/\bfetch\(\s*([^,)]+)/g)].map((m) => m[1].trim())));
const importTargets = uniq(Object.values(floorCode).flatMap((t) => [...t.matchAll(/\bimport\(\s*([^)]+)\)/g)].map((m) => { const c = t.match(new RegExp('const ' + m[1].trim() + " = '([^']+)'")); return c ? c[1] : m[1].trim(); })));
const boundary = {
  readFrom: Object.keys(floorCode).map((f) => f + '@' + COMMIT.slice(0, 7)),
  fetchTargets, importTargets,
  stunOffByDefault: Object.values(floorCode).every((t) => /\bstun: false\b/.test(t)),
  aiApiHosts: uniq(Object.values(floorCode).flatMap((t) => t.match(AI_API) || [])),
  otherChannels: uniq(Object.values(floorCode).flatMap((t) => t.match(/new WebSocket|XMLHttpRequest|sendBeacon|new EventSource/g) || [])),
};
const ledgerPath = summary.ledgerPath || ('runs/' + RUN + '/ledger.json');
const sameOrigin = (x) => /^'data\/' \+ job \+ '\.json'$/.test(x) || x === 'S.ledgerPath';
const broken = [
  ...fetchTargets.filter((x) => !sameOrigin(x) || /https?:/.test(x)).map((x) => 'a fetch to ' + x),
  ...importTargets.filter((x) => !/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mlc-ai\/web-llm@[\d.]+\/\+esm$/.test(x)).map((x) => 'an import of ' + x),
  ...(boundary.stunOffByDefault ? [] : ['STUN on by default']),
  ...boundary.aiApiHosts.map((h) => 'an AI API host in the code: ' + h),
  ...boundary.otherChannels.map((c) => 'another channel: ' + c),
  ...(/^runs\/[\w-]+\/ledger\.json$/.test(ledgerPath) ? [] : ['the ledger path ' + ledgerPath + ' is not on the page\'s own origin']),
];
if (broken.length) { console.error('DATA BOUNDARY BROKEN in fallfloor@' + COMMIT.slice(0, 7) + ':\n  ' + broken.join('\n  ')); process.exit(1); }
evidence.boundary = boundary;
const out = join(root, 'evidence', 'fallfloor.json');
const text = JSON.stringify(evidence, null, 1) + '\n';
if (process.argv.includes('--write')) { writeFileSync(out, text); console.log('wrote evidence/fallfloor.json from ' + REPO + '@' + COMMIT.slice(0, 7)); }
else {
  const committed = readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
  if (committed !== text) { console.error('EVIDENCE DRIFT: evidence/fallfloor.json does not re-derive from fallfloor@' + COMMIT.slice(0, 7)); process.exit(1); }
  console.log('evidence re-derived from fallfloor@' + COMMIT.slice(0, 7) + ' (ledger ' + summary.ledgerHash.slice(0, 12) + '…, ' + summary.hops + ' hops) — identical');
}
