package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.text.InputType;
import android.view.Display;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import org.json.JSONObject;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** First-run setup wizard. Also reopened from the tracker's menu to change anything later. */
public class SetupActivity extends Activity {

    interface Listener {
        void onClosed(boolean completed);
    }

    static volatile boolean running;
    private static Listener listener;

    static void setListener(Listener l) {
        listener = l;
    }

    // How the wizard last closed, kept until the main screen picks it up: 0 nothing waiting, 1 left unfinished,
    // 2 finished. The main screen is told as the wizard closes and also looks here when it comes back to the front,
    // because Android can take a long time to destroy a closed screen, and on some devices that was the only moment
    // the main screen heard about it.
    private static int closedResult;
    private boolean toldClosed;

    /** True or false for a wizard that finished or was left, once. Null when there is nothing new to hear. */
    static synchronized Boolean takeClosed() {
        int r = closedResult;
        closedResult = 0;
        return r == 0 ? null : Boolean.valueOf(r == 2);
    }

    private void tellClosed() {
        synchronized (SetupActivity.class) {
            if (toldClosed) return;
            toldClosed = true;
            closedResult = finished ? 2 : 1;
        }
        if (listener != null) listener.onClosed(finished);
    }

    private static final int REQ_ROMS = 10;
    private static final int REQ_ES = 11;
    private static final int REQ_DATA = 13;

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEAL = Color.rgb(89, 201, 165);
    private static final int TEXT = Color.rgb(236, 232, 247);
    private static final int MUTED = Color.rgb(148, 141, 179);

    private static final String[] ZOOM_LABELS = {"Compact (fits the most)", "Normal", "Large", "Extra large"};
    private static final int[] ZOOM_VALUES = {900, 720, 560, 440};
    private static final String[] RA_PACKAGES = {"com.retroarch.aarch64", "com.retroarch", "com.retroarch.ra32"};
    private static final String[] STEP_TITLES = {"Welcome", "Your accounts", "Your folders", "Your Emulators", "Your screens", "Finish"};
    private static final int LAST_STEP = 5;
    private static final long DRAFT_MAX_AGE_MS = 24L * 60 * 60 * 1000;

    private LinearLayout content;
    private TextView titleView;
    private Button backBtn;
    private Button nextBtn;
    private int step;
    private boolean firstRun;
    private boolean finished;

    private String raUser, raKey, esRoot, raPackage, siteUrl;
    /** The ROM folders, the preferred one first. See Config.RomFolder. */
    private List<Config.RomFolder> romFolders = new ArrayList<Config.RomFolder>();
    /** The "what does this folder hold" spinner for each ROM folder on screen, and the system behind each item. */
    private final List<Spinner> folderSpinners = new ArrayList<Spinner>();
    private final List<List<String>> folderValues = new ArrayList<List<String>>();
    /** "esde" or "none" (any other frontend, or no frontend at all). */
    private String frontend;
    /** Folder chosen for the app's own files; empty means the default. */
    private String dataRoot = "";
    private boolean launchBoxArt;
    private String origUser, origKey;
    private String sgdbKey;
    private EditText etSgdb;
    private boolean useEsdeMedia;
    private int cssWidth;
    private int topDisplay;
    private final Map<String, String> emuChoice = new HashMap<String, String>();
    /** For each system folder on the emulator step: the saved value behind each spinner item. */
    private final Map<String, List<String>> emuValues = new HashMap<String, List<String>>();

