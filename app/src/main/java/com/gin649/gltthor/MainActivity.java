package com.gin649.gltthor;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The bottom screen: the tracker in a WebView, or the logo while setup is open. */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 1;
    private static final int BG = Color.rgb(21, 18, 31);

    private FrameLayout root;
    private LinearLayout splash;
    private TextView splashHint;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean hadStorage;
    private WebViewAssetLoader assetLoader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        Config.load(this);
        Shared.init(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(BG);
        splash.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int size = Math.round(Math.min(getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels) * 0.5f);
        splash.addView(logo, new LinearLayout.LayoutParams(size, size));

        splashHint = new TextView(this);
        splashHint.setTextColor(Color.rgb(228, 169, 63));
        splashHint.setTextSize(16);
        splashHint.setGravity(Gravity.CENTER);
        splashHint.setPadding(0, 24, 0, 0);
        splash.addView(splashHint);

        splash.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (!SetupActivity.running) openSetup();
            }
        });

        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        SetupActivity.setListener(new SetupActivity.Listener() {
            @Override
            public void onClosed(final boolean completed) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        onSetupClosed(completed);
                    }
                });
            }
        });

        if (Prefs.setupDone(this)) {
            startTracker();
        } else {
            splashHint.setText("Setting up...");
            openSetup();
        }
    }

    private void onSetupClosed(boolean completed) {
        if (isFinishing() || isDestroyed()) return;
        if (completed) {
            recreate();
        } else if (Prefs.setupDone(this)) {
            splash.setVisibility(View.GONE);
        } else {
            splashHint.setText("Tap to continue setup");
        }
    }

    /** Opens the setup wizard on the top screen, leaving the logo here. */
    void openSetup() {
        if (SetupActivity.running) return;
        splash.setVisibility(View.VISIBLE);
        splashHint.setText("Setup is open on the other screen");

        Intent i = new Intent(this, SetupActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        int id = DisplayPicker.topDisplayId(this);
        try {
            if (id >= 0) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setLaunchDisplayId(id);
                startActivity(i, options.toBundle());
            } else {
                startActivity(i);
            }
        } catch (Exception e) {
            startActivity(i);
        }
    }

    /**
     * Lays the tracker out at the chosen number of CSS pixels and lets the WebView scale that to
     * the real width of the bottom screen, so the page always fits no matter what the display
     * density is reported as.
     */
    private void applyViewport(WebView view) {
        int css = Prefs.getInt(this, "cssWidth", 720);
        if (css <= 0) css = 720;
        String js = "(function(){var m=document.querySelector('meta[name=viewport]');"
                + "if(!m){m=document.createElement('meta');m.name='viewport';"
                + "(document.head||document.documentElement).appendChild(m);}"
                + "m.setAttribute('content','width=" + css + ",viewport-fit=cover');})();";
        view.evaluateJavascript(js, null);
    }

    /**
     * Calls the RetroAchievements Web API straight from the app. There is no CORS check outside the
     * browser, so the tracker does not need the Worker or any public proxy for these requests.
     */
    private WebResourceResponse fetchRetroAchievements(Uri u) {
        String endpoint = u.getPath().substring(4);
        if (!endpoint.matches("API_[A-Za-z]+\\.php")) return errorResponse(400, "Bad request");
        String q = u.getEncodedQuery();
        String target = "https://retroachievements.org/API/" + endpoint + (q == null ? "" : "?" + q);
        try {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(target).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new java.io.ByteArrayInputStream(new byte[0]);
            if (code >= 300 && code < 400) code = 502;
            java.util.Map<String, String> headers = new java.util.HashMap<String, String>();
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse("application/json", "UTF-8", code,
                    code >= 400 ? "Error" : "OK", headers, in);
        } catch (Exception e) {
            return errorResponse(502, "Bad gateway");
        }
    }

    private WebResourceResponse errorResponse(int code, String reason) {
        return new WebResourceResponse("application/json", "UTF-8", code, reason,
                new java.util.HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    private void startTracker() {
        if (webView != null) return;

        webView = new WebView(this);
        webView.setBackgroundColor(BG);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUserAgentString(ws.getUserAgentString() + " GLTThor/1");

        // The tracker is bundled in assets/www and served from https://appassets.androidplatform.net/assets/...
        // That is a real https origin, so IndexedDB, fetch to the Cloudflare workers and CORS all behave normally.
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(Config.APP_HOST_BUILTIN)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.addJavascriptInterface(new ThorBridge(this), "ThorBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                applyViewport(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyViewport(view);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (Config.APP_HOST_BUILTIN.equals(u.getHost()) && u.getPath() != null
                        && u.getPath().startsWith("/ra/")) {
                    return fetchRetroAchievements(u);
                }
                return assetLoader.shouldInterceptRequest(u);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (Config.APP_HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadDataWithBaseURL(null,
                            "<html><body style='background:#15121f;color:#ece8f7;font-family:sans-serif;padding:24px'>"
                                    + "<h3 style='color:#e4a93f'>Could not load the tracker</h3>"
                                    + "<p>Check the connection, then try again.</p>"
                                    + "<p><a style='color:#59c9a5' href='" + Config.START_URL + "'>Retry</a></p>"
                                    + "</body></html>",
                            "text/html", "UTF-8", null);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                // blob: downloads are handed to the app by the tracker's own code (thor.js)
                if (!url.startsWith("http")) return;
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            }
        });

        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash.setVisibility(View.GONE);
        webView.loadUrl(Config.START_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();

        boolean granted = Environment.isExternalStorageManager();
        if (granted && !hadStorage) Shared.rescan();
        hadStorage = granted;

        if (Prefs.setupDone(this)) ensureArtScreen();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        SetupActivity.setListener(null);
        super.onDestroy();
    }

    private void ensureArtScreen() {
        if (ArtActivity.alive || SetupActivity.running) return;
        int id = DisplayPicker.topDisplayId(this);
        if (id < 0) return;
        Intent i = new Intent(this, ArtActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ActivityOptions options = ActivityOptions.makeBasic();
            options.setLaunchDisplayId(id);
            startActivity(i, options.toBundle());
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.getVisibility() == View.VISIBLE
                && splash.getVisibility() != View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
