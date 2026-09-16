import assert from "node:assert/strict";

const requestedRuns = Number(process.argv.find((arg) => arg.startsWith("--runs="))?.split("=")[1] || 10);
assert.ok(Number.isInteger(requestedRuns) && requestedRuns >= 1 && requestedRuns <= 100, "--runs must be an integer from 1 to 100");

class LifecycleHarness {
  constructor() {
    this.sequence = 0;
    this.clients = new Map();
    this.projects = new Map();
    this.jobs = new Map();
    this.githubRepos = new Map();
    this.netlifySites = new Map();
    this.websiteRuns = new Map();
    this.audit = [];
  }

  next(prefix) {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }

  createClient(label) {
    const id = this.next("client");
    const client = {
      id,
      label,
      status: "pending_review",
      intake: { complete: true, family: "business", tier: "growth", services: ["primary-service"] },
      approval: "pending",
      project: null,
      buildPlan: null,
      infrastructure: { githubRepoId: null, netlifySiteId: null },
      preview: null,
      production: null,
      billing: { status: "active", overdueDay: null, lastProviderEventDay: null },
    };
    this.clients.set(id, client);
    this.audit.push([id, "onboarding_completed"]);
    return client;
  }

  job(client, type, idempotencyKey, payload = {}) {
    const existing = this.jobs.get(idempotencyKey);
    if (existing) return existing;
    const job = { id: this.next("job"), clientId: client.id, type, idempotencyKey, payload, status: "queued", attempts: 0 };
    this.jobs.set(idempotencyKey, job);
    return job;
  }

  requireEligible(client) {
    assert.equal(client.approval, "accepted", "original accepted approval is required");
    assert.ok(["approved", "active", "overdue"].includes(client.status), "client lifecycle blocks automation");
  }

  evaluateOnboarding(client) {
    this.requireEligible(client);
    let project = this.projects.get(client.id);
    if (!project) {
      project = { id: this.next("project"), status: "approved_awaiting_workspace", mainSha: "main-initial" };
      this.projects.set(client.id, project);
    }
    client.project = project;
    this.job(client, "prepare_build_plan", `build-plan:${project.id}:v2`);
    return project;
  }

  decide(client, decision) {
    assert.ok(["accept", "deny"].includes(decision), "decision must be accept or deny");
    if (client.approval === (decision === "accept" ? "accepted" : "denied")) return { alreadyApplied: true };
    assert.equal(client.approval, "pending", "a terminal owner decision cannot be reversed by replay");
    if (decision === "deny") {
      client.approval = "denied";
      client.status = "denied";
      for (const job of this.jobs.values()) {
        if (job.clientId === client.id && ["queued", "failed", "running"].includes(job.status)) job.status = "cancelled";
      }
      this.audit.push([client.id, "owner_denied_pipeline_stopped"]);
      return { denied: true };
    }
    client.approval = "accepted";
    client.status = "approved";
    this.evaluateOnboarding(client);
    this.job(client, "project_infrastructure", `infrastructure:${client.project.id}:v1`);
    this.audit.push([client.id, "owner_approval_accepted"]);
    return { accepted: true };
  }

  processBuildPlan(client) {
    const job = this.jobs.get(`build-plan:${client.project.id}:v2`);
    assert.ok(job, "build-plan job must exist");
    if (job.status === "completed") return client.buildPlan;
    this.requireEligible(client);
    assert.equal(client.intake.complete, true, "completed structured intake is required");
    job.status = "running";
    job.attempts += 1;
    client.buildPlan = {
      family: client.intake.family,
      tier: client.intake.tier,
      approvedServices: [...client.intake.services],
      productionAutoPublish: false,
      fingerprint: `intake-${client.id}`,
    };
    job.status = "completed";
    this.maybeQueueBuild(client);
    return client.buildPlan;
  }

  processInfrastructure(client, failAfter = null) {
    const job = this.jobs.get(`infrastructure:${client.project.id}:v1`);
    assert.ok(job, "infrastructure job must exist");
    if (job.status === "completed") return client.infrastructure;
    this.requireEligible(client);
    job.status = "running";
    job.attempts += 1;

    if (!client.infrastructure.githubRepoId) {
      const repoId = `repo-${client.project.id}`;
      client.infrastructure.githubRepoId = repoId;
      this.githubRepos.set(client.id, repoId);
    }
    if (failAfter === "github") {
      job.status = "failed";
      throw new Error("simulated failure after GitHub checkpoint");
    }
    if (!client.infrastructure.netlifySiteId) {
      const siteId = `site-${client.project.id}`;
      client.infrastructure.netlifySiteId = siteId;
      this.netlifySites.set(client.id, siteId);
    }
    if (failAfter === "netlify") {
      job.status = "failed";
      throw new Error("simulated failure after Netlify checkpoint");
    }

    job.status = "completed";
    client.project.status = "building";
    this.maybeQueueBuild(client);
    return client.infrastructure;
  }

