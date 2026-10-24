package in.cineamit.app;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

import androidx.fragment.app.FragmentActivity;

import in.cineamit.app.data.Api;
import in.cineamit.app.ui.Ui;

public class InfoActivity extends FragmentActivity {
    public static void open(Context ctx, String kind) {
        ctx.startActivity(new Intent(ctx, InfoActivity.class).putExtra("kind", kind));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_info);
        String kind = getIntent().getStringExtra("kind");
        boolean privacy = "privacy".equals(kind);
        Ui.cineHeader(findViewById(android.R.id.content), privacy ? "Privacy" : "About", v -> finish());
        Io.run(this, () -> Api.page(privacy ? "privacy" : "about"), json -> {
            String body = json.optString("body");
            if (body == null || body.isEmpty()) {
                body = privacy ? json.optString("privacy") : json.optString("about");
            }
            if (body == null || body.isEmpty()) body = "";
            ((TextView) findViewById(R.id.body)).setText(body);
        }, e -> ((TextView) findViewById(R.id.body)).setText(e.getMessage()));
    }
}
