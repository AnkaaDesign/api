-- Accent-insensitive search support.
-- Adds lower(unaccent(...)) generated columns mirrored by normalizeSearchTerm() in code.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Immutable wrapper so the column can be GENERATED ALWAYS ... STORED.
-- Passing the dictionary name explicitly makes unaccent() safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT unaccent('unaccent', $1) $$;

ALTER TABLE "Admission"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "AdmissionDocument"
  ADD COLUMN IF NOT EXISTS "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("note"))) STORED;

ALTER TABLE "AgendaEvent"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

ALTER TABLE "Assessment"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "AssessmentEntry"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "Backup"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "BackupSchedule"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Benefit"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "providerNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("provider"))) STORED;

ALTER TABLE "BonusDiscount"
  ADD COLUMN IF NOT EXISTS "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reference"))) STORED;

ALTER TABLE "BonusExtra"
  ADD COLUMN IF NOT EXISTS "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reference"))) STORED;

ALTER TABLE "ChangeLog"
  ADD COLUMN IF NOT EXISTS "fieldNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("field"))) STORED,
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "ContractPhaseHistory"
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("address"))) STORED,
  ADD COLUMN IF NOT EXISTS "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("city"))) STORED,
  ADD COLUMN IF NOT EXISTS "cnpjNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cnpj"))) STORED,
  ADD COLUMN IF NOT EXISTS "corporateNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("corporateName"))) STORED,
  ADD COLUMN IF NOT EXISTS "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cpf"))) STORED,
  ADD COLUMN IF NOT EXISTS "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("email"))) STORED,
  ADD COLUMN IF NOT EXISTS "fantasyNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("fantasyName"))) STORED,
  ADD COLUMN IF NOT EXISTS "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("neighborhood"))) STORED,
  ADD COLUMN IF NOT EXISTS "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("state"))) STORED;

ALTER TABLE "Dependent"
  ADD COLUMN IF NOT EXISTS "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cpf"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "EconomicActivity"
  ADD COLUMN IF NOT EXISTS "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("code"))) STORED,
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "EmploymentContract"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "providerNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("providerName"))) STORED;

ALTER TABLE "ExternalOperation"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "withdrawerNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("withdrawerName"))) STORED;

ALTER TABLE "ExternalOperationServiceItem"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "File"
  ADD COLUMN IF NOT EXISTS "filenameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("filename"))) STORED,
  ADD COLUMN IF NOT EXISTS "mimetypeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("mimetype"))) STORED,
  ADD COLUMN IF NOT EXISTS "originalNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("originalName"))) STORED;

ALTER TABLE "FiscalDocumentItem"
  ADD COLUMN IF NOT EXISTS "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("code"))) STORED,
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "FiscalDocumentOrderCode"
  ADD COLUMN IF NOT EXISTS "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("code"))) STORED;

ALTER TABLE "Fispq"
  ADD COLUMN IF NOT EXISTS "casNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("casNumber"))) STORED,
  ADD COLUMN IF NOT EXISTS "manufacturerNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("manufacturer"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "onuNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("onuNumber"))) STORED,
  ADD COLUMN IF NOT EXISTS "productNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("productName"))) STORED;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "Item"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "uniCodeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("uniCode"))) STORED;

ALTER TABLE "ItemBrand"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "ItemCategory"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Leave"
  ADD COLUMN IF NOT EXISTS "inssBenefitNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("inssBenefitNumber"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "Maintenance"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "MaintenanceSchedule"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "MedicalExam"
  ADD COLUMN IF NOT EXISTS "clinicNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("clinic"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "physicianNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("physicianName"))) STORED;

ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "bodyNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("body"))) STORED,
  ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

ALTER TABLE "NotificationConfiguration"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Observation"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "OrderInstallment"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "OrderSchedule"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Paint"
  ADD COLUMN IF NOT EXISTS "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("code"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "PaintBrand"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "PaintFormula"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "PaintType"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "PayrollDiscount"
  ADD COLUMN IF NOT EXISTS "lenderNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("lenderName"))) STORED,
  ADD COLUMN IF NOT EXISTS "referenceNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reference"))) STORED;

ALTER TABLE "PayrollMonthSettlement"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "Position"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Postit"
  ADD COLUMN IF NOT EXISTS "contentNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("content"))) STORED;

ALTER TABLE "PpeDelivery"
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "PpeDeliverySchedule"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Questionnaire"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "QuestionnaireEntry"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "QuestionnaireGroup"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "QuestionnaireOption"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "QuestionnaireQuestion"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

ALTER TABLE "ReconciliationMatch"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "RecurrentPayable"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Representative"
  ADD COLUMN IF NOT EXISTS "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("email"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "phoneNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("phone"))) STORED;

ALTER TABLE "SalaryAdjustment"
  ADD COLUMN IF NOT EXISTS "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("note"))) STORED;

