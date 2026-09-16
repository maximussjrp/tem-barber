import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function artifact(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Financial routines systemd artifacts", () => {
  const trigger = artifact("deployment/systemd/tem-barber-financial-routines-trigger.sh");
  const service = artifact("deployment/systemd/tem-barber-financial-routines.service");
  const timer = artifact("deployment/systemd/tem-barber-financial-routines.timer");

  it("defines the exact timer schedule and persistence semantics", () => {
    expect(timer).toContain("OnCalendar=*-*-* 06,10,14,18,22:00:00 America/Sao_Paulo");
    expect(timer).toContain("RandomizedDelaySec=60");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("AccuracySec=1s");
    expect(timer).toContain("Unit=tem-barber-financial-routines.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("defines a bounded oneshot service with retry and LoadCredential instead of EnvironmentFile", () => {
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("LoadCredential=d2b-job-secret.env:/etc/tem-barber/d2b-job-secret.env");
    expect(service).toContain("ExecStart=/usr/local/libexec/tem-barber-financial-routines-trigger");
    expect(service).toContain("TimeoutStartSec=620");
    expect(service).toContain("Restart=on-failure");
    expect(service).toContain("RestartSec=300");
    expect(service).toContain("StartLimitIntervalSec=1800");
    expect(service).toContain("StartLimitBurst=3");
    expect(service).not.toContain("EnvironmentFile=");
    expect(service).not.toContain("Environment=D2B_JOB_SECRET");
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

  it("invokes curl with the correct endpoint and hardened flags", () => {
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
      "https://app.tembarber.com.br/api/internal/financial/generate-routines"
    );
    expect(trigger).not.toMatch(/--retry(?:\s|=)/);
    expect(trigger).not.toMatch(/[A-Fa-f0-9]{64}/);
  });

  it("passes the secret via curl --config stdin, not via header argument or environment", () => {
    expect(trigger).toContain('printf \'header = "Authorization: Bearer %s"\\n\'');
    expect(trigger).toContain("--config -");
    expect(trigger).not.toContain("-H \"Authorization:");
    expect(trigger).not.toContain("-H 'Authorization:");
    expect(trigger).not.toContain("x-d2b-job-secret");
  });

  it("is a separate timer from D2B delinquency", () => {
    expect(timer).not.toContain("tem-barber-d2b.service");
    expect(timer).not.toContain("reconcile-delinquency");
    expect(service).not.toContain("reconcile-delinquency");
  });
});
