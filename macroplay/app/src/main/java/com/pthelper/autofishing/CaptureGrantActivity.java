package com.pthelper.autofishing;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

/**
 * Invisible activity that only asks for screen capture, then starts the macro
 * and finishes so the user stays on the game they already opened.
 */
public final class CaptureGrantActivity extends Activity {
    private static final int REQUEST_CAPTURE = 3101;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "Bật Trợ năng LeafNote rồi bấm Bắt đầu lại.", Toast.LENGTH_LONG).show();
            try {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (RuntimeException ignored) {
                // Settings page can be missing on some skins.
            }
            finish();
            return;
        }
        try {
            MediaProjectionManager manager =
                (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE);
        } catch (RuntimeException error) {
            Toast.makeText(this, "Thiết bị không hỗ trợ ghi màn hình.", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_CAPTURE) {
            finish();
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            Toast.makeText(this, "Bạn chưa cấp quyền chụp màn hình. Chưa thể chạy.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        Intent service = new Intent(this, FishingService.class)
            .setAction(FishingService.ACTION_START)
            .putExtra(FishingService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(FishingService.EXTRA_RESULT_DATA, data);
        try {
            startForegroundService(service);
            Toast.makeText(this, "Đang chạy trên màn hình đang mở.", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException error) {
            Toast.makeText(this, "Không khởi động được dịch vụ tự động.", Toast.LENGTH_LONG).show();
        }
        finish();
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
}
