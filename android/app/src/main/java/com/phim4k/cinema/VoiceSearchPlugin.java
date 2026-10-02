package com.phim4k.cinema;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

@CapacitorPlugin(name = "VoiceSearch")
public class VoiceSearchPlugin extends Plugin {
    @PluginMethod
    public void listen(PluginCall call) {
        if (!"android_tv".equals(BuildConfig.PHIM4K_PLATFORM)) {
            call.reject("Tìm kiếm giọng nói chỉ bật trên bản Android TV.");
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("locale", "vi-VN"));
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Nói tên phim cần tìm"));
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("TV chưa cài dịch vụ nhận dạng giọng nói.");
            return;
        }
        startActivityForResult(call, intent, "voiceResult");
    }

    @ActivityCallback
    private void voiceResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Không nghe rõ tên phim. Hãy thử lại.");
            return;
        }
        ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
        if (text.isEmpty()) {
            call.reject("Không nghe rõ tên phim. Hãy thử lại.");
            return;
        }
        call.resolve(new JSObject().put("text", text));
    }
}
