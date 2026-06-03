-- CreateTable
CREATE TABLE "Payout" (
    "id" SERIAL NOT NULL,
    "weekIdentifier" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "completedOrders" INTEGER NOT NULL DEFAULT 0,
    "calculatedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payout_weekIdentifier_category_key" ON "Payout"("weekIdentifier", "category");
