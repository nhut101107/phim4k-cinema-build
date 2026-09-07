package com.phim4k.cinema;

import static org.junit.Assert.*;

import android.content.Intent;
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
        activity.runOnUiThread(() -> activity.getBridge().getWebView().evaluateJavascript(expression, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("WebView response timed out", done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private boolean waitFor(MainActivity activity, String expression, int attempts, long delayMs) throws Exception {
        for (int i = 0; i < attempts; i++) {
            if ("true".equals(js(activity, expression))) return true;
            Thread.sleep(delayMs);
        }
        return false;
    }

    @Test public void deviceShellNavigationAndPlayback() throws Exception {
        boolean isTv = "android_tv".equals(BuildConfig.PHIM4K_PLATFORM);
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        var context = instrumentation.getTargetContext();
        assertEquals(isTv ? "com.phim4k.cinema.tv" : "com.phim4k.cinema", context.getPackageName());

        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(intent);
        try {
            String readyExpression = isTv
                ? "document.documentElement.classList.contains('tv-mode') && typeof Phim4KTV !== 'undefined'"
                : "document.documentElement.classList.contains('platform-android') && typeof Phim4KNavigation !== 'undefined' && !document.documentElement.classList.contains('tv-mode')";
            assertTrue("Device UI never initialized", waitFor(activity, readyExpression, 40, 500));
            assertEquals("true", js(activity, "!!document.querySelector('#activationGate:not(.hidden)')"));
            assertEquals("true", js(activity, "typeof window.require === 'undefined'"));
            assertEquals("true", js(activity, "Phim4KNativeDownloads.supported()"));
            assertEquals("true", js(activity, isTv
                ? "document.documentElement.clientWidth > document.documentElement.clientHeight"
                : "document.documentElement.clientHeight >= document.documentElement.clientWidth"));

            js(activity, "window.qaBackClosed=false; const q=document.createElement('div'); q.id='qaBackOverlay'; q.className='modal-overlay'; q.style.zIndex='2147483000'; q.innerHTML='<button class=\"modal-close-btn\">close</button>'; q.querySelector('button').onclick=()=>{qaBackClosed=true;q.remove()}; document.body.appendChild(q); true");
            activity.runOnUiThread(() -> activity.getOnBackPressedDispatcher().onBackPressed());
            assertTrue("System Back did not close the top app layer", waitFor(activity, "qaBackClosed===true && !document.getElementById('qaBackOverlay')", 20, 100));
            assertFalse("Activity exited while a modal was open", activity.isFinishing());

            js(activity, "window.qaVideo=Player.video; Player.modal.classList.remove('hidden'); qaVideo.muted=true; qaVideo.loop=true; qaVideo.src=location.origin+'/media/qa-original.mp4'; qaVideo.play(); true");
            assertTrue("Original video could not be decoded", waitFor(activity, "qaVideo.currentTime > 0.1 && qaVideo.videoWidth > 0", 40, 250));
            assertEquals("true", js(activity, "Player.aspectMode==='contain' && getComputedStyle(qaVideo).objectFit==='contain' && qaVideo.getBoundingClientRect().width<=innerWidth+1 && qaVideo.getBoundingClientRect().bottom<=innerHeight+1"));

            js(activity, "Phim4KNativeDownloads.status().then(r=>window.qaDownloadState=r.status).catch(e=>window.qaDownloadState='error: '+e.message); true");
            assertTrue("Native downloader bridge unavailable", waitFor(activity, "window.qaDownloadState === 'missing'", 20, 250));
            js(activity, "Capacitor.Plugins.ReleaseDownloads.install().then(()=>window.qaInstallGuard='unsafe').catch(()=>window.qaInstallGuard='blocked'); true");
            assertTrue("Installer guard did not answer", waitFor(activity, "window.qaInstallGuard === 'blocked'", 20, 250));
        } finally {
            activity.runOnUiThread(activity::finish);
        }
    }
}
