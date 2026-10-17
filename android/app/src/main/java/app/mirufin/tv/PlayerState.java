package app.mirufin.tv;

import androidx.media3.common.Player;

/**
 * What the player's own flags mean for the screen.
 *
 * Paused is the viewer's intent, not the momentary state of the picture. A stream that has run
 * out of buffer is still something the viewer asked to play, and calling that paused puts the
 * play button on screen over a stream that is filling, tells Jellyfin the viewer stopped
 * watching, and turns the next press of OK into a resume for a player that never paused.
 *
 * The distinction lives here, on its own, so it can be read and checked on a development machine
 * rather than only on a television. Nothing in this class touches the Android framework: the
 * playback states are the constants Media3 compiles into the call sites.
 */
public final class PlayerState {

    private PlayerState() {}

    /** Whether playback is paused: what the viewer asked for, not what the picture is doing. */
    public static boolean paused(boolean hasPlayer, boolean playWhenReady) {
        return !hasPlayer || !playWhenReady;
    }

    /** Whether the player is waiting for more of the stream. */
    public static boolean buffering(boolean hasPlayer, int playbackState) {
        return hasPlayer && playbackState == Player.STATE_BUFFERING;
    }

    /** Whether the stream has run out. */
    public static boolean ended(boolean hasPlayer, int playbackState) {
        return hasPlayer && playbackState == Player.STATE_ENDED;
    }
}
