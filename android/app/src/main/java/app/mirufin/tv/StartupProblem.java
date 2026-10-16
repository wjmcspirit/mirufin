package app.mirufin.tv;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

/**
 * The screen Mirufin shows when a launch does not come up.
 *
 * Everything on it is read from the device: Android's own record of why the last run ended
 * (an uncaught error, a native crash, an out-of-memory kill or an app that stopped
 * responding, with the trace Android kept), the reason the last launch recorded, the
 * installed Web view, and the device itself. A blank screen cannot say any of that, and
 * without it the only way to find out is a cable and a log.
 */
final class StartupProblem {
    private StartupProblem() {
    }

    /** Adds the screen to the activity's content view, or does nothing without one. */
    static void show(Activity activity) {
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root == null) return;
        View problem = activity.getLayoutInflater().inflate(R.layout.startup_problem, root, false);
        ((TextView) problem.findViewById(R.id.problem_detail)).setText(details(activity));
        ((TextView) problem.findViewById(R.id.problem_device)).setText(device(activity));
        ((TextView) problem.findViewById(R.id.problem_log)).setText(StartupState.logTail(activity, 10));
        problem.findViewById(R.id.problem_restart).setOnClickListener(view -> restart(activity, false));
        problem.findViewById(R.id.problem_clear).setOnClickListener(view -> restart(activity, true));
        root.addView(problem);
        problem.findViewById(R.id.problem_restart).requestFocus();
    }

    /** True when the screen is on display. */
    static boolean shown(Activity activity) {
        ViewGroup root = activity.findViewById(android.R.id.content);
        return root != null && root.findViewById(R.id.problem_root) != null;
    }

    static void dismiss(Activity activity) {
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root == null) return;
        View problem = root.findViewById(R.id.problem_root);
        if (problem != null) root.removeView(problem);
    }

    private static void restart(Activity activity, boolean clearEverything) {
        if (clearEverything) StartupState.requestReset(activity);
        Intent intent = new Intent(activity.getApplicationContext(), MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        activity.startActivity(intent);
        activity.finish();
    }

    /** How the last run ended, and what the last launch managed to record. */
    private static String details(Activity activity) {
        String exit = StartupState.lastExit(activity);
        String reason = StartupState.lastProblem(activity);
        StringBuilder text = new StringBuilder();
        text.append(exit.isEmpty() ? "Android has no record of why the last run ended." : exit);
        text.append("\n\n").append(reason.isEmpty() ? "The last launch did not finish." : reason);
        return text.toString();
    }

    private static String device(Activity activity) {
        String webView = StartupState.webView(activity);
        StringBuilder text = new StringBuilder();
        text.append("Mirufin ").append(versionName(activity));
        text.append("\nAndroid ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(")");
        text.append("\n").append(Build.MANUFACTURER).append(' ').append(Build.MODEL);
        text.append("\nWeb view: ").append(webView.isEmpty() ? "unknown" : webView);
        text.append("\nLow RAM device: ").append(lowRam(activity) ? "yes" : "no");
        return text.toString();
    }

    private static String versionName(Activity activity) {
        try {
            String name = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
            return name == null ? "unknown" : name;
        } catch (Exception error) {
            return "unknown";
        }
    }

    private static boolean lowRam(Activity activity) {
        try {
            ActivityManager manager = (ActivityManager) activity.getSystemService(Activity.ACTIVITY_SERVICE);
            return manager != null && manager.isLowRamDevice();
        } catch (Exception error) {
            return false;
        }
    }
}
