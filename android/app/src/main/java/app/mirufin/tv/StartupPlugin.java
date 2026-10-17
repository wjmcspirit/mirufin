package app.mirufin.tv;

import android.app.Activity;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web app report that it painted, and read what a failed launch left behind. */
@CapacitorPlugin(name = "Startup")
public class StartupPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("recovered", StartupState.markReady(context));
        result.put("failures", StartupState.failures(context));
        result.put("reason", StartupState.lastProblem(context));
        call.resolve(result);
        // The app is up, so take down the problem screen this launch may have started with,
        // and put the opaque shell background back over the splash it was showing.
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            MainActivity main = (MainActivity) activity;
            main.dismissStartupProblem();
            main.settleSplashBackground();
        }
    }

    /** A failure raised by the web layer, kept so the next launch can report it. */
    @PluginMethod
    public void report(PluginCall call) {
        StartupState.noteProblem(getContext(), call.getString("reason", ""));
        call.resolve();
    }

    /**
     * Keeps a copy of the saved server and sign-in outside the WebView's own store, which is
     * cleared when a launch has to be repaired and can stop keeping anything at all.
     */
    @PluginMethod
    public void saveSession(PluginCall call) {
        SessionStore.save(
            getContext(),
            call.getString("server", ""),
            call.getString("serverName", ""),
            call.getString("serverVersion", ""),
            call.getString("token", ""),
            call.getString("userId", ""),
            call.getString("userName", ""),
            call.getString("device", "")
        );
        call.resolve();
    }

    /** The viewer signed out, or the server rejected the sign-in: drop the copy as well. */
    @PluginMethod
    public void clearSession(PluginCall call) {
        SessionStore.clear(getContext());
        call.resolve();
    }

    /** What the shell kept, for a web app that started with no session of its own. */
    @PluginMethod
    public void savedSession(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("server", SessionStore.server(context));
        result.put("serverName", SessionStore.serverName(context));
        result.put("serverVersion", SessionStore.serverVersion(context));
        result.put("token", SessionStore.token(context));
        result.put("userId", SessionStore.userId(context));
        result.put("userName", SessionStore.userName(context));
        result.put("device", SessionStore.device(context));
        call.resolve(result);
    }

    /** What the device and the last launch look like, for the settings screen. */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("reason", StartupState.lastProblem(context));
        result.put("failures", StartupState.failures(context));
        result.put("webView", StartupState.webView(context));
        result.put("exit", StartupState.lastExit(context));
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        StartupState.clearProblem(getContext());
        call.resolve();
    }
}
