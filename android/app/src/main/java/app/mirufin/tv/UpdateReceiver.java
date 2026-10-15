package app.mirufin.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Android terminates Mirufin to apply an in-place update, so the viewer is dropped
 * on the TV home screen and has to find the app again. This brings Mirufin straight
 * back after the update is installed, using a clean task so no half-dead task from
 * before the update is resumed.
 *
 * The start is best effort: Android may refuse a background activity start, in which
 * case opening Mirufin from the TV home screen still works exactly as before.
 */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        // The installer has finished reading the staged APK by now.
        try {
            UpdatePlugin.stagedApk(context).delete();
        } catch (Exception ignored) {
            // Nothing to clean up.
        }
        Intent launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try {
            context.startActivity(launch);
        } catch (Exception ignored) {
            // Background activity starts can be refused; the TV home screen still works.
        }
    }
}
