package com.pthelper.autofishing;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Point;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/* JADX INFO: loaded from: classes2.dex */
public final class ConfigStore {
    private static final String PREFIX_X = "point_x_";
    private static final String PREFIX_Y = "point_y_";
    private static final String KEY_GAME_VARIANT = "game_variant";
    private static final int LOG_LIMIT_CHARS = 6000;
    public static final String PREFS = "pt_auto_fishing_v3";
    private final SharedPreferences preferences;
    private String lastLoggedEntry;
    public static final PointSpec ACTION = new PointSpec("action", "Nút thả câu (phao)", 0.847f, 0.605f);
    // Centre measured from the active reel control in IMG_8102. The previous point landed
    // near its upper-left edge and could miss on devices with a smaller touch target.
    public static final PointSpec HOOK = new PointSpec("hook", "Nút giật cần (nút tròn to)", 0.921f, 0.772f);
    public static final PointSpec STORE = new PointSpec("store", "Nút Bảo quản", 0.790f, 0.810f);
    // IMG_8102 confirms that the bite cue is the white '!' above the centred avatar,
    // not a visual change on the hook button at the lower-right.
    public static final PointSpec BITE_REGION = new PointSpec("bite_region", "Dấu ! báo cá cắn phía trên nhân vật", 0.47f, 0.38f);
    public static final PointSpec SHADOW_REGION = new PointSpec("shadow_region", "Tâm mặt nước quanh phao (để đo bóng cá)", 0.5f, 0.45f);
    public static final PointSpec BAG_FULL = new PointSpec("bag_full", "Biểu tượng cảnh báo balo đầy", 0.845f, 0.175f);
    public static final PointSpec BAG = new PointSpec("bag", "Nút mở balo", 0.935f, 0.37f);
    public static final PointSpec TOOLS_TAB = new PointSpec("tools_tab", "Tab Công cụ", 0.65f, 0.245f);
    public static final PointSpec ROD_SLOT = new PointSpec("rod_slot", "Ô cần câu đang dùng", 0.225f, 0.43f);
    public static final PointSpec REPAIR = new PointSpec("repair", "Nút Sửa", 0.755f, 0.825f);
    public static final PointSpec REPAIR_CONFIRM = new PointSpec("repair_confirm", "Xác nhận sửa cần", 0.62f, 0.705f);
    public static final PointSpec CLOSE_BAG = new PointSpec("close_bag", "Đóng balo", 0.95f, 0.115f);
    public static final PointSpec MAP = new PointSpec("map", "Mở bản đồ", 0.94f, 0.30f);
    public static final PointSpec SELLER = new PointSpec("seller", "Điểm người bán cá", 0.52f, 0.52f);
    public static final PointSpec TRAVEL = new PointSpec("travel", "Nút Di chuyển", 0.79f, 0.845f);
    public static final PointSpec FISH_TAB = new PointSpec("fish_tab", "Tab Cá trong balo", 0.35f, 0.245f);
    public static final PointSpec SELL_FISH = new PointSpec("sell_fish", "Nút chỉ bán toàn bộ cá", 0.77f, 0.83f);
    public static final PointSpec SELL_CONFIRM = new PointSpec("sell_confirm", "Xác nhận bán cá", 0.62f, 0.705f);
    public static final PointSpec RETURN_MAP = new PointSpec("return_map", "Mở bản đồ để quay lại", 0.94f, 0.30f);
    public static final PointSpec FISHING_SPOT = new PointSpec("fishing_spot", "Điểm câu trên bản đồ", 0.43f, 0.61f);
    public static final PointSpec EQUIP_ROD = new PointSpec("equip_rod", "Nút Trang bị cần", 0.74f, 0.82f);
    public static final List<PointSpec> FISHING_POINTS = Collections.unmodifiableList(Arrays.asList(ACTION, HOOK, STORE, BITE_REGION, SHADOW_REGION, BAG_FULL));
    public static final List<PointSpec> INVENTORY_AND_ROUTE_POINTS = Collections.unmodifiableList(Arrays.asList(BAG, TOOLS_TAB, ROD_SLOT, REPAIR, REPAIR_CONFIRM, CLOSE_BAG, MAP, SELLER, TRAVEL, FISH_TAB, SELL_FISH, SELL_CONFIRM, RETURN_MAP, FISHING_SPOT, EQUIP_ROD));

