package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.regex.Pattern;

/**
 * A small browser inside the app, used for YouTube walkthrough searches and any other link in the tracker.
 * Back (or a swipe from the edge) steps back through the pages and then returns to the tracker; Close returns
 * at once. When it was opened to find a walkthrough, "Save video" sends the open video's link to the tracker.
 */
public class WebViewerActivity extends Activity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_MODE = "mode";
    /** Mode that shows the Save video button. */
    static final String MODE_WALKTHROUGH = "walkthrough";

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int BAR = Color.rgb(34, 29, 50);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEAL = Color.rgb(89, 201, 165);
    private static final int TEXT = Color.rgb(236, 232, 247);

    /** A page that is one video or a playlist. */
    private static final Pattern VIDEO_URL = Pattern.compile(
            "^https?://([a-z0-9-]+\\.)?(youtube\\.com/(watch\\?([^#]*&)?v=|shorts/|live/|playlist\\?([^#]*&)?list=)|youtu\\.be/)[\\w-]+.*",
            Pattern.CASE_INSENSITIVE);

    private FrameLayout root;
    private LinearLayout page;
    private WebView web;
    private TextView titleView;
    private Button saveBtn;
    private Button backBtn;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private String mode = "";
    private String currentUrl = "";

    static void open(Context from, String url, String mode) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        Intent i = new Intent(from, WebViewerActivity.class);
        i.putExtra(EXTRA_URL, url);
        i.putExtra(EXTRA_MODE, mode == null ? "" : mode);
        if (!(from instanceof Activity)) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            from.startActivity(i);
        } catch (Exception e) {
            Toast.makeText(from, "Could not open that page.", Toast.LENGTH_SHORT).show();
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private Button barButton(String label, int color) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(color);
        b.setTextSize(14);
        b.setBackgroundColor(Color.TRANSPARENT);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(10), 0, dp(10), 0);
        return b;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);
        mode = getIntent().getStringExtra(EXTRA_MODE);
        if (mode == null) mode = "";
        if (url == null) {
            finish();
            return;
        }
        currentUrl = url;

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setBackgroundColor(BG);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(BAR);

        Button close = barButton("✕ Close", TEXT);
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        bar.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)));

        backBtn = barButton("‹", TEXT);
        backBtn.setTextSize(22);
        backBtn.setVisibility(View.GONE);
        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (web != null && web.canGoBack()) web.goBack();
            }
        });
        bar.addView(backBtn, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)));

        titleView = new TextView(this);
        titleView.setTextColor(TEXT);
        titleView.setTextSize(13);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        titleView.setPadding(dp(6), 0, dp(6), 0);
        bar.addView(titleView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        saveBtn = barButton("＋ Save video", GOLD);
        saveBtn.setVisibility(View.GONE);
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                MainActivity.deliverLink(currentUrl);
                finish();
            }
        });
        bar.addView(saveBtn, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)));

        Button browser = barButton("↗", TEAL);
        browser.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(currentUrl)));
                } catch (Exception ignored) {
                }
            }
        });
        bar.addView(browser, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)));

        page.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        // Sites treat "wv" as an embedded browser and sometimes push their own app; a plain mobile browser name avoids that.
        ws.setUserAgentString(ws.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
                if (scheme.equals("http") || scheme.equals("https")) return false;
                // app links (vnd.youtube:, intent:, market:) would leave the viewer, so they are ignored
                if (scheme.equals("mailto") || scheme.equals("tel")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u));
                    } catch (Exception ignored) {
                    }
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                track(url);
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                super.doUpdateVisitedHistory(view, url, isReload);
                track(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                track(url);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (title != null && !title.isEmpty()) titleView.setText(title);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                page.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                hideCustomView();
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String dl, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                if (!dl.startsWith("http")) return;
                String name = URLUtil.guessFileName(dl, contentDisposition, mimeType);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(dl));
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                Toast.makeText(WebViewerActivity.this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            }
        });

        page.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(page, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        titleView.setText(url);
        web.loadUrl(url);
    }

    /** Keeps the current address and shows Save video only on a video page when opened for a walkthrough. */
    private void track(String url) {
        if (url == null) return;
        currentUrl = url;
        if (saveBtn != null) {
            boolean show = MODE_WALKTHROUGH.equals(mode) && VIDEO_URL.matcher(url).matches();
            saveBtn.setVisibility(show ? View.VISIBLE : View.GONE);
        }
        if (backBtn != null && web != null) backBtn.setVisibility(web.canGoBack() ? View.VISIBLE : View.GONE);
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        page.setVisibility(View.VISIBLE);
        if (customCallback != null) {
            customCallback.onCustomViewHidden();
            customCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        if (customView != null) hideCustomView();
        if (web != null) {
            // stop any video so its sound never carries on behind the tracker
            web.loadUrl("about:blank");
            web.stopLoading();
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
