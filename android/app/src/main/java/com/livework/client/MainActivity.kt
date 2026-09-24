package com.livework.client

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Shows the LiveWork web client full screen in a WebView.
 * The first screen asks for the server address; `livework://open?url=...` links skip it.
 */
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var connectView: View
    private lateinit var addressInput: EditText
    private lateinit var errorText: TextView
    private var webView: WebView? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private val prefs by lazy { getSharedPreferences("livework", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        drawEdgeToEdge()
        connectView = buildConnectView()
        root.addView(connectView)
        setContentView(root)
        if (!openFromIntent(intent)) showConnect(null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFromIntent(intent)
    }

    private fun openFromIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (data.scheme != "livework" || data.host != "open") return false
        val target = data.getQueryParameter("url")
        val url = target?.let { normalize(it) }
        if (url == null) showConnect("This link does not contain a valid LiveWork address.") else open(url)
        return true
    }

    private fun buildConnectView(): View {
        val padding = dp(24)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
        }
        layout.addView(TextView(this).apply {
            text = "LiveWork"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        })
        layout.addView(TextView(this).apply {
            text = "Enter the address shown in the LiveWork window in Unity."
            setTextColor(Color.rgb(168, 168, 168))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(8), 0, dp(24))
        })
        addressInput = EditText(this).apply {
            hint = "http://100.x.y.z:port"
            setText(prefs.getString("url", ""))
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(103, 103, 103))
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_GO) {
                    connect()
                    true
                } else false
            }
        }
        layout.addView(addressInput, LinearLayout.LayoutParams(dp(360), ViewGroup.LayoutParams.WRAP_CONTENT))
        layout.addView(Button(this).apply {
            text = "Connect"
            setOnClickListener { connect() }
        }, LinearLayout.LayoutParams(dp(360), ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
        errorText = TextView(this).apply {
            setTextColor(Color.rgb(255, 180, 171))
            setPadding(0, dp(12), 0, 0)
        }
        layout.addView(errorText)
        return layout
    }

    private fun connect() {
        val url = normalize(addressInput.text.toString())
        if (url == null) {
            errorText.text = "Enter an address such as http://100.101.102.103:8080"
            return
        }
        prefs.edit().putString("url", url).apply()
        open(url)
    }

    /** Accepts "host:port" or a full http(s) URL. Returns null for anything else. */
    private fun normalize(input: String): String? {
        val text = input.trim()
        if (text.isEmpty()) return null
        val uri = Uri.parse(if (text.contains("://")) text else "http://$text")
        if (uri.scheme != "http" && uri.scheme != "https") return null
        if (uri.host.isNullOrEmpty()) return null
        return uri.toString()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val created = WebView(this)
        created.setBackgroundColor(Color.BLACK)
        created.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        CookieManager.getInstance().setAcceptCookie(true)
        created.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Stay on the LiveWork server; open anything else in the system browser.
                val current = Uri.parse(view.url ?: return false)
                if (request.url.host == current.host && request.url.port == current.port) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showConnect("Cannot reach LiveWork: ${error.description}. Check the server and Tailscale.")
            }
        }
        created.webChromeClient = object : WebChromeClient() {
            // Element fullscreen (the toolbar's Fullscreen button) needs a host view in a WebView.
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                hideCustomView()
                customView = view
                customViewCallback = callback
                root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }

            override fun onHideCustomView() = hideCustomView()
        }
        root.addView(created, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        return created
    }

    private fun open(url: String) {
        val view = webView ?: createWebView().also { webView = it }
        errorText.text = ""
        connectView.visibility = View.GONE
        view.visibility = View.VISIBLE
        view.loadUrl(url)
        setFullScreen(true)
    }

    private fun hideCustomView() {
        val view = customView ?: return
        root.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
    }

    private fun showConnect(error: String?) {
        hideCustomView()
        webView?.let {
            it.stopLoading()
            it.loadUrl("about:blank")
            it.visibility = View.GONE
        }
        connectView.visibility = View.VISIBLE
        errorText.text = error ?: ""
        setFullScreen(false)
    }

    /**
     * Draws behind the system bars and the camera cutout on every Android version,
     * then pads the content so nothing sits under them.
     */
    private fun drawEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(false)
        root.setOnApplyWindowInsetsListener { view, insets ->
            val safe = safeArea(insets)
            view.setPadding(safe[0], safe[1], safe[2], safe[3])
            insets
        }
    }

    /** Returns left, top, right, bottom space taken by visible system bars, the cutout, and the keyboard. */
    private fun safeArea(insets: WindowInsets): IntArray {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val types = WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
            val area = insets.getInsets(types)
            return intArrayOf(area.left, area.top, area.right, area.bottom)
        }
        @Suppress("DEPRECATION")
        val area = intArrayOf(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) insets.displayCutout?.let {
            area[0] = maxOf(area[0], it.safeInsetLeft)
            area[1] = maxOf(area[1], it.safeInsetTop)
            area[2] = maxOf(area[2], it.safeInsetRight)
            area[3] = maxOf(area[3], it.safeInsetBottom)
        }
        return area
    }

    private fun setFullScreen(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = window.insetsController ?: return
            if (enabled) {
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else controller.show(WindowInsets.Type.systemBars())
        } else {
            // Layout flags stay on so the app always draws edge to edge and pads itself.
            @Suppress("DEPRECATION")
            val layout = View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            @Suppress("DEPRECATION")
            val hidden = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (enabled) layout or hidden else layout
        }
        root.requestApplyInsets()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && webView?.visibility == View.VISIBLE) setFullScreen(true)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyDown(keyCode, event)
        when {
            customView != null -> webView?.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null)
            webView?.visibility == View.VISIBLE -> showConnect(null)
            else -> return super.onKeyDown(keyCode, event)
        }
        return true
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onDestroy() {
        webView?.destroy()
        super.onDestroy()
    }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
}
