/**
 * Standalone verification script — runs the new BonusCalculationService
 * against golden values captured from bonus-simulator.html.
 *
 * Usage: npx tsx scripts/verify-bonus-calculation.ts
 *
 * Exits 0 if all golden values match, 1 if any drift detected.
 */

import {
  BonusCalculationService,
  DEFAULT_BONUS_CONFIG,
} from '../src/modules/human-resources/bonus/bonus-calculation.service';

const POSITIONS = [
  { name: 'Junior I', salary: 2257.67 },
  { name: 'Junior II', salary: 2393.13 },
  { name: 'Junior III', salary: 2536.72 },
  { name: 'Junior IV', salary: 2688.92 },
  { name: 'Pleno I', salary: 2850.26 },
  { name: 'Pleno II', salary: 3021.28 },
  { name: 'Pleno III', salary: 3202.56 },
  { name: 'Pleno IV', salary: 3394.7 },
  { name: 'Senior I', salary: 3572.52 },
  { name: 'Senior II', salary: 3800.55 },
  { name: 'Senior III', salary: 4043.14 },
  { name: 'Senior IV', salary: 4285.73 },
];
const SALARY_RANGE = { min: 2257.67, max: 4285.73 };

const GOLDEN_B1_4: Record<string, Record<number, number>> = {
  'Junior I':    { 1: 45.64,  2: 91.27,   3: 136.91,  4: 159.73,  5: 182.54 },
  'Junior II':   { 1: 106.2,  2: 212.41,  3: 318.61,  4: 371.72,  5: 424.82 },
  'Junior III':  { 1: 172.53, 2: 345.06,  3: 517.59,  4: 603.86,  5: 690.13 },
  'Junior IV':   { 1: 241.76, 2: 483.53,  3: 725.29,  4: 846.17,  5: 967.06 },
  'Pleno I':     { 1: 310.51, 2: 621.03,  3: 931.54,  4: 1086.8,  5: 1242.06 },
  'Pleno II':    { 1: 375.48, 2: 750.96,  3: 1126.44, 4: 1314.18, 5: 1501.92 },
  'Pleno III':   { 1: 434.06, 2: 868.11,  3: 1302.17, 4: 1519.19, 5: 1736.22 },
  'Pleno IV':    { 1: 484.67, 2: 969.34,  3: 1454.01, 4: 1696.35, 5: 1938.68 },
  'Senior I':    { 1: 522.07, 2: 1044.14, 3: 1566.21, 4: 1827.25, 5: 2088.28 },
  'Senior II':   { 1: 559.01, 2: 1118.02, 3: 1677.04, 4: 1956.54, 5: 2236.05 },
  'Senior III':  { 1: 587.74, 2: 1175.48, 3: 1763.22, 4: 2057.09, 5: 2350.96 },
  'Senior IV':   { 1: 608.48, 2: 1216.96, 3: 1825.44, 4: 2129.68, 5: 2433.92 },
};

const PAGE2_FIXTURE = [
  { positionName: 'Junior III', performanceLevel: 3, expected: 86.65 },
  { positionName: 'Junior IV',  performanceLevel: 3, expected: 116.68 },
  { positionName: 'Junior I',   performanceLevel: 5, expected: 41.89 },
  { positionName: 'Junior II',  performanceLevel: 3, expected: 57.73 },
  { positionName: 'Pleno I',    performanceLevel: 3, expected: 146.07 },
  { positionName: 'Pleno I',    performanceLevel: 3, expected: 146.07 },
  { positionName: 'Pleno I',    performanceLevel: 3, expected: 146.07 },
  { positionName: 'Senior III', performanceLevel: 3, expected: 254.79 },
  { positionName: 'Junior I',   performanceLevel: 5, expected: 41.89 },
  { positionName: 'Junior IV',  performanceLevel: 3, expected: 116.68 },
  { positionName: 'Pleno I',    performanceLevel: 3, expected: 146.07 },
  { positionName: 'Pleno I',    performanceLevel: 3, expected: 146.07 },
  { positionName: 'Pleno IV',   performanceLevel: 3, expected: 216.92 },
  { positionName: 'Senior III', performanceLevel: 3, expected: 254.79 },
  { positionName: 'Junior II',  performanceLevel: 3, expected: 57.73 },
  { positionName: 'Junior IV',  performanceLevel: 3, expected: 116.68 },
];
const PAGE2_CONFIG = { k: 3.8, x0: 0.24, piso: 0.12, pscale: 0.5, ceil: 5.8, adjustment: 0.05 };
const PAGE2_TOTAL = 2092.78;

const svc = new BonusCalculationService();

let fails = 0;
let runs = 0;
const fmt = (v: number) => v.toFixed(2).padStart(10);