  maybeQueueBuild(client) {
    const plan = this.jobs.get(`build-plan:${client.project.id}:v2`);
    const infrastructure = this.jobs.get(`infrastructure:${client.project.id}:v1`);
    if (plan?.status === "completed" && infrastructure?.status === "completed") {
      this.job(client, "website_build_preview", `business-build:${client.project.id}:v1`);
    }
  }

  processPreview(client) {
    const job = this.jobs.get(`business-build:${client.project.id}:v1`);
    assert.ok(job, "preview build job must exist");
    if (job.status === "completed") return client.preview;
    this.requireEligible(client);
    assert.ok(client.buildPlan, "validated build plan is required");
    assert.ok(client.infrastructure.githubRepoId && client.infrastructure.netlifySiteId, "provider checkpoints are required");
    job.status = "running";
    job.attempts += 1;
    const sourceSha = `sha-${client.project.id}-preview`;
    client.preview = {
      clientId: client.id,
      projectId: client.project.id,
      sourceBranch: `safe/business/${client.project.id}`,
      baseMainSha: client.project.mainSha,
      sourceSha,
      verifiedCommit: sourceSha,
      url: `https://preview-${client.project.id}.example.test`,
      quality: { accessibility: true, contactPath: true, seo: true, securityHeaders: true },
    };
    job.status = "completed";
    client.project.status = "preview_ready";
    this.job(client, "production_promotion", `business-production:${client.project.id}:${sourceSha}`, { previewClientId: client.id });
    return client.preview;
  }

  processProduction(client, { preview = client.preview, mainDrift = false, reportedCommit = preview?.sourceSha } = {}) {
    const key = `business-production:${client.project.id}:${client.preview?.sourceSha}`;
    const job = this.jobs.get(key);
    assert.ok(job, "production promotion job must exist");
    if (job.status === "completed" && client.project.status === "live") return client.production;
    this.requireEligible(client);
    assert.ok(preview, "verified preview is required");
    assert.equal(preview.clientId, client.id, "cross-tenant preview promotion is blocked");
    assert.equal(preview.projectId, client.project.id, "cross-project preview promotion is blocked");
    assert.notEqual(preview.sourceBranch, "main", "preview and production source must stay distinct");
    assert.equal(preview.verifiedCommit, preview.sourceSha, "preview must verify the exact source commit");
    assert.equal(Object.values(preview.quality).every(Boolean), true, "quality checks must all pass");
    job.status = "running";
    job.attempts += 1;

    if (mainDrift) {
      job.status = "completed";
      client.project.status = "building";
      this.job(client, "website_build_preview", `business-regenerate:${client.project.id}:${client.project.mainSha}:v1`, { reason: "main_drift" });
      this.audit.push([client.id, "main_drift_regeneration_queued"]);
      return { regenerated: true };
    }
    if (reportedCommit !== preview.sourceSha) {
      job.status = "failed";
      throw new Error("production commit mismatch");
    }

    client.project.mainSha = preview.sourceSha;
    client.production = {
      clientId: client.id,
      projectId: client.project.id,
      commit: reportedCommit,
      url: `https://live-${client.project.id}.example.test`,
    };
    client.project.status = "live";
    client.status = "active";
    job.status = "completed";
    this.audit.push([client.id, "production_exact_commit_verified"]);
    return client.production;
  }

  bootstrapWebsiteRun(client, { changeRequestId = null } = {}) {
    this.requireEligible(client);
    const existingRuns = this.websiteRuns.get(client.project.id) || [];
    const active = existingRuns.find((run) => !["published", "failed", "cancelled"].includes(run.status));
    if (active) return active;

    if (existingRuns.length > 0 && !changeRequestId) return null;

    const intentKey = changeRequestId ? `change:${changeRequestId}` : "initial";
    const existingIntent = existingRuns.find((run) => run.intentKey === intentKey);
    if (existingIntent) return existingIntent;

    const run = {
      id: this.next("website-run"),
      clientId: client.id,
      projectId: client.project.id,
      intentKey,
      status: "queued",
    };
    existingRuns.push(run);
    this.websiteRuns.set(client.project.id, existingRuns);
    return run;
  }

