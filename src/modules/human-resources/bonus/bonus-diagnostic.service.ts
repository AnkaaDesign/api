// bonus-diagnostic.service.ts
// Diagnostic service to troubleshoot bonus calculation issues

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class BonusDiagnosticService {
  private readonly logger = new Logger(BonusDiagnosticService.name);

  /**
   * Diagnose bonus calculation for a specific case
   */
  diagnoseBonusCalculation(
    positionName: string,
    performanceLevel: number,
    b1: number,
    actualValue: number,
    expectedValue: number,
  ): {
    diagnosis: string[];
    calculations: Record<string, any>;
  } {
    const diagnosis: string[] = [];
    const calculations: Record<string, any> = {};

    // 1. Check position detection
    const detectedLevel = this.detectPositionLevel(positionName);
    calculations.positionDetection = {
      input: positionName,
      detectedLevel,
      expectedLevel: this.getExpectedLevel(positionName),
    };

    if (detectedLevel !== this.getExpectedLevel(positionName)) {
      diagnosis.push(
        `❌ Position detection failed: "${positionName}" detected as level ${detectedLevel}`,
      );
    } else {
      diagnosis.push(`✅ Position detection correct: level ${detectedLevel}`);
    }

    // 2. Calculate using polynomial
    const polynomial =
      3.31 * Math.pow(b1, 5) -
      61.07 * Math.pow(b1, 4) +
      364.82 * Math.pow(b1, 3) -
      719.54 * Math.pow(b1, 2) +
      465.16 * b1 -
      3.24;
    const position11Base = polynomial * 0.4;

    calculations.polynomial = {
      b1,
      polynomialResult: polynomial,
      position11Base,
    };

    // 3. Calculate cascade
    const position10 = position11Base * (1 - 0.0413);
    const position9 = position10 * (1 - 0.055);

    calculations.cascade = {
      position11: position11Base,
      position10,
      position9,
    };

    // 4. Calculate for detected position
    const positionFactors: Record<number, number> = {
      1: 0.0972,
      2: 0.1932,
      3: 0.322,
      4: 0.4609,
      5: 0.5985,
      6: 0.721,
      7: 0.8283,
      8: 0.9205,
    };

    let positionBase = 0;
    if (detectedLevel <= 8) {
      positionBase = position9 * positionFactors[detectedLevel];
    } else if (detectedLevel === 9) {
      positionBase = position9;
    } else if (detectedLevel === 10) {
      positionBase = position10;
    } else if (detectedLevel === 11) {
      positionBase = position11Base;
    } else if (detectedLevel === 12) {
      positionBase = position11Base * 1.05;
    }

    const calculatedValue = positionBase * performanceLevel;

    calculations.finalCalculation = {
      positionBase,
      performanceMultiplier: performanceLevel,
      calculatedValue,
      expectedValue,
      actualValue,
      difference: actualValue - expectedValue,
      errorPercentage: ((actualValue / expectedValue) * 100).toFixed(1) + '%',
    };

    // 5. Analyze the discrepancy
    const errorRatio = actualValue / expectedValue;

    if (Math.abs(calculatedValue - expectedValue) < 1) {
      diagnosis.push(`✅ Calculation formula is correct`);
    } else {
      diagnosis.push(
        `❌ Calculation mismatch: ${calculatedValue.toFixed(2)} vs ${expectedValue.toFixed(2)}`,
      );
    }

    if (errorRatio < 0.5) {
      diagnosis.push(`⚠️  System value is only ${(errorRatio * 100).toFixed(1)}% of expected`);
      diagnosis.push(`Possible causes:`);
      diagnosis.push(`- Wrong B1 calculation (check task counting)`);
      diagnosis.push(`- Position detection failure`);
      diagnosis.push(`- Incorrect cascade implementation`);
      diagnosis.push(`- Discounts being applied incorrectly`);
    }

    // 6. Check if value matches a different position
    for (let testPos = 1; testPos <= 12; testPos++) {
      let testBase = 0;
      if (testPos <= 8) {
        testBase = position9 * positionFactors[testPos];
      } else if (testPos === 9) {
        testBase = position9;
      } else if (testPos === 10) {
        testBase = position10;
      } else if (testPos === 11) {
        testBase = position11Base;
      } else if (testPos === 12) {
        testBase = position11Base * 1.05;
      }

      const testValue = testBase * performanceLevel;
      if (Math.abs(testValue - actualValue) < 1) {
        diagnosis.push(`🔍 Actual value matches position ${testPos} calculation!`);
        calculations.matchingPosition = {
          position: testPos,
          value: testValue,
        };
      }
    }

    return { diagnosis, calculations };
  }

  private detectPositionLevel(positionName: string): number {
    const normalized = positionName
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/iv/g, 'iv')
      .replace(/iii/g, 'iii')
      .replace(/ii/g, 'ii')
      .replace(/i(?!i|v)/g, 'i');

    // Junior positions (1-4)
    if (normalized.includes('junior iv') || normalized.includes('júnior iv')) return 4;
    if (normalized.includes('junior iii') || normalized.includes('júnior iii')) return 3;
    if (normalized.includes('junior ii') || normalized.includes('júnior ii')) return 2;
    if (
      normalized.includes('junior i') ||
      normalized === 'junior' ||
      normalized.includes('júnior i') ||
      normalized === 'júnior'
    )
      return 1;

    // Pleno positions (5-8)
    if (normalized.includes('pleno iv')) return 8;
    if (normalized.includes('pleno iii')) return 7;
    if (normalized.includes('pleno ii')) return 6;
    if (normalized.includes('pleno i') || normalized === 'pleno') return 5;

    // Senior positions (9-12)
    if (normalized.includes('senior iv') || normalized.includes('sênior iv')) return 12;
    if (normalized.includes('senior iii') || normalized.includes('sênior iii')) return 11;
    if (normalized.includes('senior ii') || normalized.includes('sênior ii')) return 10;
    if (
      normalized.includes('senior i') ||
      normalized === 'senior' ||
      normalized.includes('sênior i') ||
      normalized === 'sênior'
    )
      return 9;

    return 1; // Default
  }

  private getExpectedLevel(positionName: string): number {
    const normalized = positionName.toLowerCase();

    if (normalized.includes('junior')) {
      if (normalized.includes('iv')) return 4;
      if (normalized.includes('iii')) return 3;
      if (normalized.includes('ii')) return 2;
      return 1;
    }

    if (normalized.includes('pleno')) {
      if (normalized.includes('iv')) return 8;
      if (normalized.includes('iii')) return 7;
      if (normalized.includes('ii')) return 6;
      return 5;
    }

    if (normalized.includes('senior') || normalized.includes('sênior')) {
      if (normalized.includes('iv')) return 12;
      if (normalized.includes('iii')) return 11;
      if (normalized.includes('ii')) return 10;
      return 9;
    }

    return 1;
  }

  /**
   * Run comprehensive diagnostic for Junior IV case
   */
  runJuniorIVDiagnostic(): void {
    if (process.env.NODE_ENV !== 'production') {
      console.log('=== Junior IV Bonus Diagnostic ===\n');

      const result = this.diagnoseBonusCalculation(
        'Junior Iv', // As shown in screenshot
        1, // Performance level 1
        4.17647059, // B1 value
        78.6, // Actual system value
        265.42, // Expected Excel value
      );

      console.log('Diagnosis:');
      result.diagnosis.forEach(line => console.log(line));

      console.log('\nCalculations:');
      console.log(JSON.stringify(result.calculations, null, 2));

      console.log('\n📋 Action Items:');
      console.log('1. Verify position detection is working correctly');
      console.log('2. Check if B1 is being calculated correctly (71 tasks / 17 users)');
      console.log('3. Verify no unexpected discounts are being applied');
      console.log('4. Check if the correct formula is being used in production');
    }
  }
}
