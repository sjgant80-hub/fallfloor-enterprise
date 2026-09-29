#!/usr/bin/env node
// make-page.mjs — the fixpoint. index.html runs the SAME hash.mjs + dualmap.mjs + kernel.mjs the tests and the mutation
// gate prove, over the committed inputs. The headline blocks in README.md and llms.txt are generated from the same
// kernel, so no number is typed by hand. CI regenerates all three and fails if any differs.
import { readFileSync, writeFileSync } from 'node:fs';
const at = (f) => new URL('../' + f, import.meta.url);
const read = (f) => readFileSync(at(f), 'utf8').replace(/\r\n/g, '\n');
const json = (f) => JSON.parse(read(f));
const K = await import(at('kernel.mjs').href);
const strip = (src) => src.split('\n').filter((l) => !/^import .* from '\.\/[a-z]+\.mjs';$/.test(l) && !/^export \{[^}]*\};$/.test(l)).join('\n').replace(/^export /gm, '').trimEnd();
// hash.mjs and dualmap.mjs keep their own helper names, so each runs in its own scope and hands back its exports
const scoped = (f, names) => '// ── ' + f + ' (own scope) ──\nconst { ' + names.join(', ') + ' } = (() => {\n' + strip(read(f)) + '\nreturn { ' + names.join(', ') + ' };\n})();';
const kernel = [scoped('hash.mjs', ['sha256', 'canon']), scoped('dualmap.mjs', ['decide', 'seal', 'verifyReceipt']), '// ── kernel.mjs ──\n' + strip(read('kernel.mjs'))].join('\n\n');
const data = { company: json('data/company.json'), prices: json('sources/prices.json'), law: json('sources/law.json'), evidence: json('evidence/fallfloor.json'), design: json('data/design.json'), risks: json('data/risks.json').risks };

// ── the generated headline (markdown) for README.md and llms.txt ──
const gbp = (x) => '£' + Math.round(x).toLocaleString('en-GB');
const pct = (x) => Math.round(x * 1000) / 10 + '%';
const p = K.plan({ company: data.company, prices: data.prices, evidence: data.evidence });
const b = K.board(data.evidence, data.company.policy, data.evidence.finished);
const o = K.obligations(data.company.workloads[0], 'local', data.law.duties, { asOf: data.law.checked, providerAbroad: true });
if (!p.ok || !b.ok || !o.ok) { console.error('the kernel refused the committed inputs: ' + (p.why || b.why || o.why)); process.exit(1); }
const L = [];
const line = (id) => p.tco.lines.find((l) => l.id === id);
L.push('For the modelled bank (1,200 staff, 1,000 knowledge workers, UK with EU customers), over five years, cash, net of VAT:');
L.push('');
L.push('| | Local-first | Corporate (' + p.seats.toLocaleString('en-GB') + ' × ' + p.seatProduct + ' + ' + p.apiModel + ') |');
L.push('|---|---|---|');
L.push('| 5-year total | ' + gbp(p.tco.total.local) + ' | ' + gbp(p.tco.total.cloud) + ' |');
L.push('| People (the largest line on both sides) | ' + gbp(line('local-staff').total) + ' | ' + gbp(line('cloud-staff').total) + ' |');
L.push('| Seat licences | — | ' + gbp(line('cloud-seats').total) + ' |');
L.push('| Core inference nodes (bought as demand grows, replaced every ' + data.company.core.lifeYears.value + ' years) | ' + gbp(line('local-core-nodes').total) + ' | — |');
L.push('| Electricity for the AI work (upper bound) | ' + gbp(line('local-core-power').total + line('local-floor-power').total) + ' | in the vendor\'s price |');
L.push('| Share of the total resting on estimates or assumptions | ' + pct(p.tco.basisShare.local.estimate + p.tco.basisShare.local.assumption) + ' | ' + pct(p.tco.basisShare.cloud.estimate + p.tco.basisShare.cloud.assumption) + ' |');
L.push('');
const be = K.seatShareBreakEven({ company: data.company, prices: data.prices, evidence: data.evidence });
L.push('What has to be true: local-first costs less once more than ' + pct(be.share) + ' of knowledge workers would otherwise get a seat; below that, the corporate model costs less.');
L.push('');
L.push('Difference: ' + gbp(Math.abs(p.tco.total.difference)) + ' over five years in ' + (p.tco.total.difference >= 0 ? 'local-first\'s' : 'the corporate model\'s') + ' favour' + (p.tco.breakEvenYear ? ', ahead from year ' + p.tco.breakEvenYear : '') + '. The corporate side buys frontier-model quality that the local side does not claim.');
L.push('');
L.push('Compliance (customer-support triage, local-first vs a cloud API, as of ' + data.law.checked + '): local-first **removes** ' + o.items.filter((i) => i.status === 'removed').map((i) => i.title.charAt(0).toLowerCase() + i.title.slice(1) + ' (' + data.law.duties.find((d) => d.id === i.id).ref + ')').join(' and ') + ' for inference; it **keeps with the company** ' + o.items.filter((i) => i.status === 'unchanged' || i.status === 'yours').length + ' duties, including a lawful basis, a DPIA, accuracy, security and the AI Act provider duties for systems it builds. EU AI Act high-risk (Annex III) duties apply from 2 December 2027 after the Digital Omnibus (Regulation (EU) 2026/1744); Article 50 transparency has applied since 2 August 2026.');
L.push('');
L.push('Go / no-go board, sealed from fallfloor\'s receipted evidence: ' + b.tally.PASS + ' PASS · ' + b.tally.BLOCK + ' BLOCK · ' + b.tally.PENDING + ' PENDING (' + b.rows.map((r) => r.id + ' ' + r.verdict).join(', ') + '). Board hash `' + b.boardHash + '`.');
const block = L.join('\n');
const swapIn = (text, begin, end, body, name) => {
  const a = text.indexOf(begin), z = text.indexOf(end);
  if (a < 0 || z < a) { console.error('markers missing in ' + name + ': ' + begin); process.exit(1); }
  return text.slice(0, a + begin.length) + '\n' + body + '\n' + text.slice(z);
};
const RB = '<!-- ⟦RESULTS-BEGIN⟧ generated by tools/make-page.mjs — do not edit here -->', RE = '<!-- ⟦RESULTS-END⟧ -->';
for (const f of ['README.md', 'llms.txt']) writeFileSync(at(f), swapIn(read(f), RB, RE, block, f));
let page = read('index.html');
page = swapIn(page, '<!-- ⟦DATA-BEGIN⟧ generated by tools/make-page.mjs — do not edit here -->', '<!-- ⟦DATA-END⟧ -->', '<script type="application/json" id="floorData">' + JSON.stringify(data).replace(/</g, '\\u003c') + '</script>', 'index.html');
page = swapIn(page, '// ⟦KERNEL-BEGIN⟧ generated from hash.mjs, dualmap.mjs and kernel.mjs by make-page.mjs — do not edit here', '// ⟦KERNEL-END⟧', kernel, 'index.html');
writeFileSync(at('index.html'), page);
console.log('page: kernel ' + kernel.length + ' chars · data ' + JSON.stringify(data).length + ' · local ' + gbp(p.tco.total.local) + ' vs corporate ' + gbp(p.tco.total.cloud) + ' · board ' + JSON.stringify(b.tally));
