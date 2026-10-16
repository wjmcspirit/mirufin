package app.mirufin.tv;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
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

    /** A stack trace is far longer than a report needs, and local storage has limits. */
    private static String clip(String reason) {
        String value = reason == null ? "" : reason.trim();
        return value.length() > 600 ? value.substring(0, 600) : value;
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

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
