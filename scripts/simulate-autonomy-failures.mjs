import assert from 'node:assert/strict';

function createSystem() {
  return {
    clients: new Map(),
    jobs: new Map(),
    repos: new Map(),
    sites: new Map(),
    deployments: new Map(),
    exceptions: [],
  };
}

function addClient(system, id, approved) {
  system.clients.set(id, {
    id,
    approved,
    denied: !approved,
    projectId: approved ? `project-${id}` : null,
  });
}

function queue(system, clientId, type, maxAttempts = 3) {
  const key = `${clientId}:${type}`;
  if (!system.jobs.has(key)) {
    system.jobs.set(key, {
      key,
      clientId,
      type,
      status: 'queued',
      attempts: 0,
      maxAttempts,
      checkpoint: {},
    });
  }
  return system.jobs.get(key);
}

function fail(job, system, message) {
  job.attempts += 1;
  job.lastError = message;
  if (job.attempts >= job.maxAttempts) {
    job.status = 'failed';
    system.exceptions.push({ clientId: job.clientId, job: job.type, message });
  } else {
    job.status = 'queued';
  }
}

function provision(system, clientId, fault = null) {
  const client = system.clients.get(clientId);
  assert(client, 'client must exist');
  if (!client.approved || client.denied) return { stopped: true };

  const job = queue(system, clientId, 'provision_project_infrastructure');
  job.status = 'running';

  const repoName = `repo-${client.projectId}`;
  if (!job.checkpoint.repo) {
    if (fault === 'github') {
      fail(job, system, 'github unavailable');
      return { failed: true };
    }
    if (!system.repos.has(repoName)) system.repos.set(repoName, { clientId, repoName });
    job.checkpoint.repo = repoName;
  }

  const siteName = `site-${client.projectId}`;
  if (!job.checkpoint.site) {
    if (fault === 'netlify') {
      fail(job, system, 'netlify unavailable');
      return { failed: true };
    }
    if (!system.sites.has(siteName)) system.sites.set(siteName, { clientId, siteName, repoName });
    job.checkpoint.site = siteName;
  }

  job.status = 'completed';
  return { repoName, siteName };
}

function preview(system, clientId) {
  const client = system.clients.get(clientId);
  assert(client?.approved, 'preview requires approved client');
  const job = queue(system, clientId, 'website_prepare_safe_branch');
  job.status = 'completed';
  const url = `https://preview-${client.projectId}.example.test`;
  system.deployments.set(`${clientId}:preview`, { clientId, kind: 'preview', url, branch: `nxq/client-${clientId}` });
  return url;
}

function publish(system, clientId, previewUrl) {
  const previewDeployment = system.deployments.get(`${clientId}:preview`);
  assert(previewDeployment, 'production requires saved preview');
  assert.equal(previewDeployment.clientId, clientId, 'preview must belong to the same client');
  assert.notEqual(previewDeployment.branch, 'main', 'preview branch cannot be production main');

  const productionUrl = `https://live-${system.clients.get(clientId).projectId}.example.test`;
  assert.notEqual(productionUrl, previewUrl, 'preview URL cannot be silently reused as production');
  system.deployments.set(`${clientId}:production`, {
    clientId,
    kind: 'production',
    url: productionUrl,
    branch: 'main',
  });
  return productionUrl;
}

function runScenario(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    throw error;
  }
}

runScenario('DENY creates no downstream infrastructure', () => {
  const system = createSystem();
  addClient(system, 'denied', false);
  const result = provision(system, 'denied');
  assert.equal(result.stopped, true);
  assert.equal(system.repos.size, 0);
  assert.equal(system.sites.size, 0);
});

runScenario('Approved client provisions one repo and one site', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  provision(system, 'a');
  assert.equal(system.repos.size, 1);
  assert.equal(system.sites.size, 1);
});

runScenario('GitHub retry does not duplicate infrastructure', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  provision(system, 'a', 'github');
  provision(system, 'a');
  provision(system, 'a');
  assert.equal(system.repos.size, 1);
  assert.equal(system.sites.size, 1);
});

runScenario('Netlify failure resumes from GitHub checkpoint', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  provision(system, 'a', 'netlify');
  assert.equal(system.repos.size, 1);
  assert.equal(system.sites.size, 0);
  provision(system, 'a');
  assert.equal(system.repos.size, 1);
  assert.equal(system.sites.size, 1);
});

runScenario('Exhausted retries create exactly one owner exception signal', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  const job = queue(system, 'a', 'provider_failure', 3);
  fail(job, system, 'provider unavailable');
  fail(job, system, 'provider unavailable');
  fail(job, system, 'provider unavailable');
  assert.equal(job.status, 'failed');
  assert.equal(system.exceptions.length, 1);
});

runScenario('Client infrastructure remains tenant-isolated', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  addClient(system, 'b', true);
  provision(system, 'a');
  provision(system, 'b');
  for (const repo of system.repos.values()) {
    assert.ok(repo.repoName.includes(`project-${repo.clientId}`));
  }
  for (const site of system.sites.values()) {
    assert.equal(system.repos.get(site.repoName)?.clientId, site.clientId);
  }
});

runScenario('Preview and production stay distinct', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  provision(system, 'a');
  const previewUrl = preview(system, 'a');
  const productionUrl = publish(system, 'a', previewUrl);
  assert.notEqual(previewUrl, productionUrl);
  assert.equal(system.deployments.get('a:preview').kind, 'preview');
  assert.equal(system.deployments.get('a:production').kind, 'production');
});

runScenario('Cross-client preview cannot be promoted for another client', () => {
  const system = createSystem();
  addClient(system, 'a', true);
  addClient(system, 'b', true);
  provision(system, 'a');
  provision(system, 'b');
  preview(system, 'a');
  system.deployments.set('b:preview', system.deployments.get('a:preview'));
  assert.throws(() => publish(system, 'b', system.deployments.get('a:preview').url), /same client/);
});

console.log('\n8/8 autonomous lifecycle failure simulations passed.');