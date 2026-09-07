package com.phim4k.cinema;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle state) {
        registerPlugin(ReleaseDownloadsPlugin.class);
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
}
