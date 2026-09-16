import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const scale = read('202_scale_control_plane_foundation.sql');
const allocator = read('203_scale_allocator_concurrency_hardening.sql');
const ingress = read('204_atomic_ingress_capacity_reservations.sql');
const reads = read('205_paginated_portal_read_models.sql');
const modes = read('206_scale_mode_control_and_readiness.sql');

const checks = [
  ['provider pool registry exists', /create table if not exists public\.nxq_provider_pools/i.test(scale)],
  ['tenant placement exists', /create table if not exists public\.client_infrastructure_placements/i.test(scale)],
  ['scale modes include massive', /'massive'/i.test(scale)],
  ['provider circuit breaker exists', /circuit_open_until/i.test(scale)],
  ['provider concurrency budget exists', /max_concurrency/i.test(scale)],
  ['tenant allocator is service-role only', /Service-role access required/i.test(allocator)],
  ['tenant allocator uses per-client advisory lock', /pg_advisory_xact_lock\(hashtextextended\('nxq-placement:/i.test(allocator)],
  ['atomic ingress windows exist', /nxq_ingress_capacity_windows/i.test(ingress)],
  ['ingress reservation is atomic upsert', /on conflict[\s\S]*do update[\s\S]*used_units[\s\S]*<= excluded\.limit_units/i.test(ingress)],
  ['ingress reservation does not expose public execution', /revoke all on function public\.nxq_reserve_ingress_capacity[\s\S]*from public, anon, authenticated/i.test(ingress)],
  ['owner clients are cursor paginated', /owner_client_list_page[\s\S]*\(c\.created_at, c\.id\) < \(target_cursor_created_at, target_cursor_id\)/i.test(reads)],
  ['owner client page is bounded', /least\(greatest\(coalesce\(target_limit, 50\), 1\), 100\)/i.test(reads)],
  ['client message page derives tenant identity', /client_uuid := public\.current_client_id\(\)/i.test(reads)],
  ['client message page is cursor paginated', /\(m\.created_at, m\.id\) < \(target_cursor_created_at, target_cursor_id\)/i.test(reads)],
  ['massive mode readiness requires multiple provider pools', /when 'massive' then source_pools >= 2 and hosting_pools >= 2/i.test(modes)],
  ['scale mode switch serializes concurrent changes', /pg_advisory_xact_lock\(hashtextextended\('nxq-scale-mode'/i.test(modes)],
  ['scale mode cannot bypass readiness', /if not coalesce\(\(readiness->>'ready'\)::boolean, false\)/i.test(modes)],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`Scale control-plane contract failed (${failed.length}): ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Scale control-plane contract passed (${checks.length}/${checks.length}).`);
