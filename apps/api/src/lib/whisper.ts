import { prisma } from './database';
import { decodeToPcm16kMono } from './audio';
import { transcribe } from './stt';

// Transcription runs locally via transformers.js (see ./stt), so it is free.
// The cost/quota machinery below is retained as usage metrics but always
// resolves to $0 — it is vestigial and can be removed in a later cleanup.
const WHISPER_COST_PER_MINUTE = 0;
const MONTHLY_LIMIT_USD = parseFloat(process.env.WHISPER_MONTHLY_LIMIT || '10');
const MAX_FILE_SIZE_MB = 25; // Whisper API limit
const MAX_AUDIO_DURATION_SECONDS = 3600; // 1 hour

interface WhisperResult {
  text: string;
  durationSeconds: number;
  costEstimate: number;
}

interface QuotaStatus {
  isAllowed: boolean;
  reason?: string;
  currentMonthUsage: {
    minutesUsed: number;
    estimatedCost: number;
    remainingBudget: number;
  };
}

/**
 * Check if Whisper API usage is within quota
 */
export async function checkWhisperQuota(): Promise<QuotaStatus> {
  try {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get or create quota record for this month
    let quota = await prisma.whisperQuota.findUnique({
      where: { monthYear },
    });

    if (!quota) {
      quota = await prisma.whisperQuota.create({
        data: {
          monthYear,
          monthlyLimitUSD: MONTHLY_LIMIT_USD,
        },
      });
    }

    // Check if quota is exceeded
    if (quota.isLimited) {
      return {
        isAllowed: false,
        reason: `Monthly quota exceeded. Used $${quota.estimatedCost.toFixed(2)} of $${MONTHLY_LIMIT_USD}`,
        currentMonthUsage: {
          minutesUsed: quota.minutesUsed,
          estimatedCost: quota.estimatedCost,
          remainingBudget: Math.max(0, MONTHLY_LIMIT_USD - quota.estimatedCost),
        },
      };
    }

    const remainingBudget = MONTHLY_LIMIT_USD - quota.estimatedCost;

    return {
      isAllowed: remainingBudget > 0,
      reason: remainingBudget <= 0 ? 'Monthly quota exceeded' : undefined,
      currentMonthUsage: {
        minutesUsed: quota.minutesUsed,
        estimatedCost: quota.estimatedCost,
        remainingBudget: Math.max(0, remainingBudget),
      },
    };
  } catch (error) {
    console.error('Error checking Whisper quota:', error);
    throw new Error('Failed to check Whisper quota');
  }
}

/**
 * Transcribe audio using the local Whisper model (transformers.js).
 * @param audioBuffer - Audio file buffer (browser webm/opus, wav, …)
 * @param durationSeconds - Duration of audio in seconds (for usage metrics)
 * @returns Transcription result
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  durationSeconds: number
): Promise<WhisperResult> {
  try {
    // Validate file size
    const fileSizeMB = audioBuffer.length / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      throw new Error(
        `Audio file too large: ${fileSizeMB.toFixed(2)}MB (max: ${MAX_FILE_SIZE_MB}MB)`
      );
    }

    // Validate duration
    if (durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
      throw new Error(
        `Audio duration too long: ${durationSeconds}s (max: ${MAX_AUDIO_DURATION_SECONDS}s)`
      );
    }

    // Check quota before making API call
    const quotaStatus = await checkWhisperQuota();
    if (!quotaStatus.isAllowed) {
      throw new Error(
        `Cannot process audio: ${quotaStatus.reason}. Remaining budget: $${quotaStatus.currentMonthUsage.remainingBudget.toFixed(2)}`
      );
    }

    // Estimate cost before making call
    const costEstimate = (durationSeconds / 60) * WHISPER_COST_PER_MINUTE;

    // Check if cost would exceed monthly budget
    if (quotaStatus.currentMonthUsage.estimatedCost + costEstimate > MONTHLY_LIMIT_USD) {
      throw new Error(
        `This audio would exceed monthly budget. Cost: $${costEstimate.toFixed(2)}, Remaining: $${quotaStatus.currentMonthUsage.remainingBudget.toFixed(2)}`
      );
    }

    console.log(`📢 Transcribing audio locally: ${durationSeconds}s`);

    // Decode the browser's compressed audio to 16 kHz mono PCM, then run the
    // local Whisper model. No network call, no key, no per-request cost.
    const pcm = await decodeToPcm16kMono(audioBuffer);
    const text = await transcribe(pcm);
    const transcription = { text };

    // Update daily usage
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split('T')[0];

    let dailyUsage = await prisma.whisperUsage.findUnique({
      where: { date: today },
    });

    if (!dailyUsage) {
      dailyUsage = await prisma.whisperUsage.create({
        data: {
          date: today,
          minutesUsed: durationSeconds / 60,
          requestCount: 1,
          estimatedCost: costEstimate,
        },
      });
    } else {
      dailyUsage = await prisma.whisperUsage.update({
        where: { date: today },
        data: {
          minutesUsed: { increment: durationSeconds / 60 },
          requestCount: { increment: 1 },
          estimatedCost: { increment: costEstimate },
        },
      });
    }

    // Update monthly quota
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const updatedQuota = await prisma.whisperQuota.update({
      where: { monthYear },
      data: {
        minutesUsed: { increment: durationSeconds / 60 },
        requestCount: { increment: 1 },
        estimatedCost: { increment: costEstimate },
        isLimited: quotaStatus.currentMonthUsage.estimatedCost + costEstimate >= MONTHLY_LIMIT_USD,
      },
    });

    // Log the usage
    console.log(
      `✅ Transcription complete. Monthly cost so far: $${updatedQuota.estimatedCost.toFixed(2)}/$${MONTHLY_LIMIT_USD}`
    );

    return {
      text: transcription.text || '',
      durationSeconds,
      costEstimate,
    };
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw error;
  }
}

/**
 * Get current month's Whisper usage stats
 */
export async function getMonthlyUsageStats() {
  try {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const quota = await prisma.whisperQuota.findUnique({
      where: { monthYear },
    });

    if (!quota) {
      return {
        monthYear,
        minutesUsed: 0,
        estimatedCost: 0,
        requestCount: 0,
        monthlyLimitUSD: MONTHLY_LIMIT_USD,
        remainingBudget: MONTHLY_LIMIT_USD,
        isLimited: false,
      };
    }

    return {
      monthYear,
      minutesUsed: quota.minutesUsed,
      estimatedCost: quota.estimatedCost,
      requestCount: quota.requestCount,
      monthlyLimitUSD: MONTHLY_LIMIT_USD,
      remainingBudget: Math.max(0, MONTHLY_LIMIT_USD - quota.estimatedCost),
      isLimited: quota.isLimited,
    };
  } catch (error) {
    console.error('Error getting usage stats:', error);
    throw error;
  }
}

/**
 * Reset monthly quota (admin only - use with caution)
 */
export async function resetMonthlyQuota(monthYear?: string) {
  try {
    const targetMonth = monthYear || new Date().toISOString().slice(0, 7);

    await prisma.whisperQuota.update({
      where: { monthYear: targetMonth },
      data: {
        minutesUsed: 0,
        estimatedCost: 0,
        requestCount: 0,
        isLimited: false,
      },
    });

    console.log(`🔄 Reset quota for ${targetMonth}`);
  } catch (error) {
    console.error('Error resetting quota:', error);
    throw error;
  }
}
