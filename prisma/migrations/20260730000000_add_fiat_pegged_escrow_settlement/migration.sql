ALTER TABLE "Escrow"
  ADD COLUMN IF NOT EXISTS "bountyId" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentIntentId" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "failureMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "freelancerUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "usdAmountCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "lockedPriceMicroUsd" INTEGER,
  ADD COLUMN IF NOT EXISTS "usedFallbackPrice" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "settlementTxHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "settlementRecoveryNote" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Escrow_paymentIntentId_key"
  ON "Escrow"("paymentIntentId");

CREATE INDEX IF NOT EXISTS "Escrow_bountyId_idx"
  ON "Escrow"("bountyId");

CREATE INDEX IF NOT EXISTS "Escrow_paymentIntentId_idx"
  ON "Escrow"("paymentIntentId");

ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_bountyId_fkey"
  FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
