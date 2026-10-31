package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Environment;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Starts a game on the top display, in RetroArch or in a standalone emulator. */
final class Launcher {

    private Launcher() {}

    private static JSONObject result(boolean ok, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", ok);
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o;
    }

    /** What a system will be played in: a standalone emulator, or a RetroArch core. */
    private static final class Plan {
        Recipes.Recipe recipe;
        String pkg;
        String core;
        String raPkg;
        String error;
    }

    /**
     * Works out the emulator for a system from the wizard's choice. The choice is "standalone:id" or
     * "retroarch:core"; older installs saved plain "standalone" or "retroarch", which mean the system's first
     * emulator of that kind. With no choice, a standalone emulator is used when one is installed, else RetroArch.
     */
    private static Plan plan(Activity act, SystemMap.Sys sys, String choice) {
        Plan p = new Plan();
        p.raPkg = Config.RA_PACKAGE;
        boolean wantRa = choice.startsWith("retroarch");
        boolean wantSa = choice.startsWith("standalone");
        String raCore = choice.startsWith("retroarch:") ? choice.substring("retroarch:".length()) : "";
        int at = raCore.indexOf('@'); // "core@package": a game that runs in another RetroArch install, such as the 32-bit one
        if (at >= 0) {
            p.raPkg = raCore.substring(at + 1);
            raCore = raCore.substring(0, at);
        }
        String saId = choice.startsWith("standalone:") ? choice.substring("standalone:".length()) : "";

        if (!wantRa) {
            List<String> ids = new ArrayList<String>();
            if (!saId.isEmpty()) ids.add(saId);
            else ids.addAll(sys.standalones);
            Recipes.Recipe first = null;
            for (String id : ids) {
                Recipes.Recipe r = Recipes.byId(act, id);
                if (r == null) continue;
                if (first == null) first = r;
                String pkg = Recipes.installedPackage(act, r);
                if (pkg != null) {
                    p.recipe = r;
                    p.pkg = pkg;
                    return p;
                }
            }
            if (wantSa) {
                String name = first == null ? "the standalone emulator" : first.label;
                p.error = name + " is not installed. Install it or pick another emulator for " + sys.folder + " in Launcher settings.";
                return p;
            }
        }

        String core = raCore.isEmpty() ? sys.core : raCore;
        if (core.isEmpty()) {
            if (!sys.standalones.isEmpty()) {
                StringBuilder names = new StringBuilder();
                for (String id : sys.standalones) {
                    Recipes.Recipe r = Recipes.byId(act, id);
                    if (names.length() > 0) names.append(" or ");
                    names.append(r == null ? id : r.label);
                }
                p.error = "Install " + names + " to play " + sys.folder + " games.";
            } else {
                p.error = "No emulator is set for " + sys.folder + ". Add a core in " + Config.USER_DIR + "/systems.json.";
            }
            return p;
        }
        p.core = core;
        return p;
    }

    /** Writes the playlist for a multi-disc game next to its discs and returns it, or null. */
    static File makeM3u(RomIndex.Rom rom) {
        if (rom.discs == null || rom.discs.size() < 2) return null;
        File dir = rom.file.getParentFile();
        String name = RomIndex.discGame(rom.name);
        File m3u = new File(dir, name + ".m3u");
        try {
            StringBuilder sb = new StringBuilder();
            for (File d : rom.discs) sb.append(d.getName()).append("\n");
            java.io.FileOutputStream out = new java.io.FileOutputStream(m3u);
            try {
                out.write(sb.toString().getBytes("UTF-8"));
            } finally {
                out.close();
            }
            return m3u;
        } catch (Exception e) {
            return null;
        }
    }

