"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AgendaToolbar,
  Appointment,
  AppointmentBlock,
  AppointmentModal,
  AppStatus,
  BookingMode,
  CalendarGrid,
  CancelModal,
  computeAppointmentLayouts,
  DeleteAppointmentModal,
  getTodayStr,
  getWeekDays,
  Member,
  NewAppointmentInitialState,
  OperationOptionsModal,
  ScheduleBlock,
  ScheduleBlockDetailsModal,
  ScheduleBlockModal,
  Service,
} from "@/components/agenda";

export { computeAppointmentLayouts, getWeekDays, AppointmentModal, AppointmentBlock };
export type { AppointmentLayout, ScheduleBlock, Appointment } from "@/components/agenda";

function AgendamentosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const today = getTodayStr();
  const currentDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [barbershopServices, setBarbershopServices] = useState<Service[]>([]);
  const [barbershopName, setBarbershopName] = useState("");
  const [barbershopSlug, setBarbershopSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterMember, setFilterMember] = useState("");

  const [editTarget, setEditTarget] = useState<Appointment | null | "new">(null);
  const [newAppointmentInitial, setNewAppointmentInitial] =
    useState<NewAppointmentInitialState | null>(null);
  const [newAppointmentMode, setNewAppointmentMode] = useState<BookingMode>("NORMAL");
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Appointment | null>(null);

  const [operationOptionsOpen, setOperationOptionsOpen] = useState(false);
  const [scheduleBlockOpen, setScheduleBlockOpen] = useState(false);
  const [scheduleBlockInitial, setScheduleBlockInitial] = useState<{
    memberId?: string;
    startTime?: string;
  } | null>(null);
  const [selectedScheduleBlock, setSelectedScheduleBlock] = useState<{
    block: ScheduleBlock;
    memberName: string;
  } | null>(null);

  useEffect(() => {
    const customerId = searchParams.get("customerId");
    const sourceAppointmentId = searchParams.get("sourceAppointmentId");
    const memberIdParam = searchParams.get("memberId");
    const serviceIdsParam = searchParams.get("serviceIds");

    if (!customerId || loading) return;
    const requestedCustomerId = customerId;

    async function setupPreFilledBooking() {
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete("customerId");
      newParams.delete("sourceAppointmentId");
      newParams.delete("memberId");
      newParams.delete("serviceIds");
      router.replace(`${window.location.pathname}?${newParams.toString()}`);

      let prefilledMemberId = memberIdParam ?? "";
      let prefilledServices: string[] = [];

      if (sourceAppointmentId) {
        try {
          const res = await fetch(`/api/admin/appointments/${sourceAppointmentId}`);
          if (res.ok) {
            const appt = await res.json();
            prefilledMemberId = appt.barber?.id ?? "";
            prefilledServices = (appt.services ?? [])
              .map((s: { service?: { name?: string } }) => {
                const match = barbershopServices.find((bs) => bs.name === s.service?.name);
                return match?.id ?? "";
              })
              .filter(Boolean);
          }
        } catch (e) {
          console.error("Erro ao carregar agendamento de origem para rebook:", e);
        }
      } else if (serviceIdsParam) {
        prefilledServices = serviceIdsParam.split(",").filter(Boolean);
      }

      let clientDetails = null;
      try {
        const clientRes = await fetch(`/api/admin/clients/${requestedCustomerId}`);
        if (clientRes.ok) {
          const clientData = await clientRes.json();
          clientDetails = {
            id: clientData.id,
            name: clientData.name,
            phone: clientData.phone,
          };
        }
      } catch (e) {
        console.error("Erro ao buscar detalhes do cliente para prefill:", e);
      }

      setNewAppointmentInitial({
        memberId: prefilledMemberId || undefined,
        dateTime: `${currentDate}T09:00`,
        customerId: requestedCustomerId,
        customerName: clientDetails?.name ?? "",
        customerPhone: clientDetails?.phone ?? "",
        serviceIds: prefilledServices,
      });
      setNewAppointmentMode("NORMAL");
      setEditTarget("new");
    }

    setupPreFilledBooking();
  }, [searchParams, loading, barbershopServices, router, currentDate]);

  const fetchData = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (filterMember) params.set("memberId", filterMember);
      const [apptRes, svcRes] = await Promise.all([
        fetch(`/api/admin/appointments?${params}`),
        fetch("/api/admin/services?activeOnly=true"),
      ]);
      const apptData = await apptRes.json();
      const svcData = await svcRes.json();
      setAppointments(apptData.appointments ?? []);
      setScheduleBlocks(apptData.scheduleBlocks ?? []);
      setMembers(apptData.members ?? []);
      setBarbershopName(apptData.barbershopName ?? "");
      setBarbershopSlug(apptData.barbershopSlug ?? "");
      setBarbershopServices(Array.isArray(svcData) ? svcData : (svcData.services ?? []));
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => {
    fetchData(currentDate);
  }, [currentDate, fetchData]);

  const handleSaved = (a: Appointment) => {
    setAppointments((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = a;
        return next;
      }
      return [...prev, a];
    });
    setEditTarget(null);
    setNewAppointmentInitial(null);
    setNewAppointmentMode("NORMAL");
  };

  const handleUpdated = (a: Appointment) => {
    setAppointments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    setEditTarget((current) =>
      current && current !== "new" && current.id === a.id ? a : current
    );
  };

  const handleCancelled = (a: Appointment) => {
    setAppointments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    setCancelTarget(null);
  };

  const handleDeleted = (id: string) => {
    setAppointments((prev) => prev.filter((x) => x.id !== id));
    setDeleteTarget(null);
  };

  const handleBlockChanged = () => {
    fetchData(currentDate);
  };

  const handleStatusChange = (id: string, status: AppStatus) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleOpenComanda = async (appointment: Appointment) => {
    const res = await fetch("/api/admin/comandas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: appointment.id }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/admin/comandas/${data.id}`);
    } else {
      alert(data.message ?? data.error ?? "Erro ao abrir atendimento.");
    }
  };

  const openNewAppointment = (
    initialState: NewAppointmentInitialState | null = null,
    mode: BookingMode = "NORMAL"
  ) => {
    setNewAppointmentInitial(initialState);
    setNewAppointmentMode(mode);
    setEditTarget("new");
  };

  const confirmed = appointments.filter((a) => a.status === "CONFIRMED").length;
  const pending = appointments.filter((a) => a.status === "PENDING").length;

  let totalServices = 0;
  let revenue = 0;

  for (const a of appointments) {
    if (a.status === "CANCELLED") {
      continue;
    }
    const comanda = a.comandas?.[0];
    if (comanda) {
      if (comanda.status !== "CANCELLED") {
        revenue += parseFloat(comanda.total || "0");
        const activeItems =
          comanda.items?.filter(
            (item) =>
              (item.type === "SERVICE" || item.type === "PRODUCT") &&
              item.status !== "CANCELLED"
          ) ?? [];
        totalServices += activeItems.reduce(
          (sum, item) => sum + parseFloat(item.quantity || "0"),
          0
        );
      }
    } else {
      revenue += parseFloat(a.totalPrice || "0");
      totalServices += a.services?.length ?? 0;
    }
  }

  const shareMembersData = members.map((m) => ({
    id: m.id,
    name: m.user.name,
    startTime: m.startTime || "",
    endTime: m.endTime || "",
    freeSlots: m.freeSlots || [],
  }));

  return (
    <>
      {editTarget !== null && (
        <AppointmentModal
          appointment={editTarget === "new" ? null : editTarget}
          members={members}
          barbershopServices={barbershopServices}
          appointments={appointments}
          currentDate={currentDate}
          initialState={editTarget === "new" ? newAppointmentInitial : null}
          initialBookingMode={editTarget === "new" ? newAppointmentMode : undefined}
          onClose={() => {
            setEditTarget(null);
            setNewAppointmentInitial(null);
            setNewAppointmentMode("NORMAL");
          }}
          onSaved={handleSaved}
        />
      )}
      {cancelTarget && (
        <CancelModal
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}
      {deleteTarget && (
        <DeleteAppointmentModal
          appointment={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
      {operationOptionsOpen && (
        <OperationOptionsModal
          onClose={() => setOperationOptionsOpen(false)}
          onSelectFitIn={() => openNewAppointment(null, "FIT_IN")}
          onSelectBlock={() => setScheduleBlockOpen(true)}
        />
      )}
      {scheduleBlockOpen && (
        <ScheduleBlockModal
          members={members}
          currentDate={currentDate}
          initialMemberId={scheduleBlockInitial?.memberId || filterMember || undefined}
          initialStartTime={scheduleBlockInitial?.startTime}
          onClose={() => {
            setScheduleBlockOpen(false);
            setScheduleBlockInitial(null);
          }}
          onCreated={handleBlockChanged}
        />
      )}
      {selectedScheduleBlock && (
        <ScheduleBlockDetailsModal
          block={selectedScheduleBlock.block}
          memberName={selectedScheduleBlock.memberName}
          onClose={() => setSelectedScheduleBlock(null)}
          onDeleted={handleBlockChanged}
        />
      )}

      <div className="flex flex-col h-[calc(100dvh-57px)] lg:h-[calc(100dvh-64px)]">
        <AgendaToolbar
          currentDate={currentDate}
          mode="admin"
          members={members}
          filterMember={filterMember}
          onFilterMemberChange={setFilterMember}
          stats={{
            totalServices,
            confirmed,
            pending,
            revenue,
          }}
          onOpenNewAppointment={() => openNewAppointment(null, "NORMAL")}
          onOpenOptions={() => setOperationOptionsOpen(true)}
          shareMembersData={shareMembersData}
          barbershopName={barbershopName}
          barbershopSlug={barbershopSlug}
          basePath="/admin/agendamentos"
        />

        {/* ── Calendar body ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-stone-600 text-sm">
              Carregando agenda...
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-stone-500">Nenhum barbeiro ativo encontrado.</p>
            </div>
          ) : (
            <CalendarGrid
              appointments={appointments}
              scheduleBlocks={scheduleBlocks}
              members={members}
              filterMember={filterMember}
              onEdit={(a) => setEditTarget(a)}
              onCancel={(a) => setCancelTarget(a)}
              onDelete={(a) => setDeleteTarget(a)}
              onSelectScheduleBlock={(b, memberName) =>
                setSelectedScheduleBlock({ block: b, memberName })
              }
              onStatusChange={handleStatusChange}
              onAppointmentUpdated={handleUpdated}
              onOpenComanda={handleOpenComanda}
              currentDate={currentDate}
              onEmptySlotClick={openNewAppointment}
              barbershopName={barbershopName}
              mode="admin"
            />
          )}
        </div>
      </div>
    </>
  );
}

export default function AgendamentosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full py-20 text-stone-600 text-sm">
          Carregando...
        </div>
      }
    >
      <AgendamentosContent />
    </Suspense>
  );
}
