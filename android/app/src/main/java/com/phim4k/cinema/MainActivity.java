package com.phim4k.cinema;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        super.load();
        if (bridge != null) {
            android.webkit.WebView view = bridge.getWebView();
            view.getSettings().setUserAgentString(view.getSettings().getUserAgentString() + " Phim4KTV");
            view.getSettings().setAllowFileAccess(false);
            android.webkit.WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        }
    }

    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        if (event.getKeyCode() == android.view.KeyEvent.KEYCODE_BACK && bridge != null) {
            if (event.getAction() == android.view.KeyEvent.ACTION_UP) {
                bridge.getWebView().evaluateJavascript("window.Phim4KTV ? window.Phim4KTV.back() : false", result -> {
                    if (!"true".equals(result)) finish();
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
