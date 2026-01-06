/**
 * Analyze the exact overtime calculation formula used in the payroll PDFs
 */

interface OvertimeAnalysis {
  employee: string;
  baseSalary: number;
  overtimeHours: number;
  overtimeAmount: number; // From PDF
  multiplier: number; // 1.5 or 2.0
}

const overtimeData: OvertimeAnalysis[] = [
  {
    employee: 'ALISSON NANTES',
    baseSalary: 2469.10,
    overtimeHours: 15.5,
    overtimeAmount: 252.86,
    multiplier: 1.5,
  },
  {
    employee: 'BRENO WILLIAN',
    baseSalary: 2351.52,
    overtimeHours: 12.0,
    overtimeAmount: 192.13,
    multiplier: 1.5,
  },
  {
    employee: 'CELIO LOURENÇO',
    baseSalary: 3001.20,
    overtimeHours: 20.0,
    overtimeAmount: 409.25,
    multiplier: 1.5,
  },
  {
    employee: 'FABIO APARECIDO',
    baseSalary: 2239.55,
    overtimeHours: 8.0,
    overtimeAmount: 122.17,
    multiplier: 1.5,
  },
  {
    employee: 'GLEVERTON (50%)',
    baseSalary: 3474.27,
    overtimeHours: 18.0,
    overtimeAmount: 425.44,
    multiplier: 1.5,
  },
  {
    employee: 'GLEVERTON (100%)',
    baseSalary: 3474.27,
    overtimeHours: 4.0,
    overtimeAmount: 126.25,
    multiplier: 2.0,
  },
];

// Analysis logic removed
