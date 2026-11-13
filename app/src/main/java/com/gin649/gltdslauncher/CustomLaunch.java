package com.gin649.gltdslauncher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Launch commands you add yourself in setup, for an emulator the app doesn't know or a console you want started a
 * different way. A command uses ES-DE's Android command format, so one can be copied from ES-DE's es_find_rules.xml
 * and es_systems.xml:
 *
 *   %ACTION%=android.intent.action.VIEW %DATA%=%ROMSAF%
 *   %EXTRA_bootPath%=%ROMSAF% %EXTRABOOL_resumeState%=false %ACTIVITY_CLEAR_TASK%
 *
 * Each command becomes a recipe like the built-in ones in emulators.json (its id starts with "custom-") and is offered
 * for the consoles it was made for. They are saved in the app's settings, so a backup keeps them.
 */
final class CustomLaunch {

    static final String PREF = "customEmus";
    static final String ID_PREFIX = "custom-";

    static final class Command {
        String id = "";
        String label = "";
        String pkg = "";
        String activity = "";
        String command = "";
        boolean dual;
        final List<String> systems = new ArrayList<String>();
    }

    /** What reading a command gave: the recipe, and anything in it that was not understood. */
    static final class Parsed {
        final Recipes.Recipe recipe = new Recipes.Recipe();
        final List<String> unknown = new ArrayList<String>();
    }

    private CustomLaunch() {}

