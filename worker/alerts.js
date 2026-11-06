/**
 * แจ้งเตือนแผ่นดินไหวผ่าน LINE (broadcast) จาก Cloudflare Worker
 *
 * เงื่อนไขแจ้งเตือน (ปรับได้ด้วย vars ใน wrangler.jsonc):
 *   - เกิดในประเทศไทย และ M ≥ ALERT_MIN_MAG_TH (2.5)
 *   - M ≥ ALERT_MIN_MAG_NEAR (3.0) และห่างนิคมฯ ที่ใกล้ที่สุดไม่เกิน ALERT_NEAR_KM (300 กม.)
 *   - M ≥ ALERT_MIN_MAG_ANY (5.0) ที่ไหนก็ได้
 *
 * กันส่งซ้ำ: เก็บ Event_ID ที่ส่งสำเร็จไว้ใน KV ("alerts")
 * ส่งไม่สำเร็จ: ลองใหม่รอบถัดไป สูงสุด MAX_ATTEMPTS ครั้ง
 * ไม่ส่งเหตุการณ์เก่ากว่า MAX_AGE_H ชั่วโมง (กันส่งย้อนหลังตอนเปิดใช้ครั้งแรก)
 * ต้องตั้ง secret LINE_ACCESS_TOKEN ใน Cloudflare ก่อน ถ้ายังไม่ตั้ง จะไม่ส่งและไม่บันทึกว่าส่งแล้ว
 */

const K_ALERTS = "alerts";
const LINE_BROADCAST = "https://api.line.me/v2/bot/message/broadcast";
const DASHBOARD_URL = "https://tmd-earthquake.nawakonnakhonchai.workers.dev/";
const MAX_AGE_H = 6;
const MAX_ATTEMPTS = 5;
const KEEP_IDS = 3000;

const num = (v, d) => (v === undefined || v === null || v === "" || isNaN(+v) ? d : +v);

export function rules(env = {}) {
  return {
    th: num(env.ALERT_MIN_MAG_TH, 2.5),
    near: num(env.ALERT_MIN_MAG_NEAR, 3.0),
    nearKm: num(env.ALERT_NEAR_KM, 300),
    any: num(env.ALERT_MIN_MAG_ANY, 5.0),
  };
}

// ---------- geo ----------
export function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, r = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearest(f, estates) {
  const [lon, lat] = f.geometry.coordinates;
  let best = null;
  for (const e of estates) {
    const d = distKm(lat, lon, e.lat, e.lon);
    if (!best || d < best.d) best = { name: e.name, d };
  }
  return best;
}

export const isThai = loc => /จ\.|ประเทศไทย|Thailand/.test(loc || "");

/** ตัดสินว่าเหตุการณ์นี้ต้องแจ้งไหม คืนเหตุผล หรือ null */
export function shouldAlert(f, estates, R) {
  const p = f.properties, m = +p.Magnitude || 0;
  const nb = estates.length ? nearest(f, estates) : null;
  if (isThai(p.Location) && m >= R.th) return { why: "th", nb };
  if (nb && m >= R.near && nb.d <= R.nearKm) return { why: "near", nb };
  if (m >= R.any) return { why: "any", nb };
  return null;
}

// ---------- message ----------
function level(m) {
  if (m >= 6.0) return { label: "รุนแรงมาก", color: "#B42318" };
  if (m >= 5.0) return { label: "รุนแรง", color: "#C2410C" };
  if (m >= 4.0) return { label: "ปานกลาง", color: "#B45309" };
  return { label: "เล็กน้อย", color: "#3F3F46" };
}

const fmtKm = d => (d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString("en-US"));
const splitLoc = loc => { const m = (loc || "").match(/^(.*?)\s*\((.*)\)\s*$/); return m ? { th: m[1], en: m[2] } : { th: loc || "-", en: "" }; };

const row = (label, value) => ({
  type: "box", layout: "baseline", spacing: "md",
  contents: [
    { type: "text", text: label, size: "sm", color: "#8A8A93", flex: 3 },
    { type: "text", text: value, size: "sm", color: "#0E0E11", flex: 7, wrap: true },
  ],
});

