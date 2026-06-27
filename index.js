import { Telegraf, Markup } from "telegraf";
import mongoose from "mongoose";
import Anthropic from "@anthropic-ai/sdk";
import http from "http";
import https from "https";

/* ─── 1. CONFIG ─────────────────────────────────────────── */
const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const MONGO_URI = process.env.MONGO_URI || "";
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "0960336138";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_AUTO_APPROVE = (process.env.AI_AUTO_APPROVE || "true") === "true";
const TARGET_KG_DEFAULT = Number(process.env.TARGET_KG_DEFAULT) || 5000;
const CHANNEL_ID = (process.env.CHANNEL_ID || "").trim();
const GROUP_ID = (process.env.GROUP_ID || "").trim();
/* ቻናሉ ተጠቃሚዎች ከምዝገባ በኋላ ይጋበዛሉ */
const MEMBER_CHANNEL = (process.env.MEMBER_CHANNEL || "abrenenguaz").trim();

let REG_PER_KG = 5;
let SHIP_PER_KG = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN እና MONGO_URI ያስፈልጋሉ");
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_KEY })
  : null;

/* ─── 2. የቡድን ግዥ ምርቶች ──────────────────────────────────── */
const GB_PRODUCTS = [
  { id: "teff",   emoji: "🌾", label: "ጤፍ",    unit: "kg",    targetKg: Number(process.env.GB_TEFF_KG)  || 5000, pricePerKg: Number(process.env.GB_TEFF_PRICE)  || 75  },
  { id: "oil",    emoji: "🛢",  label: "ዘይት",   unit: "liter", targetKg: Number(process.env.GB_OIL_KG)   || 3000, pricePerKg: Number(process.env.GB_OIL_PRICE)   || 120 },
  { id: "sugar",  emoji: "🍚", label: "ስኳር",   unit: "kg",    targetKg: Number(process.env.GB_SUGAR_KG) || 3000, pricePerKg: Number(process.env.GB_SUGAR_PRICE) || 55  },
  { id: "flour",  emoji: "🌽", label: "ዱቄት",   unit: "kg",    targetKg: Number(process.env.GB_FLOUR_KG) || 3000, pricePerKg: Number(process.env.GB_FLOUR_PRICE) || 60  },
  { id: "onion",  emoji: "🧅", label: "ሽንኩርት", unit: "kg",    targetKg: Number(process.env.GB_ONION_KG) || 2000, pricePerKg: Number(process.env.GB_ONION_PRICE) || 30  },
];
const byProduct = (id) => GB_PRODUCTS.find((p) => p.id === id);
const unitLabel = (p) => (p?.unit === "liter" ? "ሊትር" : "ኪሎ");

/* ─── ምናሌ ቁልፎች ────────────────────────────────────────── */
const MENU_SETTINGS = [
  { key: "menu_cargo_toamhara", emoji: "🔼", label: "አዲስ አበባ → አማራ ክልል (ጭነት)" },
  { key: "menu_cargo_toaa",    emoji: "🔽", label: "አማራ ክልል → አዲስ አበባ (ጭነት)" },
  { key: "menu_my_regs",       emoji: "📋", label: "የምዝገባ ዝርዝሬ" },
  { key: "menu_counter",       emoji: "📊", label: "የጭነት ቆጣሪ" },
  ...GB_PRODUCTS.map((p) => ({ key: `menu_product_${p.id}`, emoji: p.emoji, label: p.label })),
];

/* ─── 3. ROUTES / METHODS ───────────────────────────────── */
const ROUTES_TO_AMHARA = [
  { id: "aa_finotselam",   emoji: "🟢", label: "አዲስ አበባ → ፍኖተሰላም",   targetKg: TARGET_KG_DEFAULT },
  { id: "aa_debre_markos", emoji: "🔵", label: "አዲስ አበባ → ደብረ ማርቆስ", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_mota",         emoji: "🟤", label: "አዲስ አበባ → ሞጣ",         targetKg: TARGET_KG_DEFAULT },
  { id: "aa_bahirdar",     emoji: "🔵", label: "አዲስ አበባ → ባህር ዳር",     targetKg: TARGET_KG_DEFAULT },
  { id: "aa_gondar",       emoji: "🟣", label: "አዲስ አበባ → ጎንደር",       targetKg: TARGET_KG_DEFAULT },
  { id: "aa_debre_berhan", emoji: "🟡", label: "አዲስ አበባ → ደብረ ብርሃን", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_kemissie",     emoji: "🟠", label: "አዲስ አበባ → ከሚሴ",       targetKg: TARGET_KG_DEFAULT },
  { id: "aa_dessie",       emoji: "🔴", label: "አዲስ አበባ → ደሴ",         targetKg: TARGET_KG_DEFAULT },
];
const ROUTES_TO_AA = [
  { id: "finotselam_aa",   emoji: "🟢", label: "ፍኖተሰላም → አዲስ አበባ",   targetKg: TARGET_KG_DEFAULT },
  { id: "debre_markos_aa", emoji: "🔵", label: "ደብረ ማርቆስ → አዲስ አበባ", targetKg: TARGET_KG_DEFAULT },
  { id: "mota_aa",         emoji: "🟤", label: "ሞጣ → አዲስ አበባ",         targetKg: TARGET_KG_DEFAULT },
  { id: "bahirdar_aa",     emoji: "🔵", label: "ባህር ዳር → አዲስ አበባ",     targetKg: TARGET_KG_DEFAULT },
  { id: "gondar_aa",       emoji: "🟣", label: "ጎንደር → አዲስ አበባ",       targetKg: TARGET_KG_DEFAULT },
  { id: "debre_berhan_aa", emoji: "🟡", label: "ደብረ ብርሃን → አዲስ አበባ", targetKg: TARGET_KG_DEFAULT },
  { id: "kemissie_aa",     emoji: "🟠", label: "ከሚሴ → አዲስ አበባ",       targetKg: TARGET_KG_DEFAULT },
  { id: "dessie_aa",       emoji: "🔴", label: "ደሴ → አዲስ አበባ",         targetKg: TARGET_KG_DEFAULT },
];
const ROUTES = [...ROUTES_TO_AMHARA, ...ROUTES_TO_AA];

const METHODS = [
  { id: "telebirr", emoji: "📱", label: "ቴሌብር",  info: process.env.TELEBIRR_INFO || "Telebirr: 0960336138" },
  { id: "cbe",      emoji: "🏦", label: "CBE ባንክ", info: process.env.CBE_INFO     || "CBE: 1000370308447"   },
];

const byRoute  = (id) => ROUTES.find((r) => r.id === id);
const byMethod = (id) => METHODS.find((m) => m.id === id);
const ACTIVE   = ["pending", "reviewing", "approved"];

/* ─── 4. DB MODELS ──────────────────────────────────────── */
const Reg = mongoose.model(
  "Reg",
  new mongoose.Schema({
    userId:          { type: Number, required: true },
    username:        { type: String, default: "" },
    fullName:        String,
    phone:           String,
    neighborhood:    { type: String, default: "" },
    phoneUnverified: { type: Boolean, default: false },
    routeId:         String,
    cargoDesc:       String,
    weightKg:        { type: Number, default: 0 },
    totalPrice:      { type: Number, default: 0 },
    paymentMethod:   { type: String, default: null },
    paymentFileId:   { type: String, default: null },
    locationLat:     { type: Number, default: null },
    locationLng:     { type: Number, default: null },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "reviewing", "approved", "rejected", "sent"],
    },
    aiVerdict:    { type: mongoose.Schema.Types.Mixed, default: null },
    autoApproved: { type: Boolean, default: false },
    createdAt:    { type: Date, default: Date.now },
  }),
);

const GBReg = mongoose.model(
  "GBReg",
  new mongoose.Schema({
    userId:          { type: Number, required: true },
    username:        { type: String, default: "" },
    productId:       { type: String, required: true },
    fullName:        String,
    phone:           String,
    neighborhood:    { type: String, default: "" },
    phoneUnverified: { type: Boolean, default: false },
    weightKg:        { type: Number, default: 0 },
    totalCost:       { type: Number, default: 0 },
    pricePerKg:      { type: Number, default: 0 },
    paymentFileId:   { type: String, default: null },
    paymentStatus:   { type: String, default: "pending", enum: ["pending", "reviewing", "approved"] },
    aiVerdict:       { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt:       { type: Date, default: Date.now },
  }),
);

const Session = mongoose.model(
  "Session",
  new mongoose.Schema({
    key:  { type: String, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 * 3 } },
  }),
);

const RouteCap = mongoose.model(
  "RouteCap",
  new mongoose.Schema({
    routeId:  { type: String, unique: true },
    notified: { type: Boolean, default: false },
  }),
);

const GBProductCap = mongoose.model(
  "GBProductCap",
  new mongoose.Schema({
    productId: { type: String, unique: true },
    notified:  { type: Boolean, default: false },
  }),
);

const BotSettings = mongoose.model(
  "BotSettings",
  new mongoose.Schema({
    key:   { type: String, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
  }),
);

async function getSetting(key, defaultVal) {
  const doc = await BotSettings.findOne({ key }).lean();
  return doc ? doc.value : defaultVal;
}
async function setSetting(key, value) {
  await BotSettings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function loadPricesFromDB() {
  for (const prod of GB_PRODUCTS) {
    const saved = await getSetting(`price_${prod.id}`, null);
    if (saved !== null && saved > 0) prod.pricePerKg = saved;
  }
  const savedReg  = await getSetting("fee_reg_per_kg",  null);
  if (savedReg  !== null && savedReg  > 0) REG_PER_KG  = savedReg;
  const savedShip = await getSetting("fee_ship_per_kg", null);
  if (savedShip !== null && savedShip > 0) SHIP_PER_KG = savedShip;
}

/* ─── 5. SESSION ────────────────────────────────────────── */
async function getSession(key) {
  try { const d = await Session.findOne({ key }).lean(); return d?.data || {}; }
  catch { return {}; }
}
async function saveSession(key, data) {
  try { await Session.findOneAndUpdate({ key }, { data, updatedAt: new Date() }, { upsert: true }); }
  catch {}
}
function sessionMW(ctx, next) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`;
  return getSession(key).then((data) => {
    ctx.session = data;
    return next().then(() => saveSession(key, ctx.session));
  });
}

/* ─── 6. SECURITY ───────────────────────────────────────── */
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
function isValidObjectId(id) {
  return typeof id === "string" && OBJECT_ID_RE.test(id);
}

function sanitize(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[`*_[\]()~>#+=|{}.!\\-]/g, (c) => "\\" + c)
    .slice(0, 500);
}

const rateLimitMap = new Map();
const blocklist    = new Set();
const failedAttempts = new Map();

function isRateLimited(userId, limit = 20) {
  if (blocklist.has(userId)) return true;
  const now = Date.now();
  const e = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000, violations: 0 };
  if (now > e.reset) { e.count = 0; e.reset = now + 60_000; }
  e.count++;
  rateLimitMap.set(userId, e);
  if (e.count > limit) {
    e.violations = (e.violations || 0) + 1;
    if (e.violations >= 3) {
      blocklist.add(userId);
      setTimeout(() => blocklist.delete(userId), 10 * 60_000);
    }
    return true;
  }
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) if (now > v.reset) rateLimitMap.delete(k);
}, 5 * 60_000);

