package app.mirufin.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Player;

import org.junit.Test;

/**
 * What the player tells the screen, checked on the development machine.
 *
 * The interesting case is a stream that has run out of buffer: it is not playing, but nobody
 * paused it. Reporting that as paused put the play button on screen over a filling stream, told
 * Jellyfin the viewer had stopped watching, and made the next press of OK a resume for a player
 * that was never paused.
 */
public class PlayerStateTest {

    @Test
    public void aStreamThatIsPlayingIsNotPausedOrBufferingOrEnded() {
        assertFalse(PlayerState.paused(true, true));
        assertFalse(PlayerState.buffering(true, Player.STATE_READY));
        assertFalse(PlayerState.ended(true, Player.STATE_READY));
    }

    @Test
    public void aStreamFillingItsBufferIsNotPaused() {
        // The case this class exists for: nothing is on screen yet, but the viewer asked for it
        // and nobody has paused it.
        assertTrue(PlayerState.buffering(true, Player.STATE_BUFFERING));
        assertFalse(PlayerState.paused(true, true));
        assertFalse(PlayerState.ended(true, Player.STATE_BUFFERING));
    }

    @Test
    public void aStreamTheViewerPausedIsPaused() {
        assertTrue(PlayerState.paused(true, false));
        assertFalse(PlayerState.buffering(true, Player.STATE_READY));
        assertFalse(PlayerState.ended(true, Player.STATE_READY));
    }

    @Test
    public void aReleasedPlayerIsPausedAndNothingElse() {
        assertTrue(PlayerState.paused(false, true));
        assertFalse(PlayerState.buffering(false, Player.STATE_BUFFERING));
        assertFalse(PlayerState.ended(false, Player.STATE_ENDED));
    }

    @Test
    public void theEndOfAStreamIsItsOwnState() {
        assertTrue(PlayerState.ended(true, Player.STATE_ENDED));
        assertFalse(PlayerState.buffering(true, Player.STATE_ENDED));
        assertFalse(PlayerState.ended(true, Player.STATE_READY));
    }

    @Test
    public void theIdleStateIsNeitherBufferingNorEnded() {
        assertFalse(PlayerState.buffering(true, Player.STATE_IDLE));
        assertFalse(PlayerState.ended(true, Player.STATE_IDLE));
    }
}
