-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "qr_base_url" TEXT;

-- CreateTable
CREATE TABLE "qr_code_batches" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_code_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "batch_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "destination_url" TEXT,
    "customer_id" UUID,
    "label" TEXT,
    "linked_at" TIMESTAMPTZ(3),
    "scan_count" INTEGER NOT NULL DEFAULT 0,
    "last_scanned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_code_batches_number_key" ON "qr_code_batches"("number");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_code_key" ON "qr_codes"("code");

-- CreateIndex
CREATE INDEX "qr_codes_customer_id_idx" ON "qr_codes"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_batch_id_position_key" ON "qr_codes"("batch_id", "position");

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "qr_code_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras de integridade que o Prisma não expressa no schema.
ALTER TABLE "qr_code_batches"
  ADD CONSTRAINT "qr_code_batches_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "qr_codes"
  ADD CONSTRAINT "qr_codes_code_format" CHECK ("code" ~ '^[0-9A-Z]{4,16}$'),
  ADD CONSTRAINT "qr_codes_position_positive" CHECK ("position" > 0),
  ADD CONSTRAINT "qr_codes_scan_count_non_negative" CHECK ("scan_count" >= 0),
  -- O redirecionamento público só pode levar a páginas web (nunca javascript:, data: etc.).
  ADD CONSTRAINT "qr_codes_destination_http" CHECK ("destination_url" IS NULL OR "destination_url" ~* '^https?://');