function isSuspicious(text) {
  if (typeof text !== "string") return false;
  if (text.length > 1000) return true;
  const patterns = [
    /\$where/i, /\$ne/i, /\$gt/i, /\$lt/i, /\$or/i, /\$and/i, /\$regex/i,
    /<script/i, /javascript:/i, /vbscript:/i, /data:/i,
    /\.\.\//,   /\/etc\/passwd/i, /\/proc\//i,
    /union\s+select/i, /drop\s+table/i, /insert\s+into/i,
    /exec\s*\(/i, /eval\s*\(/i,
  ];
  return patterns.some((p) => p.test(text));
}

function recordFailedInput(userId) {
  const now = Date.now();
  const e = failedAttempts.get(userId) || { count: 0, reset: now + 300_000 };
  if (now > e.reset) { e.count = 0; e.reset = now + 300_000; }
  e.count++;
  failedAttempts.set(userId, e);
  if (e.count >= 10) {
    blocklist.add(userId);
    setTimeout(() => blocklist.delete(userId), 15 * 60_000);
    return true;
  }
  return false;
}

/* ─── 7. HELPERS ────────────────────────────────────────── */
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

/* ቻናል ጋብዘ — ምዝገባ ከተጠናቀቀ በኋላ ይላካሉ */
async function sendChannelInvite(userId, extraNote = "") {
  if (!MEMBER_CHANNEL) return;
  try {
    const channelHandle = MEMBER_CHANNEL.startsWith("@") ? MEMBER_CHANNEL : `@${MEMBER_CHANNEL}`;
    await bot.telegram.sendMessage(
      userId,
      `📢 *ቻናሉን ይቀላቀሉ!*\n\n` +
      `ምዝገባዎ ከተጠናቀቀ በኋላ ዜናዎች፣ ቀናቶች እና ማስታወቂያዎች በቻናሉ ላይ ይለጠፋሉ።\n\n` +
      (extraNote ? `${extraNote}\n\n` : "") +
      `👉 ${channelHandle}\nhttps://t.me/${MEMBER_CHANNEL.replace(/^@/, "")}`,
      { parse_mode: "Markdown" },
    );
  } catch {
  }
}

const ST = {
  pending:   "ክፍያ ይጠብቃል",
  reviewing: "እየተፈተሸ ነው",
  approved:  "ተፈቅዷል",
  rejected:  "አልተቀበለም",
  sent:      "ተልኳል",
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId);
  const me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `ስም: ${r.fullName} | ስልክ: ${r.phone}${r.phoneUnverified ? " ⚠️" : ""}\n` +
    `ሰፈር: ${r.neighborhood || "—"}\n` +
    `ጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `ክፍያ: ${me?.label || "—"} | አድራሻ: ${r.locationLat ? `[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : "አልተላከም"}\n` +
    `ሁኔታ: ${ST[r.status]}`;
  if (r.autoApproved) t += " ✓";
  if (admin) {
    if (r.autoApproved) t += " _(ስርዓት ያረጋገጠ)_";
    if (r.phoneUnverified) t += "\n⚠️ ስልክ ያልተረጋገጠ";
    t += `\n\`${r.userId}\`${r.username ? " @" + r.username : ""}`;
  }
  return t;
}

function capLine(total, target, unit = "ኪሎ") {
  const pct    = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10);
  const remain = Math.max(0, target - total);
  return (
    "█".repeat(filled) + "░".repeat(10 - filled) + " " + pct + "%\n" +
    "የተመዘገበ: " + total + " " + unit +
    " | ቀሪ: " + remain + " " + unit +
    " | ኢላማ: " + target + " " + unit
  );
}

/* ─── 8. KEYBOARDS ──────────────────────────────────────── */
async function mainKb(userId) {
  const isAdminUser = ADMIN_IDS.includes(userId);
  const [cargoToAmhara, cargoToAA, myRegs, counter, ...productEnabled] =
    await Promise.all([
      getSetting("menu_cargo_toamhara", true),
      getSetting("menu_cargo_toaa",     true),
      getSetting("menu_my_regs",        true),
      getSetting("menu_counter",        true),
      ...GB_PRODUCTS.map((p) => getSetting(`menu_product_${p.id}`, true)),
    ]);

  const rows = [];
  const row1 = [];
  if (isAdminUser || cargoToAmhara) row1.push("🔼 አዲስ አበባ → አማራ ክልል");
  if (isAdminUser || cargoToAA)     row1.push("🔽 አማራ ክልል → አዲስ አበባ");
  if (row1.length) rows.push(row1);

  const row2 = [];
  if (isAdminUser || myRegs)   row2.push("📋 የምዝገባ ዝርዝሬ");
  if (isAdminUser || counter)  row2.push("📊 የጭነት ቆጣሪ");
  if (row2.length) rows.push(row2);

  const prodRow1 = [], prodRow2 = [];
  GB_PRODUCTS.forEach((p, i) => {
    if (isAdminUser || productEnabled[i]) {
      const btn = `${p.emoji} ${p.label}`;
      if (i < 3) prodRow1.push(btn); else prodRow2.push(btn);
    }
  });
  if (prodRow1.length) rows.push(prodRow1);
  if (prodRow2.length) rows.push(prodRow2);

  if (ADMIN_IDS.length) rows.push(["🔧 Admin"]);
  if (!isAdminUser && rows.length === (ADMIN_IDS.length ? 1 : 0)) return Markup.removeKeyboard();
  return Markup.keyboard(rows).resize();
}

/* back button keyboard — shown during multi-step flows */
const backKb = () =>
  Markup.keyboard([["🔙 ወደ ዋናው ምናሌ"]]).resize().oneTime();

const dirRoutesKb = (routes) =>
  Markup.inlineKeyboard([
    ...routes.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `goto_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "back_main")],
  ]);

const locKb = () =>
  Markup.keyboard([
    [Markup.button.locationRequest("📍 አድራሻዬን ላክ")],
    ["⏭️ ሳላጋራ ጨርስ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const approveKb = (id) =>
  Markup.inlineKeyboard([[
    Markup.button.callback("ፈቀድ",  `ok_${id}`),
    Markup.button.callback("ከልክል", `no_${id}`),
  ]]);

const phoneVerifyKb = (id) =>
  Markup.inlineKeyboard([[
    Markup.button.callback("✅ ስልክ ትክክል ነው",     `ph_ok_${id}`),
    Markup.button.callback("❌ ስልክ ተቀባይነት የለውም", `ph_no_${id}`),
  ]]);

/* ─── 9. CAPACITY TRACKING ──────────────────────────────── */
async function routeWeight(routeId) {
  const res = await Reg.aggregate([
    { $match: { routeId, status: { $in: ACTIVE } } },
    { $group: { _id: null, total: { $sum: "$weightKg" } } },
  ]);
  return res[0]?.total || 0;
}

async function checkCapacity(routeId) {
  const ro = byRoute(routeId);
  if (!ro) return;
  const total = await routeWeight(routeId);
  let cap = await RouteCap.findOne({ routeId });
  if (!cap) cap = await RouteCap.create({ routeId, notified: false });
  if (total >= ro.targetKg && !cap.notified) {
    cap.notified = true;
    await cap.save();
    const members = await Reg.find({ routeId, status: { $in: ACTIVE } }).lean();
    for (const m of members)
      bot.telegram.sendMessage(m.userId,
        `*${ro.label}* — ጭነቱ ሞልቷል!\n\nሠራተኞቻችን ቤትዎ ይሰበሰቡዎታል — ዝግጁ ይሁኑ.\n${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" }).catch(() => {});
    for (const aid of ADMIN_IDS)
      bot.telegram.sendMessage(aid, `${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ | ${members.length} ሰው`).catch(() => {});
    if (CHANNEL_ID)
      bot.telegram.sendMessage(CHANNEL_ID,
        `*${ro.label}*\n${capLine(total, ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" }).catch(() => {});
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

async function checkGBCapacity(productId) {
  const prod = byProduct(productId);
  if (!prod) return;
  const agg = await GBReg.aggregate([
    { $match: { productId } },
    { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
  ]);
  const totalKg = agg[0]?.kg || 0, totalCount = agg[0]?.count || 0;
  const ul = unitLabel(prod);
  let cap = await GBProductCap.findOne({ productId });
  if (!cap) cap = await GBProductCap.create({ productId, notified: false });
  if (totalKg >= prod.targetKg && !cap.notified) {
    cap.notified = true;
    await cap.save();
    const members = await GBReg.find({ productId }).lean();
    const uniqueUsers = [...new Map(members.map((m) => [m.userId, m])).values()];
    for (const m of uniqueUsers)
      bot.telegram.sendMessage(m.userId,
        `🎉 *${prod.emoji} ${prod.label} — ምዝገባ ሞልቷል!*\n\n` +
        `ጠቅላላ: *${totalKg} ${ul}* | ${totalCount} ሰው\n\n` +
        `✅ ምርቱ ከምንጩ ይዘዛል — ከሂደቱ ለማወቅ ይጠብቁ!\n\n` +
        `ዋጋ: *${prod.pricePerKg} ብር/${ul}*\nለጥያቄ: ${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" }).catch(() => {});
    for (const aid of ADMIN_IDS)
      bot.telegram.sendMessage(aid,
        `✅ *${prod.emoji} ${prod.label}* — ምዝገባ ሞልቷል!\n${totalKg}/${prod.targetKg} ${ul} | ${totalCount} ሰው`,
        { parse_mode: "Markdown" }).catch(() => {});
    if (CHANNEL_ID)
      bot.telegram.sendMessage(CHANNEL_ID,
        `*${prod.emoji} ${prod.label} — ምዝገባ ሞልቷል!*\n\n` +
        `${capLine(totalKg, prod.targetKg, ul)}\n\n` +
        `ቀጥታ ከ ምንጭ — *${prod.pricePerKg} ብር/${ul}*\n${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" }).catch(() => {});
  } else if (totalKg < prod.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

/* ─── 10. PAYMENT CHECK ─────────────────────────────────── */
async function checkPayment(fileId, reg) {
  if (!anthropic) return null;
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const res  = await fetch(link.href || String(link));
    if (!res.ok) throw new Error("fetch fail");
    const b64  = Buffer.from(await res.arrayBuffer()).toString("base64");
    const mime = res.headers.get("content-type") || "image/jpeg";
    const m    = byMethod(reg.paymentMethod);
    const msg  = await anthropic.messages.create({
      model:      "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text",  text: `Payment screenshot. Method:${m?.label} Account:"${m?.info}" Amount:${reg.totalPrice}ETB\nReply ONLY JSON: {"amount_match":true/false,"account_match":true/false,"looks_edited":true/false,"confidence":"high|medium|low","reason":"short amharic"}` },
        ],
      }],
    });
    const raw = msg.content.find((b) => b.type === "text")?.text || "{}";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("Payment check error:", e.message);
    return null;
  }
}

const checkOk = (r) =>
  r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === "high";

const checkSummaryAdmin = (r) =>
  !r
    ? "ፍተሻ አልተሳካም"
    : `ፍተሻ: ${checkOk(r) ? "ትክክል" : r?.looks_edited ? "ሊስተካከል ይችላል" : "አልተረጋገጠም"} (${r.confidence}) ${r.reason || ""}`;

/* ─── 11. PRINT MANIFEST ────────────────────────────────── */
const PRINT_STATUS = {
  approved:  "ፈቃድ ያለው",
  reviewing: "እየተፈተሸ",
  pending:   "ያልከፈለ",
  sent:      "ተልኳል",
};

function buildManifestHTML(ro, list) {
  const totalKg  = list.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalReg = totalKg * REG_PER_KG, totalShip = totalKg * SHIP_PER_KG;
  const cnt = { approved: 0, reviewing: 0, pending: 0, sent: 0 };
  list.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
  const now = new Date(), dateStr = now.toLocaleDateString("en-GB"), timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const ORDER  = ["approved", "sent", "reviewing", "pending"];
  const sorted = [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const rows   = sorted.map((r, i) =>
    `<tr><td>${i + 1}</td><td>${r.fullName || "—"}</td><td>${r.phone || "—"}${r.phoneUnverified ? " ⚠️" : ""}</td><td>${r.neighborhood || "—"}</td><td>${r.cargoDesc || "—"}</td><td class="num">${r.weightKg || 0}</td><td class="status status-${r.status}">${PRINT_STATUS[r.status] || r.status}</td></tr>`,
  ).join("");
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><title>${ro.label} — የጭነት ዝርዝር</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:'Noto Sans Ethiopic','Nyala',Arial,sans-serif;color:#1a1a1a;margin:0;padding:18px;font-size:13px}.letterhead{display:flex;justify-content:space-between;border-bottom:3px solid #1a3c6e;padding-bottom:10px;margin-bottom:14px}.letterhead h1{font-size:18px;margin:0 0 4px;color:#1a3c6e}.letterhead .meta{text-align:right;font-size:12px}.route-banner{background:#1a3c6e;color:#fff;padding:8px 14px;border-radius:4px;font-size:15px;font-weight:bold;margin-bottom:14px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.box{border:1px solid #ccc;border-radius:5px;padding:7px 13px;text-align:center;background:#f7f8fa;min-width:95px}.box .v{font-size:18px;font-weight:bold;color:#1a3c6e}.box .l{font-size:10px;color:#666;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px}th{background:#1a3c6e;color:#fff;padding:7px 6px;text-align:left}td{padding:6px;border-bottom:1px solid #ddd}tr:nth-child(even){background:#f5f6f8}.num{text-align:center}.status{text-align:center;font-weight:bold;font-size:11px}.status-approved{color:#1a7d3b}.status-sent{color:#1565c0}.status-reviewing{color:#b8860b}.status-pending{color:#888}.footer{margin-top:30px;display:flex;justify-content:space-between;font-size:12px}.sign-box{width:45%}.sign-line{border-top:1px solid #333;margin-top:36px;padding-top:4px;text-align:center}.stamp-note{margin-top:26px;font-size:11px;color:#777;text-align:center}#printBtn{margin:16px 0;padding:10px 28px;font-size:14px;background:#1a3c6e;color:#fff;border:none;border-radius:6px;cursor:pointer}@media print{#printBtn{display:none}body{padding:0}}</style></head><body>
<button id="printBtn" onclick="window.print()">ይህን ፕሪንት ያድርጉ</button>
<div class="letterhead"><div><h1>የጋራ ጭነት አገልግሎት</h1><div style="font-size:12px;color:#555">Cargo Group-Booking Manifest</div></div><div class="meta">${dateStr} &nbsp; ${timeStr}<br>${SUPPORT_PHONE}</div></div>
<div class="route-banner">${ro.emoji} ${ro.label}</div>
<div class="summary"><div class="box"><div class="v">${list.length}</div><div class="l">ጠቅላላ ተሳፋሪ</div></div><div class="box"><div class="v">${totalKg}</div><div class="l">ጠቅላላ ኪሎ</div></div><div class="box"><div class="v">${cnt.approved + cnt.sent}</div><div class="l">ፈቃድ ያላቸው</div></div><div class="box"><div class="v">${cnt.pending + cnt.reviewing}</div><div class="l">በሂደት ላይ</div></div><div class="box"><div class="v">${totalReg.toLocaleString("en")}</div><div class="l">የምዝገባ ክፍያ (ብር)</div></div><div class="box"><div class="v">${totalShip.toLocaleString("en")}</div><div class="l">የጭነት ክፍያ (ብር)</div></div></div>
<table><thead><tr><th>#</th><th>ሙሉ ስም</th><th>ስልክ ቁጥር</th><th>ሰፈር</th><th>የጭነት ዓይነት</th><th class="num">ኪሎ</th><th class="status">ሁኔታ</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer"><div class="sign-box"><div class="sign-line">የሹፍር ስም እና ፊርማ — Driver Name &amp; Signature</div></div><div class="sign-box"><div class="sign-line">የተረከበ ባለሥልጣን ፊርማ — Receiving Officer Signature</div></div></div>
<div class="stamp-note">ይህ ሰነድ በ${ro.label} የጭነት ጉዞ ላይ ለፖሊስ/ኬላ ማሳያ ሰነድ ነው።</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script></body></html>`;
}

async function sendDocumentWithRetry(chatId, doc, extra, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { return await bot.telegram.sendDocument(chatId, doc, extra); }
    catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) { await ctx.reply("መስመር አልተገኘም"); return; }
  let waitMsg;
  try {
    waitMsg = await ctx.reply("ሰነዱ እየተዘጋጀ ነው፣ ትንሽ ይጠብቁ...");
    const list = await Reg.find({ routeId, status: { $ne: "rejected" } }).sort({ createdAt: 1 }).lean();
    if (!list.length) { await ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`); return; }
    const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    const html = buildManifestHTML(ro, list), buf = Buffer.from(html, "utf-8");
    const fname = `${ro.id}_${new Date().toISOString().slice(0, 10)}.html`;
    await sendDocumentWithRetry(ctx.chat.id,
      { source: buf, filename: fname },
      { caption: `*${ro.label}* — ፕሪንት ዝግጁ ሰነድ\n${list.length} ሰው | ${totalKg} ኪሎ\n\nፋይሉን ይክፈቱ — ፕሪንት ይከፈታል`, parse_mode: "Markdown" },
    );
    if (waitMsg) bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
  } catch (e) {
    console.error("handlePrint:", e.message);
    await ctx.reply("ፋይሉን መላክ አልተሳካም\n\nትንሽ ቆይተው እንደገና ይሞክሩ።").catch(() => {});
  }
}

/* ─── 12. DAILY REPORT ──────────────────────────────────── */
async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;
  let txt = `ዕለታዊ ሪፖርት — ${new Date().toLocaleDateString("am-ET")}\n\n`;
  let gKg = 0, gPeople = 0, gPending = 0;
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } },
    ]);
    const m = {};
    counts.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = counts.reduce((s, c) => s + c.n, 0);
    const kg = (m.pending?.kg||0) + (m.reviewing?.kg||0) + (m.approved?.kg||0) + (m.sent?.kg||0);
    gKg += kg; gPeople += people; gPending += (m.pending?.n||0) + (m.reviewing?.n||0);
    if (!people) continue;
    txt += `${ro.emoji} ${ro.label}\n${people} ሰው | ${kg} ኪሎ | ፈቃድ: ${m.approved?.n||0} | ፍተሻ: ${m.reviewing?.n||0} | ያልከፈለ: ${m.pending?.n||0} | ተልኳል: ${m.sent?.n||0}\n\n`;
  }
  txt += `ጠቅላላ: ${gPeople} ሰው | ${gKg} ኪሎ | ያልተፈቀዱ: ${gPending}\nምዝ: ${(gKg * REG_PER_KG).toLocaleString()} ብ | ጭ: ${(gKg * SHIP_PER_KG).toLocaleString()} ብ`;
  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, txt).catch(() => {});
}

function startDailyReportScheduler() {
  let last = "";
  setInterval(async () => {
    const eat  = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const date = eat.toISOString().slice(0, 10);
    if (eat.getUTCHours() === 7 && eat.getUTCMinutes() === 0 && last !== date) {
      last = date;
      await sendDailyReport().catch((e) => console.error("Daily report:", e.message));
    }
  }, 60_000);
}

/* ─── 13. BOT + MIDDLEWARE ──────────────────────────────── */
const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 120_000,
  telegram: { timeout: 120 },
});
bot.use(sessionMW);

bot.use(async (ctx, next) => {
  if (ctx.from?.is_bot) return;
  const uid = ctx.from?.id;
  if (!uid) return next();
  if (isAdmin(ctx)) return next();
  if (isRateLimited(uid))
    return ctx.reply("⛔ ብዙ ጥያቄ ልከዋል — ከ 10 ደቂቃ በኋላ ይሞክሩ።").catch(() => {});
  return next();
});

bot.catch((err, ctx) => {
  console.error("Bot error:", err?.message, ctx?.updateType);
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(aid, `⚠️ Bot Error: ${err?.message || "unknown"}\nUpdate: ${ctx?.updateType || "—"}`).catch(() => {});
});

/* ─── 14. WELCOME ───────────────────────────────────────── */
function defaultWelcomeText(name) {
  return (
    `👋 *እንኳን ወደ Group Buying በደህና መጡ, ${name}!*\n\n` +
    `2️⃣ ምርትን ቀጥታ ከፋብሪካና ከገበሬዎች በማምጣት የኑሮ ውድነቱን ለመጣል ተነስተናል።\n\n` +
    `3️⃣ በጋራ ግዥ (Group Buying) በአንድ ላይ በመሆን ማንኛውንም ዕቃ በጅምላ ዋጋ ከፋብሪካ እና በቀጥታ ከ ገበሬው እንገዛለን።\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ *እርስዎ የሚከፍሉት ትንሽ የ አገልግሎት ክፍያ ብቻ ነው!*\n` +
    `_ሌላው ትራንስፖርት እና የምርት ክፍያ ከፍለው ቀጥታ ከ ምንጩ ባለ ዋጋ ይረካሉ!!_\n\n` +
    `📋 *የምዝገባ (አገልግሎት) ክፍያ:* ${REG_PER_KG} ብር/ኪሎ\n\n` +
    `📞 ለጥያቄ: ${SUPPORT_PHONE}\n\n` +
    `*ከታች የሚፈልጉትን ምርት ይጫኑ:*`
  );
}

async function welcomeText(name) {
  const custom = await getSetting("welcome_message", null);
  if (custom) return custom.replace(/\{name\}/g, name).replace(/\{fee\}/g, String(REG_PER_KG));
  return defaultWelcomeText(name);
}

bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});
bot.command("help", async (ctx) => {
  ctx.session = {};
  await ctx.reply(await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});

/* ─── 15. ቆጣሪ / ምዝገባዬ ─────────────────────────────────── */
bot.hears("📊 የጭነት ቆጣሪ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_counter", true)))
    return ctx.reply("ይህ አገልግሎት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  let txt = "*የጭነት ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n*አዲስ አበባ → አማራ ክልል*\n\n";
  for (const ro of ROUTES_TO_AMHARA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }
  txt += "*አማራ ክልል → አዲስ አበባ*\n\n";
  for (const ro of ROUTES_TO_AA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) });
});

bot.hears("📋 የምዝገባ ዝርዝሬ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_my_regs", true)))
    return ctx.reply("ይህ አገልግሎት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  const regs   = await Reg.find({ userId: ctx.from.id, status: { $nin: ["rejected"] } }).sort({ createdAt: -1 }).lean();
  const gbRegs = await GBReg.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();

  if (!regs.length && !gbRegs.length)
    return ctx.reply("ምዝገባ አልተገኘም", await mainKb(ctx.from?.id));

  for (const r of regs) {
    const btns = [Markup.button.callback("ሰርዝ", `del_${r._id}`)];
    if (!r.locationLat && ACTIVE.includes(r.status))
      btns.push(Markup.button.callback("አድራሻ ላክ", `addloc_${r._id}`));
    await ctx.reply(card(r), { parse_mode: "Markdown", ...Markup.inlineKeyboard([btns]) });
  }

  for (const g of gbRegs) {
    const prod = byProduct(g.productId), ul = unitLabel(prod);
    const agg  = await GBReg.aggregate([
      { $match: { productId: g.productId } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;
    /* FIX: use unitLabel(prod) for the button text */
    await ctx.reply(
      `${prod?.emoji} *${prod?.label}*\n` +
      `ስም: ${g.fullName} | ስልክ: ${g.phone}\n` +
      `ሰፈር: ${g.neighborhood || "—"}\n` +
      `ተመዝግቧል: *${g.weightKg} ${ul}*\n` +
      `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
      `👥 ተሳታፊ: ${regCount} ሰው`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`➕ ${ul} ጨምር`, `gb_addkg_${g._id}`)]]) },
    );
  }
});