    // views of the step on screen
    private EditText etUser, etKey;
    private Spinner spRa, spDisplay, spZoom, spSingle;
    private CheckBox cbSingle;
    private boolean singleScreen;
    private String singleWhich = "bottom";
    private final Map<String, Spinner> emuSpinners = new LinkedHashMap<String, Spinner>();
    private final List<Integer> displayIds = new ArrayList<Integer>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        running = true;
        takeClosed(); // an earlier close nobody picked up says nothing about this visit
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        firstRun = !Prefs.setupDone(this);
        raUser = get("raUser", "");
        raKey = get("raKey", "");
        origUser = raUser;
        origKey = raKey;
        romFolders = Config.parseRomFolders(get("romsFolders", ""), get("romsRoot", ""), get("romsTree", ""));
        esRoot = get("esRoot", "");
        dataRoot = get("dataRoot", "");
        frontend = get("frontend", "");
        if (!frontend.equals("esde") && !frontend.equals("none")) { // anything else is treated as none
            // first run, or an install from before this choice existed: ES-DE if it is there, otherwise none
            frontend = (!esRoot.isEmpty() || !guessEsRoot().isEmpty()) ? "esde" : "none";
        }
        // art is only for the top screen: on by default with two screens, off with one
        int artDefault = DisplayPicker.hasTwoScreens(this) ? 1 : 0;
        launchBoxArt = artDefault == 1;
        raPackage = get("raPackage", "");
        siteUrl = get("siteUrl", Config.DEFAULT_URL);
        if (siteUrl.startsWith("https://gin649.github.io/")) siteUrl = Config.DEFAULT_URL; // old default = built-in
        sgdbKey = get("sgdbKey", "");
        useEsdeMedia = artDefault == 1;
        cssWidth = Prefs.getInt(this, "cssWidth", 720);
        topDisplay = DisplayPicker.prefs(this).getInt("topDisplay", -1);
        singleScreen = DisplayPicker.singleScreen(this);
        singleWhich = DisplayPicker.singleWhich(this);
        restoreDraft();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);

        titleView = new TextView(this);
        titleView.setTextColor(GOLD);
        titleView.setTextSize(22);
        titleView.setTypeface(titleView.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(titleView);

        ScrollView scroll = new ScrollView(this);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        backBtn = new Button(this);
        backBtn.setAllCaps(false);
        nextBtn = new Button(this);
        nextBtn.setAllCaps(false);
        footer.addView(backBtn, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        footer.addView(nextBtn, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(footer);

        backBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                goBack();
            }
        });
        nextBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                goNext();
            }
        });

        setContentView(root);

        if (frontend.equals("esde") && esRoot.isEmpty()) esRoot = guessEsRoot();
        render();
    }

    private boolean closing;

    /** What was typed or chosen so far, kept when the app is left (to look up a key, say) in case Android closes the wizard meanwhile. */
    private void saveDraft() {
        try {
            JSONObject d = new JSONObject();
            d.put("at", System.currentTimeMillis());
            d.put("step", step);
            d.put("raUser", raUser);
            d.put("raKey", raKey);
            d.put("sgdbKey", sgdbKey);
            d.put("romsFolders", Config.romFoldersJson(romFolders));
            d.put("esRoot", esRoot);
            d.put("dataRoot", dataRoot);
            d.put("frontend", frontend);
            d.put("raPackage", raPackage);
            d.put("siteUrl", siteUrl);
            d.put("launchBoxArt", launchBoxArt);
            d.put("useEsdeMedia", useEsdeMedia);
            d.put("cssWidth", cssWidth);
            d.put("topDisplay", topDisplay);
            d.put("singleScreen", singleScreen);
            d.put("singleWhich", singleWhich);
            JSONObject emu = new JSONObject();
            for (Map.Entry<String, String> e : emuChoice.entrySet()) emu.put(e.getKey(), e.getValue());
            d.put("emu", emu);
            put("wizardDraft", d.toString());
        } catch (Exception ignored) {
        }
    }

    private void restoreDraft() {
        String raw = get("wizardDraft", "");
        if (raw.isEmpty()) return;
        try {
            JSONObject d = new JSONObject(raw);
            // A draft is for coming straight back. An old one (the app was closed with the wizard still open) would put
            // back whatever was typed then, over anything changed since.
            if (System.currentTimeMillis() - d.optLong("at", 0) > DRAFT_MAX_AGE_MS) {
                put("wizardDraft", "");
                return;
            }
            step = Math.max(0, Math.min(LAST_STEP, d.optInt("step", 0)));
            raUser = d.optString("raUser", raUser);
            raKey = d.optString("raKey", raKey);
            sgdbKey = d.optString("sgdbKey", sgdbKey);
            if (d.has("romsFolders")) romFolders = Config.parseRomFolders(d.optString("romsFolders", ""), "", "");
            esRoot = d.optString("esRoot", esRoot);
            dataRoot = d.optString("dataRoot", dataRoot);
            frontend = d.optString("frontend", frontend);
            raPackage = d.optString("raPackage", raPackage);
            siteUrl = d.optString("siteUrl", siteUrl);
            launchBoxArt = d.optBoolean("launchBoxArt", launchBoxArt);
            useEsdeMedia = d.optBoolean("useEsdeMedia", useEsdeMedia);
            cssWidth = d.optInt("cssWidth", cssWidth);
            topDisplay = d.optInt("topDisplay", topDisplay);
            singleScreen = d.optBoolean("singleScreen", singleScreen);
            singleWhich = d.optString("singleWhich", singleWhich);
            JSONObject emu = d.optJSONObject("emu");
            if (emu != null) {
                java.util.Iterator<String> keys = emu.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    emuChoice.put(k, emu.getString(k));
                }
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onPause() {
        if (!closing) {
            collect();
            saveDraft();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (step == 0 || step == LAST_STEP) {
            collect();
            render();
        }
    }

    @Override
    protected void onDestroy() {
        running = false;
        tellClosed();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    // small helpers
    private String get(String key, String def) {
        return Prefs.get(this, key, def);
    }

    private void put(String key, String value) {
        Prefs.put(this, key, value);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setPadding(0, dp(8), 0, dp(2));
        content.addView(t);
        return t;
    }

    private EditText field(String hint, String value, boolean multiline) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setText(value);
        e.setTextColor(TEXT);
        e.setHintTextColor(MUTED);
        e.setTextSize(15);
        e.setSingleLine(true);
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        content.addView(e);
        return e;
    }

    private Button action(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        content.addView(b);
        return b;
    }

    private Spinner spinner(List<String> items, int selected) {
        Spinner s = new Spinner(this);
        ArrayAdapter<String> a = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, items);
        a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        s.setAdapter(a);
        if (selected >= 0 && selected < items.size()) s.setSelection(selected);
        content.addView(s);
        return s;
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, "Could not open " + url, Toast.LENGTH_LONG).show();
        }
    }

    private String guessEsRoot() {
        List<String> tries = new ArrayList<String>();
        String romsRoot = Config.firstAllSystems(romFolders);
        if (!romsRoot.isEmpty()) {
            File parent = new File(romsRoot).getParentFile();
            if (parent != null) tries.add(parent.getPath() + "/ES-DE");
        }
        tries.add("/storage/emulated/0/ES-DE");
        for (String t : tries) {
            if (new File(t).isDirectory()) return t;
        }
        return "";
    }

    // steps
    private void render() {
        emuGen++;
        content.removeAllViews();
        etUser = null;
        etKey = null;
        etSgdb = null;
        spRa = null;
        spDisplay = null;
        spSingle = null;
        cbSingle = null;
        spZoom = null;
        emuSpinners.clear();
        folderSpinners.clear();
        folderValues.clear();

        titleView.setText((step + 1) + " of " + (LAST_STEP + 1) + "   " + STEP_TITLES[step]);
        backBtn.setText(step == 0 ? "Finish later" : "Back");
        nextBtn.setText(step == LAST_STEP ? "Finish" : "Next");

        switch (step) {
            case 0:
                stepWelcome();
                break;
            case 1:
                stepAccounts();
                break;
            case 2:
                stepFolders();
                break;
            case 3:
                stepEmulators();
                break;
            case 4:
                stepScreens();
                break;
            default:
                stepFinish();
                break;
        }
    }

    private boolean hasFileAccess() {
        return Environment.isExternalStorageManager();
    }

    private void fileAccessRow() {
        if (hasFileAccess()) {
            text("File access: allowed", 15, TEAL);
        } else {
            text("File access: not allowed yet", 15, GOLD);
            action("Allow file access", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                    }
                }
            });
        }
    }

    /** Lets the app notice a game closing, so the top screen comes back to the tracker (see ArtWatch). */
    private void usageAccessRow() {
        if (DisplayPicker.topDisplayId(this) < 0) return; // one screen: nothing to bring back
        if (ArtWatch.hasUsageAccess(this)) {
            text("Back to tracker after a game: on", 15, TEAL);
        } else {
            text("Back to tracker after a game: needs usage access", 15, GOLD);
            text("Allow usage access so the top screen returns to the tracker when a game closes. "
                    + "It is only used to see whether the emulator is still open.", 13, MUTED);
            action("Allow usage access", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    try {
                        startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        try {
                            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
                        } catch (Exception ignored) {
                        }
                    }
                }
            });
        }
    }

    private void stepWelcome() {
        text("Let's set up Game Log Tracker on this device.", 17, TEXT);
        text("It takes a minute. Everything can be changed later from the tracker's menu, under Launcher settings.", 14, MUTED);
        text("First, the app needs access to your files so it can find your games and their artwork.", 14, MUTED);
        fileAccessRow();
        usageAccessRow();
    }

    private void stepAccounts() {
        text("RetroAchievements", 17, TEXT);
        text("Your username and Web API key. The key is on your RetroAchievements settings page. "
                + "You can also skip this and connect inside the tracker.", 13, MUTED);
        etUser = field("RetroAchievements username", raUser, false);
        etKey = field("Web API key", raKey, false);
        action("Open RetroAchievements settings", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openUrl("https://retroachievements.org/settings");
            }
        });
        text("SteamGridDB (optional)", 17, TEXT);
        text("Fan art for games that have none in your frontend. It needs your own free API key (steamgriddb.com, your "
                + "profile, Preferences, API), not a developer account. It looks games up by title only, so retro coverage "
                + "is uneven. Leave blank to skip it; the free LaunchBox art is used instead.", 13, MUTED);
        etSgdb = field("SteamGridDB API key", sgdbKey, false);
        action("Open SteamGridDB", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openUrl("https://www.steamgriddb.com/profile/preferences/api");
            }
        });
    }

    private void frontendButton(String label, final String id) {
        boolean on = frontend.equals(id);
        Button b = action((on ? "\u25cf " : "\u25cb ") + label, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collect();
                if (!frontend.equals(id)) {
                    frontend = id;
                    if (id.equals("esde") && esRoot.isEmpty()) esRoot = guessEsRoot();
                }
                render();
            }
        });
        if (on) b.setTextColor(TEAL);
    }

    private void stepFolders() {
        text("Which frontend do you use?", 17, TEXT);
        text("This decides which folders to ask for. Pick None / something else for any other frontend, or no frontend at all.", 13, MUTED);
        frontendButton("ES-DE", "esde");
        frontendButton("None / something else", "none");

        romFolderList();

        boolean mediaFound = false;
        if (frontend.equals("esde")) {
            text("ES-DE folder", 17, TEXT);
            text("The ES-DE data folder, the one that contains downloaded_media. It gives the top screen your game art "
                    + "and brings in your own custom systems.", 13, MUTED);
            text(esRoot.isEmpty() ? "Not chosen" : esRoot, 14, esRoot.isEmpty() ? MUTED : TEAL);
            action("Choose ES-DE folder", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    pickFolder(REQ_ES);
                }
            });
            mediaFound = !esRoot.isEmpty() && new File(esRoot, "downloaded_media").isDirectory();
        }

        text("App data folder", 17, TEXT);
        text("Where the app keeps its own files: your tracker data (login, backlog, notes, guides) and the art it fetches. "
                + "A folder in shared storage survives uninstalling the app and switching between builds. It needs file access.", 13, MUTED);
        String shownData = effectiveDataRoot();
        boolean privateFallback = shownData.isEmpty();
        text(privateFallback ? "App's private folder (allow file access to use a shared folder)" : shownData, 14,
                privateFallback ? GOLD : TEAL);
        action("Choose data folder", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickFolder(REQ_DATA);
            }
        });
        if (!dataRoot.isEmpty()) {
            action("Use the default folder (" + DataStore.DEFAULT_FOLDER + ")", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    collect();
                    dataRoot = "";
                    render();
                }
            });
        }

        String summary = folderSummary();
        if (!summary.isEmpty()) text(summary, 13, MUTED);
    }

    // ROM folders

    /** The system list, for telling what a folder holds. Loaded here when the app hasn't loaded it yet. */
    private SystemMap systemsForWizard() {
        SystemMap m = Shared.systems();
        if (m != null) return m;
        if (wizardSystems == null) wizardSystems = SystemMap.load(this);
        return wizardSystems;
    }

    private SystemMap wizardSystems;

    /**
     * What a picked folder holds: "" for a folder with a folder per system inside (gba, snes, "PS1" and so on), or the
     * system for a folder that holds one console's games, told by its own name ("PS2", "GameCube"). When it can't be
     * told it is treated as a folder per system, and the list says so, so the console can be picked by hand.
     */
    private String detectSystem(File dir) {
        SystemMap m = systemsForWizard();
        int inside = 0;
        File[] kids = dir.listFiles();
        if (kids != null) {
            for (File k : kids) {
                if (k.isDirectory() && !k.getName().startsWith(".") && m.systemForName(k.getName()) != null) inside++;
            }
        }
        String own = m.systemForName(dir.getName());
        if (inside >= 2 || (inside == 1 && own == null)) return "";
        return own == null ? "" : own;
    }

    /** How a system is shown in the folder list: its RetroAchievements name and folder, like "PlayStation 2 (ps2)". */
    private String systemLabel(String folder) {
        SystemMap.Sys s = systemsForWizard().byFolder(folder);
        String name = s == null || s.ra.isEmpty() ? folder : s.ra.get(0);
        if (s != null && s.hack) name += " hacks";
        return name.equals(folder) ? folder : name + " (" + folder + ")";
    }

    private void romFolderList() {
        text("ROM folders", 17, TEXT);
        text("Add the folder that holds one folder per system, like gba, snes and psx. Folders named in full, like "
                + "\"Game Boy Advance\" or \"PS1\", are recognised too. You can also add a folder that holds just one "
                + "console's games, like a PS2 folder on internal storage, and more than one ROMs folder.", 13, MUTED);
        if (romFolders.size() > 1) {
            text("When a game is in more than one folder, Play uses the first folder in this list. Hold Play to pick another copy.", 13, MUTED);
        }
        if (romFolders.isEmpty()) text("Not chosen yet", 14, GOLD);

        SystemMap m = systemsForWizard();
        List<String> labels = new ArrayList<String>();
        List<String> values = new ArrayList<String>();
        List<SystemMap.Sys> sorted = new ArrayList<SystemMap.Sys>();
        for (SystemMap.Sys s : m.all) {
            if (s.base.isEmpty()) sorted.add(s);
        }
        java.util.Collections.sort(sorted, new java.util.Comparator<SystemMap.Sys>() {
            @Override
            public int compare(SystemMap.Sys a, SystemMap.Sys b) {
                return systemLabel(a.folder).compareToIgnoreCase(systemLabel(b.folder));
            }
        });
        labels.add("A folder for each system");
        values.add("");
        for (SystemMap.Sys s : sorted) {
            labels.add("Only " + systemLabel(s.folder));
            values.add(s.folder);
        }

        for (int i = 0; i < romFolders.size(); i++) {
            final int at = i;
            final Config.RomFolder f = romFolders.get(i);
            text((i + 1) + ". " + f.path + (i == 0 && romFolders.size() > 1 ? "   (preferred)" : ""), 14, TEAL);

            File dir = new File(f.path);
            String what;
            int color = MUTED;
            if (!dir.isDirectory()) {
                what = hasFileAccess() ? "Not there right now (an SD card that is out?). Its games come back when it is." : "Allow file access to see what is in it.";
                color = GOLD;
            } else if (f.allSystems()) {
                int n = 0;
                File[] kids = dir.listFiles();
                if (kids != null) {
                    for (File k : kids) {
                        if (k.isDirectory() && !k.getName().startsWith(".") && m.systemForName(k.getName()) != null) n++;
                    }
                }
                if (n == 0) {
                    what = "No system folders found in it. If it holds one console's games, pick the console below.";
                    color = GOLD;
                } else {
                    what = n + (n == 1 ? " system folder found" : " system folders found");
                }
            } else {
                int n = 0;
                File[] kids = dir.listFiles();
                if (kids != null) {
                    for (File k : kids) {
                        if (!k.getName().startsWith(".")) n++;
                    }
                }
                what = "Holds " + systemLabel(f.system) + " games (" + n + (n == 1 ? " item" : " items") + ")";
            }
            text(what, 13, color);

            final List<String> myValues = new ArrayList<String>(values);
            List<String> myLabels = new ArrayList<String>(labels);
            if (!myValues.contains(f.system)) { // a system from your own systems.json, say
                myValues.add(f.system);
                myLabels.add("Only " + systemLabel(f.system));
            }
            Spinner sp = spinner(myLabels, myValues.indexOf(f.system));
            folderSpinners.add(sp);
            folderValues.add(myValues);
            sp.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
                @Override
                public void onItemSelected(android.widget.AdapterView<?> parent, View view, int pos, long id) {
                    // Android reports the first selection too: only a real change redraws the list
                    if (at < romFolders.size() && pos >= 0 && pos < myValues.size() && !myValues.get(pos).equals(romFolders.get(at).system)) {
                        collect();
                        render();
                    }
                }

                @Override
                public void onNothingSelected(android.widget.AdapterView<?> parent) {
                }
            });

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            if (i > 0) {
                Button up = new Button(this);
                up.setText("Make preferred");
                up.setAllCaps(false);
                up.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        collect();
                        Config.RomFolder moved = romFolders.remove(at);
                        romFolders.add(0, moved);
                        render();
                    }
                });
                row.addView(up);
            }
            Button remove = new Button(this);
            remove.setText("Remove");
            remove.setAllCaps(false);
            remove.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    collect();
                    romFolders.remove(at);
                    render();
                }
            });
            row.addView(remove);
            content.addView(row);
        }

        action(romFolders.isEmpty() ? "Choose ROMs folder" : "Add another ROM folder", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickFolder(REQ_ROMS);
            }
        });
    }

    /** Saves the folder list, and the first ROMs folder on its own too for anything that only knows about one. */
    private void saveRomFolders() {
        put("romsFolders", Config.romFoldersJson(romFolders));
        String root = "", tree = "";
        for (Config.RomFolder f : romFolders) {
            if (f.allSystems()) {
                root = f.path;
                tree = f.tree;
                break;
            }
        }
        if (root.isEmpty() && !romFolders.isEmpty()) {
            root = romFolders.get(0).path;
            tree = romFolders.get(0).tree;
        }
        put("romsRoot", root);
        put("romsTree", tree);
    }

    private String folderSummary() {
        StringBuilder sb = new StringBuilder();
        if (frontend.equals("esde") && !esRoot.isEmpty()) {
            sb.append("downloaded_media: ").append(new File(esRoot, "downloaded_media").isDirectory() ? "found" : "not found").append("\n");
            sb.append("custom_systems/es_systems.xml: ").append(new File(esRoot, "custom_systems/es_systems.xml").isFile() ? "found" : "not found");
        }
        return sb.toString();
    }

    private void pickFolder(int request) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(i, request);
        } catch (Exception e) {
            Toast.makeText(this, "No folder picker is available on this device.", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        if (requestCode != REQ_ROMS && requestCode != REQ_ES && requestCode != REQ_DATA) return;

        Uri u = data.getData();
        try {
            getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
        }
        String path = PathUtil.fromTree(u);
        if (path == null) {
            Toast.makeText(this, "Could not read that folder's location.", Toast.LENGTH_LONG).show();
            return;
        }
        collect();
        if (requestCode == REQ_ROMS) {
            if (Config.hasPath(romFolders, path)) {
                Toast.makeText(this, "That folder is already in the list.", Toast.LENGTH_LONG).show();
                return;
            }
            romFolders.add(new Config.RomFolder(path, u.toString(), detectSystem(new File(path))));
            if (frontend.equals("esde") && esRoot.isEmpty()) esRoot = guessEsRoot();
        } else if (requestCode == REQ_DATA) {
            dataRoot = path.endsWith("/" + DataStore.DEFAULT_FOLDER) ? path : path + "/" + DataStore.DEFAULT_FOLDER;
        } else {
            esRoot = path;
        }
        render();
    }

    /** Applies the folder choices so the next steps can look at your real systems. */
    /** The chosen data folder, else the default when file access allows it, else empty (the app's private folder). */
    private String effectiveDataRoot() {
        if (!dataRoot.isEmpty()) return dataRoot;
        File def = DataStore.defaultRoot();
        return def == null ? "" : def.getPath();
    }

    private void applyFolders() {
        File dataBefore = DataStore.root(this);
        put("dataRoot", effectiveDataRoot()); // saved as a real path so it can't change if file access changes later
        saveRomFolders();
        put("esRoot", esRoot);
        put("frontend", frontend);
        Prefs.putInt(this, "useEsdeMedia", useEsdeMedia ? 1 : 0);
        Prefs.putInt(this, "launchboxArt", launchBoxArt ? 1 : 0);
        Config.load(this);
        DataStore.relocate(this, dataBefore, DataStore.root(this)); // moves what is already saved, in the background
        LaunchBoxArt.reset();
        EsdeImport.run(this, Config.ES_ROOT);
        Recipes.reset();
        Shared.reload(this);
    }

    /** Everything the emulator page lists, worked out off the main thread (it reads app lists and folders). */
    private static final class EmuData {
        final List<String> found = new ArrayList<String>();
        final List<Recipes.Recipe> recipes = new ArrayList<Recipes.Recipe>();
        final Map<String, String> pkgs = new HashMap<String, String>();
        final List<SystemMap.Sys> systems = new ArrayList<SystemMap.Sys>();
        final Map<String, List<String>> standalone = new HashMap<String, List<String>>();
        final Map<String, List<String>> cores = new HashMap<String, List<String>>();
        /** Apps with a launcher icon, as {package, name}, sorted by name, for your own launch commands. */
        final List<String[]> apps = new ArrayList<String[]>();
        boolean coresRead;
    }

    private int emuGen;

    private void stepEmulators() {
        final int gen = ++emuGen;
        text(Shared.indexReady() ? "Looking for your emulators..." : "Scanning ROMs...", 14, MUTED);
        final String raPkgNow = raPackage;
        final Map<String, String> choices = new HashMap<String, String>(emuChoice);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final EmuData d = new EmuData();
                try {
                    RaCores.refresh();
                    for (String pkg : RA_PACKAGES) {
                        try {
                            getPackageManager().getPackageInfo(pkg, 0);
                            d.found.add(pkg);
                        } catch (Exception ignored) {
                        }
                    }
                    for (Recipes.Recipe r : Recipes.all(SetupActivity.this)) {
                        String pkg = Recipes.installedPackage(SetupActivity.this, r);
                        d.recipes.add(r);
                        d.pkgs.put(r.id, pkg == null ? "" : pkg);
                    }
                    try {
                        android.content.pm.PackageManager pm = getPackageManager();
                        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                        java.util.Set<String> seenPkg = new java.util.HashSet<String>();
                        for (android.content.pm.ResolveInfo ri : pm.queryIntentActivities(main, 0)) {
                            String pkg = ri.activityInfo.packageName;
                            if (pkg.equals(getPackageName()) || !seenPkg.add(pkg)) continue;
                            d.apps.add(new String[]{pkg, String.valueOf(ri.loadLabel(pm))});
                        }
                        java.util.Collections.sort(d.apps, new java.util.Comparator<String[]>() {
                            @Override
                            public int compare(String[] a, String[] b) {
                                return a[1].compareToIgnoreCase(b[1]);
                            }
                        });
                    } catch (Exception ignored) {
                    }
                    String raUse = d.found.isEmpty() ? "" : (raPkgNow.isEmpty() || !d.found.contains(raPkgNow) ? d.found.get(0) : raPkgNow);
                    d.coresRead = !raUse.isEmpty() && RaCores.installed(SetupActivity.this, raUse) != null;
                    // only systems you actually have ROMs for (ES-DE makes an empty folder for every system)
                    // a fresh install may still be scanning: wait for it (up to a minute) so every system isn't listed
                    for (int i = 0; i < 120 && !Shared.indexReady(); i++) {
                        try {
                            Thread.sleep(500);
                        } catch (InterruptedException ignored) {
                            break;
                        }
                    }
                    java.util.Set<String> withRoms = new java.util.HashSet<String>();
                    try {
                        for (RomIndex.Rom rom : Shared.index().all()) withRoms.add(rom.sys.folder);
                    } catch (Exception ignored) {
                    }
                    for (SystemMap.Sys sys : Shared.systems().all) {
                        if (withRoms.isEmpty() ? !sys.present() : !withRoms.contains(sys.folder)) continue;
                        List<String> st = new ArrayList<String>();
                        for (String id : sys.standalones) {
                            String p = d.pkgs.get(id);
                            if (p != null && !p.isEmpty()) st.add(id);
                        }
                        List<String> cores = new ArrayList<String>();
                        if (!raUse.isEmpty()) {
                            String curVal = choices.containsKey(sys.folder) ? choices.get(sys.folder) : get("emu." + sys.folder, "");
                            String curCore = curVal.startsWith("retroarch:") ? curVal.substring(10).split("@")[0] : "";
                            cores = RaCores.forSystem(SetupActivity.this, sys, raUse, curCore);
                        }
                        d.systems.add(sys);
                        d.standalone.put(sys.folder, st);
                        d.cores.put(sys.folder, cores);
                    }
                } catch (Exception ignored) {
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed() || gen != emuGen || step != 3) return;
                        content.removeAllViews();
                        emuSpinners.clear();
                        spRa = null;
                        buildEmulators(d);
                    }
                });
            }
        }).start();
    }

    /** A button that shows or hides a group of rows under it. */
    private void addDropdown(final String label, final LinearLayout box, boolean open) {
        final Button toggle = action(label, null);
        box.setVisibility(open ? View.VISIBLE : View.GONE);
        toggle.setText(label + (open ? "  \u25b4" : "  \u25be"));
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                boolean show = box.getVisibility() != View.VISIBLE;
                box.setVisibility(show ? View.VISIBLE : View.GONE);
                toggle.setText(label + (show ? "  \u25b4" : "  \u25be"));
            }
        });
        content.addView(box);
    }

    private void buildEmulators(EmuData d) {
        if (editing != null) {
            customCommandForm(d);
            return;
        }
        List<String> found = d.found;
        text("Emulators", 17, TEXT);
        final LinearLayout installedBox = new LinearLayout(this);
        installedBox.setOrientation(LinearLayout.VERTICAL);
        final LinearLayout notInstalled = new LinearLayout(this);
        notInstalled.setOrientation(LinearLayout.VERTICAL);
        notInstalled.setVisibility(View.GONE);
        int have = 0, missing = 0;
        // RetroArch is an emulator too (it runs every system that has a core)
        if (found.isEmpty()) {
            missing++;
            TextView t = text("RetroArch", 14, MUTED);
            content.removeView(t);
            notInstalled.addView(t);
        } else {
            have++;
            TextView t = text("Found: RetroArch", 14, TEAL);
            content.removeView(t);
            installedBox.addView(t);
            // which RetroArch to use, when there is more than one (64-bit, 32-bit)
            int sel = Math.max(0, found.indexOf(raPackage));
            spRa = spinner(found, sel);
            content.removeView(spRa);
            installedBox.addView(spRa);
        }
        for (Recipes.Recipe r : d.recipes) {
            String pkg = d.pkgs.get(r.id);
            if (pkg != null && !pkg.isEmpty()) {
                have++;
                TextView t = text("Found: " + r.label + " (" + pkg + ")", 14, TEAL);
                content.removeView(t);
                installedBox.addView(t);
            } else {
                missing++;
                TextView t = text(r.label, 14, MUTED);
                content.removeView(t);
                notInstalled.addView(t);
            }
        }
        if (have == 0) {
            TextView none = text("None found yet", 14, MUTED);
            content.removeView(none);
            installedBox.addView(none);
        }
        addDropdown("Installed (" + have + ")", installedBox, true);
        if (missing > 0) {
            addDropdown("Not installed (" + missing + ")", notInstalled, false);
        }

        // One choice per system folder you have: every standalone emulator that is installed and can play it,
        // then the RetroArch cores for it.
        boolean haveRa = !found.isEmpty();
        emuValues.clear();
        boolean any = false;
        for (SystemMap.Sys sys : d.systems) {
            List<String> items = new ArrayList<String>();
            List<String> values = new ArrayList<String>();
            for (String id : d.standalone.get(sys.folder)) {
                Recipes.Recipe r = Recipes.byId(this, id);
                if (r == null) continue;
                items.add((id.startsWith(CustomLaunch.ID_PREFIX) ? "Your command: " : "Standalone: ") + r.label);
                values.add("standalone:" + id);
            }
            for (String c : d.cores.get(sys.folder)) {
                items.add("RetroArch: " + c);
                values.add("retroarch:" + c);
            }
            if (items.isEmpty()) continue;

            if (!any) {
                text("Which emulator for each system?", 17, TEXT);
                text("Only the systems you have ROMs for are listed, each with its installed emulators and the RetroArch cores for it.", 13, MUTED);
                any = true;
            }
            text(sys.folder, 14, GOLD);
            String cur = emuChoice.containsKey(sys.folder) ? emuChoice.get(sys.folder) : get("emu." + sys.folder, "");
            int sel = values.indexOf(cur);
            if (sel < 0 && cur.equals("retroarch")) { // an older install saved just "retroarch": the system's own core
                for (int i = 0; i < values.size(); i++) {
                    if (values.get(i).startsWith("retroarch:")) {
                        sel = i;
                        break;
                    }
                }
            }
            if (sel < 0) sel = 0;
            emuValues.put(sys.folder, values);
            emuSpinners.put(sys.folder, spinner(items, sel));
        }
        if (!any) {
            text("No system folders with an installed emulator were found yet. Choose your ROMs folder in the previous step "
                    + "and install the emulators you use.", 13, MUTED);
        }
        customCommandList();
    }
    // your own launch commands (see CustomLaunch)

    /** The command being added or changed on the emulator page, or null when the page shows the usual list. */
    private CustomLaunch.Command editing;
    private EditText etCustName, etCustAct, etCustCmd;
    private Spinner spCustSys, spCustApp;
    private CheckBox cbCustDual;
    private final List<String> custSysValues = new ArrayList<String>();
    private final List<String> custAppValues = new ArrayList<String>();

    private void customCommandList() {
        text("Your own launch commands", 17, TEXT);
        text("For an emulator this app doesn't know, or to start a console a different way. Commands use ES-DE's format, so "
                + "you can copy one from ES-DE's es_find_rules.xml or es_systems.xml. Once added, the command is picked for "
                + "its console above, and you can switch back there at any time.", 13, MUTED);
        List<CustomLaunch.Command> list = CustomLaunch.all(this);
        for (final CustomLaunch.Command c : list) {
            StringBuilder sb = new StringBuilder(c.label.isEmpty() ? c.pkg : c.label);
            if (!c.systems.isEmpty()) sb.append("  (").append(android.text.TextUtils.join(", ", c.systems)).append(")");
            text(sb.toString(), 14, TEAL);
            action("Edit", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    collect();
                    editing = c;
                    render();
                }
            });
        }
        action("Add a launch command", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                collect();
                editing = new CustomLaunch.Command();
                render();
            }
        });
    }

    private void customCommandForm(EmuData d) {
        final CustomLaunch.Command c = editing;
        final boolean isNew = c.id.isEmpty();
        spCustSys = null;
        spCustApp = null;
        text(isNew ? "New launch command" : "Change launch command", 17, TEXT);

        text("Name", 14, TEXT);
        etCustName = field("Like \"DuckStation (my settings)\"", c.label, false);

        text("Console", 14, TEXT);
        custSysValues.clear();
        List<String> sysLabels = new ArrayList<String>();
        for (SystemMap.Sys s : d.systems) {
            String base = s.base.isEmpty() ? s.folder : s.base;
            if (custSysValues.contains(base)) continue;
            custSysValues.add(base);
            sysLabels.add(systemLabel(base));
        }
        String curSys = c.systems.isEmpty() ? "" : c.systems.get(0);
        if (!curSys.isEmpty() && !custSysValues.contains(curSys)) {
            custSysValues.add(curSys);
            sysLabels.add(systemLabel(curSys));
        }
        if (custSysValues.isEmpty()) {
            text("No consoles with ROMs were found yet. Add your ROM folders in the previous step first.", 13, GOLD);
        } else {
            spCustSys = spinner(sysLabels, Math.max(0, custSysValues.indexOf(curSys)));
        }

        text("App", 14, TEXT);
        custAppValues.clear();
        List<String> appLabels = new ArrayList<String>();
        for (String[] a : d.apps) {
            custAppValues.add(a[0]);
            appLabels.add(a[1] + " (" + a[0] + ")");
        }
        if (!c.pkg.isEmpty() && !custAppValues.contains(c.pkg)) { // saved for an app that isn't installed right now
            custAppValues.add(c.pkg);
            appLabels.add(c.pkg + " (not installed)");
        }
        spCustApp = spinner(appLabels, Math.max(0, custAppValues.indexOf(c.pkg)));

        text("Activity (optional)", 14, TEXT);
        text("The screen of the app to open, like .EmulationActivity or com.example.emu.MainActivity. Leave it empty to let "
                + "Android pick from the command.", 13, MUTED);
        etCustAct = field(".EmulationActivity", c.activity, false);

        text("Command", 14, TEXT);
        text("%ACTION%, %CATEGORY%, %DATA%, %MIMETYPE%, %EXTRA_name%, %EXTRABOOL_name%, %EXTRAINTEGER_name%, %EXTRALONG_name%, "
                + "%EXTRAARRAY_name% and %ACTIVITY_CLEAR_TASK% work. For the game use %ROMSAF% (a content address), %ROM% "
                + "(the file path), %ROMFILEURI% or %BASENAME%. An %EMULATOR_...% part is skipped, since the app is picked above.", 13, MUTED);
        etCustCmd = field("%ACTION%=android.intent.action.VIEW %DATA%=%ROMSAF%", c.command, true);
        etCustCmd.setSingleLine(false);
        etCustCmd.setMinLines(3);
        etCustCmd.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);

        cbCustDual = new CheckBox(this);
        cbCustDual.setText("Shows both screens itself (like a DS emulator), so it starts on the bottom screen");
        cbCustDual.setTextColor(TEXT);
        cbCustDual.setTextSize(14);
        cbCustDual.setChecked(c.dual);
        content.addView(cbCustDual);

        action("Save", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveCustomCommand(c, isNew);
            }
        });
        action("Cancel", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editing = null;
                render();
            }
        });
        if (!isNew) {
            action("Delete", new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    deleteCustomCommand(c);
                }
            });
        }
    }

    private void saveCustomCommand(CustomLaunch.Command c, boolean isNew) {
        int app = spCustApp == null ? -1 : spCustApp.getSelectedItemPosition();
        if (app < 0 || app >= custAppValues.size()) {
            Toast.makeText(this, "Pick the app this command opens.", Toast.LENGTH_LONG).show();
            return;
        }
        int sys = spCustSys == null ? -1 : spCustSys.getSelectedItemPosition();
        if (sys < 0 || sys >= custSysValues.size()) {
            Toast.makeText(this, "Pick the console this command is for.", Toast.LENGTH_LONG).show();
            return;
        }
        List<CustomLaunch.Command> list = CustomLaunch.all(this);
        CustomLaunch.Command saved = c;
        if (isNew) {
            saved = new CustomLaunch.Command();
            saved.id = CustomLaunch.newId(list);
            list.add(saved);
        } else {
            for (CustomLaunch.Command x : list) {
                if (x.id.equals(c.id)) saved = x;
            }
        }
        saved.pkg = custAppValues.get(app);
        saved.label = etCustName.getText().toString().trim();
        if (saved.label.isEmpty()) saved.label = (String) spCustApp.getSelectedItem();
        saved.activity = etCustAct.getText().toString().trim();
        saved.command = etCustCmd.getText().toString().trim();
        saved.dual = cbCustDual.isChecked();
        saved.systems.clear();
        saved.systems.add(custSysValues.get(sys));

        CustomLaunch.Parsed p = CustomLaunch.parse(saved);
        CustomLaunch.saveAll(this, list);
        Recipes.reset();
        Shared.reload(this);

        // use it for its console right away, including a folder named your own way for the same console
        String value = "standalone:" + saved.id;
        SystemMap m = Shared.systems();
        if (m != null) {
            for (SystemMap.Sys s : m.all) {
                String base = s.base.isEmpty() ? s.folder : s.base;
                if (!saved.systems.contains(base)) continue;
                emuChoice.put(s.folder, value);
                put("emu." + s.folder, value);
            }
        }
        if (!p.unknown.isEmpty()) {
            Toast.makeText(this, "Saved. These parts weren't understood and are left out: "
                    + android.text.TextUtils.join(" ", p.unknown), Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "Saved and picked for " + systemLabel(saved.systems.get(0)) + ".", Toast.LENGTH_SHORT).show();
        }
        editing = null;
        render();
    }

    private void deleteCustomCommand(CustomLaunch.Command c) {
        List<CustomLaunch.Command> list = CustomLaunch.all(this);
        for (int i = list.size() - 1; i >= 0; i--) {
            if (list.get(i).id.equals(c.id)) list.remove(i);
        }
        CustomLaunch.saveAll(this, list);
        // consoles and games that used it go back to the usual emulator
        String value = "standalone:" + c.id;
        for (Map.Entry<String, ?> e : Prefs.all(this).entrySet()) {
            String k = e.getKey();
            if ((k.startsWith("emu.") || k.startsWith("gemu.")) && value.equals(e.getValue())) Prefs.remove(this, k);
        }
        List<String> drop = new ArrayList<String>();
        for (Map.Entry<String, String> e : emuChoice.entrySet()) {
            if (value.equals(e.getValue())) drop.add(e.getKey());
        }
        for (String k : drop) emuChoice.remove(k);
        Recipes.reset();
        Shared.reload(this);
        editing = null;
        render();
    }


    private void stepScreens() {
        if (!DisplayPicker.hasTwoScreens(this)) {
            text("You are using a single-screen device, so the app shows the tracker and game art on this one screen. "
                    + "Nothing to set up for screens.", 14, MUTED);
        }
        if (DisplayPicker.hasTwoScreens(this)) {
            text("One screen only", 17, TEXT);
            text("This device has two screens. Tick this to use the app on just one of them, with the tracker and the game art "
                    + "together, like on a single-screen device.", 13, MUTED);
            cbSingle = new CheckBox(this);
            cbSingle.setText("Use one screen only");
            cbSingle.setTextColor(TEXT);
            cbSingle.setTextSize(14);
            cbSingle.setChecked(singleScreen);
            content.addView(cbSingle);
            List<String> which = new ArrayList<String>();
            which.add("Top screen");
            which.add("Bottom screen");
            spSingle = spinner(which, "top".equals(singleWhich) ? 0 : 1);
        }
        if (DisplayPicker.hasTwoScreens(this)) {
            text("Top screen", 17, TEXT);
            text("The screen that shows game art and runs your games. Automatic picks the screen this app is not on.", 13, MUTED);
            List<String> items = new ArrayList<String>();
            items.add("Automatic");
            displayIds.clear();
            DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            for (Display d : dm.getDisplays()) {
                displayIds.add(d.getDisplayId());
                items.add("Display " + d.getDisplayId() + ": " + d.getName());
            }
            int sel = 0;
            if (topDisplay >= 0 && displayIds.contains(topDisplay)) sel = displayIds.indexOf(topDisplay) + 1;
            spDisplay = spinner(items, sel);
        }

        text("Display size", 17, TEXT);
        text("Compact shows the most on screen. Pick a larger size if text is too small.", 13, MUTED);
        List<String> zooms = new ArrayList<String>();
        int zsel = 1;
        for (int i = 0; i < ZOOM_LABELS.length; i++) {
            zooms.add(ZOOM_LABELS[i]);
            if (ZOOM_VALUES[i] == cssWidth) zsel = i;
        }
        spZoom = spinner(zooms, zsel);
    }

    private void stepFinish() {
        text("Almost done.", 17, TEXT);
        fileAccessRow();
        StringBuilder sb = new StringBuilder();
        sb.append("RetroAchievements: ").append(raUser.isEmpty() ? "not set" : raUser).append("\n");
        sb.append("SteamGridDB: ").append(sgdbKey.isEmpty() ? "not set" : "key set").append("\n");
        sb.append("Free LaunchBox art: ").append(launchBoxArt ? "on" : "off").append("\n");
        if (romFolders.isEmpty()) sb.append("ROMs: not chosen\n");
        for (int i = 0; i < romFolders.size(); i++) {
            Config.RomFolder f = romFolders.get(i);
            sb.append(romFolders.size() == 1 ? "ROMs: " : "ROMs " + (i + 1) + ": ").append(f.path);
            if (!f.allSystems()) sb.append(" (").append(systemLabel(f.system)).append(")");
            sb.append("\n");
        }
        sb.append("Frontend: ").append(frontend.equals("esde") ? "ES-DE" : "none / other").append("\n");
        if (frontend.equals("esde")) sb.append("ES-DE: ").append(esRoot.isEmpty() ? "none" : esRoot).append("\n");
        sb.append("App data: ").append(effectiveDataRoot().isEmpty() ? "the app's private folder" : effectiveDataRoot()).append("\n");
        sb.append("Existing art: ").append(useEsdeMedia ? "used as it is" : "not used").append("\n");
        sb.append("RetroArch: ").append(raPackage.isEmpty() ? "default" : raPackage).append("\n");
        sb.append("Screens: ").append(singleScreen ? "one screen only (" + singleWhich + ")" : (topDisplay < 0 ? "two screens, automatic" : "two screens, top is display " + topDisplay));
        text(sb.toString(), 13, MUTED);
        text("Tap Finish to start the tracker.", 14, MUTED);
    }

    // navigation
    private void collect() {
        if (etUser != null) raUser = etUser.getText().toString().trim();
        if (etKey != null) raKey = etKey.getText().toString().trim();
        if (etSgdb != null) sgdbKey = etSgdb.getText().toString().trim();
        if (spRa != null && spRa.getSelectedItem() != null) raPackage = (String) spRa.getSelectedItem();
        for (Map.Entry<String, Spinner> e : emuSpinners.entrySet()) {
            List<String> values = emuValues.get(e.getKey());
            int p = e.getValue().getSelectedItemPosition();
            if (values != null && p >= 0 && p < values.size()) emuChoice.put(e.getKey(), values.get(p));
        }
        if (cbSingle != null) singleScreen = cbSingle.isChecked();
        if (spSingle != null) singleWhich = spSingle.getSelectedItemPosition() == 0 ? "top" : "bottom";
        for (int i = 0; i < folderSpinners.size() && i < romFolders.size(); i++) {
            List<String> values = folderValues.get(i);
            int p = folderSpinners.get(i).getSelectedItemPosition();
            if (p < 0 || p >= values.size()) continue;
            Config.RomFolder f = romFolders.get(i);
            if (!values.get(p).equals(f.system)) romFolders.set(i, new Config.RomFolder(f.path, f.tree, values.get(p)));
        }
        if (spDisplay != null) {
            int p = spDisplay.getSelectedItemPosition();
            topDisplay = (p <= 0 || p - 1 >= displayIds.size()) ? -1 : displayIds.get(p - 1);
        }
        if (spZoom != null) {
            int p = spZoom.getSelectedItemPosition();
            if (p >= 0 && p < ZOOM_VALUES.length) cssWidth = ZOOM_VALUES[p];
        }
    }

    private void goBack() {
        collect();
        if (editing != null) { // Back leaves the launch command form without saving
            editing = null;
            render();
            return;
        }
        if (step == 0) {
            closeWizard();
            return;
        }
        step--;
        render();
    }

    private void goNext() {
        collect();
        if (editing != null) {
            Toast.makeText(this, "Save or cancel the launch command first.", Toast.LENGTH_LONG).show();
            return;
        }
        if (step == 2) {
            if (romFolders.isEmpty()) {
                Toast.makeText(this, "Add your ROMs folder first.", Toast.LENGTH_LONG).show();
                return;
            }
            applyFolders();
        }
        if (step == LAST_STEP) {
            save();
            return;
        }
        step++;
        render();
    }

    private void save() {
        put("raUser", raUser);
        put("raKey", raKey);
        if (!raUser.equals(origUser) || !raKey.equals(origKey)) {
            put("credsRev", String.valueOf(System.currentTimeMillis()));
        }

        put("dataRoot", effectiveDataRoot());
        saveRomFolders();
        put("esRoot", esRoot);
        put("frontend", frontend);
        Prefs.putInt(this, "launchboxArt", launchBoxArt ? 1 : 0);
        String ra = raPackage;
        if (ra.isEmpty()) {
            // Next was pressed on the emulator step before it had finished looking: use the RetroArch that is installed
            for (String pkg : RA_PACKAGES) {
                try {
                    getPackageManager().getPackageInfo(pkg, 0);
                    ra = pkg;
                    break;
                } catch (Exception ignored) {
                }
            }
        }
        put("raPackage", ra.isEmpty() ? "com.retroarch.aarch64" : ra);
        put("siteUrl", siteUrl.startsWith("http") ? siteUrl : Config.DEFAULT_URL);
        put("sgdbKey", sgdbKey);
        Prefs.putInt(this, "useEsdeMedia", useEsdeMedia ? 1 : 0);
        Prefs.putInt(this, "cssWidth", cssWidth);
        DisplayPicker.save(this, topDisplay);
        DisplayPicker.saveSingle(this, singleScreen, singleWhich);

        for (Map.Entry<String, String> e : emuChoice.entrySet()) {
            put("emu." + e.getKey(), e.getValue());
        }

        Config.load(this);
        Recipes.reset();
        for (Recipes.Recipe r : Recipes.all(this)) {
            String pkg = Recipes.installedPackage(this, r);
            if (pkg != null) put("pkg." + r.id, pkg);
        }
        Prefs.setSetupDone(this, true);
        EsdeImport.run(this, Config.ES_ROOT);
        Shared.reload(this);

        finished = true;
        closeWizard();
    }

    /** Closes the wizard and removes it from the recent-apps list too, so it does not stay open in the taskbar. */
    private void closeWizard() {
        closing = true;
        running = false; // so the main screen, resuming as this closes, does not bring the wizard back
        put("wizardDraft", "");
        tellClosed();
        finishAndRemoveTask();
    }
}
