package app.mirufin.tv;

import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

/**
 * The activity the television launches.
 *
 * It creates no WebView of its own, which is the whole point: when starting the WebView is
 * what kills Mirufin, an activity that reports the failure has to be able to run without
 * one. The previous launch is checked here, before anything that can crash exists.
 *
 * A launch that follows a failed one shows the problem screen and leaves it up until a
 * button is pressed, so the reason can be read on the television. Every other launch hands
 * straight over to Mirufin itself.
 */
public class StartupActivity extends AppCompatActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Repairs a store the previous launch may have damaged, and reports whether the
        // previous launch died before the web app ever came up.
        if (StartupState.healIfPending(this)) {
            StartupProblem.show(this);
            return;
        }
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
