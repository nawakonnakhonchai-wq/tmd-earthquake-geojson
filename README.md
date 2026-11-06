# tmd-earthquake-geojson

Dashboard แผ่นดินไหวจากกรมอุตุนิยมวิทยา: https://tmd-earthquake.nawakonnakhonchai.workers.dev/

| ไฟล์ | หน้าที่ |
|---|---|
| `worker/index.js` | Cloudflare Worker: ดึง RSS กรมอุตุฯ ทุก 5 นาที เก็บประวัติใน KV และเสิร์ฟข้อมูล |
| `wrangler.jsonc` | ตั้งค่า Worker (cron, KV `tmd-earthquake`, static assets) |
| `public/index.html` | หน้า dashboard |
| `index.html` | หน้า redirect จาก GitHub Pages ไปยัง Worker |
| `update_earthquake.py` + workflow | ตัวดึงข้อมูลเดิม (เหลือไว้รันด้วยมือเพื่อสำรอง) |

ข้อมูลจาก Worker
- `/earthquake_history.geojson` ประวัติสะสม (ตั้งแต่ 23 พ.ค. 2569)
- `/earthquake_latest.geojson` 10 รายการล่าสุดจาก feed
- `/status.json` เวลาตรวจ feed ล่าสุด และสถานะ

Push ขึ้น `main` แล้ว Cloudflare จะ deploy Worker ใหม่ให้อัตโนมัติ
