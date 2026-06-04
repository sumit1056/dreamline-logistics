-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "vehicleNumber" TEXT;
