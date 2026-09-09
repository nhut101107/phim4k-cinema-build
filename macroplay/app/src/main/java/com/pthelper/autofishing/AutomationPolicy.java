package com.pthelper.autofishing;

/* JADX INFO: loaded from: classes2.dex */
public final class AutomationPolicy {
    private AutomationPolicy() {
    }

    public static int clampInt(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    public static float clampRatio(float value) {
        if (!Float.isFinite(value)) return 0.5f;
        return Math.max(0.0f, Math.min(1.0f, value));
    }

    public static boolean shouldRepair(int caught, int repairEvery) {
        return caught > 0 && repairEvery > 0 && caught % repairEvery == 0;
    }

    /**
     * Keeps a missed repair pending. The old modulo-only check forgot the repair as soon as
     * one route attempt failed, so it would not try again until another full interval passed.
     */
    public static boolean repairDue(int caught, int repairEvery, int lastRepairedCaught) {
        if (caught <= 0 || repairEvery <= 0) return false;
        int safeLastRepair = lastRepairedCaught > caught ? 0 : Math.max(0, lastRepairedCaught);
        return (long) caught - safeLastRepair >= repairEvery;
    }

    public static boolean shouldCheckBag(int caught, int checkEvery) {
        return caught > 0 && checkEvery > 0 && caught % checkEvery == 0;
    }

    public static boolean mayRetry(int failures, int maximumRetries) {
        return failures < Math.max(1, maximumRetries);
    }

    public static boolean deadlineExpired(long startedAtMs, long timeoutMs, long nowMs) {
        return timeoutMs <= 0 || nowMs - startedAtMs >= timeoutMs;
    }

    /** True when the battery dropped under the configured floor. 0 disables the guard. */
    public static boolean batteryTooLow(int levelPercent, int stopBelowPercent) {
        return stopBelowPercent > 0 && levelPercent >= 0 && levelPercent < stopBelowPercent;
    }

    /**
     * True when nothing has been caught for longer than the allowed idle window, which
     * means the game is most likely stuck behind a dialog. 0 disables the watchdog.
     */
    public static boolean watchdogTripped(long lastProgressAtMs, int idleMinutes, long nowMs) {
        return idleMinutes > 0 && nowMs - lastProgressAtMs >= idleMinutes * 60_000L;
    }

    /**
     * Compares the fishing screen before leaving to sell against the screen after
     * travelling back. A small difference means the route landed on the same spot.
     */
    public static boolean arrivedAtSpot(double difference, double tolerance) {
        return difference >= 0 && difference <= tolerance;
    }

    /** The top-right HUD disappears as soon as the line is successfully cast. */
    public static boolean castStarted(double averageDifference, double changedPixelRatio) {
        return averageDifference >= 12.0d || changedPixelRatio >= 0.18d;
    }

    /** The cyan Bảo quản control must occupy a large new share of its button-sized region. */
    public static boolean storeButtonAppeared(double baselineCyan, double currentCyan) {
        return Double.isFinite(baselineCyan) && Double.isFinite(currentCyan)
            && currentCyan >= 0.20d
            && currentCyan - baselineCyan >= 0.10d;
    }

    /**
     * A full-bag badge must newly appear. A static red event badge that was already visible
     * before the catch is not evidence that the bag became full.
     */
    public static boolean bagAlertAppeared(double beforeAlertRatio, double afterAlertRatio) {
        return Double.isFinite(beforeAlertRatio) && Double.isFinite(afterAlertRatio)
            && afterAlertRatio >= 0.08d && afterAlertRatio - beforeAlertRatio >= 0.025d;
    }

    // --- Fish shadow tiers (bóng 1 → bóng 6, the sizes the community uses) ---

    public static final int SHADOW_TIERS = 6;
    public static final int ALL_SHADOW_TIERS = (1 << SHADOW_TIERS) - 1;

    /**
     * Upper bound of each tier's shadow length as a fraction of screen height, at 100 % scale.
     * Anything longer than the last edge is tier 6.
     */
    private static final double[] SHADOW_TIER_EDGES = {0.035, 0.055, 0.080, 0.115, 0.160};

    /** Filtering only does work when some tiers are chosen and some are excluded. */
    public static boolean shadowFilterActive(int tierMask) {
        int masked = tierMask & ALL_SHADOW_TIERS;
        return masked != 0 && masked != ALL_SHADOW_TIERS;
    }

    public static boolean tierAllowed(int tier, int tierMask) {
        if (tier < 1 || tier > SHADOW_TIERS) return true;
        return (tierMask & (1 << (tier - 1))) != 0;
    }

    public static int toggleTier(int tierMask, int tier) {
        if (tier < 1 || tier > SHADOW_TIERS) return tierMask;
        return (tierMask ^ (1 << (tier - 1))) & ALL_SHADOW_TIERS;
    }

    /**
     * Maps a shadow length (fraction of screen height) to a tier 1–6. {@code scalePercent}
     * stretches the tier edges so the user can nudge the mapping for their camera zoom.
     */
    public static int shadowTier(double lengthFraction, int scalePercent) {
        double scale = clampInt(scalePercent, 50, 200) / 100.0;
        int tier = 1;
        for (double edge : SHADOW_TIER_EDGES) {
            if (lengthFraction >= edge * scale) tier++;
        }
        return tier;
    }

    /** "4, 5, 6" for the UI, or "Không lọc" when the filter is inactive. */
    public static String describeTiers(int tierMask) {
        if (!shadowFilterActive(tierMask)) return "Không lọc";
        StringBuilder out = new StringBuilder();
        for (int tier = 1; tier <= SHADOW_TIERS; tier++) {
            if (tierAllowed(tier, tierMask)) {
                if (out.length() > 0) out.append(", ");
                out.append(tier);
            }
        }
        return out.toString();
    }

    // --- Selling by rarity ---

    public static final int SELL_ALL = 0;
    /** Keep purple-background rares (high-shadow fish and rare bugs). Gold is kept too. */
    public static final int SELL_KEEP_RARE = 1;
    /** Same keep rule as {@link #SELL_KEEP_RARE}; older installs used a stricter third option. */
    public static final int SELL_KEEP_EPIC = 2;

    /** Item grades as the game colour-codes its bag tiles. */
    public static final int RARITY_EMPTY = 0;
    public static final int RARITY_COMMON = 1;   // white
    public static final int RARITY_TRENDY = 2;   // green
    public static final int RARITY_LUXURY = 3;   // blue
    public static final int RARITY_VIP = 4;      // purple
    public static final int RARITY_VVIP = 5;     // gold

    /**
     * Classifies one pixel of a tile frame by hue. Unsaturated pixels are white/grey and read
     * as common when bright, or as an empty slot when dark.
     */
    public static int rarityOf(int red, int green, int blue) {
        int max = Math.max(red, Math.max(green, blue));
        int min = Math.min(red, Math.min(green, blue));
        int chroma = max - min;
        if (chroma < 40) {
            return max >= 150 ? RARITY_COMMON : RARITY_EMPTY;
        }
        double hue = hueOf(red, green, blue);
        if (hue >= 25 && hue < 65) return RARITY_VVIP;
        if (hue >= 75 && hue < 170) return RARITY_TRENDY;
        if (hue >= 190 && hue < 250) return RARITY_LUXURY;
        if (isPurplePixel(red, green, blue)) return RARITY_VIP;
        return RARITY_EMPTY;
    }

    /**
     * Play Together paints rare fish (high shadow) and rare bugs on a purple / magenta
     * card. Both red and blue beat green; hue sits from blue-violet through magenta.
     */
    public static boolean isPurplePixel(int red, int green, int blue) {
        int max = Math.max(red, Math.max(green, blue));
        int min = Math.min(red, Math.min(green, blue));
        if (max < 70 || max - min < 28) return false;
        // Green-dominant pixels are water, leaves, common-card tint — never the rare card.
        if (green + 18 >= red && green + 18 >= blue) return false;
        boolean magenta = red > green + 15 && blue > green + 15;
        if (magenta) return true;
        double hue = hueOf(red, green, blue);
        return hue >= 245 && hue < 340;
    }

    private static double hueOf(int red, int green, int blue) {
        int max = Math.max(red, Math.max(green, blue));
        int min = Math.min(red, Math.min(green, blue));
        int chroma = max - min;
        if (chroma <= 0) return 0;
        double hue;
        if (max == red) {
            hue = 60.0 * (((green - blue) / (double) chroma) % 6);
        } else if (max == green) {
            hue = 60.0 * (((blue - red) / (double) chroma) + 2);
        } else {
            hue = 60.0 * (((red - green) / (double) chroma) + 4);
        }
        return hue < 0 ? hue + 360 : hue;
    }

    public static boolean shouldSell(int rarity, int sellMode) {
        if (rarity == RARITY_EMPTY) return false;
        if (sellMode == SELL_KEEP_RARE || sellMode == SELL_KEEP_EPIC) {
            return rarity < RARITY_VIP;
        }
        return true;
    }

    /** True when the keep-purple rule is on (either labelled option). */
    public static boolean keepPurpleEnabled(int sellMode) {
        return sellMode == SELL_KEEP_RARE || sellMode == SELL_KEEP_EPIC;
    }

    public static String describeSellMode(int sellMode) {
        if (keepPurpleEnabled(sellMode)) {
            return "Bán thường, giữ nền tím (cá bóng cao / côn trùng hiếm)";
        }
        return "Bán hết";
    }

    public static String describeRarity(int rarity) {
        switch (rarity) {
            case RARITY_COMMON: return "thường (trắng)";
            case RARITY_TRENDY: return "xanh lá";
            case RARITY_LUXURY: return "hiếm (xanh dương)";
            case RARITY_VIP: return "tím";
            case RARITY_VVIP: return "vàng";
            default: return "trống";
        }
    }

    /**
     * Centre of tile {@code index} (row-major) in a grid spanned by the centres of the first
     * and last visible tiles. Returns {x, y} in the same units as the inputs.
     */
    public static float[] tileCenter(float firstX, float firstY, float lastX, float lastY,
                                     int columns, int rows, int index) {
        int cols = Math.max(1, columns);
        int rws = Math.max(1, rows);
        int col = index % cols;
        int row = Math.min(rws - 1, index / cols);
        float x = cols == 1 ? firstX : firstX + (lastX - firstX) * col / (cols - 1);
        float y = rws == 1 ? firstY : firstY + (lastY - firstY) * row / (rws - 1);
        return new float[]{x, y};
    }

    /** Catch rate for the stats panel; needs at least a minute of data to be meaningful. */
    public static int fishPerHour(int caught, long elapsedMs) {
        if (caught <= 0 || elapsedMs < 60_000L) {
            return 0;
        }
        return (int) Math.round(caught * 3_600_000.0 / elapsedMs);
    }
}
