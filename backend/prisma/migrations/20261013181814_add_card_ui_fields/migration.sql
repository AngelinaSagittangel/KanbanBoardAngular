-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "completed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT,
ADD COLUMN     "labelColor" TEXT;
