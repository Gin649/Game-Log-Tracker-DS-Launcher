package com.gin649.gltdslauncher;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * The top screen: art for the game open in the tracker. Otherwise the tracker's header and profile card
 * (a live copy, see TopPanel), or the logo when that isn't available.
 */
public class ArtActivity extends Activity implements ArtBus.Listener, TopPanel.Listener {

    static volatile boolean alive;
    /** True while the art screen is the one showing on the top display. */
    static volatile boolean resumed;

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEAL = Color.rgb(89, 201, 165);

    /** Colours for the app theme: page background, title colour, console line colour, and the label drawn as the mark. */
    private static int[] themeColors(String t) {
        if ("nintendo".equals(t)) return new int[]{Color.rgb(13, 13, 13), Color.rgb(230, 0, 18), Color.rgb(232, 208, 160)};
        if ("playstation".equals(t)) return new int[]{Color.rgb(10, 14, 31), Color.rgb(74, 163, 255), Color.rgb(174, 187, 214)};
        if ("xbox".equals(t)) return new int[]{Color.rgb(0, 0, 0), Color.rgb(136, 192, 80), Color.rgb(95, 168, 58)};
        return new int[]{BG, GOLD, TEAL};
    }

    private FrameLayout rootView;

    /** The theme's console logo from assets (www/logos/<theme>.png), or null. */
    private android.graphics.Bitmap markFor(String t) {
        try {
            java.io.InputStream in = getAssets().open("www/logos/" + t + ".png");
            try {
                return android.graphics.BitmapFactory.decodeStream(in);
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return null;
        }
    }

    private ImageView art;
    private ImageView logo;
    private WebView panel;
    private volatile boolean panelReady;
    private boolean startupOn;
    private static volatile ArtActivity instance;
    private boolean artShown;
    private String panelHtml = "";
    private WebViewAssetLoader assetLoader;
    private LinearLayout caption;
    private TextView titleView;
    private TextView consoleView;
    private int token;
    private TextView badge;
    private final Runnable hideBadge = new Runnable() {
        @Override
        public void run() {
            if (badge != null) badge.setVisibility(View.GONE);
        }
    };
    private boolean swiped;
    private int lastGameId, lastFanCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        alive = true;
        instance = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(BG);

        art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.FIT_CENTER);
        root.addView(art, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        logo = new ImageView(this);
        logo.setImageResource(R.drawable.logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        int logoSize = Math.round(getResources().getDisplayMetrics().heightPixels * 0.5f);
        FrameLayout.LayoutParams logoParams = new FrameLayout.LayoutParams(logoSize, logoSize);
        logoParams.gravity = Gravity.CENTER;
        root.addView(logo, logoParams);

        buildPanel(root);

        caption = new LinearLayout(this);
        caption.setOrientation(LinearLayout.VERTICAL);
        caption.setBackgroundColor(Color.argb(200, 21, 18, 31));
        int pad = Math.round(14 * getResources().getDisplayMetrics().density);
        caption.setPadding(pad, pad / 2, pad, pad / 2);

        titleView = new TextView(this);
        titleView.setTextColor(GOLD);
        titleView.setTextSize(22);
        titleView.setSingleLine(true);
        caption.addView(titleView);

        consoleView = new TextView(this);
        consoleView.setTextColor(TEAL);
        consoleView.setTextSize(14);
        consoleView.setSingleLine(true);
        caption.addView(consoleView);

        FrameLayout.LayoutParams capParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        capParams.gravity = Gravity.BOTTOM;
        root.addView(caption, capParams);

        badge = new TextView(this);
        badge.setTextColor(Color.WHITE);
        badge.setTextSize(16);
        badge.setSingleLine(true);
        badge.setTextColor(GOLD);
        badge.setPadding(pad, pad / 2, pad, pad / 2); // sits inside the title bar, on its bottom line, at the right
        badge.setVisibility(View.GONE);
        FrameLayout.LayoutParams badgeParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        badgeParams.gravity = Gravity.BOTTOM | Gravity.END;
        root.addView(badge, badgeParams);

        caption.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View v, int l, int t, int r, int b, int ol, int ot, int or, int ob) {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) panel.getLayoutParams();
                int h = b - t;
                if (lp.bottomMargin != h) {
                    lp.bottomMargin = h;
                    panel.setLayoutParams(lp);
                }
            }
        });

        setContentView(root);
        applyThemeNow();
        TopPanel.setViewAlive(true);
    }

    /** The header and profile card, drawn from markup the tracker sends (top.html). */
    @SuppressWarnings("SetJavaScriptEnabled")
    private void buildPanel(FrameLayout root) {
        panel = new WebView(this);
        panel.setBackgroundColor(Color.TRANSPARENT);
        panel.setVisibility(View.INVISIBLE);
        // Display only: taps go to the tracker through TopBridge, so the panel never needs focus or
        // text selection (a stuck selection tint is what showed up over the whole top screen).
        panel.setFocusable(false);
        panel.setFocusableInTouchMode(false);
        panel.setLongClickable(false);
        panel.setHapticFeedbackEnabled(false);
        panel.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true;
            }
        });
        WebSettings ws = panel.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setMediaPlaybackRequiresUserGesture(false); // the start-up animation has a sound

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(Config.APP_HOST_BUILTIN)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        panel.addJavascriptInterface(new TopBridge(), "TopBridge");
        panel.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                panelReady = true;
                applyThemeNow();
                applyPanel();
            }
        });
        root.addView(panel, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        panel.loadUrl(Config.BUILTIN_URL.replace("index.html", "top.html"));
    }

    /** Taps on the panel are passed to the real header in the tracker. */
    private final class TopBridge {
        @JavascriptInterface
        public void tap(String id) {
            TopPanel.tap(id);
        }
    }

    private void applyPanel() {
        if (!panelReady) return;
        panel.evaluateJavascript("GLTTop.set(" + JSONObject.quote(panelHtml) + ","
                + JSONObject.quote(TopPanel.body()) + ")", null);
        syncFallback();
    }

    /** With no game art showing, the header panel fills the screen if there is one, otherwise the logo. */
    private void syncFallback() {
        if (startupOn) {
            panel.setVisibility(View.VISIBLE);
            logo.setVisibility(View.GONE);
            return;
        }
        boolean fallback = !artShown;
        boolean usePanel = fallback && panelReady && !panelHtml.isEmpty();
        panel.setVisibility(usePanel ? View.VISIBLE : View.INVISIBLE);
        logo.setVisibility(fallback && !usePanel ? View.VISIBLE : View.GONE);
    }

    @Override
    public void onMenuScroll(double dy) {
        if (panelReady) panel.evaluateJavascript("GLTTop.scrollMenu(" + dy + ")", null);
    }

    @Override
    public void onPanel(String html, String bodyClass) {
        panelHtml = html == null ? "" : html;
        applyPanel();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onResume() {
        super.onResume();
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        resumed = true;
        TopPanel.setViewShown(true);
        ArtBus.attach(this);
        TopPanel.attachView(this);
        panelHtml = TopPanel.html();
        applyPanel();
        render(ArtBus.get());
    }

    @Override
    protected void onPause() {
        resumed = false;
        endStartup();
        TopPanel.setViewShown(false);
        ArtBus.attach(null);
        TopPanel.attachView(null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        alive = false;
        if (instance == this) instance = null;
        resumed = false;
        TopPanel.setViewAlive(false);
        if (panel != null) panel.destroy();
        super.onDestroy();
    }

    // The top screen can hold input focus too; pass controller input on to the tracker.
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (PadRouter.key(event)) return true;
        return super.dispatchKeyEvent(event);
    }

    // Swipe left or right to move between a game's fan arts. The touch still goes on to the panel underneath.
    private float downX, downY;
    private boolean tracking;

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        switch (ev.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = ev.getX();
                downY = ev.getY();
                tracking = artShown;
                break;
            case MotionEvent.ACTION_UP:
                if (tracking) {
                    float dx = ev.getX() - downX;
                    float dy = ev.getY() - downY;
                    float min = 70 * getResources().getDisplayMetrics().density;
                    if (Math.abs(dx) > min && Math.abs(dx) > 2 * Math.abs(dy)) {
                        swiped = true;
                        Shared.swipeFan(dx < 0 ? 1 : -1);
                    } else if (Math.abs(dx) < min / 3 && Math.abs(dy) < min / 3) {
                        // a tap: look online for all of the game's fan art, to swipe through
                        if (Shared.reloadFan()) showNote("Looking for fan art\u2026", 4000);
                    }
                }
                tracking = false;
                break;
            case MotionEvent.ACTION_CANCEL:
                tracking = false;
                break;
            default:
                break;
        }
        return super.dispatchTouchEvent(ev);
    }

    /** A short message on the badge, such as how the search for fan art went. */
    private void showNote(String text, long ms) {
        badge.removeCallbacks(hideBadge);
        badge.setText(text);
        badge.setVisibility(View.VISIBLE);
        badge.postDelayed(hideBadge, ms);
    }

    /** Puts a short message on the top screen's badge, from any thread. */
    static void note(final String text) {
        final ArtActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.showNote(text, 2500);
            }
        });
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (PadRouter.motion(event)) return true;
        return super.dispatchGenericMotionEvent(event);
    }

    @Override
    public void onArt(ArtBus.State s) {
        render(s);
    }

    /** Re-themes the top screen to match the app's theme. */
    static void applyTheme() {
        final ArtActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.applyThemeNow();
            }
        });
    }

    private void applyThemeNow() {
        if (panel == null) return;
        String t = Prefs.get(this, "theme", "retro");
        if ("nes".equals(t)) t = "nintendo";
        else if ("psx".equals(t)) t = "playstation";
        else if (!t.matches("[a-z]+") || "snes".equals(t)) t = "retro";
        int[] c = themeColors(t);
        if (rootView != null) rootView.setBackgroundColor(c[0]);
        if (caption != null) caption.setBackgroundColor(Color.argb(200, Color.red(c[0]), Color.green(c[0]), Color.blue(c[0])));
        if (titleView != null) titleView.setTextColor(c[1]);
        if (consoleView != null) consoleView.setTextColor(c[2]);
        if (badge != null) badge.setTextColor(c[1]);
        if (logo != null) {
            android.graphics.Bitmap mark = "retro".equals(t) ? null : markFor(t);
            if (mark == null) logo.setImageResource(R.drawable.logo);
            else logo.setImageBitmap(mark);
        }
        if (!panelReady) return;
        String js = "(function(d){var t='" + t + "';if(t==='retro')d.removeAttribute('data-theme');else d.setAttribute('data-theme',t);"
                + "d.style.fontSize=(t==='nintendo'?'11.2px':'');})(document.documentElement)";
        panel.evaluateJavascript(js, null);
    }

    /**
     * Plays the old-TV start-up animation on this screen. False when this screen isn't showing, so the
     * caller launches straight away instead of waiting for it.
     */
    static boolean playStartup(final String title) {
        final ArtActivity a = instance;
        if (a == null || !resumed || !a.panelReady) return false;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.startStartup(title);
            }
        });
        return true;
    }

    static void stopStartup() {
        final ArtActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                a.endStartup();
            }
        });
    }

    private void startStartup(String title) {
        if (!panelReady) return;
        startupOn = true;
        // the panel normally stops above the title bar; a hidden bar never reports its size, so clear it here
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) panel.getLayoutParams();
        lp.bottomMargin = 0;
        panel.setLayoutParams(lp);
        panel.setVisibility(View.VISIBLE);
        caption.setVisibility(View.GONE);
        badge.setVisibility(View.GONE);
        panel.evaluateJavascript("GLTCrt.start(" + JSONObject.quote(title == null ? "" : title) + ")", null);
    }

    private void endStartup() {
        if (!startupOn) return;
        startupOn = false;
        if (panelReady) panel.evaluateJavascript("GLTCrt.stop()", null);
        syncFallback();
        render(ArtBus.get());
    }

    private void render(final ArtBus.State s) {
        if (startupOn) return; // endStartup() draws the latest state when the animation is done
        final int mine = ++token;

        if (!s.game) {
            art.setImageDrawable(null);
            artShown = false;
            syncFallback();
            titleView.setText("Game Log Tracker DS Launcher");
            consoleView.setText("");
            consoleView.setVisibility(View.GONE);
            caption.setVisibility(View.VISIBLE);
            badge.setVisibility(View.GONE);
            lastGameId = 0;
            lastFanCount = 0;
            return;
        }

        titleView.setText(s.title);
        String line = s.console;
        // the position badge: 1 second after a swipe, 2 seconds when more fan art has just finished downloading
        boolean sameGame = s.gameId == lastGameId;
        boolean grew = sameGame && s.fanCount > lastFanCount && s.fanCount > 1;
        if (s.fanCount > 1 && (swiped || grew)) {
            badge.setText((swiped ? "" : "Fan art downloaded   ") + "\u2039  " + s.fanPos + " / " + s.fanCount + "  \u203A");
            badge.setVisibility(View.VISIBLE);
            badge.removeCallbacks(hideBadge);
            badge.postDelayed(hideBadge, swiped ? 1000 : 2000);
        } else if (!sameGame) {
            badge.removeCallbacks(hideBadge);
            badge.setVisibility(View.GONE);
        }
        swiped = false;
        lastGameId = s.gameId;
        lastFanCount = s.fanCount;
        consoleView.setText(line);
        consoleView.setVisibility(line.isEmpty() ? View.GONE : View.VISIBLE);
        caption.setVisibility(View.VISIBLE);

        final int w = getResources().getDisplayMetrics().widthPixels;
        final int h = getResources().getDisplayMetrics().heightPixels;
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap b = null;
                if (s.localPath != null) b = Images.decodeFile(s.localPath, w, h);
                if (b == null && s.remoteUrl != null && !s.remoteUrl.isEmpty()) {
                    b = Images.download(s.remoteUrl, w, h);
                }
                final Bitmap bitmap = b;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (mine != token || isFinishing()) return;
                        if (bitmap != null) {
                            art.setImageBitmap(bitmap);
                            artShown = true;
                        } else {
                            art.setImageDrawable(null);
                            artShown = false;
                        }
                        syncFallback();
                    }
                });
            }
        }).start();
    }
}
