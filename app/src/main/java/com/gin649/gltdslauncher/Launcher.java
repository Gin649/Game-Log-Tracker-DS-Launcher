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
        String error;
    }

    /**
     * Works out the emulator for a system from the wizard's choice. The choice is "standalone:id" or
     * "retroarch:core"; older installs saved plain "standalone" or "retroarch", which mean the system's first
     * emulator of that kind. With no choice, a standalone emulator is used when one is installed, else RetroArch.
     */
    private static Plan plan(Activity act, SystemMap.Sys sys) {
        Plan p = new Plan();
        String choice = Prefs.get(act, "emu." + sys.folder, "");
        boolean wantRa = choice.startsWith("retroarch");
        boolean wantSa = choice.startsWith("standalone");
        String raCore = choice.startsWith("retroarch:") ? choice.substring("retroarch:".length()) : "";
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

    static JSONObject launchRom(Activity act, RomIndex.Rom rom) {
        SystemMap.Sys sys = rom.sys;
        Plan plan = plan(act, sys);
        if (plan.error != null) return result(false, plan.error);

        boolean standalone = plan.recipe != null;
        List<Intent> intents = new ArrayList<Intent>();
        String started;
        if (standalone) {
            intents = Recipes.buildAll(act, plan.recipe, plan.pkg, rom.file);
            started = plan.recipe.label;
        } else {
            Intent intent = new Intent();
            intent.setComponent(new ComponentName(Config.RA_PACKAGE, Config.RA_ACTIVITY));
            intent.putExtra("ROM", rom.file.getPath());
            intent.putExtra("LIBRETRO", Config.RA_CORES_DIR + "/" + plan.core + "_libretro_android.so");
            intent.putExtra("CONFIGFILE", Config.RA_CONFIG);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intents.add(intent);
            started = "RetroArch (" + plan.core + ")";
        }

        // A handheld emulator that draws both screens itself starts on the bottom screen and puts its top
        // screen on the other display; everything else runs on the top screen.
        int display = standalone && plan.recipe.dual ? DisplayPicker.bottomDisplayId(act) : DisplayPicker.topDisplayId(act);

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

        ArtWatch.start(act, standalone ? plan.pkg : Config.RA_PACKAGE);
        LibrarySync.markPlayed(act, rom);
        return result(true, "Starting " + rom.name + " in " + started + "...");
    }
}
