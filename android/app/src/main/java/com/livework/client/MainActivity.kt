package com.livework.client

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

/**
 * Shows the LiveWork web client full screen in a WebView.
 * The home screen offers two ways to connect: scan the QR code from the Unity LiveWork window,
 * or type the address. `livework://open?url=...` links skip it.
 */
class MainActivity : Activity() {
    private enum class Screen { Home, Scan, Web }

    private lateinit var root: FrameLayout
    private lateinit var homeView: LinearLayout
    private lateinit var homeError: TextView
    private lateinit var scanView: FrameLayout
    private lateinit var scanner: BarcodeView
    private lateinit var scanFrame: ScanFrameView
    private lateinit var cameraNotice: LinearLayout
    private lateinit var scanStatus: TextView
    private lateinit var loadingView: LinearLayout
    private lateinit var loadingAddress: TextView
    private var addressDialog: Dialog? = null
    private var webView: WebView? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var screen = Screen.Home
    private var resumed = false
    private var cameraAsked = false
    private var scanning = false

    private val handler = Handler(Looper.getMainLooper())
    private val hideLoadingLater = Runnable { setLoading(false) }
    private val prefs by lazy { getSharedPreferences("livework", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        drawEdgeToEdge()
        homeView = buildHomeView()
        scanView = buildScanView()
        loadingView = buildLoadingView()
        root.addView(homeView, matchParent())
        root.addView(scanView, matchParent())
        root.addView(loadingView, matchParent())
        setContentView(root)
        if (!openFromIntent(intent)) showHome(null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openFromIntent(intent)
    }

    private fun openFromIntent(intent: Intent?): Boolean {
        val data = intent?.data ?: return false
        if (data.scheme != "livework") return false
        val url = addressFromLink(data.toString())
        if (url == null) showHome("This link does not contain a valid LiveWork address.") else open(url)
        return true
    }

    // ---- Home screen ----

    private fun buildHomeView(): LinearLayout {
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(32), dp(32), dp(32))
        }
        layout.addView(ImageView(this).apply { setImageResource(R.drawable.logo) }, LinearLayout.LayoutParams(dp(72), dp(72)))
        layout.addView(TextView(this).apply {
            text = "LiveWork"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
        })
        layout.addView(TextView(this).apply {
            text = "Play and test your Unity game from this phone.\nConnect to the LiveWork window in the Unity Editor."
            setTextColor(TEXT_MUTED)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setLineSpacing(0f, 1.3f)
            gravity = Gravity.CENTER
            setPadding(0, dp(10), 0, dp(36))
        })
        val buttons = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, wrap)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(pillButton("Scan QR code", filled = true) { showScan() }, buttons)
        column.addView(pillButton("Enter address manually", filled = false) { showAddressDialog() }, LinearLayout.LayoutParams(buttons).apply { topMargin = dp(12) })
        layout.addView(column, LinearLayout.LayoutParams(dp(320), wrap))
        homeError = TextView(this).apply {
            setTextColor(ERROR_TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            setPadding(0, dp(20), 0, 0)
            visibility = View.GONE
        }
        layout.addView(homeError, LinearLayout.LayoutParams(dp(320), wrap))
        // Keep the column narrow on tablets, but let it shrink on small phones.
        layout.addOnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
            val width = minOf(dp(320), view.width - view.paddingLeft - view.paddingRight)
            for (child in listOf(column, homeError)) if (width > 0 && child.layoutParams.width != width) child.post {
                child.layoutParams = (child.layoutParams as LinearLayout.LayoutParams).apply { this.width = width }
            }
        }
        return layout
    }

    private fun showHome(error: String?) {
        screen = Screen.Home
        hideCustomView()
        webView?.let {
            it.stopLoading()
            it.loadUrl("about:blank")
            it.visibility = View.GONE
        }
        setLoading(false)
        homeView.visibility = View.VISIBLE
        scanView.visibility = View.GONE
        homeError.text = error ?: ""
        homeError.visibility = if (error.isNullOrEmpty()) View.GONE else View.VISIBLE
        setFullScreen(false)
        updateScanner()
    }

    // ---- Scan screen ----

    private fun buildScanView(): FrameLayout {
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
        val layout = FrameLayout(this).apply { visibility = View.GONE }
        scanner = BarcodeView(this).apply { decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE)) }
        layout.addView(scanner, matchParent())
        scanFrame = ScanFrameView(this)
        layout.addView(scanFrame, matchParent())

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(16), dp(12), dp(16), 0)
        }
        top.addView(TextView(this).apply {
            text = "✕"
            contentDescription = "Close scanner"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            gravity = Gravity.CENTER
            background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), rounded(0x66000000, dp(24).toFloat()), null)
            isClickable = true
            setOnClickListener { showHome(null) }
        }, LinearLayout.LayoutParams(dp(48), dp(48)).apply { gravity = Gravity.START })
        top.addView(TextView(this).apply {
            text = "Point the camera at the QR code\nin the LiveWork window in Unity"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setLineSpacing(0f, 1.25f)
            gravity = Gravity.CENTER
            setPadding(0, dp(4), 0, 0)
        })
        layout.addView(top, FrameLayout.LayoutParams(match, wrap, Gravity.TOP))

        cameraNotice = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(32), 0, dp(32), 0)
            visibility = View.GONE
        }
        cameraNotice.addView(TextView(this).apply {
            text = "Allow camera access to scan the QR code."
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            gravity = Gravity.CENTER
        })
        cameraNotice.addView(pillButton("Allow camera", filled = true) { askCamera() }, LinearLayout.LayoutParams(wrap, wrap).apply { topMargin = dp(16) })
        layout.addView(cameraNotice, FrameLayout.LayoutParams(match, wrap, Gravity.CENTER))

        scanStatus = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            background = rounded(ERROR_BG, dp(12).toFloat())
            setPadding(dp(14), dp(10), dp(14), dp(10))
            visibility = View.GONE
        }
        layout.addView(scanStatus, FrameLayout.LayoutParams(wrap, wrap, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(40) })
        return layout
    }

    private fun showScan() {
        screen = Screen.Scan
        homeView.visibility = View.GONE
        scanView.visibility = View.VISIBLE
        scanStatus.visibility = View.GONE
        if (!hasCamera() && !cameraAsked) askCamera()
        updateScanner()
    }

    private fun onScanned(text: String) {
        if (!scanning) return
        val url = addressFromLink(text)
        if (url == null) {
            scanStatus.text = "This QR code is not a LiveWork address."
            scanStatus.visibility = View.VISIBLE
            return
        }
        open(url)
    }

    // ---- Address dialog ----

    private fun showAddressDialog() {
        if (addressDialog?.isShowing == true) return
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val dialog = Dialog(this)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(20))
            background = GradientDrawable().apply {
                setColor(SHEET_BG)
                cornerRadius = dp(20).toFloat()
                setStroke(dp(1), LINE)
            }
        }
        card.addView(TextView(this).apply {
            text = "Enter address"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        })
        card.addView(TextView(this).apply {
            text = "Use the address shown in the LiveWork window in Unity."
            setTextColor(TEXT_MUTED)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(4), 0, dp(16))
        })
        val error = TextView(this).apply {
            setTextColor(ERROR_TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(dp(4), dp(8), dp(4), 0)
            visibility = View.GONE
        }
        val input = EditText(this).apply {
            hint = "192.168.1.20:port"
            setText(prefs.getString("url", "")?.removePrefix("http://"))
            setSelection(text.length)
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setTextColor(Color.WHITE)
            setHintTextColor(TEXT_HINT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = rounded(INPUT_BG, dp(12).toFloat())
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        val confirm = {
            val url = normalize(input.text.toString())
            if (url == null) {
                error.text = "Enter an address such as 192.168.1.20:8080 or 100.101.102.103:8080"
                error.visibility = View.VISIBLE
            } else {
                dialog.dismiss()
                open(url)
            }
        }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) {
                confirm()
                true
            } else false
        }
        card.addView(input, LinearLayout.LayoutParams(match, wrap))
        card.addView(error)
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            setPadding(0, dp(20), 0, 0)
        }
        actions.addView(pillButton("Cancel", filled = false) { dialog.dismiss() }, LinearLayout.LayoutParams(0, wrap, 1f))
        actions.addView(pillButton("Connect", filled = true) { confirm() }, LinearLayout.LayoutParams(0, wrap, 1f).apply { marginStart = dp(12) })
        card.addView(actions, LinearLayout.LayoutParams(match, wrap))

        dialog.setContentView(card)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(minOf(dp(400), resources.displayMetrics.widthPixels - dp(32)), wrap)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        dialog.setOnDismissListener { addressDialog = null }
        addressDialog = dialog
        dialog.show()
        input.requestFocus()
    }

    // ---- Loading screen ----

    private fun buildLoadingView(): LinearLayout {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            isClickable = true
            visibility = View.GONE
        }
        layout.addView(ProgressBar(this).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(Color.rgb(212, 212, 212))
        }, LinearLayout.LayoutParams(dp(40), dp(40)))
        layout.addView(TextView(this).apply {
            text = "Connecting…"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setPadding(0, dp(20), 0, 0)
        })
        loadingAddress = TextView(this).apply {
            setTextColor(TEXT_MUTED)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, dp(6), 0, 0)
        }
        layout.addView(loadingAddress)
        return layout
    }

    private fun setLoading(show: Boolean) {
        handler.removeCallbacks(hideLoadingLater)
        loadingView.visibility = if (show) View.VISIBLE else View.GONE
    }

    // ---- Camera ----

    private fun hasCamera() = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun askCamera() {
        if (hasCamera()) return updateScanner()
        if (cameraAsked && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            // The user chose "Don't ask again"; only the system settings can grant it now.
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            return
        }
        cameraAsked = true
        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_REQUEST)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_REQUEST) updateScanner()
    }

    /** Runs the camera only while the scan screen is shown and the app is in front. */
    private fun updateScanner() {
        val allowed = hasCamera()
        cameraNotice.visibility = if (allowed) View.GONE else View.VISIBLE
        scanFrame.visibility = if (allowed) View.VISIBLE else View.GONE
        val run = allowed && resumed && screen == Screen.Scan
        if (run == scanning) return
        scanning = run
        if (run) {
            scanner.decodeContinuous(object : BarcodeCallback {
                override fun barcodeResult(result: BarcodeResult) {
                    val text = result.text ?: return
                    runOnUiThread { onScanned(text) }
                }

                override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>) {}
            })
            scanner.resume()
        } else {
            scanner.stopDecoding()
            scanner.pause()
        }
    }

    // ---- Addresses ----

    /** Reads a scanned or opened link: `livework://open?url=...` or a plain http(s) address. */
    private fun addressFromLink(text: String): String? {
        val uri = Uri.parse(text.trim())
        return when (uri.scheme) {
            "livework" -> if (uri.host == "open") uri.getQueryParameter("url")?.let { normalize(it) } else null
            "http", "https" -> normalize(text)
            else -> null
        }
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

    // ---- Web client ----

    /** Called by the web client when it shows its main view or its pairing form. */
    private inner class PageBridge {
        @JavascriptInterface
        fun screen(@Suppress("UNUSED_PARAMETER") name: String) {
            runOnUiThread { if (screen == Screen.Web) setLoading(false) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun createWebView(): WebView {
        val created = WebView(this)
        created.setBackgroundColor(Color.BLACK)
        created.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        created.addJavascriptInterface(PageBridge(), "LiveWorkApp")
        CookieManager.getInstance().setAcceptCookie(true)
        created.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Stay on the LiveWork server; open anything else in the system browser.
                val current = Uri.parse(view.url ?: return false)
                if (request.url.host == current.host && request.url.port == current.port) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                // An older LiveWork server does not call the bridge; do not keep the loading screen forever.
                if (screen == Screen.Web && url != "about:blank") {
                    handler.removeCallbacks(hideLoadingLater)
                    handler.postDelayed(hideLoadingLater, 10_000)
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showHome("Cannot reach LiveWork: ${error.description}. Check that the server is running and that this phone is on the network chosen in Unity (LAN, Tailscale, or ZeroTier).")
            }
        }
        created.webChromeClient = object : WebChromeClient() {
            // Without this, WebView draws a large gray play icon over a video that has not started yet.
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

            // Element fullscreen (the toolbar's Fullscreen button) needs a host view in a WebView.
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                hideCustomView()
                customView = view
                customViewCallback = callback
                root.addView(view, matchParent())
            }

            override fun onHideCustomView() = hideCustomView()
        }
        root.addView(created, root.indexOfChild(loadingView), matchParent())
        return created
    }

    private fun open(url: String) {
        prefs.edit().putString("url", url).apply()
        addressDialog?.dismiss()
        screen = Screen.Web
        updateScanner()
        homeView.visibility = View.GONE
        scanView.visibility = View.GONE
        loadingAddress.text = Uri.parse(url).authority ?: url
        setLoading(true)
        val view = webView ?: createWebView().also { webView = it }
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

    // ---- Window ----

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
        if (hasFocus && screen == Screen.Web) setFullScreen(true)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyDown(keyCode, event)
        when {
            customView != null -> webView?.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null)
            screen != Screen.Home -> showHome(null)
            else -> return super.onKeyDown(keyCode, event)
        }
        return true
    }

    override fun onPause() {
        resumed = false
        updateScanner()
        webView?.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        webView?.onResume()
        updateScanner()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        addressDialog?.dismiss()
        webView?.destroy()
        super.onDestroy()
    }

    // ---- Small view helpers ----

    private fun matchParent() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

    private fun rounded(color: Int, radius: Float) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
    }

    private fun pillButton(label: String, filled: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        gravity = Gravity.CENTER
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(if (filled) Color.BLACK else Color.WHITE)
        minHeight = dp(52)
        setPadding(dp(24), dp(14), dp(24), dp(14))
        val shape = rounded(if (filled) Color.rgb(240, 240, 240) else BUTTON_DARK, dp(26).toFloat())
        if (!filled) shape.setStroke(dp(1), LINE)
        background = RippleDrawable(ColorStateList.valueOf(if (filled) 0x22000000 else 0x22FFFFFF), shape, null)
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    /** Dims the camera preview and marks the square where the QR code should go. */
    private class ScanFrameView(context: Context) : View(context) {
        private val density = context.resources.displayMetrics.density
        private val dim = Paint().apply { color = 0x99000000.toInt() }
        private val corner = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 4 * density
            strokeCap = Paint.Cap.ROUND
        }
        private val hole = Path()
        private val box = RectF()

        override fun onDraw(canvas: Canvas) {
            val side = minOf(minOf(width, height) * 0.62f, 280 * density)
            val left = (width - side) / 2
            val top = (height - side) / 2
            box.set(left, top, left + side, top + side)
            val radius = 20 * density
            hole.reset()
            hole.fillType = Path.FillType.EVEN_ODD
            hole.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
            hole.addRoundRect(box, radius, radius, Path.Direction.CW)
            canvas.drawPath(hole, dim)

            val arm = side * 0.16f
            fun bracket(x: Float, y: Float, dx: Float, dy: Float) {
                val path = Path()
                path.moveTo(x, y + dy * arm)
                path.lineTo(x, y + dy * radius)
                path.quadTo(x, y, x + dx * radius, y)
                path.lineTo(x + dx * arm, y)
                canvas.drawPath(path, corner)
            }
            bracket(box.left, box.top, 1f, 1f)
            bracket(box.right, box.top, -1f, 1f)
            bracket(box.left, box.bottom, 1f, -1f)
            bracket(box.right, box.bottom, -1f, -1f)
        }
    }

    private companion object {
        const val CAMERA_REQUEST = 1
        val TEXT_MUTED = Color.rgb(168, 168, 168)
        val TEXT_HINT = Color.rgb(110, 110, 110)
        val SHEET_BG = Color.rgb(23, 23, 23)
        val INPUT_BG = Color.rgb(38, 38, 38)
        val BUTTON_DARK = Color.rgb(28, 28, 28)
        val LINE = Color.rgb(54, 54, 54)
        val ERROR_BG = 0xCC5A1D1D.toInt()
        val ERROR_TEXT = Color.rgb(255, 180, 171)
    }
}
