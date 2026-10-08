package app.mirufin.tv;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DiscoveryPlugin.class);
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);
        prepareWebView();
    }

    @Override
    public void onResume() {
        super.onResume();
        prepareWebView();
    }

    private void prepareWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebSettings settings = getBridge().getWebView().getSettings();
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
}
