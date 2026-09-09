package com.pthelper.autofishing;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    public static final String EXTRA_OPEN_SETTINGS = "open_settings";
    public static final String EXTRA_REQUEST_CAPTURE = "request_capture";
    private static final int REQUEST_CAPTURE = 2001;
    private static final int REQUEST_NOTIFICATIONS = 2002;
    private static final String VERSION_LABEL = "v5.8.8 • Check cuối";
    private static final long STATUS_INTERVAL_MS = 900L;
    private static final long FADE_MS = 140L;

    // --- Palette ---
    private static final int BG_DARK      = Color.rgb(14, 16, 21);
    private static final int CARD_BG      = Color.rgb(23, 26, 34);
    private static final int ROW_BG       = Color.rgb(35, 40, 51);
    private static final int ACCENT       = Color.rgb(0, 200, 120);
    private static final int ACCENT_INK   = Color.rgb(6, 18, 12);
    private static final int TEXT_PRIMARY = Color.rgb(231, 234, 240);
    private static final int TEXT_MUTED   = Color.rgb(131, 138, 155);
    private static final int DANGER       = Color.rgb(226, 75, 75);
    private static final int WARN         = Color.rgb(255, 180, 84);
    private static final int SHIELD_GREEN = Color.rgb(50, 205, 100);
    private static final int BORDER       = Color.rgb(44, 50, 63);
    private static final int INPUT_BG     = Color.rgb(29, 33, 42);

    private Switch autoRepair;
    private Switch autoSell;
    private Switch autoStore;
    private Switch autoReturn;
    private Button[] tierButtons;
    private Button noFilterButton;
    private Button fishModeButton;
    private Button bugModeButton;
    private TextView modeHint;
    private Button[] sellModeButtons;
    private TextView sellModeTitle;
    private TextView sellModeHint;
    private EditText sellGridColumns;
    private EditText sellGridRows;
    private Switch bugPatrol;
    private EditText bugIdleSeconds;
    private TextView tierHint;
    private TextView calibrationHint;
    private boolean pendingStart;
    private ConfigStore config;
    private TextView counterView;
    private TextView statsView;
    private EditText shadowScale;
    private EditText stopBatteryPercent;
    private EditText watchdogMinutes;
    private EditText maximumRetries;
    private MediaProjectionManager projectionManager;
    private EditText repairEvery;
    private EditText sensitivity;
    private TextView statusView;
    private Button globalButton;
    private Button vngButton;
    private TextView variantHint;
    private Switch overlayMenu;
    private boolean overlayPermissionRequested;
    private boolean pendingOverlayEnable;
    private boolean applyingOverlaySwitch;
    private boolean pendingArmCapture;
    private boolean startupCompleted;
    private boolean firstRunSetup;
    private String lastRenderedStatus;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable statusUpdater = new Runnable() {
        @Override
        public void run() {
            MainActivity.this.renderRuntimeStatus();
            MainActivity.this.handler.postDelayed(this, STATUS_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        this.config = new ConfigStore(this);
        this.firstRunSetup = !this.config.gameVariantChosen();
        if (this.firstRunSetup) {
            this.config.saveGameVariant(GameVariant.firstInstalled(this, GameVariant.GLOBAL));
        }
        this.projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        setContentView(buildContent());
        requestNotificationPermissionIfNeeded();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderVariant();
        renderMode();
        renderSellMode();
        renderTiers();
        renderCalibrationHint();
        resumeOverlayMenu();
        this.handler.removeCallbacks(this.statusUpdater);
        this.handler.post(this.statusUpdater);
        if (this.pendingStart) {
            this.handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.resumePendingStart();
                }
            }, 350L);
            return;
        }
        if (!this.startupCompleted) {
            this.handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.startMenuAndGameWhenReady();
                }
            }, 450L);
        }
    }

    @Override
    protected void onPause() {
        this.handler.removeCallbacks(this.statusUpdater);
        super.onPause();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            this.pendingArmCapture = false;
            Toast.makeText(this, "Bạn chưa cấp quyền chụp màn hình. Chưa thể chạy.", Toast.LENGTH_LONG).show();
            return;
        }
        if (!saveOptions()) {
            this.pendingArmCapture = false;
            return;
        }
        boolean armOnly = this.pendingArmCapture;
        this.pendingArmCapture = false;
        Intent service = new Intent(this, FishingService.class)
            .setAction(armOnly ? FishingService.ACTION_ARM : FishingService.ACTION_START)
            .putExtra(FishingService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(FishingService.EXTRA_RESULT_DATA, data);
        try {
            startForegroundService(service);
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không khởi động được dịch vụ tự động.", Toast.LENGTH_LONG).show();
            return;
        }
        Toast.makeText(this, armOnly
            ? "Đã sẵn sàng. Vào game, mở cửa sổ LN, bấm Bắt đầu."
            : "Đã nhận quyền. Quay lại game anh đang mở — macro chạy trên màn hình đó.", Toast.LENGTH_LONG).show();
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(EXTRA_REQUEST_CAPTURE, false)) {
            this.startupCompleted = true;
            intent.removeExtra(EXTRA_REQUEST_CAPTURE);
            this.handler.post(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.requestStart();
                }
            });
        } else if (intent.getBooleanExtra(EXTRA_OPEN_SETTINGS, false)) {
            this.startupCompleted = true;
            intent.removeExtra(EXTRA_OPEN_SETTINGS);
        }
    }

    private void startMenuAndGameWhenReady() {
        if (this.startupCompleted || isFinishing()) return;
        this.startupCompleted = true;
        if (this.config.overlayMenuEnabled()) {
            setOverlayMenuEnabled(true);
        }
    }

    private void resumeOverlayMenu() {
        syncOverlaySwitch(this.config.overlayMenuEnabled());
        if (this.pendingOverlayEnable && Settings.canDrawOverlays(this)) {
            this.pendingOverlayEnable = false;
            setOverlayMenuEnabled(true);
            return;
        }
        if (this.config.overlayMenuEnabled() && Settings.canDrawOverlays(this)) {
            startControlMenu();
        }
    }

    private void setOverlayMenuEnabled(boolean enabled) {
        if (enabled && !Settings.canDrawOverlays(this)) {
            this.pendingOverlayEnable = true;
            this.config.saveOverlayMenuEnabled(true);
            syncOverlaySwitch(true);
            Toast.makeText(this, "Cấp quyền cửa sổ nổi rồi quay lại — menu sẽ hiện.", Toast.LENGTH_LONG).show();
            requestOverlayPermission();
            return;
        }
        this.pendingOverlayEnable = false;
        this.config.saveOverlayMenuEnabled(enabled);
        syncOverlaySwitch(enabled);
        if (enabled) {
            startControlMenu();
            requestCaptureForArm();
        } else {
            stopControlMenu();
        }
    }

    private void syncOverlaySwitch(boolean enabled) {
        if (this.overlayMenu == null || this.overlayMenu.isChecked() == enabled) return;
        this.applyingOverlaySwitch = true;
        this.overlayMenu.setChecked(enabled);
        this.applyingOverlaySwitch = false;
    }

    private void requestCaptureForArm() {
        if (this.config.captureReady()) {
            return;
        }
        if (!isAccessibilityEnabled()) {
            this.pendingStart = true;
            Toast.makeText(this, "Bật Trợ năng LeafNote rồi quay lại để cấp ghi màn hình.", Toast.LENGTH_LONG).show();
            openAccessibilitySettings();
            return;
        }
        this.pendingArmCapture = true;
        try {
            Toast.makeText(this, "Cho ghi màn hình một lần. Xong vào game, mở LN, bấm Bắt đầu.", Toast.LENGTH_LONG).show();
            startActivityForResult(this.projectionManager.createScreenCaptureIntent(), REQUEST_CAPTURE);
        } catch (RuntimeException error) {
            this.pendingArmCapture = false;
            Toast.makeText(this, "Thiết bị không hỗ trợ ghi màn hình.", Toast.LENGTH_LONG).show();
        }
    }

    private void startControlMenu() {
        if (!Settings.canDrawOverlays(this)) return;
        try {
            startForegroundService(new Intent(this, ControlOverlayService.class)
                .setAction(ControlOverlayService.ACTION_SHOW));
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không thể mở menu nổi.", Toast.LENGTH_LONG).show();
        }
    }

    private void stopControlMenu() {
        try {
            startService(new Intent(this, ControlOverlayService.class)
                .setAction(ControlOverlayService.ACTION_HIDE));
        } catch (RuntimeException ignored) {
            stopService(new Intent(this, ControlOverlayService.class));
        }
    }

    private void launchGameAndBackground() {
        GameVariant variant = this.config.gameVariant();
        Intent launch = variant.launchIntent(this);
        if (launch == null) {
            Toast.makeText(this, "Chưa cài " + variant.label + " trên thiết bị.", Toast.LENGTH_LONG).show();
            return;
        }
        startActivity(launch);
    }

    // ══════════════════════════════ UI ══════════════════════════════

    private View buildContent() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(BG_DARK);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(14), dp(16), dp(14), dp(24));
        scrollView.addView(root, new FrameLayout.LayoutParams(-1, -2));

        root.addView(buildHeader());
        root.addView(buildOverlayCard());
        root.addView(buildVersionCard());
        root.addView(buildStatusCard());
        buildStatsSection(root);
        buildAutomationSection(root);
        buildShadowSection(root);
        buildSellSection(root);
        buildBugSection(root);
        buildGuardSection(root);
        buildCalibrationSection(root);
        buildPermissionSection(root);
        root.addView(buildControls());

        TextView warning = text("⚠ Bật menu nổi và cho ghi màn hình trong LeafNote trước. "
            + "Rồi vào game, mở LN, bấm Bắt đầu. Không tự mở Play Together.", 11, false, WARN);
        warning.setPadding(dp(6), dp(14), dp(6), 0);
        warning.setLineSpacing(dp(2), 1f);
        root.addView(warning);

        return scrollView;
    }

    private View buildHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(4), 0, dp(4), dp(14));

        TextView title = text("🎣 PT AUTO FISHING", 23, true, TEXT_PRIMARY);
        header.addView(title);

        TextView badge = text(VERSION_LABEL, 11, true, SHIELD_GREEN);
        badge.setPadding(dp(10), dp(4), dp(10), dp(5));
        badge.setBackground(fill(Color.rgb(18, 46, 32), 10));
        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(-2, -2);
        badgeParams.topMargin = dp(8);
        header.addView(badge, badgeParams);

        TextView subtitle = text("Tự câu • Bảo quản • Sửa cần • Bán cá • Tự phục hồi", 12, false, TEXT_MUTED);
        subtitle.setPadding(0, dp(8), 0, 0);
        header.addView(subtitle);

        return header;
    }

    private View buildOverlayCard() {
        LinearLayout card = card();
        card.addView(cardTitle("🪟 MENU NỔI TRONG GAME"));

        TextView help = text("Bật công tắc → cho ghi màn hình trong LeafNote. Vào game, chạm nút tròn LN để mở menu, "
            + "bấm Bắt đầu. Nút ─ hoặc ✕ chỉ thu nhỏ — không cần thoát game.",
            11, false, TEXT_MUTED);
        help.setPadding(dp(4), dp(6), dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        card.addView(help);

        this.overlayMenu = styledSwitch("🪟 Bật menu nổi", this.config.overlayMenuEnabled());
        this.overlayMenu.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.CompoundButton button, boolean checked) {
                if (MainActivity.this.applyingOverlaySwitch) return;
                MainActivity.this.setOverlayMenuEnabled(checked);
            }
        });
        card.addView(this.overlayMenu);
        return card;
    }

    private View buildVersionCard() {
        LinearLayout card = card();
        card.addView(cardTitle("🎮 PHIÊN BẢN GAME"));

        LinearLayout segmented = new LinearLayout(this);
        segmented.setOrientation(LinearLayout.HORIZONTAL);
        segmented.setBackground(fill(INPUT_BG, 14));
        segmented.setPadding(dp(4), dp(4), dp(4), dp(4));

        this.globalButton = segmentButton("GLOBAL");
        this.globalButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.selectVariant(GameVariant.GLOBAL);
            }
        });
        this.vngButton = segmentButton("VNG");
        this.vngButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.selectVariant(GameVariant.VNG);
            }
        });
        segmented.addView(this.globalButton, new LinearLayout.LayoutParams(0, dp(44), 1f));
        segmented.addView(this.vngButton, new LinearLayout.LayoutParams(0, dp(44), 1f));

        LinearLayout.LayoutParams segmentedParams = new LinearLayout.LayoutParams(-1, -2);
        segmentedParams.topMargin = dp(6);
        card.addView(segmented, segmentedParams);

        this.variantHint = text("", 11, false, TEXT_MUTED);
        this.variantHint.setPadding(dp(4), dp(8), dp(4), 0);
        card.addView(this.variantHint);

        TextView modeTitle = text("CHẾ ĐỘ", 11, true, TEXT_MUTED);
        modeTitle.setPadding(dp(4), dp(14), dp(4), 0);
        card.addView(modeTitle);

        LinearLayout modes = new LinearLayout(this);
        modes.setOrientation(LinearLayout.HORIZONTAL);
        modes.setBackground(fill(INPUT_BG, 14));
        modes.setPadding(dp(4), dp(4), dp(4), dp(4));
        this.fishModeButton = segmentButton("🎣 Câu cá");
        this.fishModeButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.selectBugMode(false);
            }
        });
        this.bugModeButton = segmentButton("🦋 Bắt côn trùng");
        this.bugModeButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.selectBugMode(true);
            }
        });
        modes.addView(this.fishModeButton, new LinearLayout.LayoutParams(0, dp(44), 1f));
        modes.addView(this.bugModeButton, new LinearLayout.LayoutParams(0, dp(44), 1f));
        LinearLayout.LayoutParams modesParams = new LinearLayout.LayoutParams(-1, -2);
        modesParams.topMargin = dp(6);
        card.addView(modes, modesParams);

        this.modeHint = text("", 11, false, TEXT_MUTED);
        this.modeHint.setPadding(dp(4), dp(8), dp(4), 0);
        this.modeHint.setLineSpacing(dp(2), 1f);
        card.addView(this.modeHint);
        renderMode();

        return card;
    }

    private void selectBugMode(boolean bugs) {
        this.config.saveBugMode(bugs);
        renderMode();
        renderSellMode();
        if (!AutomationState.IDLE.name().equals(this.config.runtimeState())) {
            Toast.makeText(this, "Đổi chế độ sẽ áp dụng ở lần chạy tiếp theo.", Toast.LENGTH_LONG).show();
        }
    }

    private void renderMode() {
        if (this.fishModeButton == null) return;
        boolean bugs = this.config.bugMode();
        styleSegment(this.fishModeButton, !bugs);
        styleSegment(this.bugModeButton, bugs);
        this.modeHint.setText(bugs
            ? "Đứng ở chỗ có côn trùng, cầm vợt sẵn. Macro chờ nút Bắt sáng lên thì vung vợt, bảo quản, "
              + "đầy balo đem bán rồi quay lại; lâu không thấy thì đi loanh quanh tìm."
            : "Đứng ở chỗ câu, cầm cần sẵn. Macro tự dò nút Câu ở lần đầu.");
    }

    private void buildSellSection(LinearLayout root) {
        LinearLayout body = section(root, "💰 BÁN KHI ĐẦY BALO", true);
        TextView help = text("Cá bóng cao và côn trùng hiếm trong game có nền ô tím. "
            + "Bật “Giữ nền tím” thì macro bán hết con thường, bỏ qua ô tím.",
            11, false, TEXT_MUTED);
        help.setPadding(dp(4), 0, dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        body.addView(help);

        this.sellModeTitle = text("", 11, true, TEXT_MUTED);
        this.sellModeTitle.setPadding(dp(4), 0, dp(4), dp(4));
        body.addView(this.sellModeTitle);

        String[] labels = {"Bán hết", "Giữ nền tím"};
        LinearLayout segmented = new LinearLayout(this);
        segmented.setOrientation(LinearLayout.HORIZONTAL);
        segmented.setBackground(fill(ROW_BG, 12));
        segmented.setPadding(dp(4), dp(4), dp(4), dp(4));
        this.sellModeButtons = new Button[labels.length];
        for (int mode = 0; mode < labels.length; mode++) {
            final int chosen = mode;
            Button chip = segmentButton(labels[mode]);
            chip.setTextSize(12f);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    MainActivity.this.config.saveSellMode(MainActivity.this.config.bugMode(), chosen);
                    MainActivity.this.renderSellMode();
                }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(44), 1f);
            lp.setMargins(dp(2), 0, dp(2), 0);
            segmented.addView(chip, lp);
            this.sellModeButtons[mode] = chip;
        }
        body.addView(segmented);

        this.sellModeHint = text("", 11, true, SHIELD_GREEN);
        this.sellModeHint.setPadding(dp(4), dp(8), dp(4), 0);
        body.addView(this.sellModeHint);

        this.sellGridColumns = styledInput("Lưới balo: số ô mỗi hàng đang hiện (1–12)", this.config.sellGridColumns());
        this.sellGridRows = styledInput("Lưới balo: số hàng đang hiện (1–8)", this.config.sellGridRows());
        body.addView(this.sellGridColumns);
        body.addView(this.sellGridRows);

        TextView note = text("Bán chọn lọc cần hiệu chỉnh bước 3 (ô đầu, ô cuối, nút Bán trong chi tiết). "
            + "Bán hết thì không cần.", 11, false, WARN);
        note.setPadding(dp(4), dp(10), dp(4), 0);
        note.setLineSpacing(dp(2), 1f);
        body.addView(note);
        renderSellMode();
    }

    private void renderSellMode() {
        if (this.sellModeButtons == null) return;
        boolean bugs = this.config.bugMode();
        int mode = this.config.activeSellMode();
        this.sellModeTitle.setText(bugs ? "Đang chỉnh cho: 🦋 CÔN TRÙNG" : "Đang chỉnh cho: 🎣 CÁ");
        boolean keep = AutomationPolicy.keepPurpleEnabled(mode);
        styleSegment(this.sellModeButtons[0], !keep);
        styleSegment(this.sellModeButtons[1], keep);
        this.sellModeHint.setText((bugs ? "Côn trùng: " : "Cá: ") + AutomationPolicy.describeSellMode(mode));
    }

    private void buildBugSection(LinearLayout root) {
        LinearLayout body = section(root, "🦋 CÔN TRÙNG", false);
        TextView help = text("Chỉ dùng ở chế độ Bắt côn trùng. Côn trùng không tự đến như cá, nên lâu không "
            + "thấy thì macro đẩy joystick đi một bước ngẫu nhiên; đi 6 bước không thấy gì thì mở bản đồ về chỗ bắt.",
            11, false, TEXT_MUTED);
        help.setPadding(dp(4), 0, dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        body.addView(help);

        this.bugPatrol = styledSwitch("🧭 Đi loanh quanh tìm côn trùng", this.config.bugPatrol());
        body.addView(this.bugPatrol);
        this.bugIdleSeconds = styledInput("Chờ … giây không thấy thì đi tìm (5–120)", this.config.bugIdleSeconds());
        body.addView(this.bugIdleSeconds);

        TextView note = text("Cần hiệu chỉnh bước 4: tab Côn trùng, người mua, chỗ bắt, ô vợt, joystick. "
            + "Tự sửa vợt dùng chung công tắc “sửa cần / vợt” và ô vợt ở bước 4.", 11, false, WARN);
        note.setPadding(dp(4), dp(10), dp(4), 0);
        note.setLineSpacing(dp(2), 1f);
        body.addView(note);
    }

    private View buildStatusCard() {
        LinearLayout card = card();
        card.addView(cardTitle("📊 TRẠNG THÁI"));

        this.statusView = text(this.config.runtimeMessage(), 17, true, DANGER);
        this.statusView.setPadding(dp(4), dp(8), dp(4), dp(2));
        card.addView(this.statusView);

        this.counterView = text("Đã câu: " + this.config.runtimeCaught(), 13, false, TEXT_MUTED);
        this.counterView.setPadding(dp(4), 0, dp(4), dp(10));
        card.addView(this.counterView);

        card.addView(rowButton("📋  Xem nhật ký tự động", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.showRuntimeLog();
            }
        }));
        return card;
    }

    private void buildStatsSection(LinearLayout root) {
        LinearLayout body = section(root, "📈 THỐNG KÊ PHIÊN", true);
        this.statsView = text("", 12, false, TEXT_PRIMARY);
        this.statsView.setPadding(dp(10), dp(10), dp(10), dp(10));
        this.statsView.setLineSpacing(dp(4), 1f);
        this.statsView.setBackground(fill(ROW_BG, 12));
        this.statsView.setLayoutParams(stackedParams(dp(6)));
        body.addView(this.statsView);
        renderStats();

        body.addView(rowButton("🔄  Đặt lại bộ đếm phiên", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.config.startSessionStats(System.currentTimeMillis());
                MainActivity.this.renderStats();
                Toast.makeText(MainActivity.this, "Đã đặt lại bộ đếm phiên.", Toast.LENGTH_SHORT).show();
            }
        }));
    }

    private void buildAutomationSection(LinearLayout root) {
        LinearLayout body = section(root, "⚙ TỰ ĐỘNG", true);
        this.autoStore = styledSwitch("💾 Tự bấm Bảo quản sau khi câu", this.config.autoStore());
        this.autoRepair = styledSwitch("🔧 Tự mở balo và sửa cần / vợt", this.config.autoRepair());
        this.autoSell = styledSwitch("💰 Balo đầy thì tự bán", this.config.autoSell());
        this.autoReturn = styledSwitch("🧭 Bán xong tự tìm đường về chỗ cũ", this.config.autoReturn());
        body.addView(this.autoStore);
        body.addView(this.autoRepair);
        body.addView(this.autoSell);
        body.addView(this.autoReturn);

        TextView returnHelp = text("Sau khi bán, app đi bản đồ → điểm câu → trang bị lại cần, "
            + "rồi so ảnh màn hình để chắc chắn đã về đúng chỗ cũ. Chưa khớp thì tự đi lại.",
            11, false, TEXT_MUTED);
        returnHelp.setPadding(dp(4), dp(8), dp(4), 0);
        returnHelp.setLineSpacing(dp(2), 1f);
        body.addView(returnHelp);

        this.sensitivity = styledInput("Độ nhạy nhận diện cá cắn (8–100)", this.config.sensitivity());
        this.repairEvery = styledInput("Sửa cần / vợt sau mỗi số lần bắt (1–999)", this.config.repairEvery());
        this.maximumRetries = styledInput("Giới hạn thử lại mỗi trạng thái (1–8)", this.config.maximumRetries());
        body.addView(this.sensitivity);
        body.addView(this.repairEvery);
        body.addView(this.maximumRetries);
    }

    private void buildShadowSection(LinearLayout root) {
        LinearLayout body = section(root, "🐟 LỌC BÓNG CÁ", true);
        TextView help = text("Chọn cỡ bóng muốn giật (bóng 1 bé nhất → bóng 6 cá khổng lồ). "
            + "Bóng không được chọn sẽ bị thu cần thả lại trước khi cá cắn.",
            11, false, TEXT_MUTED);
        help.setPadding(dp(4), 0, dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        body.addView(help);

        LinearLayout chips = new LinearLayout(this);
        chips.setOrientation(LinearLayout.HORIZONTAL);
        chips.setBackground(fill(ROW_BG, 12));
        chips.setPadding(dp(4), dp(4), dp(4), dp(4));
        this.tierButtons = new Button[AutomationPolicy.SHADOW_TIERS];
        for (int tier = 1; tier <= AutomationPolicy.SHADOW_TIERS; tier++) {
            final int chosen = tier;
            Button chip = segmentButton(String.valueOf(tier));
            chip.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    MainActivity.this.config.saveShadowTiers(
                        AutomationPolicy.toggleTier(MainActivity.this.config.shadowTierMask(), chosen));
                    MainActivity.this.renderTiers();
                }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(40), 1f);
            lp.setMargins(dp(2), 0, dp(2), 0);
            chips.addView(chip, lp);
            this.tierButtons[tier - 1] = chip;
        }
        body.addView(chips);

        this.noFilterButton = rowButton("🚫  Không lọc — giật mọi con cá", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.config.saveShadowTiers(0);
                MainActivity.this.renderTiers();
            }
        });
        body.addView(this.noFilterButton);

        this.tierHint = text("", 11, true, SHIELD_GREEN);
        this.tierHint.setPadding(dp(4), dp(8), dp(4), 0);
        body.addView(this.tierHint);

        this.shadowScale = styledInput("Hệ số cỡ bóng % (100 = chuẩn; cá to bị xếp cỡ thấp → giảm)",
            this.config.shadowScalePercent());
        body.addView(this.shadowScale);

        TextView tune = text("Mẹo: mở Nhật ký, xem dòng “bóng cỡ N (dài x% màn hình)” sau vài con cá. "
            + "Nếu cỡ hiện lệch so với con cá nhìn thấy thì chỉnh hệ số ở trên.\n"
            + "Bóng cá được đo ở vùng “mặt nước quanh phao” — nếu phao nhà bạn lệch xa giữa màn hình, "
            + "kéo lại điểm này ở bước hiệu chỉnh 1.", 11, false, TEXT_MUTED);
        tune.setPadding(dp(4), dp(10), dp(4), 0);
        tune.setLineSpacing(dp(2), 1f);
        body.addView(tune);
        renderTiers();
    }

    private void renderTiers() {
        if (this.tierButtons == null) return;
        int mask = this.config.shadowTierMask();
        boolean active = AutomationPolicy.shadowFilterActive(mask);
        for (int tier = 1; tier <= this.tierButtons.length; tier++) {
            styleSegment(this.tierButtons[tier - 1], active && AutomationPolicy.tierAllowed(tier, mask));
        }
        this.noFilterButton.setAlpha(active ? 1f : 0.45f);
        this.tierHint.setText(active
            ? "🐟 Chỉ giật bóng " + AutomationPolicy.describeTiers(mask) + " — cỡ khác thả lại"
            : "Đang không lọc — giật mọi con cá cắn.");
        this.tierHint.setTextColor(active ? SHIELD_GREEN : TEXT_MUTED);
    }

    private void buildGuardSection(LinearLayout root) {
        LinearLayout body = section(root, "🔋 BẢO VỆ THIẾT BỊ", false);
        TextView help = text("Tự dừng khi pin cạn và tự phục hồi khi game bị kẹt, "
            + "để chạy lâu không phải trông máy.", 11, false, TEXT_MUTED);
        help.setPadding(dp(4), 0, dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        body.addView(help);

        this.stopBatteryPercent = styledInput("Dừng khi pin dưới … % (0 = tắt)", this.config.stopBatteryPercent());
        this.watchdogMinutes = styledInput("Tự phục hồi nếu … phút không có cá (0 = tắt)", this.config.watchdogMinutes());
        body.addView(this.stopBatteryPercent);
        body.addView(this.watchdogMinutes);
    }

    private void buildCalibrationSection(LinearLayout root) {
        LinearLayout body = section(root, "📐 HIỆU CHỈNH TỌA ĐỘ", false);
        this.calibrationHint = text("", 11, true, SHIELD_GREEN);
        this.calibrationHint.setPadding(dp(4), 0, dp(4), dp(6));
        this.calibrationHint.setLineSpacing(dp(2), 1f);
        body.addView(this.calibrationHint);
        renderCalibrationHint();

        TextView help = text("Chỉ cần hiệu chỉnh tay khi tự dò thất bại, hoặc để dùng sửa cần / bán cá "
            + "(các nút balo, cửa hàng, bản đồ). Kéo dấu + đến từng nút rồi bấm LƯU ĐIỂM.",
            11, false, TEXT_MUTED);
        help.setPadding(dp(4), 0, dp(4), dp(8));
        help.setLineSpacing(dp(2), 1f);
        body.addView(help);

        body.addView(rowButton("1.  Nút câu, Bảo quản và vùng nhận diện", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.startCalibration(CalibrationOverlayService.MODE_FISHING);
            }
        }));
        body.addView(rowButton("2.  Balo, sửa cần, bán cá và đường đi", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.startCalibration(CalibrationOverlayService.MODE_INVENTORY);
            }
        }));
        body.addView(rowButton("3.  Bán chọn lọc: ô đầu, ô cuối, nút Bán 1 con", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.startCalibration(CalibrationOverlayService.MODE_SELL);
            }
        }));
        body.addView(rowButton("4.  Côn trùng: tab, người mua, chỗ bắt, vợt, joystick", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.startCalibration(CalibrationOverlayService.MODE_BUGS);
            }
        }));
        body.addView(rowButton("🔄  Đặt lại & dò lại nút Câu ở lần chạy sau", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.confirmReset();
            }
        }));
    }

    private void renderCalibrationHint() {
        if (this.calibrationHint == null) return;
        if (this.config.actionConfirmed()) {
            this.calibrationHint.setText("✅ Nút Câu đã xác nhận trên máy này — bấm Bắt đầu là chạy.");
            this.calibrationHint.setTextColor(SHIELD_GREEN);
        } else {
            this.calibrationHint.setText("🔎 Tự nhận diện: lần Bắt đầu tới, macro sẽ tự dò nút Câu "
                + "(đứng sẵn ở chỗ câu, cầm cần). Xác nhận xong sau con cá đầu tiên.");
            this.calibrationHint.setTextColor(WARN);
        }
    }

    private void buildPermissionSection(LinearLayout root) {
        LinearLayout body = section(root, "🔑 QUYỀN BẮT BUỘC", false);
        body.addView(rowButton("Mở cài đặt quyền Trợ năng", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.openAccessibilitySettings();
            }
        }));
        body.addView(rowButton("Cấp quyền cửa sổ nổi", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.requestOverlayPermission();
            }
        }));
        body.addView(rowButton("📋 Mở lại cửa sổ menu nổi", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.setOverlayMenuEnabled(true);
            }
        }));
        body.addView(rowButton("🔋 Tắt tối ưu pin cho app (Oppo/ColorOS nên bật)", new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.requestIgnoreBatteryOptimization();
            }
        }));
        TextView note = text("Máy Oppo/Realme còn cần: Cài đặt → Pin → PT Auto Fishing → "
            + "cho phép chạy nền & tự khởi động, nếu không ColorOS sẽ tắt macro sau vài phút.",
            11, false, TEXT_MUTED);
        note.setPadding(dp(4), dp(8), dp(4), 0);
        note.setLineSpacing(dp(2), 1f);
        body.addView(note);
    }

    private void requestIgnoreBatteryOptimization() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException error) {
            try {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (RuntimeException ignored) {
                Toast.makeText(this, "Không mở được cài đặt pin.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private View buildControls() {
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setPadding(0, dp(4), 0, 0);

        LinearLayout primary = new LinearLayout(this);
        primary.setOrientation(LinearLayout.HORIZONTAL);
        Button start = controlButton("▶  BẮT ĐẦU", ACCENT, ACCENT_INK);
        start.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.requestStart();
            }
        });
        Button pause = controlButton("⏸  TẠM DỪNG", ROW_BG, TEXT_PRIMARY);
        pause.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.sendCommand(FishingService.ACTION_PAUSE);
            }
        });
        primary.addView(start, controlParams());
        primary.addView(pause, controlParams());
        wrapper.addView(primary);

        LinearLayout secondary = new LinearLayout(this);
        secondary.setOrientation(LinearLayout.HORIZONTAL);
        Button resume = controlButton("▶  TIẾP TỤC", ROW_BG, TEXT_PRIMARY);
        resume.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.sendCommand(FishingService.ACTION_RESUME);
            }
        });
        Button stop = controlButton("⛔  DỪNG KHẨN CẤP", DANGER, Color.WHITE);
        stop.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                MainActivity.this.sendCommand(FishingService.ACTION_STOP);
            }
        });
        secondary.addView(resume, controlParams());
        secondary.addView(stop, controlParams());
        wrapper.addView(secondary);

        return wrapper;
    }

    // ══════════════════════════ Actions ══════════════════════════

    private void selectVariant(GameVariant variant) {
        this.config.saveGameVariant(variant);
        renderVariant();
        if (!variant.isInstalled(this)) {
            Toast.makeText(this, "Chưa cài " + variant.label + " trên thiết bị.", Toast.LENGTH_LONG).show();
        } else if (!AutomationState.IDLE.name().equals(this.config.runtimeState())) {
            Toast.makeText(this, "Đổi phiên bản sẽ áp dụng ở lần chạy tiếp theo.", Toast.LENGTH_LONG).show();
        }
    }

    private void renderVariant() {
        if (this.globalButton == null || this.vngButton == null) return;
        GameVariant selected = this.config.gameVariant();
        styleSegment(this.globalButton, selected == GameVariant.GLOBAL);
        styleSegment(this.vngButton, selected == GameVariant.VNG);
        boolean installed = selected.isInstalled(this);
        this.variantHint.setText(selected.label + "  •  " + (installed ? "đã cài đặt" : "chưa cài đặt"));
        this.variantHint.setTextColor(installed ? TEXT_MUTED : WARN);
    }

    /**
     * One tap does the whole start-up. When a permission is missing the user is sent to the
     * right settings page and, on coming back, the start resumes from where it stopped
     * (see {@link #onResume}) — so the flow is Start → grant → Start continues, not
     * Start → grant → find the button again.
     */
    private void requestStart() {
        if (!isAccessibilityEnabled()) {
            this.pendingStart = true;
            Toast.makeText(this, "Bật Trợ năng LeafNote rồi quay lại.", Toast.LENGTH_LONG).show();
            openAccessibilitySettings();
            return;
        }
        this.pendingStart = false;
        if (!saveOptions()) {
            return;
        }
        if (this.config.captureReady()) {
            try {
                startForegroundService(new Intent(this, FishingService.class).setAction(FishingService.ACTION_START));
                Toast.makeText(this, "Đang chạy trên màn hình đang mở.", Toast.LENGTH_SHORT).show();
            } catch (RuntimeException error) {
                Toast.makeText(this, "Không khởi động được dịch vụ tự động.", Toast.LENGTH_LONG).show();
            }
            return;
        }
        try {
            Toast.makeText(this, "Cho ghi màn hình — rồi quay lại game anh đã mở. Macro không tự mở game.", Toast.LENGTH_SHORT).show();
            startActivityForResult(this.projectionManager.createScreenCaptureIntent(), REQUEST_CAPTURE);
        } catch (RuntimeException error) {
            Toast.makeText(this, "Thiết bị không hỗ trợ ghi màn hình.", Toast.LENGTH_LONG).show();
        }
    }

    /** Continues a start that was interrupted by a permission page, once that permission is in place. */
    private void resumePendingStart() {
        if (!this.pendingStart) return;
        boolean ready = isAccessibilityEnabled();
        if (!ready) {
            // The user came back without granting; stop nagging until they tap Start again.
            this.pendingStart = false;
            return;
        }
        this.startupCompleted = true;
        if (this.config.overlayMenuEnabled() && !this.config.captureReady()) {
            requestCaptureForArm();
            return;
        }
        requestStart();
    }

    private void showRuntimeLog() {
        TextView log = new TextView(this);
        log.setText(this.config.runtimeLog());
        log.setTextIsSelectable(true);
        log.setTextColor(TEXT_PRIMARY);
        log.setTextSize(12f);
        log.setBackgroundColor(BG_DARK);
        log.setPadding(dp(16), dp(12), dp(16), dp(12));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(log);
        new AlertDialog.Builder(this)
            .setTitle("Nhật ký tự động")
            .setView(scroll)
            .setPositiveButton("Đóng", null)
            .show();
    }

    private void startCalibration(String mode) {
        if (!Settings.canDrawOverlays(this)) {
            requestOverlayPermission();
            return;
        }
        if (!saveOptions()) {
            return;
        }
        startService(new Intent(this, CalibrationOverlayService.class)
            .putExtra(CalibrationOverlayService.EXTRA_MODE, mode));
    }

    private void sendCommand(String action) {
        startService(new Intent(this, FishingService.class).setAction(action));
    }

    /**
     * Validates every field before writing anything, so a rejected value can never leave
     * half of the settings persisted.
     */
    private boolean saveOptions() {
        Integer parsedSensitivity = parseNumber(this.sensitivity, 8, 100, "Độ nhạy phải từ 8 đến 100.");
        Integer parsedRepair = parseNumber(this.repairEvery, 1, 999, "Số lượt sửa phải từ 1 đến 999.");
        Integer parsedRetries = parseNumber(this.maximumRetries, 1, 8, "Giới hạn thử lại phải từ 1 đến 8.");
        Integer parsedBattery = parseNumber(this.stopBatteryPercent, 0, 50, "Mức pin phải từ 0 đến 50.");
        Integer parsedWatchdog = parseNumber(this.watchdogMinutes, 0, 120, "Watchdog phải từ 0 đến 120 phút.");
        Integer parsedShadow = parseNumber(this.shadowScale, 50, 200, "Hệ số cỡ bóng phải từ 50 đến 200.");
        Integer parsedCols = parseNumber(this.sellGridColumns, 1, 12, "Số ô mỗi hàng phải từ 1 đến 12.");
        Integer parsedRows = parseNumber(this.sellGridRows, 1, 8, "Số hàng phải từ 1 đến 8.");
        Integer parsedBugIdle = parseNumber(this.bugIdleSeconds, 5, 120, "Thời gian chờ côn trùng phải từ 5 đến 120 giây.");
        if (parsedSensitivity == null || parsedRepair == null || parsedRetries == null
                || parsedBattery == null || parsedWatchdog == null || parsedShadow == null
                || parsedCols == null || parsedRows == null || parsedBugIdle == null) {
            return false;
        }
        this.config.saveSellGrid(parsedCols, parsedRows);
        this.config.saveBugOptions(parsedBugIdle, this.bugPatrol.isChecked());
        this.config.saveOptions(this.autoStore.isChecked(), this.autoRepair.isChecked(), this.autoSell.isChecked(),
            parsedSensitivity, parsedRepair, parsedRetries);
        this.config.saveAdvancedOptions(this.autoReturn.isChecked(), parsedBattery, parsedWatchdog);
        this.config.saveShadowScale(parsedShadow);
        return true;
    }

    private Integer parseNumber(EditText input, int min, int max, String message) {
        try {
            int value = Integer.parseInt(input.getText().toString().trim());
            if (value < min || value > max) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException e) {
            input.setError(message);
            input.requestFocus();
            return null;
        }
    }

    private void confirmReset() {
        new AlertDialog.Builder(this)
            .setTitle("Đặt lại hiệu chỉnh?")
            .setMessage("Tất cả tọa độ sẽ trở về mặc định. Các tùy chọn khác được giữ nguyên.")
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Đặt lại", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    MainActivity.this.config.resetCalibration();
                    Toast.makeText(MainActivity.this, "Đã đặt lại tọa độ.", Toast.LENGTH_SHORT).show();
                }
            })
            .show();
    }

    private boolean isAccessibilityEnabled() {
        String expected = new ComponentName(this, AutomationAccessibilityService.class).flattenToString();
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) {
            return false;
        }
        for (String component : enabled.split(":")) {
            if (expected.equalsIgnoreCase(component)) {
                return true;
            }
        }
        return false;
    }

    private void openAccessibilitySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không mở được cài đặt Trợ năng.", Toast.LENGTH_LONG).show();
        }
    }

    private void requestOverlayPermission() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không mở được cài đặt cửa sổ nổi.", Toast.LENGTH_LONG).show();
        }
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQUEST_NOTIFICATIONS);
        }
    }

    private void renderRuntimeStatus() {
        if (this.statusView == null || this.counterView == null) {
            return;
        }
        // Elapsed time keeps moving even when the state text does not, so stats refresh first.
        renderStats();
        // The service flips this after the first real catch through a probed position.
        renderCalibrationHint();

        String state = this.config.runtimeState();
        String message = this.config.runtimeMessage();
        String rendered = state + '|' + message + '|' + this.config.runtimeCaught();
        if (rendered.equals(this.lastRenderedStatus)) {
            return;
        }
        this.lastRenderedStatus = rendered;

        this.statusView.setText(message);
        this.statusView.setTextColor(statusColor(state));
        this.counterView.setText("Đã câu: " + this.config.runtimeCaught());
    }

    private void renderStats() {
        if (this.statsView == null) {
            return;
        }
        long startedAt = this.config.sessionStartedAt();
        long elapsedMs = startedAt > 0 ? Math.max(0, System.currentTimeMillis() - startedAt) : 0;
        int sessionCaught = this.config.sessionCaught();
        int rate = AutomationPolicy.fishPerHour(sessionCaught, elapsedMs);
        this.statsView.setText(
            "🐟 Cá phiên này:  " + sessionCaught + "\n"
            + "📦 Tổng đã câu:  " + this.config.runtimeCaught() + "\n"
            + "🚫 Đã bỏ qua:  " + this.config.sessionSkipped() + "\n"
            + "💰 Lần bán cá:  " + this.config.sessionSold() + "\n"
            + "🔧 Lần sửa cần:  " + this.config.sessionRepaired() + "\n"
            + "⏱ Thời gian chạy:  " + formatDuration(elapsedMs) + "\n"
            + "⚡ Tốc độ:  " + (rate > 0 ? rate + " cá/giờ" : "đang tính…"));
    }

    private static String formatDuration(long millis) {
        long totalMinutes = millis / 60_000L;
        long hours = totalMinutes / 60;
        long minutes = totalMinutes % 60;
        return hours > 0 ? hours + "h " + minutes + "p" : minutes + " phút";
    }

    private static int statusColor(String state) {
        if (AutomationState.IDLE.name().equals(state) || AutomationState.ERROR.name().equals(state)) {
            return DANGER;
        }
        if (AutomationState.ARMED.name().equals(state)) {
            return SHIELD_GREEN;
        }
        if (AutomationState.PAUSED.name().equals(state)
                || AutomationState.MICRO_PAUSE.name().equals(state)
                || AutomationState.SESSION_BREAK.name().equals(state)
                || AutomationState.PROBING.name().equals(state)) {
            return WARN;
        }
        if (AutomationState.SESSION_EXPIRED.name().equals(state)
                || AutomationState.LOW_BATTERY.name().equals(state)) {
            return SHIELD_GREEN;
        }
        return ACCENT;
    }

    // ══════════════════════════ UI helpers ══════════════════════════

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(fill(CARD_BG, 16));
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(10);
        card.setLayoutParams(params);
        return card;
    }

    private TextView cardTitle(String value) {
        TextView title = text(value, 12, true, ACCENT);
        title.setPadding(dp(4), 0, 0, 0);
        return title;
    }

    /**
     * A card whose body can be folded away. Collapsed sections are {@code GONE}, so the
     * layout pass skips them entirely — noticeably cheaper on low-end hardware.
     */
    private LinearLayout section(LinearLayout parent, String title, boolean expanded) {
        LinearLayout card = card();
        parent.addView(card);

        final LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setVisibility(expanded ? View.VISIBLE : View.GONE);

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.setMinimumHeight(dp(30));

        TextView label = cardTitle(title);
        final TextView chevron = text(expanded ? "▾" : "▸", 13, true, TEXT_MUTED);
        head.addView(label, new LinearLayout.LayoutParams(0, -2, 1f));
        head.addView(chevron);
        head.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                boolean show = body.getVisibility() != View.VISIBLE;
                chevron.setText(show ? "▾" : "▸");
                if (show) {
                    // Fading alpha instead of animating height keeps this cheap: one extra
                    // layout pass rather than one per animation frame.
                    body.setAlpha(0f);
                    body.setVisibility(View.VISIBLE);
                    body.animate().alpha(1f).setDuration(FADE_MS).start();
                } else {
                    body.animate().alpha(0f).setDuration(FADE_MS).withEndAction(new Runnable() {
                        @Override
                        public void run() {
                            body.setVisibility(View.GONE);
                        }
                    }).start();
                }
            }
        });

        card.addView(head);
        card.addView(body);
        return body;
    }

    private TextView text(String value, int sizeSp, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        return view;
    }

    private Switch styledSwitch(String label, boolean checked) {
        Switch view = new Switch(this);
        view.setText(label);
        view.setTextSize(13f);
        view.setTextColor(TEXT_PRIMARY);
        view.setChecked(checked);
        view.setMinHeight(dp(46));
        view.setPadding(dp(12), dp(4), dp(10), dp(4));
        view.setBackground(fill(ROW_BG, 12));
        view.setLayoutParams(stackedParams(dp(4)));
        return view;
    }

    private EditText styledInput(String hint, int value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setText(String.valueOf(value));
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        input.setMinHeight(dp(48));
        input.setTextColor(TEXT_PRIMARY);
        input.setHintTextColor(TEXT_MUTED);
        input.setTextSize(13f);
        input.setBackground(outlined(INPUT_BG, 12, BORDER, 1));
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        input.setLayoutParams(stackedParams(dp(4)));
        return input;
    }

    private Button rowButton(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13f);
        button.setTextColor(TEXT_PRIMARY);
        button.setMinHeight(dp(46));
        button.setBackground(fill(ROW_BG, 12));
        button.setOnClickListener(listener);
        button.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        button.setPadding(dp(12), dp(4), dp(12), dp(4));
        button.setLayoutParams(stackedParams(dp(4)));
        return button;
    }

    private Button segmentButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13f);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setPadding(0, 0, 0, 0);
        button.setGravity(Gravity.CENTER);
        return button;
    }

    private void styleSegment(Button button, boolean selected) {
        button.setBackground(selected ? fill(ACCENT, 11) : fill(Color.TRANSPARENT, 11));
        button.setTextColor(selected ? ACCENT_INK : TEXT_MUTED);
    }

    private Button controlButton(String label, int bgColor, int textColor) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(13f);
        button.setTextColor(textColor);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(fill(bgColor, 14));
        button.setPadding(0, 0, 0, 0);
        return button;
    }

    private LinearLayout.LayoutParams controlParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(52), 1f);
        params.setMargins(dp(3), dp(4), dp(3), 0);
        return params;
    }

    private LinearLayout.LayoutParams stackedParams(int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = topMargin;
        return params;
    }

    private GradientDrawable fill(int color, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radiusDp));
        return shape;
    }

    private GradientDrawable outlined(int color, int radiusDp, int strokeColor, int strokeDp) {
        GradientDrawable shape = fill(color, radiusDp);
        shape.setStroke(Math.max(1, dp(strokeDp)), strokeColor);
        return shape;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
