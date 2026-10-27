package com.gin649.gltthor;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** The top screen: art for the game open in the tracker, or the logo. */
public class ArtActivity extends Activity implements ArtBus.Listener {

    static volatile boolean alive;

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEAL = Color.rgb(89, 201, 165);

    private ImageView art;
    private ImageView logo;
    private LinearLayout caption;
    private TextView titleView;
    private TextView consoleView;
    private int token;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        alive = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
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

        setContentView(root);
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
        ArtBus.attach(this);
        render(ArtBus.get());
    }

    @Override
    protected void onPause() {
        ArtBus.attach(null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        alive = false;
        super.onDestroy();
    }

    @Override
    public void onArt(ArtBus.State s) {
        render(s);
    }

    private void render(final ArtBus.State s) {
        final int mine = ++token;

        if (!s.game) {
            art.setImageDrawable(null);
            logo.setVisibility(View.VISIBLE);
            titleView.setText("Game Log Tracker");
            consoleView.setText("");
            consoleView.setVisibility(View.GONE);
            caption.setVisibility(View.VISIBLE);
            return;
        }

        titleView.setText(s.title);
        consoleView.setText(s.console);
        consoleView.setVisibility(s.console.isEmpty() ? View.GONE : View.VISIBLE);
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
                            logo.setVisibility(View.GONE);
                            art.setImageBitmap(bitmap);
                        } else {
                            art.setImageDrawable(null);
                            logo.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        }).start();
    }
}