  retryWebsiteRun(client, runId) {
    this.requireEligible(client);
    const run = (this.websiteRuns.get(client.project.id) || []).find((candidate) => candidate.id === runId);
    assert.ok(run, "authorized retry must target an existing website run");
    assert.ok(["failed", "cancelled"].includes(run.status), "only a terminal website run may be retried");
    run.status = "queued";
    return run;
  }

  runHappy(label) {
    const client = this.createClient(label);
    this.decide(client, "accept");
    this.decide(client, "accept");
    this.processBuildPlan(client);
    this.processBuildPlan(client);
    this.processInfrastructure(client);
    this.processInfrastructure(client);
    this.processPreview(client);
    this.processPreview(client);
    this.processProduction(client);
    this.processProduction(client);
    assert.equal(client.project.status, "live");
    assert.equal(client.production.commit, client.preview.sourceSha);
    assert.equal([...this.jobs.values()].filter((job) => job.clientId === client.id).length, 4, "replays cannot duplicate jobs");
    return client;
  }

  markPastDue(client, day) {
    client.billing.status = "past_due";
    client.billing.overdueDay = day;
  }

  advanceBilling(client, day) {
    if (client.billing.status === "past_due" && day - client.billing.overdueDay >= 14) client.billing.status = "freeze_review";
    return client.billing.status;
  }

  ownerFreeze(client, note) {
    assert.equal(client.billing.status, "freeze_review", "freeze must follow human review");
    assert.ok(note.trim().length >= 8, "specific owner freeze note is required");
    client.billing.status = "frozen";
    this.audit.push([client.id, "owner_billing_state_changed"]);
  }

  applyProviderEvent(client, type, occurredDay) {
    if (client.billing.lastProviderEventDay !== null && occurredDay <= client.billing.lastProviderEventDay) return { ignored: true };
    client.billing.lastProviderEventDay = occurredDay;
    if (["payment_succeeded", "subscription_active"].includes(type)) client.billing.status = "active";
    else if (type === "payment_failed" && !["frozen", "cancelled"].includes(client.billing.status)) client.billing.status = "past_due";
    return { ignored: false };
  }
}

const harness = new LifecycleHarness();
const passed = [];
const scenario = (label, run) => {
  run();
  passed.push(label);
  console.log(`PASS  ${label}`);
};

const liveClients = [];
for (let index = 1; index <= requestedRuns; index += 1) {
  scenario(`Clean onboarding-to-live replay ${index}/${requestedRuns}`, () => {
    liveClients.push(harness.runHappy(`clean-${index}`));
  });
}

scenario("DENY creates zero provider infrastructure", () => {
  const before = [harness.projects.size, harness.githubRepos.size, harness.netlifySites.size, harness.jobs.size];
  const client = harness.createClient("deny");
  harness.decide(client, "deny");
  assert.deepEqual([harness.projects.size, harness.githubRepos.size, harness.netlifySites.size, harness.jobs.size], before);
  assert.equal(client.status, "denied");
});

scenario("Approval and recovery evaluation reuse one project and canonical plan job", () => {
  const client = harness.createClient("approval-recovery-overlap");
  harness.decide(client, "accept");
  const firstProject = client.project;
  const recoveredProject = harness.evaluateOnboarding(client);
  assert.equal(recoveredProject.id, firstProject.id);
  assert.equal([...harness.projects.keys()].filter((id) => id === client.id).length, 1);
  assert.equal(
    [...harness.jobs.values()].filter(
      (job) => job.clientId === client.id && job.type === "prepare_build_plan",
    ).length,
    1,
  );
  assert.equal(
    [...harness.jobs.values()].some(
      (job) =>
        job.clientId === client.id
        && job.type === "prepare_build_plan"
        && job.idempotencyKey.endsWith(":v1"),
    ),
    false,
  );
});

scenario("GitHub checkpoint retry creates one repo and one site", () => {
  const client = harness.createClient("github-retry");
  harness.decide(client, "accept");
  harness.processBuildPlan(client);
  assert.throws(() => harness.processInfrastructure(client, "github"), /GitHub checkpoint/);
  const repoId = client.infrastructure.githubRepoId;
  harness.processInfrastructure(client);
  assert.equal(client.infrastructure.githubRepoId, repoId);
  assert.equal([...harness.githubRepos.keys()].filter((id) => id === client.id).length, 1);
  assert.equal([...harness.netlifySites.keys()].filter((id) => id === client.id).length, 1);
});

scenario("Netlify checkpoint retry reuses both provider resources", () => {
  const client = harness.createClient("netlify-retry");
  harness.decide(client, "accept");
  harness.processBuildPlan(client);
  assert.throws(() => harness.processInfrastructure(client, "netlify"), /Netlify checkpoint/);
  const checkpoints = { ...client.infrastructure };
  harness.processInfrastructure(client);
  assert.deepEqual(client.infrastructure, checkpoints);
});

