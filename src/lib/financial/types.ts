import { FinancialRoutineAmountMode, FinancialRoutineFrequency, FinancialTitleKind } from "@prisma/client";

export type FinancialRoutineGenerationSource = "ROUTINE_ON_DEMAND" | "ROUTINE_SCHEDULER";

export type FinancialRoutineGenerationStatus =
  | "GENERATED"
  | "REPLAYED"
  | "SKIPPED_INACTIVE"
  | "SKIPPED_OUT_OF_PERIOD"
  | "BLOCKED_AMOUNT_REQUIRED"
  | "BLOCKED_CATEGORY_INVALID"
  | "FAILED";

export interface FinancialRoutineGenerationResult {
  routineId: string;
  routineTitle: string;
  status: FinancialRoutineGenerationStatus;
  titleId?: string;
  reason?: string;
}

export interface FinancialRoutineGenerationSummary {
  total: number;
  generated: number;
  replayed: number;
  skipped: number;
  blocked: number;
  failed: number;
}

export interface GenerateRoutineMonthInput {
  barbershopId: string;
  referenceMonth: string; // YYYY-MM
  source: FinancialRoutineGenerationSource;
  actorUserId?: string | null;
  amountOverrides?: Record<string, string>;
  routineId?: string;
}

export interface GenerateRoutineMonthOutput {
  barbershopId: string;
  referenceMonth: string;
  results: FinancialRoutineGenerationResult[];
  summary: FinancialRoutineGenerationSummary;
}

export interface CreateFinancialRoutineInput {
  barbershopId: string;
  createdById: string;
  categoryId: string;
  title: string;
  kind: FinancialTitleKind;
  amountMode: FinancialRoutineAmountMode;
  baseAmount?: string | number | null;
  frequency?: FinancialRoutineFrequency;
  dueDay: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null; // YYYY-MM-DD
  notes?: string | null;
}

export interface UpdateFinancialRoutineInput {
  barbershopId: string;
  routineId: string;
  title?: string;
  categoryId?: string;
  kind?: FinancialTitleKind;
  amountMode?: FinancialRoutineAmountMode;
  baseAmount?: string | number | null;
  dueDay?: number;
  startDate?: string;
  endDate?: string | null;
  notes?: string | null;
  isActive?: boolean;
}
