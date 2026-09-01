import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function artifact(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("D2B systemd artifacts", () => {
  const trigger = artifact("deployment/systemd/tem-barber-d2b-trigger.sh");
  const service = artifact("deployment/systemd/tem-barber-d2b.service");
  const timer = artifact("deployment/systemd/tem-barber-d2b.timer");

  it("defines the exact timer schedule and persistence semantics", () => {
    expect(timer).toContain("OnCalendar=*-*-* *:05:00 America/Sao_Paulo");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("AccuracySec=1s");
    expect(timer).toContain("Unit=tem-barber-d2b.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("defines a bounded oneshot service using LoadCredential instead of EnvironmentFile", () => {
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("LoadCredential=d2b-job-secret.env:/etc/tem-barber/d2b-job-secret.env");
    expect(service).toContain("ExecStart=/usr/local/libexec/tem-barber-d2b-trigger");
    expect(service).toContain("TimeoutStartSec=620");
    expect(service).not.toContain("EnvironmentFile=");
    expect(service).not.toContain("Environment=D2B_JOB_SECRET");
    expect(service).not.toMatch(/^Restart=/m);
    expect(service).not.toContain("Authorization:");
    expect(service).not.toContain("Bearer ");
  });

  it("reads the systemd credential directory or canonical fallback without sourcing the secret file", () => {
    expect(trigger).toContain("CREDENTIALS_DIRECTORY");
    expect(trigger).toContain("/etc/tem-barber/d2b-job-secret.env");
    expect(trigger).toContain("unset D2B_JOB_SECRET");
    expect(trigger).not.toContain(". /etc/tem-barber/d2b-job-secret.env");
    expect(trigger).not.toContain("source /etc/tem-barber/d2b-job-secret.env");
    expect(trigger).not.toContain(". \"/etc/tem-barber/d2b-job-secret.env\"");
    expect(trigger).not.toContain("source");
  });

  it("invokes curl with the frozen local-Caddy flags and no retry", () => {
    expect(trigger).toMatch(/^#!\/bin\/sh\r?\nset -eu/m);
    expect(trigger).toContain("unset D2B_JOB_SECRET");
    expect(trigger).toContain("env -u D2B_JOB_SECRET curl");
    expect(trigger).toContain("--config -");
    expect(trigger).toContain("--fail-with-body");
    expect(trigger).toContain("--silent");
    expect(trigger).toContain("--show-error");
    expect(trigger).toContain("--connect-timeout 5");
    expect(trigger).toContain("--max-time 600");
    expect(trigger).toContain("--request POST");
    expect(trigger).toContain("--resolve app.tembarber.com.br:443:127.0.0.1");
    expect(trigger).toContain(
      "https://app.tembarber.com.br/api/internal/billing/reconcile-delinquency"
    );
    expect(trigger).not.toMatch(/--retry(?:\s|=)/);
    expect(trigger).not.toMatch(/[A-Fa-f0-9]{64}/);
  });

  it("requires the hardened production Compose validation pattern in the runbook", () => {
    const runbook = artifact("deployment/runbooks/d2b-delinquency-scheduler.md");

    expect(runbook).toContain("env -u D2B_JOB_SECRET docker compose");
    expect(runbook).toContain("--env-file /opt/tem-barber/deployment/.env");
    expect(runbook).toContain("--env-file /etc/tem-barber/d2b-job-secret.env");
    expect(runbook).toContain("config -q");
    expect(runbook).not.toContain("config --environment");
    expect(runbook).not.toMatch(/D2B_JOB_SECRET\s*=\s*['\"][^'\"]+['\"]/);
    expect(runbook).not.toMatch(/docker compose\s*\\\s*\n\s*-p deployment\s*\\\s*\n\s*--env-file .*?\s*\\\s*\n\s*--env-file .*?\s*\\\s*\n\s*-f .*?\s*\\\s*\n\s*config\s*$/m);
  });
});