bot.action(/^addloc_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const r = await Reg.findById(id).lean();
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step: "LOC", locRegId: String(r._id) };
  await ctx.reply("አድራሻዎን ያጋሩ:", locKb());
});

/* back_main inline callback — resets session and returns to main menu */
bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.reply("ዋናው ምናሌ", await mainKb(ctx.from?.id));
});

/* ─── 16. GROUP BUYING PRODUCT MENU ────────────────────── */
for (const prod of GB_PRODUCTS) {
  bot.hears(`${prod.emoji} ${prod.label}`, async (ctx) => {
    if (!isAdmin(ctx) && !(await getSetting(`menu_product_${prod.id}`, true)))
      return ctx.reply("ይህ ምርት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
    ctx.session = { step: "GB_NAME", gbProductId: prod.id };
    const ul = unitLabel(prod);
    const agg = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;
    await ctx.reply(
      `${prod.emoji} *${prod.label}*\n━━━━━━━━━━━━━━━━\n` +
      `${capLine(regKg, prod.targetKg, ul)}\n👥 ${regCount} ሰው ተመዝግቧል\n\n` +
      `✅ *እርስዎ የሚከፍሉት ትንሽ የ አገልግሎት ክፍያ ብቻ ነው*\n` +
      `_የምርት እና የትራንስፖርት ክፍያ — ምዝገባ ሲሞላ እናሳውቅዎታለን_\n\n` +
      `👤 ሙሉ ስምዎን ያስገቡ:`,
      { parse_mode: "Markdown", ...backKb() },
    );
  });
}

/* ─── 17. ROUTE SELECTION ───────────────────────────────── */
async function startRegistration(ctx, route) {
  const ex = await Reg.findOne({ userId: ctx.from.id, status: { $nin: ["rejected", "sent"] } }).lean();
  if (ex) {
    const ro   = byRoute(ex.routeId);
    const btns = [Markup.button.callback("ሰርዝ", `del_${ex._id}`)];
    if (!ex.locationLat) btns.push(Markup.button.callback("አድራሻ ላክ", `addloc_${ex._id}`));
    return ctx.reply(
      `⚠️ _አንድ ምዝገባ ብቻ ይፈቀዳል_\n\n` + card(ex) + `\n\n_ሌላ ለመመዝገብ ቀደሙን ሰርዘው ይሞክሩ_`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([btns]) },
    );
  }
  ctx.session = { step: "NAME", routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}*\n\nሙሉ ስምዎን ያስገቡ:`, {
    parse_mode: "Markdown",
    ...backKb(),
  });
}

bot.hears("🔼 አዲስ አበባ → አማራ ክልል", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_cargo_toamhara", true)))
    return ctx.reply("ይህ አቅጣጫ አሁን ጊዜያዊ ተዘግቷል።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  await ctx.reply("*አዲስ አበባ → አማራ ክልል* — መስመር ይምረጡ:", { parse_mode: "Markdown", ...dirRoutesKb(ROUTES_TO_AMHARA) });
});

bot.hears("🔽 አማራ ክልል → አዲስ አበባ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_cargo_toaa", true)))
    return ctx.reply("ይህ አቅጣጫ አሁን ጊዜያዊ ተዘግቷል።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  await ctx.reply("*አማራ ክልል → አዲስ አበባ* — መስመር ይምረጡ:", { parse_mode: "Markdown", ...dirRoutesKb(ROUTES_TO_AA) });
});

bot.action(/^goto_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  await startRegistration(ctx, route);
});
bot.action(/^more_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const route = byRoute(ctx.match[1]);
  if (!route) return;
  ctx.session = { step: "NAME", routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}* — ሌላ እቃ ጨምር\n\nሙሉ ስምዎን ያስገቡ:`, {
    parse_mode: "Markdown",
    ...backKb(),
  });
});

/* ─── 18. PAYMENT METHOD ────────────────────────────────── */
bot.action(/^pm_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== "PAYMETHOD") return;
  const m = byMethod(ctx.match[1]);
  if (!m) return;
  const { d, routeId } = ctx.session;
  ctx.session = {};
  const r = await Reg.create({
    userId:          ctx.from.id,
    username:        ctx.from.username || "",
    fullName:        d.name,
    phone:           d.phone,
    neighborhood:    d.neighborhood || "",
    phoneUnverified: d.phoneUnverified || false,
    routeId,
    cargoDesc:       d.cargo,
    weightKg:        d.kg,
    totalPrice:      d.kg * REG_PER_KG,
    paymentMethod:   m.id,
    status:          "pending",
  });
  await checkCapacity(routeId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const acct = m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ቁጥር: \`${acct}\`\n\n` +
    `*የምዝገባ ክፍያ: ${r.totalPrice} ብር* (${d.kg} ኪሎ × ${REG_PER_KG} ብር/ኪሎ)\n\n` +
    `⚠️ ክፍያ ከፈጸሙ በኋላ *የደረሰኝ ፎቶ (screenshot)* ይላኩ።\n` +
    `ፎቶ ሳይልኩ ምዝገባ አይጠናቀቅም!`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
  if (d.phoneUnverified) {
    for (const aid of ADMIN_IDS)
      bot.telegram.sendMessage(
        aid,
        `⚠️ *ስልክ ማረጋገጫ ያስፈልጋል*\n\nስም: ${d.name}\nስልክ: \`${d.phone}\`\nሰፈር: ${d.neighborhood || "—"}\nአቅጣጫ: ${byRoute(routeId)?.label || routeId}\n\nሰዉ አልተለዬ — ስልቁ ትክክል ነው?`,
        { parse_mode: "Markdown", ...phoneVerifyKb(String(r._id)) },
      ).catch(() => {});
  }
});

