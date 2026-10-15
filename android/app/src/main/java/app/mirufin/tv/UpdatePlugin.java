package app.mirufin.tv;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "Updater")
public class UpdatePlugin extends Plugin {
    private static final String RELEASE_PREFIX = "https://github.com/wjmcspirit/mirufin/releases/download/";

    /**
     * The staged APK lives in the app's files directory, never the cache: Android may
     * clear the cache while the TV installer is still reading the file, and a failed
     * install leaves the viewer without a working Mirufin.
     */
    static final String STAGED_APK = "mirufin-update.apk";

    static File stagedApk(Context context) {
        return new File(context.getFilesDir(), STAGED_APK);
    }

    /** A truncated or HTML error page handed to the installer fails and can strand the app. */
    private static boolean looksLikeApk(File file) {
        try (InputStream head = new FileInputStream(file)) {
            byte[] magic = new byte[4];
            if (head.read(magic) != magic.length) return false;
            return magic[0] == 0x50 && magic[1] == 0x4B && magic[2] == 0x03 && magic[3] == 0x04;
        } catch (Exception error) {
            return false;
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith(RELEASE_PREFIX) || !url.endsWith("/mirufin.apk")) {
            call.reject("That update address is not a Mirufin release.");
            return;
        }
        if (getContext() == null) {
            call.reject("Mirufin cannot install an update right now.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.reject("Allow Mirufin to install updates, then choose Install update again.");
            return;
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(120000);
            connection.setRequestProperty("User-Agent", "Mirufin");
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                call.reject("The update could not be downloaded.");
                return;
            }
            File file = stagedApk(getContext());
            // A half-written copy from an earlier attempt would be installed as-is.
            if (file.exists() && !file.delete()) {
                call.reject("Mirufin could not clear the previous update download.");
                return;
            }
            long length = connection.getContentLengthLong();
            long received = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                byte[] buffer = new byte[16384];
                int reported = -1;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    received += count;
                    if (length > 0) {
                        int percent = (int) (received * 100 / length);
                        if (percent != reported) {
                            reported = percent;
                            JSObject event = new JSObject();
                            event.put("percent", percent);
                            notifyListeners("progress", event);
                        }
                    }
                }
            }
            if (length > 0 && received != length) {
                file.delete();
                call.reject("The update download was incomplete. Choose Install update again.");
                return;
            }
            if (!looksLikeApk(file)) {
                file.delete();
                call.reject("The downloaded update is not a valid APK. Choose Install update again.");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "The update could not be installed." : error.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