export function buildMessage(f, info) {
  const p = f.properties, m = +p.Magnitude || 0;
  const [lon, lat] = f.geometry.coordinates;
  const lv = level(m), loc = splitLoc(p.Location);
  const why = { th: "เกิดในประเทศไทย", near: "ใกล้นิคมอุตสาหกรรม", any: "ขนาดใหญ่" }[info.why];
  const rows = [
    row("ความลึก", `${p.Depth_km} กม.`),
    row("เวลา", `${p.Time_TH} น.`),
  ];
  if (p.Comments) rows.push(row("ตำแหน่ง", p.Comments));
  const showNb = info.nb && info.nb.d <= 1000; // ไกลเกิน 1,000 กม. ไม่ต้องบอกนิคมฯ
  if (showNb) rows.push(row("นิคมฯ ใกล้สุด", `${info.nb.name} ~${fmtKm(info.nb.d)} กม.`));

  const alt = `แผ่นดินไหว M ${m.toFixed(1)} ${loc.th} เวลา ${p.Time_TH} น.` +
    (showNb ? ` ห่างนิคมฯ ${info.nb.name} ~${fmtKm(info.nb.d)} กม.` : "");

  return {
    type: "flex",
    altText: alt.slice(0, 400),
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: lv.color, paddingAll: "16px",
        contents: [
          { type: "text", text: `แผ่นดินไหว · ${lv.label} · ${why}`, size: "xs", color: "#FFFFFFCC", wrap: true },
          {
            type: "box", layout: "baseline", spacing: "sm", margin: "sm",
            contents: [
              { type: "text", text: `M ${m.toFixed(1)}`, size: "3xl", weight: "bold", color: "#FFFFFF", flex: 0 },
              { type: "text", text: "แมกนิจูด", size: "sm", color: "#FFFFFFCC", flex: 0 },
            ],
          },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "md", paddingAll: "16px",
        contents: [
          { type: "text", text: loc.th, weight: "bold", size: "lg", wrap: true, color: "#0E0E11" },
          ...(loc.en ? [{ type: "text", text: loc.en, size: "xs", color: "#8A8A93", wrap: true }] : []),
          { type: "separator", margin: "md" },
          { type: "box", layout: "vertical", spacing: "sm", margin: "md", contents: rows },
          { type: "text", text: "ข้อมูลเบื้องต้นจากกรมอุตุนิยมวิทยา อาจมีการปรับปรุงภายหลัง", size: "xxs", color: "#8A8A93", wrap: true, margin: "lg" },
        ],
      },
      footer: {
        type: "box", layout: "horizontal", spacing: "sm", paddingAll: "12px",
        contents: [
          { type: "button", style: "primary", color: "#0E0E11", height: "sm", action: { type: "uri", label: "ดู Dashboard", uri: DASHBOARD_URL } },
          { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "แผนที่", uri: `https://www.google.com/maps?q=${lat},${lon}` } },
        ],
      },
    },
  };
}

// ---------- state ----------
async function loadState(env) {
  const raw = await env.EQ.get(K_ALERTS);
  return raw ? JSON.parse(raw) : null;
}

async function saveState(env, st) {
  st.sent = st.sent.slice(-KEEP_IDS);
  await env.EQ.put(K_ALERTS, JSON.stringify(st));
}