/* ─── 19. TEXT FLOW ─────────────────────────────────────── */
bot.on("text", async (ctx, next) => {
  const { step } = ctx.session || {};
  const txt = ctx.message.text.trim();

  /* ── Global back button — resets session ─────────────── */
  if (txt === "🔙 ወደ ዋናው ምናሌ") {
    ctx.session = {};
    await ctx.reply("ዋናው ምናሌ", await mainKb(ctx.from?.id));
    return;
  }

  if (!step) return next();

  /* Security checks */
  if (isSuspicious(txt)) {
    console.warn(`Suspicious input from ${ctx.from?.id}: ${txt.slice(0, 80)}`);
    recordFailedInput(ctx.from?.id);
    return ctx.reply("⛔ ትክክለኛ ያልሆነ ግብዓት — ምዝገባ ተሰርዟል።");
  }

  const reserved = [
    "📋 የምዝገባ ዝርዝሬ", "📊 የጭነት ቆጣሪ", "🔧 Admin",
    "⏭️ ሳላጋራ ጨርስ", "🔼 አዲስ አበባ → አማራ ክልል", "🔽 አማራ ክልል → አዲስ አበባ",
    ...GB_PRODUCTS.map((p) => `${p.emoji} ${p.label}`),
  ];
  if (reserved.includes(txt)) return next();

  /* ── admin steps ─────────────────────────────────────── */
  if (step === "ADMIN_WELCOME") {
    await setSetting("welcome_message", txt);
    ctx.session = {};
    await ctx.reply("✅ *Welcome Message ተቀይሯል!*", { parse_mode: "Markdown" });
    const preview = await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ");
    await ctx.reply(`*👁 ቅድመ-እይታ:*\n\n${preview}`, { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) });
    return;
  }

  /* ── Admin GB add kg for user ─────────────────────────── */
  if (step === "ADMIN_GB_ADDKG_USERID") {
    const uid = parseInt(txt.replace(/\D/g, ""), 10);
    if (!uid) return ctx.reply("❌ ትክክለኛ User ID ያስገቡ (ቁጥር):");
    const { adminGBProductId } = ctx.session;
    const regs = await GBReg.find({ userId: uid, productId: adminGBProductId }).lean();
    if (!regs.length) return ctx.reply("❌ ምዝገባ አልተገኘም — ትክክለኛ User ID ያስገቡ:");
    const g = regs[0];
    const prod = byProduct(g.productId), ul = unitLabel(prod);
    ctx.session.adminGBRegId = String(g._id);
    ctx.session.adminGBOldKg = g.weightKg;
    ctx.session.step = "ADMIN_GB_ADDKG_KG";
    return ctx.reply(
      `👤 ${g.fullName} | ${g.phone}\n${prod?.emoji} *${prod?.label}* — አሁን: *${g.weightKg} ${ul}*\n\nአዲስ ጠቅላላ ${ul} ያስገቡ:`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "ADMIN_GB_ADDKG_KG") {
    const newKg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    const { adminGBRegId, adminGBOldKg, adminGBProductId } = ctx.session;
    const prod = byProduct(adminGBProductId), ul = unitLabel(prod);
    if (!newKg || newKg <= 0 || newKg > 50000) return ctx.reply(`❌ ትክክለኛ ቁጥር ያስገቡ (1–50000 ${ul}):`);
    await GBReg.findByIdAndUpdate(adminGBRegId, { weightKg: newKg });
    ctx.session = {};
    await ctx.reply(
      `✅ *Admin — ${ul} ዘምኗል!*\n\n${prod?.emoji} *${prod?.label}*\nቀድሞ: *${adminGBOldKg} ${ul}* → አሁን: *${newKg} ${ul}*`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    checkGBCapacity(adminGBProductId).catch(() => {});
    return;
  }

  /* ── Admin Cash Registration flow ───────────────────────── */
  if (step === "ADMIN_CASH_NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
    ctx.session.cashName = txt;
    ctx.session.step     = "ADMIN_CASH_PHONE";
    return ctx.reply("ደንበኛው ስልክ ቁጥር:", backKb());
  }

  if (step === "ADMIN_CASH_PHONE") {
    ctx.session.cashPhone = txt.replace(/\s/g, "");
    ctx.session.step      = "ADMIN_CASH_NBR";
    return ctx.reply("ሰፈር (ወይም ዳሽ —):", backKb());
  }

  if (step === "ADMIN_CASH_NBR") {
    ctx.session.cashNbr = txt.slice(0, 60);
    ctx.session.step    = "ADMIN_CASH_KG";
    const prod = byProduct(ctx.session.cashProductId), ul = unitLabel(prod);
    return ctx.reply(`ምን ያህል *${ul}* ከፍሏል?`, { parse_mode: "Markdown", ...backKb() });
  }

  if (step === "ADMIN_CASH_KG") {
    const kg   = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 50000) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:", backKb());
    ctx.session.cashKg = kg;
    ctx.session.step   = "ADMIN_CASH_TGID";
    return ctx.reply(
      `ደንበኛው Telegram User ID ካለ ያስገቡ (ለማሳወቅ)\n_ከሌለ 0 ይጻፉ:_`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "ADMIN_CASH_TGID") {
    const { cashProductId, cashName, cashPhone, cashNbr, cashKg } = ctx.session;
    const prod       = byProduct(cashProductId), ul = unitLabel(prod);
    const tgId       = parseInt(txt.replace(/\D/g, ""), 10) || 0;
    const totalCost  = Math.round(cashKg * (prod?.pricePerKg || 0));
    const serviceFee = Math.round(cashKg * REG_PER_KG);

    const gbReg = await GBReg.create({
      userId:        tgId,
      username:      "",
      productId:     cashProductId,
      fullName:      cashName,
      phone:         cashPhone,
      neighborhood:  cashNbr || "",
      weightKg:      cashKg,
      totalCost,
      pricePerKg:    prod?.pricePerKg || 0,
      paymentFileId: null,
      paymentStatus: "approved",
      aiVerdict:     { method: "cash", admin: ctx.from?.id },
    });

    ctx.session = {};

    const agg      = await GBReg.aggregate([{ $match: { productId: cashProductId } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg    = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;

    await ctx.reply(
      `✅ *Cash ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n` +
      `${prod?.emoji} *${prod?.label}* — ${cashKg} ${ul}\n` +
      `👤 ${cashName}  |  📞 ${cashPhone}\n` +
      `🏘 ሰፈር: ${cashNbr || "—"}\n` +
      `💵 ክፍያ: Cash (${serviceFee} ብር)\n\n` +
      `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
      `👥 ተሳታፊ: ${regCount} ሰው`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );

    /* ደንበኛ Telegram ካለ ማሳወቅ */
    if (tgId) {
      bot.telegram.sendMessage(
        tgId,
        `✅ *ምዝገባ ተጠናቀቀ!*\n\n` +
        `${prod?.emoji} *${prod?.label}* — ${cashKg} ${ul}\n` +
        `💵 _ክፍያ በ አካል ተቀቢሏል_\n\n` +
        `ምዝገባ ሲሞላ እናሳውቅዎታለን!\n📞 ${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" },
      ).catch(() => {});
      sendChannelInvite(tgId).catch(() => {});
    }

    checkGBCapacity(cashProductId).catch(() => {});
    return;
  }

  /* ── GB flow ─────────────────────────────────────────── */
  if (step === "GB_NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
    ctx.session.gbName = txt;
    /* Neighborhood: free text */
    ctx.session.step   = "GB_NEIGHBORHOOD";
    return ctx.reply(
      `👤 ${txt}\n\nሰፈርዎን ይጻፉ (ለምሳሌ: ቦሌ, ቂርቆስ, ጉለሌ...):`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "GB_NEIGHBORHOOD") {
    if (txt.length < 2) return ctx.reply("ሰፈርዎን ይጻፉ (ቢያንስ 2 ፊደል):", backKb());
    ctx.session.gbNeighborhood = txt.slice(0, 60);
    ctx.session.step           = "GB_PHONE";
    return ctx.reply("ስልክ ቁጥርዎን ያስገቡ (ምሳሌ: 0912345678):", backKb());
  }

  if (step === "GB_PHONE") {
    const phone         = txt.replace(/\s/g, "");
    const phoneValid    = /^0[79]\d{8}$/.test(phone) || /^\+251[79]\d{8}$/.test(phone);
    if (!phoneValid) {
      const blocked = recordFailedInput(ctx.from?.id);
      if (blocked) return ctx.reply("⛔ ብዙ ጊዜ ስህተት ግብዓት ልከዋል — ቆይተው ይሞክሩ።");
      ctx.session.gbPhone           = phone;
      ctx.session.gbPhoneUnverified = true;
      ctx.session.step              = "GB_KG";
      const prod = byProduct(ctx.session.gbProductId), ul = unitLabel(prod);
      await ctx.reply(
        `⚠️ ስልክ ቁጥሩ ቅርጸቱ ልዩ ነው — ሰራተኛ ያረጋግጣሉ.\n\n` +
        `ምን ያህል *${ul}* *${prod?.label}* ይፈልጋሉ?\nቁጥር ያስገቡ:`,
        { parse_mode: "Markdown", ...backKb() },
      );
      return;
    }
    ctx.session.gbPhone = phone;
    ctx.session.step    = "GB_KG";
    const prod = byProduct(ctx.session.gbProductId), ul = unitLabel(prod);
    return ctx.reply(
      `ምን ያህል *${ul}* *${prod?.label}* ይፈልጋሉ?\nቁጥር ያስገቡ:`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "GB_KG") {
    const kg   = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 5000) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ (1–5000):", backKb());
    const prod = byProduct(ctx.session.gbProductId), ul = unitLabel(prod);
    const serviceFee = Math.round(kg * REG_PER_KG);
    ctx.session.gbKg  = kg;
    ctx.session.step  = "GB_CONFIRM";
    return ctx.reply(
      `📋 *የምዝገባ ማረጋገጫ*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${prod?.emoji} *${prod?.label}*  •  ${kg} ${ul}\n` +
      `👤 ${ctx.session.gbName}  |  📞 ${ctx.session.gbPhone}\n` +
      `🏘 ሰፈር: ${ctx.session.gbNeighborhood || "—"}\n\n` +
      `📋 *የምዝገባ (አገልግሎት) ክፍያ:*\n` +
      `   ${kg} ${ul} × ${REG_PER_KG} ብር = *${serviceFee.toLocaleString()} ብር*\n\n` +
      `ℹ️ _የምርት እና የትራንስፖርት ክፍያ — ምዝገባ ሲሞላ እናሳውቅዎታለን_\n\n` +
      `ምዝገባ ያረጋግጡ?`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "✅ አረጋግጥ", callback_data: "gb_confirm_yes" },
          { text: "❌ ሰርዝ",   callback_data: "gb_confirm_no"  },
        ]]},
      },
    );
  }

  if (step === "GB_CONFIRM") return ctx.reply("ከዚህ በታች ያሉትን ቁልፎች ይጠቀሙ 👆");

  if (step === "GB_ADDKG") {
    const newTotal = parseFloat(txt.replace(/[^0-9.]/g, ""));
    const { gbAddId, gbAddOldKg, gbAddProductId } = ctx.session;
    const prod = byProduct(gbAddProductId), ul = unitLabel(prod);
    if (!newTotal || newTotal <= 0 || newTotal > 5000)
      return ctx.reply(`ትክክለኛ ቁጥር ያስገቡ (1–5000):`, backKb());
    if (newTotal <= gbAddOldKg)
      return ctx.reply(
        `⚠️ አሁን *${gbAddOldKg} ${ul}* ተመዝግበዋል — ከዚህ የሚበልጥ ቁጥር ያስገቡ\n_(ለምሳሌ ${gbAddOldKg + 5} ${ul})_`,
        { parse_mode: "Markdown", ...backKb() },
      );
    const diffKg   = newTotal - gbAddOldKg;
    const diffFee  = Math.round(diffKg * REG_PER_KG);
    ctx.session.gbAddNewKg   = newTotal;
    ctx.session.gbAddDiffKg  = diffKg;
    ctx.session.gbAddDiffFee = diffFee;
    ctx.session.step = "GB_ADDKG_CONFIRM";
    return ctx.reply(
      `📋 *${ul} ማሻሻያ ማረጋገጫ*\n━━━━━━━━━━━━━━━━\n` +
      `${prod?.emoji} *${prod?.label}*\n` +
      `ቀድሞ: *${gbAddOldKg} ${ul}*  →  አዲስ: *${newTotal} ${ul}*\n\n` +
      `➕ ጭማሪ: ${diffKg} ${ul}\n` +
      `💳 *የሚከፈለው: ${diffFee} ብር* (${diffKg} ${ul} × ${REG_PER_KG} ብር)\n\n` +
      `ያረጋግጡ?`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[
        { text: "✅ አረጋግጥ", callback_data: "gb_addkg_confirm" },
        { text: "❌ ሰርዝ",   callback_data: "gb_addkg_cancel"  },
      ]]}},
    );
  }

  if (step === "GB_ADDKG_CONFIRM") return ctx.reply("ከዚህ በታች ያሉትን ቁልፎች ይጠቀሙ 👆");

  if (step === "ADMIN_PRICE") {
    const price = parseFloat(txt.replace(/[^0-9.]/g, ""));
    const { adminPriceId } = ctx.session;
    const prod = byProduct(adminPriceId);
    if (!prod) { ctx.session = {}; return ctx.reply("❌ ምርት አልተገኘም"); }
    if (!price || price <= 0 || price > 100000) return ctx.reply("❌ ትክክለኛ ዋጋ ያስገቡ (ለምሳሌ: 80):");
    const oldPrice = prod.pricePerKg;
    prod.pricePerKg = price;
    await setSetting(`price_${adminPriceId}`, price);
    ctx.session = {};
    const ul = unitLabel(prod);
    await ctx.reply(`✅ *ዋጋ ተቀይሯል!*\n\n${prod.emoji} *${prod.label}*\nቀድሞ: ${oldPrice} ብር/${ul}\nአሁን: *${price} ብር/${ul}*`, { parse_mode: "Markdown" });
    for (const aid of ADMIN_IDS) {
      if (aid === ctx.from.id) continue;
      bot.telegram.sendMessage(aid, `${prod.emoji} *${prod.label}* ዋጋ ተቀይሯል\n${oldPrice} → *${price}* ብር/${ul}`, { parse_mode: "Markdown" }).catch(() => {});
    }
    return;
  }

  if (step === "GB_AWAIT_PHOTO") return ctx.reply("📸 እባክዎ *የደረሰኝ ፎቶ (screenshot)* ይላኩ — ጽሑፍ አይቀበልም።", { parse_mode: "Markdown" });
  if (step === "PAYMETHOD")     return ctx.reply("ከቁልፍ ይምረጡ");

  /* ── Cargo NAME step ─────────────────────────────────── */
  if (step === "NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
    ctx.session.d.name = txt;
    /* Neighborhood: free text */
    ctx.session.step   = "NEIGHBORHOOD";
    return ctx.reply(
      `👤 ${txt}\n\nሰፈርዎን ይጻፉ (ለምሳሌ: ቦሌ, ቂርቆስ, ጉለሌ...):`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "NEIGHBORHOOD") {
    if (txt.length < 2) return ctx.reply("ሰፈርዎን ይጻፉ (ቢያንስ 2 ፊደል):", backKb());
    ctx.session.d.neighborhood = txt.slice(0, 60);
    ctx.session.step           = "PHONE";
    return ctx.reply("ስልክ ቁጥርዎን ያስገቡ:", backKb());
  }

  /* ── PHONE step ──────────────────────────────────────── */
  if (step === "PHONE") {
    const phone      = txt.replace(/\s/g, "");
    const phoneValid = /^0[79]\d{8}$/.test(phone) || /^\+251[79]\d{8}$/.test(phone);
    if (!phoneValid) {
      const blocked = recordFailedInput(ctx.from?.id);
      if (blocked) return ctx.reply("⛔ ብዙ ጊዜ ስህተት ልከዋል — ቆይተው ይሞክሩ።");
      ctx.session.d.phone           = phone;
      ctx.session.d.phoneUnverified = true;
      ctx.session.step              = "CARGO";
      await ctx.reply(
        `⚠️ ስልክ ቁጥሩ ቅርጸቱ ልዩ ነው — ሰራተኛ ያረጋግጣሉ.\n\nጭነት ዓይነት (ምን ዓይነት እቃ?):`,
        backKb(),
      );
      return;
    }
    ctx.session.d.phone = phone;
    ctx.session.step    = "CARGO";
    return ctx.reply("ጭነት ዓይነት (ምን ዓይነት እቃ?):", backKb());
  }

  if (step === "CARGO") {
    if (txt.length < 2 || txt.length > 200) return ctx.reply("ጭነቱን ያስገቡ (2–200 ፊደል):", backKb());
    ctx.session.d.cargo = txt;
    ctx.session.step    = "WEIGHT";
    return ctx.reply("ክብደት (ኪሎ):", backKb());
  }

  if (step === "WEIGHT") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ (1–2000):", backKb());
    ctx.session.d.kg  = kg;
    ctx.session.step  = "PAYMETHOD";
    return ctx.reply(
      `*ማጠቃለያ*\n━━━━━━━━━━━━━━━━\n` +
      `ስም: ${ctx.session.d.name}\n` +
      `ሰፈር: ${ctx.session.d.neighborhood || "—"}\n` +
      `ጭነት: ${ctx.session.d.cargo} — *${kg} ኪሎ*\n\n` +
      `💳 *የምዝገባ (አገልግሎት) ክፍያ: ${kg * REG_PER_KG} ብር* (${kg} ኪሎ × ${REG_PER_KG} ብር/ኪሎ)\n` +
      `_የምርት እና የትራንስፖርት ክፍያ — ምዝገባ ሲሞላ እናሳውቅዎታለን_\n\n` +
      `ክፍያ ዘዴ ይምረጡ:`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([
        ...METHODS.map((m) => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)]),
        [Markup.button.callback("🔙 ተመለስ", "back_main")],
      ])},
    );
  }

  if (step === "SEND_NOTE") {
    const { sendRoute } = ctx.session;
    ctx.session = {};
    const ready = await Reg.find({ routeId: sendRoute, status: "approved" }).lean();
    if (!ready.length) return ctx.reply("ፈቃድ ያለው ምዝገባ የለም");
    const ro = byRoute(sendRoute), note = txt;
    for (const r of ready) {
      await Reg.findByIdAndUpdate(r._id, { status: "sent" });
      bot.telegram.sendMessage(r.userId,
        `*ጭነትዎ ተልኳል!*\n${ro?.emoji} ${ro?.label}\n\n${note}\n\nለጥያቄ: ${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" }).catch(() => {});
    }
    await ctx.reply(`✅ ${ready.length} ሰው ታወቀ — ${ro?.label}`);
    return;
  }

  if (step === "COL_LOC") return next();
  return next();
});

/* ─── 20. LOCATION ──────────────────────────────────────── */
bot.on("location", async (ctx, next) => {
  const { step } = ctx.session || {};
  const { latitude: lat, longitude: lng } = ctx.message.location;

  if (step === "COL_LOC") {
    const { colRoute } = ctx.session;
    ctx.session = {};
    const ro = byRoute(colRoute);
    if (!ro) return;
    const approved = await Reg.find({ routeId: colRoute, status: "approved", locationLat: { $ne: null } }).lean();
    if (!approved.length) return ctx.reply(`${ro.label} — አድራሻ ያላቸው ፈቃድ ያለው ምዝገባ የለም`);
    const nearby = approved
      .map((r) => {
        const dlat = r.locationLat - lat, dlng = r.locationLng - lng;
        return { ...r, dist: Math.sqrt(dlat * dlat + dlng * dlng) * 111 };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);
    let txt = `${ro.emoji} *${ro.label}* — ቅርብ ደንበኞች\n━━━━━━━━━━━━━━━━\n\n`;
    for (const r of nearby)
      txt += `${r.fullName} | ${r.phone} | ${r.weightKg}ኪ | ${r.dist.toFixed(1)}ኪሜ | ሰፈር: ${r.neighborhood || "—"}\n[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})\n\n`;
    return ctx.reply(txt, { parse_mode: "Markdown" });
  }

  if (step === "LOC") {
    const regId = ctx.session.locRegId;
    ctx.session  = {};
    const r = await Reg.findByIdAndUpdate(regId, { locationLat: lat, locationLng: lng }, { new: true });
    if (!r) return ctx.reply("ምዝገባ አልተገኘም", await mainKb(ctx.from?.id));
    const total = await routeWeight(r.routeId), ro2 = byRoute(r.routeId);
    await ctx.reply(
      `*ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n\n${ro2?.emoji} *${ro2?.label}*\n${capLine(total, ro2?.targetKg || TARGET_KG_DEFAULT)}\n\nጭነቱ ሲሞላ ቤትዎ ይሰበሰብለዎታል\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid, `አድራሻ ደረሰ: ${r.fullName} (${r.phone}) | ሰፈር: ${r.neighborhood || "—"} → ${ro2?.label}`).catch(() => {});
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }
  return next();
});

