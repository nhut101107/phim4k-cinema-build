package com.pthelper.autofishing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.hardware.display.DisplayManager;
import android.view.Display;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

/** Lightweight, draggable control menu. It does not inspect or modify the game process. */
public final class ControlOverlayService extends Service {
    public static final String ACTION_SHOW = "com.pthelper.autofishing.SHOW_MENU";
    public static final String ACTION_HIDE = "com.pthelper.autofishing.HIDE_MENU";
    public static final String ACTION_COLLAPSE = "com.pthelper.autofishing.COLLAPSE_MENU";
    public static final String ACTION_SUSPEND = "com.pthelper.autofishing.SUSPEND_MENU";

    // --- Palette (dark gaming theme) ---
    private static final int PANEL        = Color.rgb(17, 19, 26);
    private static final int CARD         = Color.rgb(28, 31, 40);
    private static final int ROW          = Color.rgb(36, 39, 50);
    private static final int TAB_TRACK    = Color.rgb(24, 27, 35);
    private static final int ACCENT       = Color.rgb(0, 200, 120);
    private static final int ACCENT_INK   = Color.rgb(6, 18, 12);
    private static final int MUTED        = Color.rgb(140, 145, 158);
    private static final int TEXT_WHITE   = Color.rgb(235, 238, 245);
    private static final int DANGER       = Color.rgb(220, 50, 50);
    private static final int WARN         = Color.rgb(255, 200, 80);
    private static final int SHIELD_GREEN = Color.rgb(50, 205, 100);
    private static final int SHIELD_OFF   = Color.rgb(180, 80, 60);
    private static final int BORDER       = Color.rgb(52, 57, 70);

    private static final String CHANNEL_ID = "auto_fishing_menu";
    private static final int NOTIFICATION_ID = 4106;
    private static final long STATUS_INTERVAL_MS = 900L;
    private static final long FADE_MS = 130L;
    private static final int PANEL_WIDTH_DP = 300;

    private static final int TAB_CONTROL = 0;
    private static final int TAB_SETTINGS = 1;
    private static final int TAB_STATS = 2;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ConfigStore config;
    private WindowManager windowManager;
    private WindowManager.LayoutParams params;
    private View overlay;
    private TextView status;
    private TextView shadowLabel;
    private Button[] tierChips;
    private Button noFilterChip;
    private Button modeChip;
    private Button[] sellChips;
    private TextView sellHint;
    private TextView statsLabel;
    private Button masterToggle;
    private Button pause;
    private Button variantChip;
    private final Button[] tabButtons = new Button[3];
    private final View[] tabPages = new View[3];
    private int activeTab = TAB_CONTROL;
    private boolean compact;
    private String lastRenderedStatus;
    private DisplayManager displayManager;
    private int lastRotation = Display.INVALID_DISPLAY;
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override
        public void onDisplayAdded(int displayId) {
        }

        @Override
        public void onDisplayRemoved(int displayId) {
        }

