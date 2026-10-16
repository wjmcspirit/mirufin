package app.mirufin.tv;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.WebViewListener;

import java.io.PrintWriter;
import java.io.StringWriter;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // A launch that dies before the web app reports in usually means the WebView's own
        // store was damaged by an abrupt kill, so clear it before any WebView exists here.
        StartupState.healIfPending(this);
        StartupState.markPending(this);
        installCrashLogger();
        registerPlugin(DiscoveryPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        registerPlugin(StartupPlugin.class);
        super.onCreate(savedInstanceState);
        Bridge bridge = getBridge();
        if (bridge != null) bridge.addWebViewListener(new RecoveryListener());
        fillScreen();
        prepareWebView();
        suppressVideoPoster();
    }

    @Override
    public void onResume() {
        super.onResume();
        fillScreen();
        prepareWebView();
        suppressVideoPoster();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) fillScreen();
    }

    private void fillScreen() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void prepareWebView() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        ViewGroup.LayoutParams params = webView.getLayoutParams();
        if (params != null) {
            params.width = ViewGroup.LayoutParams.MATCH_PARENT;
            params.height = ViewGroup.LayoutParams.MATCH_PARENT;
            webView.setLayoutParams(params);
        }
        webView.setBackgroundColor(Color.BLACK);
        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        getBridge().getWebView().setFocusable(true);
        getBridge().getWebView().setFocusableInTouchMode(true);
        getBridge().getWebView().requestFocus();
    }

    /**
     * Android WebView paints its own giant "default video poster" (a round play
     * button) over any <video> until frames arrive. Mirufin's player video
     * fills the screen, so that native poster flashes across the whole display
     * while playback spins up. A transparent poster removes it; the native
     * player surface covers the web layer during startup anyway.
     */
    private void suppressVideoPoster() {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
    }

    /**
     * Android kills the process on an uncaught exception, which leaves nothing behind to
     * explain a launch that never came up. Record the reason before the process goes, so
     * the next launch can report it and clear a store the crash may have damaged.
     */
    private void installCrashLogger() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StartupState.noteDeath(getApplicationContext(), summary(error));
            } catch (Exception ignored) {
                // Reporting must never mask the crash itself.
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    private static String summary(Throwable error) {
        StringWriter text = new StringWriter();
        error.printStackTrace(new PrintWriter(text));
        return text.toString().trim();
    }

    /**
     * The WebView renderer runs in its own process: when it dies (a damaged store, or the
     * system reclaiming memory) Android takes Mirufin down with it unless the event is
     * handled. Restart into a clean task instead.
     *
     * The store is deliberately not cleared here. A wipe only happens from onCreate()
     * ahead of a WebView, which the next launch does, because removing the data directory
     * of a live WebView provider leaves a store that crashes every launch afterwards.
     */
    private class RecoveryListener extends WebViewListener {
        @Override
        public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
            boolean crashed = detail == null || detail.didCrash();
            StartupState.noteDeath(
                MainActivity.this,
                crashed ? "The web view renderer crashed." : "Android reclaimed the web view renderer."
            );
            // A renderer that dies again immediately after every restart would restart
            // Mirufin forever, so past the budget the app is left closed instead and the
            // next launch heals it.
            if (StartupState.allowRestart()) {
                Intent restart = new Intent(getApplicationContext(), MainActivity.class);
                restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(restart);
            }
            finish();
            return true;
        }
    }
}
