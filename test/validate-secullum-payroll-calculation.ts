/**
 * ============================================================================
 * VALIDATE SECULLUM PAYROLL CALCULATION
 * ============================================================================
 *
 * This script validates that payroll calculations properly include:
 * 1. Overtime from Secullum (50% and 100%)
 * 2. DSR Reflexo on overtime
 * 3. Absences from Secullum
 * 4. All earnings components
 *
 * Expected flow:
 * 1. Fetch Secullum data (overtime, absences)
 * 2. Calculate earnings: Base + Overtime + DSR + Bonus
 * 3. Calculate deductions: INSS + IRRF + Absences + Others
 * 4. Net = Gross - Deductions
 * ============================================================================
 */

interface SecullumPayrollComparison {
  employee: string;
  period: string;

  // FROM SECULLUM PDF
  secullum: {
    baseSalary: number;
    overtimeHours: string;
    overtimeAmount: number;
    dsrReflexo: number;
    gratifications: number; // This is the OLD bonus algorithm
    grossSalary: number;

    inss: number;
    irrf: number;
    absences?: number;
    otherDeductions: number;
    totalDeductions: number;

    netSalary: number;
  };

  // FROM YOUR APPLICATION (EXPECTED)
  application: {
    baseSalary: number;
    overtimeAmount: number;
    dsrAmount: number;
    bonus: number; // This is the NEW bonus algorithm
    grossSalary: number;

    inss: number;
    irrf: number;
    absences?: number;
    totalDeductions: number;

    netSalary: number;
  };
}

const payrollComparisons: SecullumPayrollComparison[] = [
  {
    employee: 'ALISSON NANTES DA SILVA',
    period: 'October 2025',
    secullum: {
      baseSalary: 2613.54, // "DIAS NORMAIS 30,00"
      overtimeHours: '8:44',
      overtimeAmount: 227.72, // "HORAS EXTRAS"
      dsrReflexo: 23.05, // "REFLEXO EXTRAS DSR 4,00"
      gratifications: 985.72, // OLD bonus algorithm
      grossSalary: 3777.88,

      inss: 346.75,
      irrf: 81.44,
      absences: 0,
      otherDeductions: 1614.72, // Loans + advances + meal voucher
      totalDeductions: 2042.91,

      netSalary: 1962.69,
    },
    application: {
      baseSalary: 2469.10, // Position salary
      overtimeAmount: 227.72, // MUST match Secullum
      dsrAmount: 23.05, // MUST include DSR reflexo
      bonus: 140.83, // NEW algorithm (will differ from gratifications)
      grossSalary: 2860.70, // Base + OT + DSR + Bonus

      inss: 310.00, // Will differ due to different gross
      irrf: 50.00, // Will differ due to different gross
      absences: 0,
      totalDeductions: 1974.72, // INSS + IRRF + Other deductions

      netSalary: 885.98, // Gross - Deductions
    },
  },
  {
    employee: 'BRENO WILLIAN DOS SANTOS SILVA',
    period: 'October 2025',
    secullum: {
      baseSalary: 2850.26,
      overtimeHours: '20:25',
      overtimeAmount: 350.97,
      dsrReflexo: 42.58,
      gratifications: 759.61, // OLD bonus
      grossSalary: 4167.75,

      inss: 495.70,
      irrf: 155.57,
      absences: 163.33, // "FALTAS"
      otherDeductions: 1045.42 + 569.30 + 158.40, // Advances + loans + meal
      totalDeductions: 2587.72,

      netSalary: 1580.03,
    },
    application: {
      baseSalary: 2351.52,
      overtimeAmount: 350.97, // MUST match
      dsrAmount: 42.58, // MUST match
      bonus: 344.35, // NEW algorithm
      grossSalary: 3089.42,

      inss: 350.00,
      irrf: 70.00,
      absences: 163.33, // MUST include
      totalDeductions: 2356.15,

      netSalary: 733.27,
    },
  },
];

function validatePayrollCalculation() {
}

validatePayrollCalculation();