scenario("Cross-tenant preview promotion is blocked", () => {
  const first = harness.createClient("tenant-a");
  const second = harness.createClient("tenant-b");
  for (const client of [first, second]) {
    harness.decide(client, "accept");
    harness.processBuildPlan(client);
    harness.processInfrastructure(client);
    harness.processPreview(client);
  }
  assert.throws(() => harness.processProduction(first, { preview: second.preview }), /cross-tenant/);
  assert.notEqual(first.project.status, "live");
});

scenario("Denial after preview blocks production", () => {
  const client = harness.createClient("deny-after-preview");
  harness.decide(client, "accept");
  harness.processBuildPlan(client);
  harness.processInfrastructure(client);
  harness.processPreview(client);
  client.approval = "denied";
  client.status = "denied";
  assert.throws(() => harness.processProduction(client), /accepted approval/);
  assert.equal(client.production, null);
});

scenario("Main drift regenerates without overwriting production", () => {
  const client = harness.createClient("main-drift");
  harness.decide(client, "accept");
  harness.processBuildPlan(client);
  harness.processInfrastructure(client);
  harness.processPreview(client);
  const originalMain = client.project.mainSha;
  const result = harness.processProduction(client, { mainDrift: true });
  assert.equal(result.regenerated, true);
  assert.equal(client.project.mainSha, originalMain);
  assert.equal(client.production, null);
});

scenario("Production commit mismatch fails closed", () => {
  const client = harness.createClient("commit-mismatch");
  harness.decide(client, "accept");
  harness.processBuildPlan(client);
  harness.processInfrastructure(client);
  harness.processPreview(client);
  assert.throws(() => harness.processProduction(client, { reportedCommit: "wrong-sha" }), /commit mismatch/);
  assert.equal(client.production, null);
});

scenario("Scheduled bootstrap cannot recreate terminal website runs", () => {
  const client = harness.createClient("terminal-bootstrap-idempotency");
  harness.decide(client, "accept");
  const initial = harness.bootstrapWebsiteRun(client);
  assert.ok(initial);
  assert.equal(harness.bootstrapWebsiteRun(client).id, initial.id);

  initial.status = "published";
  for (let poll = 0; poll < 12; poll += 1) {
    assert.equal(harness.bootstrapWebsiteRun(client), null);
  }
  assert.equal(harness.websiteRuns.get(client.project.id).length, 1);

  const changed = harness.bootstrapWebsiteRun(client, { changeRequestId: "change-1" });
  assert.ok(changed);
  assert.equal(harness.bootstrapWebsiteRun(client, { changeRequestId: "change-1" }).id, changed.id);
  assert.equal(harness.websiteRuns.get(client.project.id).length, 2);
});

scenario("Authorized retry reuses a failed website run", () => {
  const client = harness.createClient("website-run-retry");
  harness.decide(client, "accept");
  const run = harness.bootstrapWebsiteRun(client);
  run.status = "failed";
  assert.equal(harness.bootstrapWebsiteRun(client), null);
  assert.equal(harness.websiteRuns.get(client.project.id).length, 1);
  assert.equal(harness.retryWebsiteRun(client, run.id).id, run.id);
  assert.equal(harness.websiteRuns.get(client.project.id).length, 1);
});

scenario("Billing grace stops at owner review and verified payment restores", () => {
  const client = liveClients[0];
  harness.markPastDue(client, 0);
  assert.equal(harness.advanceBilling(client, 15), "freeze_review");
  assert.notEqual(client.billing.status, "frozen");
  assert.throws(() => harness.ownerFreeze(client, "short"), /specific owner freeze note/);
  harness.ownerFreeze(client, "Owner confirmed unresolved payment");
  assert.equal(client.billing.status, "frozen");
  assert.equal(harness.applyProviderEvent(client, "payment_succeeded", 20).ignored, false);
  assert.equal(client.billing.status, "active");
  assert.equal(harness.applyProviderEvent(client, "payment_failed", 10).ignored, true);
  assert.equal(client.billing.status, "active");
});

assert.equal(new Set(harness.githubRepos.values()).size, harness.githubRepos.size, "repos must be unique per tenant");
assert.equal(new Set(harness.netlifySites.values()).size, harness.netlifySites.size, "sites must be unique per tenant");

console.log(`\n${passed.length}/${passed.length} deterministic local Business lifecycle scenarios passed.`);
console.log(`Clean lifecycle runs: ${requestedRuns}/${requestedRuns}`);
console.log("External provider evidence: not exercised (disposable Supabase/GitHub/Netlify runtime required).");
