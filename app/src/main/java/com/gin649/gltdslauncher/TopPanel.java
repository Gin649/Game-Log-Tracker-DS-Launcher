package com.gin649.gltdslauncher;

import android.os.Handler;
import android.os.Looper;

/**
 * Carries the tracker's header and profile card to the top screen, and taps on them back.
 * The tracker page sends a copy of the markup whenever it changes (mirror.js); the top screen draws
 * it (ArtActivity); a tap there is passed to the real button in the tracker page.
 */
final class TopPanel {

    interface Listener {
        void onPanel(String html, String bodyClass);

        /** The controller scrolled the open menu on the top screen. */
        void onMenuScroll(double dy);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static MainActivity host;
    private static Listener listener;
    private static String html = "";
    private static String body = "";
    private static boolean viewAlive;

    private TopPanel() {
    }

    static synchronized void attachHost(MainActivity a) {
        host = a;
    }

    static synchronized void detachHost(MainActivity a) {
        if (host == a) host = null;
    }

    static synchronized void attachView(Listener l) {
        listener = l;
    }

    static synchronized String html() {
        return html;
    }

    static synchronized String body() {
        return body;
    }

    static synchronized boolean viewAlive() {
        return viewAlive;
    }

    /** The top screen's panel is up (or gone). The tracker hides its own header while it is up. */
    static synchronized void setViewAlive(boolean alive) {
        viewAlive = alive;
        if (!alive) {
            html = "";
            body = "";
        }
        MainActivity h = host;
        if (h != null) h.runMirror("setActive(" + alive + ")");
    }

    /** New markup from the tracker page. */
    static synchronized void set(final String newHtml, final String newBody) {
        html = newHtml == null ? "" : newHtml;
        body = newBody == null ? "" : newBody;
        final Listener l = listener;
        if (l != null) {
            final String h = html, b = body;
            MAIN.post(new Runnable() {
                @Override
                public void run() {
                    l.onPanel(h, b);
                }
            });
        }
    }

    /** Puts the art screen back in front on the top display (a game just closed). */
    static void bringArtFront() {
        final MainActivity h;
        synchronized (TopPanel.class) {
            h = host;
        }
        if (h == null) return;
        MAIN.post(new Runnable() {
            @Override
            public void run() {
                h.showArtScreen();
            }
        });
    }

    /** The controller scrolled the open menu; the top screen scrolls its copy. */
    static void scrollMenu(final double dy) {
        final Listener l;
        synchronized (TopPanel.class) {
            l = listener;
        }
        if (l == null) return;
        MAIN.post(new Runnable() {
            @Override
            public void run() {
                l.onMenuScroll(dy);
            }
        });
    }

    /** The top screen's copy was tapped. An empty id means a tap outside the menu. */
    static void tap(String id) {
        MainActivity h;
        synchronized (TopPanel.class) {
            h = host;
        }
        if (h == null || id == null || !id.matches("[\\w-]*")) return;
        h.runMirror("click('" + id + "')");
    }
}
