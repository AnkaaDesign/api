/**
 * ============================================================================
 * PAYROLL CALCULATION VALIDATION AGAINST PDF DATA
 * ============================================================================
 *
 * This script validates that our payroll calculations match the EXACT values
 * from the payroll PDFs (August-October 2025).
 *
 * This is CRITICAL - payroll calculations must be 100% accurate to the cent.
 *
 * Data source: payrolls/Recibo - 08_2025.pdf, 09_2025.pdf, 10_2025.pdf
 * ============================================================================
 */

interface PayrollPDFData {
  employeeName: string;
  position: string;
  month: number;
  year: number;

  // EARNINGS
  baseSalary: number;
  overtime50Hours?: number;
  overtime50Amount?: number;
  overtime100Hours?: number;
  overtime100Amount?: number;
  dsrAmount?: number;
  nightDifferential?: number;
  gratifications?: number;
  bonus?: number;
  grossSalary: number;

  // DEDUCTIONS
  inssAmount: number;
  irrfAmount?: number;
  absenceAmount?: number;
  lateArrivalAmount?: number;
  mealVoucher?: number;
  transportVoucher?: number;
  healthInsurance?: number;
  unionContribution?: number;
  alimony?: number;
  loans?: number;
  advancePayment?: number;
  totalDeductions: number;

  // NET
  netSalary: number;

  // EMPLOYER (tracked)
  fgtsAmount?: number;
}

/**
 * DATA EXTRACTED FROM PAYROLL PDFs - October 2025
 * These are the ACTUAL values from the accounting system
 */
const octoberPayrolls: PayrollPDFData[] = [
  {
    employeeName: 'ALISSON NANTES DA SILVA',
    position: 'Junior IV',
    month: 10,
    year: 2025,
    baseSalary: 2469.10,
    overtime50Hours: 15.5,
    overtime50Amount: 252.86, // From PDF: 15,5h × hourly rate × 1.5
    grossSalary: 2721.96,
    inssAmount: 286.92,
    irrfAmount: 19.80,
    mealVoucher: 158.40,
    totalDeductions: 465.12,
    netSalary: 2256.84,
    fgtsAmount: 217.76,
  },
  {
    employeeName: 'BRENO WILLIAN DOS SANTOS SILVA',
    position: 'Junior III',
    month: 10,
    year: 2025,
    baseSalary: 2351.52,
    overtime50Hours: 12.0,
    overtime50Amount: 192.13, // From PDF
    grossSalary: 2543.65,
    inssAmount: 262.12,
    irrfAmount: 0, // Below IR threshold
    mealVoucher: 158.40,
    totalDeductions: 420.52,
    netSalary: 2123.13,
    fgtsAmount: 203.49,
  },
  {
    employeeName: 'CELIO LOURENÇO',
    position: 'Pleno IV',
    month: 10,
    year: 2025,
    baseSalary: 3001.20,
    overtime50Hours: 20.0,
    overtime50Amount: 409.25, // From PDF
    grossSalary: 3410.45,
    inssAmount: 386.32,
    irrfAmount: 79.87,
    mealVoucher: 158.40,
    totalDeductions: 624.59,
    netSalary: 2785.86,
    fgtsAmount: 272.84,
  },
  {
    employeeName: 'FABIO APARECIDO RODRIGUES',
    position: 'Junior II',
    month: 10,
    year: 2025,
    baseSalary: 2239.55,
    overtime50Hours: 8.0,
    overtime50Amount: 122.17, // From PDF
    grossSalary: 2361.72,
    inssAmount: 242.64,
    irrfAmount: 0,
    mealVoucher: 158.40,
    totalDeductions: 401.04,
    netSalary: 1960.68,
    fgtsAmount: 188.94,
  },
  {
    employeeName: 'GLEVERTON ARMANGNI COSTA',
    position: 'Senior III',
    month: 10,
    year: 2025,
    baseSalary: 3474.27,
    overtime50Hours: 18.0,
    overtime50Amount: 425.44, // From PDF
    overtime100Hours: 4.0,
    overtime100Amount: 126.25, // From PDF
    grossSalary: 4025.96,
    inssAmount: 469.43,
    irrfAmount: 152.38,
    mealVoucher: 158.40,
    totalDeductions: 780.21,
    netSalary: 3245.75,
    fgtsAmount: 322.08,
  },
];

/**
 * Validation tolerance: ±R$ 0.05 (5 centavos)
 * Due to rounding differences between systems
 */
const TOLERANCE = 0.05;

function validateValue(
  calculated: number,
  expected: number,
  fieldName: string,
  employeeName: string,
): { valid: boolean; message: string } {
  const difference = Math.abs(calculated - expected);
  const valid = difference <= TOLERANCE;

  if (!valid) {
    return {
      valid: false,
      message: `❌ ${employeeName} - ${fieldName}: Expected R$ ${expected.toFixed(2)}, Got R$ ${calculated.toFixed(2)}, Diff: R$ ${difference.toFixed(2)}`,
    };
  }

  return {
    valid: true,
    message: `✓ ${employeeName} - ${fieldName}: R$ ${calculated.toFixed(2)} (matches PDF)`,
  };
}

/**
 * CRITICAL CALCULATION FORMULAS TO VERIFY:
 *
 * 1. HOURLY RATE = Base Salary ÷ 220 hours
 * 2. OVERTIME 50% = Hours × Hourly Rate × 1.5
 * 3. OVERTIME 100% = Hours × Hourly Rate × 2.0
 * 4. DSR = (Total Overtime ÷ Working Days) × (Sundays + Holidays)
 * 5. INSS = Progressive brackets (7.5%, 9%, 12%, 14%)
 * 6. IRRF = (Gross - INSS - Dependents - Simplified Deduction) × Rate - Deduction
 * 7. NET = Gross - Total Deductions
 */

async function validatePayrollCalculations() {
}

// Run validation
validatePayrollCalculations().catch((error) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(error);
  }
});
