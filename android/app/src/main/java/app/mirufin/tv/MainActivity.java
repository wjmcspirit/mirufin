package app.mirufin.tv;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
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
    /** How long a launch may take to reach the web app before it is treated as failed. */
    private static final long STARTUP_WATCHDOG_MS = 20_000L;

    private final Handler watchdog = new Handler(Looper.getMainLooper());
    private boolean problemResolved = false;
    /** True once the poster-suppressing chrome client is on the WebView. */
    private boolean videoPosterSuppressed = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The launcher heals before it hands over, and reports a launch that died early
        // without creating a WebView. This is repeated for the launches that start Mirufin
        // directly, such as the restart after an in-app update.
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
        rememberWebView();
        watchForFailedStartup();
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
        // Until the web app has painted, the WebView is left transparent so the splash the
        // window draws behind it (@drawable/splash) stays visible. An opaque WebView covers
        // that splash the moment it is laid out - which blanks the logo for as long as the
        // page takes to load, then pops it back at whatever size the page uses. Both splashes
        // draw the same logo at the same size, so with the WebView transparent the handover
        // has nothing to jump, flash or blank. settleSplashBackground() restores the opaque
        // shell once the app is up.
        webView.setBackgroundColor(StartupState.isPending(this) ? Color.TRANSPARENT : Color.BLACK);
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
     * The web app has painted, so the splash behind the WebView can go: the shell is opaque
     * from here on, exactly as it was before the splash was left showing through it.
     */
    void settleSplashBackground() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.BLACK);
    }

    /**
     * Android WebView paints its own giant "default video poster" (a round play
     * button) over any <video> until frames arrive. Mirufin's player video
     * fills the screen, so that native poster flashes across the whole display
     * while playback spins up. A transparent poster removes it; the native
     * player surface covers the web layer during startup anyway.
     *
     * The client is installed once and then left alone. Building one registers
     * activity-result launchers with the activity, and Android only accepts that
     * before the activity reaches STARTED: a second install from onResume threw
     * IllegalStateException and killed the launch on the television. The override
     * lasts as long as the WebView does, so installing it once is enough.
     */
    private void suppressVideoPoster() {
        if (videoPosterSuppressed || getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }

            /**
             * A page that throws before it renders leaves nothing to read, so the first
             * error the page logs is kept where the problem screen can show it.
             */
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (message != null && message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    StartupState.noteProblem(MainActivity.this, "Page error: " + message.message());
                }
                return super.onConsoleMessage(message);
            }
        });
        videoPosterSuppressed = true;
    }

    /** Records which WebView is installed: a missing or ancient one explains a blank screen. */
    private void rememberWebView() {
        try {
            PackageInfo packageInfo = WebView.getCurrentWebViewPackage();
            String webView = packageInfo == null
                ? "Android System WebView is missing on this device"
                : packageInfo.packageName + " " + packageInfo.versionName;
            StartupState.setWebView(this, webView);
            StartupState.log(this, "web view: " + webView);
        } catch (Exception ignored) {
            // Keep whatever the previous launch recorded.
        }
    }

    /**
     * A launch that never reports in and never dies either leaves a blank screen behind.
     * Put the reason on the television instead, so a failure can be read there rather than
     * guessed at from a blank screen. A launch that dies quickly is caught by the launcher
     * on the next start, which reports it without creating a WebView at all.
     */
    private void watchForFailedStartup() {
        watchdog.postDelayed(() -> {
            if (problemResolved || isFinishing() || isDestroyed()) return;
            if (StartupProblem.shown(this)) return;
            // The web app clears this mark once it has painted, so a mark still standing
            // means this launch never got there.
            if (!StartupState.isPending(this)) return;
            StartupProblem.show(this);
        }, STARTUP_WATCHDOG_MS);
    }

    /** The web app painted: take the problem screen down again. */
    void dismissStartupProblem() {
        problemResolved = true;
        StartupProblem.dismiss(this);
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
            // A launch that is already showing why it failed keeps that screen: restarting
            // or closing here would take the reason away before it could be read.
            if (StartupProblem.shown(MainActivity.this)) {
                StartupState.log(MainActivity.this, "the renderer died while the problem screen was up");
                return true;
            }
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