async function loadEstates(env) {
  try {
    const r = await env.ASSETS.fetch(new Request("https://assets.local/ieat_estates.geojson"));
    if (!r.ok) return [];
    const gj = await r.json();
    return (gj.features || []).map(f => ({ name: f.properties.Name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  } catch (e) {
    return [];
  }
}

const ageH = f => {
  const t = Date.parse((f.properties.Time_UTC || "").replace(" UTC", "Z").replace(" ", "T"));
  return isNaN(t) ? Infinity : (Date.now() - t) / 3600e3;
};

/**
 * เรียกหลังรวมข้อมูลเสร็จทุกรอบ
 * history: รายการเหตุการณ์ทั้งหมด (ใหม่สุดก่อน)
 */
export async function processAlerts(env, history, { send = true } = {}) {
  const R = rules(env);
  let st = await loadState(env);
  if (!st) {
    // เปิดใช้ครั้งแรก: นับทุกเหตุการณ์ที่มีอยู่ว่าส่งแล้ว เพื่อไม่ให้ส่งย้อนหลังรัวๆ
    st = { sent: history.map(f => f.properties.Event_ID), attempts: {}, log: [], since: new Date().toISOString() };
    await saveState(env, st);
    return { initialized: true, sent: 0 };
  }
  const sentSet = new Set(st.sent);
  const estates = await loadEstates(env);
  const due = [];
  for (const f of history) {
    if (ageH(f) > MAX_AGE_H) break; // history เรียงใหม่→เก่า
    const id = f.properties.Event_ID;
    if (sentSet.has(id) || (st.attempts[id] || 0) >= MAX_ATTEMPTS) continue;
    const info = shouldAlert(f, estates, R);
    if (info) due.push({ f, info });
  }
  if (!due.length) return { sent: 0 };

  const token = env.LINE_ACCESS_TOKEN;
  if (!send || !token) {
    st.lastNote = token ? "dry-run" : "ยังไม่ได้ตั้ง LINE_ACCESS_TOKEN";
    await saveState(env, st);
    return { sent: 0, pending: due.length, note: st.lastNote };
  }

  let ok = 0;
  // ส่งจากเก่าไปใหม่ ครั้งละไม่เกิน 5 รายการต่อรอบ
  for (const { f, info } of due.reverse().slice(0, 5)) {
    const id = f.properties.Event_ID;
    let status = 0, err = null;
    try {
      const r = await fetch(env.LINE_API_URL || LINE_BROADCAST, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [buildMessage(f, info)] }),
        signal: AbortSignal.timeout(15000),
      });
      status = r.status;
      if (!r.ok) err = (await r.text()).slice(0, 300);
    } catch (e) {
      err = String(e.message || e);
    }
    if (status === 200) {
      st.sent.push(id); delete st.attempts[id]; ok++;
    } else {
      st.attempts[id] = (st.attempts[id] || 0) + 1;
    }
    st.log.unshift({ at: new Date().toISOString(), id, mag: f.properties.Magnitude, why: info.why, status, err });
  }
  st.log = st.log.slice(0, 30);
  st.lastNote = null;
  await saveState(env, st);
  return { sent: ok, tried: Math.min(due.length, 5) };
}

/** สำหรับหน้า /alerts.json: เหตุการณ์ล่าสุดที่เข้าเงื่อนไข (ไม่ส่งข้อความ) */
export async function alertPreview(env, history) {
  const R = rules(env);
  const estates = await loadEstates(env);
  const st = (await loadState(env)) || { sent: [], attempts: {}, log: [] };
  const sent = new Set(st.sent);
  const matches = [];
  for (const f of history.slice(0, 300)) {
    const info = shouldAlert(f, estates, R);
    if (!info) continue;
    matches.push({
      id: f.properties.Event_ID, time_th: f.properties.Time_TH, mag: f.properties.Magnitude,
      location: f.properties.Location, why: info.why,
      nearest_estate: info.nb ? { name: info.nb.name, km: Math.round(info.nb.d) } : null,
      state: sent.has(f.properties.Event_ID) ? "sent-or-skipped"
        : ageH(f) > MAX_AGE_H ? "too-old"
        : st.attempts[f.properties.Event_ID] ? `failed x${st.attempts[f.properties.Event_ID]}` : "pending",
    });
    if (matches.length >= 20) break;
  }
  return {
    rules: { thailand_min_mag: R.th, near_estate_min_mag: R.near, near_estate_km: R.nearKm, anywhere_min_mag: R.any, max_age_hours: MAX_AGE_H },
    token_configured: !!env.LINE_ACCESS_TOKEN,
    enabled_since: st.since || null,
    note: st.lastNote || null,
    recent_sends: (st.log || []).slice(0, 10).map(({ err, ...x }) => ({ ...x, error: err ? "send failed" : null })),
    recent_matches: matches,
  };
}
