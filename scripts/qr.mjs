import os from "node:os";
import qrcode from "qrcode";

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const ip = getLocalIp();
const port = 3001;
const url = `http://${ip}:${port}`;

console.log("\n========================================================");
console.log(`📱 Mobile Dev Server URL: ${url}`);
console.log("   (Make sure your phone is connected to the same Wi-Fi)");
console.log("========================================================\n");

qrcode.toString(url, { type: "terminal", small: true }, (err, qrStr) => {
  if (err) {
    console.error("Failed to generate QR code:", err);
    return;
  }
  console.log(qrStr);
  console.log("👉 Point your phone camera at the QR code above to open!\n");
});
