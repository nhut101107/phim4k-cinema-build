package com.pthelper.autofishing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public final class FishingService extends Service {
    public static final String ACTION_PAUSE = "com.pthelper.autofishing.PAUSE";
    public static final String ACTION_RESUME = "com.pthelper.autofishing.RESUME";
    public static final String ACTION_START = "com.pthelper.autofishing.START";
    public static final String ACTION_STOP = "com.pthelper.autofishing.STOP";
    public static final String ACTION_ARM = "com.pthelper.autofishing.ARM";
    public static final String ACTION_RELEASE = "com.pthelper.autofishing.RELEASE";
    public static final String EXTRA_RESULT_CODE = "projection_result_code";
    public static final String EXTRA_RESULT_DATA = "projection_result_data";
    private static final String EXTRA_STOP_REASON = "stop_reason";
    private static final long BITE_TIMEOUT_MS = 75000;
    private static final String CHANNEL_ID = "auto_fishing_runtime";
    private static final int NOTIFICATION_ID = 4107;
    private static final long TAP_TIMEOUT_MS = 2500;
    private static final long UI_SETTLE_MS = 1100;
    /** Wait after the game is already in front before the first gesture. */

    /**
     * Capture is mirrored into a downscaled buffer. Bite detection only compares average
     * colour over a small region, so full resolution buys nothing while costing ~9x the
     * memory bandwidth — the difference between smooth and unusable on a low-end phone.
     */
    private static final int CAPTURE_MAX_EDGE = 800;
    private static final long FRAME_INTERVAL_MS = 100;

    /**
     * How different the fishing screen may look after travelling back before we treat the
     * route as failed. Kept lenient because NPCs, weather and other players move around.
     */
    private static final double SPOT_TOLERANCE = 45.0;

    /** How much darker than the surrounding water a pixel must be to count as shadow. */
    private static final int SHADOW_CONTRAST = 18;
    /** Smaller dark blobs (in grid cells) are ripples or texture, not a fish. */
    private static final int SHADOW_PRESENCE_CELLS = 3;
    /** Consecutive sightings before the tier is judged (~0.7 s at the poll rate). */
    private static final int SHADOW_JUDGE_SAMPLES = 3;

    /**
     * Where the cast button tends to sit, as screen ratios, tried nearest-first around the
     * default when the position has never been confirmed. Covers 16:9 through 20:9 phones.
     */
    private static final float[] PROBE_X = {0.902f, 0.922f, 0.882f, 0.942f, 0.862f};
    private static final float[] PROBE_Y = {0.735f, 0.770f, 0.700f, 0.810f, 0.660f};
    /** Failed casts through an unconfirmed position before the next candidate is tried. */
    private static final int PROBE_RETRY_AFTER_FAILURES = 2;
    /** Upper bound on single-item sales per shop visit, in case the grid is misread. */
    private static final int MAX_SELECTIVE_SALES = 80;
    /** Empty patrol steps before travelling back to the calibrated bug spot. */
    private static final int BUG_PATROL_MAX_STEPS = 6;

    /** Outcome of one cast. A skip is intentional and must not count as a failure. */
    private enum CycleResult { CAUGHT, SKIPPED, FAILED }

    private int caught;
    private int sessionCaught;
    private int sold;
    private int repaired;
    private int skipped;
    /** Next probe candidate to try; advances across retries within one session. */
    private int probeCursor;
    private long lastProgressAt;
    /** Snapshot of the fishing screen taken just before leaving to sell. */
    private int[] spotFingerprint;
    /** Badge pixels before the current catch, used to reject static red event icons. */
    private int[] bagBadgeBaseline;
    /** Idle HUD captured immediately before casting; used to block hooks outside fishing. */
    private int[] castHudIdleBaseline;
    private Point castHudPoint;
    private int castHudRadius;
    private int castHudStep;
    private ConfigStore config;
    private int failures;
    private int recoveries;
    private ImageReader imageReader;
    private Handler main;
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private PowerManager.WakeLock wakeLock;
    private Handler worker;
    private HandlerThread workerThread;
    private Handler capture;
    private HandlerThread captureThread;
    private GameVariant variant = GameVariant.GLOBAL;

    /** Physical screen size, used for dispatching taps. */
    private int screenWidth;
    private int screenHeight;
    /** Downscaled capture size, used for all pixel analysis. */
    private int captureWidth;
    private int captureHeight;

    /**
     * Reused across frames and sized to the surface row stride, so it is at least
     * {@link #captureWidth} wide. Only guarded reads/writes touch it.
     */
    private Bitmap frameBuffer;
    private boolean frameReady;
    private long lastFrameCapturedAt;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private final Object frameLock = new Object();

    private long sessionStartedAt;

    @Override
    public void onCreate() {
        super.onCreate();
        this.config = new ConfigStore(this);
        this.variant = this.config.gameVariant();
        this.main = new Handler(getMainLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            pauseAutomation();
            return START_NOT_STICKY;
        }
        if (ACTION_RESUME.equals(action)) {
            resumeAutomation();
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            String reason = intent == null ? null : intent.getStringExtra(EXTRA_STOP_REASON);
            stopLoop(reason == null || reason.trim().isEmpty() ? "Đã dừng theo yêu cầu" : reason);
            return this.projection != null ? START_STICKY : START_NOT_STICKY;
        }
        if (ACTION_RELEASE.equals(action)) {
            this.running.set(false);
            this.config.saveCaptureReady(false);
            this.config.setRuntime(AutomationState.IDLE, "Đã tắt ghi màn hình", this.caught);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_ARM.equals(action)) {
            this.variant = this.config.gameVariant();
            startForeground(NOTIFICATION_ID, buildNotification("Sẵn sàng — vào game bấm Bắt đầu"));
            if (this.projection == null && !startProjection(intent)) {
                stopWithError("Không thể khởi tạo quyền ghi màn hình");
                return START_NOT_STICKY;
            }
            this.config.saveCaptureReady(true);
            setState(AutomationState.ARMED, "Sẵn sàng — vào game rồi bấm Bắt đầu");
            return START_STICKY;
        }
        if (ACTION_START.equals(action)) {
            this.variant = this.config.gameVariant();
            startForeground(NOTIFICATION_ID, buildNotification("Đang khởi tạo"));
            if (this.projection == null && !startProjection(intent)) {
                this.config.saveCaptureReady(false);
                stopWithError("Chưa cấp ghi màn hình. Vào LeafNote bật menu nổi và cho phép một lần.");
                return START_NOT_STICKY;
            }
            if (!ensureCaptureSurface()) {
                stopWithError("Không tạo được bề mặt ghi màn hình. Xoay ngang máy rồi bấm Bắt đầu lại.");
                return START_STICKY;
            }
            startAutomation();
            return START_STICKY;
        }
        if (!this.running.get() && this.projection == null) {
            stopSelf();
        }
        return this.projection != null ? START_STICKY : START_NOT_STICKY;
    }

    public static void requestEmergencyStop(Context context, String reason) {
        Intent intent = new Intent(context, FishingService.class)
            .setAction(ACTION_STOP)
            .putExtra(EXTRA_STOP_REASON, reason);
        try {
            context.startService(intent);
        } catch (RuntimeException ignored) {
            // Android may reject a background service start after accessibility is interrupted.
            // Stopping an existing service is still safe and prevents the accessibility process
            // from crashing while handling the interruption.
            context.stopService(intent);
        }
    }

    /** Holds the MediaProjection token only. The virtual display is created later at START
     *  so size/rotation match the game (landscape), not LeafNote (portrait). */
    private boolean startProjection(Intent intent) {
        if (this.projection != null) {
            return true;
        }
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent data;
        if (Build.VERSION.SDK_INT >= 33) {
            data = intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        } else {
            data = intent.getParcelableExtra(EXTRA_RESULT_DATA);
        }
        if (resultCode != android.app.Activity.RESULT_OK || data == null) {
            return false;
        }
        MediaProjectionManager projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        this.projection = projectionManager.getMediaProjection(resultCode, data);
        if (this.projection == null) {
            return false;
        }
        this.projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                FishingService.this.config.saveCaptureReady(false);
                if (FishingService.this.running.get()) {
                    FishingService.this.stopWithError("Quyền ghi màn hình đã bị thu hồi");
                }
            }
        }, this.main);
        return true;
    }

    private void ensureCaptureThread() {
        if (this.captureThread != null) {
            return;
        }
        this.captureThread = new HandlerThread("fishing-capture");
        this.captureThread.start();
        this.capture = new Handler(this.captureThread.getLooper());
    }

    private void releaseCaptureSurface() {
        if (this.virtualDisplay != null) {
            this.virtualDisplay.release();
            this.virtualDisplay = null;
        }
        if (this.imageReader != null) {
            this.imageReader.close();
            this.imageReader = null;
        }
        synchronized (this.frameLock) {
            recycleFrameBufferLocked();
            this.frameReady = false;
        }
    }

    /** Build or rebuild the capture surface using the display as it is now (usually landscape). */
    private boolean ensureCaptureSurface() {
        if (this.projection == null) {
            return false;
        }
        int previousWidth = this.screenWidth;
        int previousHeight = this.screenHeight;
        measureScreen();
        if (this.virtualDisplay != null && this.imageReader != null
                && this.screenWidth == previousWidth && this.screenHeight == previousHeight) {
            return true;
        }
        releaseCaptureSurface();
        measureScreen();
        ensureCaptureThread();
        this.imageReader = ImageReader.newInstance(this.captureWidth, this.captureHeight, android.graphics.PixelFormat.RGBA_8888, 2);
        this.imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override
            public void onImageAvailable(ImageReader reader) {
                FishingService.this.consumeFrame(reader);
            }
        }, this.capture);
        int captureDpi = Math.max(1, Math.round(getResources().getDisplayMetrics().densityDpi
            * (this.captureWidth / (float) Math.max(1, this.screenWidth))));
        this.virtualDisplay = this.projection.createVirtualDisplay("PT-AutoFishing-Capture",
            this.captureWidth, this.captureHeight, captureDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            this.imageReader.getSurface(), null, this.capture);
        if (this.virtualDisplay == null) {
            return false;
        }
        this.config.appendLog("Ghi màn hình " + this.screenWidth + "x" + this.screenHeight
            + " → phân tích " + this.captureWidth + "x" + this.captureHeight);
        return true;
    }

    private void measureScreen() {
        WindowManager manager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (Build.VERSION.SDK_INT >= 30) {
            // Maximum metrics are the real display, not the tiny grant-activity window.
            Rect bounds = manager.getMaximumWindowMetrics().getBounds();
            this.screenWidth = bounds.width();
            this.screenHeight = bounds.height();
        } else {
            DisplayMetrics metrics = new DisplayMetrics();
            manager.getDefaultDisplay().getRealMetrics(metrics);
            this.screenWidth = metrics.widthPixels;
            this.screenHeight = metrics.heightPixels;
        }
        this.screenWidth = Math.max(1, this.screenWidth);
        this.screenHeight = Math.max(1, this.screenHeight);

        int longestEdge = Math.max(this.screenWidth, this.screenHeight);
        float scale = longestEdge > CAPTURE_MAX_EDGE ? CAPTURE_MAX_EDGE / (float) longestEdge : 1f;
        // Even dimensions keep the encoder/scaler on its fast path.
        this.captureWidth = Math.max(2, (Math.round(this.screenWidth * scale) / 2) * 2);
        this.captureHeight = Math.max(2, (Math.round(this.screenHeight * scale) / 2) * 2);
    }

    private void consumeFrame(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                return;
            }
            long now = SystemClock.elapsedRealtime();
            if (now - this.lastFrameCapturedAt < FRAME_INTERVAL_MS) {
                return;
            }
            Image.Plane plane = image.getPlanes()[0];
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            if (pixelStride <= 0 || rowStride <= 0) {
                return;
            }
            int bufferWidth = Math.max(this.captureWidth, rowStride / pixelStride);
            ByteBuffer buffer = plane.getBuffer();
            buffer.rewind();
            synchronized (this.frameLock) {
                if (this.frameBuffer == null || this.frameBuffer.isRecycled()
                        || this.frameBuffer.getWidth() != bufferWidth
                        || this.frameBuffer.getHeight() != this.captureHeight) {
                    recycleFrameBufferLocked();
                    this.frameBuffer = Bitmap.createBitmap(bufferWidth, this.captureHeight, Bitmap.Config.ARGB_8888);
                }
                this.frameBuffer.copyPixelsFromBuffer(buffer);
                this.lastFrameCapturedAt = now;
                this.frameReady = true;
            }
        } catch (OutOfMemoryError error) {
            this.config.appendLog("Thiếu bộ nhớ khi đọc khung hình; đã bỏ qua khung này");
            synchronized (this.frameLock) {
                recycleFrameBufferLocked();
                this.frameReady = false;
            }
        } catch (RuntimeException ignored) {
            // A dropped frame is recoverable; the next one arrives in FRAME_INTERVAL_MS.
        } finally {
            if (image != null) {
                image.close();
            }
        }
    }

    private void recycleFrameBufferLocked() {
        if (this.frameBuffer != null && !this.frameBuffer.isRecycled()) {
            this.frameBuffer.recycle();
        }
        this.frameBuffer = null;
    }

    /**
     * Samples the live frame in place. Copying the whole bitmap first — as the previous
     * implementation did on every poll — allocated megabytes several times a second.
     */
    private int[] sampleSignature(Point center, int radius, int step) {
        synchronized (this.frameLock) {
            if (!this.frameReady) {
                return new int[0];
            }
            return ScreenAnalyzer.signature(this.frameBuffer, center, radius, step,
                this.captureWidth, this.captureHeight);
        }
    }

    private void startAutomation() {
        if (this.running.compareAndSet(false, true)) {
            if (this.workerThread != null) {
                this.workerThread.quitSafely();
                this.workerThread = null;
                this.worker = null;
            }
            this.paused.set(false);
            this.caught = this.config.runtimeCaught();
            this.failures = 0;
            this.recoveries = 0;
            this.sessionCaught = 0;
            this.sold = 0;
            this.repaired = 0;
            this.skipped = 0;
            this.probeCursor = 0;
            this.spotFingerprint = null;
            this.bagBadgeBaseline = null;
            this.sessionStartedAt = SystemClock.elapsedRealtime();
            this.lastProgressAt = this.sessionStartedAt;
            this.config.startSessionStats(System.currentTimeMillis());
            AntiDetection.resetSession();
            this.workerThread = new HandlerThread("fishing-state-machine");
            this.workerThread.start();
            this.worker = new Handler(this.workerThread.getLooper());
            acquireWakeLock();
            // ControlOverlayService is the single lightweight control surface.
            // Keeping capture and controls in separate services avoids duplicate overlays.
            this.worker.post(new Runnable() {
                @Override
                public void run() {
                    FishingService.this.runAutomationSupervised();
                }
            });
        }
    }

    /** Keeps the persisted menu state and the actual worker in sync after any unexpected exit. */
    private void runAutomationSupervised() {
        while (this.running.get()) {
            try {
                automationLoop();
            } catch (Throwable error) {
                this.config.appendLog("Luồng câu gặp lỗi " + error.getClass().getSimpleName()
                    + " — tự khởi động lại");
            }
            if (this.running.get()) {
                setState(AutomationState.RECOVERING, "Luồng câu bị ngắt — đang tự chạy lại");
                if (!waitActive(500L)) return;
            }
        }
    }

    private void automationLoop() {
        if (!ensureCaptureSurface()) {
            stopWithError("Không tạo được bề mặt ghi màn hình. Xoay ngang máy rồi bấm Bắt đầu lại.");
            return;
        }
        setState(AutomationState.PREPARING, "Chạy trên màn hình đang mở — không tự mở game");
        if (!waitForAccessibility(15000L)) {
            stopWithError("Chưa bật dịch vụ Trợ năng LeafNote");
            return;
        }
        collapseControlOverlay();
        this.config.appendLog("Không mở Play Together. Anh mở game sẵn thì macro bấm ngay.");
        if (!waitActive(800L)) {
            return;
        }
        if (this.screenHeight > this.screenWidth) {
            this.config.appendLog("Máy còn dựng dọc — đợi xoay ngang rồi mới bấm");
            if (!waitActive(2500L) || !ensureCaptureSurface()) {
                return;
            }
        }
        if (this.screenHeight > this.screenWidth) {
            stopLoop("Xoay ngang máy rồi bấm Bắt đầu. Không bấm khi đang dựng dọc — sẽ rơi khỏi đảo.");
            return;
        }

        this.config.appendLog("🛡️ Anti (cố định): " + AntiDetection.HARD_MAX_SESSION_MINUTES
            + "p / " + AntiDetection.HARD_MAX_CATCHES + " con / miss "
            + AntiDetection.HARD_MISS_PERCENT + "%");

        if (this.config.bugMode()) {
            this.config.appendLog("🦋 Chế độ bắt côn trùng — " + AutomationPolicy.describeSellMode(this.config.bugSellMode())
                + (this.config.autoRepair() ? " • tự sửa vợt mỗi " + this.config.repairEvery() + " con" : ""));
            bugLoop();
            return;
        }
        // Never probe on the title/loading screen — a burst of taps there is what
        // the game flags as autoclick the moment you enter.
        while (this.running.get() && awaitResume()) {

            if (batteryGuardTripped()) {
                return;
            }

            if (AutomationPolicy.watchdogTripped(this.lastProgressAt, this.config.watchdogMinutes(),
                    SystemClock.elapsedRealtime())) {
                this.config.appendLog("⏱ Không câu được cá trong " + this.config.watchdogMinutes()
                    + " phút — tự phục hồi");
                // Re-arm before recovering, otherwise the watchdog trips again immediately.
                this.lastProgressAt = SystemClock.elapsedRealtime();
                if (!recoverToFishing("Watchdog: quá lâu không có cá")) {
                    return;
                }
            }

            if (!applyAntiGuards()) {
                return;
            }

            CycleResult result = fishingCycle();
            if (result == CycleResult.SKIPPED) {
                // Letting a fish go is a deliberate decision, not a malfunction, so it must
                // not feed the failure counter or it would trigger a pointless recovery.
                this.failures = 0;
                this.lastProgressAt = SystemClock.elapsedRealtime();
                continue;
            }

            boolean ok = result == CycleResult.CAUGHT;
            if (ok) {
                this.failures = 0;
                this.recoveries = 0;
                this.caught++;
                this.sessionCaught++;
                this.lastProgressAt = SystemClock.elapsedRealtime();
                saveStats();
                if (!this.config.actionConfirmed()) {
                    // A full catch is the strongest proof the probed position is the button.
                    this.config.markActionConfirmed(true);
                    this.config.appendLog("✅ Nút Câu đã xác nhận qua lần câu thật — lần sau chạy ngay, không dò lại");
                }
                if (this.config.autoRepair() && AutomationPolicy.repairDue(this.caught,
                        this.config.repairEvery(), this.config.lastRepairCaught())) {
                    ok = repairRod();
                }
                if (ok && this.config.autoSell() && this.config.sellingRouteCalibrated()) {
                    ok = checkBagAndMaybeSell();
                } else if (ok && this.config.autoSell()) {
                    this.config.appendLog("Chưa hiệu chỉnh đủ đường bán cá — bỏ qua tự bán để tiếp tục câu");
                }
                if (ok && !waitActive(AntiDetection.afterCatchRestMs())) {
                    return;
                }
            }
            if (!ok && this.running.get()) {
                this.failures++;
                if (!this.config.actionConfirmed() && this.failures >= PROBE_RETRY_AFTER_FAILURES) {
                    // The probed position reacted to a tap but never produced a catch, so it
                    // was probably a neighbouring button. Move on to the next candidate.
                    this.config.appendLog("🔎 Vị trí nút Câu vừa dò không câu được — dò vị trí khác");
                    this.failures = 0;
                    if (recoverToFishing("Dò lại nút Câu") && probeActionButton()) {
                        continue;
                    }
                    if (!this.running.get()) {
                        return;
                    }
                }
                if (!AutomationPolicy.mayRetry(this.failures, this.config.maximumRetries())) {
                    this.config.appendLog("Đã đủ số lần thử — làm mới bộ đếm và tiếp tục phục hồi");
                    this.failures = 0;
                    this.recoveries = 0;
                }
                if (!recoverToFishing("Lượt câu lỗi " + this.failures + "/" + this.config.maximumRetries())) {
                    return;
                }
            }
        }
    }

    private CycleResult fishingCycle() {
        captureBagBadgeBaseline();
        setState(AutomationState.CASTING, "Đang thả câu");
        if (!castLine()) {
            return CycleResult.FAILED;
        }
        long castFrameBoundary = SystemClock.elapsedRealtime();
        if (!waitActive(350L) || !waitForFrameAfter(castFrameBoundary, 1500L)) {
            this.config.appendLog("Chưa nhận được khung hình để so sánh");
            return CycleResult.FAILED;
        }
        Point biteIndicator = analysisPoint(ConfigStore.BITE_REGION);
        int indicatorRadius = biteIndicatorRadius();
        // Keep two-pixel sampling even after widening the search area. A radius-derived
        // three/four-pixel grid can skip the small dot or shorten the early stem enough to
        // miss the real cue on 16:9 captures.
        int indicatorStep = 2;
        int indicatorColumns = ScreenAnalyzer.gridColumns(
            biteIndicator, indicatorRadius, indicatorStep, this.captureWidth);
        int[] baseIndicator = sampleSignature(biteIndicator, indicatorRadius, indicatorStep);
        if (baseIndicator.length == 0) {
            this.config.appendLog("Chưa nhận được khung hình để so sánh");
            return CycleResult.FAILED;
        }

        boolean filterShadow = this.config.shadowFilterEnabled();
        Point water = filterShadow ? analysisPoint(ConfigStore.SHADOW_REGION) : null;
        int waterRadius = shadowRadius();
        int waterStep = Math.max(2, waterRadius / 12);
        int waterColumns = filterShadow
            ? ScreenAnalyzer.gridColumns(water, waterRadius, waterStep, this.captureWidth) : 1;
        double longestShadow = 0;
        int shadowSamples = 0;
        boolean shadowJudged = false;

        setState(AutomationState.WAITING_BITE, "Đang chờ cá cắn");
        long started = SystemClock.elapsedRealtime();
        while (this.running.get()
                && !AutomationPolicy.deadlineExpired(started, BITE_TIMEOUT_MS, SystemClock.elapsedRealtime())
                && awaitResume()
                && waitActive(AntiDetection.pollIntervalMs())) {

            // Judge the shadow before the bite arrives: once the "!" shows up, any tap hooks
            // the fish, so a late decision could no longer release it.
            if (filterShadow && !shadowJudged) {
                int cells = ScreenAnalyzer.shadowExtentCells(
                    sampleSignature(water, waterRadius, waterStep), waterColumns, SHADOW_CONTRAST);
                if (cells >= SHADOW_PRESENCE_CELLS) {
                    // Length as a fraction of screen height; the capture is scaled uniformly
                    // so the ratio is the same as on the real screen.
                    longestShadow = Math.max(longestShadow, cells * waterStep / (double) this.captureHeight);
                    // Several readings in a row, so a ripple or passing player is not
                    // mistaken for a fish, and the swimming shadow gets measured at full length.
                    if (++shadowSamples >= SHADOW_JUDGE_SAMPLES) {
                        shadowJudged = true;
                        int tier = AutomationPolicy.shadowTier(longestShadow, this.config.shadowScalePercent());
                        String size = "cỡ " + tier + " (dài " + Math.round(longestShadow * 100) + "% màn hình)";
                        if (!AutomationPolicy.tierAllowed(tier, this.config.shadowTierMask())) {
                            return releaseSmallFish(size);
                        }
                        this.config.appendLog("🎯 Giật: bóng " + size);
                    }
                } else {
                    shadowSamples = 0;
                }
            }

            int[] currentIndicator = sampleSignature(biteIndicator, indicatorRadius, indicatorStep);
            boolean indicatorBite = ScreenAnalyzer.biteCueAppeared(
                baseIndicator, currentIndicator, indicatorColumns);
            // IMG_8105: when the fishing state ended, both lower-right regions changed at
            // once and the old fallback tapped Jump. Hook only from the actual white "!".
            if (!indicatorBite) {
                continue;
            }
            if (!castStillActive()) {
                this.config.appendLog("Đã thấy hình giống dấu ! nhưng HUD câu không còn — chặn bấm nhầm");
                return CycleResult.FAILED;
            }
            setState(AutomationState.HOOKING, "Phát hiện cá cắn - đang giật cần");
            Point storePoint = analysisPoint(ConfigStore.STORE);
            int storeRadius = Math.max(10, Math.round(this.captureWidth * 0.045f));
            int storeStep = Math.max(2, storeRadius / 8);
            int[] storeBaseline = sampleSignature(storePoint, storeRadius, storeStep);
            if (!tapHook()) {
                return CycleResult.FAILED;
            }
            if (this.config.autoStore()) {
                if (!waitForStoreButton(storePoint, storeRadius, storeStep,
                        storeBaseline, 4200L)) {
                    this.config.appendLog("Không thấy nút Bảo quản sau khi giật — không bấm mù");
                    return CycleResult.FAILED;
                }
                setState(AutomationState.STORING, "Đang bấm Bảo quản");
                boolean stored = tap(ConfigStore.STORE) && waitActive(antiDelay(700L));
                return stored ? CycleResult.CAUGHT : CycleResult.FAILED;
            }
            return waitActive(antiDelay(900L)) ? CycleResult.CAUGHT : CycleResult.FAILED;
        }
        return CycleResult.FAILED;
    }

    private boolean hasBiteSignal(int[] baseline, int[] current, double changedRatio) {
        if (baseline.length == 0 || current.length == 0) return false;
        int sensitivity = this.config.sensitivity();
        return ScreenAnalyzer.difference(baseline, current) >= sensitivity
            || ScreenAnalyzer.changedPixelRatio(baseline, current, sensitivity) >= changedRatio
            || ScreenAnalyzer.whitePixelRatio(current) - ScreenAnalyzer.whitePixelRatio(baseline) >= 0.006d;
    }

    /**
     * Casts precisely and verifies that the colourful top-right HUD disappeared. If the
     * first touch was dropped by Unity, retry instead of waiting 75 seconds with no line out.
     */
    private boolean castLine() {
        Point hud = new Point(Math.round(this.captureWidth * 0.84f),
            Math.round(this.captureHeight * 0.20f));
        int radius = Math.max(16, Math.round(this.captureWidth * 0.09f));
        int step = Math.max(2, radius / 10);
        int[] before = sampleSignature(hud, radius, step);
        this.castHudIdleBaseline = null;
        if (before.length == 0) {
            this.config.appendLog("Thiếu ảnh HUD trước khi quăng cần — chờ khung hình mới thay vì bấm mù");
            return false;
        }
        for (int attempt = 1; attempt <= 3 && this.running.get(); attempt++) {
            Point action = this.config.getPoint(ConfigStore.ACTION, this.screenWidth, this.screenHeight);
            if (!AutomationAccessibilityService.preciseTap(action.x, action.y, TAP_TIMEOUT_MS)) {
                this.config.appendLog("Quăng cần thất bại lần " + attempt + "/3");
                continue;
            }
            // Wait for two distinct changed frames. A one-shot sample at 350 ms could run
            // before Unity hid the HUD, then the retry immediately reeled a valid cast in.
            if (!waitActive(250L)) return false;
            if (waitForVisualChange(hud, radius, step, before, 1600L, 12.0d, 0.18d)) {
                this.castHudIdleBaseline = before;
                this.castHudPoint = hud;
                this.castHudRadius = radius;
                this.castHudStep = step;
                return true;
            }
            this.config.appendLog("Nút quăng cần chưa phản hồi — thử lại " + attempt + "/3");
            if (!waitActive(120L)) return false;
        }
        return false;
    }

    /** The normal top-right HUD must still differ from its pre-cast image before any hook tap. */
    private boolean castStillActive() {
        if (this.castHudIdleBaseline == null || this.castHudPoint == null) return false;
        int[] current = sampleSignature(this.castHudPoint, this.castHudRadius, this.castHudStep);
        return current.length > 0
            && AutomationPolicy.castStarted(ScreenAnalyzer.difference(this.castHudIdleBaseline, current),
                ScreenAnalyzer.changedPixelRatio(this.castHudIdleBaseline, current, 18));
    }

    /**
     * Finds the cast button without a manual calibration. Each candidate position is tapped
     * once; the button reacts by changing its artwork (cast → reel-in), which shows up as a
     * pixel difference around the tap. Empty water and scenery do not react, so they are
     * skipped in a couple of seconds each. A hit is stored as a tentative calibration and is
     * only marked confirmed once a real catch goes through it.
     *
     * @return true when a candidate reacted and was stored
     */
    private boolean probeActionButton() {
        setState(AutomationState.PROBING, "Đang tự dò nút Câu trên màn hình…");
        float[][] candidates = probeCandidates();
        int radius = biteRadius();
        int step = Math.max(2, radius / 6);
        while (this.probeCursor < candidates.length && this.running.get() && awaitResume()) {
            float rx = candidates[this.probeCursor][0];
            float ry = candidates[this.probeCursor][1];
            this.probeCursor++;

            Point analysis = new Point(Math.round(rx * (this.captureWidth - 1)), Math.round(ry * (this.captureHeight - 1)));
            int[] before = sampleSignature(analysis, radius, step);
            if (before.length == 0) {
                if (!waitActive(400L)) return false;
                before = sampleSignature(analysis, radius, step);
                if (before.length == 0) continue;
            }
            if (!tapRatio(rx, ry) || !waitActive(antiDelay(2800L))) {
                return false;
            }
            int[] after = sampleSignature(analysis, radius, step);
            double change = ScreenAnalyzer.difference(before, after);
            if (change < this.config.sensitivity()) {
                continue;
            }

            this.config.savePointRatio(ConfigStore.ACTION, rx, ry);
            this.config.appendLog("🔎 Nút Câu phản hồi tại (" + Math.round(rx * 100) + "%, "
                + Math.round(ry * 100) + "%) — dùng vị trí này, sẽ xác nhận sau lần câu đầu");
            // The probe tap cast the line; reel it back in so the loop starts from idle.
            if (!tapRatio(rx, ry) || !waitActive(antiDelay(2000L))) {
                return false;
            }
            return true;
        }
        if (this.running.get()) {
            this.config.appendLog("⚠ Không tự dò được nút Câu — dùng toạ độ mặc định. Nếu không câu được, "
                + "hãy hiệu chỉnh tay (bước 1) một lần.");
        }
        return false;
    }

    /** Candidate ratios sorted nearest-first from the configured position, which comes first. */
    private float[][] probeCandidates() {
        final float baseX = this.config.pointRatioX(ConfigStore.ACTION);
        final float baseY = this.config.pointRatioY(ConfigStore.ACTION);
        java.util.List<float[]> list = new java.util.ArrayList<>();
        list.add(new float[]{baseX, baseY});
        for (float x : PROBE_X) {
            for (float y : PROBE_Y) {
                if (Math.abs(x - baseX) > 0.004f || Math.abs(y - baseY) > 0.004f) {
                    list.add(new float[]{x, y});
                }
            }
        }
        java.util.Collections.sort(list.subList(1, list.size()), new java.util.Comparator<float[]>() {
            @Override
            public int compare(float[] a, float[] b) {
                return Double.compare(distance(a), distance(b));
            }

            private double distance(float[] p) {
                return Math.hypot(p[0] - baseX, p[1] - baseY);
            }
        });
        return list.toArray(new float[0][]);
    }

    private boolean tapRatio(float rx, float ry) {
        if (!this.running.get() || this.paused.get()) {
            return false;
        }
        int x = Math.round(AutomationPolicy.clampRatio(rx) * Math.max(1, this.screenWidth - 1));
        int y = Math.round(AutomationPolicy.clampRatio(ry) * Math.max(1, this.screenHeight - 1));
        boolean anti = this.config.antiEnabled();
        if (anti) {
            Point jittered = AntiDetection.positionJitter(x, y, this.screenWidth, this.screenHeight);
            x = jittered.x;
            y = jittered.y;
        }
        long tapDuration = anti ? AntiDetection.humanizedTapDuration() : 55L;
        return AutomationAccessibilityService.tap(x, y, tapDuration, TAP_TIMEOUT_MS);
    }

    /** Reels the line back in so the next cast can start without waiting for the bite. */
    private CycleResult releaseSmallFish(String size) {
        this.skipped++;
        saveStats();
        setState(AutomationState.SKIPPING, "Bóng " + size + " — thu cần, thả lại");
        this.config.appendLog("🐟 Bỏ qua bóng " + size + "; chỉ giật cỡ "
            + AutomationPolicy.describeTiers(this.config.shadowTierMask()));
        if (!tap(ConfigStore.HOOK) || !waitActive(antiDelay(1600L))) {
            return CycleResult.FAILED;
        }
        return CycleResult.SKIPPED;
    }

    private boolean repairRod() {
        if (!this.config.repairRouteCalibrated()) {
            this.config.appendLog("Đã chặn sửa tự động vì có tọa độ sửa nằm ngoài màn hình an toàn");
            return false;
        }
        boolean bugs = this.config.bugMode();
        String tool = bugs ? "vợt" : "cần";
        setState(AutomationState.REPAIRING, "Đang mở balo và sửa " + tool);
        Point bag = analysisPoint(ConfigStore.BAG);
        int verifyRadius = Math.max(12, Math.round(this.captureWidth * 0.06f));
        int verifyStep = Math.max(2, verifyRadius / 10);
        int[] closedBag = sampleSignature(bag, verifyRadius, verifyStep);
        if (closedBag.length == 0 || !tap(ConfigStore.BAG)
                || !waitForVisualChange(bag, verifyRadius, verifyStep, closedBag,
                    2600L, 9.0d, 0.13d)) {
            this.config.appendLog("Không thấy balo mở — giữ yêu cầu sửa và thử lại sau lượt bắt kế tiếp");
            return false;
        }

        boolean routeReady = waitActive(antiDelay(450L))
            && tap(ConfigStore.TOOLS_TAB) && waitActive(antiDelay(700L))
            && tap(bugs ? ConfigStore.NET_SLOT : ConfigStore.ROD_SLOT) && waitActive(antiDelay(750L))
            && tap(ConfigStore.REPAIR) && waitActive(antiDelay(700L));
        if (!routeReady) {
            closeBagAfterRepairFailure(tool, "không mở được hộp sửa");
            return false;
        }

        Point confirm = analysisPoint(ConfigStore.REPAIR_CONFIRM);
        int[] confirmVisible = sampleSignature(confirm, verifyRadius, verifyStep);
        boolean confirmed = confirmVisible.length > 0
            && tap(ConfigStore.REPAIR_CONFIRM)
            && waitForVisualChange(confirm, verifyRadius, verifyStep, confirmVisible,
                2800L, 8.0d, 0.12d);
        if (!confirmed) {
            closeBagAfterRepairFailure(tool, "không xác nhận được nút sửa");
            return false;
        }
        // The confirmation dialog disappearing is the proof that matters. Persist it before
        // closing the bag so a failed close cannot cause a second, unnecessary repair charge.
        this.config.markRepairCaught(this.caught);
        this.repaired++;
        saveStats();
        this.config.appendLog("🔧 Đã xác nhận sửa " + tool + " ở lượt " + this.caught);
        if (!waitActive(antiDelay(500L)) || !tap(ConfigStore.CLOSE_BAG)
                || !waitActive(antiDelay(900L))) {
            this.config.appendLog("Đã sửa " + tool + " nhưng chưa đóng được balo");
            return false;
        }
        return true;
    }

    private void closeBagAfterRepairFailure(String tool, String reason) {
        this.config.appendLog("Sửa " + tool + " lỗi: " + reason
            + " — yêu cầu sửa vẫn còn để tự thử lại");
        if (this.running.get() && !this.paused.get()) {
            tap(ConfigStore.CLOSE_BAG);
            waitActive(antiDelay(700L));
        }
    }

    private boolean checkBagAndMaybeSell() {
        if (!this.config.sellingRouteCalibrated()) {
            this.config.appendLog("Đã chặn bán tự động vì route chưa hiệu chỉnh đủ");
            return false;
        }
        if (this.bagBadgeBaseline == null || this.bagBadgeBaseline.length == 0) {
            this.config.appendLog("Thiếu ảnh balo trước lượt bắt — bỏ qua bán để không nhận nhầm huy hiệu đỏ");
            return true;
        }
        setState(AutomationState.CHECKING_BAG, "Đang kiểm tra cảnh báo balo đầy");
        Point badge = analysisPoint(ConfigStore.BAG_FULL);
        int radius = badgeRadius();
        double beforeAlert = ScreenAnalyzer.alertColorRatio(this.bagBadgeBaseline);
        int positiveFrames = 0;
        for (int sample = 0; sample < 3; sample++) {
            int[] pixels = sampleSignature(badge, radius, 2);
            if (pixels.length == 0) return false;
            if (AutomationPolicy.bagAlertAppeared(beforeAlert,
                    ScreenAnalyzer.alertColorRatio(pixels))) positiveFrames++;
            if (sample < 2 && !waitActive(antiDelay(180L))) return false;
        }
        if (positiveFrames < 2) {
            return true;
        }
        this.config.appendLog("Phát hiện balo đầy ở " + positiveFrames + "/3 khung hình");

        // Remember what the spot looks like now so the return trip can be verified later.
        this.spotFingerprint = captureSpotFingerprint();

        boolean bugs = this.config.bugMode();
        String what = bugs ? "côn trùng" : "cá";
        setState(AutomationState.NAVIGATING_SELLER, "Balo đầy - đang đến nơi bán " + what);
        if (!sequence(new ConfigStore.PointSpec[]{ConfigStore.MAP, bugs ? ConfigStore.BUG_SELLER : ConfigStore.SELLER, ConfigStore.TRAVEL},
                new long[]{1200, 700, 5500})) {
            return false;
        }
        int sellMode = this.config.activeSellMode();
        setState(AutomationState.SELLING, "Mở tab " + what + " — " + AutomationPolicy.describeSellMode(sellMode));
        if (!sequence(new ConfigStore.PointSpec[]{ConfigStore.BAG, bugs ? ConfigStore.BUG_TAB : ConfigStore.FISH_TAB},
                new long[]{1200, 900})) {
            return false;
        }
        boolean soldOk = sellMode == AutomationPolicy.SELL_ALL
            ? sequence(new ConfigStore.PointSpec[]{ConfigStore.SELL_FISH, ConfigStore.SELL_CONFIRM}, new long[]{700, 1400})
            : sellCommonItems(sellMode);
        if (!soldOk || !tap(ConfigStore.CLOSE_BAG) || !waitActive(antiDelay(900L))) {
            return false;
        }
        this.sold++;
        saveStats();
        this.config.appendLog("💰 Đã bán " + what + " (lần " + this.sold + " trong phiên)");

        if (!this.config.autoReturn()) {
            this.config.appendLog("Tắt tự quay về — dừng lại ở chỗ bán");
            return true;
        }
        return returnToSpot();
    }

    /**
     * Sells only what the sell mode allows. The bag grid is scanned tile by tile; the frame
     * colour gives the grade, and each sellable tile is opened and sold on its own. After
     * every sale the remaining items shift, so the scan restarts from the first tile until a
     * full pass finds nothing left to sell.
     */
    private boolean sellCommonItems(int sellMode) {
        int columns = this.config.sellGridColumns();
        int rows = this.config.sellGridRows();
        int tiles = columns * rows;
        float firstX = this.config.pointRatioX(ConfigStore.SELL_TILE_FIRST);
        float firstY = this.config.pointRatioY(ConfigStore.SELL_TILE_FIRST);
        float lastX = this.config.pointRatioX(ConfigStore.SELL_TILE_LAST);
        float lastY = this.config.pointRatioY(ConfigStore.SELL_TILE_LAST);
        // Sample a band around each tile that is a third of the tile pitch, so neighbours never bleed in.
        float pitchX = columns > 1 ? Math.abs(lastX - firstX) / (columns - 1) : 0.12f;
        float pitchY = rows > 1 ? Math.abs(lastY - firstY) / (rows - 1) : 0.16f;
        int radius = Math.max(4, Math.round(Math.min(pitchX * this.captureWidth, pitchY * this.captureHeight) * 0.34f));
        int step = Math.max(1, radius / 5);

        int soldCount = 0;
        int kept = 0;
        for (int sale = 0; sale < MAX_SELECTIVE_SALES && this.running.get(); sale++) {
            int target = -1;
            kept = 0;
            for (int index = 0; index < tiles; index++) {
                float[] centre = AutomationPolicy.tileCenter(firstX, firstY, lastX, lastY, columns, rows, index);
                Point analysis = new Point(Math.round(centre[0] * (this.captureWidth - 1)), Math.round(centre[1] * (this.captureHeight - 1)));
                int[] band = sampleSignature(analysis, radius, step);
                int rarity = ScreenAnalyzer.dominantRarity(band,
                    ScreenAnalyzer.gridColumns(analysis, radius, step, this.captureWidth));
                boolean purple = ScreenAnalyzer.purpleBackground(band, 0.12);
                if (rarity == AutomationPolicy.RARITY_EMPTY && !purple) {
                    continue;
                }
                if (AutomationPolicy.keepPurpleEnabled(sellMode) && (purple || rarity >= AutomationPolicy.RARITY_VIP)) {
                    kept++;
                    continue;
                }
                if (AutomationPolicy.shouldSell(rarity == AutomationPolicy.RARITY_EMPTY
                        ? AutomationPolicy.RARITY_COMMON : rarity, sellMode)) {
                    target = index;
                    break;
                }
                kept++;
            }
            if (target < 0) {
                break;
            }
            float[] centre = AutomationPolicy.tileCenter(firstX, firstY, lastX, lastY, columns, rows, target);
            setState(AutomationState.SELLING, "Bán ô " + (target + 1) + " (đã bán " + soldCount + ", giữ " + kept + ")");
            if (!tapRatio(centre[0], centre[1]) || !waitActive(antiDelay(800L))
                    || !tap(ConfigStore.SELL_ONE) || !waitActive(antiDelay(800L))
                    || !tap(ConfigStore.SELL_CONFIRM) || !waitActive(antiDelay(1100L))) {
                return false;
            }
            soldCount++;
        }
        this.config.appendLog("💰 Bán chọn lọc: bán " + soldCount + " con, giữ lại " + kept + " con hiếm đang hiện");
        return true;
    }

    /**
     * Travels back to the calibrated spot and confirms arrival against the fingerprint
     * taken before departure, retrying the whole route when it does not match.
     */
    private boolean returnToSpot() {
        if (!this.config.returnRouteCalibrated()) {
            this.config.appendLog("Đã chặn tự quay về vì route chưa hiệu chỉnh đủ");
            return false;
        }
        boolean bugs = this.config.bugMode();
        int attempts = Math.max(1, this.config.maximumRetries());
        for (int attempt = 1; attempt <= attempts && this.running.get(); attempt++) {
            setState(AutomationState.RETURNING,
                "Đang tìm đường về chỗ " + (bugs ? "bắt côn trùng" : "câu") + " (" + attempt + "/" + attempts + ")");
            boolean routed = sequence(
                new ConfigStore.PointSpec[]{ConfigStore.RETURN_MAP, bugs ? ConfigStore.BUG_SPOT : ConfigStore.FISHING_SPOT, ConfigStore.TRAVEL,
                    ConfigStore.BAG, ConfigStore.TOOLS_TAB, bugs ? ConfigStore.NET_SLOT : ConfigStore.ROD_SLOT, ConfigStore.EQUIP_ROD, ConfigStore.CLOSE_BAG},
                new long[]{1200, 700, 5500, 1200, 700, 700, 900, 900});
            if (!this.running.get()) {
                return false;
            }
            if (!routed) {
                this.config.appendLog("Lộ trình về bị lỗi; thử lại (" + attempt + "/" + attempts + ")");
                continue;
            }

            setState(AutomationState.VERIFYING_SPOT, "Đang xác nhận đã về chỗ câu");
            if (!waitActive(antiDelay(1200L))) {
                return false;
            }
            if (spotMatches()) {
                this.config.appendLog("✅ Đã về đúng chỗ cũ và trang bị " + (bugs ? "vợt" : "cần"));
                return true;
            }
            this.config.appendLog("Chưa khớp chỗ câu cũ; thử lại lộ trình (" + attempt + "/" + attempts + ")");
        }
        if (!this.running.get()) {
            return false;
        }
        // Not a hard failure: the next fishing cycle detects the wrong screen and recovers,
        // which is safer than stopping the whole session over one uncertain comparison.
        this.config.appendLog("⚠ Không xác nhận được chỗ câu; để vòng câu kế tiếp tự phục hồi");
        return true;
    }

    // ══════════════════════════════ Bug catching ══════════════════════════════

    /**
     * Bug catching mirrors fishing: the corner action button lights up when a bug wanders
     * into range, we swing, store, and sell when the bag fills. Unlike fish, bugs do not come
     * to a bait, so when nothing shows up for a while the patrol nudges the character a step
     * in a random direction, and after too many empty steps travels back to the spot.
     */
    private void bugLoop() {
        this.spotFingerprint = captureSpotFingerprint();
        Point button = analysisPoint(ConfigStore.ACTION);
        int radius = biteRadius();
        int step = Math.max(2, radius / 6);
        int emptySteps = 0;
        int[] baseline = null;

        while (this.running.get() && awaitResume()) {
            if (batteryGuardTripped()) {
                return;
            }
            if (AutomationPolicy.watchdogTripped(this.lastProgressAt, this.config.watchdogMinutes(), SystemClock.elapsedRealtime())) {
                this.config.appendLog("⏱ Không bắt được côn trùng trong " + this.config.watchdogMinutes() + " phút — tự phục hồi");
                this.lastProgressAt = SystemClock.elapsedRealtime();
                if (!recoverToFishing("Watchdog: quá lâu không có côn trùng")) return;
                baseline = null;
            }
            if (!applyAntiGuards()) {
                return;
            }

            if (baseline == null) {
                // The button in its idle (no bug) look is the reference everything is compared to.
                if (!waitActive(antiDelay(700L))) return;
                baseline = sampleSignature(button, radius, step);
                if (baseline.length == 0) continue;
            }

            setState(AutomationState.WAITING_BUG, "Đang chờ côn trùng đến gần (" + this.sessionCaught + " con)");
            long started = SystemClock.elapsedRealtime();
            long idleMs = this.config.bugIdleSeconds() * 1000L;
            boolean bugNear = false;
            while (this.running.get() && awaitResume()
                    && !AutomationPolicy.deadlineExpired(started, idleMs, SystemClock.elapsedRealtime())
                    && waitActive(AntiDetection.pollIntervalMs())) {
                int[] sample = sampleSignature(button, radius, step);
                if (sample.length > 0 && ScreenAnalyzer.difference(baseline, sample) >= this.config.sensitivity()) {
                    bugNear = true;
                    break;
                }
            }
            if (!this.running.get()) return;

            if (!bugNear) {
                if (!this.config.bugPatrol()) {
                    continue;
                }
                if (!this.config.bugPatrolCalibrated()) {
                    this.config.appendLog("Chưa hiệu chỉnh joystick — đứng chờ để không kéo nhầm điều khiển");
                    continue;
                }
                emptySteps++;
                if (emptySteps > BUG_PATROL_MAX_STEPS) {
                    this.config.appendLog("🧭 Đi " + emptySteps + " bước không thấy côn trùng — quay về chỗ bắt");
                    emptySteps = 0;
                    if (!returnToSpot() && !this.running.get()) return;
                    baseline = null;
                    continue;
                }
                setState(AutomationState.PATROLLING, "Đi tìm côn trùng (bước " + emptySteps + ")");
                if (!walkRandomStep()) return;
                baseline = null;
                continue;
            }

            if (!waitActive(AntiDetection.reactionDelayMs())) {
                return;
            }

            setState(AutomationState.SWINGING, "Côn trùng gần — vung vợt");
            captureBagBadgeBaseline();
            if (!tap(ConfigStore.ACTION) || !waitActive(antiDelay(2500L))) {
                return;
            }
            if (this.config.autoStore()) {
                if (AntiDetection.shouldHesitateBeforeStore()
                        && !waitActive(AntiDetection.reactionDelayMs())) {
                    return;
                }
                setState(AutomationState.STORING, "Đang bấm Bảo quản");
                if (!tap(ConfigStore.STORE) || !waitActive(antiDelay(2200L))) return;
            }
            this.caught++;
            this.sessionCaught++;
            emptySteps = 0;
            this.lastProgressAt = SystemClock.elapsedRealtime();
            saveStats();
            this.config.setRuntime(AutomationState.SWINGING, "Đã vung vợt " + this.sessionCaught + " lần", this.caught);
            if (!waitActive(AntiDetection.afterCatchRestMs())) return;
            if (this.config.autoRepair() && AutomationPolicy.repairDue(this.caught,
                    this.config.repairEvery(), this.config.lastRepairCaught())) {
                if (!repairRod() && this.running.get()) {
                    if (!recoverToFishing("Sửa vợt lỗi")) return;
                }
            }
            if (this.config.autoSell() && this.config.sellingRouteCalibrated()
                    && !checkBagAndMaybeSell() && this.running.get()) {
                if (!recoverToFishing("Bán côn trùng lỗi")) return;
            }
            baseline = null;
        }
    }

    /**
     * Session limits, AFK breaks and micro-pauses. Shared by fishing and bug catching so
     * neither mode runs as a perfect machine.
     *
     * @return false when the session must stop
     */
    private boolean applyAntiGuards() {
        String unit = this.config.bugMode() ? "côn trùng" : "cá";
        if (AntiDetection.isSessionExpired(
                this.sessionStartedAt, this.caught,
                this.config.maxSessionMinutes(),
                this.config.maxFishPerSession(),
                SystemClock.elapsedRealtime())) {
            setState(AutomationState.SESSION_EXPIRED,
                "Hết phiên an toàn (" + this.caught + " " + unit + ", "
                + ((SystemClock.elapsedRealtime() - this.sessionStartedAt) / 60000L) + " phút)");
            this.config.appendLog("🛡️ Session expired — auto-stop");
            stopLoop("Hết phiên — tự dừng an toàn");
            return false;
        }
        if (AntiDetection.shouldTakeSessionBreak(this.caught)) {
            long breakMs = AntiDetection.sessionBreakMs();
            setState(AutomationState.SESSION_BREAK,
                "Nghỉ giữa phiên " + (breakMs / 1000) + "s (giả lập AFK)");
            this.config.appendLog("🛡️ Session break: " + (breakMs / 1000) + "s");
            if (this.config.bugMode() && this.config.bugPatrol()
                    && this.config.bugPatrolCalibrated() && AntiDetection.shouldLookAround()) {
                if (!walkRandomStep()) return false;
            }
            if (!waitActive(breakMs)) return false;
        }
        if (AntiDetection.shouldTakeMicroPause()) {
            long pauseMs = AntiDetection.microPauseMs();
            setState(AutomationState.MICRO_PAUSE, "Nghỉ ngắn " + (pauseMs / 1000) + "s");
            if (!waitActive(pauseMs)) return false;
        }
        return this.running.get();
    }

    /** Pushes the joystick in a random direction for under a second, a small hop around the spot. */
    private boolean walkRandomStep() {
        if (!this.config.bugPatrolCalibrated()) {
            this.config.appendLog("Đã chặn kéo joystick vì chưa hiệu chỉnh điểm");
            return this.running.get();
        }
        Point stick = this.config.getPoint(ConfigStore.JOYSTICK, this.screenWidth, this.screenHeight);
        if (this.config.antiEnabled()) {
            stick = AntiDetection.positionJitter(stick.x, stick.y, this.screenWidth, this.screenHeight);
        }
        double angle = Math.random() * Math.PI * 2;
        int reach = Math.max(40, Math.round(this.screenHeight * (this.config.antiEnabled() ? 0.08f + (float) Math.random() * 0.08f : 0.11f)));
        int toX = AutomationPolicy.clampInt(stick.x + (int) Math.round(Math.cos(angle) * reach), 0, this.screenWidth - 1);
        int toY = AutomationPolicy.clampInt(stick.y + (int) Math.round(Math.sin(angle) * reach), 0, this.screenHeight - 1);
        long hold = this.config.antiEnabled()
            ? 450L + (long) (Math.random() * 900)
            : 600L + (long) (Math.random() * 500);
        if (!AutomationAccessibilityService.drag(stick.x, stick.y, toX, toY, hold, TAP_TIMEOUT_MS)) {
            this.config.appendLog("Không kéo được joystick — kiểm tra điểm hiệu chỉnh joystick");
            return this.running.get();
        }
        return waitActive(antiDelay(900L));
    }

    private int[] captureSpotFingerprint() {
        int radius = spotRadius();
        return sampleSignature(analysisPoint(ConfigStore.ACTION), radius, spotStep(radius));
    }

    /** Captures the pre-catch badge state so permanent event badges cannot trigger selling. */
    private void captureBagBadgeBaseline() {
        if (!this.config.autoSell() || !this.config.sellingRouteCalibrated()) {
            this.bagBadgeBaseline = null;
            return;
        }
        Point badge = analysisPoint(ConfigStore.BAG_FULL);
        this.bagBadgeBaseline = sampleSignature(badge, badgeRadius(), 2);
    }

    private boolean spotMatches() {
        if (this.spotFingerprint == null || this.spotFingerprint.length == 0) {
            return true;
        }
        int[] current = captureSpotFingerprint();
        if (current.length == 0) {
            return false;
        }
        double difference = ScreenAnalyzer.difference(this.spotFingerprint, current);
        this.config.appendLog("Sai khác chỗ câu: " + Math.round(difference)
            + " (cho phép " + Math.round(SPOT_TOLERANCE) + ")");
        return AutomationPolicy.arrivedAtSpot(difference, SPOT_TOLERANCE);
    }

    private boolean batteryGuardTripped() {
        int stopBelow = this.config.stopBatteryPercent();
        if (stopBelow <= 0) {
            return false;
        }
        int level = batteryLevel();
        if (!AutomationPolicy.batteryTooLow(level, stopBelow)) {
            return false;
        }
        setState(AutomationState.LOW_BATTERY, "Pin còn " + level + "% — dừng an toàn");
        this.config.appendLog("🔋 Pin " + level + "% dưới mức " + stopBelow + "% — tự dừng");
        stopLoop("Pin yếu — đã dừng an toàn");
        return true;
    }

    /** Battery percentage, or -1 when the platform cannot report it. */
    private int batteryLevel() {
        BatteryManager manager = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (manager == null) {
            return -1;
        }
        return manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
    }

    private void collapseControlOverlay() {
        if (!this.config.overlayMenuEnabled()) {
            return;
        }
        try {
            startForegroundService(new Intent(this, ControlOverlayService.class)
                .setAction(ControlOverlayService.ACTION_COLLAPSE));
        } catch (RuntimeException ignored) {
            // Overlay permission may have been revoked.
        }
    }

    private void restoreControlOverlay() {
        collapseControlOverlay();
    }

    private boolean recoverToFishing(String reason) {
        this.recoveries++;
        if (this.recoveries > this.config.maximumRetries()) {
            this.config.appendLog("Phục hồi nhiều lần chưa được — chờ ngắn rồi tiếp tục, không tự dừng");
            this.recoveries = 1;
        }
        setState(AutomationState.RECOVERING, reason + " — không mở game, chờ màn hình ổn");
        this.config.appendLog("Phục hồi lần " + this.recoveries + ": " + reason);
        return waitActive(antiDelay(1200L));
    }

    private boolean sequence(ConfigStore.PointSpec[] points, long[] waits) {
        for (int i = 0; i < points.length; i++) {
            if (!awaitResume() || !tap(points[i])) {
                this.config.appendLog("Không bấm được: " + points[i].label);
                return false;
            }
            long baseWait = i < waits.length ? waits[i] : UI_SETTLE_MS;
            if (!waitActive(antiDelay(baseWait))) {
                return false;
            }
        }
        return true;
    }

    /** Coordinates for pixel analysis, expressed in the downscaled capture space. */
    private Point analysisPoint(ConfigStore.PointSpec spec) {
        return this.config.getPoint(spec, this.captureWidth, this.captureHeight);
    }

    private int biteRadius() {
        return Math.max(8, Math.round(this.captureWidth * 0.035f));
    }

    /** Wider cue region because the white '!' appears above the avatar, not on the button. */
    private int biteIndicatorRadius() {
        return Math.max(18, Math.round(this.captureWidth * 0.11f));
    }

    private int badgeRadius() {
        return Math.max(6, Math.round(this.captureWidth * 0.028f));
    }

    /** Wider than the bite region so the fingerprint carries enough scenery to be distinctive. */
    private int spotRadius() {
        return Math.max(16, Math.round(this.captureWidth * 0.10f));
    }

    /** Covers the patch of water where the shadow circles the float. */
    private int shadowRadius() {
        return Math.max(14, Math.round(this.captureWidth * 0.09f));
    }

    private void saveStats() {
        this.config.saveSessionStats(this.sessionCaught, this.sold, this.repaired, this.skipped);
    }

    private int spotStep(int radius) {
        return Math.max(2, radius / 10);
    }

    /** Performs a tap with anti-detection: humanized duration + position jitter. */
    private boolean tap(ConfigStore.PointSpec spec) {
        if (!this.running.get() || this.paused.get()) {
            return false;
        }
        if ((spec == ConfigStore.MAP || spec == ConfigStore.RETURN_MAP)
                && !ConfigStore.safeNavigationCoordinate(
                    this.config.pointRatioX(spec), this.config.pointRatioY(spec))) {
            this.config.appendLog("Đã chặn tọa độ bản đồ nằm trên nút profile: " + spec.label);
            return false;
        }
        Point point = this.config.getPoint(spec, this.screenWidth, this.screenHeight);
        boolean anti = this.config.antiEnabled();
        if (anti) {
            point = AntiDetection.positionJitter(point.x, point.y, this.screenWidth, this.screenHeight);
        }
        long tapDuration = anti ? AntiDetection.humanizedTapDuration() : 55L;
        boolean ok = AutomationAccessibilityService.tap(point.x, point.y, tapDuration, TAP_TIMEOUT_MS);
        if (!ok) {
            this.config.appendLog("Chạm " + spec.label + " thất bại tại " + point.x + "," + point.y);
        }
        return ok;
    }

    /** Hooking is time-critical and must land on the calibrated centre without stacked jitter. */
    private boolean tapHook() {
        if (!this.running.get() || this.paused.get()) {
            return false;
        }
        Point point = this.config.getPoint(ConfigStore.HOOK, this.screenWidth, this.screenHeight);
        boolean ok = AutomationAccessibilityService.preciseTap(point.x, point.y, TAP_TIMEOUT_MS);
        if (!ok) {
            this.config.appendLog("Chạm " + ConfigStore.HOOK.label + " thất bại tại "
                + point.x + "," + point.y);
        }
        return ok;
    }

    /** Applies anti-detection jitter to a delay, or returns it unchanged when anti is off. */
    private long antiDelay(long baseMs) {
        return this.config.antiEnabled() ? AntiDetection.humanizedDelay(baseMs) : baseMs;
    }

    private boolean waitForFrame(long timeoutMs) {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        while (this.running.get() && SystemClock.elapsedRealtime() < end) {
            synchronized (this.frameLock) {
                if (this.frameReady) {
                    return true;
                }
            }
            if (!waitActive(80L)) {
                return false;
            }
        }
        return false;
    }

    /** Waits until a post-action control is visibly present instead of blindly tapping it. */
    private boolean waitForVisualChange(Point point, int radius, int step, int[] baseline,
                                        long timeoutMs, double minDifference, double minChangedRatio) {
        if (baseline == null || baseline.length == 0) return false;
        long startedAt = SystemClock.elapsedRealtime();
        long lastPositiveFrameAt = -1L;
        int positiveFrames = 0;
        while (this.running.get()
                && !AutomationPolicy.deadlineExpired(startedAt, timeoutMs, SystemClock.elapsedRealtime())) {
            int[] current = sampleSignature(point, radius, step);
            long capturedAt = frameCapturedAt();
            boolean changed = current.length > 0
                && (ScreenAnalyzer.difference(baseline, current) >= minDifference
                    || ScreenAnalyzer.changedPixelRatio(baseline, current, 18) >= minChangedRatio);
            if (changed && capturedAt != lastPositiveFrameAt) {
                lastPositiveFrameAt = capturedAt;
                if (++positiveFrames >= 2) return true;
            } else if (!changed) {
                positiveFrames = 0;
                lastPositiveFrameAt = -1L;
            }
            if (!waitActive(45L)) return false;
        }
        return false;
    }

    private long frameCapturedAt() {
        synchronized (this.frameLock) {
            return this.lastFrameCapturedAt;
        }
    }

    /** Waits for the cyan button itself, not the catch animation changing nearby water. */
    private boolean waitForStoreButton(Point point, int radius, int step, int[] baseline,
                                       long timeoutMs) {
        if (baseline == null || baseline.length == 0) return false;
        double baselineCyan = ScreenAnalyzer.cyanControlRatio(baseline);
        long startedAt = SystemClock.elapsedRealtime();
        long lastPositiveFrameAt = -1L;
        int positiveFrames = 0;
        while (this.running.get()
                && !AutomationPolicy.deadlineExpired(startedAt, timeoutMs, SystemClock.elapsedRealtime())) {
            int[] current = sampleSignature(point, radius, step);
            long capturedAt = frameCapturedAt();
            boolean appeared = current.length > 0 && AutomationPolicy.storeButtonAppeared(
                baselineCyan, ScreenAnalyzer.cyanControlRatio(current));
            if (appeared && capturedAt != lastPositiveFrameAt) {
                lastPositiveFrameAt = capturedAt;
                if (++positiveFrames >= 2) return true;
            } else if (!appeared) {
                positiveFrames = 0;
                lastPositiveFrameAt = -1L;
            }
            if (!waitActive(45L)) return false;
        }
        return false;
    }

    /** Waits for a frame captured after an action, preventing stale pre-cast baselines. */
    private boolean waitForFrameAfter(long minimumCapturedAt, long timeoutMs) {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        while (this.running.get() && SystemClock.elapsedRealtime() < end) {
            synchronized (this.frameLock) {
                if (this.frameReady && this.lastFrameCapturedAt > minimumCapturedAt) {
                    return true;
                }
            }
            if (!waitActive(40L)) {
                return false;
            }
        }
        return false;
    }

    private boolean waitForAccessibility(long timeout) {
        long end = SystemClock.elapsedRealtime() + timeout;
        while (this.running.get() && SystemClock.elapsedRealtime() < end) {
            if (AutomationAccessibilityService.isReady()) {
                return true;
            }
            SystemClock.sleep(250L);
        }
        return false;
    }

    private boolean waitActive(long milliseconds) {
        long end = SystemClock.elapsedRealtime() + milliseconds;
        while (this.running.get() && SystemClock.elapsedRealtime() < end) {
            if (!awaitResume()) {
                return false;
            }
            long remaining = end - SystemClock.elapsedRealtime();
            if (remaining <= 0) {
                break;
            }
            SystemClock.sleep(Math.min(100L, remaining));
        }
        return this.running.get();
    }

    private boolean awaitResume() {
        while (this.running.get() && this.paused.get()) {
            SystemClock.sleep(100L);
        }
        return this.running.get();
    }

    private void pauseAutomation() {
        if (this.running.get()) {
            this.paused.set(true);
            setState(AutomationState.PAUSED, "Đã tạm dừng");
        }
    }

    private void resumeAutomation() {
        if (this.running.get()) {
            this.paused.set(false);
            setState(AutomationState.PREPARING, "Đang tiếp tục");
        }
    }

    private void stopWithError(final String message) {
        setState(AutomationState.ERROR, message);
        this.main.postDelayed(new Runnable() {
            @Override
            public void run() {
                FishingService.this.stopLoop(message);
            }
        }, 250L);
    }

    /** Stops the fishing loop but keeps screen-capture armed so Start in-game needs no new dialog. */
    private void stopLoop(String message) {
        this.running.set(false);
        this.paused.set(false);
        if (this.workerThread != null) {
            this.workerThread.quitSafely();
            this.workerThread = null;
            this.worker = null;
        }
        if (this.wakeLock != null && this.wakeLock.isHeld()) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
        if (this.projection != null) {
            this.config.saveCaptureReady(true);
            this.config.setRuntime(AutomationState.ARMED, message + " — bấm Bắt đầu để chạy lại", this.caught);
            restoreControlOverlay();
            updateNotification("Sẵn sàng — vào game bấm Bắt đầu");
            return;
        }
        this.config.saveCaptureReady(false);
        this.config.setRuntime(AutomationState.IDLE, message, this.caught);
        restoreControlOverlay();
        stopSelf();
    }

    private void setState(AutomationState state, final String message) {
        this.config.setRuntime(state, message, this.caught);
        this.main.post(new Runnable() {
            @Override
            public void run() {
                FishingService.this.updateNotification(message);
            }
        });
    }

    private void updateNotification(String message) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(message));
        }
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
            getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.notification_channel_description));
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, pendingFlags);
        PendingIntent pauseIntent = PendingIntent.getService(this, 1,
            new Intent(this, FishingService.class).setAction(this.paused.get() ? ACTION_RESUME : ACTION_PAUSE), pendingFlags);
        PendingIntent stopIntent = PendingIntent.getService(this, 2,
            new Intent(this, FishingService.class).setAction(ACTION_STOP), pendingFlags);
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(getString(R.string.app_name) + " • " + this.variant.shortLabel)
            .setContentText(text)
            .setOngoing(this.running.get())
            .setContentIntent(content)
            .addAction(0, this.paused.get() ? "Tiếp tục" : "Tạm dừng", pauseIntent)
            .addAction(0, "Dừng", stopIntent)
            .build();
    }

    private void acquireWakeLock() {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        this.wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PTAutoFishing:Runtime");
        this.wakeLock.acquire(21600000L);
    }

    @Override
    public void onDestroy() {
        this.running.set(false);
        this.config.saveCaptureReady(false);
        if (this.workerThread != null) {
            this.workerThread.quitSafely();
            this.workerThread = null;
        }
        if (this.virtualDisplay != null) {
            this.virtualDisplay.release();
            this.virtualDisplay = null;
        }
        if (this.imageReader != null) {
            this.imageReader.close();
            this.imageReader = null;
        }
        if (this.projection != null) {
            this.projection.stop();
            this.projection = null;
        }
        if (this.captureThread != null) {
            this.captureThread.quitSafely();
            this.captureThread = null;
        }
        synchronized (this.frameLock) {
            recycleFrameBufferLocked();
            this.frameReady = false;
        }
        if (this.wakeLock != null && this.wakeLock.isHeld()) {
            this.wakeLock.release();
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
