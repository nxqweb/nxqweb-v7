import fs from 'node:fs';

const tutorial = fs.readFileSync('src/components/ClientPortalTutorialOverlay.tsx', 'utf8');
const app = fs.readFileSync('src/App.tsx', 'utf8');
const topCards = fs.readFileSync('src/components/ClientPortalTopCards.tsx', 'utf8');

const checks = [
  ['Tutorial is versioned for future reruns', /nxq-client-portal-tutorial-v\d+-complete/.test(tutorial)],
  ['Tutorial appears only until completion', tutorial.includes('window.localStorage.getItem') && tutorial.includes('window.localStorage.setItem')],
  ['Tutorial explains NXQ ID', tutorial.includes('NXQ ID')],
  ['Tutorial explains domain action-required behavior', tutorial.includes('action-required')],
  ['Tutorial is mounted on main client portal', app.includes('<ClientPortalTutorialOverlay />')],
  ['Denied clients get a clear hard-stop notice', topCards.includes('Website setup was not approved')],
  ['Denied clients get support contact', topCards.includes('NXQweb@protonmail.com')],
  ['Denied clients do not see Commerce shortcut card', topCards.includes('!denied ? <ClientCommercePortalTab /> : null')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.error(`FAIL  ${name}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} client tutorial/denial UX checks passed.`);
if (failed) process.exit(1);
