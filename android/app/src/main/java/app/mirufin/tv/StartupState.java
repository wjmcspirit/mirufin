package app.mirufin.tv;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Mirufin keeps its session in WebView local storage, so a WebView store damaged by an
 * abrupt kill (Android terminates the app to install an in-place update, or the renderer
 * dies) can crash every launch with nothing on screen but the splash.
 *
 * Each launch marks itself pending and the web app clears the mark once it has painted.
 * If the mark is still set on the next launch, the previous run died before Mirufin was
 * up, so the store is cleared here, from onCreate() ahead of any WebView in this process.
 *
 * The store is never touched while a WebView is alive: deleting the WebView's data
 * directory out from under its own provider leaves behind a store that crashes every
 * following launch, which is worse than the damage being repaired. Every repair is
 * therefore deferred to the next launch, and a launch that has already failed to come up
 * more than once resets everything the app owns instead of the store alone.
 */
final class StartupState {
    private static final String FILE = "mirufin.startup";
    private static final String PENDING = "pending";
    private static final String RECOVERED = "recovered";
    private static final String FAILURES = "failures";
    private static final String REASON = "reason";
    private static final String WEBVIEW = "webview";
    private static final String LOG = "startup.log";
    /** Early deaths in a row that mean clearing the store is not the whole answer. */
    private static final int RESET_EVERYTHING_AFTER = 3;
    /** Restarts allowed inside the window below before a launch is left closed. */
    private static final int MAX_RESTARTS = 2;
    private static final long RESTART_WINDOW_MS = 60_000L;

    private static int restarts = 0;
    private static long restartsStartedAt = 0L;

    private StartupState() {
    }

    static void markPending(Context context) {
        prefs(context).edit().putBoolean(PENDING, true).commit();
    }

    static boolean isPending(Context context) {
        return prefs(context).getBoolean(PENDING, false);
    }

    static int failures(Context context) {
        return prefs(context).getInt(FAILURES, 0);
    }

    /** What the last failed launch left behind, so a report can include the reason. */
    static String lastProblem(Context context) {
        return prefs(context).getString(REASON, "");
    }

    static void clearProblem(Context context) {
        prefs(context).edit().remove(REASON).commit();
    }

    /**
     * Which WebView is actually installed. A TV with a missing, disabled or very old
     * Android System WebView is the usual reason a launch shows nothing at all, and the
     * version is the first thing a report needs.
     */
    static void setWebView(Context context, String webView) {
        prefs(context).edit().putString(WEBVIEW, webView).commit();
    }

    static String webView(Context context) {
        return prefs(context).getString(WEBVIEW, "");
    }

    /**
     * Records a failure raised while Mirufin was already up (a screen that threw, a
     * renderer Android reclaimed after a normal start). The reason is kept for the next
     * launch to report, but the launch is not counted as an early death: an app that was
     * up does not have a store that needs clearing.
     */
    static void noteProblem(Context context, String reason) {
        if (reason == null || reason.isEmpty()) return;
        prefs(context).edit().putString(REASON, clip(reason)).commit();
    }

    /** Records any death, counting it only when the launch never reached the web app. */
    static void noteDeath(Context context, String reason) {
        if (!isPending(context)) {
            noteProblem(context, reason);
            return;
        }
        SharedPreferences prefs = prefs(context);
        prefs.edit()
            .putBoolean(PENDING, true)
            .putInt(FAILURES, prefs.getInt(FAILURES, 0) + 1)
            .putString(REASON, clip(reason))
            .commit();
        log(context, "launch died before the app was up: " + clip(reason));
    }

    /**
     * True when the previous launch died before the web app was up and was healed. Runs
     * before any WebView exists in this process, which is the only safe time to clear the
     * store. A launch that keeps dying is reset to a state equal to a fresh install.
     */
    static boolean healIfPending(Context context) {
        SharedPreferences prefs = prefs(context);
        if (!prefs.getBoolean(PENDING, false)) return false;
        int failures = prefs.getInt(FAILURES, 0) + 1;
        boolean everything = failures >= RESET_EVERYTHING_AFTER;
        wipe(context, everything);
        log(context, everything ? "reset all app data after " + failures + " failed launches" : "cleared the WebView store after a failed launch");
        String cause = prefs.getString(REASON, "");
        String healed = everything
            ? "Mirufin reset all of its app data after " + failures + " failed launches."
            : "Mirufin cleared the WebView store after " + failures + " failed launch" + (failures == 1 ? "" : "es") + ".";
        prefs.edit()
            .putBoolean(RECOVERED, true)
            // The mark is cleared here: the caller marks the launch it is about to make, and
            // a launch that never happens must not be mistaken for one that failed.
            .putBoolean(PENDING, false)
            .putString(REASON, clip(cause.isEmpty() ? healed : cause + " " + healed))
            // A full reset starts the count over, so the next failure is a new problem.
            .putInt(FAILURES, everything ? 0 : failures)
            .commit();
        return true;
    }

    /** The web app painted: the next launch is a normal start, not a crash recovery. */
    static boolean markReady(Context context) {
        SharedPreferences prefs = prefs(context);
        boolean recovered = prefs.getBoolean(RECOVERED, false);
        restarts = 0;
        prefs.edit()
            .putBoolean(PENDING, false)
            .putBoolean(RECOVERED, false)
            .putInt(FAILURES, 0)
            .commit();
        return recovered;
    }

