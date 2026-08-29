-- Create ErrorLog table for centralized client error reporting

CREATE TABLE IF NOT EXISTS "ErrorLog" (
  "id" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "level" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "context" JSONB NOT NULL,
  "url" TEXT,
  "userAgent" TEXT,
  "environment" TEXT NOT NULL,
  CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ErrorLog_timestamp_idx" ON "ErrorLog" ("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "ErrorLog_level_idx" ON "ErrorLog" ("level");
CREATE INDEX IF NOT EXISTS "ErrorLog_environment_idx" ON "ErrorLog" ("environment");