bot.hears("⏭️ ሳላጋራ ጨርስ", async (ctx) => {
  if (ctx.session?.step !== "LOC") return ctx.reply("አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
  const regId = ctx.session.locRegId;
  ctx.session  = {};
  await ctx.reply(
    `*ምዝገባ ተጠናቀቀ!*\n\nአድራሻ ኋላ ለማጨምር:\n"📋 የምዝገባ ዝርዝሬ" → "አድራሻ ላክ"\n\n${SUPPORT_PHONE}`,
    await mainKb(ctx.from?.id),
  );
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r)
      for (const aid of ADMIN_IDS)
        bot.telegram.sendMessage(aid, `አድራሻ አልተላከም — ${r.fullName} (${r.phone}) | ሰፈር: ${r.neighborhood || "—"}`).catch(() => {});
  }
});

/* ─── 21. PAYMENT PHOTO ─────────────────────────────────── */
bot.on("photo", async (ctx) => {
  const { step, locRegId, gbProductId, gbName, gbPhone, gbPhoneUnverified, gbNeighborhood, gbKg } = ctx.session || {};
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  /* ── GB ክፍያ ፎቶ ──────────────────────────────────────── */
  if (step === "GB_AWAIT_PHOTO" && gbProductId) {
    const prod       = byProduct(gbProductId);
    const ul         = unitLabel(prod);
    const serviceFee = Math.round(gbKg * REG_PER_KG);

    await ctx.reply("📸 ፎቶ ደርሷል — ፍተሻ ይካሄዳል... ⏳");

    const fakeReg = { totalPrice: serviceFee, paymentMethod: null };
    const verdict = await checkPayment(fileId, fakeReg);
    const autoOk  = AI_AUTO_APPROVE && checkOk(verdict);

    if (!autoOk && verdict && !verdict.amount_match && !verdict.account_match) {
      await ctx.reply(
        `❌ *ክፍያ አልተረጋገጠም*\n\nፍተሻ: ${verdict.reason || "ሂሳቡ ወይም ቁጥሩ አይዛመድም"}\n\nእባክዎ ትክክለኛ screenshot ይላኩ።`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    const totalCost = Math.round(gbKg * (prod?.pricePerKg || 0));
    const gbReg = await GBReg.create({
      userId:          ctx.from.id,
      username:        ctx.from.username || "",
      productId:       gbProductId,
      fullName:        gbName,
      phone:           gbPhone,
      neighborhood:    gbNeighborhood || "",
      phoneUnverified: gbPhoneUnverified || false,
      weightKg:        gbKg,
      totalCost,
      pricePerKg:      prod?.pricePerKg || 0,
      paymentFileId:   fileId,
      paymentStatus:   autoOk ? "approved" : "reviewing",
      aiVerdict:       verdict,
    });
    ctx.session = {};

    const agg      = await GBReg.aggregate([{ $match: { productId: gbProductId } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg    = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;

    /* "ምዝገባ ተጠናቀቀ" shown ONLY after payment is verified */
    await ctx.reply(
      autoOk
        ? `✅ *ክፍያ ተረጋገጠ — ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n` +
          `${prod?.emoji} *${prod?.label}* — ${gbKg} ${ul}\n` +
          `👤 ${gbName}  |  📞 ${gbPhone}\n🏘 ሰፈር: ${gbNeighborhood || "—"}\n\n` +
          `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
          `👥 ተሳታፊ: ${regCount} ሰው\n\n` +
          `✨ _ምዝገባ ሲሞላ እናሳውቅዎታለን!_\n📞 ${SUPPORT_PHONE}`
        : `⏳ ፎቶ ደርሷል። ክፍያ ሰራተኛ ያረጋግጣሉ — ምዝገባ ከተረጋገጠ እናሳውቅዎታለን.\n📞 ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );

    /* ቻናል ጋብዣ — ክፍያ ሲረጋገጥ ወዲያው ይላካሉ */
    if (autoOk) sendChannelInvite(ctx.from.id).catch(() => {});

    /* Admin gets internal detail */
    const gbCaption = `${checkSummaryAdmin(verdict)}\n\nGB: ${prod?.emoji}${prod?.label} — ${gbName} (${gbPhone})\nሰፈር: ${gbNeighborhood || "—"} — ${gbKg}${ul}\nክፍያ: ${serviceFee} ብር${autoOk ? "\n✅ ፍተሻ አልፏል" : ""}`;
    for (const aid of ADMIN_IDS)
      bot.telegram.sendPhoto(aid, fileId, { caption: gbCaption, parse_mode: "Markdown" }).catch(() => {});

    if (gbPhoneUnverified)
      for (const aid of ADMIN_IDS)
        bot.telegram.sendMessage(aid,
          `⚠️ *GB ስልክ ማረጋገጫ ያስፈልጋል*\n\nስም: ${gbName}\nስልክ: \`${gbPhone}\`\nሰፈር: ${gbNeighborhood || "—"}\nምርት: ${prod?.label} — ${gbKg}${ul}`,
          { parse_mode: "Markdown", ...phoneVerifyKb(String(gbReg._id)) },
        ).catch(() => {});

    checkGBCapacity(gbProductId).catch(() => {});
    return;
  }

  /* ── Cargo ክፍያ ፎቶ ───────────────────────────────────── */
  let r;
  if (locRegId) {
    r = await Reg.findById(locRegId);
  } else {
    r = await Reg.findOne({ userId: ctx.from.id, status: "pending" }).sort({ createdAt: -1 });
  }
  if (!r) return ctx.reply("ምዝገባ አልተገኘም። አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
  r.paymentFileId = fileId;
  r.status        = "reviewing";
  await r.save();

  await ctx.reply("📸 ፎቶ ደርሷል — ፍተሻ ይካሄዳል... ⏳");

  const verdict = await checkPayment(fileId, r);
  r.aiVerdict = verdict;
  const autoOk = AI_AUTO_APPROVE && checkOk(verdict);
  if (autoOk) { r.status = "approved"; r.autoApproved = true; }
  await r.save();

  /* "ምዝገባ ተጠናቀቀ" shown ONLY after payment verified */
  bot.telegram.sendMessage(
    ctx.from.id,
    autoOk
      ? `✅ *ክፍያ ተረጋገጠ — ምዝገባ ተጠናቀቀ!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`
      : `⏳ ፎቶ ደርሷል። ሰራተኛ ያረጋግጣሉ — ምዝገባ ከተረጋገጠ እናሳውቅዎታለን.\n${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" },
  ).catch(() => {});

  /* ቻናል ጋብዣ */
  if (autoOk) sendChannelInvite(ctx.from.id).catch(() => {});

  ctx.session = { step: "LOC", locRegId: String(r._id), locTries: 0 };
  await ctx.reply("📍 አድራሻዎን ያጋሩ — ቤትዎ ይሰበሰብለዎታል:", locKb());

  const caption = checkSummaryAdmin(verdict) + "\n\n" + (autoOk ? "✅ ፍተሻ አልፏል\n\n" : "") + card(r.toObject(), true);
  const kb      = Markup.inlineKeyboard([[
    Markup.button.callback(autoOk ? "ሰርዝ" : "ፈቀድ", autoOk ? `no_${r._id}` : `ok_${r._id}`),
    Markup.button.callback("ከልክል", `no_${r._id}`),
  ]]);
  for (const aid of ADMIN_IDS)
    bot.telegram.sendPhoto(aid, fileId, { caption, parse_mode: "Markdown", ...kb }).catch(() => {});
});

/* ─── 22. ADMIN PANEL ───────────────────────────────────── */
function adminPanelKb(grpOn) {
  const grpIcon = grpOn ? "🟢" : "🔴";
  return Markup.inlineKeyboard([
    [Markup.button.callback("አዲስ አበባ → አማራ ክልል ምዝገቦች",     "lst_dir_toamhara")],
    [Markup.button.callback("አማራ ክልል → አዲስ አበባ ምዝገቦች",     "lst_dir_toaa")],
    [Markup.button.callback("ያልተፈቀዱ ክፍያዎች",                   "lst_pay")],
    [Markup.button.callback("⚠️ ያልተረጋገጡ ስልኮች",               "lst_unverified_phones")],
    [Markup.button.callback("📍 ጭነት ሰብሳቢ (አቅራቢያ ዝርዝር)",      "col_pick")],
    [Markup.button.callback("📦 ጭነት ላክ (ለደንበኞች ማሳወቂያ)",      "snd_pick")],
    [Markup.button.callback("📊 የጭነት ሪፖርት",                    "admin_report")],
    [Markup.button.callback("🏘 በሰፈር ይመልከቱ",                  "lst_by_neighborhood")],
    [Markup.button.callback("📢 ቻናል ማስታወቂያ",                  "channel_panel")],
    [Markup.button.callback("🖨 ዝርዝር አትም (Print Manifest)",   "print_pick")],
    [Markup.button.callback("📦 የቡድን ግዥ ሁኔታ",                 "gb_status")],
    [Markup.button.callback("➕ GB ኪሎ/ሊትር ጨምር (Admin)",       "admin_gb_addkg")],
    [Markup.button.callback("💵 Cash ምዝገባ (Admin)",             "admin_cash_reg")],
    [Markup.button.callback("📣 ቀሪ ኪሎ ለተጠቃሚዎች ላክ",           "gb_broadcast_remain")],
    [Markup.button.callback("📢 GB ቻናል ማስታወቂያ",              "gb_channel_panel")],
    [Markup.button.callback(`${grpIcon} Group ማስታወቂያ`,        "toggle_group_notify")],
    [Markup.button.callback("💰 ዋጋ ማሻሻያ",                     "price_panel")],
    [Markup.button.callback("📋 ምናሌ አስተዳዳሪ",                   "menu_manager")],
    [Markup.button.callback("📝 Welcome Message ቀይር",          "welcome_edit")],
  ]);
}

bot.hears("🔧 Admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  ctx.session = {};
  const grpOn = await getSetting("group_notify_enabled", true);
  await ctx.reply("*የአስተዳዳሪ ፓነል*", { parse_mode: "Markdown", ...adminPanelKb(grpOn) });
});

/* ─── Admin: GB Add Kg for any user ─────────────────────── */
bot.action("admin_gb_addkg", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const buttons = GB_PRODUCTS.map((p) => {
    const ul = unitLabel(p);
    return [Markup.button.callback(`${p.emoji} ${p.label} (${ul})`, `adm_gbkg_${p.id}`)];
  });
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply("*➕ GB ኪሎ/ሊትር ጨምር — ምርት ምረጡ:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^adm_gbkg_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const prodId = ctx.match[1];
  const prod   = byProduct(prodId);
  if (!prod) return ctx.reply("❌ ምርት አልተገኘም");
  const ul = unitLabel(prod);
  ctx.session = { step: "ADMIN_GB_ADDKG_USERID", adminGBProductId: prodId };
  await ctx.reply(
    `${prod.emoji} *${prod.label}* — ${ul} ማሻሻያ\n\nየደንበኛው Telegram User ID ያስገቡ:`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* ─── Admin: Cash Registration ───────────────────────────── */
bot.action("admin_cash_reg", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const buttons = GB_PRODUCTS.map((p) => {
    const ul = unitLabel(p);
    return [Markup.button.callback(`${p.emoji} ${p.label} (${ul})`, `cash_prod_${p.id}`)];
  });
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply(
    `*💵 Cash ምዝገባ — ምርት ምረጡ:*\n\n_ደንበኛ ቢሮ / ቦታ ላይ ብር ከፍሎ ሲጨርስ ይጠቀሙ_`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
});

bot.action(/^cash_prod_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const prodId = ctx.match[1];
  const prod   = byProduct(prodId);
  if (!prod) return ctx.reply("❌ ምርት አልተገኘም");
  ctx.session = { step: "ADMIN_CASH_NAME", cashProductId: prodId };
  await ctx.reply(
    `${prod.emoji} *${prod.label}* — Cash ምዝገባ\n\n👤 ደንበኛው ሙሉ ስም:`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* ─── Phone Verification ─────────────────────────────────── */
bot.action(/^ph_ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("✅ ስልክ ተረጋግጧል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  let r = await Reg.findByIdAndUpdate(id, { phoneUnverified: false }, { new: true }).catch(() => null);
  if (!r) r = await GBReg.findByIdAndUpdate(id, { phoneUnverified: false }, { new: true }).catch(() => null);
  if (!r) return ctx.reply("ምዝገባ አልተገኘም");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`✅ ስልክ ተረጋግጧል — ${r.fullName} (${r.phone})`);
  bot.telegram.sendMessage(r.userId,
    `✅ ስልክ ቁጥርዎ ተረጋግጧል — ምዝገባዎ ቀጥሏል.\n${SUPPORT_PHONE}`,
  ).catch(() => {});
});

bot.action(/^ph_no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("❌ ስልክ ተቀባይነት አልተሰጠ").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  let r = await Reg.findByIdAndUpdate(id, { status: "rejected" }, { new: true }).catch(() => null);
  if (!r) r = await GBReg.findByIdAndUpdate(id, { paymentStatus: "rejected" }, { new: true }).catch(() => null);
  if (!r) return ctx.reply("ምዝገባ አልተገኘም");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`❌ ምዝገባ ተሰርዟል — ${r.fullName} (${r.phone}) ስልክ ትክክል አይደለም`);
  bot.telegram.sendMessage(r.userId,
    `❌ ስልክ ቁጥርዎ ተቀባይነት አላገኘም — እባክዎ ትክክለኛ ስልክ ቁጥር ይጠቀሙ.\n${SUPPORT_PHONE}`,
  ).catch(() => {});
});

bot.action("lst_unverified_phones", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const list   = await Reg.find({ phoneUnverified: true }).sort({ createdAt: -1 }).lean();
  const gbList = await GBReg.find({ phoneUnverified: true }).sort({ createdAt: -1 }).lean();
  if (!list.length && !gbList.length) return ctx.reply("✅ ያልተረጋገጠ ስልክ የለም");
  for (const r of list)
    await ctx.reply(
      `Cargo — ${r.fullName}\nስልክ: \`${r.phone}\`\nሰፈር: ${r.neighborhood || "—"}\nአቅጣጫ: ${byRoute(r.routeId)?.label || r.routeId}`,
      { parse_mode: "Markdown", ...phoneVerifyKb(String(r._id)) },
    );
  for (const g of gbList) {
    const prod = byProduct(g.productId);
    await ctx.reply(
      `GB — ${g.fullName}\nስልክ: \`${g.phone}\`\nሰፈር: ${g.neighborhood || "—"}\nምርት: ${prod?.label || g.productId}`,
      { parse_mode: "Markdown", ...phoneVerifyKb(String(g._id)) },
    );
  }
});

/* ─── By Neighborhood ────────────────────────────────────── */
bot.action("lst_by_neighborhood", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const nbrs = await Reg.distinct("neighborhood", { status: { $in: ACTIVE } });
  if (!nbrs.length) return ctx.reply("ምዝገባ የለም");
  const buttons = nbrs
    .filter(Boolean)
    .map((n) => [Markup.button.callback(`🏘 ${n}`, `nbr_list_${n}`)]);
  buttons.push([Markup.button.callback("ሁሉም ሰፈሮች", "nbr_list_all")]);
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply("*በሰፈር ይምረጡ:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^nbr_list_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const raw = ctx.match[1];
  const nbr = raw === "all" ? null : raw;
  const query = nbr
    ? { neighborhood: nbr, status: { $in: ACTIVE } }
    : { status: { $in: ACTIVE } };
  const list = await Reg.find(query).sort({ neighborhood: 1, createdAt: -1 }).lean();
  if (!list.length) return ctx.reply("ምዝገባ አልተገኘም");
  const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
  await ctx.reply(
    `🏘 *${nbr || "ሁሉም ሰፈሮች"}*\n${list.length} ሰው | ${totalKg} ኪሎ`,
    { parse_mode: "Markdown" },
  );
  const grouped = {};
  for (const r of list) {
    const key = r.neighborhood || "—";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  for (const [area, regs] of Object.entries(grouped)) {
    if (Object.keys(grouped).length > 1) {
      const aKg = regs.reduce((s, r) => s + (r.weightKg || 0), 0);
      await ctx.reply(`━━ 🏘 *${area}* — ${regs.length} ሰው | ${aKg}ኪሎ ━━`, { parse_mode: "Markdown" });
    }
    for (const r of regs.slice(0, 20))
      await ctx.reply(card(r, true), { parse_mode: "Markdown", ...(r.status === "reviewing" ? approveKb(r._id) : {}) });
  }
});

/* ─── Price Panel ───────────────────────────────────────── */
bot.action("price_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const buttons = GB_PRODUCTS.map((p) => {
    const ul = unitLabel(p);
    return [Markup.button.callback(`${p.emoji} ${p.label} — ${p.pricePerKg} ብር/${ul}`, `adm_setprice_${p.id}`)];
  });
  buttons.push([Markup.button.callback("↩️ ተመለስ", "back_to_admin")]);
  await ctx.reply(`💰 *ዋጋ ማሻሻያ*\n━━━━━━━━━━━━━━━━\nየትኛውን ምርት ዋጋ ለመቀየር?`, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^adm_setprice_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const prodId = ctx.match[1];
  const prod   = byProduct(prodId);
  if (!prod) return ctx.reply("❌ ምርት አልተገኘም");
  const ul = unitLabel(prod);
  ctx.session = { step: "ADMIN_PRICE", adminPriceId: prodId };
  await ctx.reply(`${prod.emoji} *${prod.label}*\nአሁናዊ ዋጋ: *${prod.pricePerKg} ብር/${ul}*\n\nአዲስ ዋጋ ያስገቡ (ብር):`, { parse_mode: "Markdown", ...backKb() });
});

bot.action("back_to_admin", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  const grpOn = await getSetting("group_notify_enabled", true);
  await ctx.reply("*የአስተዳዳሪ ፓነል*", { parse_mode: "Markdown", ...adminPanelKb(grpOn) });
});

bot.action("toggle_group_notify", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const current = await getSetting("group_notify_enabled", true);
  const next    = !current;
  await setSetting("group_notify_enabled", next);
  const icon = next ? "🟢" : "🔴", label = next ? "ተነቃቁ (ON)" : "ተዘጋ (OFF)";
  await ctx.reply(`${icon} *Group ማስታወቂያ — ${label}*\n\n` + (next ? `ደንበኛ ሲመዘገብ ወዲያው ወደ Group ይላካል።\n_(GROUP_ID: ${GROUP_ID || "አልተቀመጠም"})_` : `Group ማስታወቂያ ቆሟል — ምዝገባ ለ Channel/Admin ብቻ ይላካል።`), { parse_mode: "Markdown" });
});

/* ── Welcome Message Editor ──────────────────────────────── */
bot.action("welcome_edit", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const current = await getSetting("welcome_message", null);
  ctx.session   = { step: "ADMIN_WELCOME" };
  await ctx.reply(
    `📝 *Welcome Message ቀይር*\n━━━━━━━━━━━━━━━━\n\n` +
    (current ? `*አሁናዊ መልዕክት:*\n${current}` : `_Default_\n\n${defaultWelcomeText("[ስም]")}`) +
    `\n\n━━━━━━━━━━━━━━━━\n👇 *አዲሱን መልዕክት* ይላኩ። \`{name}\` እና \`{fee}\` ይጠቀሙ\n\nወደ default: /resetwelcome`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.command("resetwelcome", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await setSetting("welcome_message", null);
  ctx.session = {};
  await ctx.reply("✅ Welcome Message ወደ default ተመልሷል।", { parse_mode: "Markdown" });
});

/* ── Menu Manager ────────────────────────────────────────── */
bot.action("menu_manager", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await sendMenuManagerPanel(ctx);
});

async function sendMenuManagerPanel(ctx) {
  const states  = await Promise.all(MENU_SETTINGS.map((m) => getSetting(m.key, true)));
  const buttons = MENU_SETTINGS.map((m, i) => {
    const on = states[i];
    return [Markup.button.callback(`${on ? "🟢" : "🔴"} ${m.emoji} ${m.label}`, `tmitem_${m.key}`)];
  });
  buttons.push([Markup.button.callback("🔴 ሁሉንም ጥፋ", "tmall_off"), Markup.button.callback("🟢 ሁሉንም ብራ", "tmall_on")]);
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  const lines = MENU_SETTINGS.map((m, i) => `${states[i] ? "🟢" : "🔴"} ${m.emoji} ${m.label}`).join("\n");
  await ctx.reply(`*📋 ምናሌ አስተዳዳሪ*\n━━━━━━━━━━━━━━━━\n\n${lines}\n\n_ቁልፍ ይጫኑ ለመቀያየር:_`, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
}

bot.action(/^tmitem_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const key  = ctx.match[1];
  const item = MENU_SETTINGS.find((m) => m.key === key);
  if (!item) return;
  const current = await getSetting(key, true);
  await setSetting(key, !current);
  await ctx.reply(`${item.emoji} *${item.label}*\n${!current ? "🟢 ተከፈተ" : "🔴 ተዘጋ"}`, { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

bot.action("tmall_on", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, true)));
  await ctx.reply("🟢 ሁሉም ምናሌዎች ተከፍቷል");
  await sendMenuManagerPanel(ctx);
});

bot.action("tmall_off", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, false)));
  await ctx.reply("🔴 ሁሉም ምናሌዎች ተዘግቷል");
  await sendMenuManagerPanel(ctx);
});

