package com.phim4k.cinema;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.security.MessageDigest;
import java.util.UUID;

@CapacitorPlugin(name = "ReleaseDownloads")
public class ReleaseDownloadsPlugin extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences("release-download", Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private JSObject state() {
        JSObject result = new JSObject();
        long id = prefs().getLong("id", -1);
        result.put("status", "missing");
        if (id < 0 || manager() == null) return result;
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor != null && cursor.moveToFirst()) {
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                long done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                if (total > 128L * 1024 * 1024 || done > 128L * 1024 * 1024) {
                    manager().remove(id);
                    result.put("status", "failed");
                    return result;
                }
                result.put("status", status == DownloadManager.STATUS_SUCCESSFUL ? "complete" : status == DownloadManager.STATUS_FAILED ? "failed" : "downloading");
                result.put("percent", total > 0 ? Math.min(100, (int)(100 * done / total)) : -1);
            }
        }
        return result;
    }
    @PluginMethod public void start(PluginCall call) {
        try {
            String raw = call.getString("url", "");
            Uri uri = Uri.parse(raw);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || raw.length() > 2048) { call.reject("Link tải HTTPS không hợp lệ."); return; }
            if (manager() == null) { call.reject("TV không có dịch vụ tải hệ thống. Hãy tải APK bằng điện thoại rồi chuyển sang TV."); return; }
            JSObject existing = state();
            if (raw.equals(prefs().getString("url", "")) && ("complete".equals(existing.getString("status")) || "downloading".equals(existing.getString("status")))) { call.resolve(existing); return; }
            String name = "Phim4K-update-" + UUID.randomUUID() + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle("Cập nhật Phim4K TV")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            long id = manager().enqueue(request);
            prefs().edit().putLong("id", id).putString("url", raw).putString("file", name).apply();
            call.resolve(state());
        } catch (Exception error) { call.reject("Không thể bắt đầu tải APK. Kiểm tra mạng và dung lượng TV."); }
    }
    @PluginMethod public void status(PluginCall call) {
        try { call.resolve(state()); }
        catch (Exception error) { call.reject("Không đọc được tiến độ tải. Hãy thử lại."); }
    }
    @SuppressWarnings("deprecation")
    private boolean sameSigner(File file) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        int flag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo incoming = pm.getPackageArchiveInfo(file.getAbsolutePath(), flag);
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), flag);
        if (incoming == null || !installed.packageName.equals(incoming.packageName) || incoming.versionCode < installed.versionCode) return false;
        android.content.pm.Signature[] incomingKeys = Build.VERSION.SDK_INT >= 28 ? incoming.signingInfo.getApkContentsSigners() : incoming.signatures;
        android.content.pm.Signature[] currentKeys = Build.VERSION.SDK_INT >= 28 ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        return incomingKeys.length == 1 && currentKeys.length == 1 && MessageDigest.isEqual(incomingKeys[0].toByteArray(), currentKeys[0].toByteArray());
    }
    @PluginMethod public void install(PluginCall call) {
        try {
            if (!"complete".equals(state().getString("status"))) { call.reject("APK chưa tải xong."); return; }
            File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File file = new File(directory, prefs().getString("file", "missing"));
            if (directory == null || !file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator) || !sameSigner(file)) { call.reject("APK không đúng Phim4K hoặc chữ ký không khớp. Không cài file này."); return; }
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                call.resolve(new JSObject().put("needsPermission", true)); return;
            }
            Uri uri = manager().getUriForDownloadedFile(prefs().getLong("id", -1));
            if (uri == null) { call.reject("Không tìm thấy APK đã tải."); return; }
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve(new JSObject().put("installerOpened", true));
        } catch (Exception error) { call.reject("TV không mở được màn cài đặt. Kiểm tra quyền cài ứng dụng từ nguồn này."); }
    }
}