        @Override
        public void onDisplayChanged(int displayId) {
            ControlOverlayService.this.rebuildIfRotationChanged();
        }
    };

    private final Runnable statusUpdater = new Runnable() {
        @Override
        public void run() {
            renderStatus();
            handler.postDelayed(this, STATUS_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        config = new ConfigStore(getApplicationContext());
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        lastRotation = currentRotation();
        if (displayManager != null) {
            displayManager.registerDisplayListener(displayListener, handler);
        }
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        String action = intent == null ? null : intent.getAction();
        if (ACTION_HIDE.equals(action)) {
            config.saveOverlayMenuEnabled(false);
            try {
                startService(new Intent(this, FishingService.class).setAction(FishingService.ACTION_RELEASE));
            } catch (RuntimeException ignored) {
                // Fishing service may already be down.
            }
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SUSPEND.equals(action)) {
            if (overlay == null || !compact) showCompact();
            return START_STICKY;
        }
        config.saveOverlayMenuEnabled(true);
        if (ACTION_COLLAPSE.equals(action)) {
            if (overlay == null || !compact) showCompact();
            return START_STICKY;
        }
        if (overlay == null || compact) showExpanded();
        return START_STICKY;
    }

    // ══════════════════════════════ Panel ══════════════════════════════

    private void showExpanded() {
        compact = false;
        removeOverlay();
        lastRenderedStatus = null;

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(12), dp(10), dp(12), dp(12));
        panel.setBackground(rounded(PANEL, 20, BORDER, 1));

        panel.addView(buildHeader());
        panel.addView(buildStatus());
        panel.addView(buildTabBar());

        tabPages[TAB_CONTROL] = buildControlPage();
        tabPages[TAB_SETTINGS] = buildSettingsPage();
        tabPages[TAB_STATS] = buildStatsPage();
        for (View page : tabPages) {
            panel.addView(page);
        }
        selectTab(activeTab, false);

        overlay = panel;
        ensureParams(dp(PANEL_WIDTH_DP), -2);
        addOverlaySafely();
        if (overlay != null) {
            overlay.setAlpha(0f);
            overlay.animate().alpha(1f).setDuration(FADE_MS).start();
            handler.removeCallbacks(statusUpdater);
            handler.post(statusUpdater);
        }
    }

    private View buildHeader() {
        LinearLayout header = horizontal();

        TextView title = label("LN", 13, ACCENT_INK, true);
        title.setGravity(Gravity.CENTER);
        title.setBackground(rounded(ACCENT, 12, Color.TRANSPARENT, 0));
        header.addView(title, new LinearLayout.LayoutParams(dp(74), dp(34)));

        variantChip = smallButton("", CARD);
        variantChip.setTextSize(11);
        variantChip.setContentDescription("Đổi phiên bản game");
        variantChip.setOnClickListener(v -> toggleVariant());
        LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(0, dp(34), 1f);
        chipParams.setMargins(dp(6), 0, dp(6), 0);
        header.addView(variantChip, chipParams);
        renderVariantChip();

        modeChip = smallButton("", CARD);
        modeChip.setTextSize(15);
        modeChip.setContentDescription("Đổi chế độ câu / bắt côn trùng");
        modeChip.setOnClickListener(v -> toggleBugMode());
        LinearLayout.LayoutParams modeParams = new LinearLayout.LayoutParams(dp(40), dp(34));
        modeParams.rightMargin = dp(6);
        header.addView(modeChip, modeParams);
        renderModeChip();

        Button minimize = smallButton("─", CARD);
        minimize.setContentDescription("Thu gọn menu");
        minimize.setOnClickListener(v -> showCompact());
        header.addView(minimize, new LinearLayout.LayoutParams(dp(36), dp(34)));

        Button close = smallButton("✕", CARD);
        close.setContentDescription("Đóng menu nổi");
        close.setContentDescription("Thu nhỏ menu — không thoát game");
        close.setOnClickListener(v -> showCompact());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dp(36), dp(34));
        closeParams.leftMargin = dp(4);
        header.addView(close, closeParams);

        // Buttons consume their own touches, so the rest of the strip stays a drag handle.
        attachDrag(header);
        return header;
    }

    private View buildStatus() {
        status = label("Đang đọc trạng thái…", 12, MUTED, false);
        status.setMaxLines(2);
        status.setPadding(dp(8), dp(9), dp(8), dp(9));
        status.setBackground(rounded(CARD, 12, Color.TRANSPARENT, 0));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(8);
        status.setLayoutParams(params);
        return status;
    }

    private View buildTabBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackground(rounded(TAB_TRACK, 13, Color.TRANSPARENT, 0));
        bar.setPadding(dp(3), dp(3), dp(3), dp(3));

        String[] titles = {"ĐIỀU KHIỂN", "CÀI ĐẶT", "THỐNG KÊ"};
        for (int index = 0; index < titles.length; index++) {
            final int tab = index;
            Button button = new Button(this);
            button.setText(titles[index]);
            button.setAllCaps(false);
            button.setTextSize(10);
            button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            button.setPadding(0, 0, 0, 0);
            button.setGravity(Gravity.CENTER);
            button.setOnClickListener(v -> selectTab(tab, true));
            tabButtons[index] = button;
            bar.addView(button, new LinearLayout.LayoutParams(0, dp(32), 1f));
        }

        LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(-1, -2);
        barParams.topMargin = dp(9);
        bar.setLayoutParams(barParams);
        return bar;
    }

    /**
     * Only the active page stays in the hierarchy as VISIBLE; the others are GONE so the
     * layout pass skips them, which keeps the panel responsive on low-end phones.
     */
    private void selectTab(int tab, boolean animate) {
        activeTab = tab;
        for (int index = 0; index < tabPages.length; index++) {
            boolean active = index == tab;
            if (tabButtons[index] != null) {
                tabButtons[index].setBackground(active ? rounded(ACCENT, 10, Color.TRANSPARENT, 0)
                    : rounded(Color.TRANSPARENT, 10, Color.TRANSPARENT, 0));
                tabButtons[index].setTextColor(active ? ACCENT_INK : MUTED);
            }
            View page = tabPages[index];
            if (page == null) continue;
            page.setVisibility(active ? View.VISIBLE : View.GONE);
            if (active && animate) {
                page.setAlpha(0f);
                page.animate().alpha(1f).setDuration(FADE_MS).start();
            } else if (active) {
                page.setAlpha(1f);
            }
        }
        if (tab == TAB_STATS) {
            renderStats();
        }
        lastRenderedStatus = null;
    }

    private View buildControlPage() {
        LinearLayout page = page();

        masterToggle = actionButton("▶  BẮT ĐẦU", ACCENT);
        masterToggle.setTextSize(13);
        masterToggle.setOnClickListener(v -> toggleAutomation());
        LinearLayout.LayoutParams masterParams = new LinearLayout.LayoutParams(-1, dp(46));
        masterParams.topMargin = dp(10);
        page.addView(masterToggle, masterParams);

        LinearLayout row = horizontal();
        pause = actionButton("⏸ TẠM DỪNG", ROW);
        pause.setOnClickListener(v -> togglePause());
        row.addView(pause, weightedButtonParams());
        page.addView(row);

        Button setup = actionButton("⚙  HIỆU CHỈNH & CÀI ĐẶT ĐẦY ĐỦ", ROW);
        setup.setOnClickListener(v -> openMain(false));
        LinearLayout.LayoutParams setupParams = new LinearLayout.LayoutParams(-1, dp(40));
        setupParams.topMargin = dp(6);
        page.addView(setup, setupParams);

        return page;
    }

    private View buildSettingsPage() {
        LinearLayout page = page();

        Switch store = option("💾 Bảo quản cá", config.autoStore());
        Switch repair = option("🔧 Tự sửa cần / vợt", config.autoRepair());
        Switch sell = option("💰 Đầy balo thì bán cá", config.autoSell());
        Switch back = option("🧭 Bán xong tự về chỗ câu", config.autoReturn());
        CompoundButton.OnCheckedChangeListener listener = (button, checked) ->
            config.saveQuickOptions(store.isChecked(), repair.isChecked(), sell.isChecked());
        store.setOnCheckedChangeListener(listener);
        repair.setOnCheckedChangeListener(listener);
        sell.setOnCheckedChangeListener(listener);
        back.setOnCheckedChangeListener((button, checked) -> config.saveQuickAutoReturn(checked));
        page.addView(store);
        page.addView(repair);
        page.addView(sell);
        page.addView(back);

        TextView sellTitle = label("💰 Khi đầy balo", 11, TEXT_WHITE, true);
        sellTitle.setPadding(dp(8), dp(10), dp(8), dp(4));
        page.addView(sellTitle);
        LinearLayout sellRow = horizontal();
        String[] sellLabels = {"Bán hết", "Giữ tím"};
        sellChips = new Button[sellLabels.length];
        for (int mode = 0; mode < sellLabels.length; mode++) {
            final int chosen = mode;
            Button chip = actionButton(sellLabels[mode], Color.TRANSPARENT);
            chip.setTextSize(11);
            chip.setOnClickListener(v -> {
                config.saveSellMode(config.bugMode(), chosen);
                renderSellChips();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(34), 1f);
            lp.setMargins(dp(2), 0, dp(2), 0);
            sellRow.addView(chip, lp);
            sellChips[mode] = chip;
        }
        page.addView(sellRow);
        sellHint = label("", 10, MUTED, false);
        sellHint.setPadding(dp(8), dp(6), dp(8), 0);
        page.addView(sellHint);
        renderSellChips();

        TextView tierTitle = label("🐟 Lọc bóng cá — chọn cỡ muốn giật", 11, TEXT_WHITE, true);
        tierTitle.setPadding(dp(8), dp(10), dp(8), dp(4));
        page.addView(tierTitle);

        LinearLayout chips = horizontal();
        chips.setBackground(rounded(ROW, 11, Color.TRANSPARENT, 0));
        chips.setPadding(dp(3), dp(3), dp(3), dp(3));
        tierChips = new Button[AutomationPolicy.SHADOW_TIERS];
        for (int tier = 1; tier <= AutomationPolicy.SHADOW_TIERS; tier++) {
            final int chosen = tier;
            Button chip = actionButton(String.valueOf(tier), Color.TRANSPARENT);
            chip.setTextSize(13);
            chip.setOnClickListener(v -> {
                config.saveShadowTiers(AutomationPolicy.toggleTier(config.shadowTierMask(), chosen));
                renderTierChips();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(34), 1f);
            lp.setMargins(dp(1), 0, dp(1), 0);
            chips.addView(chip, lp);
            tierChips[tier - 1] = chip;
        }
        Button none = actionButton("Không", Color.TRANSPARENT);
        none.setTextSize(11);
        none.setOnClickListener(v -> {
            config.saveShadowTiers(0);
            renderTierChips();
        });
        LinearLayout.LayoutParams noneLp = new LinearLayout.LayoutParams(0, dp(34), 1.6f);
        noneLp.setMargins(dp(1), 0, dp(1), 0);
        chips.addView(none, noneLp);
        noFilterChip = none;
        page.addView(chips);

        shadowLabel = label("", 10, SHIELD_GREEN, false);
        shadowLabel.setPadding(dp(8), dp(6), dp(8), 0);
        shadowLabel.setLineSpacing(dp(1), 1f);
        page.addView(shadowLabel);
        renderTierChips();

        TextView antiNote = label("🛡️ Anti luôn chạy. Không nghỉ ngẫu nhiên, không giới hạn số cá và không tự dừng. Bị đá thì vào tay, đừng để macro login.", 10, MUTED, false);
        antiNote.setPadding(dp(8), dp(10), dp(8), dp(4));
        antiNote.setLineSpacing(dp(1), 1f);
        page.addView(antiNote);

        return page;
    }

    private View buildStatsPage() {
        LinearLayout page = page();
        statsLabel = label("", 11, TEXT_WHITE, false);
        statsLabel.setPadding(dp(10), dp(10), dp(10), dp(10));
        statsLabel.setLineSpacing(dp(4), 1f);
        statsLabel.setBackground(rounded(CARD, 12, Color.TRANSPARENT, 0));
        LinearLayout.LayoutParams statsParams = new LinearLayout.LayoutParams(-1, -2);
        statsParams.topMargin = dp(10);
        page.addView(statsLabel, statsParams);

        Button reset = actionButton("🔄 Đặt lại bộ đếm", ROW);
        reset.setOnClickListener(v -> {
            config.startSessionStats(System.currentTimeMillis());
            renderStats();
            Toast.makeText(this, "Đã đặt lại bộ đếm phiên.", Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams resetParams = new LinearLayout.LayoutParams(-1, dp(38));
        resetParams.topMargin = dp(8);
        page.addView(reset, resetParams);

        return page;
    }

    private LinearLayout page() {
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        return page;
    }

    private void showCompact() {
        compact = true;
        removeOverlay();

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.HORIZONTAL);
        bubble.setGravity(Gravity.CENTER);
        bubble.setContentDescription("Mở menu LN — không cần thoát game");

        boolean running = !isStoppedState(config.runtimeState());
        int bubbleColor = running ? ACCENT : Color.rgb(255, 101, 47);
        bubble.setBackground(rounded(bubbleColor, 24, Color.WHITE, 2));
        bubble.addView(label("LN", 13, ACCENT_INK, true));

        bubble.setOnClickListener(v -> showExpanded());
        attachDrag(bubble);
        overlay = bubble;
        ensureParams(dp(48), dp(48));
        addOverlaySafely();
        if (overlay != null) {
            overlay.setAlpha(0f);
            overlay.animate().alpha(1f).setDuration(FADE_MS).start();
        }
    }

    // ══════════════════════════════ Actions ══════════════════════════════

    /** One button for the whole session: start it when idle, stop it when running. */
    private void toggleAutomation() {
        if (isStoppedState(config.runtimeState())) {
            if (!config.captureReady()) {
                Toast.makeText(this, "Vào LeafNote bật menu nổi và cho ghi màn hình một lần trước.", Toast.LENGTH_LONG).show();
                return;
            }
            sendFishingCommand(FishingService.ACTION_START);
        } else {
            sendFishingCommand(FishingService.ACTION_STOP);
        }
    }

    private static boolean isStoppedState(String state) {
        return AutomationState.IDLE.name().equals(state)
            || AutomationState.ARMED.name().equals(state)
            || AutomationState.ERROR.name().equals(state)
            || AutomationState.SESSION_EXPIRED.name().equals(state)
            || AutomationState.LOW_BATTERY.name().equals(state);
    }

    private void togglePause() {
        String state = config.runtimeState();
        if (isStoppedState(state)) {
            Toast.makeText(this, "Chưa chạy — bấm BẮT ĐẦU trước.", Toast.LENGTH_SHORT).show();
            return;
        }
        sendFishingCommand(AutomationState.PAUSED.name().equals(state)
            ? FishingService.ACTION_RESUME : FishingService.ACTION_PAUSE);
    }

    private void toggleBugMode() {
        if (!isStoppedState(config.runtimeState())) {
            Toast.makeText(this, "Dừng phiên hiện tại trước khi đổi chế độ.", Toast.LENGTH_SHORT).show();
            return;
        }
        config.saveBugMode(!config.bugMode());
        renderModeChip();
        renderSellChips();
        Toast.makeText(this, config.bugMode() ? "Chế độ: bắt côn trùng" : "Chế độ: câu cá", Toast.LENGTH_SHORT).show();
    }

    private void toggleVariant() {
        GameVariant next = config.gameVariant() == GameVariant.GLOBAL ? GameVariant.VNG : GameVariant.GLOBAL;
        config.saveGameVariant(next);
        renderVariantChip();
        if (!next.isInstalled(this)) {
            Toast.makeText(this, "Chưa cài " + next.label + ".", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "Đã chọn " + next.label + ".", Toast.LENGTH_SHORT).show();
        }
    }

    private void sendFishingCommand(String action) {
        try {
            startService(new Intent(this, FishingService.class).setAction(action));
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không gửi được lệnh.", Toast.LENGTH_SHORT).show();
        }
    }

    private void openMain(boolean requestCapture) {
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(requestCapture ? MainActivity.EXTRA_REQUEST_CAPTURE : MainActivity.EXTRA_OPEN_SETTINGS, true);
        startActivity(intent);
    }

    // ══════════════════════════════ Rendering ══════════════════════════════

    private void renderStatus() {
        if (compact || status == null) return;
        if (activeTab == TAB_STATS) {
            // Elapsed time keeps moving even when the state text does not.
            renderStats();
        }
        String state = config.runtimeState();
        String message = config.runtimeMessage();
        int caught = config.runtimeCaught();
        String rendered = state + '|' + message + '|' + caught;
        if (rendered.equals(lastRenderedStatus)) {
            return;
        }
        lastRenderedStatus = rendered;

        status.setText(getString(R.string.overlay_status, message, caught));
        status.setTextColor(statusColor(state));

        boolean idle = isStoppedState(state);
        if (masterToggle != null) {
            masterToggle.setText(idle ? "▶  BẮT ĐẦU" : "⛔  DỪNG");
            masterToggle.setBackground(rounded(idle ? ACCENT : DANGER, 11, Color.TRANSPARENT, 0));
            masterToggle.setTextColor(idle ? ACCENT_INK : Color.WHITE);
        }
        if (pause != null) {
            pause.setText(AutomationState.PAUSED.name().equals(state) ? "▶ TIẾP TỤC" : "⏸ TẠM DỪNG");
        }
    }

    private void renderStats() {
        if (statsLabel == null) return;
        long startedAt = config.sessionStartedAt();
        long elapsedMs = startedAt > 0 ? Math.max(0, System.currentTimeMillis() - startedAt) : 0;
        int sessionCaught = config.sessionCaught();
        int rate = AutomationPolicy.fishPerHour(sessionCaught, elapsedMs);
        statsLabel.setText(
            "🐟 Cá phiên này:  " + sessionCaught + "\n"
            + "📦 Tổng đã câu:  " + config.runtimeCaught() + "\n"
            + "🚫 Đã bỏ qua:  " + config.sessionSkipped() + "\n"
            + "💰 Lần bán cá:  " + config.sessionSold() + "\n"
            + "🔧 Lần sửa cần:  " + config.sessionRepaired() + "\n"
            + "⏱ Thời gian:  " + formatDuration(elapsedMs) + "\n"
            + "⚡ Tốc độ:  " + (rate > 0 ? rate + " cá/giờ" : "đang tính…"));
    }

    private static String formatDuration(long millis) {
        long totalMinutes = millis / 60_000L;
        long hours = totalMinutes / 60;
        long minutes = totalMinutes % 60;
        return hours > 0 ? hours + "h " + minutes + "p" : minutes + " phút";
    }

    private void renderModeChip() {
        if (modeChip == null) return;
        modeChip.setText(config.bugMode() ? "🦋" : "🎣");
    }

    private void renderSellChips() {
        if (sellChips == null) return;
        int mode = config.activeSellMode();
        boolean keep = AutomationPolicy.keepPurpleEnabled(mode);
        for (int index = 0; index < sellChips.length; index++) {
            boolean on = index == 0 ? !keep : keep;
            sellChips[index].setBackground(rounded(on ? ACCENT : Color.TRANSPARENT, 9, Color.TRANSPARENT, 0));
            sellChips[index].setTextColor(on ? ACCENT_INK : MUTED);
        }
        if (sellHint != null) {
            sellHint.setText((config.bugMode() ? "Côn trùng: " : "Cá: ") + AutomationPolicy.describeSellMode(mode));
        }
    }

    private void renderVariantChip() {
        if (variantChip == null) return;
        GameVariant variant = config.gameVariant();
        variantChip.setText("🎮 " + variant.shortLabel);
        variantChip.setTextColor(variant.isInstalled(this) ? TEXT_WHITE : WARN);
    }

    private void renderTierChips() {
        if (tierChips == null) return;
        int mask = config.shadowTierMask();
        boolean active = AutomationPolicy.shadowFilterActive(mask);
        for (int tier = 1; tier <= tierChips.length; tier++) {
            boolean on = active && AutomationPolicy.tierAllowed(tier, mask);
            tierChips[tier - 1].setBackground(rounded(on ? ACCENT : Color.TRANSPARENT, 9, Color.TRANSPARENT, 0));
            tierChips[tier - 1].setTextColor(on ? ACCENT_INK : MUTED);
        }
        if (noFilterChip != null) {
            noFilterChip.setBackground(rounded(active ? Color.TRANSPARENT : CARD, 9, Color.TRANSPARENT, 0));
            noFilterChip.setTextColor(active ? MUTED : TEXT_WHITE);
        }
        if (shadowLabel != null) {
            if (active) {
                shadowLabel.setText("Chỉ giật bóng " + AutomationPolicy.describeTiers(mask)
                    + " • đã thả " + config.sessionSkipped() + " con");
                shadowLabel.setTextColor(SHIELD_GREEN);
            } else {
                shadowLabel.setText("Không lọc — giật mọi con cá cắn.");
                shadowLabel.setTextColor(MUTED);
            }
        }
    }

    private static int statusColor(String state) {
        if (AutomationState.ERROR.name().equals(state)) {
            return Color.rgb(255, 108, 108);
        }
        if (AutomationState.SESSION_EXPIRED.name().equals(state)
                || AutomationState.LOW_BATTERY.name().equals(state)) {
            return SHIELD_GREEN;
        }
        if (AutomationState.IDLE.name().equals(state)) {
            return MUTED;
        }
        if (AutomationState.PAUSED.name().equals(state)
                || AutomationState.MICRO_PAUSE.name().equals(state)
                || AutomationState.SESSION_BREAK.name().equals(state)
                || AutomationState.PROBING.name().equals(state)) {
            return WARN;
        }
        return SHIELD_GREEN;
    }

    // ══════════════════════════════ Window plumbing ══════════════════════════════

    private int currentRotation() {
        try {
            return windowManager.getDefaultDisplay().getRotation();
        } catch (RuntimeException error) {
            return -1;
        }
    }

    private void rebuildIfRotationChanged() {
        int rotation = currentRotation();
        if (rotation < 0 || rotation == lastRotation) {
            return;
        }
        lastRotation = rotation;
        if (overlay == null) {
            return;
        }
        // Drop saved x/y so the panel is not left off-screen after a 90° turn.
        params = null;
        if (compact) {
            showCompact();
        } else {
            showExpanded();
        }
    }

    private void ensureParams(int width, int height) {
        if (params == null) {
            params = new WindowManager.LayoutParams(
                width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                    | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.START;
            params.x = dp(12);
            params.y = dp(88);
        } else {
            params.width = width;
            params.height = height;
        }
    }

    private void attachDrag(View handle) {
        handle.setOnTouchListener(new View.OnTouchListener() {
            private int startX;
            private int startY;
            private float downX;
            private float downY;
            private boolean moved;

            @Override
            public boolean onTouch(View view, MotionEvent event) {
                if (params == null) return false;
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = params.x;
                        startY = params.y;
                        downX = event.getRawX();
                        downY = event.getRawY();
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = Math.round(event.getRawX() - downX);
                        int dy = Math.round(event.getRawY() - downY);
                        moved |= Math.abs(dx) > dp(4) || Math.abs(dy) > dp(4);
                        params.x = Math.max(0, startX + dx);
                        params.y = Math.max(0, startY + dy);
                        try {
                            windowManager.updateViewLayout(overlay, params);
                        } catch (RuntimeException ignored) {
                            // The window can go away mid-drag; the next gesture recovers.
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (!moved) view.performClick();
                        return true;
                    default:
                        return false;
                }
            }
        });
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Menu Auto Fishing", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Giữ menu điều khiển nổi hoạt động ổn định.");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_OPEN_SETTINGS, true);
        PendingIntent content = PendingIntent.getActivity(this, 20, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Menu điều khiển đang hoạt động")
            .setContentIntent(content)
            .setOngoing(true)
            .build();
    }

    // ══════════════════════════════ View factories ══════════════════════════════

    private Switch option(String text, boolean checked) {
        Switch view = new Switch(this);
        view.setText(text);
        view.setTextColor(TEXT_WHITE);
        view.setTextSize(12);
        view.setChecked(checked);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setMinHeight(dp(38));
        view.setPadding(dp(10), 0, dp(6), 0);
        view.setBackground(rounded(ROW, 11, Color.TRANSPARENT, 0));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(40));
        lp.topMargin = dp(5);
        view.setLayoutParams(lp);
        return view;
    }

    private LinearLayout horizontal() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private LinearLayout.LayoutParams weightedButtonParams() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(40), 1f);
        lp.setMargins(dp(2), dp(6), dp(2), 0);
        return lp;
    }

    private TextView label(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button actionButton(String value, int color) {
        Button view = new Button(this);
        view.setText(value);
        view.setTextSize(11);
        view.setTextColor(TEXT_WHITE);
        view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        view.setAllCaps(false);
        view.setPadding(dp(2), 0, dp(2), 0);
        view.setBackground(rounded(color, 11, Color.TRANSPARENT, 0));
        return view;
    }

    private Button smallButton(String value, int color) {
        Button view = actionButton(value, color);
        view.setTextSize(15);
        return view;
    }

    private GradientDrawable rounded(int fill, int radiusDp, int stroke, int strokeDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) shape.setStroke(dp(strokeDp), stroke);
        return shape;
    }

    private void addOverlaySafely() {
        try {
            windowManager.addView(overlay, params);
        } catch (RuntimeException error) {
            overlay = null;
            Toast.makeText(this, "Không mở được menu nổi.", Toast.LENGTH_LONG).show();
            stopSelf();
        }
    }

    private void removeOverlay() {
        if (overlay == null || windowManager == null) return;
        try {
            windowManager.removeView(overlay);
        } catch (RuntimeException ignored) {
            // Already detached.
        }
        overlay = null;
        status = null;
        shadowLabel = null;
        tierChips = null;
        noFilterChip = null;
        modeChip = null;
        sellChips = null;
        sellHint = null;
        statsLabel = null;
        masterToggle = null;
        pause = null;
        variantChip = null;
        for (int index = 0; index < tabPages.length; index++) {
            tabPages[index] = null;
            tabButtons[index] = null;
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(statusUpdater);
        if (displayManager != null) {
            displayManager.unregisterDisplayListener(displayListener);
        }
        removeOverlay();
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
