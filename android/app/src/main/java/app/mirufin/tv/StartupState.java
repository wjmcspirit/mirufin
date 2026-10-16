package app.mirufin.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebStorage;

import java.io.File;

/**
 * Mirufin keeps its session in WebView local storage, so a WebView store left damaged by
 * an abrupt kill (Android terminates the app to install an in-place update, or the
 * renderer dies) can crash every launch with nothing on screen but the splash.
 *
 * Each launch marks itself pending and the web app clears the mark once it has rendered.
 * If the mark is still set on the next launch, the previous run died before Mirufin was
 * up, so the WebView store is cleared before any WebView is created in this process.
 */
final class StartupState {
    private static final String FILE = "mirufin.startup";
    private static final String PENDING = "pending";
    private static final String RECOVERED = "recovered";

    private StartupState() {
    }

    static void markPending(Context context) {
        prefs(context).edit().putBoolean(PENDING, true).commit();
    }

    /** True when the previous launch died before the web app was up and was healed. */
    static boolean healIfPending(Context context) {
        SharedPreferences prefs = prefs(context);
        if (!prefs.getBoolean(PENDING, false)) return false;
        wipeWebViewStore(context);
        prefs.edit().putBoolean(RECOVERED, true).apply();
        return true;
    }

    /** The web app is up: the next launch is a normal start, not a crash recovery. */
    static boolean markReady(Context context) {
        SharedPreferences prefs = prefs(context);
        boolean recovered = prefs.getBoolean(RECOVERED, false);
        prefs.edit().putBoolean(PENDING, false).putBoolean(RECOVERED, false).apply();
        return recovered;
    }

    /**
     * Deletes the WebView's own data directory: local storage, IndexedDB and the HTTP
     * cache. Only safe before a WebView exists in this process, which is why it runs
     * from onCreate() ahead of super.onCreate(). The saved server and sign-in live in
     * that store, so the viewer signs in again after a recovery.
     */
    static void wipeWebViewStore(Context context) {
        try {
            WebStorage.getInstance().deleteAllData();
        } catch (Exception ignored) {
            // The directory delete below is the recovery that matters.
        }
        try {
            File data = context.getDataDir();
            if (data != null) deleteTree(new File(data, "app_webview"));
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

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
