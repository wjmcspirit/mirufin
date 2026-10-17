package app.mirufin.tv;

import android.app.Activity;
import android.graphics.Color;
import android.util.Log;
import android.util.TypedValue;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {
    private static final String TAG = "MirufinPlayer";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView view;
    private String mediaUrl = "";
    private String cueSize = "medium";
    private float cueRaise = 8f;
    private boolean ticking = false;
    private boolean revealed = false;

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
        }

        @Override
        public void onIsPlayingChanged(boolean playing) {
            publish(null);
        }

        @Override
        public void onRenderedFirstFrame() {
            reveal();
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            String detail = error.getErrorCodeName();
            if (error.getMessage() != null) detail = detail + ": " + error.getMessage();
            Log.e(TAG, detail, error);
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
                renderers.setMediaCodecSelector(safeDecoders());
                ExoPlayer exo = new ExoPlayer.Builder(activity)
                    .setRenderersFactory(renderers)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(data))
                    .build();
                player = exo;
                exo.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF);
                exo.setTrackSelectionParameters(calmTracks(exo.getTrackSelectionParameters()));
                try {
                    exo.setWakeMode(C.WAKE_MODE_NETWORK);
                } catch (RuntimeException ignored) {
                    /* Playback continues if the device refuses a wake lock. */
                }
                MediaItem.Builder item = new MediaItem.Builder().setUri(url);
                if (subtitle != null && !subtitle.isEmpty()) item.setSubtitleConfigurations(sidecar(subtitle));
                exo.setMediaItem(item.build(), Math.max(0L, (long) (start * 1000)));
                exo.addListener(listener);
                mediaUrl = url;
                view.setPlayer(exo);
                view.setVisibility(View.VISIBLE);
                revealed = false;
                // Keep the WebView opaque and dark until ExoPlayer renders its first
                // frame (see onRenderedFirstFrame). isPlaying can turn true before
                // any frame is exposed, and revealing early exposes the stale web
                // page plus the WebView's native video placeholder beneath it.
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null) webView.setBackgroundColor(Color.parseColor("#09090b"));
                exo.prepare();
                exo.play();
                applyCueStyle();
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (!ticking) {
                    ticking = true;
                    handler.post(tick);
                }
                call.resolve();
            } catch (Exception error) {
                Log.e(TAG, "Playback could not start.", error);
                if (view != null) view.setPlayer(null);
                releasePlayer();
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null) webView.setBackgroundColor(Color.parseColor("#09090b"));
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
    public void subtitleStyle(PluginCall call) {
        String size = call.getString("size", "medium");
        Double raise = call.getDouble("raise", 8d);
        cueSize = size == null || size.isEmpty() ? "medium" : size;
        cueRaise = raise == null ? 8f : raise.floatValue();
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            applyCueStyle();
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
        if (view != null && view.isAttachedToWindow()) return;
        if (view != null) {
            ViewGroup oldParent = view.getParent() instanceof ViewGroup ? (ViewGroup) view.getParent() : null;
            if (oldParent != null) oldParent.removeView(view);
            view = null;
        }
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null || !(webView.getParent() instanceof ViewGroup)) {
            throw new IllegalStateException("Mirufin is not on screen.");
        }
        ViewGroup parent = (ViewGroup) webView.getParent();
        PlayerView created = (PlayerView) activity.getLayoutInflater().inflate(R.layout.native_player, parent, false);
        created.setUseController(false);
        created.setControllerAutoShow(false);
        created.setUseArtwork(false);
        created.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        created.setShutterBackgroundColor(Color.BLACK);
        created.setKeepContentOnPlayerReset(false);
        created.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        created.setBackgroundColor(Color.BLACK);
        created.setVisibility(View.GONE);
        parent.addView(created, 0);
        view = created;
    }

    private MediaCodecSelector safeDecoders() {
        return (mimeType, requiresSecureDecoder, requiresTunnelingDecoder) -> {
            List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> infos = MediaCodecSelector.DEFAULT.getDecoderInfos(
                mimeType,
                requiresSecureDecoder,
                requiresTunnelingDecoder
            );
            if (!MimeTypes.VIDEO_DOLBY_VISION.equals(mimeType)) return infos;
            List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> safe = new ArrayList<>();
            for (androidx.media3.exoplayer.mediacodec.MediaCodecInfo info : infos) {
                String name = info.name.toLowerCase(Locale.US);
                if (name.contains("dolby")) continue;
                safe.add(info);
            }
            return safe;
        };
    }

    private TrackSelectionParameters calmTracks(TrackSelectionParameters current) {
        return current.buildUpon()
            .setAudioOffloadPreferences(
                new TrackSelectionParameters.AudioOffloadPreferences.Builder()
                    .setAudioOffloadMode(TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED)
                    .build()
            )
            .build();
    }

    private void publish(String error) {
        try {
            if (player == null && error == null) return;
            boolean hasPlayer = player != null;
            JSObject data = new JSObject();
            long position = hasPlayer ? Math.max(0L, player.getCurrentPosition()) : 0;
            long duration = hasPlayer ? player.getDuration() : 0;
            int state = hasPlayer ? player.getPlaybackState() : Player.STATE_IDLE;
            data.put("seconds", position / 1000.0);
            data.put("duration", duration > 0 ? duration / 1000.0 : 0);
            data.put("paused", PlayerState.paused(hasPlayer, hasPlayer && player.getPlayWhenReady()));
            data.put("buffering", PlayerState.buffering(hasPlayer, state));
            data.put("ended", PlayerState.ended(hasPlayer, state));
            if (error != null) data.put("error", error);
            notifyListeners("state", data);
        } catch (RuntimeException failure) {
            Log.w(TAG, "Could not report playback.", failure);
        }
    }

    private void applyCueStyle() {
        if (view == null) return;
        SubtitleView subs = view.getSubtitleView();
        if (subs == null) return;
        float sp = "large".equals(cueSize) ? 42f : "small".equals(cueSize) ? 18f : 28f;
        subs.setApplyEmbeddedFontSizes(false);
        subs.setFixedTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        float fraction = Math.max(0f, Math.min(0.4f, cueRaise / 100f));
        subs.setBottomPaddingFraction(fraction);
    }

    private List<MediaItem.SubtitleConfiguration> sidecar(String url) {
        List<MediaItem.SubtitleConfiguration> list = new ArrayList<>();
        list.add(new MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(url))
            .setMimeType(MimeTypes.TEXT_VTT)
            .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            .build());
        return list;
    }

    private void reveal() {
        if (revealed || view == null) return;
        revealed = true;
        if (Looper.myLooper() == Looper.getMainLooper()) applyReveal();
        else handler.post(this::applyReveal);
    }

    private void applyReveal() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
    }

    private void releasePlayer() {
        if (player == null) return;
        player.removeListener(listener);
        player.release();
        player = null;
    }

    @Override
    protected void handleOnDestroy() {
        teardown(getActivity());
    }

    /**
     * The activity is no longer on screen: the television's own Home button, the system settings,
     * anything that takes the picture away.
     *
     * Nothing else pauses playback for us - this player is not tied to a media session and takes
     * no audio focus - so without this the sound carries on over whatever the viewer moved to. The
     * media item and its position are left exactly as they are, so coming back shows the frame the
     * viewer left, paused, and one press of OK carries on from there. It is not resumed on the way
     * back: the viewer chose to leave, and a screen that starts talking by itself is worse than
     * one that waits to be asked.
     */
    @Override
    protected void handleOnPause() {
        if (player == null) return;
        player.pause();
        publish(null);
    }

    private void teardown(Activity activity) {
        handler.removeCallbacks(tick);
        ticking = false;
        revealed = false;
        releasePlayer();
        mediaUrl = "";
        if (view != null) {
            view.setPlayer(null);
            view.setVisibility(View.GONE);
        }
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.parseColor("#09090b"));
        if (activity != null) activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
