// personnel-department.module.ts

import { Module } from '@nestjs/common';
import { BonusModule } from './bonus/bonus.module';
import { PayrollModule } from './payroll/payroll.module';
import { DependentModule } from './dependent/dependent.module';
import { HrStatisticsModule } from './statistics/hr-statistics.module';
import { SalaryAdjustmentModule } from './salary-adjustment/salary-adjustment.module';
import { UserPositionHistoryModule } from './user-position-history/user-position-history.module';
import { BenefitModule } from './benefit/benefit.module';
import { AdmissionModule } from './admission/admission.module';
import { EmploymentContractModule } from './employment-contract/employment-contract.module';
import { TerminationModule } from './termination/termination.module';
import { MedicalExamModule } from './medical-exam/medical-exam.module';
import { LeaveModule } from './leave/leave.module';
import { WorkAccidentModule } from './work-accident/work-accident.module';
import { AgendaEventModule } from './agenda-event/agenda-event.module';
import { PostitModule } from './postit/postit.module';
import { ThirteenthModule } from './thirteenth/thirteenth.module';
import { VacationModule } from './vacation/vacation.module';
import { VacationGroupModule } from './vacation-group/vacation-group.module';

@Module({
  imports: [
    BonusModule,
    PayrollModule,
    DependentModule,
    HrStatisticsModule,
    SalaryAdjustmentModule,
    UserPositionHistoryModule,
    BenefitModule,
    AdmissionModule,
    EmploymentContractModule,
    TerminationModule,
    MedicalExamModule,
    LeaveModule,
    WorkAccidentModule,
    AgendaEventModule,
    PostitModule,
    ThirteenthModule,
    VacationModule,
    VacationGroupModule,
  ],
  exports: [
    BonusModule,
    PayrollModule,
    HrStatisticsModule,
    SalaryAdjustmentModule,
    UserPositionHistoryModule,
    BenefitModule,
    AdmissionModule,
    EmploymentContractModule,
    TerminationModule,
    MedicalExamModule,
    LeaveModule,
    DependentModule,
    AgendaEventModule,
    PostitModule,
    ThirteenthModule,
    VacationModule,
    VacationGroupModule,
  ],
})
export class PersonnelDepartmentModule {}
