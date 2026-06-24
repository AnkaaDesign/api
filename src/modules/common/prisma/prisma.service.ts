import { Global, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Global()
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Optional: Add any Prisma client options here
      // log: ['query', 'info', 'warn', 'error'],
      // Never ship credential material in query results — applies to nested
      // relation payloads too (e.g. include: { user: true } anywhere).
      // Auth flows that legitimately need these fields re-enable them
      // per-query via UserRepository.findByIdWithCredentials.
      // Normalized companion columns are filter-only (accent-insensitive search);
      // never expose them in results so domain types stay unchanged. user.password/
      // sessionToken remain omitted for credential safety.
      omit: {
        admission: {
          notesNormalized: true,
        },
        admissionDocument: {
          noteNormalized: true,
        },
        agendaEvent: {
          descriptionNormalized: true,
          titleNormalized: true,
        },
        app: {
          nameNormalized: true,
        },
        assessment: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        assessmentEntry: {
          notesNormalized: true,
        },
        backup: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        backupSchedule: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        benefit: {
          nameNormalized: true,
          notesNormalized: true,
          providerNormalized: true,
        },
        bonusDiscount: {
          referenceNormalized: true,
        },
        bonusExtra: {
          referenceNormalized: true,
        },
        changeLog: {
          fieldNormalized: true,
          reasonNormalized: true,
        },
        contractPhaseHistory: {
          reasonNormalized: true,
        },
        customer: {
          addressNormalized: true,
          cityNormalized: true,
          cnpjNormalized: true,
          corporateNameNormalized: true,
          cpfNormalized: true,
          emailNormalized: true,
          fantasyNameNormalized: true,
          neighborhoodNormalized: true,
          stateNormalized: true,
        },
        dependent: {
          cpfNormalized: true,
          nameNormalized: true,
          notesNormalized: true,
        },
        deployment: {
          appIdNormalized: true,
          gitCommitIdNormalized: true,
          versionNormalized: true,
        },
        economicActivity: {
          codeNormalized: true,
          descriptionNormalized: true,
        },
        employmentContract: {
          notesNormalized: true,
          providerNameNormalized: true,
        },
        externalOperation: {
          notesNormalized: true,
          withdrawerNameNormalized: true,
        },
        externalOperationServiceItem: {
          descriptionNormalized: true,
        },
        file: {
          filenameNormalized: true,
          mimetypeNormalized: true,
          originalNameNormalized: true,
        },
        fiscalDocumentItem: {
          codeNormalized: true,
          descriptionNormalized: true,
        },
        fiscalDocumentOrderCode: {
          codeNormalized: true,
        },
        fispq: {
          casNumberNormalized: true,
          manufacturerNormalized: true,
          notesNormalized: true,
          onuNumberNormalized: true,
          productNameNormalized: true,
        },
        invoice: {
          notesNormalized: true,
        },
        item: {
          nameNormalized: true,
          uniCodeNormalized: true,
        },
        itemBrand: {
          nameNormalized: true,
        },
        itemCategory: {
          nameNormalized: true,
        },
        leave: {
          inssBenefitNumberNormalized: true,
          notesNormalized: true,
        },
        maintenance: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        maintenanceSchedule: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        medicalExam: {
          clinicNormalized: true,
          notesNormalized: true,
          physicianNameNormalized: true,
        },
        message: {
          titleNormalized: true,
        },
        notification: {
          bodyNormalized: true,
          titleNormalized: true,
        },
        notificationConfiguration: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        observation: {
          descriptionNormalized: true,
        },
        order: {
          descriptionNormalized: true,
          notesNormalized: true,
        },
        orderInstallment: {
          notesNormalized: true,
        },
        orderSchedule: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        paint: {
          codeNormalized: true,
          nameNormalized: true,
        },
        paintBrand: {
          nameNormalized: true,
        },
        paintFormula: {
          descriptionNormalized: true,
        },
        paintType: {
          nameNormalized: true,
        },
        payrollDiscount: {
          lenderNameNormalized: true,
          referenceNormalized: true,
        },
        payrollMonthSettlement: {
          notesNormalized: true,
        },
        position: {
          nameNormalized: true,
        },
        postit: {
          contentNormalized: true,
        },
        ppeDelivery: {
          reasonNormalized: true,
        },
        ppeDeliverySchedule: {
          nameNormalized: true,
        },
        questionnaire: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        questionnaireEntry: {
          notesNormalized: true,
        },
        questionnaireGroup: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        questionnaireOption: {
          descriptionNormalized: true,
        },
        questionnaireQuestion: {
          descriptionNormalized: true,
          titleNormalized: true,
        },
        reconciliationMatch: {
          notesNormalized: true,
        },
        recurrentPayable: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        repository: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        responsible: {
          emailNormalized: true,
          nameNormalized: true,
          phoneNormalized: true,
        },
        salaryAdjustment: {
          noteNormalized: true,
        },
        sector: {
          nameNormalized: true,
        },
        serviceOrder: {
          descriptionNormalized: true,
        },
        skill: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        statisticsPreset: {
          nameNormalized: true,
        },
        supplier: {
          addressNormalized: true,
          cityNormalized: true,
          cnpjNormalized: true,
          corporateNameNormalized: true,
          emailNormalized: true,
          fantasyNameNormalized: true,
          neighborhoodNormalized: true,
          stateNormalized: true,
        },
        task: {
          detailsNormalized: true,
          nameNormalized: true,
          serialNumberNormalized: true,
        },
        taskFieldChangeLog: {
          fieldNormalized: true,
        },
        taskForecastHistory: {
          notesNormalized: true,
          reasonNormalized: true,
        },
        taskQuoteService: {
          descriptionNormalized: true,
        },
        taxBracket: {
          descriptionNormalized: true,
        },
        taxTable: {
          descriptionNormalized: true,
        },
        termination: {
          justCauseArticleNormalized: true,
          reasonNormalized: true,
        },
        terminationDocument: {
          noteNormalized: true,
        },
        terminationItem: {
          descriptionNormalized: true,
        },
        thirteenth: {
          notesNormalized: true,
        },
        topic: {
          descriptionNormalized: true,
          titleNormalized: true,
        },
        topicLevel: {
          descriptionNormalized: true,
          nameNormalized: true,
        },
        transactionCategory: {
          nameNormalized: true,
        },
        truck: {
          chassisNumberNormalized: true,
          plateNormalized: true,
        },
        user: {
          password: true,
          sessionToken: true,
          addressNormalized: true,
          cityNormalized: true,
          cpfNormalized: true,
          emailNormalized: true,
          nameNormalized: true,
          neighborhoodNormalized: true,
          phoneNormalized: true,
          pisNormalized: true,
          stateNormalized: true,
        },
        userBenefit: {
          notesNormalized: true,
        },
        userPositionHistory: {
          noteNormalized: true,
        },
        vacation: {
          notesNormalized: true,
        },
        vacationGroup: {
          nameNormalized: true,
          notesNormalized: true,
        },
        warehouseLocation: {
          codeNormalized: true,
          descriptionNormalized: true,
          nameNormalized: true,
          sectionNormalized: true,
        },
        warning: {
          descriptionNormalized: true,
          hrNotesNormalized: true,
          reasonNormalized: true,
        },
        wasteCertificate: {
          descriptionNormalized: true,
        },
        workAccidentReport: {
          catNumberNormalized: true,
          descriptionNormalized: true,
        },
      },
      transactionOptions: {
        maxWait: 15000, // default: 2000, increased to 15s for complex operations
        timeout: 60000, // default: 5000, increased to 60s for complex operations like file processing
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
