package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.FormBody;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Cloud sync through the person's own Google Drive. The data goes in Drive's hidden app folder, which only this app
 * can see (the drive.appdata permission): the app can't see any of their other files and they can't see this one in
 * Drive. Nothing goes through a server of ours.
 *
 * This class only signs in and moves one file up and down. Deciding what to sync and when is done by the page
 * (js/cloud-sync.js), which gets its answers through window.thorCloudDone(id, json).
 */
final class CloudSync {
    static final int REQ_SIGN_IN = 3;

    private static final String SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    // The test app keeps its own file, so testing can never write over the real app's data.
    private static final String FILE = BuildConfig.DEBUG ? "sync-debug.json" : "sync.json";
    private static final String DRIVE = "https://www.googleapis.com/drive/v3/";
    private static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    // settings kept on this device only (Backup leaves these out)
    static final String PREF_ON = "cloudOn";
    static final String PREF_EMAIL = "cloudEmail";
    static final String PREF_STATE = "cloudState";

    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build();
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    // the sign-in waiting on Google's sheet
    private static String pendingSignIn;
    // a downloaded copy, handed to the page in pieces
    private static String downloaded = "";
    // an upload being put together from pieces
    private static final StringBuilder upload = new StringBuilder();

    private CloudSync() {}

    /** Google Play services is needed for the sign-in; devices without it keep using the backup files. */
    static boolean available(Context c) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(c) == ConnectionResult.SUCCESS;
        } catch (Throwable t) {
            return false;
        }
    }

    private static AuthorizationRequest request() {
        return AuthorizationRequest.builder()
                .setRequestedScopes(Collections.singletonList(new Scope(SCOPE)))
                .build();
    }

    /** Sends an answer to the page. */
    private static void reply(String id, JSONObject o) {
        MainActivity.callPage("window.thorCloudDone&&window.thorCloudDone(" + JSONObject.quote(id) + "," + JSONObject.quote(o.toString()) + ")");
    }

    private static JSONObject fail(String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false).put("message", message);
        } catch (Exception ignored) {
        }
        return o;
    }

    // signing in

    /** Shows Google's sheet if it is needed (first time, or access was taken away), then remembers the account. */
    static void signIn(final Activity a, final String id) {
        try {
            Identity.getAuthorizationClient(a).authorize(request())
                    .addOnSuccessListener(r -> {
                        if (r.hasResolution()) {
                            PendingIntent pi = r.getPendingIntent();
                            try {
                                pendingSignIn = id;
                                a.startIntentSenderForResult(pi.getIntentSender(), REQ_SIGN_IN, null, 0, 0, 0, null);
                            } catch (Exception e) {
                                pendingSignIn = null;
                                reply(id, fail("Google sign-in could not be opened."));
                            }
                        } else {
                            finishSignIn(a, id, r);
                        }
                    })
                    .addOnFailureListener(e -> reply(id, fail("Google sign-in failed: " + e.getMessage())));
        } catch (Throwable t) {
            reply(id, fail("Google sign-in isn't available on this device."));
        }
    }

    /** Google's sheet closed. */
    static void onSignInResult(Activity a, int resultCode, Intent data) {
        String id = pendingSignIn;
        pendingSignIn = null;
        if (id == null) return;
        if (resultCode != Activity.RESULT_OK || data == null) {
            reply(id, fail("Sign-in was cancelled."));
            return;
        }
        try {
            AuthorizationResult r = Identity.getAuthorizationClient(a).getAuthorizationResultFromIntent(data);
            finishSignIn(a, id, r);
        } catch (Exception e) {
            reply(id, fail("Google sign-in failed: " + e.getMessage()));
        }
    }

    private static void finishSignIn(final Context c, final String id, final AuthorizationResult r) {
        final String token = r.getAccessToken();
        if (token == null) {
            reply(id, fail("Google didn't give access to Drive."));
            return;
        }
        IO.execute(() -> {
            String email = "";
            try {
                JSONObject about = getJson(token, DRIVE + "about?fields=user(emailAddress)");
                email = about.optJSONObject("user") != null ? about.getJSONObject("user").optString("emailAddress", "") : "";
            } catch (Exception ignored) {
                // the account name is only for show
            }
            Prefs.put(c, PREF_ON, "1");
            Prefs.put(c, PREF_EMAIL, email);
            JSONObject o = new JSONObject();
            try {
                o.put("ok", true).put("email", email);
            } catch (Exception ignored) {
            }
            reply(id, o);
        });
    }

    /** A token without showing anything, or null when the person has to sign in again. Not on the main thread. */
    private static String silentToken(Context c) {
        try {
            AuthorizationResult r = Tasks.await(Identity.getAuthorizationClient(c).authorize(request()), 30, TimeUnit.SECONDS);
            if (r.hasResolution()) return null;
            return r.getAccessToken();
        } catch (Exception e) {
            return null;
        }
    }

    static boolean isOn(Context c) {
        return "1".equals(Prefs.get(c, PREF_ON, ""));
    }

    static JSONObject status(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("available", available(c));
            o.put("on", isOn(c));
            o.put("email", Prefs.get(c, PREF_EMAIL, ""));
            o.put("device", (android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL).trim());
        } catch (Exception ignored) {
        }
        return o;
    }

    /** Turns sync off on this device; with deleteCopy the cloud copy goes too. Access is handed back to Google. */
    static void signOut(final Context c, final String id, final boolean deleteCopy) {
        IO.execute(() -> {
            String token = silentToken(c);
            if (token != null) {
                try {
                    if (deleteCopy) {
                        String fileId = findFile(token).optString("id", "");
                        if (!fileId.isEmpty()) send(token, new Request.Builder().url(DRIVE + "files/" + fileId).delete());
                    }
                } catch (Exception ignored) {
                }
                try {
                    HTTP.newCall(new Request.Builder().url("https://oauth2.googleapis.com/revoke")
                            .post(new FormBody.Builder().add("token", token).build()).build()).execute().close();
                } catch (Exception ignored) {
                }
            }
            Prefs.remove(c, PREF_ON);
            Prefs.remove(c, PREF_EMAIL);
            Prefs.remove(c, PREF_STATE);
            JSONObject o = new JSONObject();
            try {
                o.put("ok", true);
            } catch (Exception ignored) {
            }
            reply(id, o);
        });
    }

    // the cloud copy

    /** What the cloud copy is: {ok, exists, fileId, rev, device, modified}, or needSignIn when access has gone. */
    static void meta(final Context c, final String id) {
        IO.execute(() -> {
            String token = silentToken(c);
            if (token == null) {
                reply(id, needSignIn());
                return;
            }
            try {
                JSONObject f = findFile(token);
                JSONObject o = new JSONObject().put("ok", true).put("exists", f.has("id"));
                if (f.has("id")) {
                    JSONObject props = f.optJSONObject("appProperties");
                    o.put("fileId", f.getString("id"));
                    o.put("modified", f.optString("modifiedTime", ""));
                    o.put("rev", props != null ? props.optString("rev", "") : "");
                    o.put("device", props != null ? props.optString("device", "") : "");
                }
                reply(id, o);
            } catch (Exception e) {
                reply(id, fail("Couldn't reach Google Drive: " + e.getMessage()));
            }
        });
    }

    /** Downloads the cloud copy; the page then reads it with chunk(i). Answers {ok, chunks}. */
    static void download(final Context c, final String id, final String fileId) {
        IO.execute(() -> {
            String token = silentToken(c);
            if (token == null) {
                reply(id, needSignIn());
                return;
            }
            try (Response r = HTTP.newCall(new Request.Builder()
                    .url(DRIVE + "files/" + fileId + "?alt=media")
                    .header("Authorization", "Bearer " + token).build()).execute()) {
                if (!r.isSuccessful() || r.body() == null) throw new Exception("HTTP " + r.code());
                downloaded = r.body().string();
                reply(id, new JSONObject().put("ok", true).put("chunks", chunkCount()));
            } catch (Exception e) {
                reply(id, fail("Couldn't download from Google Drive: " + e.getMessage()));
            }
        });
    }

    private static final int PIECE = 256 * 1024;

    private static int chunkCount() {
        return (downloaded.length() + PIECE - 1) / PIECE;
    }

    static String chunk(int i) {
        int from = i * PIECE;
        if (from >= downloaded.length()) return "";
        String s = downloaded.substring(from, Math.min(downloaded.length(), from + PIECE));
        if (i == chunkCount() - 1) downloaded = ""; // read to the end, so let it go
        return s;
    }

    static void putBegin() {
        synchronized (upload) {
            upload.setLength(0);
        }
    }

    static void put(String piece) {
        synchronized (upload) {
            upload.append(piece);
        }
    }

    /** Uploads what was put, as a new copy or over the existing one. Answers {ok, rev}. */
    static void putEnd(final Context c, final String id, final String fileId, final String rev) {
        final String text;
        synchronized (upload) {
            text = upload.toString();
            upload.setLength(0);
        }
        IO.execute(() -> {
            String token = silentToken(c);
            if (token == null) {
                reply(id, needSignIn());
                return;
            }
            try {
                JSONObject props = new JSONObject()
                        .put("rev", rev)
                        .put("device", (android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL).trim());
                JSONObject meta = new JSONObject().put("appProperties", props);
                boolean create = fileId == null || fileId.isEmpty();
                if (create) meta.put("name", FILE).put("parents", new JSONArray().put("appDataFolder"));
                RequestBody body = new MultipartBody.Builder()
                        .setType(MediaType.parse("multipart/related"))
                        .addPart(RequestBody.create(meta.toString(), JSON))
                        .addPart(RequestBody.create(text, JSON))
                        .build();
                Request.Builder b = new Request.Builder();
                if (create) b.url(UPLOAD + "?uploadType=multipart&fields=id").post(body);
                else b.url(UPLOAD + "/" + fileId + "?uploadType=multipart&fields=id").patch(body);
                send(token, b);
                reply(id, new JSONObject().put("ok", true).put("rev", rev));
            } catch (Exception e) {
                reply(id, fail("Couldn't upload to Google Drive: " + e.getMessage()));
            }
        });
    }

    // Drive calls

    private static JSONObject needSignIn() {
        JSONObject o = fail("Sign in to Google again to keep syncing.");
        try {
            o.put("needSignIn", true);
        } catch (Exception ignored) {
        }
        return o;
    }

    private static JSONObject findFile(String token) throws Exception {
        String q = URLEncoder.encode("name = '" + FILE + "'", "UTF-8");
        JSONObject res = getJson(token, DRIVE + "files?spaces=appDataFolder&q=" + q
                + "&orderBy=modifiedTime%20desc&pageSize=5&fields=files(id,modifiedTime,appProperties)");
        JSONArray files = res.optJSONArray("files");
        return files != null && files.length() > 0 ? files.getJSONObject(0) : new JSONObject();
    }

    private static JSONObject getJson(String token, String url) throws Exception {
        return new JSONObject(send(token, new Request.Builder().url(url)));
    }

    private static String send(String token, Request.Builder b) throws Exception {
        try (Response r = HTTP.newCall(b.header("Authorization", "Bearer " + token).build()).execute()) {
            String s = r.body() != null ? r.body().string() : "";
            if (!r.isSuccessful()) throw new Exception("HTTP " + r.code());
            return s.isEmpty() ? "{}" : s;
        }
    }
}
