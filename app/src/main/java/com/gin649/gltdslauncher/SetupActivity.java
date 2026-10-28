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
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
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

    private static final int REQ_ROMS = 10;
    private static final int REQ_ES = 11;

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEAL = Color.rgb(89, 201, 165);
    private static final int TEXT = Color.rgb(236, 232, 247);
    private static final int MUTED = Color.rgb(148, 141, 179);

    private static final String[] ZOOM_LABELS = {"Compact (fits the most)", "Normal", "Large", "Extra large"};
    private static final int[] ZOOM_VALUES = {900, 720, 560, 440};
    private static final String[] RA_PACKAGES = {"com.retroarch.aarch64", "com.retroarch", "com.retroarch.ra32"};
    private static final String[] STEP_TITLES = {"Welcome", "Your accounts", "Your folders", "Emulators", "Screens", "Finish"};
    private static final int LAST_STEP = 5;

    private LinearLayout content;
    private TextView titleView;
    private Button backBtn;
    private Button nextBtn;
    private int step;
    private boolean firstRun;
    private boolean finished;

    private String raUser, raKey, rawgKey, romsRoot, romsTree, esRoot, raPackage, siteUrl;
    private String origUser, origKey, origRawg;
    private String ssUser, ssPass;
    private EditText etSsUser, etSsPass;
    private CheckBox cbEsdeMedia;
    private boolean useEsdeMedia;
    private int cssWidth;
    private int topDisplay;
    private final Map<String, String> emuChoice = new HashMap<String, String>();

    // views of the step on screen
    private EditText etUser, etKey, etRawg, etSite;
    private Spinner spRa, spDisplay, spZoom;
    private final Map<String, Spinner> emuSpinners = new LinkedHashMap<String, Spinner>();
    private final List<Integer> displayIds = new ArrayList<Integer>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        running = true;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        firstRun = !Prefs.setupDone(this);
        raUser = get("raUser", "");
        raKey = get("raKey", "");
        rawgKey = get("rawgKey", "");
        origUser = raUser;
        origKey = raKey;
        origRawg = rawgKey;
        romsRoot = get("romsRoot", "");
        romsTree = get("romsTree", "");
        esRoot = get("esRoot", "");
        raPackage = get("raPackage", "");
        siteUrl = get("siteUrl", Config.DEFAULT_URL);
        if (siteUrl.startsWith("https://gin649.github.io/")) siteUrl = Config.DEFAULT_URL; // old default = built-in
        ssUser = get("ssUser", "");
        ssPass = get("ssPass", "");
        useEsdeMedia = Prefs.getInt(this, "useEsdeMedia", 1) == 1;
        cssWidth = Prefs.getInt(this, "cssWidth", 720);
        topDisplay = DisplayPicker.prefs(this).getInt("topDisplay", -1);

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

        if (esRoot.isEmpty()) esRoot = guessEsRoot();
        render();
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
        if (listener != null) listener.onClosed(finished);
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    // ---------- small helpers ----------

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
        wireBottomKeyboard(e, hint);
        content.addView(e);
        return e;
    }

    /**
     * Setup lives on the top screen, but the keyboard should come up on the bottom one. So on a
     * two-screen device, picking a field opens a small entry screen on the bottom display and the
     * text comes back here. On a single screen the field just works in place.
     */
    private void wireBottomKeyboard(final EditText e, final String label) {
        int bottom = DisplayPicker.bottomDisplayId(this);
        if (bottom < 0 || DisplayPicker.displayOf(this) == bottom) return;
        e.setShowSoftInputOnFocus(false);
        e.setFocusableInTouchMode(false);
        e.setCursorVisible(false);
        e.setLongClickable(false);
        e.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editOnBottom(e, label);
            }
        });
        // A controller's A button (or Enter) on a field opens the entry screen too.
        e.setOnKeyListener(new View.OnKeyListener() {
            @Override
            public boolean onKey(View v, int keyCode, KeyEvent event) {
                boolean confirm = keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                        || keyCode == KeyEvent.KEYCODE_ENTER
                        || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                        || keyCode == KeyEvent.KEYCODE_BUTTON_A;
                if (!confirm) return false;
                if (event.getAction() == KeyEvent.ACTION_UP) editOnBottom(e, label);
                return true;
            }
        });
    }

    private void editOnBottom(final EditText e, String label) {
        if (TextEntryActivity.pending != null) return; // already open
        int bottom = DisplayPicker.bottomDisplayId(this);
        Intent i = new Intent(this, TextEntryActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        i.putExtra(TextEntryActivity.EXTRA_LABEL, label);
        i.putExtra(TextEntryActivity.EXTRA_TEXT, e.getText().toString());
        i.putExtra(TextEntryActivity.EXTRA_INPUT_TYPE, e.getInputType());
        TextEntryActivity.pending = new TextEntryActivity.Result() {
            @Override
            public void onText(String text) {
                e.setText(text);
            }
        };
        try {
            if (bottom >= 0) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setLaunchDisplayId(bottom);
                startActivity(i, options.toBundle());
            } else {
                startActivity(i);
            }
        } catch (Exception ex) {
            TextEntryActivity.pending = null;
            Toast.makeText(this, "Couldn't open the keyboard screen", Toast.LENGTH_SHORT).show();
        }
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

    // ---------- steps ----------

    private void render() {
        content.removeAllViews();
        etUser = null;
        etKey = null;
        etRawg = null;
        etSsUser = null;
        etSsPass = null;
        cbEsdeMedia = null;
        etSite = null;
        spRa = null;
        spDisplay = null;
        spZoom = null;
        emuSpinners.clear();

        titleView.setText((step + 1) + " of " + (LAST_STEP + 1) + "   " + STEP_TITLES[step]);
        backBtn.setText(step == 0 ? "Cancel" : "Back");
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

    private void stepWelcome() {
        text("Let's set up Game Log Tracker on this device.", 17, TEXT);
        text("It takes a minute. Everything can be changed later from the tracker's menu, under Launcher settings.", 14, MUTED);
        text("First, the app needs access to your files so it can find your games and their artwork.", 14, MUTED);
        fileAccessRow();
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
        text("RAWG (optional)", 17, TEXT);
        text("A free key that adds ratings and game details.", 13, MUTED);
        etRawg = field("RAWG API key", rawgKey, false);
        action("Get a free RAWG key", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openUrl("https://rawg.io/apidocs");
            }
        });
        text("ScreenScraper (optional)", 17, TEXT);
        text("Your ScreenScraper login. It is used to fetch box art and screenshots and build the top-screen art. "
                + "Leave blank to use the login from your ES-DE settings, if it has one.", 13, MUTED);
        etSsUser = field("ScreenScraper username", ssUser, false);
        etSsPass = field("ScreenScraper password", ssPass, false);
        action("Create a ScreenScraper account", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openUrl("https://screenscraper.fr");
            }
        });
    }

    private void stepFolders() {
        text("ROMs folder", 17, TEXT);
        text("The folder that holds one folder per system, like gba, snes and psx.", 13, MUTED);
        text(romsRoot.isEmpty() ? "Not chosen yet" : romsRoot, 14, romsRoot.isEmpty() ? GOLD : TEAL);
        action("Choose ROMs folder", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickFolder(REQ_ROMS);
            }
        });

        text("ES-DE folder (optional)", 17, TEXT);
        text("The ES-DE data folder, the one that contains downloaded_media. It gives the top screen your game art "
                + "and brings in your own custom systems.", 13, MUTED);
        text(esRoot.isEmpty() ? "Not chosen" : esRoot, 14, esRoot.isEmpty() ? MUTED : TEAL);
        action("Choose ES-DE folder", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickFolder(REQ_ES);
            }
        });

        if (!esRoot.isEmpty() && new File(esRoot, "downloaded_media").isDirectory()) {
            cbEsdeMedia = new CheckBox(this);
            cbEsdeMedia.setText("Use my ES-DE media (box art, screenshots, fan art) for the top screen, so nothing "
                    + "is downloaded again. ScreenScraper is only asked about games that have none.");
            cbEsdeMedia.setTextColor(TEXT);
            cbEsdeMedia.setTextSize(14);
            cbEsdeMedia.setChecked(useEsdeMedia);
            content.addView(cbEsdeMedia);
        }

        String summary = folderSummary();
        if (!summary.isEmpty()) text(summary, 13, MUTED);
    }

    private String folderSummary() {
        StringBuilder sb = new StringBuilder();
        if (!romsRoot.isEmpty()) {
            File[] dirs = new File(romsRoot).listFiles();
            int n = 0;
            if (dirs != null) {
                for (File d : dirs) {
                    if (d.isDirectory()) n++;
                }
            }
            sb.append(n).append(" system folders found in the ROMs folder");
            if (!hasFileAccess()) sb.append(" (allow file access to see them)");
            sb.append("\n");
        }
        if (!esRoot.isEmpty()) {
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
        if (requestCode != REQ_ROMS && requestCode != REQ_ES) return;

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
            romsRoot = path;
            romsTree = u.toString();
            if (esRoot.isEmpty()) esRoot = guessEsRoot();
        } else {
            esRoot = path;
        }
        render();
    }

    /** Applies the folder choices so the next steps can look at your real systems. */
    private void applyFolders() {
        put("romsRoot", romsRoot);
        put("romsTree", romsTree);
        put("esRoot", esRoot);
        Prefs.putInt(this, "useEsdeMedia", useEsdeMedia ? 1 : 0);
        Config.load(this);
        EsdeImport.run(this, Config.ES_ROOT);
        Recipes.reset();
        Shared.reload(this);
    }

    private void stepEmulators() {
        text("RetroArch", 17, TEXT);
        List<String> found = new ArrayList<String>();
        for (String pkg : RA_PACKAGES) {
            try {
                getPackageManager().getPackageInfo(pkg, 0);
                found.add(pkg);
            } catch (Exception ignored) {
            }
        }
        if (found.isEmpty()) {
            text("RetroArch was not found. Install it to play most systems.", 14, GOLD);
        } else {
            int sel = Math.max(0, found.indexOf(raPackage));
            spRa = spinner(found, sel);
        }

        text("Standalone emulators", 17, TEXT);
        for (Recipes.Recipe r : Recipes.all(this)) {
            String pkg = Recipes.installedPackage(this, r);
            if (pkg != null) {
                text("Found: " + r.label + " (" + pkg + ")", 14, TEAL);
            } else {
                text("Not installed: " + r.label, 14, MUTED);
            }
        }

        boolean any = false;
        for (SystemMap.Sys s : Shared.systems().all) {
            if (s.standalone.isEmpty() || s.core.isEmpty()) continue;
            Recipes.Recipe r = Recipes.byId(this, s.standalone);
            if (r == null || Recipes.installedPackage(this, r) == null) continue;
            if (!s.dir().isDirectory()) continue;

            if (!any) {
                text("Which emulator for each system?", 17, TEXT);
                any = true;
            }
            text(s.folder, 14, GOLD);
            List<String> items = new ArrayList<String>();
            items.add("Standalone: " + r.label);
            items.add("RetroArch: " + s.core);
            String cur = emuChoice.containsKey(s.folder) ? emuChoice.get(s.folder) : get("emu." + s.folder, "");
            emuSpinners.put(s.folder, spinner(items, "retroarch".equals(cur) ? 1 : 0));
        }
        text("Nintendo DS and 3DS games are not launched from here, since those emulators use both screens.", 13, MUTED);
    }

    private void stepScreens() {
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

        text("Tracker size on the bottom screen", 17, TEXT);
        text("Compact shows the most on screen. Pick a larger size if text is too small.", 13, MUTED);
        List<String> zooms = new ArrayList<String>();
        int zsel = 1;
        for (int i = 0; i < ZOOM_LABELS.length; i++) {
            zooms.add(ZOOM_LABELS[i]);
            if (ZOOM_VALUES[i] == cssWidth) zsel = i;
        }
        spZoom = spinner(zooms, zsel);

        text("Tracker address (advanced)", 17, TEXT);
        text("Leave blank to use the tracker built into this app. Only fill this in to load your own hosted copy.", 13, MUTED);
        etSite = field("blank = built-in tracker", siteUrl, false);
    }

    private void stepFinish() {
        text("Almost done.", 17, TEXT);
        fileAccessRow();
        StringBuilder sb = new StringBuilder();
        sb.append("RetroAchievements: ").append(raUser.isEmpty() ? "not set" : raUser).append("\n");
        sb.append("RAWG key: ").append(rawgKey.isEmpty() ? "not set" : "set").append("\n");
        sb.append("ScreenScraper: ").append(ssUser.isEmpty() ? "from ES-DE settings, if any" : ssUser).append("\n");
        sb.append("Tracker: ").append(siteUrl.isEmpty() ? "built in" : siteUrl).append("\n");
        sb.append("ROMs: ").append(romsRoot.isEmpty() ? "not chosen" : romsRoot).append("\n");
        sb.append("ES-DE: ").append(esRoot.isEmpty() ? "none" : esRoot).append("\n");
        sb.append("ES-DE media: ").append(useEsdeMedia && new File(esRoot, "downloaded_media").isDirectory() ? "used as it is" : "not used").append("\n");
        sb.append("RetroArch: ").append(raPackage.isEmpty() ? "default" : raPackage).append("\n");
        sb.append("Top screen: ").append(topDisplay < 0 ? "automatic" : "display " + topDisplay);
        text(sb.toString(), 13, MUTED);
        text("Tap Finish to start the tracker.", 14, MUTED);
    }

    // ---------- navigation ----------

    private void collect() {
        if (etUser != null) raUser = etUser.getText().toString().trim();
        if (etKey != null) raKey = etKey.getText().toString().trim();
        if (etRawg != null) rawgKey = etRawg.getText().toString().trim();
        if (etSsUser != null) ssUser = etSsUser.getText().toString().trim();
        if (etSsPass != null) ssPass = etSsPass.getText().toString().trim();
        if (cbEsdeMedia != null) useEsdeMedia = cbEsdeMedia.isChecked();
        if (etSite != null) {
            String s = etSite.getText().toString().trim();
            siteUrl = s.startsWith("http") ? s : Config.DEFAULT_URL;
        }
        if (spRa != null && spRa.getSelectedItem() != null) raPackage = (String) spRa.getSelectedItem();
        for (Map.Entry<String, Spinner> e : emuSpinners.entrySet()) {
            emuChoice.put(e.getKey(), e.getValue().getSelectedItemPosition() == 1 ? "retroarch" : "standalone");
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
        if (step == 0) {
            finish();
            return;
        }
        step--;
        render();
    }

    private void goNext() {
        collect();
        if (step == 2) {
            if (romsRoot.isEmpty()) {
                Toast.makeText(this, "Choose your ROMs folder first.", Toast.LENGTH_LONG).show();
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
        put("rawgKey", rawgKey);
        if (!raUser.equals(origUser) || !raKey.equals(origKey) || !rawgKey.equals(origRawg)) {
            put("credsRev", String.valueOf(System.currentTimeMillis()));
        }

        put("romsRoot", romsRoot);
        put("romsTree", romsTree);
        put("esRoot", esRoot);
        put("raPackage", raPackage.isEmpty() ? "com.retroarch.aarch64" : raPackage);
        put("siteUrl", siteUrl.startsWith("http") ? siteUrl : Config.DEFAULT_URL);
        put("ssUser", ssUser);
        put("ssPass", ssPass);
        Prefs.putInt(this, "useEsdeMedia", useEsdeMedia ? 1 : 0);
        Prefs.putInt(this, "cssWidth", cssWidth);
        DisplayPicker.save(this, topDisplay);

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
        finish();
    }
}
