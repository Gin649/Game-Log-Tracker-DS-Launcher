package com.gin649.gltthor;

import android.os.Handler;
import android.os.Looper;

/** What the top screen should show right now. */
final class ArtBus {

    interface Listener {
        void onArt(State s);
    }

    static final class State {
        boolean game;
        String title = "";
        String console = "";
        String localPath;
        String remoteUrl;

        static State logo() {
            return new State();
        }
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static State current = State.logo();
    private static Listener listener;

    private ArtBus() {}

    static synchronized State get() {
        return current;
    }

    static synchronized void attach(Listener l) {
        listener = l;
    }

    static synchronized void set(final State s) {
        current = s;
        final Listener l = listener;
        if (l != null) {
            MAIN.post(new Runnable() {
                @Override
                public void run() {
                    l.onArt(s);
                }
            });
        }
    }
}
