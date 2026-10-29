-- CreateTable
CREATE TABLE "review_links" (
    "id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "review_url" TEXT NOT NULL,
    "place_id" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_links_review_url_key" ON "review_links"("review_url");

-- CreateIndex
CREATE INDEX "review_links_created_at_idx" ON "review_links"("created_at");

-- Regras de integridade que o Prisma não expressa no schema.
ALTER TABLE "review_links"
  ADD CONSTRAINT "review_links_review_url_https" CHECK ("review_url" ~ '^https://');
