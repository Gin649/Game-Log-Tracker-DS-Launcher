package com.gin649.gltdslauncher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.Intent;
import android.os.Bundle;

/**
 * What the app icon opens. It does nothing visible: it brings the tracker to the front on the bottom screen and the
 * art screen to the front on the top screen, then closes. Tapping the icon after another app (an email, say) has
 * covered the top screen therefore brings both screens back, instead of only the bottom one.
 */
public class LaunchActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            int bottom = DisplayPicker.bottomDisplayId(this);
            if (bottom >= 0) {
                ActivityOptions options = ActivityOptions.makeBasic();
                options.setLaunchDisplayId(bottom);
                startActivity(i, options.toBundle());
            } else {
                startActivity(i);
            }
        } catch (Exception e) {
            startActivity(i);
        }

        // Already running: put the top screen's art back in front as well. (A first start does this itself.)
        MainActivity.bringArtToFront();
        finish();
    }
}
