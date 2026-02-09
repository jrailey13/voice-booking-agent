-- CreateTable
CREATE TABLE "voice_calls" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "transcript" TEXT NOT NULL DEFAULT '',
    "audioUrl" TEXT,
    "costEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "whisperTokens" INTEGER NOT NULL DEFAULT 0,
    "ttsTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whisper_usage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutesUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whisper_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whisper_quota" (
    "id" TEXT NOT NULL,
    "monthYear" TEXT NOT NULL,
    "monthlyLimitUSD" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "minutesUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "isLimited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whisper_quota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_calls_callId_key" ON "voice_calls"("callId");

-- CreateIndex
CREATE INDEX "voice_calls_status_idx" ON "voice_calls"("status");

-- CreateIndex
CREATE INDEX "voice_calls_createdAt_idx" ON "voice_calls"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "whisper_usage_date_key" ON "whisper_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "whisper_quota_monthYear_key" ON "whisper_quota"("monthYear");
