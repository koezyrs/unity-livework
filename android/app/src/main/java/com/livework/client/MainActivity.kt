package com.livework.client

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
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
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
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
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

/**
 * Shows the LiveWork web client full screen in a WebView.
 * The first screen scans the QR code from the Unity LiveWork window; typing the address is the fallback.
 * `livework://open?url=...` links skip it.
 */
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var connectView: FrameLayout
    private lateinit var scanner: BarcodeView
    private lateinit var scanFrame: ScanFrameView
    private lateinit var scanActions: LinearLayout
    private lateinit var reconnectButton: TextView
    private lateinit var cameraNotice: LinearLayout
    private lateinit var cameraButton: TextView
    private lateinit var statusText: TextView
    private lateinit var addressSheet: LinearLayout
    private lateinit var addressInput: EditText
    private lateinit var addressError: TextView
    private var webView: WebView? = null
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var resumed = false
    private var cameraAsked = false
    private var scanning = false

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
        if (data.scheme != "livework") return false
        val url = addressFromLink(data.toString())
        if (url == null) showConnect("This link does not contain a valid LiveWork address.") else open(url)
        return true
    }

    // ---- Connect screen ----

    private fun buildConnectView(): FrameLayout {
        val layout = FrameLayout(this)
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT

        scanner = BarcodeView(this).apply {
            decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
        }
        layout.addView(scanner, FrameLayout.LayoutParams(match, match))
        scanFrame = ScanFrameView(this)
        layout.addView(scanFrame, FrameLayout.LayoutParams(match, match))

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(28), dp(24), 0)
        }
        header.addView(TextView(this).apply {
            text = "LiveWork"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            typeface = Typeface.DEFAULT_BOLD
        })
        header.addView(TextView(this).apply {
            text = "Scan the QR code in the LiveWork window in Unity"
            setTextColor(TEXT_MUTED)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        })
        layout.addView(header, FrameLayout.LayoutParams(match, wrap, Gravity.TOP))

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
        cameraButton = pillButton("Allow camera", filled = true) { askCamera() }
        cameraNotice.addView(cameraButton, LinearLayout.LayoutParams(wrap, wrap).apply { topMargin = dp(16) })
        layout.addView(cameraNotice, FrameLayout.LayoutParams(match, wrap, Gravity.CENTER))

        scanActions = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), 0, dp(24), dp(28))
        }
        statusText = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            background = rounded(ERROR_BG, dp(12).toFloat())
            setPadding(dp(14), dp(10), dp(14), dp(10))
            visibility = View.GONE
        }
        scanActions.addView(statusText, LinearLayout.LayoutParams(wrap, wrap).apply { bottomMargin = dp(16) })
        reconnectButton = pillButton("", filled = true) { prefs.getString("url", null)?.let { open(it) } }
        scanActions.addView(reconnectButton, LinearLayout.LayoutParams(wrap, wrap).apply { bottomMargin = dp(10) })
        scanActions.addView(pillButton("Enter address", filled = false) { showAddressSheet() }, LinearLayout.LayoutParams(wrap, wrap))
        layout.addView(scanActions, FrameLayout.LayoutParams(match, wrap, Gravity.BOTTOM))

        addressSheet = buildAddressSheet()
        layout.addView(addressSheet, FrameLayout.LayoutParams(match, wrap, Gravity.BOTTOM))
        return layout
    }

    private fun buildAddressSheet(): LinearLayout {
        val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
        val match = ViewGroup.LayoutParams.MATCH_PARENT
        val sheet = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply {
                setColor(SHEET_BG)
                val r = dp(24).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            isClickable = true
            visibility = View.GONE
        }
        sheet.addView(TextView(this).apply {
            text = "Enter address"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.DEFAULT_BOLD
        })
        sheet.addView(TextView(this).apply {
            text = "Use the address shown in the LiveWork window in Unity."
            setTextColor(TEXT_MUTED)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(4), 0, dp(16))
        })
        addressInput = EditText(this).apply {
            hint = "100.x.y.z:port"
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setTextColor(Color.WHITE)
            setHintTextColor(TEXT_HINT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = rounded(INPUT_BG, dp(14).toFloat())
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setOnEditorActionListener { _, action, _ ->
                if (action == EditorInfo.IME_ACTION_GO) {
                    connect()
                    true
                } else false
            }
        }
        sheet.addView(addressInput, LinearLayout.LayoutParams(match, wrap))
        addressError = TextView(this).apply {
            setTextColor(ERROR_TEXT)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(dp(4), dp(8), dp(4), 0)
            visibility = View.GONE
        }
        sheet.addView(addressError)
        sheet.addView(pillButton("Connect", filled = true) { connect() }, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(16) })
        sheet.addView(pillButton("Scan QR code", filled = false) { hideAddressSheet() }, LinearLayout.LayoutParams(match, wrap).apply { topMargin = dp(8) })
        return sheet
    }

    private fun showAddressSheet() {
        addressInput.setText(prefs.getString("url", ""))
        addressInput.setSelection(addressInput.text.length)
        addressError.visibility = View.GONE
        addressSheet.visibility = View.VISIBLE
        scanActions.visibility = View.GONE
        updateScanner()
        addressInput.requestFocus()
        keyboard().showSoftInput(addressInput, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun hideAddressSheet() {
        keyboard().hideSoftInputFromWindow(addressInput.windowToken, 0)
        addressSheet.visibility = View.GONE
        scanActions.visibility = View.VISIBLE
        updateScanner()
    }

    private fun connect() {
        val url = normalize(addressInput.text.toString())
        if (url == null) {
            addressError.text = "Enter an address such as 100.101.102.103:8080"
            addressError.visibility = View.VISIBLE
            return
        }
        open(url)
    }

    private fun onScanned(text: String) {
        if (!scanning) return
        val url = addressFromLink(text)
        if (url == null) {
            showStatus("This QR code is not a LiveWork address.")
            return
        }
        open(url)
    }

    private fun showStatus(message: String?) {
        statusText.text = message ?: ""
        statusText.visibility = if (message.isNullOrEmpty()) View.GONE else View.VISIBLE
    }

    private fun updateReconnect() {
        val saved = prefs.getString("url", null)
        reconnectButton.visibility = if (saved == null) View.GONE else View.VISIBLE
        if (saved != null) reconnectButton.text = "Reconnect to ${Uri.parse(saved).authority ?: saved}"
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

    /** Runs the camera only while the scan screen is on top and the app is in front. */
    private fun updateScanner() {
        val allowed = hasCamera()
        cameraNotice.visibility = if (allowed || addressSheet.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        scanFrame.visibility = if (allowed) View.VISIBLE else View.GONE
        val run = allowed && resumed && connectView.visibility == View.VISIBLE && addressSheet.visibility != View.VISIBLE
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
            // Without this, WebView draws a large gray play icon over a video that has not started yet.
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

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
        prefs.edit().putString("url", url).apply()
        keyboard().hideSoftInputFromWindow(addressInput.windowToken, 0)
        val view = webView ?: createWebView().also { webView = it }
        connectView.visibility = View.GONE
        updateScanner()
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
        addressSheet.visibility = View.GONE
        scanActions.visibility = View.VISIBLE
        showStatus(error)
        updateReconnect()
        setFullScreen(false)
        if (!hasCamera() && !cameraAsked) askCamera()
        updateScanner()
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
        if (hasFocus && webView?.visibility == View.VISIBLE) setFullScreen(true)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyDown(keyCode, event)
        when {
            customView != null -> webView?.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null)
            webView?.visibility == View.VISIBLE -> showConnect(null)
            addressSheet.visibility == View.VISIBLE -> hideAddressSheet()
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
        webView?.destroy()
        super.onDestroy()
    }

    // ---- Small view helpers ----

    private fun keyboard() = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

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
        minHeight = dp(48)
        setPadding(dp(24), dp(12), dp(24), dp(12))
        val shape = rounded(if (filled) Color.WHITE else OUTLINE_BG, dp(24).toFloat())
        if (!filled) shape.setStroke(dp(1), OUTLINE_STROKE)
        background = RippleDrawable(ColorStateList.valueOf(if (filled) 0x33000000 else 0x33FFFFFF), shape, null)
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
            val size = minOf(width, height) * 0.62f
            val side = minOf(size, 280 * density)
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
            val r = radius
            fun bracket(x: Float, y: Float, dx: Float, dy: Float) {
                val path = Path()
                path.moveTo(x, y + dy * arm)
                path.lineTo(x, y + dy * r)
                path.quadTo(x, y, x + dx * r, y)
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
        val TEXT_MUTED = Color.rgb(190, 190, 190)
        val TEXT_HINT = Color.rgb(120, 120, 120)
        val SHEET_BG = Color.rgb(22, 22, 22)
        val INPUT_BG = Color.rgb(38, 38, 38)
        val OUTLINE_BG = 0x66000000
        val OUTLINE_STROKE = 0x66FFFFFF
        val ERROR_BG = 0xCC5A1D1D.toInt()
        val ERROR_TEXT = Color.rgb(255, 180, 171)
    }
}
