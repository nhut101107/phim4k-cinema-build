package com.pthelper.autofishing;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Point;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/* JADX INFO: loaded from: classes2.dex */
public final class AutomationAccessibilityService extends AccessibilityService {
    /**
     * A Unity game emits accessibility events sparsely, so the liveness window has to be
     * generous; recovery is only a re-launch, which is harmless if it fires unnecessarily.
     */
    private static final long GAME_EVENT_WINDOW_MS = 15_000L;
    private static volatile AutomationAccessibilityService instance;
    private static volatile long lastGameEventAt;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override // android.accessibilityservice.AccessibilityService
    protected void onServiceConnected() {
        instance = this;
    }

    @Override // android.accessibilityservice.AccessibilityService
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event != null && GameVariant.isGamePackage(event.getPackageName())) {
            lastGameEventAt = android.os.SystemClock.elapsedRealtime();
        }
    }

    @Override // android.accessibilityservice.AccessibilityService
    public void onInterrupt() {
        FishingService.requestEmergencyStop(this, "Dịch vụ Trợ năng bị gián đoạn");
    }

    @Override // android.app.Service
    public void onDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    @Override // android.accessibilityservice.AccessibilityService
    protected boolean onKeyEvent(KeyEvent event) {
        // Volume-down stop used to filter key events. That flag is a common autoclick
        // fingerprint, so the service no longer intercepts keys. Use the overlay Stop button.
        return super.onKeyEvent(event);
    }

    public static boolean isReady() {
        return instance != null;
    }

    public static boolean isGameActive() {
        return instance != null
            && android.os.SystemClock.elapsedRealtime() - lastGameEventAt < GAME_EVENT_WINDOW_MS;
    }

    public static boolean pressBack() {
        AutomationAccessibilityService service = instance;
        return service != null && service.performGlobalAction(GLOBAL_ACTION_BACK);
    }

    /**
     * A real finger never lands and lifts on the same pixel. The stroke starts at the
     * target and drifts a short curve — the signature autoclickers miss because they
     * dispatch a zero-length path.
     */
    public static boolean tap(final int x, final int y, final long durationMs, long timeoutMs) {
        Point drift = AntiDetection.fingerDrift();
        Path path = new Path();
        path.moveTo(x, y);
        path.quadTo(x + drift.x * 0.4f, y + drift.y * 0.65f, x + drift.x, y + drift.y);
        return gesture(path, Math.max(90L, durationMs), timeoutMs);
    }

    /** Fast, tightly bounded tap for short reaction windows such as hooking a fish. */
    public static boolean preciseTap(final int x, final int y, long timeoutMs) {
        Path path = new Path();
        path.moveTo(x, y);
        path.lineTo(x + 1, y);
        return gesture(path, 65L, timeoutMs);
    }

    /** Press-and-hold drag, used to push the movement joystick for a short walk. */
    public static boolean drag(int fromX, int fromY, int toX, int toY, long durationMs, long timeoutMs) {
        Path path = new Path();
        path.moveTo(fromX, fromY);
        path.lineTo(toX, toY);
        return gesture(path, durationMs, timeoutMs);
    }

    private static volatile long lastGestureAt;

    private static boolean gesture(final Path path, final long durationMs, long timeoutMs) {
        final AutomationAccessibilityService service = instance;
        if (service == null) {
            return false;
        }
        // Two gestures closer than a human inter-tap gap is the other classic clicker tell.
        long gap = lastGestureAt + AntiDetection.minGestureGapMs() - android.os.SystemClock.elapsedRealtime();
        if (gap > 0) {
            try {
                Thread.sleep(gap);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        final CountDownLatch completed = new CountDownLatch(1);
        final boolean[] result = {false};
        service.mainHandler.post(new Runnable() {
            @Override
            public void run() {
                AutomationAccessibilityService.dispatch(path, durationMs, service, result, completed);
            }
        });
        try {
            return completed.await(Math.max(250L, timeoutMs + durationMs), TimeUnit.MILLISECONDS) && result[0];
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static void dispatch(Path path, long durationMs, AutomationAccessibilityService service, final boolean[] result, final CountDownLatch completed) {
        GestureDescription gesture = new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path, 0L, Math.max(40L, durationMs))).build();
        boolean dispatched = service.dispatchGesture(gesture, new AccessibilityService.GestureResultCallback() { // from class: com.pthelper.autofishing.AutomationAccessibilityService.1
            @Override // android.accessibilityservice.AccessibilityService.GestureResultCallback
            public void onCompleted(GestureDescription description) {
                lastGestureAt = android.os.SystemClock.elapsedRealtime();
                result[0] = true;
                completed.countDown();
            }

            @Override // android.accessibilityservice.AccessibilityService.GestureResultCallback
            public void onCancelled(GestureDescription description) {
                completed.countDown();
            }
        }, service.mainHandler);
        if (!dispatched) {
            completed.countDown();
        }
    }
}
