package app.mirufin.tv;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web app report that it rendered, so a launch that dies early can be spotted. */
@CapacitorPlugin(name = "Startup")
public class StartupPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        JSObject result = new JSObject();
        result.put("recovered", StartupState.markReady(getContext()));
        call.resolve(result);
    }
}
