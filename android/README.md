# LiveWork Android app

A small Android app that opens the LiveWork web client full screen in a WebView.
It uses the same pairing, controls, video, and input as Chrome.

- The home screen has two buttons: **Scan QR code** opens the camera to scan the
  QR code in the Unity LiveWork window, and **Enter address manually** opens a
  dialog to type the address.
- Shows a loading screen while it connects, and opens the game view directly.
- Full screen without browser bars; swipe from the edge to show system bars.
- Keeps the screen on while the app is open.
- Remembers the last server address.
- Reads both values of **Connection Mode** in the Unity LiveWork window: **Web**
  (a plain address) and **Android** (a `livework://open?url=<encoded address>` link,
  which also opens the app from the phone's camera app).
- Allows plain HTTP, because LiveWork runs on a private Tailscale network.
- Back leaves fullscreen first, then returns to the home screen.

Requires Android 8.0 (API 26) or newer, and Tailscale on the phone.

## Build

Requirements: Android SDK with platform 36, and JDK 17 or newer
(the JDK bundled with Android Studio works).

1. Create `local.properties` with the SDK path, for example:

   ```text
   sdk.dir=C\:/Users/<you>/AppData/Local/Android/Sdk
   ```

2. Build the debug APK:

   ```powershell
   $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
   .\gradlew.bat assembleDebug
   ```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Install it with
`adb install -r app/build/outputs/apk/debug/app-debug.apk`, or copy it to the phone.

## Test on an emulator

The emulator reaches the host at `10.0.2.2`. Start LiveWork in Unity, then enter
`http://10.0.2.2:<port>` in the app, where `<port>` is the port shown in Unity.
The service accepts this connection because the emulator connects from the host's
loopback address. To test a deep link:

```powershell
adb shell am start -a android.intent.action.VIEW -d "livework://open?url=http%3A%2F%2F10.0.2.2%3A<port>"
```

An emulator checks features only. Measure lag on a real phone over Tailscale.
