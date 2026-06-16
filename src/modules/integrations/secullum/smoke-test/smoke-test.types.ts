// Types shared by the Secullum smoke-test (Diagnóstico) feature.

export type SmokeCheckStatus = 'PASS' | 'FAIL' | 'SKIP';

/**
 * A single check result accumulated during a run. Mirrors the
 * SecullumSmokeTestCheck Prisma model (minus the db-managed columns).
 */
export interface SmokeCheckRecord {
  checkKey: string;
  label: string;
  category: string;
  status: SmokeCheckStatus;
  errorMessage: string | null;
  durationMs: number;
  order: number;
}

export type SmokeTrigger = 'SCHEDULED' | 'MANUAL';

/** Mutable context threaded through every phase of a single run. */
export interface SmokeRunContext {
  /** kennedy.ankaa@gmail.com resolved to its Secullum funcionário. null if unresolved. */
  kennedy: {
    userId: string;
    name: string;
    funcionarioId: number;
    /** pontowebapp Basic-auth login (= User.payrollNumber). */
    usuario: string;
  } | null;
  /** tenant-wide funcionário password ("123"). */
  senha: string;
  /** the throwaway test funcionário id, set after create; cleared after delete. */
  testFuncId: number | null;
  /** whether Kennedy was reactivated this run (drives teardown re-dismiss). */
  kennedyRestored: boolean;
  /** master-data ids resolved for the create payload (with HAR fallbacks). */
  empresaId: number;
  horarioId: number;
  funcaoId: number;
  departamentoId: number;
}