    // Selective selling: the bag grid is scanned tile by tile and only common items are sold.
    public static final PointSpec SELL_TILE_FIRST = new PointSpec("sell_tile_first", "Ô đầu tiên (trên-trái) trong lưới balo", 0.30f, 0.40f);
    public static final PointSpec SELL_TILE_LAST = new PointSpec("sell_tile_last", "Ô cuối cùng (dưới-phải) đang hiện", 0.72f, 0.78f);
    public static final PointSpec SELL_ONE = new PointSpec("sell_one", "Nút Bán trong cửa sổ chi tiết 1 con", 0.62f, 0.80f);
    public static final List<PointSpec> SELECTIVE_SELL_POINTS = Collections.unmodifiableList(Arrays.asList(SELL_TILE_FIRST, SELL_TILE_LAST, SELL_ONE));

    // Bug catching shares the action button, bag and shop flow but has its own tab, NPC and spot.
    public static final PointSpec BUG_TAB = new PointSpec("bug_tab", "Tab Côn trùng trong balo", 0.50f, 0.245f);
    public static final PointSpec BUG_SELLER = new PointSpec("bug_seller", "Điểm người mua côn trùng trên bản đồ", 0.55f, 0.50f);
    public static final PointSpec BUG_SPOT = new PointSpec("bug_spot", "Điểm bắt côn trùng trên bản đồ", 0.40f, 0.55f);
    public static final PointSpec NET_SLOT = new PointSpec("net_slot", "Ô vợt bắt côn trùng trong balo", 0.33f, 0.43f);
    public static final PointSpec JOYSTICK = new PointSpec("joystick", "Tâm joystick di chuyển", 0.14f, 0.72f);
    public static final List<PointSpec> BUG_POINTS = Collections.unmodifiableList(Arrays.asList(BUG_TAB, BUG_SELLER, BUG_SPOT, NET_SLOT, JOYSTICK));

    public ConfigStore(Context context) {
        this.preferences = context.getSharedPreferences(PREFS, 0);
        migrateCastHookSplit();
        migrateHookButtonCenter();
        migrateBiteIndicatorRegion();
        migrateCenteredBiteIndicator();
        migrateExpandedBiteIndicator();
        migrateStoreButtonCenter();
        migrateUnsafeTopLeftRoutes();
        migrateZeroedCoordinates();
    }

