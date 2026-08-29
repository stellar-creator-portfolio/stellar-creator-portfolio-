-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('filed', 'evidence', 'mediation', 'community_vote', 'resolved', 'appealed', 'closed');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('payment', 'delivery', 'quality', 'communication', 'other');

-- AlterTable: Extend Dispute
ALTER TABLE "Dispute" ADD COLUMN "category" "DisputeCategory" NOT NULL DEFAULT 'other';
ALTER TABLE "Dispute" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Dispute" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Dispute" ADD COLUMN "escrowAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Dispute" ADD COLUMN "preventionTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Dispute" ADD COLUMN "assignedAdminId" TEXT;
ALTER TABLE "Dispute" ADD COLUMN "filedByUserId" TEXT NOT NULL DEFAULT '';

-- AlterTable: Convert status column from String to enum
ALTER TABLE "Dispute" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Dispute" ALTER COLUMN "status" TYPE "DisputeStatus" USING (
  CASE "status"
    WHEN 'open' THEN 'filed'::"DisputeStatus"
    WHEN 'filed' THEN 'filed'::"DisputeStatus"
    WHEN 'evidence' THEN 'evidence'::"DisputeStatus"
    WHEN 'mediation' THEN 'mediation'::"DisputeStatus"
    WHEN 'community_vote' THEN 'community_vote'::"DisputeStatus"
    WHEN 'resolved' THEN 'resolved'::"DisputeStatus"
    WHEN 'appealed' THEN 'appealed'::"DisputeStatus"
    WHEN 'closed' THEN 'closed'::"DisputeStatus"
    ELSE 'filed'::"DisputeStatus"
  END
);
ALTER TABLE "Dispute" ALTER COLUMN "status" SET DEFAULT 'filed';

-- CreateIndex
CREATE INDEX "Dispute_filedByUserId_idx" ON "Dispute"("filedByUserId");
CREATE INDEX "Dispute_assignedAdminId_idx" ON "Dispute"("assignedAdminId");

-- CreateTable: DisputeEvidence
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DisputeTimelineEntry
CREATE TABLE "DisputeTimelineEntry" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeTimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DisputeCommunityVote
CREATE TABLE "DisputeCommunityVote" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeCommunityVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DisputeResolution
CREATE TABLE "DisputeResolution" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "templateId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DisputeAppeal
CREATE TABLE "DisputeAppeal" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "DisputeAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCommunityVote_disputeId_userId_key" ON "DisputeCommunityVote"("disputeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeResolution_disputeId_key" ON "DisputeResolution"("disputeId");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeAppeal_disputeId_key" ON "DisputeAppeal"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeTimelineEntry_disputeId_idx" ON "DisputeTimelineEntry"("disputeId");

-- CreateIndex
CREATE INDEX "DisputeCommunityVote_disputeId_idx" ON "DisputeCommunityVote"("disputeId");

-- AddForeignKey: Dispute -> User (filedBy)
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_filedByUserId_fkey" FOREIGN KEY ("filedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Dispute -> User (assignedAdmin)
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: DisputeEvidence -> Dispute
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeEvidence -> User
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeTimelineEntry -> Dispute
ALTER TABLE "DisputeTimelineEntry" ADD CONSTRAINT "DisputeTimelineEntry_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeCommunityVote -> Dispute
ALTER TABLE "DisputeCommunityVote" ADD CONSTRAINT "DisputeCommunityVote_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeCommunityVote -> User
ALTER TABLE "DisputeCommunityVote" ADD CONSTRAINT "DisputeCommunityVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeResolution -> Dispute
ALTER TABLE "DisputeResolution" ADD CONSTRAINT "DisputeResolution_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DisputeAppeal -> Dispute
ALTER TABLE "DisputeAppeal" ADD CONSTRAINT "DisputeAppeal_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
