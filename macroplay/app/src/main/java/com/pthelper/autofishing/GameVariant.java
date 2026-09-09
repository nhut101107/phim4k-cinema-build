package com.pthelper.autofishing;

import android.content.Context;
import android.content.Intent;

/**
 * The two published builds of Play Together. Both share the same UI layout, so the
 * calibrated coordinates are interchangeable; only the package id differs.
 */
public enum GameVariant {
    GLOBAL("com.haegin.playtogether", "GLOBAL", "Play Together (Global)"),
    VNG("com.vng.playtogether", "VNG", "Play Together VNG");

    public final String packageName;
    public final String shortLabel;
    public final String label;

    GameVariant(String packageName, String shortLabel, String label) {
        this.packageName = packageName;
        this.shortLabel = shortLabel;
        this.label = label;
    }

    public static GameVariant fromKey(String key) {
        return VNG.name().equals(key) ? VNG : GLOBAL;
    }

    /** True when the given event package belongs to either build. */
    public static boolean isGamePackage(CharSequence candidate) {
        if (candidate == null) {
            return false;
        }
        return GLOBAL.packageName.contentEquals(candidate) || VNG.packageName.contentEquals(candidate);
    }

    /** Returns the variant that is actually installed, preferring {@code preferred}. */
    public static GameVariant firstInstalled(Context context, GameVariant preferred) {
        if (preferred.isInstalled(context)) {
            return preferred;
        }
        GameVariant other = preferred == GLOBAL ? VNG : GLOBAL;
        return other.isInstalled(context) ? other : preferred;
    }

    public Intent launchIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(packageName);
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        }
        return launch;
    }

    public boolean isInstalled(Context context) {
        return context.getPackageManager().getLaunchIntentForPackage(packageName) != null;
    }
}
