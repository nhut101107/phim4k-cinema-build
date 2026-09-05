package com.phim4k.cinema;

import static org.junit.Assert.*;
import android.content.Intent;
import android.view.KeyEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class TvSmokeTest {
    private String js(MainActivity activity, String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        activity.runOnUiThread(() -> activity.getBridge().getWebView().evaluateJavascript(expression, result -> { value.set(result); done.countDown(); }));
        assertTrue("WebView response timed out", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }
    @Test public void tvGateAndRemoteNavigation() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        assertEquals("com.phim4k.cinema.tv", context.getPackageName());
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            boolean ready = false;
            for (int i = 0; i < 30; i++) {
                if ("true".equals(js(activity, "document.documentElement.classList.contains('tv-mode') && typeof Phim4KTV !== 'undefined'"))) { ready = true; break; }
                Thread.sleep(500);
            }
            assertTrue("TV UI never initialized", ready);
            assertEquals("true", js(activity, "!!document.querySelector('#activationGate:not(.hidden)')"));
            assertEquals("true", js(activity, "typeof window.require === 'undefined'"));
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_DOWN);
            assertEquals("true", js(activity, "document.activeElement !== document.body"));
            assertEquals("true", js(activity, "document.documentElement.clientWidth > document.documentElement.clientHeight"));
            // Unavailable downloads must not leave users on a broken relative link.
            assertEquals("true", js(activity, "Phim4KPlatform.safeUrl('/download/apk') === ''"));
            js(activity, "window.qaVideo=document.createElement('video'); qaVideo.muted=true; qaVideo.playsInline=true; document.body.appendChild(qaVideo); qaVideo.src='/media/qa-original.mp4'; qaVideo.play().catch(()=>{}); true");
            boolean decoded = false;
            for (int i = 0; i < 30; i++) {
                if ("true".equals(js(activity, "qaVideo.currentTime > 0.1 && qaVideo.videoWidth > 0"))) { decoded = true; break; }
                Thread.sleep(500);
            }
            assertTrue("Original video could not be decoded", decoded);
            js(activity, "Capacitor.registerPlugin('ReleaseDownloads').status().then(r=>window.qaDownloadState=r.status).catch(()=>window.qaDownloadState='error'); true");
            boolean downloadBridge = false;
            for (int i = 0; i < 20; i++) {
                if ("true".equals(js(activity, "window.qaDownloadState === 'missing'"))) { downloadBridge = true; break; }
                Thread.sleep(250);
            }
            assertTrue("Native downloader bridge unavailable", downloadBridge);
        } finally { activity.runOnUiThread(activity::finish); }
    }
}