    /**
     * Bounds how often one launch may restart itself. A renderer that dies immediately
     * after every restart would otherwise restart Mirufin forever.
     */
    static boolean allowRestart() {
        long now = System.currentTimeMillis();
        if (restarts == 0 || now - restartsStartedAt > RESTART_WINDOW_MS) {
            restarts = 0;
            restartsStartedAt = now;
        }
        restarts += 1;
        return restarts <= MAX_RESTARTS;
    }

    /**
     * Asks the next launch to clear everything Mirufin owns. The clear itself runs there,
     * before any WebView exists: clearing the store from here, with the WebView provider
     * still running, is what damages it in the first place.
     */
    static void requestReset(Context context) {
        prefs(context).edit().putBoolean(PENDING, true).putInt(FAILURES, RESET_EVERYTHING_AFTER).commit();
    }

    /**
     * Deletes the WebView's own data: local storage, cookies, IndexedDB and the HTTP
     * cache. Only ever called from onCreate() before a WebView exists in this process,
     * because the WebView provider must not be running while its directory is removed.
     * The saved server and sign-in live in that store, so the viewer signs in again after
     * a recovery.
     *
     * A launch that has already failed to come up more than once means the WebView data is
     * not the whole problem, so everything else Mirufin owns goes too, leaving a state
     * equal to a fresh install.
     */
    private static void wipe(Context context, boolean everything) {
        try {
            File data = context.getDataDir();
            if (data == null) return;
            File[] entries = data.listFiles();
            if (entries == null) return;
            for (File entry : entries) {
                String name = entry.getName();
                // A secondary WebView profile (setDataDirectorySuffix) keeps its own store.
                if (name.startsWith("app_webview") || name.equals("databases") || name.equals("cache")) deleteTree(entry);
            }
            if (!everything) return;
            deleteTree(new File(data, "files"));
            File[] stored = new File(data, "shared_prefs").listFiles();
            if (stored != null) {
                for (File entry : stored) {
                    // This file holds the recovery count itself, so it has to survive.
                    if (!entry.getName().startsWith(FILE)) deleteTree(entry);
                }
            }
        } catch (Exception ignored) {
            // A failed cleanup only means the next launch tries again.
        }
    }

    private static void deleteTree(File target) {
        try {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) deleteTree(child);
            }
            target.delete();
        } catch (Exception ignored) {
            // Best effort: skip whatever the system keeps locked.
        }
    }

    /**
     * Why Android last ended this app, as Android itself recorded it: a crash, a native
     * crash, an out-of-memory kill or an ANR. This is the one thing a blank screen cannot
     * say, and it needs no cable: the answer is on the device.
     */
    static String lastExit(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "";
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return "";
            List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 5);
            if (exits == null || exits.isEmpty()) return "";
            ApplicationExitInfo exit = exits.get(0);
            StringBuilder text = new StringBuilder(exitReason(exit.getReason()));
            String description = exit.getDescription();
            if (description != null && !description.isEmpty()) text.append(" — ").append(description);
            String trace = exitTrace(exit);
            if (!trace.isEmpty()) text.append('\n').append(trace);
            return clip(text.toString());
        } catch (Exception error) {
            return "";
        }
    }

    private static String exitReason(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
                return "Android ended the last run: an uncaught error";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "Android ended the last run: a native crash";
            case ApplicationExitInfo.REASON_ANR:
                return "Android ended the last run: it stopped responding";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "Android ended the last run: it ran out of memory";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return "Android ended the last run: it used too much memory";
            case ApplicationExitInfo.REASON_EXIT_SELF:
                return "Mirufin closed the last run itself";
            case ApplicationExitInfo.REASON_USER_REQUESTED:
                return "The last run was closed by hand";
            default:
                return "Android ended the last run (reason " + reason + ")";
        }
    }

    /**
     * The head of the crash trace Android kept: a native tombstone names the process that
     * died, which is how a WebView renderer crash is told apart from a crash in the app.
     */
    private static String exitTrace(ApplicationExitInfo exit) {
        try (InputStream stream = exit.getTraceInputStream()) {
            if (stream == null) return "";
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder kept = new StringBuilder();
            int lines = 0;
            String line;
            while ((line = reader.readLine()) != null && lines < 14) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                kept.append(clip(trimmed, 160)).append('\n');
                lines += 1;
            }
            return kept.toString().trim();
        } catch (Exception error) {
            return "";
        }
    }

    private static String clip(String reason) {
        return clip(reason, 600);
    }

    private static String clip(String reason, int limit) {
        String value = reason == null ? "" : reason.trim();
        return value.length() > limit ? value.substring(0, limit) : value;
    }

    /** Keeps a short record of startup failures so a report can include one. */
    static void log(Context context, String message) {
        try (FileWriter writer = new FileWriter(new File(context.getFilesDir(), LOG), true)) {
            String stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date());
            writer.write(stamp + "  " + message + "\n");
        } catch (Exception ignored) {
            // Diagnostics are best effort and must never affect a launch.
        }
    }

    /** The newest lines of the startup log, for the problem screen and a report. */
    static String logTail(Context context, int lines) {
        List<String> kept = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(new File(context.getFilesDir(), LOG)))) {
            String line;
            while ((line = reader.readLine()) != null) {
                kept.add(line);
                if (kept.size() > lines) kept.remove(0);
            }
        } catch (Exception ignored) {
            return "";
        }
        StringBuilder text = new StringBuilder();
        for (String line : kept) text.append(line).append('\n');
        return text.toString().trim();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
