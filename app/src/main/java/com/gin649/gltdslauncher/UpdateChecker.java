package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Checks the latest GitHub release when the app starts and, if it is newer than the installed
 * build, offers to download and install it. The version code is worked out from the tag the same
 * way the release workflow does it (major * 10000 + minor * 100 + patch).
 */
public final class UpdateChecker {

    private static final String APK_NAME = "update.apk";
    private static final Pattern TAG = Pattern.compile("^[vV]?(\\d+)\\.(\\d+)\\.(\\d+)");

    private static boolean checked;
    private static long downloadId = -1;
    private static File pendingApk;

    private UpdateChecker() {
    }

    private static final class Release {
        String tag;
        String notes;
        String apkUrl;
        int versionCode;
    }

    /** Looks for a newer release once per app process. Does nothing on debug builds. */
    public static void check(final Activity activity) {
        if (BuildConfig.DEBUG || checked) return;
        final Context app = activity.getApplicationContext();

        new Thread(new Runnable() {
            @Override
            public void run() {
                // an APK left over from a previous update is no longer needed
                File old = apkFile(app);
                if (old != null && old.exists() && downloadId < 0) old.delete();

                final Release r = fetchLatest();
                if (r == null) return;
                checked = true;
                if (r.versionCode <= BuildConfig.VERSION_CODE) return;

                activity.runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (activity.isFinishing() || activity.isDestroyed()) return;
                        showDialog(activity, r);
                    }
                });
            }
        }).start();
    }

    /** Called from onResume: continues an install that was waiting on the "install unknown apps" setting. */
    public static void resumePendingInstall(Context context) {
        if (pendingApk == null) return;
        if (!context.getPackageManager().canRequestPackageInstalls()) return;
        File apk = pendingApk;
        pendingApk = null;
        install(context.getApplicationContext(), apk);
    }

    private static Release fetchLatest() {
        HttpURLConnection c = null;
        try {
            URL url = new URL("https://api.github.com/repos/" + BuildConfig.UPDATE_REPO + "/releases/latest");
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "GLTThor-updater");
            if (c.getResponseCode() != 200) return null;

            JSONObject json = new JSONObject(readAll(c.getInputStream()));
            Release r = new Release();
            r.tag = json.optString("tag_name", "");
            r.notes = json.optString("body", "");
            r.versionCode = versionCodeOf(r.tag);
            if (r.versionCode < 0) return null;

            JSONArray assets = json.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (a.optString("name", "").endsWith(".apk")) {
                        r.apkUrl = a.optString("browser_download_url", null);
                        break;
                    }
                }
            }
            return r.apkUrl == null ? null : r;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static int versionCodeOf(String tag) {
        Matcher m = TAG.matcher(tag);
        if (!m.find()) return -1;
        return Integer.parseInt(m.group(1)) * 10000
                + Integer.parseInt(m.group(2)) * 100
                + Integer.parseInt(m.group(3));
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private static void showDialog(final Activity activity, final Release r) {
        String message = "New update available: " + r.tag + "\n(you have " + BuildConfig.VERSION_NAME + ")"
                + "\n\nSee the GitHub or Discord for details.\n\nCheers!";

        new AlertDialog.Builder(activity)
                .setTitle("Update available")
                .setMessage(message)
                .setNegativeButton("Later", null)
                .setPositiveButton("Update", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        startDownload(activity.getApplicationContext(), r);
                    }
                })
                .show();
    }

    private static File apkFile(Context context) {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        return dir == null ? null : new File(dir, APK_NAME);
    }

    private static void startDownload(final Context context, Release r) {
        final File apk = apkFile(context);
        if (apk == null) {
            Toast.makeText(context, "No storage available for the update", Toast.LENGTH_LONG).show();
            return;
        }
        if (apk.exists()) apk.delete();

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(r.apkUrl));
        req.setTitle("Game Log Tracker " + r.tag);
        req.setMimeType("application/vnd.android.package-archive");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, APK_NAME);

        final DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                ctx.getApplicationContext().unregisterReceiver(this);
                downloadId = -1;

                if (!downloadSucceeded(dm, id)) {
                    Toast.makeText(ctx, "Update download failed", Toast.LENGTH_LONG).show();
                    return;
                }
                if (!isOurApk(ctx, apk)) {
                    apk.delete();
                    Toast.makeText(ctx, "Downloaded file is not a valid update", Toast.LENGTH_LONG).show();
                    return;
                }
                install(ctx.getApplicationContext(), apk);
            }
        };

        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(receiver, filter);
        }

        downloadId = dm.enqueue(req);
        Toast.makeText(context, "Downloading update...", Toast.LENGTH_SHORT).show();
    }

    private static boolean downloadSucceeded(DownloadManager dm, long id) {
        Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id));
        try {
            if (cur == null || !cur.moveToFirst()) return false;
            int status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            return status == DownloadManager.STATUS_SUCCESSFUL;
        } finally {
            if (cur != null) cur.close();
        }
    }

    /** The system installer enforces the signature; this just catches a wrong or broken file early. */
    private static boolean isOurApk(Context context, File apk) {
        PackageInfo info = context.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        return info != null
                && context.getPackageName().equals(info.packageName)
                && info.getLongVersionCode() > BuildConfig.VERSION_CODE;
    }

    private static void install(Context context, File apk) {
        if (!context.getPackageManager().canRequestPackageInstalls()) {
            pendingApk = apk;
            Toast.makeText(context, "Allow installs from this app, then come back", Toast.LENGTH_LONG).show();
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(settings);
            return;
        }

        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(i);
    }
}
