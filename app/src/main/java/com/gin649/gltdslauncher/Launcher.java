package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Environment;

import org.json.JSONObject;

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

        SystemMap.Sys sys = rom.sys;
        String choice = Prefs.get(act, "emu." + sys.folder, "");

        Recipes.Recipe recipe = sys.standalone.isEmpty() ? null : Recipes.byId(act, sys.standalone);
        String pkg = recipe == null ? null : Recipes.installedPackage(act, recipe);

        boolean standalone = recipe != null && pkg != null && !"retroarch".equals(choice);
        if ("standalone".equals(choice) && !standalone) {
            String name = recipe == null ? "the standalone emulator" : recipe.label;
            return result(false, name + " is not installed. Install it or pick RetroArch for " + sys.folder + " in Launcher settings.");
        }

        Intent intent;
        String started;
        if (standalone) {
            intent = Recipes.build(act, recipe, pkg, rom.file);
            started = recipe.label;
        } else {
            if (sys.core.isEmpty()) {
                return result(false, "No emulator is set for " + sys.folder + ". Add a core in " + Config.USER_DIR + "/systems.json.");
            }
            intent = new Intent();
            intent.setComponent(new ComponentName(Config.RA_PACKAGE, Config.RA_ACTIVITY));
            intent.putExtra("ROM", rom.file.getPath());
            intent.putExtra("LIBRETRO", Config.RA_CORES_DIR + "/" + sys.core + "_libretro_android.so");
            intent.putExtra("CONFIGFILE", Config.RA_CONFIG);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            started = "RetroArch (" + sys.core + ")";
        }

        try {
            int display = DisplayPicker.topDisplayId(act);
            if (display >= 0) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setLaunchDisplayId(display);
                act.startActivity(intent, options.toBundle());
            } else {
                act.startActivity(intent);
            }
            ArtWatch.start(act, standalone ? pkg : Config.RA_PACKAGE);
            LibrarySync.markPlayed(act, rom);
            return result(true, "Starting " + rom.name + " in " + started + "...");
        } catch (Exception e) {
            return result(false, "Could not start " + started + ": " + e.getMessage());
        }
    }
}
