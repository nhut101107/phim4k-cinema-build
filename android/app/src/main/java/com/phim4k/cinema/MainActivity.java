package com.phim4k.cinema;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Process;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import java.io.BufferedReader;
import java.io.FileReader;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final String RELEASE_CERT_SHA256 = "ABAFDA2EAD9478B2540328C98774B4B0A9432014F7B31CBF40FB3EF1F6FECBC8";
    private static final String[] INJECTION_MARKERS = {
        "frida", "xposed", "lsposed", "substrate", "libhooker", "zygisk", "riru", "edxp"
    };

    @Override
    protected void onCreate(Bundle state) {
        if (!BuildConfig.DEBUG && !isTrustedReleaseRuntime()) {
            super.onCreate(state);
            terminateCompromisedProcess();
            return;
        }
        registerPlugin(ReleaseDownloadsPlugin.class);
        registerPlugin(SecureSessionPlugin.class);
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { handleWebBack(); }
        });
    }

    @Override
    protected void load() {
        super.load();
        if (bridge != null) {
            WebView view = bridge.getWebView();
            WebSettings settings = view.getSettings();
            String platformAgent = "android_tv".equals(BuildConfig.PHIM4K_PLATFORM) ? "Phim4KTV" : "Phim4KAndroid";
            settings.setUserAgentString(settings.getUserAgentString() + " " + platformAgent);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setDefaultTextEncodingName("UTF-8");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        }
    }

    private void handleWebBack() {
        if (bridge == null || bridge.getWebView() == null) {
            finish();
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "window.Phim4KNavigation ? window.Phim4KNavigation.back() : (window.Phim4KTV ? window.Phim4KTV.back() : false)",
            result -> { if (!"true".equals(result)) finish(); }
        );
    }

    private boolean isTrustedReleaseRuntime() {
        String expectedPackage = "android_tv".equals(BuildConfig.PHIM4K_PLATFORM)
            ? "com.phim4k.cinema.tv"
            : "com.phim4k.cinema";
        if (!expectedPackage.equals(getPackageName())) return false;
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) return false;
        if (!hasExpectedSigningCertificate()) return false;
        return !hasInjectedLibrary();
    }

    @SuppressWarnings("deprecation")
    private boolean hasExpectedSigningCertificate() {
        try {
            PackageInfo info;
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (info.signingInfo == null) return false;
                signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
            } else {
                info = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length == 0) return false;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (Signature signature : signatures) {
                if (RELEASE_CERT_SHA256.equals(toHex(digest.digest(signature.toByteArray())))) return true;
            }
        } catch (Exception ignored) {
            return false;
        }
        return false;
    }

    private boolean hasInjectedLibrary() {
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/self/maps"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String lower = line.toLowerCase(Locale.ROOT);
                for (String marker : INJECTION_MARKERS) {
                    if (lower.contains(marker)) return true;
                }
            }
        } catch (Exception ignored) {
            return true;
        }
        return false;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(Locale.ROOT, "%02X", value));
        return output.toString();
    }

    private void terminateCompromisedProcess() {
        finishAndRemoveTask();
        Process.killProcess(Process.myPid());
    }
}
