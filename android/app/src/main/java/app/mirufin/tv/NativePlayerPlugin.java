package app.mirufin.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private String mediaUrl = "";
    private int savedModeId = -1;
    private boolean ticking = false;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (player == null) {
                ticking = false;
                return;
            }
            publish(null);
            handler.postDelayed(this, 400);
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
            publish(null);
            if (state == Player.STATE_READY) applyFrameRate();
        }

        @Override
        public void onIsPlayingChanged(boolean playing) {
            publish(null);
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            String detail = error.getErrorCodeName();
            if (error.getMessage() != null) detail = detail + ": " + error.getMessage();
            publish(detail);
        }
    };

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing playback address.");
            return;
        }
        double start = call.getDouble("startSeconds", 0d);
        String subtitle = call.getString("subtitleUrl", "");
        JSObject headers = call.getObject("headers", new JSObject());
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Mirufin is not on screen.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                releasePlayer();
                Map<String, String> headerMap = new HashMap<>();
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (value != null) headerMap.put(key, value);
                }
                DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory();
                http.setAllowCrossProtocolRedirects(true);
                http.setUserAgent("Mirufin");
                http.setDefaultRequestProperties(headerMap);
                DefaultDataSource.Factory data = new DefaultDataSource.Factory(activity, http);
                DefaultRenderersFactory renderers = new DefaultRenderersFactory(activity);
                renderers.setEnableDecoderFallback(true);
                ExoPlayer exo = new ExoPlayer.Builder(activity)
                    .setRenderersFactory(renderers)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(data))
                    .build();
                exo.setWakeMode(C.WAKE_MODE_NETWORK);
                MediaItem.Builder item = new MediaItem.Builder().setUri(url);
                if (subtitle != null && !subtitle.isEmpty()) item.setSubtitleConfigurations(sidecar(subtitle));
                exo.setMediaItem(item.build(), Math.max(0L, (long) (start * 1000)));
                exo.addListener(listener);
                exo.prepare();
                exo.play();
                player = exo;
                mediaUrl = url;
                view.setPlayer(exo);
                view.setVisibility(View.VISIBLE);
                WebView webView = getBridge().getWebView();
                if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (!ticking) {
                    ticking = true;
                    handler.post(tick);
                }
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Playback could not start." : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runPlayer(call, () -> player.pause());
    }

    @PluginMethod
    public void resume(PluginCall call) {
        runPlayer(call, () -> player.play());
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double seconds = call.getDouble("seconds", 0d);
        runPlayer(call, () -> player.seekTo(Math.max(0L, (long) (seconds * 1000))));
    }

    @PluginMethod
    public void rate(PluginCall call) {
        Double rateValue = call.getDouble("rate", 1d);
        float rate = rateValue == null ? 1f : rateValue.floatValue();
        runPlayer(call, () -> player.setPlaybackSpeed(rate));
    }

    @PluginMethod
    public void volume(PluginCall call) {
        Double volumeValue = call.getDouble("volume", 1d);
        float volume = volumeValue == null ? 1f : volumeValue.floatValue();
        runPlayer(call, () -> player.setVolume(Math.max(0f, Math.min(1f, volume))));
    }

    @PluginMethod
    public void subtitle(PluginCall call) {
        String url = call.getString("url", "");
        Activity activity = getActivity();
        if (activity == null || player == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (player == null || mediaUrl.isEmpty()) {
                call.resolve();
                return;
            }
            long position = Math.max(0L, player.getCurrentPosition());
            boolean playing = player.isPlaying();
            MediaItem.Builder item = new MediaItem.Builder().setUri(mediaUrl);
            if (url != null && !url.isEmpty()) item.setSubtitleConfigurations(sidecar(url));
            player.setMediaItem(item.build(), position);
            player.prepare();
            if (playing) player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void selectAudio(PluginCall call) {
        int ordinal = call.getInt("ordinal", 0);
        selectTrack(call, C.TRACK_TYPE_AUDIO, ordinal);
    }

    @PluginMethod
    public void selectText(PluginCall call) {
        int ordinal = call.getInt("ordinal", -1);
        selectTrack(call, C.TRACK_TYPE_TEXT, ordinal);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            teardown(activity);
            call.resolve();
        });
    }

    private void selectTrack(PluginCall call, int type, int ordinal) {
        Activity activity = getActivity();
        if (activity == null || player == null) {
            JSObject result = new JSObject();
            result.put("selected", false);
            call.resolve(result);
            return;
        }
        activity.runOnUiThread(() -> {
            boolean selected = false;
            if (player != null) {
                Tracks tracks = player.getCurrentTracks();
                androidx.media3.common.TrackSelectionParameters.Builder builder = player.getTrackSelectionParameters().buildUpon();
                builder.clearOverridesOfType(type);
                if (ordinal < 0) {
                    builder.setTrackTypeDisabled(type, true);
                    selected = true;
                } else {
                    builder.setTrackTypeDisabled(type, false);
                    int seen = 0;
                    for (Tracks.Group group : tracks.getGroups()) {
                        if (group.getType() != type) continue;
                        TrackGroup media = group.getMediaTrackGroup();
                        if (ordinal < seen + media.length) {
                            builder.setOverrideForType(new TrackSelectionOverride(media, ordinal - seen));
                            selected = true;
                            break;
                        }
                        seen += media.length;
                    }
                }
                if (selected) player.setTrackSelectionParameters(builder.build());
            }
            JSObject result = new JSObject();
            result.put("selected", selected);
            call.resolve(result);
        });
    }

    private void runPlayer(PluginCall call, Runnable action) {
        Activity activity = getActivity();
        if (activity == null || player == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (player != null) action.run();
            call.resolve();
        });
    }

    private void ensureView(Activity activity) {
        if (view != null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup parent = (ViewGroup) webView.getParent();
        PlayerView created = new PlayerView(activity);
        created.setUseController(false);
        created.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        created.setBackgroundColor(Color.BLACK);
        created.setVisibility(View.GONE);
        parent.addView(created, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        view = created;
    }

    private void publish(String error) {
        if (player == null && error == null) return;
        JSObject data = new JSObject();
        long position = player == null ? 0 : player.getCurrentPosition();
        long duration = player == null ? 0 : player.getDuration();
        data.put("seconds", position / 1000.0);
        data.put("duration", duration > 0 ? duration / 1000.0 : 0);
        data.put("paused", player == null || !player.isPlaying());
        data.put("buffering", player != null && player.getPlaybackState() == Player.STATE_BUFFERING);
        data.put("ended", player != null && player.getPlaybackState() == Player.STATE_ENDED);
        if (error != null) data.put("error", error);
        notifyListeners("state", data);
    }

    private void applyFrameRate() {
        Activity activity = getActivity();
        if (activity == null || player == null) return;
        Format format = player.getVideoFormat();
        if (format == null || format.frameRate < 10) return;
        Display display = activity.getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        if (savedModeId < 0) savedModeId = current.getModeId();
        Display.Mode best = null;
        float bestScore = 2f;
        float fps = format.frameRate;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() != current.getPhysicalWidth() || mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            float rate = mode.getRefreshRate();
            float score = Math.min(Math.abs(rate - fps), Math.abs(rate - (fps * 2f)));
            if (score < bestScore) {
                bestScore = score;
                best = mode;
            }
        }
        if (best == null || bestScore > 0.8f) return;
        Window window = activity.getWindow();
        WindowManager.LayoutParams params = window.getAttributes();
        if (params.preferredDisplayModeId == best.getModeId()) return;
        params.preferredDisplayModeId = best.getModeId();
        window.setAttributes(params);
    }

    private List<MediaItem.SubtitleConfiguration> sidecar(String url) {
        List<MediaItem.SubtitleConfiguration> list = new ArrayList<>();
        list.add(new MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(url))
            .setMimeType(MimeTypes.TEXT_VTT)
            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build());
        return list;
    }

    private void releasePlayer() {
        if (player == null) return;
        player.removeListener(listener);
        player.release();
        player = null;
    }

    private void teardown(Activity activity) {
        handler.removeCallbacks(tick);
        ticking = false;
        releasePlayer();
        mediaUrl = "";
        if (view != null) {
            view.setPlayer(null);
            view.setVisibility(View.GONE);
        }
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.parseColor("#09090b"));
        Window window = activity.getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (savedModeId >= 0) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.preferredDisplayModeId = savedModeId;
            window.setAttributes(params);
            savedModeId = -1;
        }
    }
}
