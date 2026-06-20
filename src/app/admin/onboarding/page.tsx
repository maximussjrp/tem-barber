import Link from "next/link";
import { requireAdmin } from "@/lib/admin-guard";
import prisma from "@/lib/prisma";
import { buildOnboardingSteps, countCompletedOnboardingSteps } from "@/lib/onboarding";
import { OnboardingPublicLink } from "@/components/admin/OnboardingPublicLink";

function StatusBadge({ done }: { done: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest ${
        done
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-300"
      }`}
    >
      {done ? "Concluido" : "Pendente"}
    </span>
  );
}

export default async function OnboardingPage() {
  const { barbershop, barbershopId } = await requireAdmin();

  const [activeServicesCount, activeWorkingHoursCount, schedulableProfessionalsCount] =
    await Promise.all([
      prisma.service.count({ where: { barbershopId: barbershopId!, isActive: true } }),
      prisma.workingHour.count({
        where: { member: { barbershopId: barbershopId!, isActive: true }, isActive: true },
      }),
      prisma.barbershopMember.count({
        where: {
          barbershopId: barbershopId!,
          isActive: true,
          services: { some: {} },
        },
      }),
    ]);

  const steps = buildOnboardingSteps({
    barbershop,
    activeServicesCount,
    activeWorkingHoursCount,
    schedulableProfessionalsCount,
  });
  const completed = countCompletedOnboardingSteps(steps);
  const total = steps.length;
  const ready = completed === total;

  return (
    <div className="p-5 md:p-8 space-y-6 max-w-6xl">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--gold)] mb-2">Configuracao inicial</p>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            Configure sua barbearia
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2 max-w-2xl">
            Siga os passos principais para deixar sua operacao pronta para receber agendamentos.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 min-w-48">
          <p className="text-xs text-[var(--text-muted)]">Progresso</p>
          <p className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            {completed} de {total}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${Math.round((completed / total) * 100)}%` }} />
          </div>
        </div>
      </div>

      <div
        className={`rounded-2xl border p-5 ${
          ready
            ? "border-emerald-500/25 bg-emerald-500/10"
            : "border-[var(--gold-border)] bg-[var(--gold-surface)]"
        }`}
      >
        <p className={`text-sm font-semibold ${ready ? "text-emerald-300" : "text-[var(--gold)]"}`}>
          {ready
            ? "Sua barbearia esta pronta para operar."
            : "Conclua os passos pendentes para liberar uma experiencia completa para seus clientes."}
        </p>
      </div>

      <div className="grid gap-3">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 flex flex-col md:flex-row md:items-center gap-4"
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div
                className={`w-10 h-10 rounded-2xl border flex items-center justify-center font-serif font-bold shrink-0 ${
                  step.done
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-[var(--gold-border)] bg-[var(--gold-surface)] text-[var(--gold)]"
                }`}
              >
                {step.done ? "✓" : index + 1}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-semibold text-[var(--text-primary)]">{step.title}</h2>
                  <StatusBadge done={step.done} />
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-1">{step.description}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-2">{step.feedback}</p>
              </div>
            </div>
            <Link href={step.href} className="btn-outline-gold px-4 py-2 text-sm text-center md:w-44">
              {step.actionLabel}
            </Link>
          </div>
        ))}

        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl border flex items-center justify-center font-serif font-bold shrink-0 ${
                ready
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-muted)]"
              }`}
            >
              7
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-semibold text-[var(--text-primary)]">Finalizacao</h2>
                <StatusBadge done={ready} />
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Revise os passos e use o link publico para fazer um agendamento de teste.
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                {ready ? "Tudo pronto para a primeira operacao." : "Finalize os itens pendentes acima."}
              </p>
            </div>
          </div>
          <Link href="/admin/dashboard" className="btn-outline-gold px-4 py-2 text-sm text-center md:w-44">
            Voltar ao dashboard
          </Link>
        </div>
      </div>

      {barbershop?.slug && <OnboardingPublicLink slug={barbershop.slug} />}
    </div>
  );
}
