-- Employee Portal. Strictly additive: new enum values, nullable or defaulted columns, new tables.

ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_DEADLINE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENTITY_REGISTERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_PENDING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COMPLAINT_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MIS_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENDANCE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAVE_UPDATE';

ALTER TABLE "employees"
  ADD COLUMN "employmentType" VARCHAR(20),
  ADD COLUMN "branch" VARCHAR(80),
  ADD COLUMN "territory" VARCHAR(80);

ALTER TABLE "leads"
  ADD COLUMN "whatsapp" VARCHAR(15),
  ADD COLUMN "businessType" VARCHAR(40),
  ADD COLUMN "address" VARCHAR(300),
  ADD COLUMN "priority" VARCHAR(10) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "lostReason" VARCHAR(300),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "lead_activities" ADD COLUMN "durationSeconds" INTEGER;

ALTER TABLE "follow_ups"
  ADD COLUMN "followUpType" VARCHAR(15) NOT NULL DEFAULT 'PHONE_CALL',
  ADD COLUMN "callOutcome" VARCHAR(25);

ALTER TABLE "employee_tasks"
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "completionRemarks" VARCHAR(1000),
  ADD COLUMN "relatedCompanyId" UUID,
  ADD COLUMN "relatedTransporterId" UUID,
  ADD COLUMN "relatedBookingId" UUID,
  ADD COLUMN "reminderAt" TIMESTAMP(3);

CREATE TABLE "lead_documents" (
  "id" UUID NOT NULL, "leadId" UUID NOT NULL, "title" VARCHAR(120) NOT NULL, "fileName" VARCHAR(200) NOT NULL, "storageKey" VARCHAR(200) NOT NULL,
  "mimeType" VARCHAR(80) NOT NULL, "sizeBytes" INTEGER NOT NULL, "uploadedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_documents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lead_documents_storageKey_key" ON "lead_documents"("storageKey");
CREATE INDEX "lead_documents_leadId_idx" ON "lead_documents"("leadId");

CREATE TABLE "employee_task_activities" (
  "id" UUID NOT NULL, "taskId" UUID NOT NULL, "type" VARCHAR(15) NOT NULL, "message" VARCHAR(1000), "fromValue" VARCHAR(40), "toValue" VARCHAR(40),
  "fileName" VARCHAR(200), "storageKey" VARCHAR(200), "mimeType" VARCHAR(80), "actorId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_task_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_task_activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "employee_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_task_activities_storageKey_key" ON "employee_task_activities"("storageKey");
CREATE INDEX "employee_task_activities_taskId_createdAt_idx" ON "employee_task_activities"("taskId", "createdAt");

CREATE TABLE "employee_attendance" (
  "id" UUID NOT NULL, "employeeId" UUID NOT NULL, "date" DATE NOT NULL, "checkInAt" TIMESTAMP(3), "checkOutAt" TIMESTAMP(3), "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  "breakStartedAt" TIMESTAMP(3), "workingMinutes" INTEGER, "status" VARCHAR(15) NOT NULL DEFAULT 'PRESENT', "earlyDeparture" BOOLEAN NOT NULL DEFAULT false,
  "checkInLatitude" DECIMAL(9,6), "checkInLongitude" DECIMAL(9,6), "locationConsent" BOOLEAN NOT NULL DEFAULT false, "remarks" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_attendance_employeeId_date_key" ON "employee_attendance"("employeeId", "date");
CREATE INDEX "employee_attendance_date_status_idx" ON "employee_attendance"("date", "status");

CREATE TABLE "attendance_events" (
  "id" UUID NOT NULL, "attendanceId" UUID NOT NULL, "type" VARCHAR(12) NOT NULL, "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_events_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "employee_attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "attendance_events_attendanceId_at_idx" ON "attendance_events"("attendanceId", "at");

CREATE TABLE "leave_policies" (
  "code" VARCHAR(20) NOT NULL, "name" VARCHAR(60) NOT NULL, "daysPerYear" DECIMAL(5,1) NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "leave_balances" (
  "id" UUID NOT NULL, "employeeId" UUID NOT NULL, "leaveType" VARCHAR(20) NOT NULL, "year" INTEGER NOT NULL, "entitled" DECIMAL(5,1) NOT NULL, "used" DECIMAL(5,1) NOT NULL DEFAULT 0,
  CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "leave_balances_employeeId_leaveType_year_key" ON "leave_balances"("employeeId", "leaveType", "year");

CREATE TABLE "leave_applications" (
  "id" UUID NOT NULL, "employeeId" UUID NOT NULL, "leaveType" VARCHAR(20) NOT NULL, "startDate" DATE NOT NULL, "endDate" DATE NOT NULL, "days" DECIMAL(5,1) NOT NULL, "reason" VARCHAR(500) NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING', "fileName" VARCHAR(200), "storageKey" VARCHAR(200), "mimeType" VARCHAR(80), "decidedById" UUID, "decisionNote" VARCHAR(300), "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_applications_valid_range" CHECK ("endDate" >= "startDate"),
  CONSTRAINT "leave_applications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "leave_applications_storageKey_key" ON "leave_applications"("storageKey");
CREATE INDEX "leave_applications_employeeId_status_idx" ON "leave_applications"("employeeId", "status");
CREATE INDEX "leave_applications_status_startDate_idx" ON "leave_applications"("status", "startDate");

CREATE TABLE "daily_mis_reports" (
  "id" UUID NOT NULL, "employeeId" UUID NOT NULL, "date" DATE NOT NULL, "reportType" VARCHAR(15) NOT NULL, "data" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_mis_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_mis_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "daily_mis_reports_employeeId_date_key" ON "daily_mis_reports"("employeeId", "date");
CREATE INDEX "daily_mis_reports_date_idx" ON "daily_mis_reports"("date");

CREATE TABLE "mis_report_revisions" (
  "id" UUID NOT NULL, "reportId" UUID NOT NULL, "revision" INTEGER NOT NULL, "previous" JSONB NOT NULL, "reason" VARCHAR(300) NOT NULL, "editedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mis_report_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mis_report_revisions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "daily_mis_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mis_report_revisions_reportId_revision_idx" ON "mis_report_revisions"("reportId", "revision");
