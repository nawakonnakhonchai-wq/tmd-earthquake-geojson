/**
 * TMD Earthquake Worker
 * - ทุก 5 นาที (Cron Trigger): ดึง RSS กรมอุตุนิยมวิทยา แปลงเป็น GeoJSON
 *   แล้วรวมเข้าประวัติสะสมใน KV (กันรายการซ้ำด้วยเวลา UTC + พิกัด)
 * - ให้บริการไฟล์ข้อมูล:
 *     /earthquake_latest.geojson   10 รายการล่าสุดจาก feed
 *     /earthquake_history.geojson  ประวัติสะสม
 *     /status.json                 เวลาตรวจ feed ล่าสุด / เวลาข้อมูลเปลี่ยนล่าสุด
 * - หน้า dashboard (public/index.html) เสิร์ฟจาก Static Assets
 */

import { processAlerts, alertPreview } from "./alerts.js";

const RSS_URL = "https://earthquake.tmd.go.th/feed/rss_tmd.xml";
// ใช้ตั้งต้นประวัติครั้งแรก (ข้อมูลที่บอต GitHub Actions เก็บไว้ตั้งแต่ พ.ค. 2569)
const SEED_URL = "https://raw.githubusercontent.com/nawakonnakhonchai-wq/tmd-earthquake-geojson/main/earthquake_history.geojson";

const K_HISTORY = "history";
const K_LATEST = "latest";
const K_STATUS = "status";

// ---------- RSS → GeoJSON ----------
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
  .trim();

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : null;
}

