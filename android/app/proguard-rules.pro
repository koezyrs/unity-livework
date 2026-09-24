# The web page calls these methods through the LiveWorkApp JavaScript bridge.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
