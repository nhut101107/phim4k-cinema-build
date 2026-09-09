package com.pthelper.autofishing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public final class AutomationPolicyTest {
    private static final long MINUTE = 60_000L;

    @Test public void bagIsCheckedAtEveryConfiguredInterval() {
        assertTrue(AutomationPolicy.shouldCheckBag(1, 1));
        assertTrue(AutomationPolicy.shouldCheckBag(7, 1));
    }

    @Test public void retriesAreBounded() {
        assertTrue(AutomationPolicy.mayRetry(2, 3));
        assertFalse(AutomationPolicy.mayRetry(3, 3));
    }

    @Test public void failedRepairStaysDueUntilOneIsConfirmed() {
        assertFalse(AutomationPolicy.repairDue(29, 30, 0));
        assertTrue(AutomationPolicy.repairDue(30, 30, 0));
        assertTrue(AutomationPolicy.repairDue(31, 30, 0));
        assertTrue(AutomationPolicy.repairDue(59, 30, 0));
        assertFalse(AutomationPolicy.repairDue(59, 30, 30));
        assertTrue(AutomationPolicy.repairDue(60, 30, 30));
    }

    @Test public void corruptFutureRepairCountCannotSuppressRepairForever() {
        assertTrue(AutomationPolicy.repairDue(30, 30, 9999));
        assertFalse(AutomationPolicy.repairDue(1, 30, -9));
    }

    @Test public void stateDeadlineExpires() {
        assertFalse(AutomationPolicy.deadlineExpired(1000, 500, 1499));
        assertTrue(AutomationPolicy.deadlineExpired(1000, 500, 1500));
    }

    @Test public void batteryGuardStopsOnlyUnderTheFloor() {
        assertTrue(AutomationPolicy.batteryTooLow(14, 15));
        assertFalse(AutomationPolicy.batteryTooLow(15, 15));
        assertFalse(AutomationPolicy.batteryTooLow(90, 15));
    }

    @Test public void batteryGuardIsDisabledAtZeroOrUnknownLevel() {
        assertFalse(AutomationPolicy.batteryTooLow(3, 0));
        assertFalse(AutomationPolicy.batteryTooLow(-1, 15));
    }

    @Test public void watchdogTripsAfterTheIdleWindow() {
        assertFalse(AutomationPolicy.watchdogTripped(0, 10, 10 * MINUTE - 1));
        assertTrue(AutomationPolicy.watchdogTripped(0, 10, 10 * MINUTE));
    }

    @Test public void watchdogIsDisabledAtZeroMinutes() {
        assertFalse(AutomationPolicy.watchdogTripped(0, 0, 999 * MINUTE));
    }

    @Test public void spotArrivalAcceptsSmallDifferencesOnly() {
        assertTrue(AutomationPolicy.arrivedAtSpot(0, 45));
        assertTrue(AutomationPolicy.arrivedAtSpot(45, 45));
        assertFalse(AutomationPolicy.arrivedAtSpot(45.1, 45));
    }

    @Test public void shadowTiersGrowWithLength() {
        assertEquals(1, AutomationPolicy.shadowTier(0.01, 100));
        assertEquals(2, AutomationPolicy.shadowTier(0.04, 100));
        assertEquals(3, AutomationPolicy.shadowTier(0.06, 100));
        assertEquals(4, AutomationPolicy.shadowTier(0.09, 100));
        assertEquals(5, AutomationPolicy.shadowTier(0.13, 100));
        assertEquals(6, AutomationPolicy.shadowTier(0.20, 100));
    }

    @Test public void shadowScaleShiftsTierEdges() {
        // Same shadow reads a tier higher when the edges are shrunk to 50 %.
        assertEquals(4, AutomationPolicy.shadowTier(0.09, 100));
        assertEquals(6, AutomationPolicy.shadowTier(0.09, 50));
        assertEquals(3, AutomationPolicy.shadowTier(0.09, 150));
    }

    @Test public void tierMaskSelectsWhichShadowsToHook() {
        int mask = AutomationPolicy.toggleTier(0, 4);
        mask = AutomationPolicy.toggleTier(mask, 5);
        mask = AutomationPolicy.toggleTier(mask, 6);
        assertTrue(AutomationPolicy.shadowFilterActive(mask));
        assertTrue(AutomationPolicy.tierAllowed(5, mask));
        assertFalse(AutomationPolicy.tierAllowed(3, mask));
        assertEquals("4, 5, 6", AutomationPolicy.describeTiers(mask));
        // Toggling 4 off again removes it.
        assertFalse(AutomationPolicy.tierAllowed(4, AutomationPolicy.toggleTier(mask, 4)));
    }

    @Test public void rarityFromHueAndSaturation() {
        assertEquals(AutomationPolicy.RARITY_COMMON, AutomationPolicy.rarityOf(230, 230, 230));
        assertEquals(AutomationPolicy.RARITY_EMPTY, AutomationPolicy.rarityOf(30, 30, 30));
        assertEquals(AutomationPolicy.RARITY_TRENDY, AutomationPolicy.rarityOf(40, 200, 70));
        assertEquals(AutomationPolicy.RARITY_LUXURY, AutomationPolicy.rarityOf(50, 90, 220));
        assertEquals(AutomationPolicy.RARITY_VIP, AutomationPolicy.rarityOf(180, 50, 220));
        assertEquals(AutomationPolicy.RARITY_VIP, AutomationPolicy.rarityOf(200, 70, 180));
        assertEquals(AutomationPolicy.RARITY_VVIP, AutomationPolicy.rarityOf(230, 190, 40));
        assertTrue(AutomationPolicy.isPurplePixel(180, 50, 220));
        assertTrue(AutomationPolicy.isPurplePixel(200, 70, 180));
        assertFalse(AutomationPolicy.isPurplePixel(230, 230, 230));
        assertFalse(AutomationPolicy.isPurplePixel(40, 200, 70));
    }

    @Test public void sellModeKeepsPurpleRares() {
        assertTrue(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_COMMON, AutomationPolicy.SELL_KEEP_RARE));
        assertTrue(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_TRENDY, AutomationPolicy.SELL_KEEP_RARE));
        assertTrue(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_LUXURY, AutomationPolicy.SELL_KEEP_RARE));
        assertFalse(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_VIP, AutomationPolicy.SELL_KEEP_RARE));
        assertFalse(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_VVIP, AutomationPolicy.SELL_KEEP_RARE));
        assertFalse(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_VIP, AutomationPolicy.SELL_KEEP_EPIC));
        assertFalse(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_EMPTY, AutomationPolicy.SELL_ALL));
        assertTrue(AutomationPolicy.shouldSell(AutomationPolicy.RARITY_VVIP, AutomationPolicy.SELL_ALL));
        assertTrue(AutomationPolicy.keepPurpleEnabled(AutomationPolicy.SELL_KEEP_RARE));
        assertFalse(AutomationPolicy.keepPurpleEnabled(AutomationPolicy.SELL_ALL));
    }

    @Test public void tileCentreInterpolatesGrid() {
        float[] first = AutomationPolicy.tileCenter(0.3f, 0.4f, 0.7f, 0.8f, 5, 3, 0);
        float[] last = AutomationPolicy.tileCenter(0.3f, 0.4f, 0.7f, 0.8f, 5, 3, 14);
        float[] mid = AutomationPolicy.tileCenter(0.3f, 0.4f, 0.7f, 0.8f, 5, 3, 7);
        assertEquals(0.3, first[0], 0.001);
        assertEquals(0.4, first[1], 0.001);
        assertEquals(0.7, last[0], 0.001);
        assertEquals(0.8, last[1], 0.001);
        assertEquals(0.5, mid[0], 0.001);
        assertEquals(0.6, mid[1], 0.001);
    }

    @Test public void filterIsInactiveWhenNothingOrEverythingIsChosen() {
        assertFalse(AutomationPolicy.shadowFilterActive(0));
        assertFalse(AutomationPolicy.shadowFilterActive(AutomationPolicy.ALL_SHADOW_TIERS));
        assertEquals("Không lọc", AutomationPolicy.describeTiers(0));
        assertTrue(AutomationPolicy.tierAllowed(1, AutomationPolicy.ALL_SHADOW_TIERS));
    }

    @Test public void catchRateNeedsAtLeastAMinuteOfData() {
        assertEquals(0, AutomationPolicy.fishPerHour(5, MINUTE - 1));
        assertEquals(0, AutomationPolicy.fishPerHour(0, 60 * MINUTE));
        assertEquals(300, AutomationPolicy.fishPerHour(5, MINUTE));
        assertEquals(120, AutomationPolicy.fishPerHour(120, 60 * MINUTE));
    }

    @Test public void fishBitesAreNeverIntentionallyMissed() {
        assertEquals(0, AntiDetection.HARD_MISS_PERCENT);
        for (int attempt = 0; attempt < 1000; attempt++) {
            assertFalse(AntiDetection.shouldMissFish(100));
        }
    }

    @Test public void bitePollingAndReactionStayInsideHookWindow() {
        for (int attempt = 0; attempt < 1000; attempt++) {
            long poll = AntiDetection.pollIntervalMs();
            long reaction = AntiDetection.reactionDelayMs();
            assertTrue(poll >= 45L && poll <= 75L);
            assertTrue(reaction >= 20L && reaction <= 60L);
            assertTrue(poll + reaction <= 135L);
        }
    }

    @Test public void castConfirmationAcceptsHudChangeOnly() {
        assertTrue(AutomationPolicy.castStarted(12.0d, 0.0d));
        assertTrue(AutomationPolicy.castStarted(0.0d, 0.18d));
        assertFalse(AutomationPolicy.castStarted(11.99d, 0.179d));
    }

    @Test public void storeButtonNeedsANewLargeCyanRegion() {
        assertTrue(AutomationPolicy.storeButtonAppeared(0.08d, 0.24d));
        assertFalse(AutomationPolicy.storeButtonAppeared(0.08d, 0.17d));
        assertFalse(AutomationPolicy.storeButtonAppeared(0.18d, 0.24d));
        assertFalse(AutomationPolicy.storeButtonAppeared(Double.NaN, 0.40d));

        int[] button = {0x0028c8f0, 0x0030b9e8, 0x00105080, 0x00ffffff};
        assertEquals(0.50d, ScreenAnalyzer.cyanControlRatio(button), 0.0001d);
    }

    @Test public void legacyStoreTapMigratesToMeasuredButtonCentre() {
        assertTrue(ConfigStore.isLegacyStorePoint(0.756f, 0.858f));
        assertFalse(ConfigStore.isLegacyStorePoint(0.790f, 0.810f));
        assertEquals(0.790d, ConfigStore.STORE.defaultX, 0.001d);
        assertEquals(0.810d, ConfigStore.STORE.defaultY, 0.001d);
    }

    @Test public void staticRedEventBadgeCannotTriggerBagRoute() {
        assertFalse(AutomationPolicy.bagAlertAppeared(0.12d, 0.12d));
        assertFalse(AutomationPolicy.bagAlertAppeared(0.12d, 0.14d));
        assertFalse(AutomationPolicy.bagAlertAppeared(Double.NaN, 0.20d));
        assertTrue(AutomationPolicy.bagAlertAppeared(0.03d, 0.08d));
        assertTrue(AutomationPolicy.bagAlertAppeared(0.10d, 0.14d));
    }

    @Test public void compactBiteIconIsNotDilutedByUnchangedBackground() {
        int[] baseline = new int[100];
        int[] current = new int[100];
        for (int index = 0; index < 6; index++) {
            current[index] = 0x00ffffff;
        }
        assertEquals(0.06d, ScreenAnalyzer.changedPixelRatio(baseline, current, 27), 0.0001d);
        assertEquals(0.0d, ScreenAnalyzer.changedPixelRatio(baseline, current, 256), 0.0001d);
    }

    @Test public void biteIndicatorDefaultsToCueSeenInClip8102() {
        assertEquals(0.47d, ConfigStore.BITE_REGION.defaultX, 0.001d);
        assertEquals(0.38d, ConfigStore.BITE_REGION.defaultY, 0.001d);
        assertTrue(ConfigStore.isLegacyBiteRegion(0.902f, 0.735f));
        assertTrue(ConfigStore.isLegacyBiteRegion(0.847f, 0.605f));
        assertTrue(ConfigStore.isPreviousNarrowBiteRegion(0.44f, 0.39f));
        assertFalse(ConfigStore.isPreviousNarrowBiteRegion(0.50f, 0.38f));
        assertFalse(ConfigStore.isLegacyBiteRegion(0.50f, 0.38f));
    }

    @Test public void whiteBiteCueIsDetectedByColorShare() {
        int[] pixels = {0x00ffffff, 0x00eeeeee, 0x00c8d0c9, 0x000000ff};
        assertEquals(0.75d, ScreenAnalyzer.whitePixelRatio(pixels), 0.0001d);
        assertEquals(0.0d, ScreenAnalyzer.whitePixelRatio(new int[]{0x000000ff}), 0.0001d);
    }

    @Test public void verticalExclamationIsDetectedButScatteredThoughtDotsAreIgnored() {
        int[] baseline = new int[25];
        int[] exclamation = new int[25];
        exclamation[2] = 0x00ffffff;
        exclamation[7] = 0x00ffffff;
        exclamation[12] = 0x00ffffff;
        assertTrue(ScreenAnalyzer.verticalWhiteCueAppeared(baseline, exclamation, 5));

        int[] thoughtDots = new int[25];
        thoughtDots[1] = 0x00ffffff;
        thoughtDots[7] = 0x00ffffff;
        thoughtDots[13] = 0x00ffffff;
        assertFalse(ScreenAnalyzer.verticalWhiteCueAppeared(baseline, thoughtDots, 5));
    }

    @Test public void glowingJoinedBiteMarkStillTriggersTheTwoStageDetector() {
        int columns = 15;
        int[] baseline = new int[columns * 15];
        int[] glowingCue = new int[baseline.length];
        // The glow joins the stem to the dot, so this is one component instead of the two
        // components required by the strict geometry detector.
        for (int row = 2; row <= 11; row++) {
            glowingCue[row * columns + 7] = 0x00ffffff;
            if (row >= 9) glowingCue[row * columns + 8] = 0x00eeeeee;
        }
        assertTrue(ScreenAnalyzer.biteCueAppeared(baseline, glowingCue, columns));
    }

    @Test public void hookTapMigratesFromEdgeToMeasuredButtonCentre() {
        assertTrue(ConfigStore.isLegacyHookPoint(0.902f, 0.735f));
        assertFalse(ConfigStore.isLegacyHookPoint(0.921f, 0.772f));
        assertEquals(0.921d, ConfigStore.HOOK.defaultX, 0.001d);
        assertEquals(0.772d, ConfigStore.HOOK.defaultY, 0.001d);
    }

    @Test public void exclamationImageRequiresAStemAndSeparateAlignedDot() {
        int columns = 15;
        int[] baseline = new int[columns * 15];
        int[] exclamation = new int[baseline.length];
        for (int row = 3; row <= 7; row++) exclamation[row * columns + 7] = 0x00ffffff;
        exclamation[10 * columns + 7] = 0x00ffffff;
        assertTrue(ScreenAnalyzer.exclamationShapeAppeared(baseline, exclamation, columns));

        int[] lineOnly = exclamation.clone();
        lineOnly[10 * columns + 7] = 0;
        assertFalse(ScreenAnalyzer.exclamationShapeAppeared(baseline, lineOnly, columns));

        int[] unrelatedDot = exclamation.clone();
        unrelatedDot[10 * columns + 7] = 0;
        unrelatedDot[10 * columns + 12] = 0x00ffffff;
        assertFalse(ScreenAnalyzer.exclamationShapeAppeared(baseline, unrelatedDot, columns));
    }

    @Test public void staticWhiteHudIsRemovedByTheCastBaseline() {
        int columns = 15;
        int[] baseline = new int[columns * 15];
        for (int row = 3; row <= 7; row++) baseline[row * columns + 7] = 0x00ffffff;
        baseline[10 * columns + 7] = 0x00ffffff;
        assertFalse(ScreenAnalyzer.exclamationShapeAppeared(baseline, baseline.clone(), columns));
    }

    @Test public void tallDenseStemTriggersOneFrameBeforeDot() {
        int columns = 21;
        int[] baseline = new int[columns * 21];
        int[] earlyCue = new int[baseline.length];
        for (int row = 4; row <= 13; row++) {
            earlyCue[row * columns + 10] = 0x00ffffff;
            earlyCue[row * columns + 11] = 0x00ffffff;
        }
        assertTrue(ScreenAnalyzer.exclamationShapeAppeared(baseline, earlyCue, columns));

        int[] shortTextStroke = new int[baseline.length];
        for (int row = 7; row <= 12; row++) shortTextStroke[row * columns + 10] = 0x00ffffff;
        assertFalse(ScreenAnalyzer.exclamationShapeAppeared(baseline, shortTextStroke, columns));
    }

    @Test public void scaledExclamationStillMatchesButQuestionMarkDoesNot() {
        int columns = 25;
        int[] baseline = new int[columns * 25];
        int[] scaledCue = new int[baseline.length];
        for (int row = 3; row <= 15; row++) {
            for (int col = 10; col <= 12; col++) scaledCue[row * columns + col] = 0x00ffffff;
        }
        for (int row = 21; row <= 22; row++) {
            for (int col = 10; col <= 12; col++) scaledCue[row * columns + col] = 0x00ffffff;
        }
        assertTrue(ScreenAnalyzer.exclamationShapeAppeared(baseline, scaledCue, columns));

        int[] questionMark = new int[baseline.length];
        for (int col = 8; col <= 14; col++) questionMark[3 * columns + col] = 0x00ffffff;
        for (int row = 4; row <= 10; row++) questionMark[row * columns + 14] = 0x00ffffff;
        questionMark[15 * columns + 14] = 0x00ffffff;
        assertFalse(ScreenAnalyzer.exclamationShapeAppeared(baseline, questionMark, columns));
    }

    @Test public void legacyZeroedTapCoordinatesAreResetOnUpgrade() {
        assertTrue(ConfigStore.isLegacyZeroedCoordinate(0.0f, 0.0f));
        assertTrue(ConfigStore.isLegacyZeroedCoordinate(0.01f, 0.02f));
        assertFalse(ConfigStore.isLegacyZeroedCoordinate(0.756f, 0.858f));
    }

    @Test public void unattendedSessionDoesNotPauseOrExpireByItself() {
        assertEquals(0, AntiDetection.HARD_MAX_SESSION_MINUTES);
        assertEquals(0, AntiDetection.HARD_MAX_CATCHES);
        assertFalse(AntiDetection.shouldTakeMicroPause());
        assertFalse(AntiDetection.shouldTakeSessionBreak(1000));
        assertFalse(AntiDetection.isSessionExpired(0L, 1000, 1, 1, Long.MAX_VALUE));
    }

    @Test public void profileCornerCanNeverBeUsedAsMapCoordinate() {
        assertFalse(ConfigStore.safeNavigationCoordinate(0.09f, 0.165f));
        assertFalse(ConfigStore.safeNavigationCoordinate(0.20f, 0.20f));
        assertFalse(ConfigStore.safeNavigationCoordinate(Float.NaN, 0.20f));
        assertFalse(ConfigStore.safeNavigationCoordinate(0.94f, Float.POSITIVE_INFINITY));
        assertTrue(ConfigStore.safeNavigationCoordinate(0.94f, 0.30f));
        assertTrue(ConfigStore.safeNavigationCoordinate(0.50f, 0.50f));
    }

    @Test public void corruptCoordinateNeverCollapsesToTopLeft() {
        assertEquals(0.5d, AutomationPolicy.clampRatio(Float.NaN), 0.001d);
        assertEquals(0.5d, AutomationPolicy.clampRatio(Float.NEGATIVE_INFINITY), 0.001d);
        assertEquals(0.0d, AutomationPolicy.clampRatio(-1.0f), 0.001d);
        assertEquals(1.0d, AutomationPolicy.clampRatio(2.0f), 0.001d);
    }
}
