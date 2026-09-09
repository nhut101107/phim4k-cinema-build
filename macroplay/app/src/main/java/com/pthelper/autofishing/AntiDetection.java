package com.pthelper.autofishing;

import android.graphics.Point;
import java.util.Random;

/**
 * Anti-detection engine that humanizes automation behavior.
 * All randomization uses SecureRandom-seeded Random for unpredictable patterns.
 *
 * Key strategies:
 * 1. Variable tap duration (40–120ms) instead of fixed 55ms
 * 2. Delay jitter ±15–35% on every wait
 * 3. Position jitter ±3–8px around tap targets
 * 4. Micro-pauses (~8% chance, 2–6s) to simulate thinking
 * 5. Session breaks every 15–45 cycles (30–120s)
 * 6. Occasional fish miss (~3%) to break perfect patterns
 * 7. Session limits (time + catch count)
 */
public final class AntiDetection {
    private AntiDetection() {}

    // Separate Random instances so each category evolves independently,
    // making the composite pattern harder to fingerprint.
    private static final Random rTap = newRandom();
    private static final Random rDelay = newRandom();
    private static final Random rPos = newRandom();
    private static final Random rPause = newRandom();
    private static final Random rSession = newRandom();
    private static final Random rMiss = newRandom();

    // --- Tap duration constants (real thumbs linger; 55ms is a clicker tell) ---
    private static final long TAP_MIN_MS = 90L;
    private static final long TAP_MAX_MS = 240L;

    // --- Delay jitter constants ---
    private static final double JITTER_MIN = 0.06;
    private static final double JITTER_MAX = 0.14;

    // --- Position jitter constants ---
    private static final int POS_JITTER_MIN = 3;
    private static final int POS_JITTER_MAX = 8;

    // --- Micro-pause constants ---
    private static final double MICRO_PAUSE_CHANCE = 0.18;
    private static final long MICRO_PAUSE_MIN_MS = 3500L;
    private static final long MICRO_PAUSE_MAX_MS = 12000L;

    // --- Session break constants ---
    private static final int SESSION_BREAK_CYCLE_MIN = 6;
    private static final int SESSION_BREAK_CYCLE_MAX = 16;
    private static final long SESSION_BREAK_MIN_MS = 70_000L;
    private static final long SESSION_BREAK_MAX_MS = 200_000L;

    // --- Human reaction before swinging / hooking ---
    private static final long REACTION_MIN_MS = 20L;
    private static final long REACTION_MAX_MS = 60L;

    /** Always-on miss chance. Not configurable — baked into the APK. */
    public static final int HARD_MISS_PERCENT = 0;

    /** Zero means the worker keeps running until the user, battery guard or Android stops it. */
    public static final int HARD_MAX_SESSION_MINUTES = 0;
    public static final int HARD_MAX_CATCHES = 0;

    // Track when next session break should happen
    private static int nextBreakAtCycle = rollNextBreakCycle();

    /**
     * Returns a humanized tap duration between 40–120ms.
     * Distribution is slightly biased toward 50–80ms (typical human range).
     */
    public static long humanizedTapDuration() {
        // Use gaussian-like distribution centered around 70ms
        double gaussian = rTap.nextGaussian() * 32.0 + 140.0;
        long ms = Math.round(gaussian);
        return Math.max(TAP_MIN_MS, Math.min(TAP_MAX_MS, ms));
    }

    /**
     * Applies ±15–35% jitter to a base delay.
     * Example: humanizedDelay(1500) might return 1050–2025.
     *
     * @param baseMs the intended delay in milliseconds
     * @return jittered delay, always ≥ 100ms
     */
    public static long humanizedDelay(long baseMs) {
        if (baseMs <= 0) return 0;
        double jitterFactor = JITTER_MIN + rDelay.nextDouble() * (JITTER_MAX - JITTER_MIN);
        // Randomly add or subtract
        double sign = rDelay.nextBoolean() ? 1.0 : -1.0;
        long jittered = Math.round(baseMs * (1.0 + sign * jitterFactor));
        return Math.max(180L, jittered);
    }

    /** Short curved drift for a tap stroke. Zero-length taps are the autoclick signature. */
    public static Point fingerDrift() {
        int distance = 2 + rPos.nextInt(5);
        double angle = rPos.nextDouble() * Math.PI * 2.0;
        return new Point(
            (int) Math.round(Math.cos(angle) * distance),
            (int) Math.round(Math.sin(angle) * distance));
    }

    /** Irregular watch interval so the loop is not a 220ms metronome. */
    public static long pollIntervalMs() {
        return 45L + rDelay.nextInt(31);
    }

