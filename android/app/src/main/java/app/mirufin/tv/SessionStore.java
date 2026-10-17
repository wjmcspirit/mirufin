package app.mirufin.tv;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The saved server and sign-in, kept beside the WebView's own store rather than only inside it.
 *
 * The session lives in the WebView's local storage, and that store is not permanent. Mirufin
 * clears it to repair a launch that died before the app came up, and a store damaged by an
 * abrupt kill can stop keeping anything at all. Either way the viewer was asked to sign in
 * again on the next launch, which is what this copy is for: the shell hands it back to a web
 * app that starts without a session of its own.
 *
 * A full reset (StartupState.wipe with everything) deletes these preferences on purpose, so
 * that path still leaves the app equal to a fresh install.
 */
final class SessionStore {
    private static final String FILE = "mirufin.session";
    private static final String SERVER = "server";
    private static final String SERVER_NAME = "serverName";
    private static final String SERVER_VERSION = "serverVersion";
    private static final String TOKEN = "token";
    private static final String USER_ID = "userId";
    private static final String USER_NAME = "userName";
    private static final String DEVICE = "device";

    private SessionStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static void save(
        Context context,
        String server,
        String serverName,
        String serverVersion,
        String token,
        String userId,
        String userName,
        String device
    ) {
        prefs(context).edit()
            .putString(SERVER, text(server))
            .putString(SERVER_NAME, text(serverName))
            .putString(SERVER_VERSION, text(serverVersion))
            .putString(TOKEN, text(token))
            .putString(USER_ID, text(userId))
            .putString(USER_NAME, text(userName))
            .putString(DEVICE, text(device))
            .commit();
    }

    static void clear(Context context) {
        prefs(context).edit().clear().commit();
    }

    static String server(Context context) {
        return prefs(context).getString(SERVER, "");
    }

    static String serverName(Context context) {
        return prefs(context).getString(SERVER_NAME, "");
    }

    static String serverVersion(Context context) {
        return prefs(context).getString(SERVER_VERSION, "");
    }

    static String token(Context context) {
        return prefs(context).getString(TOKEN, "");
    }

    static String userId(Context context) {
        return prefs(context).getString(USER_ID, "");
    }

    static String userName(Context context) {
        return prefs(context).getString(USER_NAME, "");
    }

    static String device(Context context) {
        return prefs(context).getString(DEVICE, "");
    }

    private static String text(String value) {
        return value == null ? "" : value;
    }
}
