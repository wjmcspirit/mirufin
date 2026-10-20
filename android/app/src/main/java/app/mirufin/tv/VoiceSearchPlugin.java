package app.mirufin.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * Voice search: the television's own voice input, opened from the web app's search screen.
 *
 * Android's WebView has no speech recognition of its own - a browser's `SpeechRecognition` is not
 * there and never was on Android TV - so the search screen asks the device instead. This plugin
 * opens the recognizer the television already has (`ACTION_RECOGNIZE_SPEECH`, the same one the
 * Google TV remote's microphone uses) with `startActivityForResult`, and hands the words it heard
 * back to the page.
 *
 * Nothing here records anything: the recognizer activity owns the microphone for as long as it is
 * on screen, so Mirufin asks for no `RECORD_AUDIO` permission and can listen no longer than the
 * viewer keeps that screen open. A television with no recognizer installed says so rather than
 * failing on a press, and the search field keeps working as it always did.
 */
@CapacitorPlugin(name = "VoiceSearch")
public class VoiceSearchPlugin extends Plugin {

    /** The recognizer this device would open, or null when it has none. */
    private Intent recognizer() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        PackageManager manager = getContext().getPackageManager();
        // Android 11 and later only see the packages this app declares, which is why the manifest
        // lists this action: without it a television with a recognizer would look like one without.
        return intent.resolveActivity(manager) == null ? null : intent;
    }

    /** Whether this install can listen at all, so the page can say so before the viewer presses. */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", recognizer() != null);
        call.resolve(result);
    }

    /**
     * Opens the device's voice input once, and answers with what it heard.
     *
     * One press asks once: a second `listen` while the recognizer is still on screen is refused
     * rather than stacking a second session behind the first. A viewer who backs out of the
     * recognizer cancels this call - that is not an error, and the page says nothing about it.
     */
    @PluginMethod
    public void listen(PluginCall call) {
        Intent intent = recognizer();
        if (intent == null) {
            call.reject("This television has no voice input for Mirufin to open.", "unavailable");
            return;
        }
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        String prompt = call.getString("prompt", "");
        if (prompt != null && !prompt.isEmpty()) intent.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        try {
            startActivityForResult(call, intent, "heard");
        } catch (ActivityNotFoundException missing) {
            // The recognizer the manager resolved is gone between the check and the launch.
            call.reject("This television has no voice input for Mirufin to open.", "unavailable");
        }
    }

    /** The recognizer came back: the first thing it heard, or why there is nothing. */
    @ActivityCallback
    private void heard(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Voice search was closed without anything said.", "cancelled");
            return;
        }
        Intent data = result.getData();
        ArrayList<String> words = data == null
            ? null
            : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String heard = words == null || words.isEmpty() ? "" : words.get(0);
        if (heard == null) heard = "";
        JSObject answer = new JSObject();
        answer.put("text", heard.trim());
        call.resolve(answer);
    }
}