/* ── GB Confirm ──────────────────────────────────────────── */
bot.action("gb_confirm_yes", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbProductId, gbName, gbPhone, gbPhoneUnverified, gbNeighborhood, gbKg } = ctx.session || {};
  if (!gbProductId || !gbKg) return ctx.reply("ምዝገባ ተሰርዟል — ዳግም ይሞክሩ");
  ctx.session = { step: "GB_AWAIT_PHOTO", gbProductId, gbName, gbPhone, gbPhoneUnverified, gbNeighborhood, gbKg };
  const prod       = byProduct(gbProductId), ul = unitLabel(prod);
  const serviceFee = Math.round(gbKg * REG_PER_KG);
  await ctx.reply(
    `💳 *${serviceFee} ብር* ወደ አንዱ ይክፈሉ:\n\n` +
    METHODS.map((m) => `${m.emoji} *${m.label}:*\n\`${m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info}\``).join("\n\n") +
    `\n\n📸 ክፍያ ከፍሎ *screenshot* ይላኩ — ፎቶ ብቻ!\n\n` +
    `_ምዝገባ የሚጠናቀቀው ክፍያዎ ከተረጋገጠ በኋላ ነው_`,
    { parse_mode: "Markdown" },
  );
});

bot.action("gb_confirm_no", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.reply("ምዝገባ ተሰርዟል.", await mainKb(ctx.from?.id));
});

/* ── GB Add Kg ───────────────────────────────────────────── */
bot.action(/^gb_addkg_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const g = await GBReg.findById(id).lean();
  if (!g || g.userId !== ctx.from?.id) return;
  ctx.session = { step: "GB_ADDKG", gbAddId: id, gbAddOldKg: g.weightKg, gbAddProductId: g.productId };
  const prod = byProduct(g.productId), ul = unitLabel(prod);
  await ctx.reply(`${prod?.emoji} *${prod?.label}* — አሁን: *${g.weightKg} ${ul}*\n\nአዲስ ጠቅላላ ${ul} ያስገቡ:`, { parse_mode: "Markdown", ...backKb() });
});

bot.action("gb_addkg_confirm", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbAddId, gbAddNewKg, gbAddDiffKg, gbAddDiffFee, gbAddProductId } = ctx.session || {};
  if (!gbAddId || !isValidObjectId(gbAddId)) { ctx.session = {}; return ctx.reply("ስህተት — ዳግም ይሞክሩ"); }
  const prod = byProduct(gbAddProductId), ul = unitLabel(prod);
  await GBReg.findByIdAndUpdate(gbAddId, { weightKg: gbAddNewKg, $inc: { totalCost: gbAddDiffKg * (prod?.pricePerKg || 0) } });
  ctx.session = { step: "GB_AWAIT_PHOTO", gbProductId: gbAddProductId, gbKg: gbAddDiffKg, gbAddMode: true };
  const serviceFee = gbAddDiffFee;
  await ctx.reply(
    `✅ *${ul} ታሻሽሏል!* — አሁን ${gbAddNewKg} ${ul}\n\n` +
    `💳 ተጨማሪ ክፍያ *${serviceFee} ብር* ይክፈሉ:\n\n` +
    METHODS.map((m) => `${m.emoji} *${m.label}:*\n\`${m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info}\``).join("\n\n") +
    `\n\n📸 *screenshot* ይላኩ:`,
    { parse_mode: "Markdown" },
  );
});

bot.action("gb_addkg_cancel", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.reply(`${ctx.session?.gbAddProductId ? unitLabel(byProduct(ctx.session?.gbAddProductId)) : "ኪሎ"} ማሻሻያ ተሰርዟል.`, await mainKb(ctx.from?.id));
});

