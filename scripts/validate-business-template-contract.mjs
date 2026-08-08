import fs from 'node:fs';

const root = 'templates/business-v1';
const index = fs.readFileSync(`${root}/index.html`, 'utf8');
const app = fs.readFileSync(`${root}/app.js`, 'utf8');
const config = fs.readFileSync(`${root}/site.config.js`, 'utf8');
const css = fs.readFileSync(`${root}/styles.css`, 'utf8');

const checks = [
  ['Versioned Business config schema exists', config.includes('schemaVersion: "nxq-business-v1"')],
  ['Business identity is data-driven', app.includes("text('brand-name', business.name)") && app.includes("text('footer-name', business.name)")],
  ['Services are data-driven', app.includes('services.slice(0, 8)') && index.includes('id="service-grid"')],
  ['Contact actions are data-driven', app.includes('business.phone') && app.includes('business.email')],
  ['SEO title and description are data-driven', app.includes('document.title = seo?.title') && app.includes('meta[name="description"]')],
  ['Template has mobile responsive rules', css.includes('@media (max-width: 620px)') && css.includes('@media (max-width: 900px)')],
  ['Template contains no real client identity', !/Light of the World|candlelightoftheworld|530\) 912-9067/i.test(`${index}\n${app}\n${config}\n${css}`)],
  ['Template contains NXQ management attribution', index.includes('Website managed by NXQ Web')],
  ['Template has primary service conversion path', index.includes('id="primary-cta"') && index.includes('id="contact"')],
  ['Template remains dependency-light static source', !index.includes('/node_modules/') && index.includes('./app.js') && index.includes('./styles.css')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} Business template contract checks passed.`);
if (failed) process.exit(1);
