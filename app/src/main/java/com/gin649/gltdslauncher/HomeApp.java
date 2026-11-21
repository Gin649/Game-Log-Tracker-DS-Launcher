package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

/** Whether the launcher is the device's home app, and asking Android to make it one. */
final class HomeApp {

    private HomeApp() {
    }

    static boolean isHome(Context ctx) {
        try {
            RoleManager rm = ctx.getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME)) return rm.isRoleHeld(RoleManager.ROLE_HOME);
        } catch (Exception ignored) {
        }
        // some devices don't use roles for this: check what the Home button opens instead
        try {
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            android.content.pm.ResolveInfo r = ctx.getPackageManager()
                    .resolveActivity(home, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null && ctx.getPackageName().equals(r.activityInfo.packageName);
        } catch (Exception e) {
            return false;
        }
    }

    /** Android's own "use this as your home app?" box, or its Home app settings when that box isn't offered. */
    static void ask(Activity a, int requestCode) {
        try {
            RoleManager rm = a.getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_HOME) && !rm.isRoleHeld(RoleManager.ROLE_HOME)) {
                a.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME), requestCode);
                return;
            }
        } catch (Exception ignored) {
        }
        openHomeSettings(a);
    }

    /** Android's Home app settings, where any home app can be picked. */
    static void openHomeSettings(Activity a) {
        try {
            a.startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));
        } catch (Exception e) {
            try {
                a.startActivity(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS));
            } catch (Exception ignored) {
            }
        }
    }
}