function utcToThai(timeUtc) {
  // "2026-11-06 04:46:03 UTC" → "2026-11-06 11:46:03"
  const m = timeUtc.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 7 * 3600e3);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function eventKey(f) {
  const [lon, lat] = f.geometry.coordinates;
  return `${f.properties.Time_UTC || ""}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
}

export function parseRss(xml) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];
  for (const it of items) {
    let lat = parseFloat(tag(it, "geo:lat") ?? tag(it, "lat"));
    let lon = parseFloat(tag(it, "geo:long") ?? tag(it, "long"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const desc = tag(it, "description") || "";
      const la = desc.match(/Lat\.\s*([+-]?\d+\.\d+)/i), lo = desc.match(/Long\.\s*([+-]?\d+\.\d+)/i);
      if (!la || !lo) continue;
      lat = parseFloat(la[1]); lon = parseFloat(lo[1]);
    }
    const timeUtc = tag(it, "tmd:time") || tag(it, "time") || "";
    const f = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        Location: tag(it, "title") || "ไม่ระบุสถานที่",
        Magnitude: parseFloat(tag(it, "tmd:magnitude") ?? tag(it, "magnitude")) || 0,
        Depth_km: parseFloat(tag(it, "tmd:depth") ?? tag(it, "depth")) || 0,
        Time_UTC: timeUtc,
        Time_TH: timeUtc ? utcToThai(timeUtc) : null,
        Comments: tag(it, "comments") || "",
      },
    };
    f.properties.Event_ID = eventKey(f);
    out.push(f);
  }
  return out;
}

/**
 * รวม feed เข้าประวัติ (ตรรกะเดียวกับ update_earthquake.py)
 * - เหตุการณ์ใหม่: เพิ่ม / เหตุการณ์เดิม: อัปเดตค่าล่าสุด
 * - รายการในประวัติที่อยู่ในช่วงเวลาของ feed แต่หายไปจาก feed = กรมอุตุฯ แก้ไข/ยกเลิก จึงลบออก
 */
export function mergeHistory(history, feed) {
  const feedMap = new Map(feed.map(f => [eventKey(f), f]));
  const times = feed.map(f => f.properties.Time_UTC).filter(Boolean).sort();
  const oldest = times[0];
  const merged = new Map();
  for (const f of history) {
    const k = eventKey(f);
    if (oldest && (f.properties.Time_UTC || "") >= oldest && !feedMap.has(k)) continue;
    f.properties.Event_ID ??= k;
    merged.set(k, f);
  }
  for (const [k, f] of feedMap) merged.set(k, f);
  return [...merged.values()].sort((a, b) =>
    (b.properties.Time_UTC || "").localeCompare(a.properties.Time_UTC || ""));
}

// 1 เหตุการณ์ต่อบรรทัด (รูปแบบเดียวกับไฟล์ใน repo)
const toGeoJson = features =>
  '{"type":"FeatureCollection","features":[\n' + features.map(f => JSON.stringify(f)).join(",\n") + "\n]}\n";

// ---------- update job ----------
async function loadHistory(env) {
  const raw = await env.EQ.get(K_HISTORY);
  if (raw) return { features: JSON.parse(raw).features, seeded: false };
  const r = await fetch(env.SEED_URL || SEED_URL, { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`seed fetch failed: ${r.status}`);
  return { features: (await r.json()).features || [], seeded: true };
}

export async function runUpdate(env) {
  const now = new Date().toISOString();
  const status = JSON.parse((await env.EQ.get(K_STATUS)) || "{}");
  status.lastCheck = now;
  try {
    const r = await fetch(env.RSS_URL || RSS_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EMCC-earthquake-monitor/1.0)", Accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20000),
      cf: { cacheTtl: 0 },
    });
    if (!r.ok) throw new Error(`TMD RSS HTTP ${r.status}`);
    const feed = parseRss(await r.text());
    if (!feed.length) throw new Error("RSS มีข้อมูล 0 รายการ");

    const { features: hist, seeded } = await loadHistory(env);
    const before = JSON.stringify(hist);
    const merged = mergeHistory(hist, feed);
    const changed = seeded || JSON.stringify(merged) !== before;

    if (changed) {
      await env.EQ.put(K_HISTORY, toGeoJson(merged));
      await env.EQ.put(K_LATEST, JSON.stringify({ type: "FeatureCollection", features: feed }, null, 1));
      status.lastChange = now;
    }
    // แจ้งเตือน LINE (ถ้าผิดพลาดไม่กระทบการเก็บข้อมูล)
    try {
      const a = await processAlerts(env, merged);
      status.alerts = { at: now, ...a };
    } catch (e) {
      status.alerts = { at: now, error: "alert step failed" };
      console.error("alerts", e);
    }
    status.ok = true;
    status.error = null;
    status.count = merged.length;
    status.newest = merged[0]?.properties.Time_TH || null;
    status.oldest = merged[merged.length - 1]?.properties.Time_TH || null;
    if (!status.lastChange) status.lastChange = now;
    await env.EQ.put(K_STATUS, JSON.stringify(status));
    return { changed, count: merged.length };
  } catch (err) {
    status.ok = false;
    status.error = String(err.message || err);
    status.lastError = now;
    await env.EQ.put(K_STATUS, JSON.stringify(status));
    throw err;
  }
}

// ---------- HTTP ----------
const CORS = { "Access-Control-Allow-Origin": "*" };

function dataResponse(body, type) {
  return new Response(body, {
    headers: { ...CORS, "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=60" },
  });
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runUpdate(env));
  },

  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });

    const routes = {
      "/earthquake_history.geojson": [K_HISTORY, "application/geo+json"],
      "/earthquake_latest.geojson": [K_LATEST, "application/geo+json"],
      "/status.json": [K_STATUS, "application/json"],
    };
    if (pathname === "/alerts.json") {
      const raw = await env.EQ.get(K_HISTORY);
      const hist = raw ? JSON.parse(raw).features : [];
      return new Response(JSON.stringify(await alertPreview(env, hist), null, 1), {
        headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const route = routes[pathname];
    if (route) {
      let body = await env.EQ.get(route[0]);
      if (body === null) {
        // ยังไม่เคยรัน cron (เพิ่ง deploy) → ดึงข้อมูลครั้งแรกตอนนี้เลย
        try { await runUpdate(env); } catch (e) { /* status บันทึก error ไว้แล้ว */ }
        body = await env.EQ.get(route[0]);
      }
      if (body === null) return new Response("data not ready", { status: 503, headers: CORS });
      return dataResponse(body, route[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