    /** Repairs coordinates saved by builds that incorrectly treated the hook button as the cue. */
    private void migrateBiteIndicatorRegion() {
        if (this.preferences.getBoolean("migrated_bite_indicator_v591", false)) return;
        float x = pointRatioX(BITE_REGION);
        float y = pointRatioY(BITE_REGION);
        if (isLegacyBiteRegion(x, y)) {
            savePointRatio(BITE_REGION, BITE_REGION.defaultX, BITE_REGION.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_bite_indicator_v591", true).apply();
    }

    static boolean isLegacyBiteRegion(float x, float y) {
        // Old defaults, old migration and auto-probe all wrote a lower-right button here.
        return x >= 0.80f && y >= 0.55f;
    }

    /** Moves the narrow IMG_8102 default to the centred cue area confirmed by IMG_8105. */
    private void migrateCenteredBiteIndicator() {
        if (this.preferences.getBoolean("migrated_bite_indicator_v596", false)) return;
        float x = pointRatioX(BITE_REGION);
        float y = pointRatioY(BITE_REGION);
        if (isPreviousNarrowBiteRegion(x, y) || isLegacyBiteRegion(x, y)) {
            savePointRatio(BITE_REGION, BITE_REGION.defaultX, BITE_REGION.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_bite_indicator_v596", true).apply();
    }

    static boolean isPreviousNarrowBiteRegion(float x, float y) {
        return Math.abs(x - 0.44f) <= 0.025f && Math.abs(y - 0.39f) <= 0.025f;
    }

    /**
     * IMG_8102 places the real cue around x=44%, while IMG_8105 centres the avatar closer
     * to x=50%. Move the 5.9.7 centre between both positions; the wider detector window then
     * covers either layout without reaching the action buttons at the right edge.
     */
    private void migrateExpandedBiteIndicator() {
        if (this.preferences.getBoolean("migrated_bite_indicator_v598", false)) return;
        float x = pointRatioX(BITE_REGION);
        float y = pointRatioY(BITE_REGION);
        if (Math.abs(x - 0.50f) <= 0.025f && Math.abs(y - 0.38f) <= 0.025f) {
            savePointRatio(BITE_REGION, BITE_REGION.defaultX, BITE_REGION.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_bite_indicator_v598", true).apply();
    }

    /** Moves the old bottom-edge tap to the centre of Bảo quản measured in IMG_8104. */
    private void migrateStoreButtonCenter() {
        if (this.preferences.getBoolean("migrated_store_center_v599", false)) return;
        float x = pointRatioX(STORE);
        float y = pointRatioY(STORE);
        if (isLegacyStorePoint(x, y)) {
            savePointRatio(STORE, STORE.defaultX, STORE.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_store_center_v599", true).apply();
    }

    static boolean isLegacyStorePoint(float x, float y) {
        return Math.abs(x - 0.756f) <= 0.025f && Math.abs(y - 0.858f) <= 0.025f;
    }

    /** Invalidates the old map point which opens the player profile in the current HUD. */
    private void migrateUnsafeTopLeftRoutes() {
        if (this.preferences.getBoolean("migrated_safe_routes_v593", false)) return;
        SharedPreferences.Editor editor = this.preferences.edit();
        if (!safeNavigationCoordinate(pointRatioX(MAP), pointRatioY(MAP))) {
            editor.remove(PREFIX_X + MAP.key).remove(PREFIX_Y + MAP.key);
        }
        if (!safeNavigationCoordinate(pointRatioX(RETURN_MAP), pointRatioY(RETURN_MAP))) {
            editor.remove(PREFIX_X + RETURN_MAP.key).remove(PREFIX_Y + RETURN_MAP.key);
        }
        editor.putBoolean("migrated_safe_routes_v593", true).apply();
    }

    static boolean safeNavigationCoordinate(float x, float y) {
        return Float.isFinite(x) && Float.isFinite(y)
            && !(x < 0.22f && y < 0.30f);
    }

    /**
     * Early builds divided integer screen coordinates before converting to float. Every
     * calibrated point could therefore be persisted as 0,0 and later hit the player/profile
     * controls in the top-left corner. Reset every affected point, not only map navigation.
     */
    private void migrateZeroedCoordinates() {
        if (this.preferences.getBoolean("migrated_zeroed_points_v595", false)) return;
        SharedPreferences.Editor editor = this.preferences.edit();
        for (PointSpec spec : allPointSpecs()) {
            String xKey = PREFIX_X + spec.key;
            String yKey = PREFIX_Y + spec.key;
            if (!this.preferences.contains(xKey) && !this.preferences.contains(yKey)) continue;
            if (isLegacyZeroedCoordinate(pointRatioX(spec), pointRatioY(spec))) {
                editor.remove(xKey).remove(yKey);
            }
        }
        editor.putBoolean("migrated_zeroed_points_v595", true).apply();
    }

    static boolean isLegacyZeroedCoordinate(float x, float y) {
        return Float.isFinite(x) && Float.isFinite(y) && x <= 0.02f && y <= 0.02f;
    }

    private static List<PointSpec> allPointSpecs() {
        java.util.ArrayList<PointSpec> points = new java.util.ArrayList<>();
        points.addAll(FISHING_POINTS);
        points.addAll(INVENTORY_AND_ROUTE_POINTS);
        points.addAll(SELECTIVE_SELL_POINTS);
        points.addAll(BUG_POINTS);
        return points;
    }

    /** Splits cast and hook coordinates retained by older installations. */
    private void migrateCastHookSplit() {
        if (this.preferences.getBoolean("migrated_cast_hook_v587", false)) {
            return;
        }
        float ax = pointRatioX(ACTION);
        float ay = pointRatioY(ACTION);
        float bx = pointRatioX(BITE_REGION);
        float by = pointRatioY(BITE_REGION);
        if (Math.abs(ax - bx) < 0.03f && Math.abs(ay - by) < 0.03f) {
            savePointRatio(BITE_REGION, HOOK.defaultX, HOOK.defaultY);
        }
        if (!this.preferences.contains(PREFIX_X + HOOK.key)) {
            savePointRatio(HOOK, HOOK.defaultX, HOOK.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_cast_hook_v587", true).apply();
    }

    /** Moves the old edge tap to the active reel-button centre measured in IMG_8102. */
    private void migrateHookButtonCenter() {
        if (this.preferences.getBoolean("migrated_hook_center_v5911", false)) return;
        float x = pointRatioX(HOOK);
        float y = pointRatioY(HOOK);
        if (isLegacyHookPoint(x, y)) {
            savePointRatio(HOOK, HOOK.defaultX, HOOK.defaultY);
        }
        this.preferences.edit().putBoolean("migrated_hook_center_v5911", true).apply();
    }

    static boolean isLegacyHookPoint(float x, float y) {
        return Math.abs(x - 0.902f) <= 0.025f && Math.abs(y - 0.735f) <= 0.025f;
    }

    public Point getPoint(PointSpec spec, int screenWidth, int screenHeight) {
        float x = this.preferences.getFloat(PREFIX_X + spec.key, spec.defaultX);
        float y = this.preferences.getFloat(PREFIX_Y + spec.key, spec.defaultY);
        return new Point(Math.round(AutomationPolicy.clampRatio(x) * Math.max(1, screenWidth - 1)), Math.round(AutomationPolicy.clampRatio(y) * Math.max(1, screenHeight - 1)));
    }

    public void savePoint(PointSpec spec, int rawX, int rawY, int screenWidth, int screenHeight) {
        // Float division is essential: int / int here silently truncated every calibrated
        // point to 0, so all taps landed in the top-left corner.
        float x = rawX / (float) Math.max(1, screenWidth);
        float y = rawY / (float) Math.max(1, screenHeight);
        savePointRatio(spec, x, y);
        if (spec == ACTION) {
            // A hand-placed cast button is authoritative; no need to probe for it.
            markActionConfirmed(true);
        }
    }

    public int sensitivity() {
        return AutomationPolicy.clampInt(this.preferences.getInt("sensitivity", 27), 8, 100);
    }

    public int repairEvery() {
        return AutomationPolicy.clampInt(this.preferences.getInt("repair_every", 30), 1, 999);
    }

    public int maximumRetries() {
        return AutomationPolicy.clampInt(this.preferences.getInt("maximum_retries", 3), 1, 8);
    }

    public int bagCheckEvery() {
        return 1;
    }

    /**
     * The bundled repair route is the supported 16:9/20:9 layout and is intentionally usable
     * without calibration. Requiring every point to be manually saved made the default-enabled
     * auto-repair switch a no-op on every fresh install.
     */
    public boolean repairRouteCalibrated() {
        return repairCoordinateUsable(BAG)
            && repairCoordinateUsable(TOOLS_TAB)
            && repairCoordinateUsable(bugMode() ? NET_SLOT : ROD_SLOT)
            && repairCoordinateUsable(REPAIR)
            && repairCoordinateUsable(REPAIR_CONFIRM)
            && repairCoordinateUsable(CLOSE_BAG);
    }

    private boolean repairCoordinateUsable(PointSpec spec) {
        float x = pointRatioX(spec);
        float y = pointRatioY(spec);
        return Float.isFinite(x) && Float.isFinite(y)
            && x >= 0.03f && x <= 0.97f && y >= 0.03f && y <= 0.97f;
    }

    /** A guessed joystick centre can drag an unrelated control, so patrol requires calibration. */
    public boolean bugPatrolCalibrated() {
        return pointsSaved(JOYSTICK);
    }

    /** Return travel must be completely calibrated before any navigation tap is allowed. */
    public boolean returnRouteCalibrated() {
        return safeNavigationCoordinate(pointRatioX(RETURN_MAP), pointRatioY(RETURN_MAP))
            && pointsSaved(RETURN_MAP, bugMode() ? BUG_SPOT : FISHING_SPOT, TRAVEL,
                BAG, TOOLS_TAB, bugMode() ? NET_SLOT : ROD_SLOT, EQUIP_ROD, CLOSE_BAG);
    }

    /** Selling uses many screen-specific coordinates; guessed defaults must never navigate. */
    public boolean sellingRouteCalibrated() {
        PointSpec seller = bugMode() ? BUG_SELLER : SELLER;
        PointSpec itemTab = bugMode() ? BUG_TAB : FISH_TAB;
        boolean salePointsReady = activeSellMode() == AutomationPolicy.SELL_ALL
            ? pointsSaved(SELL_FISH, SELL_CONFIRM)
            : pointsSaved(SELL_TILE_FIRST, SELL_TILE_LAST, SELL_ONE, SELL_CONFIRM);
        return safeNavigationCoordinate(pointRatioX(MAP), pointRatioY(MAP))
            && pointsSaved(BAG_FULL, MAP, seller, TRAVEL, BAG, itemTab, CLOSE_BAG)
            && salePointsReady
            && (!autoReturn() || returnRouteCalibrated());
    }

    private boolean pointsSaved(PointSpec... specs) {
        for (PointSpec spec : specs) {
            if (!this.preferences.contains(PREFIX_X + spec.key)
                    || !this.preferences.contains(PREFIX_Y + spec.key)) return false;
        }
        return true;
    }

    public boolean autoStore() {
        return this.preferences.getBoolean("auto_store", true);
    }

    public boolean autoRepair() {
        return this.preferences.getBoolean("auto_repair", true);
    }

    public boolean autoSell() {
        return this.preferences.getBoolean("auto_sell", true);
    }

    // --- Anti-Detection is baked in. Preferences cannot turn it off or loosen the caps. ---

    public boolean antiEnabled() {
        return true;
    }

    public int maxSessionMinutes() {
        return AntiDetection.HARD_MAX_SESSION_MINUTES;
    }

    public int maxFishPerSession() {
        return AntiDetection.HARD_MAX_CATCHES;
    }

    public int missChancePercent() {
        return AntiDetection.HARD_MISS_PERCENT;
    }

    // --- Advanced automation guards ---

    /** Travel back to the fishing spot after selling instead of stopping at the shop. */
    public boolean autoReturn() {
        return this.preferences.getBoolean("auto_return", true);
    }

    /** Stop when the battery falls below this percentage. 0 disables the guard. */
    public int stopBatteryPercent() {
        return AutomationPolicy.clampInt(this.preferences.getInt("stop_battery_percent", 15), 0, 50);
    }

    /** Force a recovery when nothing was caught for this many minutes. 0 disables it. */
    public int watchdogMinutes() {
        return AutomationPolicy.clampInt(this.preferences.getInt("watchdog_minutes", 10), 0, 120);
    }

    public void saveAdvancedOptions(boolean autoReturn, int stopBatteryPercent, int watchdogMinutes) {
        this.preferences.edit()
            .putBoolean("auto_return", autoReturn)
            .putInt("stop_battery_percent", AutomationPolicy.clampInt(stopBatteryPercent, 0, 50))
            .putInt("watchdog_minutes", AutomationPolicy.clampInt(watchdogMinutes, 0, 120))
            .apply();
    }

    public void saveQuickAutoReturn(boolean autoReturn) {
        this.preferences.edit().putBoolean("auto_return", autoReturn).apply();
    }

    public boolean overlayMenuEnabled() {
        return this.preferences.getBoolean("overlay_menu_enabled", false);
    }

    public void saveOverlayMenuEnabled(boolean enabled) {
        this.preferences.edit().putBoolean("overlay_menu_enabled", enabled).apply();
    }

    public boolean captureReady() {
        return this.preferences.getBoolean("capture_ready", false);
    }

    public void saveCaptureReady(boolean ready) {
        this.preferences.edit().putBoolean("capture_ready", ready).apply();
    }

    // --- Fish shadow filter ---

    /** Bitmask of shadow tiers (bit 0 = bóng 1 … bit 5 = bóng 6) worth hooking; 0 = no filter. */
    public int shadowTierMask() {
        return this.preferences.getInt("shadow_tiers", 0) & AutomationPolicy.ALL_SHADOW_TIERS;
    }

    public boolean shadowFilterEnabled() {
        return AutomationPolicy.shadowFilterActive(shadowTierMask());
    }

    public void saveShadowTiers(int tierMask) {
        this.preferences.edit().putInt("shadow_tiers", tierMask & AutomationPolicy.ALL_SHADOW_TIERS).apply();
    }

    /** Stretches the tier boundaries (50–200 %) for cameras that show shadows bigger or smaller. */
    public int shadowScalePercent() {
        return AutomationPolicy.clampInt(this.preferences.getInt("shadow_scale", 100), 50, 200);
    }

    public void saveShadowScale(int percent) {
        this.preferences.edit().putInt("shadow_scale", AutomationPolicy.clampInt(percent, 50, 200)).apply();
    }

    // --- Activity: fishing or bug catching ---

    public boolean bugMode() {
        return this.preferences.getBoolean("bug_mode", false);
    }

    public void saveBugMode(boolean bugs) {
        this.preferences.edit().putBoolean("bug_mode", bugs).apply();
    }

    /** Seconds without a bug in range before the patrol takes a step (when enabled). */
    public int bugIdleSeconds() {
        return AutomationPolicy.clampInt(this.preferences.getInt("bug_idle_seconds", 20), 5, 120);
    }

    /** Wander around the spot looking for bugs instead of waiting for them to come by. */
    public boolean bugPatrol() {
        return this.preferences.getBoolean("bug_patrol", true);
    }

    public void saveBugOptions(int idleSeconds, boolean patrol) {
        this.preferences.edit()
            .putInt("bug_idle_seconds", AutomationPolicy.clampInt(idleSeconds, 5, 120))
            .putBoolean("bug_patrol", patrol)
            .apply();
    }

    public void saveQuickBugPatrol(boolean patrol) {
        this.preferences.edit().putBoolean("bug_patrol", patrol).apply();
    }

    // --- Selling: everything, or only common items ---

    /** {@link AutomationPolicy#SELL_ALL}, {@link AutomationPolicy#SELL_KEEP_RARE} or {@link AutomationPolicy#SELL_KEEP_EPIC}. */
    public int fishSellMode() {
        return AutomationPolicy.clampInt(this.preferences.getInt("fish_sell_mode", AutomationPolicy.SELL_ALL), 0, 2);
    }

    public int bugSellMode() {
        return AutomationPolicy.clampInt(this.preferences.getInt("bug_sell_mode", AutomationPolicy.SELL_ALL), 0, 2);
    }

    /** Sell mode of whichever activity is currently selected. */
    public int activeSellMode() {
        return bugMode() ? bugSellMode() : fishSellMode();
    }

    public void saveSellMode(boolean bugs, int mode) {
        this.preferences.edit().putInt(bugs ? "bug_sell_mode" : "fish_sell_mode", AutomationPolicy.clampInt(mode, 0, 2)).apply();
    }

    public int sellGridColumns() {
        return AutomationPolicy.clampInt(this.preferences.getInt("sell_cols", 5), 1, 12);
    }

    public int sellGridRows() {
        return AutomationPolicy.clampInt(this.preferences.getInt("sell_rows", 3), 1, 8);
    }

    public void saveSellGrid(int columns, int rows) {
        this.preferences.edit()
            .putInt("sell_cols", AutomationPolicy.clampInt(columns, 1, 12))
            .putInt("sell_rows", AutomationPolicy.clampInt(rows, 1, 8))
            .apply();
    }

    // --- Action-button auto detection ---

    /**
     * True once the cast button position is known to work: either the user calibrated it by
     * hand or the auto-detector saw a full catch through it. Until then every start probes.
     */
    public boolean actionConfirmed() {
        return this.preferences.getBoolean("action_confirmed", false);
    }

    public void markActionConfirmed(boolean confirmed) {
        this.preferences.edit().putBoolean("action_confirmed", confirmed).apply();
    }

    public void savePointRatio(PointSpec spec, float x, float y) {
        this.preferences.edit()
            .putFloat(PREFIX_X + spec.key, AutomationPolicy.clampRatio(x))
            .putFloat(PREFIX_Y + spec.key, AutomationPolicy.clampRatio(y))
            .apply();
    }

    public float pointRatioX(PointSpec spec) {
        return this.preferences.getFloat(PREFIX_X + spec.key, spec.defaultX);
    }

    public float pointRatioY(PointSpec spec) {
        return this.preferences.getFloat(PREFIX_Y + spec.key, spec.defaultY);
    }

    // --- Session statistics ---

    public void startSessionStats(long startedAtWallMs) {
        this.preferences.edit()
            .putLong("stats_started_at", startedAtWallMs)
            .putInt("stats_session_caught", 0)
            .putInt("stats_sold", 0)
            .putInt("stats_repaired", 0)
            .putInt("stats_skipped", 0)
            .apply();
    }

    public void saveSessionStats(int sessionCaught, int sold, int repaired, int skipped) {
        this.preferences.edit()
            .putInt("stats_session_caught", Math.max(0, sessionCaught))
            .putInt("stats_sold", Math.max(0, sold))
            .putInt("stats_repaired", Math.max(0, repaired))
            .putInt("stats_skipped", Math.max(0, skipped))
            .apply();
    }

    public int sessionSkipped() {
        return Math.max(0, this.preferences.getInt("stats_skipped", 0));
    }

    public int sessionCaught() {
        return Math.max(0, this.preferences.getInt("stats_session_caught", 0));
    }

    public int sessionSold() {
        return Math.max(0, this.preferences.getInt("stats_sold", 0));
    }

    public int sessionRepaired() {
        return Math.max(0, this.preferences.getInt("stats_repaired", 0));
    }

    /** Wall-clock start of the current session, or 0 when no session has run yet. */
    public long sessionStartedAt() {
        return this.preferences.getLong("stats_started_at", 0L);
    }

    // --- Game version (Global / VNG) ---

    public GameVariant gameVariant() {
        return GameVariant.fromKey(this.preferences.getString(KEY_GAME_VARIANT, null));
    }

    /** False until the user has explicitly picked a version, so we can auto-detect once. */
    public boolean gameVariantChosen() {
        return this.preferences.contains(KEY_GAME_VARIANT);
    }

    public void saveGameVariant(GameVariant variant) {
        this.preferences.edit().putString(KEY_GAME_VARIANT, variant.name()).apply();
    }

    public void saveOptions(boolean autoStore, boolean autoRepair, boolean autoSell, int sensitivity, int repairEvery, int maximumRetries) {
        this.preferences.edit().putBoolean("auto_store", autoStore).putBoolean("auto_repair", autoRepair).putBoolean("auto_sell", autoSell).putInt("sensitivity", AutomationPolicy.clampInt(sensitivity, 8, 100)).putInt("repair_every", AutomationPolicy.clampInt(repairEvery, 1, 999)).putInt("maximum_retries", AutomationPolicy.clampInt(maximumRetries, 1, 8)).apply();
    }

    public void saveAntiOptions(boolean ignoredEnabled, int ignoredMinutes, int ignoredFish, int ignoredMiss) {
        // Anti is compiled in. Persisting a disable flag would be ignored anyway.
    }

    public void saveQuickOptions(boolean autoStore, boolean autoRepair, boolean autoSell) {
        this.preferences.edit()
            .putBoolean("auto_store", autoStore)
            .putBoolean("auto_repair", autoRepair)
            .putBoolean("auto_sell", autoSell)
            .apply();
    }

    public void saveQuickAntiEnabled(boolean ignored) {
        // Anti cannot be switched off from the overlay.
    }

    public void setRuntime(AutomationState state, String message, int caught) {
        this.preferences.edit().putString("runtime_state", state.name()).putString("runtime_message", message).putInt("runtime_caught", Math.max(0, caught)).apply();
        appendLog(state.name() + ": " + message);
    }

    public void appendLog(String entry) {
        // The state machine re-announces the same step on every retry; collapsing repeats
        // keeps the log readable and avoids a SharedPreferences write per poll.
        if (entry.equals(this.lastLoggedEntry)) {
            return;
        }
        this.lastLoggedEntry = entry;
        String old = this.preferences.getString("runtime_log", "");
        String line = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(new java.util.Date()) + "  " + entry + "\n";
        String merged = line + old;
        if (merged.length() > LOG_LIMIT_CHARS) merged = merged.substring(0, LOG_LIMIT_CHARS);
        this.preferences.edit().putString("runtime_log", merged).apply();
    }

    public String runtimeLog() {
        return this.preferences.getString("runtime_log", "Chưa có nhật ký.");
    }

    public String runtimeMessage() {
        return this.preferences.getString("runtime_message", AutomationState.IDLE.label);
    }

    public int runtimeCaught() {
        return Math.max(0, this.preferences.getInt("runtime_caught", 0));
    }

    /** Total catch count at the last visually confirmed repair. */
    public int lastRepairCaught() {
        return Math.max(0, this.preferences.getInt("last_repair_caught", 0));
    }

    public void markRepairCaught(int caught) {
        this.preferences.edit().putInt("last_repair_caught", Math.max(0, caught)).apply();
    }

    public String runtimeState() {
        return this.preferences.getString("runtime_state", AutomationState.IDLE.name());
    }

    public void resetCalibration() {
        SharedPreferences.Editor editor = this.preferences.edit();
        for (PointSpec spec : FISHING_POINTS) {
            editor.remove(PREFIX_X + spec.key).remove(PREFIX_Y + spec.key);
        }
        for (PointSpec spec2 : INVENTORY_AND_ROUTE_POINTS) {
            editor.remove(PREFIX_X + spec2.key).remove(PREFIX_Y + spec2.key);
        }
        for (PointSpec spec3 : SELECTIVE_SELL_POINTS) {
            editor.remove(PREFIX_X + spec3.key).remove(PREFIX_Y + spec3.key);
        }
        for (PointSpec spec4 : BUG_POINTS) {
            editor.remove(PREFIX_X + spec4.key).remove(PREFIX_Y + spec4.key);
        }
        // Forget the confirmation too, so the next start probes for the button again.
        editor.remove("action_confirmed");
        editor.apply();
    }

    public static final class PointSpec {
        public final float defaultX;
        public final float defaultY;
        public final String key;
        public final String label;

        PointSpec(String key, String label, float defaultX, float defaultY) {
            this.key = key;
            this.label = label;
            this.defaultX = defaultX;
            this.defaultY = defaultY;
        }
    }
}