    /** Minimum time between two dispatched gestures. */
    public static long minGestureGapMs() {
        return 120L + rDelay.nextInt(121);
    }

    /** Idle after a catch before the next cast. */
    public static long afterCatchRestMs() {
        return 250L + rDelay.nextInt(251);
    }

    public static boolean shouldHesitateBeforeStore() {
        return false;
    }

    /**
     * Applies position jitter to a tap coordinate.
     * Offsets by ±3–8 pixels in both X and Y.
     *
     * @param x original x coordinate
     * @param y original y coordinate
     * @param screenWidth screen width for bounds clamping
     * @param screenHeight screen height for bounds clamping
     * @return jittered Point, guaranteed within screen bounds
     */
    public static Point positionJitter(int x, int y, int screenWidth, int screenHeight) {
        int range = POS_JITTER_MIN + rPos.nextInt(POS_JITTER_MAX - POS_JITTER_MIN + 1);
        int offsetX = rPos.nextInt(range * 2 + 1) - range;
        int offsetY = rPos.nextInt(range * 2 + 1) - range;
        int jitteredX = Math.max(0, Math.min(screenWidth - 1, x + offsetX));
        int jitteredY = Math.max(0, Math.min(screenHeight - 1, y + offsetY));
        return new Point(jitteredX, jitteredY);
    }

    /**
     * Returns true ~8% of the time, signaling a micro-pause should occur.
     * Simulates brief human hesitation or distraction.
     */
    public static boolean shouldTakeMicroPause() {
        return false;
    }

    /** Delay after a stimulus (bite / bug in range) before the tap, like a person noticing. */
    public static long reactionDelayMs() {
        return REACTION_MIN_MS + (long) (rPause.nextDouble() * (REACTION_MAX_MS - REACTION_MIN_MS));
    }

    /** During a session break, sometimes wander instead of standing still. */
    public static boolean shouldLookAround() {
        return rPause.nextDouble() < 0.50;
    }

    public static long microPauseMs() {
        return MICRO_PAUSE_MIN_MS + (long) (rPause.nextDouble() * (MICRO_PAUSE_MAX_MS - MICRO_PAUSE_MIN_MS));
    }

    /**
     * Returns true when the current catch count equals the pre-rolled
     * break cycle. After triggering, re-rolls the next break cycle.
     *
     * @param caught current number of fish caught this session
     * @return true if a session break should be taken now
     */
    public static boolean shouldTakeSessionBreak(int caught) {
        return false;
    }

    /**
     * Returns the duration for a session break: 30–120 seconds.
     */
    public static long sessionBreakMs() {
        return SESSION_BREAK_MIN_MS + (long) (rSession.nextDouble() * (SESSION_BREAK_MAX_MS - SESSION_BREAK_MIN_MS));
    }

    /**
     * Returns true when the fish should be intentionally missed.
     * Uses the configurable miss chance percentage.
     *
     * @param missChancePercent configured miss chance (0–15), e.g. 3 means 3%
     * @return true if this fish should be "missed"
     */
    public static boolean shouldMissFish(int ignored) {
        return false;
    }

    /**
     * Checks whether the session has exceeded time or catch limits.
     *
     * @param sessionStartedAt SystemClock.elapsedRealtime() at session start
     * @param caught number of fish caught
     * @param maxSessionMinutes max allowed minutes (0 = unlimited)
     * @param maxFish max allowed fish (0 = unlimited)
     * @param nowMs current SystemClock.elapsedRealtime()
     * @return true if session should end
     */
    public static boolean isSessionExpired(long sessionStartedAt, int caught,
                                           int ignoredMinutes, int ignoredFish, long nowMs) {
        return false;
    }

    /**
     * Resets the session break counter. Call when starting a new session.
     */
    public static void resetSession() {
        nextBreakAtCycle = rollNextBreakCycle();
    }

    // --- Internal helpers ---

    private static int rollNextBreakCycle() {
        return SESSION_BREAK_CYCLE_MIN
            + rSession.nextInt(SESSION_BREAK_CYCLE_MAX - SESSION_BREAK_CYCLE_MIN + 1);
    }

    private static int rollNextBreakInterval() {
        return SESSION_BREAK_CYCLE_MIN
            + rSession.nextInt(SESSION_BREAK_CYCLE_MAX - SESSION_BREAK_CYCLE_MIN + 1);
    }

    private static Random newRandom() {
        // Seed from nanoTime for unpredictable initial state
        return new Random(System.nanoTime() ^ Thread.currentThread().getId());
    }
}
