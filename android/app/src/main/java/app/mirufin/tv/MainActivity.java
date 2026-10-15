package app.mirufin.tv;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DiscoveryPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(NativePlayerPlugin.class);
        super.onCreate(savedInstanceState);
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
}
