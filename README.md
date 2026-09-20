# Unity LiveWork

Chơi thử **Game View đang chạy trong Unity Editor** từ trình duyệt Android hoặc PC.
Video/audio dùng Unity Render Streaming + WebRTC; điều khiển Editor đi qua dịch vụ
Node.js độc lập nên trang web vẫn hoạt động khi Stop hoặc reload code.

**Bản preview 0.1.0 · Windows · Unity 6000.3.11f1 / 6000.2.7f2 · Tailscale / localhost.**

## Hỗ trợ hiện tại

| Tính năng | Trạng thái |
|---|---|
| Game View gồm UI, video và âm thanh | Có |
| Play / Stop / Pause / Resume / Next Frame | Có |
| Đổi resolution thực của Game View | Preset + nhập kích thước; hỗ trợ khi pause |
| Input System | Multi-touch, chuột, cuộn, bàn phím, pointer lock |
| Legacy Input | **Chỉ touch; chưa hỗ trợ keyboard, mouse hoặc axis** |
| Both | Input System + Legacy touch, giữ nguyên input module của game |
| Reconnect | Reload web, Stop/Play, scene change, compile/domain reload |
| Thiết bị | Chrome Android; Chrome/Edge PC |

Phạm vi Legacy được điều chỉnh sau kiểm chứng: `QueueGameViewInputEvent` và
`GameView.SendEvent` phát sự kiện OnGUI nhưng không thay đổi `Input.GetKey`,
`GetMouseButton` và `GetAxis`. **Không cần sửa code gameplay** cho các input được
hỗ trợ. Không có shim âm thầm thay `UnityEngine.Input`.

## Chạy project mẫu

1. Cài Unity **6000.3.11f1** (hoặc **6000.2.7f2**), Node.js **22 trở lên** và Tailscale trên host/client.
2. Chuẩn bị dịch vụ từ thư mục repo:

   ```powershell
   .\scripts\setup.ps1
   ```

3. Trong Unity Hub, thêm project `sample`, mở scene `Assets/LiveWorkDemo.unity`.
4. Mở **Window → LiveWork**, chọn **Enable LiveWork**. Package tự chạy dịch vụ
   Node ẩn nếu chưa có. Nếu service folder không tìm thấy, chọn thư mục `service`
   trong repo bằng **Choose service folder**.
5. Mở URL hiển thị trong cửa sổ LiveWork trên điện thoại/PC cùng tailnet, nhập mã
   ghép nối sáu chữ số và bấm **Play** trên web.
6. Chạm/click vào vùng game để điều khiển. **Sound on** bật âm thanh. Nút thu gọn
   thanh công cụ và **Fullscreen** dành thêm diện tích cho game.

Scene mẫu có cube quay, phím **D** để di chuyển, nút UI đếm click, số touch của
cả hai hệ input và một âm thử nhỏ. Dùng Pause/Next Frame để quan sát bộ đếm frame.

## Cài vào project Unity khác

Giữ repo này ở một đường dẫn cố định:

1. Unity Package Manager → **Install package from disk** → chọn
   `vendor/com.unity.renderstreaming/package.json`.
2. Cài tiếp `packages/com.livework.unity/package.json` theo cách tương tự.
3. Nếu project đã bật **Render Streaming → Automatic Streaming**, tắt tính năng
   đó trước khi bật LiveWork, để tránh hai phiên streaming chạy đồng thời.
4. Mở **Window → LiveWork**, chọn `service` nếu cần và bật LiveWork.

LiveWork không đổi Active Input Handling, scene hoặc input bindings của project.
Chọn **Input System** hoặc **Both** trong Player Settings nếu cần chuột/bàn phím
từ PC. Project chỉ dùng Legacy vẫn nhận touch từ điện thoại. Game cần có
AudioListener đang hoạt động để phát âm thanh qua stream.

Runtime objects của LiveWork được tạo tạm trong Play Mode, sống qua scene changes,
và bị hủy khi Stop/Disable. Khi Disable, lựa chọn Game View và run-in-background
trước phiên được khôi phục. Dịch vụ web tiếp tục sống độc lập; đóng bằng Ctrl+C
nếu chạy thủ công hoặc dừng đúng process Node đã khởi chạy dịch vụ.

