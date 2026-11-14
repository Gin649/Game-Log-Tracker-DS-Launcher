package com.gin649.gltdslauncher;

import android.app.Activity;
import android.graphics.Bitmap;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.AnimatorSet;
import android.animation.ObjectAnimator;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
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
    /** The game's cartridge or disc, floating over the fan art in the bottom right corner. */
    private ImageView cart;
    private boolean cartIsDisc;
    private int cartToken;
    private AnimatorSet cartAnim;
    private AnimatorSet cartIdle;
    private android.media.SoundPool sounds;
    private int soundNes, soundDisc, soundClunk;
    /** Which animation and sound the cartridge on show gets: an NES cartridge, any other cartridge, or a disc. */
    private int cartKind;
    /** Plain black over everything while the emulator takes the screen, so the fan art never flashes back up. */
    private View blackout;
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

        // Under the title bar, so the cartridge can slide down behind it as if into a slot.
        cart = new ImageView(this);
        cart.setScaleType(ImageView.ScaleType.FIT_END);
        cart.setAdjustViewBounds(true);
        cart.setVisibility(View.GONE);
        int cartSide = Math.round(getResources().getDisplayMetrics().heightPixels * 0.36f);
        FrameLayout.LayoutParams cartParams = new FrameLayout.LayoutParams(cartSide, cartSide);
        cartParams.gravity = Gravity.BOTTOM | Gravity.END;
        cartParams.rightMargin = Math.round(getResources().getDisplayMetrics().widthPixels * 0.025f);
        root.addView(cart, cartParams);

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
                // the cartridge sits just above the title bar
                FrameLayout.LayoutParams cp = (FrameLayout.LayoutParams) cart.getLayoutParams();
                int gap = h + Math.round(8 * getResources().getDisplayMetrics().density);
                if (cp.bottomMargin != gap) {
                    cp.bottomMargin = gap;
                    cart.setLayoutParams(cp);
                }
            }
        });

        blackout = new View(this);
        blackout.setBackgroundColor(Color.BLACK);
        blackout.setVisibility(View.GONE);
        root.addView(blackout, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // a cartridge going in and its power switch, the NES one being pressed down, and a disc drive spinning up
        try {
            sounds = new android.media.SoundPool.Builder().setMaxStreams(2)
                    .setAudioAttributes(new android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_GAME)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .build();
            soundNes = sounds.load(this, R.raw.cart_nes, 1);
            soundDisc = sounds.load(this, R.raw.disc_spin, 1);
            soundClunk = sounds.load(this, R.raw.cart_clunk, 1);
        } catch (Exception e) {
            sounds = null;
        }

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
        blackout.setVisibility(View.GONE);
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
        // A game is opening over this screen: go black behind the static rather than back to the fan art, which
        // used to show for a moment before the emulator appeared.
        if (startupOn) blackout.setVisibility(View.VISIBLE);
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
        if (sounds != null) sounds.release();
        cartShowing = false;
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

    private void startStartup(final String title) {
        if (!panelReady) return;
        if (!startupOn && cart.getVisibility() == View.VISIBLE && cart.getDrawable() != null) {
            // the cartridge goes in first, then the old TV comes on
            startupOn = true;
            insertCart(new Runnable() {
                @Override
                public void run() {
                    if (startupOn) startStatic(title);
                }
            });
            return;
        }
        startStatic(title);
    }

    /** How long a cartridge or disc takes to go in, before the old TV comes on. The launcher waits this much longer. */
    private static final int CART_INSERT_MS = 1700;
    /**
     * A cartridge's sound is the slide and clunk as it seats, then the click of a power switch. The clunk is this
     * far into the sound. The cartridge stays seated until the switch clicks, and that is when the old TV comes on.
     * The NES sound has one more step, as on the console: once the cartridge is in, it is pressed down.
     */
    private static final int CLUNK_AT_MS = 400;
    /** After the clunk: when the power switch clicks, for other cartridges and for the NES one. */
    private static final int SWITCH_AFTER_MS = 520, NES_SWITCH_AFTER_MS = 820;
    /** After the clunk: when the NES cartridge is pressed down, and how long the press takes. */
    private static final int NES_PRESS_AFTER_MS = 400, NES_PRESS_MS = 200;
    /** When the cartridge is seated: the float over, the pause and the drop (700 + 380 + 440). */
    private static final int SEATED_AT_MS = 1520;
    /** The bump and settle that follow the drop (70 + 110). */
    private static final int BUMP_MS = 180;

    private static final int KIND_CART = 0, KIND_NES = 1, KIND_DISC = 2;

    private static int insertMs(int kind) {
        if (kind == KIND_CART) return SEATED_AT_MS + SWITCH_AFTER_MS;
        if (kind == KIND_NES) return SEATED_AT_MS + NES_SWITCH_AFTER_MS;
        return CART_INSERT_MS;
    }

    /** The extra wait before a game starts while its cartridge goes in on this screen, or 0 when none is showing. */
    static int cartInsertMs() {
        return cartShowing && resumed ? insertMs(cartKindShowing) : 0;
    }

    private static volatile boolean cartShowing;
    private static volatile int cartKindShowing;

    /** Where the picture really is inside its square: {width, height, centre x, centre y}. It sits bottom right. */
    private float[] cartBox() {
        float w = cart.getWidth(), h = cart.getHeight();
        float pw = w, ph = h;
        android.graphics.drawable.Drawable d = cart.getDrawable();
        if (d != null && d.getIntrinsicWidth() > 0 && d.getIntrinsicHeight() > 0) {
            float k = Math.min(w / d.getIntrinsicWidth(), h / d.getIntrinsicHeight());
            pw = d.getIntrinsicWidth() * k;
            ph = d.getIntrinsicHeight() * k;
        }
        return new float[]{pw, ph, w - pw / 2f, h - ph / 2f};
    }

    /** While it floats in the corner the cartridge turns gently from side to side, so it is not a still picture. */
    private void startIdle() {
        if (cartIdle != null || cartAnim != null || cart.getWidth() == 0) return;
        float[] box = cartBox();
        cart.setPivotX(box[2]);
        cart.setPivotY(box[3]);
        cart.setCameraDistance(9000 * getResources().getDisplayMetrics().density);
        ObjectAnimator turn = ObjectAnimator.ofFloat(cart, View.ROTATION_Y, -20f, 20f);
        turn.setDuration(2600);
        turn.setRepeatCount(ObjectAnimator.INFINITE);
        turn.setRepeatMode(ObjectAnimator.REVERSE);
        turn.setInterpolator(new AccelerateDecelerateInterpolator());
        ObjectAnimator bob = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, 0f, -cart.getHeight() * 0.025f);
        bob.setDuration(1900);
        bob.setRepeatCount(ObjectAnimator.INFINITE);
        bob.setRepeatMode(ObjectAnimator.REVERSE);
        bob.setInterpolator(new AccelerateDecelerateInterpolator());
        AnimatorSet set = new AnimatorSet();
        set.playTogether(turn, bob);
        cartIdle = set;
        set.start();
    }

    private void stopIdle() {
        if (cartIdle != null) {
            cartIdle.cancel();
            cartIdle = null;
        }
    }

    /**
     * Play was pressed: the cartridge floats to the middle of the screen, hangs there a moment, then drops down
     * behind the title bar as if pushed into a slot, with a thunk as it seats. A disc spins up on the way, with the
     * sound of a drive, and is still spinning as it drops. Then the old TV comes on.
     */
    private void insertCart(final Runnable then) {
        if (cartAnim != null) cartAnim.cancel();
        stopIdle();
        View root = (View) cart.getParent();
        float[] box = cartBox();
        cart.setPivotX(box[2]);
        cart.setPivotY(box[3]);
        final float grow = 1.3f;
        float fromX = cart.getTranslationX(), fromY = cart.getTranslationY();
        // the middle of the screen, a little above centre so the drop has somewhere to go
        float midX = root.getWidth() / 2f - (cart.getLeft() + box[2]);
        float midY = root.getHeight() * 0.44f - (cart.getTop() + box[3]);
        // seated: most of it behind the title bar, the top edge still showing
        float barTop = root.getHeight() - (caption.getVisibility() == View.VISIBLE ? caption.getHeight() : 0);
        float tall = box[1] * grow;
        float seatY = (barTop - tall * 0.16f + tall / 2f) - (cart.getTop() + box[3]);

        AnimatorSet rise = new AnimatorSet();
        rise.playTogether(
                ObjectAnimator.ofFloat(cart, View.TRANSLATION_X, fromX, midX),
                ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, fromY, midY),
                ObjectAnimator.ofFloat(cart, View.SCALE_X, cart.getScaleX(), grow),
                ObjectAnimator.ofFloat(cart, View.SCALE_Y, cart.getScaleY(), grow),
                ObjectAnimator.ofFloat(cart, View.ROTATION_Y, cart.getRotationY(), 0f));
        rise.setDuration(700);
        rise.setInterpolator(new DecelerateInterpolator(1.6f));

        ObjectAnimator hang = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, midY, midY - tall * 0.03f, midY);
        hang.setDuration(380);

        ObjectAnimator down = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, midY, seatY);
        down.setDuration(440);
        down.setInterpolator(new AccelerateInterpolator(1.7f));
        ObjectAnimator bumpUp = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, seatY, seatY - tall * 0.035f);
        bumpUp.setDuration(70);
        bumpUp.setInterpolator(new DecelerateInterpolator());
        ObjectAnimator settle = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, seatY - tall * 0.035f, seatY);
        settle.setDuration(110);

        AnimatorSet path = new AnimatorSet();
        if (cartKind == KIND_CART) {
            // seated, it waits for the power switch to click
            ObjectAnimator wait = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, seatY, seatY);
            wait.setDuration(SWITCH_AFTER_MS - BUMP_MS);
            path.playSequentially(rise, hang, down, bumpUp, settle, wait);
        } else if (cartKind == KIND_NES) {
            // in, then pressed down a little further, then the power button
            float pressedY = seatY + tall * 0.09f;
            ObjectAnimator rest = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, seatY, seatY);
            rest.setDuration(NES_PRESS_AFTER_MS - BUMP_MS - NES_PRESS_MS);
            ObjectAnimator press = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, seatY, pressedY);
            press.setDuration(NES_PRESS_MS);
            press.setInterpolator(new AccelerateInterpolator(1.4f));
            ObjectAnimator wait = ObjectAnimator.ofFloat(cart, View.TRANSLATION_Y, pressedY, pressedY);
            wait.setDuration(NES_SWITCH_AFTER_MS - NES_PRESS_AFTER_MS);
            path.playSequentially(rise, hang, down, bumpUp, settle, rest, press, wait);
        } else {
            path.playSequentially(rise, hang, down, bumpUp, settle); // 700 + 380 + 440 + 70 + 110 = CART_INSERT_MS
        }
        final AnimatorSet set = new AnimatorSet();
        if (cartKind != KIND_DISC) {
            // started early, so the clunk in it lands just as the cartridge seats
            final int sound = cartKind == KIND_NES ? soundNes : soundClunk;
            cart.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (cartAnim == set) playSound(sound);
                }
            }, SEATED_AT_MS - CLUNK_AT_MS);
        }
        if (cartIsDisc) {
            ObjectAnimator spin = ObjectAnimator.ofFloat(cart, View.ROTATION, 0f, 2160f);
            spin.setDuration(CART_INSERT_MS);
            spin.setInterpolator(new AccelerateInterpolator(1.5f));
            set.playTogether(path, spin);
            playSound(soundDisc);
        } else {
            set.play(path);
        }
        set.addListener(new AnimatorListenerAdapter() {
            private boolean cancelled;

            @Override
            public void onAnimationCancel(Animator animation) {
                cancelled = true;
            }

            @Override
            public void onAnimationEnd(Animator animation) {
                cartAnim = null;
                if (!cancelled) then.run();
            }
        });
        cartAnim = set;
        set.start();
    }

    /** Puts the cartridge back where it floats, after a game or when another game is looked at. */
    private void resetCart() {
        if (cartAnim != null) cartAnim.cancel();
        stopIdle();
        cart.setTranslationX(0f);
        cart.setTranslationY(0f);
        cart.setScaleX(1f);
        cart.setScaleY(1f);
        cart.setRotation(0f);
        cart.setRotationY(0f);
    }

    private void playSound(int id) {
        try {
            if (sounds != null && id != 0) sounds.play(id, 0.9f, 0.9f, 1, 0, 1f);
        } catch (Exception ignored) { // no sound is fine
        }
    }

    private void startStatic(String title) {
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
        resetCart();
        if (panelReady) panel.evaluateJavascript("GLTCrt.stop()", null);
        syncFallback();
        render(ArtBus.get());
    }

    /**
     * Finds the cartridge or disc of the game on show and floats it in the corner. It shares the Start-up animation
     * switch: with that off there is no cartridge. A game with no cartridge picture simply has none here.
     */
    private void loadCart(ArtBus.State s) {
        final int mine = ++cartToken;
        final String[] v = Shared.viewingCart;
        boolean wanted = s.game && v != null && !v[0].isEmpty() && !"0".equals(Prefs.get(this, "startupAnim", "1"));
        if (!wanted) {
            cart.setImageDrawable(null);
            cart.setTag(null);
            syncCart();
            return;
        }
        final String key = v[0] + "\n" + v[1] + "\n" + v[2];
        if (key.equals(cart.getTag()) && cart.getDrawable() != null) { // the same game drawn again (another fan art)
            syncCart();
            return;
        }
        cart.setImageDrawable(null);
        cart.setTag(null);
        syncCart();
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap b = null;
                boolean disc = false, nes = Matcher.compact(v[1]).equals("nes");
                try {
                    java.io.File f = CartArt.find(ArtActivity.this, v[0], v[1], v[2], v[3], v[0].trim().startsWith("~"), false);
                    if (f != null) b = android.graphics.BitmapFactory.decodeFile(f.getPath());
                    if (Shells.pc(v[1])) disc = true;
                    SystemMap map = Shared.systems();
                    if (map != null) {
                        for (SystemMap.Sys sys : map.forConsole(v[1])) {
                            if ("disc".equals(sys.media)) disc = true;
                            if ("nes".equals(sys.folder) || "famicom".equals(sys.folder)) nes = true;
                        }
                    }
                } catch (Throwable ignored) {
                }
                final Bitmap bitmap = b;
                final boolean isDisc = disc;
                final int kind = disc ? KIND_DISC : nes ? KIND_NES : KIND_CART;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (mine != cartToken || isFinishing() || bitmap == null) return;
                        resetCart();
                        cartIsDisc = isDisc;
                        cartKind = kind;
                        cart.setImageBitmap(bitmap);
                        cart.setTag(key);
                        syncCart();
                    }
                });
            }
        }).start();
    }

    /** The cartridge shows over fan art only: not over the header panel or the logo, and not while a game starts up. */
    private void syncCart() {
        boolean show = cart.getDrawable() != null && artShown && (!startupOn || cartAnim != null);
        cart.setVisibility(show ? View.VISIBLE : View.GONE);
        cartShowing = show && !startupOn;
        cartKindShowing = cartKind;
        if (show && !startupOn) {
            // once it has a size: it has none until it has been laid out
            cart.post(new Runnable() {
                @Override
                public void run() {
                    if (cart.getVisibility() == View.VISIBLE && !startupOn) startIdle();
                }
            });
        } else if (!show) {
            stopIdle();
        }
    }

    private void render(final ArtBus.State s) {
        if (startupOn) return; // endStartup() draws the latest state when the animation is done
        final int mine = ++token;

        loadCart(s);
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
                        syncCart();
                    }
                });
            }
        }).start();
    }
}
