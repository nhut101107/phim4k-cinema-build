package com.pthelper.autofishing;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Point;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;

/* JADX INFO: loaded from: classes2.dex */
public final class CalibrationOverlayService extends Service {
    private static final long CALIBRATION_TIMEOUT_MS = 300000;
    public static final String EXTRA_MODE = "mode";
    public static final String MODE_FISHING = "fishing";
    public static final String MODE_INVENTORY = "inventory";
    public static final String MODE_SELL = "sell";
    public static final String MODE_BUGS = "bugs";
    private ConfigStore config;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private DraggableTextView label;
    private WindowManager.LayoutParams layoutParams;
    private LinearLayout overlay;
    private int stepIndex;
    private List<ConfigStore.PointSpec> steps;
    private WindowManager windowManager;

    @Override // android.app.Service
    public void onCreate() {
        super.onCreate();
        this.config = new ConfigStore(this);
        this.windowManager = (WindowManager) getSystemService(android.content.Context.WINDOW_SERVICE);
    }

    @Override // android.app.Service
    public int onStartCommand(Intent intent, int flags, int startId) {
        List<ConfigStore.PointSpec> list;
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Chưa có quyền cửa sổ nổi.", Toast.LENGTH_LONG).show();
            stopSelf();
            return START_NOT_STICKY;
        }
        String mode = intent == null ? MODE_FISHING : intent.getStringExtra(EXTRA_MODE);
        if (MODE_INVENTORY.equals(mode)) {
            list = ConfigStore.INVENTORY_AND_ROUTE_POINTS;
        } else if (MODE_SELL.equals(mode)) {
            list = ConfigStore.SELECTIVE_SELL_POINTS;
        } else if (MODE_BUGS.equals(mode)) {
            list = ConfigStore.BUG_POINTS;
        } else {
            list = ConfigStore.FISHING_POINTS;
        }
        this.steps = list;
        this.stepIndex = 0;
        showOverlay();
        this.handler.removeCallbacksAndMessages(null);
        this.handler.postDelayed(new Runnable() { // from class: com.pthelper.autofishing.CalibrationOverlayService$$ExternalSyntheticLambda3
            @Override // java.lang.Runnable
            public final void run() {
                CalibrationOverlayService.this.lambda$onStartCommand$0();
            }
        }, CALIBRATION_TIMEOUT_MS);
        return START_NOT_STICKY;
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$onStartCommand$0() {
        finishCalibration("Hiệu chỉnh hết thời gian và đã đóng.");
    }

    @Override // android.app.Service
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override // android.app.Service
    public void onDestroy() {
        this.handler.removeCallbacksAndMessages(null);
        if (this.overlay != null) {
            try {
                this.windowManager.removeView(this.overlay);
            } catch (RuntimeException e) {
            }
            this.overlay = null;
        }
        super.onDestroy();
    }

