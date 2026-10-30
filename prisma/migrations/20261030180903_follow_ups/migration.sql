-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('VISIT', 'CALL', 'WHATSAPP', 'PROPOSAL', 'AWAITING_REPLY', 'OTHER');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'DONE', 'RESCHEDULED', 'NO_CONTACT', 'NOT_INTERESTED', 'SOLD', 'CANCELLED');

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "customer_id" UUID,
    "business_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "has_time" BOOLEAN NOT NULL DEFAULT true,
    "type" "FollowUpType" NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "previous_id" UUID,
    "idempotency_key" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_events" (
    "id" UUID NOT NULL,
    "follow_up_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "FollowUpStatus",
    "to_status" "FollowUpStatus",
    "from_scheduled_at" TIMESTAMPTZ(3),
    "to_scheduled_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "changes" JSONB,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_idempotency_key_key" ON "follow_ups"("idempotency_key");

-- CreateIndex
CREATE INDEX "follow_ups_status_scheduled_at_idx" ON "follow_ups"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "follow_ups_scheduled_at_idx" ON "follow_ups"("scheduled_at");

-- CreateIndex
CREATE INDEX "follow_ups_customer_id_idx" ON "follow_ups"("customer_id");

-- CreateIndex
CREATE INDEX "follow_ups_previous_id_idx" ON "follow_ups"("previous_id");

-- CreateIndex
CREATE INDEX "follow_up_events_follow_up_id_created_at_idx" ON "follow_up_events"("follow_up_id", "created_at");

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_previous_id_fkey" FOREIGN KEY ("previous_id") REFERENCES "follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_events" ADD CONSTRAINT "follow_up_events_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras de integridade que o Prisma não expressa no schema.
-- Só o status SCHEDULED é pendente: os demais exigem data de conclusão, e um pendente não tem conclusão.
ALTER TABLE "follow_ups"
  ADD CONSTRAINT "follow_ups_completed_matches_status" CHECK (("status" = 'SCHEDULED') = ("completed_at" IS NULL)),
  ADD CONSTRAINT "follow_ups_business_name_not_blank" CHECK (btrim("business_name") <> ''),
  ADD CONSTRAINT "follow_ups_reason_not_blank" CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "follow_ups_not_own_previous" CHECK ("previous_id" IS NULL OR "previous_id" <> "id");

-- Retornos nunca são apagados (reagendar/cancelar preservam o registro) e o histórico é imutável.
CREATE TRIGGER "follow_ups_no_delete"
  BEFORE DELETE ON "follow_ups"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "follow_up_events_immutable"
  BEFORE UPDATE OR DELETE ON "follow_up_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