/* ── GB Status for admin ─────────────────────────────────── */
bot.action("gb_status", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = "*📦 የቡድን ግዥ ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n";
  for (const prod of GB_PRODUCTS) {
    const ul  = unitLabel(prod);
    const res = await GBReg.aggregate([{ $match: { productId: prod.id } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg = res[0]?.kg || 0, regCount = res[0]?.count || 0;
    txt += `${prod.emoji} *${prod.label}*\n${capLine(regKg, prod.targetKg, ul)}\n👥 ${regCount} ሰው\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* ── GB Broadcast remain ─────────────────────────────────── */
bot.action("gb_broadcast_remain", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let sent = 0;
  for (const prod of GB_PRODUCTS) {
    const ul  = unitLabel(prod);
    const res = await GBReg.aggregate([{ $match: { productId: prod.id } }, { $group: { _id: null, kg: { $sum: "$weightKg" } } }]);
    const regKg = res[0]?.kg || 0;
    if (regKg >= prod.targetKg) continue;
    const remain  = prod.targetKg - regKg;
    const members = await GBReg.find({ productId: prod.id }).lean();
    const unique  = [...new Map(members.map((m) => [m.userId, m])).values()];
    for (const m of unique) {
      bot.telegram.sendMessage(m.userId,
        `${prod.emoji} *${prod.label}* — ቀሪ *${remain} ${ul}*\n${capLine(regKg, prod.targetKg, ul)}\n\nተጨማሪ ${ul} ይጨምሩ — ምዝገባ ሲሞላ ወዲያው ይዘዛሉ!`,
        { parse_mode: "Markdown" },
      ).catch(() => {});
      sent++;
    }
  }
  await ctx.reply(`✅ ቀሪ ሁኔታ ለ ${sent} ሰው ተልኳል`);
});

/* ── GB Channel ──────────────────────────────────────────── */
bot.action("gb_channel_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  await ctx.reply("*📢 GB ቻናል ማስታወቂያ*\n\nምርት ምረጥ:", Markup.inlineKeyboard([
    ...GB_PRODUCTS.map((p) => [Markup.button.callback(`${p.emoji} ${p.label}`, `gb_ch_ann_${p.id}`)]),
    [Markup.button.callback("📢 ሁሉንም ምርቶች ላክ", "gb_ch_ann_all")],
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});

bot.action(/^gb_ch_ann_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  const targetId  = ctx.match[1];
  const products  = targetId === "all" ? GB_PRODUCTS : [byProduct(targetId)].filter(Boolean);
  let msg = `*🛒 የቡድን ግዥ — አሁናዊ ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n`;
  for (const prod of products) {
    const ul  = unitLabel(prod);
    const res = await GBReg.aggregate([{ $match: { productId: prod.id } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg = res[0]?.kg || 0, regCount = res[0]?.count || 0;
    msg += `${prod.emoji} *${prod.label}*\n💰 ${prod.pricePerKg} ብር/${ul}\n📋 አገልግሎት ክፍያ: ${REG_PER_KG} ብር/${ul}\n${capLine(regKg, prod.targetKg, ul)}\n👥 ${regCount} ሰው\n\n`;
  }
  msg += `✅ *እርስዎ የሚከፍሉት ትንሽ የ አገልግሎት ክፍያ ብቻ ነው!*\n_የምርት እና የትራንስፖርት ክፍያ — ምዝገባ ሲሞላ እናሳውቅዎታለን_\n\nለምዝገባ ቦቱን ይጠቀሙ | ${SUPPORT_PHONE}`;
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: "Markdown" });
    await ctx.reply("✅ ቻናል ማስታወቂያ ተልኳል");
  } catch (e) {
    await ctx.reply(`❌ አልተሳካም: ${e.message}`);
  }
});

/* ── Route lists ─────────────────────────────────────────── */
bot.action("lst_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል — መስመር ምረጥ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});
bot.action("lst_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ — መስመር ምረጥ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});

bot.action("lst_pay", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const list = await Reg.find({ status: "reviewing" }).sort({ createdAt: 1 }).lean();
  if (!list.length) return ctx.reply("ያልተፈቀደ ክፍያ የለም");
  for (const r of list) {
    const txt = checkSummaryAdmin(r.aiVerdict) + "\n\n" + card(r, true);
    if (r.paymentFileId)
      await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: "Markdown", ...approveKb(r._id) });
    else await ctx.reply(txt, { parse_mode: "Markdown", ...approveKb(r._id) });
  }
});

bot.action(/^lst_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const list = await Reg.find({ routeId: ro.id }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);
  const cnt = {};
  list.forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const total = await routeWeight(ro.id);
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n${list.length} ሰው | ፈቃድ: ${cnt.approved||0} | ፍተሻ: ${cnt.reviewing||0} | ያልከፈለ: ${cnt.pending||0} | ተልኳል: ${cnt.sent||0}\n${capLine(total, ro.targetKg)}`,
    { parse_mode: "Markdown" },
  );
  for (const r of list) {
    const kb = r.status === "reviewing"
      ? approveKb(r._id)
      : r.status === "approved"
        ? Markup.inlineKeyboard([[Markup.button.callback("ሰርዝ", `no_${r._id}`)]])
        : {};
    await ctx.reply(card(r, true), { parse_mode: "Markdown", ...kb });
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status: newStatus }, { new: true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? "editMessageCaption" : "editMessageText";
  await ctx[fn](card(r.toObject(), true), { parse_mode: "Markdown" }).catch(() => {});
  if (notifyFn) bot.telegram.sendMessage(r.userId, notifyFn(r), { parse_mode: "Markdown" }).catch(() => {});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("ተፈቅዷል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  await setStatus(ctx, id, "approved",
    (r) => `*ክፍያ ተረጋገጠ — ምዝገባ ተጠናቀቀ!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`,
  );
  /* ቻናል ጋብዣ — admin manually approves */
  const r2 = await Reg.findById(id).lean().catch(() => null);
  if (r2?.userId) sendChannelInvite(r2.userId).catch(() => {});
});
bot.action(/^no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("አልተቀበለም").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  await setStatus(ctx, id, "rejected", () => `ክፍያ አልተቀበለም.\n${SUPPORT_PHONE}`);
});

bot.action(/^del_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const r = await Reg.findById(id);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === "sent") return ctx.reply("ጭነቱ ተልኳል — መሰረዝ አይቻልም");
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply("ምዝገባ ተሰርዟል. ለመመዝገብ አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
});

/* ── Send shipment ──────────────────────────────────────── */
bot.action("snd_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("ምን አቅጣጫ?", Markup.inlineKeyboard([
    [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "snd_dir_toamhara")],
    [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "snd_dir_toaa")],
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});
bot.action("snd_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "snd_pick")],
  ]));
});
bot.action("snd_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "snd_pick")],
  ]));
});
bot.action(/^snd_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const ready = await Reg.find({ routeId: ro.id, status: "approved" }).lean();
  if (!ready.length) return ctx.reply("ፈቃድ ያለው ምዝገባ የለም");
  const total = ready.reduce((s, r) => s + (r.weightKg || 0), 0);
  ctx.session  = { step: "SEND_NOTE", sendRoute: ro.id };
  await ctx.reply(`${ro.label} | ${ready.length} ሰው | ${total} ኪሎ\n\nለደንበኞች ማስታወሻ ያስገቡ:`, backKb());
});

/* ── Report ─────────────────────────────────────────────── */
bot.action("admin_report", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = "*የጭነት ሪፖርት*\n━━━━━━━━━━━━━━━━\n\n*አዲስ አበባ → አማራ ክልል*\n";
  for (const ro of ROUTES_TO_AMHARA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    const m = {}; counts.forEach((c) => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\nፈቃድ: ${m.approved||0} | ፍተሻ: ${m.reviewing||0} | ያልከፈለ: ${m.pending||0} | ተልኳል: ${m.sent||0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  txt += "*አማራ ክልል → አዲስ አበባ*\n";
  for (const ro of ROUTES_TO_AA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    const m = {}; counts.forEach((c) => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\nፈቃድ: ${m.approved||0} | ፍተሻ: ${m.reviewing||0} | ያልከፈለ: ${m.pending||0} | ተልኳል: ${m.sent||0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* ── Collector ──────────────────────────────────────────── */
bot.action("col_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አቅጣጫ ምረጥ:", Markup.inlineKeyboard([
    [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "col_dir_toamhara")],
    [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "col_dir_toaa")],
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});
bot.action("col_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "col_pick")],
  ]));
});
bot.action("col_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "col_pick")],
  ]));
});
bot.action(/^col_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "COL_LOC", colRoute: ctx.match[1] };
  await ctx.reply("ያሉበትን ቦታ ያጋሩ:", locKb());
});

/* ── Print ──────────────────────────────────────────────── */
bot.action("print_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አቅጣጫ ምረጥ:", Markup.inlineKeyboard([
    [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "prnt_dir_toamhara")],
    [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "prnt_dir_toaa")],
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});
bot.action("prnt_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "print_pick")],
  ]));
});
bot.action("prnt_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "print_pick")],
  ]));
});
bot.action(/^prnt_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await handlePrint(ctx, ctx.match[1]);
});

/* ── Channel ────────────────────────────────────────────── */
bot.action("channel_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(`ቻናል: ${CHANNEL_ID || "አልተቀመጠም"}`, Markup.inlineKeyboard([
    [Markup.button.callback("ፍተሻ ላክ",                         "ch_test")],
    [Markup.button.callback("አዲስ አበባ → አማራ ክልል ማስታወቂያ",     "ch_dir_toamhara")],
    [Markup.button.callback("አማራ ክልል → አዲስ አበባ ማስታወቂያ",     "ch_dir_toaa")],
    [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
  ]));
});
bot.action("ch_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "channel_panel")],
  ]));
});
bot.action("ch_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "channel_panel")],
  ]));
});
bot.action("ch_test", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  try { await bot.telegram.sendMessage(CHANNEL_ID, "ፍተሻ ተሳክቷል"); await ctx.reply("ተሳክቷል"); }
  catch (e) { await ctx.reply(`አልተሳካም: ${e.message}`); }
});
bot.action(/^ch_ann_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);
  try {
    await bot.telegram.sendMessage(CHANNEL_ID,
      `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\nቀጥታ ከ ገበሬዎች — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    );
    await ctx.reply(`ተልኳል — ${ro.label}`);
  } catch (e) {
    await ctx.reply(`አልተሳካም: ${e.message}`);
  }
});

/* ── Admin commands ─────────────────────────────────────── */
bot.command("report_now", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await sendDailyReport();
  await ctx.reply("ሪፖርት ተልኳል");
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const now   = new Date();
  const date  = now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  let toAmharaKg = 0, toAmharaPeople = 0, toAmharaRev = 0, toAAKg = 0, toAAPeople = 0, toAArev = 0;
  let txt = `*Quick Stats* — ${date}\n━━━━━━━━━━━━━━━━━━━━\n\n*አዲስ አበባ → አማራ ክልል*\n`;
  for (const ro of ROUTES_TO_AMHARA) {
    const agg = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } }]);
    const m   = {};
    agg.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0);
    const kg     = ["pending","reviewing","approved","sent"].reduce((s, st) => s + (m[st]?.kg||0), 0);
    const rev    = kg * SHIP_PER_KG;
    toAmharaKg += kg; toAmharaPeople += people; toAmharaRev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n   ${people} ሰው | ${kg}ኪ | ፈቃድ: ${m.approved?.n||0} | ፍተሻ: ${m.reviewing?.n||0} | ያልከፈለ: ${m.pending?.n||0} | ተልኳል: ${m.sent?.n||0}\n   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }
  txt += `\n*አማራ ክልል → አዲስ አበባ*\n`;
  for (const ro of ROUTES_TO_AA) {
    const agg = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } }]);
    const m   = {};
    agg.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0);
    const kg     = ["pending","reviewing","approved","sent"].reduce((s, st) => s + (m[st]?.kg||0), 0);
    const rev    = kg * SHIP_PER_KG;
    toAAKg += kg; toAAPeople += people; toAArev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n   ${people} ሰው | ${kg}ኪ | ፈቃድ: ${m.approved?.n||0} | ፍተሻ: ${m.reviewing?.n||0} | ያልከፈለ: ${m.pending?.n||0} | ተልኳል: ${m.sent?.n||0}\n   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }
  const gP = toAmharaPeople + toAAPeople, gK = toAmharaKg + toAAKg, gR = toAmharaRev + toAArev, gReg = gK * REG_PER_KG;
  txt += `\n━━━━━━━━━━━━━━━━━━━━\n*ጠቅላላ ድምር*\n${gP} ሰው | ${gK} ኪሎ\nምዝ: ${gReg.toLocaleString()} ብ | ጭ: ${gR.toLocaleString()} ብ | ድምር: ${(gReg+gR).toLocaleString()} ብ`;
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!text) return ctx.reply("አጠቃቀም: /broadcast መልዕክት");
  const users = await Reg.distinct("userId", { status: { $nin: ["rejected"] } });
  let sent = 0, failed = 0;
  for (const uid of users) {
    try { await bot.telegram.sendMessage(uid, `${text}\n\n${SUPPORT_PHONE}`, { parse_mode: "Markdown" }); sent++; }
    catch { failed++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`ተልኳል: ${sent} | አልደረሳቸውም: ${failed}`);
});

bot.command("prices", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const lines = GB_PRODUCTS.map((p) => {
    const ul = unitLabel(p);
    return `${p.emoji} *${p.label}* (${p.id}) — ${p.pricePerKg} ብር/${ul}`;
  }).join("\n");
  await ctx.reply(
    `*አሁናዊ ዋጋዎች*\n━━━━━━━━━━━━━━━━\n\n${lines}\n\n` +
    `ዋጋ ለመቀየር:\n\`/setprice <id> <ዋጋ>\`\n\nምሳሌ: \`/setprice teff 80\``,
    { parse_mode: "Markdown" },
  );
});

bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `*አጠቃቀም:* \`/setprice <id> <ዋጋ>\`\n\n*ምሳሌ:*\n` +
      GB_PRODUCTS.map((p) => `\`/setprice ${p.id} ${p.pricePerKg}\``).join("\n"),
      { parse_mode: "Markdown" },
    );
  }
  const id    = parts[1].toLowerCase();
  const price = parseFloat(parts[2]);
  const prod  = byProduct(id);
  if (!prod) return ctx.reply(`❌ ምርት አልተገኘም: *${id}*\n\nትክክለኛ IDs: ${GB_PRODUCTS.map((p) => `\`${p.id}\``).join(", ")}`, { parse_mode: "Markdown" });
  if (!price || price <= 0 || price > 100000) return ctx.reply("❌ ትክክለኛ ዋጋ ያስገቡ (ለምሳሌ: 80)");
  const oldPrice  = prod.pricePerKg;
  prod.pricePerKg = price;
  await setSetting(`price_${id}`, price);
  const ul = unitLabel(prod);
  await ctx.reply(`✅ *ዋጋ ተቀይሯል!*\n\n${prod.emoji} *${prod.label}*\nቀድሞ: ${oldPrice} ብር/${ul}\nአሁን: *${price} ብር/${ul}*`, { parse_mode: "Markdown" });
  for (const aid of ADMIN_IDS) {
    if (aid === ctx.from.id) continue;
    bot.telegram.sendMessage(aid, `${prod.emoji} *${prod.label}* ዋጋ ተቀይሯል\n${oldPrice} → *${price}* ብር/${ul}\nበ @${ctx.from.username || ctx.from.first_name}`, { parse_mode: "Markdown" }).catch(() => {});
  }
});

bot.command("exportgb", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const parts      = ctx.message.text.trim().split(/\s+/);
  const filterProd = parts[1]?.toLowerCase() || "all";
  const query      = filterProd === "all" ? {} : { productId: filterProd };
  const records    = await GBReg.find(query).sort({ createdAt: 1 }).lean();
  if (!records.length) return ctx.reply(filterProd === "all" ? "GB ምዝገባ የለም" : `❌ ምርት አልተገኘም: *${filterProd}*`, { parse_mode: "Markdown" });
  const header = "ተ.ቁ,ምርት,ሙሉ ስም,ስልክ,ሰፈር,ኪሎ/ሊትር,ዋጋ/ኪሎ,ጠቅላላ ዋጋ (ብር),ቀን";
  const rows   = records.map((r, i) => {
    const prod = byProduct(r.productId);
    const date = new Date(r.createdAt).toLocaleDateString("en-GB");
    return [i+1, `${prod?.emoji||""} ${prod?.label||r.productId}`, (r.fullName||"").replace(/,/g," "), r.phone||"", (r.neighborhood||"").replace(/,/g," "), r.weightKg, r.pricePerKg, r.totalCost, date].join(",");
  });
  const csv  = [header, ...rows].join("\n");
  const buf  = Buffer.from("\uFEFF" + csv, "utf-8");
  const prodLabel = filterProd === "all" ? "ሁሉም" : byProduct(filterProd)?.label || filterProd;
  const fname     = `GB_${filterProd}_${new Date().toISOString().slice(0,10)}.csv`;
  await ctx.replyWithDocument(
    { source: buf, filename: fname },
    { caption: `📊 *GB ምዝገባ — ${prodLabel}*\nጠቅላላ: ${records.length} ሰው\nጠቅላላ ኪሎ: ${records.reduce((s,r)=>s+(r.weightKg||0),0)}\nጠቅላላ ዋጋ: ${records.reduce((s,r)=>s+(r.totalCost||0),0).toLocaleString()} ብር`, parse_mode: "Markdown" },
  );
});

bot.command("gblist", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await ctx.reply("⏳ GB ዝርዝር እየተዘጋጀ ነው...");

  const today = new Date().toISOString().slice(0, 10);
  const fname = `GB_ዝርዝር_${today}.csv`;

  /* Build CSV with product-group header rows */
  const BOM = "\uFEFF";
  const lines = [];
  lines.push(`የቡድን ግዥ (Group Buying) ዝርዝር — ${today}`);
  lines.push("");

  let grandPeople = 0, grandKg = 0, grandServiceFee = 0;

  for (const prod of GB_PRODUCTS) {
    const ul      = unitLabel(prod);
    const records = await GBReg.find({ productId: prod.id }).sort({ createdAt: 1 }).lean();
    if (!records.length) continue;

    const totalKg  = records.reduce((s, r) => s + (r.weightKg  || 0), 0);
    const totalFee = records.reduce((s, r) => s + Math.round((r.weightKg || 0) * REG_PER_KG), 0);
    grandPeople   += records.length;
    grandKg       += totalKg;
    grandServiceFee += totalFee;

    /* Product header */
    lines.push(`${prod.emoji} ${prod.label} — ጠቅላላ: ${totalKg} ${ul} | ${records.length} ሰው | አገልጎሎት ክፍያ: ${totalFee.toLocaleString()} ብር`);
    lines.push(`ተ.ቁ,ሙሉ ስም,ስልክ,ሰፈር,${ul},አገልጎሎት ክፍያ (ብር),ክፍያ ዘዴ,ሁኔታ,ቀን`);

    records.forEach((r, i) => {
      const date       = new Date(r.createdAt).toLocaleDateString("en-GB");
      const svcFee     = Math.round((r.weightKg || 0) * REG_PER_KG);
      const method     = r.aiVerdict?.method === "cash" ? "Cash (ናቅድ)" : "Telebirr/CBE";
      const status     = r.paymentStatus === "approved" ? "ተረጋግጧል" : r.paymentStatus === "reviewing" ? "እየተፈተሸ" : "ክፍያ ይጠብቃል";
      lines.push([
        i + 1,
        (r.fullName    || "").replace(/,/g, " "),
        (r.phone       || ""),
        (r.neighborhood|| "").replace(/,/g, " "),
        r.weightKg || 0,
        svcFee,
        method,
        status,
        date,
      ].join(","));
    });
    lines.push(`,,,,${totalKg},${totalFee},,, — ድምር`);
    lines.push("");
  }

  if (grandPeople === 0) return ctx.reply("GB ምዝገባ የለም");

  lines.push(`ጠቅላላ ድምር,${grandPeople} ሰው,,,${grandKg},${grandServiceFee.toLocaleString()}ብር`);

  const csv = BOM + lines.join("\n");
  const buf = Buffer.from(csv, "utf-8");

  await ctx.replyWithDocument(
    { source: buf, filename: fname },
    {
      caption:
        `📊 *GB ዝርዝር — ሁሉም ምርቶች*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        GB_PRODUCTS.map((p) => {
          const ul = unitLabel(p);
          return `${p.emoji} ${p.label}`;
        }).join(" | ") +
        `\n\nጠቅላላ: *${grandPeople} ሰው* | *${grandKg} ኪሎ/ሊትር*\n` +
        `አገልጎሎት ክፍያ: *${grandServiceFee.toLocaleString()} ብር*\n\n` +
        `_Excel ወይም Sheets ውስጥ ይክፈቱ_`,
      parse_mode: "Markdown",
    },
  );
});

bot.command("backup", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const adminId = ctx.from.id, today = new Date().toISOString().slice(0, 10);
  await ctx.reply("⏳ Backup እየተዘጋጀ ነው — ትንሽ ይጠብቁ...");
  const gbRecords = await GBReg.find({}).sort({ createdAt: 1 }).lean();
  if (gbRecords.length) {
    const header = "ተ.ቁ,ምርት,ሙሉ ስም,ስልክ,ሰፈር,ኪሎ/ሊትር,ዋጋ/ኪሎ,ጠቅላላ ዋጋ (ብር),ቀን";
    const rows   = gbRecords.map((r, i) => {
      const prod = byProduct(r.productId), date = new Date(r.createdAt).toLocaleDateString("en-GB");
      return [i+1, prod?.label||r.productId, (r.fullName||"").replace(/,/g," "), r.phone||"", (r.neighborhood||"").replace(/,/g," "), r.weightKg, r.pricePerKg, r.totalCost, date].join(",");
    });
    const csv = [header, ...rows].join("\n"), buf = Buffer.from("\uFEFF" + csv, "utf-8");
    await bot.telegram.sendDocument(adminId, { source: buf, filename: `backup_GB_${today}.csv` }, {
      caption: `📦 *GB ምዝገቦች — Backup*\nጠቅላላ: ${gbRecords.length} ሰው\nጠቅላላ ኪሎ: ${gbRecords.reduce((s,r)=>s+(r.weightKg||0),0)}\n${today}`,
      parse_mode: "Markdown",
    }).catch(() => {});
  }
  const cargoRecords = await Reg.find({}).sort({ createdAt: 1 }).lean();
  if (cargoRecords.length) {
    const header2 = "ተ.ቁ,አቅጣጫ,ሙሉ ስም,ስልክ,ሰፈር,ጭነት,ኪሎ,ክፍያ (ብር),ሁኔታ,ቀን";
    const rows2   = cargoRecords.map((r, i) => {
      const ro = byRoute(r.routeId), date = new Date(r.createdAt).toLocaleDateString("en-GB");
      return [i+1, ro?.label||r.routeId, (r.fullName||"").replace(/,/g," "), r.phone||"", (r.neighborhood||"").replace(/,/g," "), (r.cargoDesc||"").replace(/,/g," "), r.weightKg, r.totalPrice, ST[r.status]||r.status, date].join(",");
    });
    const csv2 = [header2, ...rows2].join("\n"), buf2 = Buffer.from("\uFEFF" + csv2, "utf-8");
    await bot.telegram.sendDocument(adminId, { source: buf2, filename: `backup_Cargo_${today}.csv` }, {
      caption: `🚚 *Cargo ምዝገቦች — Backup*\nጠቅላላ: ${cargoRecords.length} ሰው\nጠቅላላ ኪሎ: ${cargoRecords.reduce((s,r)=>s+(r.weightKg||0),0)}\n${today}`,
      parse_mode: "Markdown",
    }).catch(() => {});
  }
  const total = gbRecords.length + cargoRecords.length;
  await ctx.reply(
    total === 0
      ? "⚠️ ምዝገባ የለም — Backup ምንም አልተላከም"
      : `✅ *Backup ተጠናቀቀ!*\n📦 GB: ${gbRecords.length} ሰው\n🚚 Cargo: ${cargoRecords.length} ሰው\n\nፋይሎቹ ወደ ግልዎ Telegram ተልከዋል።`,
    { parse_mode: "Markdown" },
  );
});

bot.command("fees", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await ctx.reply(
    `*አሁናዊ ክፍያዎች*\n━━━━━━━━━━━━━━━━\n\n` +
    `📋 *የምዝገባ (አገልግሎት) ክፍያ:* ${REG_PER_KG} ብር/ኪሎ\n` +
    `🚚 *የትራንስፖርት ክፍያ:* ${SHIP_PER_KG} ብር/ኪሎ\n\n` +
    `ክፍያ ለመቀየር:\n\`/setfee reg <ዋጋ>\` — የምዝገባ ክፍያ\n\`/setfee ship <ዋጋ>\` — የትራንስፖርት ክፍያ\n\nምሳሌ: \`/setfee reg 12\``,
    { parse_mode: "Markdown" },
  );
});

bot.command("setfee", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3)
    return ctx.reply(`*አጠቃቀም:*\n\`/setfee reg <ዋጋ>\`\n\`/setfee ship <ዋጋ>\`\n\nምሳሌ: \`/setfee reg 12\``, { parse_mode: "Markdown" });
  const type  = parts[1].toLowerCase(), price = parseFloat(parts[2]);
  if (!["reg","ship"].includes(type)) return ctx.reply(`❌ ዓይነት ስህተት። \`reg\` ወይም \`ship\` ያስገቡ`, { parse_mode: "Markdown" });
  if (!price || price <= 0 || price > 100000) return ctx.reply("❌ ትክክለኛ ዋጋ ያስገቡ (ለምሳሌ: 12)");
  if (type === "reg") {
    const old = REG_PER_KG; REG_PER_KG = price;
    await setSetting("fee_reg_per_kg", price);
    await ctx.reply(`✅ *የምዝገባ ክፍያ ተቀይሯል!*\n\nቀድሞ: ${old} ብር/ኪሎ\nአሁን: *${price} ብር/ኪሎ*`, { parse_mode: "Markdown" });
    for (const aid of ADMIN_IDS) { if (aid === ctx.from.id) continue; bot.telegram.sendMessage(aid, `📋 የምዝገባ ክፍያ ተቀይሯል\n${old} → *${price}* ብር/ኪሎ`, { parse_mode: "Markdown" }).catch(() => {}); }
  } else {
    const old = SHIP_PER_KG; SHIP_PER_KG = price;
    await setSetting("fee_ship_per_kg", price);
    await ctx.reply(`✅ *የትራንስፖርት ክፍያ ተቀይሯል!*\n\nቀድሞ: ${old} ብር/ኪሎ\nአሁን: *${price} ብር/ኪሎ*`, { parse_mode: "Markdown" });
    for (const aid of ADMIN_IDS) { if (aid === ctx.from.id) continue; bot.telegram.sendMessage(aid, `🚚 የትራንስፖርት ክፍያ ተቀይሯል\n${old} → *${price}* ብር/ኪሎ`, { parse_mode: "Markdown" }).catch(() => {}); }
  }
});

/* ─── 23. LAUNCH ────────────────────────────────────────── */
const PORT = Number(process.env.PORT) || 3000;

function notifyAdmins(msg) {
  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, msg).catch(() => {});
}

async function connectMongo() {
  const opts = { maxPoolSize: 20, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 };
  await mongoose.connect(MONGO_URI, opts);
  console.log("MongoDB connected");
  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected — እንደገና ለመያያዝ ይሞክራል...");
    notifyAdmins("⚠️ Database ተቋረጠ — እንደገና ለመያያዝ ይሞክራል...");
    setTimeout(() => mongoose.connect(MONGO_URI, opts).catch((e) => console.error("MongoDB reconnect failed:", e.message)), 5000);
  });
  mongoose.connection.on("reconnected", () => { console.log("MongoDB reconnected"); notifyAdmins("✅ Database እንደገና ተያያዘ"); });
  mongoose.connection.on("error", (e) => console.error("MongoDB error:", e.message));
}

async function main() {
  await connectMongo();
  await loadPricesFromDB();
  console.log("Prices loaded from DB");

  const server = http.createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); });
  await new Promise((resolve) => server.listen(PORT, () => { console.log("Port", PORT); resolve(); }));

  try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); console.log("Webhook deleted"); }
  catch (e) { console.warn("deleteWebhook:", e.message); }

  const RURL = (process.env.RENDER_EXTERNAL_URL || "").trim();
  if (RURL) {
    setInterval(() => https.get(`${RURL}/`).on("error", () => {}), 14 * 60 * 1000);
  }

  startDailyReportScheduler();

  bot.launch({ allowedUpdates: ["message", "callback_query", "channel_post"] }).catch((e) => {
    console.error("bot.launch error:", e.message);
  });

  console.log("Bot started — 24/7 active");
  notifyAdmins(`✅ Bot ተጀምሯል — ${new Date().toLocaleString("en-GB")}\n24/7 active`);

  process.once("SIGINT",  () => { bot.stop("SIGINT");  server.close(); });
  process.once("SIGTERM", () => { bot.stop("SIGTERM"); server.close(); });
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message, err.stack);
  notifyAdmins(`🚨 Bot crash:\n${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled Rejection:", msg);
  notifyAdmins(`🚨 Bot error:\n${msg}`);
});

main().catch((e) => {
  console.error("Fatal startup error:", e.message);
  setTimeout(() => main().catch(() => process.exit(1)), 10_000);
});
