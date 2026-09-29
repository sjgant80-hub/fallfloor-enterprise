#!/usr/bin/env node
// tools/page-gate.mjs — the page's own gate (ui-gate + surface rules). Runs in CI.
//   dead controls · broken anchors and repo links · ids the script uses but the page lacks · undefined CSS variables ·
//   scripts that do not parse · placeholders and private notation · no own fee anywhere · every third-party price
//   and every quoted law sourced and dated · the credits (Konomi, Gary W. Floyd in full) · the honest framing ·
//   the AI-GEO files present and well-formed.
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const html = read('index.html');
const fails = [];
const check = (cond, what) => { if (!cond) fails.push(what); };
const HTTPS = /^https:\/\/\S+$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1], body: m[2] }));
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
const code = scripts.filter((s) => !/application\/(ld\+)?json/.test(s.attrs)).map((s) => s.body).join('\n');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const staticIds = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

for (const [, a] of markup.matchAll(/href="#([^"]*)"/g)) check(staticIds.has(a), 'anchor #' + a + ' has no target');
for (const [, h] of markup.matchAll(/href="([^"#][^"]*)"/g)) {
  if (/^https?:/.test(h)) { check(h.startsWith('https://'), 'insecure link ' + h); continue; }
  check(existsSync(join(root, h.split('?')[0])), 'relative link ' + h + ' has no file');
}
for (const [, id] of code.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) check(ids.has(id), "the script uses $('" + id + "') but the page has no such id");
for (const [, id] of markup.matchAll(/<button[^>]*id="([^"]+)"/g)) check(new RegExp("\\$\\('" + id + "'\\)\\.(addEventListener|onclick)").test(code), 'dead control: button #' + id + ' has no handler');
check(!/<button(?![^>]*\sid=)/.test(markup), 'a button without an id cannot be checked for a handler');
const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') + html;
const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
for (const [, v] of css.matchAll(/var\((--[\w-]+)/g)) check(defined.has(v), 'CSS variable ' + v + ' is used but never defined');
const tmp = mkdtempSync(join(tmpdir(), 'ffegate-'));
scripts.forEach((s, i) => {
  if (/application\/(ld\+)?json/.test(s.attrs)) { try { JSON.parse(s.body); } catch (e) { fails.push('JSON script ' + i + ' does not parse: ' + e.message); } return; }
  const f = join(tmp, 's' + i + (/type="module"/.test(s.attrs) ? '.mjs' : '.cjs'));
  writeFileSync(f, s.body);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fails.push('script ' + i + ' does not parse: ' + String(e.stderr).split('\n').slice(0, 5).join(' ')); }
});
const text = markup.replace(/<[^>]+>/g, ' ');
for (const w of ['TODO', 'TBD', 'lorem', 'XXX', 'coming soon', 'FIXME', 'placeholder text']) check(!text.toLowerCase().includes(w.toLowerCase()), 'placeholder on the page: ' + w);
const publicFiles = ['index.html', 'README.md', 'llms.txt', 'NOTICE'];
for (const f of publicFiles) {
  const t = read(f);
  check(!/[κφ]/.test(t), f + ' carries private notation (κ/φ)');
  check(!/\b(7|seven)[- ]figure/i.test(t), f + ' mentions an engagement size — no fee or engagement value on public surfaces');
  check(!/\b(our|my) (fee|price|pricing|rate card)\b/i.test(t), f + ' reads like our own pricing');
}
check(!/[£$€]\s?\d/.test(text), 'the static page shows a money amount (every amount must come from the sourced data)');
check(!/\b(pricing page|subscribe|buy now|free trial)\b/i.test(text), 'the static page reads like a price list');

const P = JSON.parse(read('sources/prices.json'));
const src = (x, what) => check(x && HTTPS.test(x.source || '') && DATE.test(x.checked || ''), what + ' lacks an https source or a checked date');
for (const s of P.seats) { src(s, 'seat ' + s.id); check(['excluded', 'included', 'not stated'].includes(s.vat), 'seat ' + s.id + ': VAT treatment'); check(typeof s.quote === 'string' && s.quote.length > 5, 'seat ' + s.id + ': the quoted price text'); }
for (const a of P.api) src(a, 'API price ' + a.id);
for (const k of ['fx', 'vatRate', 'coreNode', 'electricity', 'laptopPower', 'salaries']) src(P[k], k);
check(HTTPS.test(P.coreNode.specSource || ''), 'core node spec source');
const LAW = JSON.parse(read('sources/law.json'));
for (const d of LAW.duties) { check(HTTPS.test(d.url || '') && DATE.test(d.checked || '') && DATE.test(d.from || ''), 'duty ' + d.id + ': url, checked and from'); check(typeof d.quote === 'string' && d.quote.length > 20, 'duty ' + d.id + ': the quoted text'); }
for (const d of LAW.dates) check(DATE.test(d.date) && HTTPS.test(d.url || ''), 'date ' + d.date + ': source');
const C = JSON.parse(read('data/company.json'));
check(/MODELLED/.test(C._rule), 'the company file must say it is modelled');

check(html.includes('Powered by the Konomi architecture, created by Thomas Frumkin'), 'the Konomi credit is missing or not verbatim');
const GARY = 'Gary W. Floyd, Lumiea Systems Research Division — ThunderStruck Service LLC';
for (const f of ['index.html', 'README.md', 'NOTICE', 'dualmap.mjs']) check(read(f).includes(GARY), f + ': Gary W. Floyd\'s credit must be in full (name, company, paper)');
check(!/Gary Floyd/.test(html + read('README.md')), 'never "Gary Floyd" without the middle initial and company');
check(/Not a real client/.test(markup), 'the page must say it is not a real client');
const ld = scripts.find((s) => /application\/ld\+json/.test(s.attrs));
check(ld && /"FAQPage"/.test(ld.body), 'schema.org JSON-LD with an FAQPage is missing');
check(html.includes('<link rel="canonical" href="https://sjgant80-hub.github.io/fallfloor-enterprise/"'), 'canonical URL missing');
check(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(html), 'viewport meta missing');
check(/<meta name="description" content="[^"]{60,}"/.test(html), 'meta description missing');
for (const f of ['llms.txt', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'NOTICE', 'LICENSE', 'icon.svg']) check(existsSync(join(root, f)), f + ' is missing');
check(/Sitemap: https:\/\/sjgant80-hub\.github\.io\/fallfloor-enterprise\/sitemap\.xml/.test(read('robots.txt')), 'robots.txt does not point to the sitemap');
check(read('sitemap.xml').includes('<loc>https://sjgant80-hub.github.io/fallfloor-enterprise/</loc>'), 'sitemap.xml does not list the page');
try { const m = JSON.parse(read('manifest.webmanifest')); check(m.name && m.start_url, 'manifest lacks name/start_url'); } catch { fails.push('manifest.webmanifest does not parse'); }
check(read('README.md').split('\n').slice(0, 4).join('\n').includes('https://sjgant80-hub.github.io/fallfloor-enterprise/'), 'the live URL is not at the top of the README');

if (fails.length) { console.error('PAGE GATE FAILED (' + fails.length + '):\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('page gate CLEAN — ' + staticIds.size + ' ids, ' + [...markup.matchAll(/<button/g)].length + ' buttons wired, ' + defined.size + ' CSS variables, ' + scripts.length + ' scripts parse, ' + (P.seats.length + P.api.length + 4) + ' prices/figures and ' + LAW.duties.length + ' duties sourced and dated');
