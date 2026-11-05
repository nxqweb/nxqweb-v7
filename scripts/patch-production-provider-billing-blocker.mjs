import fs from 'node:fs';

const path = 'supabase/functions/promote-business-production/index.ts';
let s = fs.readFileSync(path, 'utf8');

if (s.includes('EXTERNAL_PROVIDER_BILLING_BLOCKER')) {
  console.log('Provider billing blocker handling already present.');
  process.exit(0);
}

const oldBlock = `  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Business production failure.";
    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist production automation failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});`;

const newBlock = `  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Business production failure.";
    const providerBillingBlocked = /credit usage exceeded|operational credits|production deploys .* paused/i.test(message);

    if (providerBillingBlocked) {
      const retryAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const blocker = \`EXTERNAL_PROVIDER_BILLING_BLOCKER: Netlify production deploy is paused by account credit limits. Automatic retry scheduled for \${retryAt}.\`;
      const deferred = await admin.from("automation_jobs").update({
        status: "queued",
        run_after: retryAt,
        last_error: blocker,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      if (deferred.error) {
        console.error("Failed to defer provider billing blocker", deferred.error.message);
        return response({ error: message, job_id: job.id }, 500);
      }

      await admin.from("automation_audit_log").insert({
        client_id: job.client_id,
        project_id: job.project_id,
        automation_job_id: job.id,
        event_type: "external_provider_billing_blocker",
        actor_type: "backend",
        details: {
          provider: "netlify",
          blocker_type: "account_credit_limit",
          retry_at: retryAt,
          original_error: message,
          owner_action_required: true,
        },
      });

      return response({
        ok: true,
        blocked: true,
        provider: "netlify",
        blocker_type: "account_credit_limit",
        job_id: job.id,
        retry_at: retryAt,
        message: blocker,
      });
    }

    const failed = await admin.rpc("fail_external_automation_job", {
      target_job_id: job.id,
      worker_name: workerName,
      target_error: message,
    });
    if (failed.error) console.error("Failed to persist production automation failure", failed.error.message);
    return response({ error: message, job_id: job.id }, 500);
  }
});`;

if (!s.includes(oldBlock)) throw new Error('production catch block marker not found');
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(path, s);
console.log('Patched Netlify provider billing blocker handling.');
