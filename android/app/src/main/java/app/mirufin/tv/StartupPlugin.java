package app.mirufin.tv;

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
    }

    /** A failure raised by the web layer, kept so the next launch can report it. */
    @PluginMethod
    public void report(PluginCall call) {
        StartupState.noteProblem(getContext(), call.getString("reason", ""));
        call.resolve();
    }

    /** What the device and the last launch look like, for the settings screen. */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("reason", StartupState.lastProblem(context));
        result.put("failures", StartupState.failures(context));
        result.put("webView", StartupState.webView(context));
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        StartupState.clearProblem(getContext());
        call.resolve();
    }
}
