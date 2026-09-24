# Third Party Notices

Unity LiveWork includes or uses the following third-party components.
Each component keeps its own license.

## Unity Render Streaming

- Location: `ThirdParty/RenderStreaming`, `Service~/public/upstream`, `Service~/generated`
- Source: https://github.com/Unity-Technologies/UnityRenderStreaming
  (revision `d4e8dc834f67cb4de920e3168b9db50141693052`)
- Copyright © 2022 Unity Technologies ApS
- License: [Unity Companion License](http://www.unity3d.com/legal/licenses/Unity_Companion_License).
  See `ThirdParty/RenderStreaming/LICENSE.md` and `ThirdParty/RenderStreaming/NOTICE.txt`.
- LiveWork applies small compatibility patches. The list of patches is in
  `vendor/UPSTREAM.md` in the source repository.

## QR Code Generator for .NET

- Location: `Editor/ThirdParty/QrCodeGenerator`
- Source: https://github.com/manuelbl/QrCodeGenerator
- Copyright (c) 2018 Manuel Bleichenbacher
- License: MIT. See `Editor/ThirdParty/QrCodeGenerator/LICENSE.txt`.

## ws

- Installed by npm when the LiveWork service starts for the first time.
- Source: https://github.com/websockets/ws
- License: MIT.

## LiveWork Android app

The Android app is built from the `android` folder of the source repository.
It is not part of this Unity package. It uses:

- [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded), Apache License 2.0.
- [ZXing](https://github.com/zxing/zxing), Apache License 2.0.