## Tailscale và mạng

- Dịch vụ mặc định dùng TCP **8080**, chỉ chấp nhận nguồn localhost hoặc địa chỉ
  Tailscale. Cả HTTP và WebSocket đều kiểm tra nguồn; pairing áp dụng trước khi
  cho phép điều khiển/signaling. Một browser tab điều khiển tại một thời điểm.
- Máy có Tailscale sẽ được hiển thị URL `http://<tailscale-ip>:8080`. Nếu không có,
  URL localhost chỉ dùng được trên host.
- WebRTC truyền media/input trực tiếp qua ICE host candidates. Không cần STUN
  công khai hoặc TURN cho luồng tailnet này. ACL/firewall vẫn phải cho phép kết
  nối giữa hai thiết bị, gồm traffic UDP của Unity/WebRTC.
- Nếu Windows Firewall chặn, cho phép Node và Unity trên mạng phù hợp. Công cụ
  không tự sửa firewall, router, Tailscale ACL hoặc bật public internet.
- Không mở port này ra internet công khai: public hosting, TLS ngoài tailnet và
  TURN chưa thuộc bản đầu. Pointer lock/fullscreen phụ thuộc trình duyệt và secure
  context; có thể dùng HTTPS qua Tailscale Serve nếu trình duyệt yêu cầu.

Chạy dịch vụ thủ công:

```powershell
cd service
npm start
# Tùy chọn trước khi chạy: $env:LIVEWORK_PORT = '8081'
# Chỉ localhost: $env:LIVEWORK_BIND = '127.0.0.1'
```

Mã ghép nối đổi khi service restart. Cookie phiên có thời hạn 24 giờ; mất kết nối
sẽ nhả input, không phát lại lệnh điều khiển cũ. Thông tin host nằm trong
`service/.local/host.json` và được gitignore.

## Resolution và giới hạn

- Thay đổi **kích thước render của game**, không chỉ phóng to video. Kích thước
  chẵn 240–1920 mỗi cạnh, tối đa 2.073.600 pixel. Letterboxing không nhận touch mới.
- Giữ resolution Game View hiện tại khi bật. Video mặc định 30 FPS, cạnh dài tối
  đa 1280 và bitrate tối đa 8 Mbps; input luôn được quy đổi theo resolution game.
- Khi game pause, streaming/signaling vẫn chạy; Next Frame gọi một bước Editor.
  Unity quyết định số lần FixedUpdate bên trong bước đó.
- Giữ desktop host hoạt động và Game View mở. Chưa bảo đảm hoạt động khi host
  sleep, khóa Windows hoặc Unity minimize. Không dùng Unity `-batchmode` để stream.
- Chưa hỗ trợ iOS, gamepad, cảm biến, IME/bàn phím ảo, nhiều người điều khiển hoặc
  chạy nhiều Editor trên cùng một service.
- Game chạy trên host: không mô phỏng hiệu năng, native plugins hay hành vi bản
  build Android/iOS. Chỉ phiên bản Editor nêu trên được cho phép trong preview.

## Kiểm thử và cấu trúc

```powershell
cd service
npm test
```

Kiểm thử Unity/browser có hướng dẫn riêng tại [docs/TESTING.md](docs/TESTING.md).
Kết quả và giới hạn kiểm chứng thực tế tại [docs/VERIFICATION.md](docs/VERIFICATION.md).

- `packages/com.livework.unity`: UPM package, Editor bridge và input backend.
- `service`: Node server, giao diện web, signaling lấy từ upstream, kiểm thử.
- `sample`: Unity project mẫu và bộ kiểm chứng.
- `vendor`: Render Streaming cố định commit và bản vá có giải thích trong
  [vendor/UPSTREAM.md](vendor/UPSTREAM.md).

Render Streaming giữ nguyên Unity Companion License và third-party notices.
Phần mã upstream được tách riêng để đối chiếu khi nâng cấp.