function assertEq(label: string, actual: number, expected: number) {
  runs++;
  if (actual === expected) {
    console.log(`  ✓ ${label.padEnd(50)} ${fmt(actual)}`);
  } else {
    fails++;
    console.log(`  ✗ ${label.padEnd(50)} got ${fmt(actual)}  expected ${fmt(expected)}`);
  }
}

console.log('\n=== B1=4, default config — 12 positions × 5 perf levels ===');
for (const pos of POSITIONS) {
  for (const perf of [1, 2, 3, 4, 5] as const) {
    const r = svc.calculate({
      salary: pos.salary,
      performanceLevel: perf,
      averageTasksPerUser: 4,
      salaryRange: SALARY_RANGE,
    });
    assertEq(`${pos.name} perf=${perf}`, r.bonus, GOLDEN_B1_4[pos.name][perf]);
  }
}

console.log('\n=== Algebraic identities ===');
{
  const rMin = svc.calculate({
    salary: SALARY_RANGE.min,
    performanceLevel: 1,
    averageTasksPerUser: 4,
    salaryRange: SALARY_RANGE,
  });
  const ratioOK = Math.abs(rMin.ratio - DEFAULT_BONUS_CONFIG.piso) < 1e-12;
  console.log(`  ${ratioOK ? '✓' : '✗'} ratio at sMin = piso (${rMin.ratio} ≈ ${DEFAULT_BONUS_CONFIG.piso})`);
  if (!ratioOK) fails++;
  runs++;

  const rMax = svc.calculate({
    salary: SALARY_RANGE.max,
    performanceLevel: 1,
    averageTasksPerUser: 4,
    salaryRange: SALARY_RANGE,
  });
  const ratio1OK = Math.abs(rMax.ratio - 1) < 1e-12;
  console.log(`  ${ratio1OK ? '✓' : '✗'} ratio at sMax = 1.0 (${rMax.ratio})`);
  if (!ratio1OK) fails++;
  runs++;
}

console.log('\n=== Edge cases ===');
{
  const b0 = svc.calculate({ salary: 2850, performanceLevel: 3, averageTasksPerUser: 0, salaryRange: SALARY_RANGE });
  assertEq('B1=0', b0.bonus, 0);

  const bNeg = svc.calculate({ salary: 2850, performanceLevel: 3, averageTasksPerUser: -1, salaryRange: SALARY_RANGE });
  assertEq('B1=-1', bNeg.bonus, 0);

  const b10 = svc.calculate({ salary: 2850, performanceLevel: 3, averageTasksPerUser: 10, salaryRange: SALARY_RANGE });
  const b6 = svc.calculate({ salary: 2850, performanceLevel: 3, averageTasksPerUser: 6, salaryRange: SALARY_RANGE });
  assertEq('B1=10 clamps to ceil=6', b10.bonus, b6.bonus);

  const sZero = svc.calculate({ salary: 0, performanceLevel: 3, averageTasksPerUser: 4, salaryRange: SALARY_RANGE });
  assertEq('salary=0', sZero.bonus, 0);

  const sNaN = svc.calculate({ salary: NaN, performanceLevel: 3, averageTasksPerUser: 4, salaryRange: SALARY_RANGE });
  assertEq('salary=NaN', sNaN.bonus, 0);

  const p0 = svc.calculate({ salary: 2850, performanceLevel: 0, averageTasksPerUser: 4, salaryRange: SALARY_RANGE });
  assertEq('perfLevel=0', p0.bonus, 0);

  const p99 = svc.calculate({ salary: 2850, performanceLevel: 99, averageTasksPerUser: 4, salaryRange: SALARY_RANGE });
  assertEq('perfLevel=99', p99.bonus, 0);
}

console.log('\n=== Page 2 fixture (16 employees, B1=2.19, custom config) ===');
let totalP2 = 0;
for (const f of PAGE2_FIXTURE) {
  const pos = POSITIONS.find(p => p.name === f.positionName)!;
  const r = svc.calculate({
    salary: pos.salary,
    performanceLevel: f.performanceLevel,
    averageTasksPerUser: 2.19,
    salaryRange: SALARY_RANGE,
    config: PAGE2_CONFIG,
  });
  totalP2 += r.bonus;
  assertEq(`${f.positionName} perf=${f.performanceLevel}`, r.bonus, f.expected);
}
const totalRounded = Math.round(totalP2 * 100) / 100;
assertEq('Page 2 total of 16 employees', totalRounded, PAGE2_TOTAL);

console.log(`\n=== ${runs - fails}/${runs} passed${fails ? `,  ${fails} FAILED` : ''} ===\n`);
process.exit(fails === 0 ? 0 : 1);
