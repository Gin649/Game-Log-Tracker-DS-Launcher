package com.gin649.gltdslauncher;

import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;

/**
 * Turns controller input into calls on the tracker page (window.GLTPad, see gamepad.js).
 * Both screens' activities forward their key and stick events here, so the controls work no
 * matter which screen Android thinks has focus.
 */
final class PadRouter {

    private static final int U = 1, D = 2, L = 4, R = 8;
    private static final float STICK_ON = 0.55f, STICK_OFF = 0.35f, RIGHT_DEAD = 0.15f;

    private static MainActivity host;

    // Directions can come from the D-pad keys, a hat axis or the left stick. Each is tracked
    // separately so letting go of one doesn't cancel another that is still held.
    private static int fromKeys, fromHat, fromStick, sentDirs;
    private static float sentRight;
    private static boolean leftTrigger, rightTrigger; // triggers that report as axes instead of keys

    private PadRouter() {
    }

    static void attach(MainActivity a) {
        host = a;
    }

    static void detach(MainActivity a) {
        if (host == a) {
            reset();
            host = null;
        }
    }

    /** Lets go of everything, e.g. when the app is paused mid-press. */
    static void reset() {
        fromKeys = 0;
        fromHat = 0;
        fromStick = 0;
        sentDirs = 0;
        sentRight = 0;
        leftTrigger = false;
        rightTrigger = false;
        MainActivity h = host;
        if (h != null) h.runPad("reset()");
    }

    private static String buttonName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return "a";
            case KeyEvent.KEYCODE_BUTTON_B: return "b";
            case KeyEvent.KEYCODE_BUTTON_X: return "x";
            case KeyEvent.KEYCODE_BUTTON_Y: return "y";
            case KeyEvent.KEYCODE_BUTTON_L1: return "l1";
            case KeyEvent.KEYCODE_BUTTON_R1: return "r1";
            case KeyEvent.KEYCODE_BUTTON_L2: return "l2";
            case KeyEvent.KEYCODE_BUTTON_R2: return "r2";
            case KeyEvent.KEYCODE_BUTTON_SELECT: return "select";
            case KeyEvent.KEYCODE_BUTTON_START: return "start";
            default: return null;
        }
    }

    private static int dirBit(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP: return U;
            case KeyEvent.KEYCODE_DPAD_DOWN: return D;
            case KeyEvent.KEYCODE_DPAD_LEFT: return L;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return R;
            default: return 0;
        }
    }

    private static void sendDirs() {
        MainActivity h = host;
        int now = fromKeys | fromHat | fromStick;
        int changed = now ^ sentDirs;
        sentDirs = now;
        if (h == null || changed == 0) return;
        if ((changed & U) != 0) h.runPad("b('up'," + ((now & U) != 0 ? 1 : 0) + ")");
        if ((changed & D) != 0) h.runPad("b('down'," + ((now & D) != 0 ? 1 : 0) + ")");
        if ((changed & L) != 0) h.runPad("b('left'," + ((now & L) != 0 ? 1 : 0) + ")");
        if ((changed & R) != 0) h.runPad("b('right'," + ((now & R) != 0 ? 1 : 0) + ")");
    }

    /** Returns true if the event was a controller button the tracker handled. */
    static boolean key(KeyEvent e) {
        MainActivity h = host;
        if (h == null || !h.padActive()) return false;
        int code = e.getKeyCode();

        int bit = dirBit(code);
        if (bit != 0) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) fromKeys |= bit;
            else if (e.getAction() == KeyEvent.ACTION_UP) fromKeys &= ~bit;
            sendDirs();
            return true;
        }

        String name = buttonName(code);
        if (name == null) return false;
        if (e.getAction() == KeyEvent.ACTION_DOWN) {
            if (e.getRepeatCount() == 0) h.runPad("b('" + name + "',1)");
        } else if (e.getAction() == KeyEvent.ACTION_UP) {
            h.runPad("b('" + name + "',0)");
        }
        return true;
    }

    /** Sticks and hat switches. Returns true if the event was handled. */
    static boolean motion(MotionEvent e) {
        MainActivity h = host;
        if (h == null || !h.padActive()) return false;
        if (!e.isFromSource(InputDevice.SOURCE_JOYSTICK) || e.getAction() != MotionEvent.ACTION_MOVE) {
            return false;
        }

        // D-pad reported as a hat axis
        float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X);
        float hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
        int hat = 0;
        if (hx < -0.5f) hat |= L;
        if (hx > 0.5f) hat |= R;
        if (hy < -0.5f) hat |= U;
        if (hy > 0.5f) hat |= D;
        fromHat = hat;

        // Left stick as four directions, with a little hysteresis so it doesn't flutter
        float x = e.getAxisValue(MotionEvent.AXIS_X);
        float y = e.getAxisValue(MotionEvent.AXIS_Y);
        float ax = Math.abs(x), ay = Math.abs(y);
        float threshold = fromStick == 0 ? STICK_ON : STICK_OFF;
        int stick = 0;
        if (Math.max(ax, ay) >= threshold) {
            if (ax > ay) stick = x < 0 ? L : R;
            else stick = y < 0 ? U : D;
        }
        fromStick = stick;
        sendDirs();

        // Right stick, vertical. Controllers report it as RZ or RY, so use whichever is moved.
        float rz = e.getAxisValue(MotionEvent.AXIS_RZ);
        float ry = e.getAxisValue(MotionEvent.AXIS_RY);
        float v = Math.abs(rz) > Math.abs(ry) ? rz : ry;
        float mag = Math.abs(v);
        v = mag < RIGHT_DEAD ? 0f : Math.signum(v) * (mag - RIGHT_DEAD) / (1f - RIGHT_DEAD);
        if (Math.abs(v - sentRight) > 0.03f || (v == 0f && sentRight != 0f)) {
            sentRight = v;
            h.runPad("rs(" + v + ")");
        }

        // Triggers on controllers that report them as axes rather than as L2/R2 keys
        float lt = Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE));
        float rt = Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS));
        boolean l2 = lt > (leftTrigger ? 0.3f : 0.6f);
        boolean r2 = rt > (rightTrigger ? 0.3f : 0.6f);
        if (l2 != leftTrigger) {
            leftTrigger = l2;
            h.runPad("b('l2'," + (l2 ? 1 : 0) + ")");
        }
        if (r2 != rightTrigger) {
            rightTrigger = r2;
            h.runPad("b('r2'," + (r2 ? 1 : 0) + ")");
        }
        return true;
    }
}
