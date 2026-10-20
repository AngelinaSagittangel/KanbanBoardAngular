-- CreateEnum
CREATE TYPE "CardActivityType" AS ENUM ('CARD_CREATED', 'CARD_DELETED', 'CARD_UPDATED', 'CARD_MOVED', 'CARD_COMPLETED', 'CARD_ASSIGNED', 'CARD_UNASSIGNED', 'CHECKLIST_UPDATED', 'COMMENT_ADDED', 'COMMENT_UPDATED', 'COMMENT_DELETED');

-- CreateTable
CREATE TABLE "CardActivity" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "cardId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "type" "CardActivityType" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardActivity_cardId_createdAt_idx" ON "CardActivity"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "CardActivity_boardId_createdAt_idx" ON "CardActivity"("boardId", "createdAt");

-- AddForeignKey
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