    /** The discs of a multi-disc game, in order: from the .m3u when the entry is a playlist, else the grouped discs. */
    static List<File> discFiles(RomIndex.Rom rom) {
        List<File> out = new ArrayList<File>();
        if (rom.discs != null) {
            out.addAll(rom.discs);
        } else if (rom.file.getName().toLowerCase(java.util.Locale.ROOT).endsWith(".m3u")) {
            try {
                java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(rom.file), "UTF-8"));
                try {
                    String line;
                    while ((line = in.readLine()) != null) {
                        line = line.trim();
                        if (line.isEmpty() || line.startsWith("#")) continue;
                        File f = new File(line);
                        if (!f.isAbsolute()) f = new File(rom.file.getParentFile(), line);
                        if (f.isFile()) out.add(f);
                    }
                } finally {
                    in.close();
                }
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    /** True when this game would start in RetroArch (which understands .m3u), false for a standalone emulator. */
    private static boolean usesRetroArch(Activity act, RomIndex.Rom rom) {
        String gameChoice = Prefs.get(act, gameKey(rom), "");
        Plan p = plan(act, rom.sys, gameChoice.isEmpty() ? Prefs.get(act, "emu." + rom.sys.folder, "") : gameChoice);
        return p.error == null && p.recipe == null;
    }

    /** mode: "" = ask first when a multi-disc game has no playlist, "create" = make one and play it, "first" = disc 1 only. */
    static JSONObject launch(Activity act, String title, String console, String mode) {
        RomIndex.Rom r = Shared.findRom(title, console);
        // Standalone emulators such as Dolphin don't read .m3u playlists: ask which disc to start instead
        if (r != null && !usesRetroArch(act, r)) {
            List<File> discs = discFiles(r);
            if (discs.size() > 1) {
                if (mode.startsWith("pick:")) {
                    int n = -1;
                    try {
                        n = Integer.parseInt(mode.substring(5));
                    } catch (Exception ignored) {
                    }
                    if (n < 0 || n >= discs.size()) return result(false, "That disc is not there.");
                    return launchRom(act, new RomIndex.Rom(r.sys, discs.get(n), r.name, r.rel));
                }
                JSONObject o = result(false, "Which disc?");
                try {
                    org.json.JSONArray names = new org.json.JSONArray();
                    for (File d : discs) names.put(d.getName());
                    o.put("needDisc", true);
                    o.put("discs", names);
                } catch (Exception ignored) {
                }
                return o;
            }
        }
        if (r != null && r.discs != null && r.discs.size() > 1) {
            String skipKey = "m3uskip." + r.sys.folder + "/" + RomIndex.discGame(r.rel);
            if (mode.equals("create")) {
                File m3u = makeM3u(r);
                if (m3u == null) return result(false, "Could not write the playlist in that folder.");
                Shared.rescan();
                return launchFile(act, m3u);
            }
            if (mode.equals("first")) {
                Prefs.put(act, skipKey, "1");
            } else if (Prefs.get(act, skipKey, "").isEmpty()) {
                JSONObject o = result(false, "This game has " + r.discs.size() + " discs.");
                try {
                    o.put("needM3u", true);
                    o.put("discs", r.discs.size());
                } catch (Exception ignored) {
                }
                return o;
            }
        }
        return launch(act, title, console);
    }

    static JSONObject launch(Activity act, String title, String console) {
        if (!Environment.isExternalStorageManager()) {
            return result(false, "Allow \"All files access\" for this app in Android settings, then try again.");
        }

        RomIndex.Rom rom = Shared.findRom(title, console);
        if (rom == null) {
            List<String> folders = new ArrayList<String>();
            for (SystemMap.Sys s : Shared.systems().forConsole(console)) {
                if (s.dir().isDirectory()) folders.add(s.folder);
            }
            String where = folders.isEmpty() ? "no Roms folder matches " + console : "looked in " + folders;
            return result(false, "No ROM found for " + Matcher.display(title) + " (" + where + ").");
        }
        return launchRom(act, rom);
    }

    /** Starts a file that may not be in the ROM list yet, such as a ROM hack that was just saved. */
    static JSONObject launchFile(Activity act, File file) {
        if (!Environment.isExternalStorageManager()) {
            return result(false, "Allow \"All files access\" for this app in Android settings, then try again.");
        }
        if (file == null || !file.isFile()) return result(false, "That file is not there any more.");

        SystemMap map = Shared.systems();
        SystemMap.Sys sys = null;
        int bestLen = -1;
        if (map != null) {
            String full = file.getPath();
            for (SystemMap.Sys s : map.all) {
                String dir = s.dir().getPath() + "/";
                if (full.startsWith(dir) && dir.length() > bestLen) {
                    sys = s;
                    bestLen = dir.length();
                }
            }
        }
        if (sys == null) return result(false, "That file is not inside one of your system folders.");

        String name = file.getName();
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String rel = file.getPath().substring(sys.dir().getPath().length() + 1);
        int relDot = rel.lastIndexOf('.');
        if (relDot > 0) rel = rel.substring(0, relDot);
        return launchRom(act, new RomIndex.Rom(sys, file, base, rel));
    }

    /** Prefs key holding the emulator picked for this one game (empty = the system's choice). */
    static String gameKey(RomIndex.Rom rom) {
        return "gemu." + rom.sys.folder + "/" + rom.rel;
    }

    private static final String[] RA_PACKAGES = {"com.retroarch.aarch64", "com.retroarch", "com.retroarch.ra32"};

    /** The emulators a game can use: [{value,label}], plus the current pick. */
    static JSONObject emulatorOptions(Activity act, RomIndex.Rom rom) {
        JSONObject out = new JSONObject();
        try {
            org.json.JSONArray opts = new org.json.JSONArray();
            SystemMap.Sys sys = rom.sys;
            for (String id : sys.standalones) {
                Recipes.Recipe r = Recipes.byId(act, id);
                if (r == null || Recipes.installedPackage(act, r) == null) continue;
                opts.put(new JSONObject().put("value", "standalone:" + id).put("label", r.label));
            }
            List<String> cores = new ArrayList<String>();
            if (!sys.core.isEmpty()) cores.add(sys.core);
            for (String c : sys.cores) if (!c.isEmpty() && !cores.contains(c)) cores.add(c);
            List<String> pkgs = new ArrayList<String>();
            for (String pkg : RA_PACKAGES) {
                try {
                    act.getPackageManager().getPackageInfo(pkg, 0);
                    pkgs.add(pkg);
                } catch (Exception ignored) {
                }
            }
            for (String pkg : pkgs) {
                String tag = pkgs.size() > 1 ? (pkg.equals("com.retroarch.aarch64") ? " (64-bit)" : pkg.equals("com.retroarch") ? " (32-bit)" : " (" + pkg + ")") : "";
                for (String c : cores) {
                    opts.put(new JSONObject().put("value", "retroarch:" + c + "@" + pkg).put("label", "RetroArch" + tag + ": " + c));
                }
            }
            out.put("ok", true);
            out.put("options", opts);
            out.put("current", Prefs.get(act, gameKey(rom), ""));
            out.put("system", sys.folder);
        } catch (Exception e) {
            return result(false, "Could not list emulators.");
        }
        return out;
    }

    static JSONObject launchRom(Activity act, RomIndex.Rom rom) {
        SystemMap.Sys sys = rom.sys;
        String gameChoice = Prefs.get(act, gameKey(rom), "");
        Plan plan = plan(act, sys, gameChoice.isEmpty() ? Prefs.get(act, "emu." + sys.folder, "") : gameChoice);
        if (plan.error != null) return result(false, plan.error);

        boolean standalone = plan.recipe != null;
        List<Intent> intents = new ArrayList<Intent>();
        String started;
        if (standalone) {
            intents = Recipes.buildAll(act, plan.recipe, plan.pkg, rom.file);
            started = plan.recipe.label;
        } else {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(plan.raPkg, Config.RA_ACTIVITY));
            intent.putExtra("ROM", rom.file.getPath());
            intent.putExtra("LIBRETRO", "/data/data/" + plan.raPkg + "/cores/" + plan.core + "_libretro_android.so");
            intent.putExtra("CONFIGFILE", "/storage/emulated/0/Android/data/" + plan.raPkg + "/files/retroarch.cfg");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intents.add(intent);
            started = "RetroArch (" + plan.core + ")";
        }

        // A handheld emulator that draws both screens itself starts on the bottom screen and puts its top
        // screen on the other display; everything else runs on the top screen.
        int display = DisplayPicker.gameDisplayId(act, standalone && plan.recipe.dual);

        Exception last = null;
        for (Intent intent : intents) {
            try {
                if (display >= 0) {
                    ActivityOptions options = ActivityOptions.makeBasic();
                    options.setLaunchDisplayId(display);
                    act.startActivity(intent, options.toBundle());
                } else {
                    act.startActivity(intent);
                }
                last = null;
                break;
            } catch (Exception e) {
                last = e; // this activity is not in the installed version; the next one may be
            }
        }
        if (last != null) return result(false, "Could not start " + started + ": " + last.getMessage());

        ArtWatch.start(act, standalone ? plan.pkg : plan.raPkg);
        LibrarySync.markPlayed(act, rom);
        return result(true, "Starting " + rom.name + " in " + started + "...");
    }
}
