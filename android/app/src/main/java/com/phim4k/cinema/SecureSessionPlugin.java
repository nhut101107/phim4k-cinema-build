package com.phim4k.cinema;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    private static final String KEY_ALIAS = "phim4k.session.v1";
    private static final String PREFS = "phim4k-secure-session";
    private static final String VALUE = "sealed";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .setKeySize(256)
         .setRandomizedEncryptionRequired(true)
         .build());
        return generator.generateKey();
    }

    private String seal(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP | Base64.URL_SAFE)
            + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP | Base64.URL_SAFE);
    }

    private String open(String value) throws Exception {
        String[] parts = value.split("\\.", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid secure session");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP | Base64.URL_SAFE);
        byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP | Base64.URL_SAFE);
        if (iv.length != 12 || encrypted.length < 16 || encrypted.length > 16 * 1024) throw new IllegalArgumentException("Invalid secure session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String encrypted = prefs().getString(VALUE, "");
        if (encrypted.isEmpty()) {
            call.resolve(new JSObject().put("value", ""));
            return;
        }
        try {
            call.resolve(new JSObject().put("value", open(encrypted)));
        } catch (Exception error) {
            prefs().edit().remove(VALUE).apply();
            call.reject("Secure session could not be decrypted.");
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value", "");
        if (value.length() > 16 * 1024) {
            call.reject("Secure session is too large.");
            return;
        }
        try {
            prefs().edit().putString(VALUE, seal(value)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure session could not be stored.");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        prefs().edit().remove(VALUE).apply();
        call.resolve();
    }
}