    private void showOverlay() {
        if (this.overlay != null) {
            try {
                this.windowManager.removeView(this.overlay);
            } catch (RuntimeException e) {
            }
        }
        this.overlay = new LinearLayout(this);
        this.overlay.setOrientation(LinearLayout.VERTICAL);
        this.overlay.setGravity(1);
        this.overlay.setPadding(dp(10), dp(8), dp(10), dp(8));
        GradientDrawable background = new GradientDrawable();
        background.setColor(-300932293);
        background.setCornerRadius(dp(14));
        background.setStroke(dp(2), -2937041);
        this.overlay.setBackground(background);
        DraggableTextView crosshair = new DraggableTextView(this);
        crosshair.setText("+");
        crosshair.setTextSize(34.0f);
        crosshair.setTextColor(-1);
        crosshair.setGravity(17);
        this.overlay.addView(crosshair, new LinearLayout.LayoutParams(dp(64), dp(56)));
        this.label = new DraggableTextView(this);
        this.label.setTextColor(-1);
        this.label.setTextSize(12.0f);
        this.label.setGravity(17);
        this.label.setMaxLines(3);
        this.overlay.addView(this.label, new LinearLayout.LayoutParams(dp(210), -2));
        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(17);
        Button save = new Button(this);
        save.setText("LƯU ĐIỂM");
        Button cancel = new Button(this);
        cancel.setText("HỦY");
        buttons.addView(save, new LinearLayout.LayoutParams(0, dp(48), 1.0f));
        buttons.addView(cancel, new LinearLayout.LayoutParams(0, dp(48), 1.0f));
        this.overlay.addView(buttons, new LinearLayout.LayoutParams(dp(220), dp(52)));
        this.layoutParams = new WindowManager.LayoutParams(dp(240), -2, 2038, 520, -3);
        this.layoutParams.gravity = android.view.Gravity.TOP | android.view.Gravity.START;
        this.windowManager.addView(this.overlay, this.layoutParams);
        View.OnTouchListener drag = new DragListener();
        crosshair.setOnTouchListener(drag);
        this.label.setOnTouchListener(drag);
        save.setOnClickListener(new View.OnClickListener() { // from class: com.pthelper.autofishing.CalibrationOverlayService$$ExternalSyntheticLambda0
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                CalibrationOverlayService.this.lambda$showOverlay$1(view);
            }
        });
        cancel.setOnClickListener(new View.OnClickListener() { // from class: com.pthelper.autofishing.CalibrationOverlayService$$ExternalSyntheticLambda1
            @Override // android.view.View.OnClickListener
            public final void onClick(View view) {
                CalibrationOverlayService.this.lambda$showOverlay$2(view);
            }
        });
        updateStep();
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$showOverlay$1(View view) {
        saveCurrentPoint();
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$showOverlay$2(View view) {
        finishCalibration("Đã hủy hiệu chỉnh.");
    }

    private void updateStep() {
        if (this.steps == null || this.stepIndex >= this.steps.size()) {
            finishCalibration("Đã lưu toàn bộ điểm hiệu chỉnh.");
            return;
        }
        final ConfigStore.PointSpec spec = this.steps.get(this.stepIndex);
        this.label.setText((this.stepIndex + 1) + "/" + this.steps.size() + " • " + spec.label + "\nKéo dấu + đến đúng vị trí rồi bấm LƯU ĐIỂM");
        this.overlay.post(new Runnable() { // from class: com.pthelper.autofishing.CalibrationOverlayService$$ExternalSyntheticLambda2
            @Override // java.lang.Runnable
            public final void run() {
                CalibrationOverlayService.this.lambda$updateStep$3(spec);
            }
        });
    }

    /* JADX INFO: Access modifiers changed from: private */
    public /* synthetic */ void lambda$updateStep$3(ConfigStore.PointSpec spec) {
        Point screen = screenSize();
        Point current = this.config.getPoint(spec, screen.x, screen.y);
        this.layoutParams.x = AutomationPolicy.clampInt(current.x - (this.overlay.getWidth() / 2), 0, Math.max(0, screen.x - this.overlay.getWidth()));
        this.layoutParams.y = AutomationPolicy.clampInt(current.y - dp(28), 0, Math.max(0, screen.y - this.overlay.getHeight()));
        this.windowManager.updateViewLayout(this.overlay, this.layoutParams);
    }

    private void saveCurrentPoint() {
        Point screen = screenSize();
        int centerX = this.layoutParams.x + (this.overlay.getWidth() / 2);
        int centerY = this.layoutParams.y + dp(28);
        this.config.savePoint(this.steps.get(this.stepIndex), centerX, centerY, screen.x, screen.y);
        this.stepIndex++;
        updateStep();
    }

    private void finishCalibration(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        stopSelf();
    }

    private void launchGame() {
        GameVariant variant = this.config.gameVariant();
        Intent launch = variant.launchIntent(this);
        if (launch != null) {
            startActivity(launch);
        } else {
            Toast.makeText(this, "Không tìm thấy " + variant.label + " để mở.", Toast.LENGTH_LONG).show();
        }
    }

    /* JADX INFO: Access modifiers changed from: private */
    public Point screenSize() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        return new Point(Math.max(1, metrics.widthPixels), Math.max(1, metrics.heightPixels));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class DragListener implements View.OnTouchListener {
        private float downX;
        private float downY;
        private int startX;
        private int startY;

        private DragListener() {
        }

        @Override // android.view.View.OnTouchListener
        public boolean onTouch(View view, MotionEvent event) {
            if (event.getActionMasked() == 0) {
                this.downX = event.getRawX();
                this.downY = event.getRawY();
                this.startX = CalibrationOverlayService.this.layoutParams.x;
                this.startY = CalibrationOverlayService.this.layoutParams.y;
                return true;
            }
            if (event.getActionMasked() != 2) {
                if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                    view.performClick();
                    return true;
                }
                return event.getActionMasked() == MotionEvent.ACTION_CANCEL;
            }
            Point screen = CalibrationOverlayService.this.screenSize();
            CalibrationOverlayService.this.layoutParams.x = AutomationPolicy.clampInt(this.startX + Math.round(event.getRawX() - this.downX), 0, Math.max(0, screen.x - CalibrationOverlayService.this.overlay.getWidth()));
            CalibrationOverlayService.this.layoutParams.y = AutomationPolicy.clampInt(this.startY + Math.round(event.getRawY() - this.downY), 0, Math.max(0, screen.y - CalibrationOverlayService.this.overlay.getHeight()));
            CalibrationOverlayService.this.windowManager.updateViewLayout(CalibrationOverlayService.this.overlay, CalibrationOverlayService.this.layoutParams);
            return true;
        }
    }

    /** Lets accessibility services activate the same touch target used for dragging. */
    private static final class DraggableTextView extends TextView {
        private DraggableTextView(Context context) {
            super(context);
        }

        @Override
        public boolean performClick() {
            super.performClick();
            return true;
        }
    }
}
