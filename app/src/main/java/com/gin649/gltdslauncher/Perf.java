package com.gin649.gltdslauncher;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Map;
import java.util.TreeMap;

/** Counts and times the slow parts of start-up, and writes a short report a while after launch (perf.txt in the data folder). */
final class Perf {
    private Perf() {}

    private static final Map<String, long[]> M = new TreeMap<String, long[]>();
    private static final long START = System.currentTimeMillis();
    private static boolean scheduled;

    static synchronized void add(String name, long ms) {
        long[] a = M.get(name);
        if (a == null) {
            a = new long[3];
            M.put(name, a);
        }
        a[0]++;
        a[1] += ms;
        a[2] = Math.max(a[2], ms);
    }

    /** Milliseconds since this started, for marking when something finished. */
    static void mark(String name) {
        add("at " + name, System.currentTimeMillis() - START);
    }

    /** Writes the report 8 and 30 seconds after the first call (the second one replaces the first). */
    static synchronized void dumpLater(final Context ctx) {
        if (scheduled) return;
        scheduled = true;
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        Runnable dump = new Runnable() {
            @Override
            public void run() {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        write(ctx);
                    }
                }).start();
            }
        };
        h.postDelayed(dump, 8000);
        h.postDelayed(dump, 30000);
    }

    private static void write(Context ctx) {
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("seconds since start: ").append((System.currentTimeMillis() - START) / 1000).append("\n");
            synchronized (Perf.class) {
                for (Map.Entry<String, long[]> e : M.entrySet()) {
                    long[] a = e.getValue();
                    sb.append(e.getKey()).append(": ").append(a[0]).append(" calls, ")
                            .append(a[1]).append(" ms total, ").append(a[2]).append(" ms longest\n");
                }
            }
            File f = new File(DataStore.root(ctx), "perf.txt");
            FileOutputStream out = new FileOutputStream(f);
            out.write(sb.toString().getBytes("UTF-8"));
            out.close();
        } catch (Exception ignored) {
        }
    }
}