ALTER TABLE "Sector"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "ServiceOrder"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "Skill"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "StatisticsPreset"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("address"))) STORED,
  ADD COLUMN IF NOT EXISTS "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("city"))) STORED,
  ADD COLUMN IF NOT EXISTS "cnpjNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cnpj"))) STORED,
  ADD COLUMN IF NOT EXISTS "corporateNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("corporateName"))) STORED,
  ADD COLUMN IF NOT EXISTS "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("email"))) STORED,
  ADD COLUMN IF NOT EXISTS "fantasyNameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("fantasyName"))) STORED,
  ADD COLUMN IF NOT EXISTS "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("neighborhood"))) STORED,
  ADD COLUMN IF NOT EXISTS "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("state"))) STORED;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "detailsNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("details"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "serialNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("serialNumber"))) STORED;

ALTER TABLE "TaskFieldChangeLog"
  ADD COLUMN IF NOT EXISTS "fieldNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("field"))) STORED;

ALTER TABLE "TaskForecastHistory"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED,
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "TaskQuoteService"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "TaxBracket"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "TaxTable"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "Termination"
  ADD COLUMN IF NOT EXISTS "justCauseArticleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("justCauseArticle"))) STORED,
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "TerminationDocument"
  ADD COLUMN IF NOT EXISTS "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("note"))) STORED;

ALTER TABLE "TerminationItem"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "Thirteenth"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "Topic"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "titleNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("title"))) STORED;

ALTER TABLE "TopicLevel"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "TransactionCategory"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "Truck"
  ADD COLUMN IF NOT EXISTS "chassisNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("chassisNumber"))) STORED,
  ADD COLUMN IF NOT EXISTS "plateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("plate"))) STORED;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "addressNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("address"))) STORED,
  ADD COLUMN IF NOT EXISTS "cityNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("city"))) STORED,
  ADD COLUMN IF NOT EXISTS "cpfNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("cpf"))) STORED,
  ADD COLUMN IF NOT EXISTS "emailNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("email"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "neighborhoodNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("neighborhood"))) STORED,
  ADD COLUMN IF NOT EXISTS "phoneNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("phone"))) STORED,
  ADD COLUMN IF NOT EXISTS "pisNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("pis"))) STORED,
  ADD COLUMN IF NOT EXISTS "stateNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("state"))) STORED;

ALTER TABLE "UserBenefit"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "UserPositionHistory"
  ADD COLUMN IF NOT EXISTS "noteNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("note"))) STORED;

ALTER TABLE "Vacation"
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "VacationGroup"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "notesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("notes"))) STORED;

ALTER TABLE "WarehouseLocation"
  ADD COLUMN IF NOT EXISTS "codeNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("code"))) STORED,
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED,
  ADD COLUMN IF NOT EXISTS "sectionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("section"))) STORED;

ALTER TABLE "Warning"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "hrNotesNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("hrNotes"))) STORED,
  ADD COLUMN IF NOT EXISTS "reasonNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("reason"))) STORED;

ALTER TABLE "WasteCertificate"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "WorkAccidentReport"
  ADD COLUMN IF NOT EXISTS "catNumberNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("catNumber"))) STORED,
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED;

ALTER TABLE "apps"
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

ALTER TABLE "deployments"
  ADD COLUMN IF NOT EXISTS "appIdNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("app_id"))) STORED,
  ADD COLUMN IF NOT EXISTS "gitCommitIdNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("git_commit_id"))) STORED,
  ADD COLUMN IF NOT EXISTS "versionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("version"))) STORED;

ALTER TABLE "repositories"
  ADD COLUMN IF NOT EXISTS "descriptionNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("description"))) STORED,
  ADD COLUMN IF NOT EXISTS "nameNormalized" text GENERATED ALWAYS AS (lower(immutable_unaccent("name"))) STORED;

-- Trigram indexes to keep substring search fast on the busiest tables.
CREATE INDEX IF NOT EXISTS "Item_nameNormalized_trgm_idx" ON "Item" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Item_uniCodeNormalized_trgm_idx" ON "Item" USING gin ("uniCodeNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ItemBrand_nameNormalized_trgm_idx" ON "ItemBrand" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ItemCategory_nameNormalized_trgm_idx" ON "ItemCategory" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Supplier_fantasyNameNormalized_trgm_idx" ON "Supplier" USING gin ("fantasyNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Supplier_corporateNameNormalized_trgm_idx" ON "Supplier" USING gin ("corporateNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_fantasyNameNormalized_trgm_idx" ON "Customer" USING gin ("fantasyNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_corporateNameNormalized_trgm_idx" ON "Customer" USING gin ("corporateNameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_nameNormalized_trgm_idx" ON "User" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_nameNormalized_trgm_idx" ON "Task" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_serialNumberNormalized_trgm_idx" ON "Task" USING gin ("serialNumberNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Paint_nameNormalized_trgm_idx" ON "Paint" USING gin ("nameNormalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "File_filenameNormalized_trgm_idx" ON "File" USING gin ("filenameNormalized" gin_trgm_ops);
