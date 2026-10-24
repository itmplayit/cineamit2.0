package in.cineamit.app.widget;

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.LinearGradient;
import android.graphics.Shader;
import android.util.AttributeSet;

import androidx.appcompat.widget.AppCompatTextView;

import in.cineamit.app.R;

public class GradientTextView extends AppCompatTextView {
    private boolean vertical = true;
    private int startColor = 0xFFFE8706;
    private int endColor = 0xFFFE0476;

    public GradientTextView(Context context) {
        super(context);
        init(null);
    }

    public GradientTextView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(attrs);
    }

    public GradientTextView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(attrs);
    }

    private void init(AttributeSet attrs) {
        if (attrs != null) {
            TypedArray a = getContext().obtainStyledAttributes(attrs, R.styleable.GradientTextView);
            vertical = a.getBoolean(R.styleable.GradientTextView_isVertical, true);
            startColor = a.getColor(R.styleable.GradientTextView_startColor, startColor);
            endColor = a.getColor(R.styleable.GradientTextView_endColor, endColor);
            a.recycle();
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        if (w <= 0 || h <= 0) return;
        getPaint().setShader(new LinearGradient(0, 0, vertical ? 0 : w, vertical ? h : 0,
                startColor, endColor, Shader.TileMode.CLAMP));
    }
}
