package com.gin649.gltdslauncher;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * A small text-entry screen that opens on the bottom screen, so the on-screen keyboard always
 * appears there (the setup wizard itself lives on the top screen, where there is no keyboard).
 * The text goes back to the setup field through {@link #pending}.
 */
public class TextEntryActivity extends Activity {

    interface Result {
        void onText(String text);
    }

    static final String EXTRA_LABEL = "label";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_INPUT_TYPE = "inputType";

    /** Who gets the text when Done is pressed. Cleared when this screen closes. */
    static Result pending;

    private static final int BG = Color.rgb(21, 18, 31);
    private static final int GOLD = Color.rgb(228, 169, 63);
    private static final int TEXT = Color.rgb(236, 232, 245);
    private static final int MUTED = Color.rgb(150, 144, 168);

    private EditText input;
    private boolean delivered;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);

        String label = getIntent().getStringExtra(EXTRA_LABEL);
        String text = getIntent().getStringExtra(EXTRA_TEXT);
        int type = getIntent().getIntExtra(EXTRA_INPUT_TYPE,
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        int pad = dp(14);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText(label == null ? "" : label);
        title.setTextColor(GOLD);
        title.setTextSize(18);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        input = new EditText(this);
        input.setHint(label);
        input.setHintTextColor(MUTED);
        input.setTextColor(TEXT);
        input.setTextSize(17);
        input.setSingleLine(true);
        input.setInputType(type);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setText(text == null ? "" : text);
        input.setSelection(input.getText().length());
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO
                        || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                        && event.getAction() == KeyEvent.ACTION_DOWN)) {
                    done();
                    return true;
                }
                return false;
            }
        });
        root.addView(input);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.END);
        row.setPadding(0, dp(8), 0, 0);

        Button cancel = new Button(this);
        cancel.setText("Cancel");
        cancel.setAllCaps(false);
        cancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        row.addView(cancel);

        Button ok = new Button(this);
        ok.setText("Done");
        ok.setAllCaps(false);
        ok.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                done();
            }
        });
        row.addView(ok);
        root.addView(row);

        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        input.requestFocus();
        input.postDelayed(new Runnable() {
            @Override
            public void run() {
                InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
            }
        }, 150);
    }

    private void done() {
        if (delivered) return;
        delivered = true;
        Result r = pending;
        if (r != null) r.onText(input.getText().toString());
        finish();
    }

    @Override
    protected void onDestroy() {
        pending = null;
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