    static List<Command> all(Context ctx) {
        List<Command> out = new ArrayList<Command>();
        try {
            JSONArray a = new JSONArray(Prefs.get(ctx, PREF, "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                Command c = new Command();
                c.id = o.optString("id", "");
                c.label = o.optString("label", "");
                c.pkg = o.optString("pkg", "");
                c.activity = o.optString("activity", "");
                c.command = o.optString("command", "");
                c.dual = o.optBoolean("dual", false);
                JSONArray s = o.optJSONArray("systems");
                if (s != null) {
                    for (int j = 0; j < s.length(); j++) c.systems.add(s.optString(j));
                }
                if (c.id.startsWith(ID_PREFIX) && !c.pkg.isEmpty()) out.add(c);
            }
        } catch (Exception ignored) {
            // a list that can't be read is treated as empty, never as a reason to stop the app
        }
        return out;
    }

    static void saveAll(Context ctx, List<Command> list) {
        JSONArray a = new JSONArray();
        try {
            for (Command c : list) {
                JSONObject o = new JSONObject();
                o.put("id", c.id);
                o.put("label", c.label);
                o.put("pkg", c.pkg);
                o.put("activity", c.activity);
                o.put("command", c.command);
                o.put("dual", c.dual);
                o.put("systems", new JSONArray(c.systems));
                a.put(o);
            }
        } catch (Exception ignored) {
        }
        Prefs.put(ctx, PREF, a.toString());
    }

    /** An id no saved command uses yet. */
    static String newId(List<Command> list) {
        for (int n = 1; ; n++) {
            String id = ID_PREFIX + n;
            boolean used = false;
            for (Command c : list) {
                if (c.id.equals(id)) used = true;
            }
            if (!used) return id;
        }
    }

    /** Every saved command as a recipe, for Recipes.all(). */
    static List<Recipes.Recipe> recipes(Context ctx) {
        List<Recipes.Recipe> out = new ArrayList<Recipes.Recipe>();
        for (Command c : all(ctx)) out.add(parse(c).recipe);
        return out;
    }

    /**
     * Reads a command into a recipe. An %EMULATOR_...% part is skipped (the app is picked on its own), unless it holds
     * "package/activity", which then fills those in. Tokens that aren't understood are listed in unknown.
     */
    static Parsed parse(Command c) {
        Parsed p = new Parsed();
        Recipes.Recipe r = p.recipe;
        r.id = c.id;
        r.label = c.label.isEmpty() ? c.pkg : c.label;
        r.packages.add(c.pkg);
        r.activity = expandActivity(c.pkg, c.activity.trim());
        r.dual = c.dual;
        r.data = "none";

        for (String token : tokens(c.command)) {
            String name = token;
            String value = "";
            int eq = token.indexOf("%=");
            if (eq > 0) {
                name = token.substring(0, eq + 1);
                value = stripQuotes(token.substring(eq + 2));
            }
            String upper = name.toUpperCase(Locale.ROOT);
            if (upper.startsWith("%EMULATOR_")) {
                String inner = name.substring("%EMULATOR_".length(), name.length() - 1);
                int slash = inner.indexOf('/');
                if (slash > 0 && r.activity.isEmpty()) r.activity = expandActivity(inner.substring(0, slash), inner.substring(slash + 1));
            } else if (upper.equals("%ACTION%")) {
                r.action = value;
            } else if (upper.equals("%CATEGORY%")) {
                r.category = value;
            } else if (upper.equals("%MIMETYPE%")) {
                r.mime = value;
            } else if (upper.equals("%DATA%")) {
                String v = value.toUpperCase(Locale.ROOT);
                if (v.equals("%ROMSAF%") || v.equals("%ROMPROVIDER%")) r.data = "saf";
                else if (v.equals("%ROM%")) r.data = "path";
                else if (v.equals("%ROMFILEURI%")) r.data = "fileuri";
                else p.unknown.add(token);
            } else if (upper.equals("%ACTIVITY_CLEAR_TASK%") || upper.equals("%ACTIVITY_CLEAR_TOP%")) {
                r.clearTask = true;
            } else if (upper.equals("%ACTIVITY_NO_HISTORY%")) {
                r.noHistory = true;
            } else if (upper.startsWith("%EXTRABOOL_")) {
                r.boolExtras.put(key(name, "%EXTRABOOL_"), Boolean.parseBoolean(value.trim()));
            } else if (upper.startsWith("%EXTRAINTEGER_")) {
                try {
                    r.intExtras.put(key(name, "%EXTRAINTEGER_"), Integer.parseInt(value.trim()));
                } catch (NumberFormatException e) {
                    p.unknown.add(token);
                }
            } else if (upper.startsWith("%EXTRALONG_")) {
                try {
                    r.longExtras.put(key(name, "%EXTRALONG_"), Long.parseLong(value.trim()));
                } catch (NumberFormatException e) {
                    p.unknown.add(token);
                }
            } else if (upper.startsWith("%EXTRAARRAY_")) {
                List<String> items = new ArrayList<String>();
                for (String part : value.split(",")) items.add(placeholders(part.trim()));
                r.arrayExtras.put(key(name, "%EXTRAARRAY_"), items);
            } else if (upper.startsWith("%EXTRA_")) {
                r.extras.put(key(name, "%EXTRA_"), placeholders(value));
            } else {
                p.unknown.add(token);
            }
        }
        return p;
    }

    /** ES-DE's names for the ROM in extras, turned into the ones Recipes fills in. */
    private static String placeholders(String v) {
        return v.replace("%ROMPROVIDER%", "%ROMSAF%").replace("%BASENAME%", "%ROMBASE%");
    }

    private static String key(String name, String prefix) {
        return name.substring(prefix.length(), name.length() - 1);
    }

    /** ".EmulationActivity" means one inside the app's own package, as in ES-DE's find rules. */
    private static String expandActivity(String pkg, String activity) {
        if (activity.startsWith(".")) return pkg + activity;
        return activity;
    }

    private static String stripQuotes(String v) {
        if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) return v.substring(1, v.length() - 1);
        return v;
    }

    /** Splits on spaces, keeping anything inside double quotes together. */
    private static List<String> tokens(String command) {
        List<String> out = new ArrayList<String>();
        if (command == null) return out;
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < command.length(); i++) {
            char ch = command.charAt(i);
            if (ch == '"') quoted = !quoted;
            if (Character.isWhitespace(ch) && !quoted) {
                if (cur.length() > 0) out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(ch);
            }
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out;
    }
}
