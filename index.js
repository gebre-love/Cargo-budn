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
const MEMBER_CHANNEL = (process.env.MEMBER_CHANNEL || "abrenenguaz").trim();
const PERSONAL_CHAT_ID = Number((process.env.PERSONAL_CHAT_ID || "").trim()) || 0;

let REG_PER_KG = 5;
let SHIP_PER_KG = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN እና MONGO_URI ያስፈልጋሉ");
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_KEY })
  : null;

/* ─── 2. PROMPTS SYSTEM ─────────────────────────────────── */
const DEFAULT_PROMPTS = {
  // GB flow
  prompt_gb_ask_name:         "👤 ሙሉ ስምዎን ያስገቡ:",
  prompt_gb_name_too_short:   "ሙሉ ስም ያስገቡ (3+ ፊደል):",
  prompt_gb_ask_neighborhood: "ሰፈርዎን ይጻፉ:",
  prompt_gb_nbr_too_short:    "ሰፈርዎን ይጻፉ (ቢያንስ 2 ፊደል):",
  prompt_gb_ask_phone:        "ስልክ ቁጥርዎን ያስገቡ:",
  prompt_gb_phone_unverified: "⚠️ ስልክ ቁጥሩ ቅርጸቱ ልዩ ነው — ሰራተኛ ያረጋግጣሉ.\n\nምን ያህል *{unit}* *{product}* ይፈልጋሉ?\nቁጥር ያስገቡ:",
  prompt_gb_ask_kg:           "ምን ያህል *{unit}* *{product}* ይፈልጋሉ?\nቁጥር ያስገቡ:",
  prompt_gb_invalid_kg:       "ትክክለኛ ቁጥር ያስገቡ (1–5000):",
  prompt_gb_await_photo:      "📸 እባክዎ *የደረሰኝ ፎቶ (screenshot)* ይላኩ — ጽሑፍ አይቀበልም።",
  prompt_gb_photo_request:    "💳 *{fee} ብር* ወደ አንዱ ይክፈሉ:\n\n{methods}\n\n📸 ክፍያ ከፍሎ *screenshot* ይላኩ — ፎቶ ብቻ!\n\n_ምዝገባ የሚጠናቀቀው ክፍያዎ ከተረጋገጠ በኋላ ነው_",
  // Cargo flow
  prompt_cargo_ask_name:         "ሙሉ ስምዎን ያስገቡ:",
  prompt_cargo_name_too_short:   "ሙሉ ስም ያስገቡ (3+ ፊደል):",
  prompt_cargo_ask_neighborhood: "ሰፈርዎን ይጻፉ:",
  prompt_cargo_nbr_too_short:    "ሰፈርዎን ይጻፉ (ቢያንስ 2 ፊደል):",
  prompt_cargo_ask_phone:        "ስልክ ቁጥርዎን ያስገቡ:",
  prompt_cargo_phone_unverified: "⚠️ ስልክ ቁጥሩ ቅርጸቱ ልዩ ነው — ሰራተኛ ያረጋግጣሉ.\n\nጭነት ዓይነት (ምን ዓይነት እቃ?):",
  prompt_cargo_ask_cargo:        "ጭነት ዓይነት (ምን ዓይነት እቃ?):",
  prompt_cargo_invalid_cargo:    "ጭነቱን ያስገቡ (2–200 ፊደል):",
  prompt_cargo_ask_weight:       "ክብደት (ኪሎ):",
  prompt_cargo_invalid_weight:   "ትክክለኛ ቁጥር ያስገቡ (1–2000):",
  prompt_cargo_await_photo:      "📸 እባክዎ *የደረሰኝ ፎቶ (screenshot)* ይላኩ — ፎቶ ሳይልኩ ምዝገባ አይጠናቀቅም!",
  prompt_cargo_invalid_phone:    "⛔ ብዙ ጊዜ ስህተት ልከዋል — ቆይተው ይሞክሩ።",
};

const PROMPT_LABELS = {
  prompt_gb_ask_name:            "GB — ሙሉ ስም ጥያቄ",
  prompt_gb_name_too_short:      "GB — ስም አጭር ሲሆን",
  prompt_gb_ask_neighborhood:    "GB — ሰፈር ጥያቄ",
  prompt_gb_nbr_too_short:       "GB — ሰፈር አጭር ሲሆን",
  prompt_gb_ask_phone:           "GB — ስልክ ቁጥር ጥያቄ",
  prompt_gb_phone_unverified:    "GB — ስልክ ልዩ ቅርጸት ({unit},{product})",
  prompt_gb_ask_kg:              "GB — ኪሎ/ሊትር ጥያቄ ({unit},{product})",
  prompt_gb_invalid_kg:          "GB — ኪሎ ቁጥር ስህተት",
  prompt_gb_await_photo:         "GB — ፎቶ ጠብቀናል",
  prompt_gb_photo_request:       "GB — ክፍያ ማሳወቂያ ({fee},{methods})",
  prompt_cargo_ask_name:         "Cargo — ሙሉ ስም ጥያቄ",
  prompt_cargo_name_too_short:   "Cargo — ስም አጭር ሲሆን",
  prompt_cargo_ask_neighborhood: "Cargo — ሰፈር ጥያቄ",
  prompt_cargo_nbr_too_short:    "Cargo — ሰፈር አጭር ሲሆን",
  prompt_cargo_ask_phone:        "Cargo — ስልክ ቁጥር ጥያቄ",
  prompt_cargo_phone_unverified: "Cargo — ስልክ ልዩ ቅርጸት",
  prompt_cargo_ask_cargo:        "Cargo — ጭነት ዓይነት ጥያቄ",
  prompt_cargo_invalid_cargo:    "Cargo — ጭነት ስህተት",
  prompt_cargo_ask_weight:       "Cargo — ክብደት ጥያቄ",
  prompt_cargo_invalid_weight:   "Cargo — ክብደት ቁጥር ስህተት",
  prompt_cargo_await_photo:      "Cargo — ፎቶ ጠብቀናል",
  prompt_cargo_invalid_phone:    "Cargo — ብዙ ስህተት ግብዓት",
};

let promptCache = { ...DEFAULT_PROMPTS };

async function loadPromptCache() {
  try {
    const keys = Object.keys(DEFAULT_PROMPTS);
    const docs = await BotSettings.find({ key: { $in: keys } }).lean();
    for (const doc of docs) {
      if (doc.key in DEFAULT_PROMPTS) promptCache[doc.key] = doc.value;
    }
  } catch { promptCache = { ...DEFAULT_PROMPTS }; }
}

function getPrompt(key, vars = {}) {
  let text = promptCache[key] || DEFAULT_PROMPTS[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return text;
}

async function setPrompt(key, value) {
  promptCache[key] = value;
  await BotSettings.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function resetPrompt(key) {
  promptCache[key] = DEFAULT_PROMPTS[key];
  await BotSettings.deleteOne({ key });
}

/* ─── 3. GB PRODUCTS ────────────────────────────────────── */
const GB_PRODUCTS = [
  { id: "teff",   emoji: "🌾", label: "ጤፍ",    unit: "kg",    targetKg: Number(process.env.GB_TEFF_KG)   || 5000, pricePerKg: Number(process.env.GB_TEFF_PRICE)   || 75  },
  { id: "oil",    emoji: "🛢",  label: "ዘይት",   unit: "liter", targetKg: Number(process.env.GB_OIL_KG)    || 3000, pricePerKg: Number(process.env.GB_OIL_PRICE)    || 120 },
  { id: "sugar",  emoji: "🍚", label: "ስኳር",   unit: "kg",    targetKg: Number(process.env.GB_SUGAR_KG)  || 3000, pricePerKg: Number(process.env.GB_SUGAR_PRICE)  || 55  },
  { id: "flour",  emoji: "🌽", label: "ዱቄት",   unit: "kg",    targetKg: Number(process.env.GB_FLOUR_KG)  || 3000, pricePerKg: Number(process.env.GB_FLOUR_PRICE)  || 60  },
  { id: "onion",  emoji: "🧅", label: "ሽንኩርት", unit: "kg",    targetKg: Number(process.env.GB_ONION_KG)  || 2000, pricePerKg: Number(process.env.GB_ONION_PRICE)  || 30  },
  { id: "potato", emoji: "🥔", label: "ድንች",   unit: "kg",    targetKg: Number(process.env.GB_POTATO_KG) || 2000, pricePerKg: Number(process.env.GB_POTATO_PRICE) || 15  },
];
const byProduct = (id) => GB_PRODUCTS.find((p) => p.id === id) || EXTRA_PRODUCTS.find((p) => p.id === id);
const unitLabel = (p) => (p?.unit === "liter" ? "ሊትር" : "ኪሎ");

/* ─── ምናሌ ቁልፎች ────────────────────────────────────────── */
const MENU_SETTINGS = [
  { key: "menu_cargo_toamhara", emoji: "🔼", label: "አዲስ አበባ → አማራ ክልል (ጭነት)" },
  { key: "menu_cargo_toaa",    emoji: "🔽", label: "አማራ ክልል → አዲስ አበባ (ጭነት)" },
  { key: "menu_my_regs",       emoji: "📋", label: "የምዝገባ ዝርዝሬ" },
  { key: "menu_counter",       emoji: "📊", label: "የጭነት ቆጣሪ" },
  ...GB_PRODUCTS.map((p) => ({ key: `menu_product_${p.id}`, emoji: p.emoji, label: p.label })),
];

/* ─── 4. ROUTES / METHODS ───────────────────────────────── */
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

/* ─── 5. DB MODELS ──────────────────────────────────────── */
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

const CustomProduct = mongoose.model(
  "CustomProduct",
  new mongoose.Schema({
    id:         { type: String, unique: true, required: true },
    emoji:      { type: String, default: "📦" },
    label:      { type: String, required: true },
    unit:       { type: String, default: "kg" },
    targetKg:   { type: Number, default: 2000 },
    pricePerKg: { type: Number, default: 0 },
    enabled:    { type: Boolean, default: true },
    createdAt:  { type: Date, default: Date.now },
  }),
);

let EXTRA_PRODUCTS = [];

async function loadExtraProducts() {
  try {
    EXTRA_PRODUCTS = await CustomProduct.find({ enabled: true }).sort({ createdAt: 1 }).lean();
  } catch { EXTRA_PRODUCTS = []; }
}

function allProducts() {
  return [...GB_PRODUCTS, ...EXTRA_PRODUCTS];
}

function byAnyProduct(id) {
  return allProducts().find((p) => p.id === id);
}

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
  await loadExtraProducts();
}

/* ─── 6. SESSION ────────────────────────────────────────── */
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

/* ─── 7. SECURITY ───────────────────────────────────────── */
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

/* ─── 8. HELPERS ────────────────────────────────────────── */
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

async function sendPersonalNotification(msg) {
  if (!PERSONAL_CHAT_ID) return;
  try {
    await bot.telegram.sendMessage(PERSONAL_CHAT_ID, msg, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("sendPersonalNotification error:", e.message);
  }
}

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
  } catch {}
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

/* ─── 9. KEYBOARDS ──────────────────────────────────────── */
async function mainKb(userId) {
  await loadExtraProducts();
  const isAdminUser = ADMIN_IDS.includes(userId);
  const staticProds = GB_PRODUCTS;
  const extraProds  = EXTRA_PRODUCTS;
  const allProds    = [...staticProds, ...extraProds];

  const [cargoToAmhara, cargoToAA, myRegs, counter, ...productEnabled] =
    await Promise.all([
      getSetting("menu_cargo_toamhara", true),
      getSetting("menu_cargo_toaa",     true),
      getSetting("menu_my_regs",        true),
      getSetting("menu_counter",        true),
      ...allProds.map((p) => getSetting(`menu_product_${p.id}`, true)),
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
  staticProds.forEach((p, i) => {
    if (isAdminUser || productEnabled[i]) {
      const btn = `${p.emoji} ${p.label}`;
      if (i < 3) prodRow1.push(btn); else prodRow2.push(btn);
    }
  });
  if (prodRow1.length) rows.push(prodRow1);
  if (prodRow2.length) rows.push(prodRow2);

  const extraOffset = staticProds.length;
  let extraRow = [];
  extraProds.forEach((p, i) => {
    if (isAdminUser || productEnabled[extraOffset + i]) {
      extraRow.push(`${p.emoji} ${p.label}`);
      if (extraRow.length === 2) { rows.push(extraRow); extraRow = []; }
    }
  });
  if (extraRow.length) rows.push(extraRow);

  if (ADMIN_IDS.length) rows.push(["🔧 Admin"]);
  if (!isAdminUser && rows.length === (ADMIN_IDS.length ? 1 : 0)) return Markup.removeKeyboard();
  return Markup.keyboard(rows).resize();
}

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

const gbApproveKb = (id) =>
  Markup.inlineKeyboard([[
    Markup.button.callback("✅ ፈቀድ (GB)",  `gb_ok_${id}`),
    Markup.button.callback("❌ ከልክል (GB)", `gb_no_${id}`),
  ]]);

const phoneVerifyKb = (id) =>
  Markup.inlineKeyboard([[
    Markup.button.callback("✅ ስልክ ትክክል ነው",     `ph_ok_${id}`),
    Markup.button.callback("❌ ስልክ ተቀባይነት የለውም", `ph_no_${id}`),
  ]]);

/* ─── 10. CAPACITY TRACKING ─────────────────────────────── */
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
    const priceVisible = await getSetting("price_visible", true);
    for (const m of uniqueUsers)
      bot.telegram.sendMessage(m.userId,
        `🎉 *${prod.emoji} ${prod.label} — ምዝገባ ሞልቷል!*\n\n` +
        `ጠቅላላ: *${totalKg} ${ul}* | ${totalCount} ሰው\n\n` +
        `✅ ምርቱ ከምንጩ ይዘዛል — ከሂደቱ ለማወቅ ይጠብቁ!\n\n` +
        (priceVisible ? `ዋጋ: *${prod.pricePerKg} ብር/${ul}*\n` : "") +
        `ለጥያቄ: ${SUPPORT_PHONE}`,
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

/* ─── 11. PAYMENT CHECK ─────────────────────────────────── */
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

/* ─── 12. PRINT MANIFEST ────────────────────────────────── */
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

/* ─── 13. DAILY REPORT ──────────────────────────────────── */
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

/* ─── 14. BOT + MIDDLEWARE ──────────────────────────────── */
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

/* ─── 15. WELCOME ───────────────────────────────────────── */
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

/* ─── 16. ቆጣሪ / ምዝገባዬ ─────────────────────────────────── */
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
    const gbId  = String(g._id);
    await ctx.reply(
      `${prod?.emoji} *${prod?.label}*\n` +
      `ስም: ${g.fullName} | ስልክ: ${g.phone}\n` +
      `ሰፈር: ${g.neighborhood || "—"}\n` +
      `ተመዝግቧል: *${g.weightKg} ${ul}*\n` +
      `ሁኔታ: ${g.paymentStatus === "approved" ? "✅ ተፈቅዷል" : g.paymentStatus === "rejected" ? "❌ አልተቀበለም" : "⏳ እየተፈተሸ"}\n` +
      `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
      `👥 ተሳታፊ: ${regCount} ሰው`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([[
          Markup.button.callback(`➕ ${ul} ጨምር`, `gb_addkg_${gbId}`),
          Markup.button.callback("🗑 ሰርዝ", `gb_del_confirm_${gbId}`),
        ]]),
      },
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

bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.reply("ዋናው ምናሌ", await mainKb(ctx.from?.id));
});

/* ─── 17. GROUP BUYING PRODUCT MENU ────────────────────── */
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
      getPrompt("prompt_gb_ask_name"),
      { parse_mode: "Markdown", ...backKb() },
    );
  });
}

/* ─── 18. ROUTE SELECTION ───────────────────────────────── */
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
  await ctx.reply(
    `${route.emoji} *${route.label}*\n\n` + getPrompt("prompt_cargo_ask_name"),
    { parse_mode: "Markdown", ...backKb() },
  );
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
  await ctx.reply(
    `${route.emoji} *${route.label}* — ሌላ እቃ ጨምር\n\n` + getPrompt("prompt_cargo_ask_name"),
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* ─── 19. PAYMENT METHOD ────────────────────────────────── */
bot.action(/^pm_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.session?.step !== "PAYMETHOD") return;
  const m = byMethod(ctx.match[1]);
  if (!m) return;
  const { d, routeId } = ctx.session;
  const totalPrice = d.kg * REG_PER_KG;
  ctx.session = { step: "CARGO_AWAIT_PHOTO", d, routeId, paymentMethod: m.id };
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const acct = m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ቁጥር: \`${acct}\`\n\n` +
    `*የምዝገባ ክፍያ: ${totalPrice} ብር* (${d.kg} ኪሎ × ${REG_PER_KG} ብር/ኪሎ)\n\n` +
    `⚠️ ክፍያ ከፈጸሙ በኋላ *የደረሰኝ ፎቶ (screenshot)* ይላኩ።\n` +
    `ፎቶ ሳይልኩ ምዝገባ አይጠናቀቅም!`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
});

/* ─── 20. TEXT FLOW ─────────────────────────────────────── */
bot.on("text", async (ctx, next) => {
  const { step } = ctx.session || {};
  const txt = ctx.message.text.trim();

  if (txt === "🔙 ወደ ዋናው ምናሌ") {
    ctx.session = {};
    await ctx.reply("ዋናው ምናሌ", await mainKb(ctx.from?.id));
    return;
  }

  if (!step) return next();

  if (isSuspicious(txt)) {
    console.warn(`Suspicious input from ${ctx.from?.id}: ${txt.slice(0, 80)}`);
    recordFailedInput(ctx.from?.id);
    return ctx.reply("⛔ ትክክለኛ ያልሆነ ግብዓት — ምዝገባ ተሰርዟል።");
  }

  const reserved = [
    "📋 የምዝገባ ዝርዝሬ", "📊 የጭነት ቆጣሪ", "🔧 Admin",
    "⏭️ ሳላጋራ ጨርስ", "🔼 አዲስ አበባ → አማራ ክልል", "🔽 አማራ ክልል → አዲስ አበባ",
    ...GB_PRODUCTS.map((p) => `${p.emoji} ${p.label}`),
    ...EXTRA_PRODUCTS.map((p) => `${p.emoji} ${p.label}`),
  ];
  if (reserved.includes(txt)) {
    const matchedExtra = EXTRA_PRODUCTS.find((p) => `${p.emoji} ${p.label}` === txt);
    if (matchedExtra) {
      if (!isAdmin(ctx) && !(await getSetting(`menu_product_${matchedExtra.id}`, true)))
        return ctx.reply("ይህ ምርት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
      ctx.session = { step: "GB_NAME", gbProductId: matchedExtra.id };
      const ul = unitLabel(matchedExtra);
      const agg = await GBReg.aggregate([
        { $match: { productId: matchedExtra.id } },
        { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
      ]);
      const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;
      return ctx.reply(
        `${matchedExtra.emoji} *${matchedExtra.label}*\n━━━━━━━━━━━━━━━━\n` +
        `${capLine(regKg, matchedExtra.targetKg, ul)}\n👥 ${regCount} ሰው ተመዝግቧል\n\n` +
        `✅ *እርስዎ የሚከፍሉት ትንሽ የ አገልግሎት ክፍያ ብቻ ነው*\n` +
        `_የምርት እና የትራንስፖርት ክፍያ — ምዝገባ ሲሞላ እናሳውቅዎታለን_\n\n` +
        getPrompt("prompt_gb_ask_name"),
        { parse_mode: "Markdown", ...backKb() },
      );
    }
    return next();
  }

  /* ── Admin: edit prompt text ─────────────────────────── */
  if (step === "ADMIN_EDIT_PROMPT") {
    const { editingPromptKey } = ctx.session;
    if (!editingPromptKey || !(editingPromptKey in DEFAULT_PROMPTS)) {
      ctx.session = {};
      return ctx.reply("❌ ቁልፍ አልተገኘም — ዳግም ይሞክሩ");
    }
    await setPrompt(editingPromptKey, txt);
    ctx.session = {};
    await ctx.reply(
      `✅ *ጽሑፍ ተቀይሯል!*\n\n*${PROMPT_LABELS[editingPromptKey]}*\n\n"${txt}"`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    return;
  }

  /* ── admin steps ─────────────────────────────────────── */
  if (step === "ADMIN_WELCOME") {
    await setSetting("welcome_message", txt);
    ctx.session = {};
    await ctx.reply("✅ *Welcome Message ተቀይሯል!*", { parse_mode: "Markdown" });
    const preview = await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ");
    await ctx.reply(`*👁 ቅድመ-እይታ:*\n\n${preview}`, { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) });
    return;
  }

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

    const agg = await GBReg.aggregate([{ $match: { productId: cashProductId } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;

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

    if (tgId) {
      bot.telegram.sendMessage(tgId,
        `✅ *ምዝገባ ተጠናቀቀ!*\n\n${prod?.emoji} *${prod?.label}* — ${cashKg} ${ul}\n💵 _ክፍያ በ አካል ተቀቢሏል_\n\nምዝገባ ሲሞላ እናሳውቅዎታለን!\n📞 ${SUPPORT_PHONE}`,
        { parse_mode: "Markdown" },
      ).catch(() => {});
      sendChannelInvite(tgId).catch(() => {});
    }

    sendPersonalNotification(
      `💵 *Cash GB ምዝገባ ደረሰ!*\n━━━━━━━━━━━━━━━━\n` +
      `${prod?.emoji} *${prod?.label}* — ${cashKg} ${ul}\n` +
      `👤 *${cashName}*  |  📞 ${cashPhone}\n` +
      `🏘 ሰፈር: ${cashNbr || "—"}\n` +
      `💳 Cash — ${serviceFee} ብር\n✅ Admin ፈቅዷል\n⏰ ${new Date().toLocaleString("en-GB")}`
    ).catch(() => {});

    checkGBCapacity(cashProductId).catch(() => {});
    return;
  }

  /* ── GB flow ─────────────────────────────────────────── */
  if (step === "GB_NAME") {
    if (txt.length < 3) return ctx.reply(getPrompt("prompt_gb_name_too_short"), backKb());
    ctx.session.gbName = txt;
    ctx.session.step   = "GB_NEIGHBORHOOD";
    return ctx.reply(
      `👤 ${txt}\n\n` + getPrompt("prompt_gb_ask_neighborhood"),
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "GB_NEIGHBORHOOD") {
    if (txt.length < 2) return ctx.reply(getPrompt("prompt_gb_nbr_too_short"), backKb());
    ctx.session.gbNeighborhood = txt.slice(0, 60);
    ctx.session.step           = "GB_PHONE";
    return ctx.reply(getPrompt("prompt_gb_ask_phone"), backKb());
  }

  if (step === "GB_PHONE") {
    const phone         = txt.replace(/\s/g, "");
    const phoneValid    = /^0[79]\d{8}$/.test(phone) || /^\+251[79]\d{8}$/.test(phone);
    const prod = byProduct(ctx.session.gbProductId), ul = unitLabel(prod);
    if (!phoneValid) {
      const blocked = recordFailedInput(ctx.from?.id);
      if (blocked) return ctx.reply("⛔ ብዙ ጊዜ ስህተት ግብዓት ልከዋል — ቆይተው ይሞክሩ።");
      ctx.session.gbPhone           = phone;
      ctx.session.gbPhoneUnverified = true;
      ctx.session.step              = "GB_KG";
      await ctx.reply(
        getPrompt("prompt_gb_phone_unverified", { unit: ul, product: prod?.label || "" }),
        { parse_mode: "Markdown", ...backKb() },
      );
      return;
    }
    ctx.session.gbPhone = phone;
    ctx.session.step    = "GB_KG";
    return ctx.reply(
      getPrompt("prompt_gb_ask_kg", { unit: ul, product: prod?.label || "" }),
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "GB_KG") {
    const kg   = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 5000) return ctx.reply(getPrompt("prompt_gb_invalid_kg"), backKb());
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

  /* ── Add Product flow (Admin) ───────────────────────────── */
  if (step === "ADDPROD_EMOJI") {
    const emoji = txt.trim();
    if (emoji.length === 0) return ctx.reply("Emoji ያስገቡ:", backKb());
    ctx.session.newProdEmoji = emoji;
    ctx.session.step         = "ADDPROD_LABEL";
    return ctx.reply(
      `${emoji} ✓\n\nደረጃ 2: *የምርቱን ስም* ያስገቡ (ምሳሌ: ቲማቲም, ቃሪያ, ሽምብራ):`,
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "ADDPROD_LABEL") {
    if (txt.length < 2) return ctx.reply("ስም ያስገቡ (ቢያንስ 2 ፊደል):", backKb());
    ctx.session.newProdLabel = txt.trim();
    ctx.session.step         = "ADDPROD_PRICE";
    return ctx.reply(`ደረጃ 3: *ዋጋ/ኪሎ (ብር)* ያስገቡ\n_ምሳሌ: 45_`, { parse_mode: "Markdown", ...backKb() });
  }

  if (step === "ADDPROD_PRICE") {
    const price = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!price || price <= 0 || price > 100000) return ctx.reply("❌ ትክክለኛ ዋጋ ያስገቡ (ምሳሌ: 45):", backKb());
    ctx.session.newProdPrice = price;
    ctx.session.step         = "ADDPROD_TARGET";
    return ctx.reply(`ደረጃ 4: *ምን ያህል ኪሎ ሲሞላ?* (Target)\n_ምሳሌ: 2000_`, { parse_mode: "Markdown", ...backKb() });
  }

  if (step === "ADDPROD_TARGET") {
    const target = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!target || target <= 0 || target > 1000000) return ctx.reply("❌ ትክክለኛ ቁጥር ያስገቡ:", backKb());
    const { newProdEmoji, newProdLabel, newProdPrice } = ctx.session;
    ctx.session = {};

    const rawId = newProdLabel.replace(/\s+/g, "_").replace(/[^\w\u1200-\u137F]/g, "").toLowerCase() + "_" + Date.now();
    const prodId = rawId.slice(0, 40);

    await CustomProduct.create({
      id:         prodId,
      emoji:      newProdEmoji,
      label:      newProdLabel,
      unit:       "kg",
      targetKg:   target,
      pricePerKg: newProdPrice,
      enabled:    true,
    });

    await loadExtraProducts();

    await ctx.reply(
      `✅ *ምርት ተጨምሯል!*\n━━━━━━━━━━━━━━━━\n\n` +
      `${newProdEmoji} *${newProdLabel}*\n💰 ዋጋ: ${newProdPrice} ብር/ኪሎ\n🎯 ኢላማ: ${target.toLocaleString()} ኪሎ\n\nምርቱ ወዲያው ለተጠቃሚዎች button ሆኖ ይታያል!`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    for (const aid of ADMIN_IDS) {
      if (aid === ctx.from.id) continue;
      bot.telegram.sendMessage(aid,
        `➕ *አዲስ ምርት ተጨምሯል!*\n${newProdEmoji} *${newProdLabel}* — ${newProdPrice} ብር/ኪሎ`,
        { parse_mode: "Markdown" },
      ).catch(() => {});
    }
    return;
  }

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

  if (step === "GB_AWAIT_PHOTO")    return ctx.reply(getPrompt("prompt_gb_await_photo"), { parse_mode: "Markdown" });
  if (step === "CARGO_AWAIT_PHOTO") return ctx.reply(getPrompt("prompt_cargo_await_photo"), { parse_mode: "Markdown" });
  if (step === "PAYMETHOD")         return ctx.reply("ከቁልፍ ይምረጡ");

  /* ── Cargo NAME step ─────────────────────────────────── */
  if (step === "NAME") {
    if (txt.length < 3) return ctx.reply(getPrompt("prompt_cargo_name_too_short"), backKb());
    ctx.session.d.name = txt;
    ctx.session.step   = "NEIGHBORHOOD";
    return ctx.reply(
      `👤 ${txt}\n\n` + getPrompt("prompt_cargo_ask_neighborhood"),
      { parse_mode: "Markdown", ...backKb() },
    );
  }

  if (step === "NEIGHBORHOOD") {
    if (txt.length < 2) return ctx.reply(getPrompt("prompt_cargo_nbr_too_short"), backKb());
    ctx.session.d.neighborhood = txt.slice(0, 60);
    ctx.session.step           = "PHONE";
    return ctx.reply(getPrompt("prompt_cargo_ask_phone"), backKb());
  }

  if (step === "PHONE") {
    const phone      = txt.replace(/\s/g, "");
    const phoneValid = /^0[79]\d{8}$/.test(phone) || /^\+251[79]\d{8}$/.test(phone);
    if (!phoneValid) {
      const blocked = recordFailedInput(ctx.from?.id);
      if (blocked) return ctx.reply(getPrompt("prompt_cargo_invalid_phone"));
      ctx.session.d.phone           = phone;
      ctx.session.d.phoneUnverified = true;
      ctx.session.step              = "CARGO";
      await ctx.reply(getPrompt("prompt_cargo_phone_unverified"), backKb());
      return;
    }
    ctx.session.d.phone = phone;
    ctx.session.step    = "CARGO";
    return ctx.reply(getPrompt("prompt_cargo_ask_cargo"), backKb());
  }

  if (step === "CARGO") {
    if (txt.length < 2 || txt.length > 200) return ctx.reply(getPrompt("prompt_cargo_invalid_cargo"), backKb());
    ctx.session.d.cargo = txt;
    ctx.session.step    = "WEIGHT";
    return ctx.reply(getPrompt("prompt_cargo_ask_weight"), backKb());
  }

  if (step === "WEIGHT") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply(getPrompt("prompt_cargo_invalid_weight"), backKb());
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

/* ─── 21. LOCATION ──────────────────────────────────────── */
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

/* ─── 22. PAYMENT PHOTO ─────────────────────────────────── */
bot.on("photo", async (ctx) => {
  const { step, locRegId, gbProductId, gbName, gbPhone, gbPhoneUnverified, gbNeighborhood, gbKg } = ctx.session || {};
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  /* ── GB AddKg payment photo ─────────────────────────── */
  if (step === "GB_ADDKG_AWAIT_PHOTO") {
    const { gbAddPhotoId } = ctx.session;
    if (!gbAddPhotoId) return;
    const g = await GBReg.findById(gbAddPhotoId);
    if (!g || g.userId !== ctx.from?.id) return ctx.reply("ምዝገባ አልተገኘም");
    const prod    = byProduct(g.productId), ul = unitLabel(prod);
    const newKg   = ctx.session.gbAddNewKg;
    const diffKg  = ctx.session.gbAddDiffKg;
    const diffFee = ctx.session.gbAddDiffFee;
    const oldKg   = ctx.session.gbAddOldKg;
    ctx.session   = {};
    await ctx.reply("📸 ፎቶ ደርሷል — ፍተሻ ይካሄዳል... ⏳");
    const fakeReg2 = { totalPrice: diffFee, paymentMethod: null };
    const verdict2 = await checkPayment(fileId, fakeReg2);
    const autoOk2  = AI_AUTO_APPROVE && checkOk(verdict2);
    if (autoOk2) await GBReg.findByIdAndUpdate(gbAddPhotoId, { weightKg: newKg });
    const agg2   = await GBReg.aggregate([{ $match: { productId: g.productId } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg2 = agg2[0]?.kg || 0, regCount2 = agg2[0]?.count || 0;
    await ctx.reply(
      autoOk2
        ? `✅ *ጭማሪ ተረጋገጠ!*\n${prod?.emoji} *${prod?.label}*\n${oldKg} → *${newKg} ${ul}* (+${diffKg})\n${capLine(regKg2, prod?.targetKg || 5000, ul)}\n👥 ${regCount2} ሰው`
        : `⏳ ፎቶ ደርሷል — ሰራተኛ ያረጋግጣሉ\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    for (const aid of ADMIN_IDS)
      bot.telegram.sendPhoto(aid, fileId, {
        caption: `GB AddKg: ${g.fullName} (${g.phone})\n${prod?.label}: ${oldKg} → ${newKg}${ul} | +${diffFee}ብር\n${checkSummaryAdmin(verdict2)}${autoOk2 ? "\n✅ ራሱ ፈቅዷል" : ""}`,
        ...(!autoOk2 ? Markup.inlineKeyboard([[
          Markup.button.callback("✅ ፈቀድ AddKg", `adm_addkg_ok_${gbAddPhotoId}_${newKg}`),
          Markup.button.callback("❌ ከልክል",      `adm_addkg_no_${gbAddPhotoId}`),
        ]]) : {}),
      }).catch(() => {});
    if (autoOk2) checkGBCapacity(g.productId).catch(() => {});
    return;
  }

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

    const agg   = await GBReg.aggregate([{ $match: { productId: gbProductId } }, { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } }]);
    const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;

    await ctx.reply(
      autoOk
        ? `✅ *ክፍያ ተረጋገጠ — ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n` +
          `${prod?.emoji} *${prod?.label}* — ${gbKg} ${ul}\n` +
          `👤 ${gbName}  |  📞 ${gbPhone}\n🏘 ሰፈር: ${gbNeighborhood || "—"}\n\n` +
          `${capLine(regKg, prod?.targetKg || 5000, ul)}\n👥 ተሳታፊ: ${regCount} ሰው\n\n✨ _ምዝገባ ሲሞላ እናሳውቅዎታለን!_\n📞 ${SUPPORT_PHONE}`
        : `⏳ ፎቶ ደርሷል። ክፍያ ሰራተኛ ያረጋግጣሉ — ምዝገባ ከተረጋገጠ እናሳውቅዎታለን.\n📞 ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );

    if (autoOk) sendChannelInvite(ctx.from.id).catch(() => {});

    sendPersonalNotification(
      `🆕 *GB ምዝገባ ደረሰ!*\n━━━━━━━━━━━━━━━━\n` +
      `${prod?.emoji} *${prod?.label}* — ${gbKg} ${ul}\n👤 *${gbName}*  |  📞 ${gbPhone}\n🏘 ሰፈር: ${gbNeighborhood || "—"}\n` +
      `💳 ክፍያ: ${serviceFee} ብር\n✅ ሁኔታ: ${autoOk ? "ራሱ ፈቅዷል" : "ፍተሻ ይጠብቃል"}\n🆔 User: ${ctx.from.id}${ctx.from.username ? " @" + ctx.from.username : ""}\n⏰ ${new Date().toLocaleString("en-GB")}`
    ).catch(() => {});

    const gbCaption = `${checkSummaryAdmin(verdict)}\n\nGB: ${prod?.emoji}${prod?.label} — ${gbName} (${gbPhone})\nሰፈር: ${gbNeighborhood || "—"} — ${gbKg}${ul}\nክፍያ: ${serviceFee} ብር${autoOk ? "\n✅ ፍተሻ አልፏል" : ""}`;
    for (const aid of ADMIN_IDS)
      bot.telegram.sendPhoto(aid, fileId, {
        caption: gbCaption,
        parse_mode: "Markdown",
        ...(autoOk ? {} : gbApproveKb(String(gbReg._id))),
      }).catch(() => {});

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
  const { step: photoStep, d: sesD, routeId: sesRoute, paymentMethod: sesPM } = ctx.session || {};
  let r;
  if (photoStep === "CARGO_AWAIT_PHOTO" && sesD && sesRoute) {
    r = await Reg.create({
      userId:          ctx.from.id,
      username:        ctx.from.username || "",
      fullName:        sesD.name,
      phone:           sesD.phone,
      neighborhood:    sesD.neighborhood || "",
      phoneUnverified: sesD.phoneUnverified || false,
      routeId:         sesRoute,
      cargoDesc:       sesD.cargo,
      weightKg:        sesD.kg,
      totalPrice:      sesD.kg * REG_PER_KG,
      paymentMethod:   sesPM,
      paymentFileId:   fileId,
      status:          "reviewing",
    });
    ctx.session = {};
  } else if (locRegId) {
    r = await Reg.findById(locRegId);
    if (r) { r.paymentFileId = fileId; r.status = "reviewing"; await r.save(); }
  } else {
    r = await Reg.findOne({ userId: ctx.from.id, status: "pending" }).sort({ createdAt: -1 });
    if (r) { r.paymentFileId = fileId; r.status = "reviewing"; await r.save(); }
  }
  if (!r) return ctx.reply("ምዝገባ አልተገኘም። አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));

  await ctx.reply("📸 ፎቶ ደርሷል — ፍተሻ ይካሄዳል... ⏳");

  const verdict = await checkPayment(fileId, r);
  r.aiVerdict = verdict;
  const autoOk = AI_AUTO_APPROVE && checkOk(verdict);
  if (autoOk) { r.status = "approved"; r.autoApproved = true; }
  await r.save();

  bot.telegram.sendMessage(
    ctx.from.id,
    autoOk
      ? `✅ *ክፍያ ተረጋገጠ — ምዝገባ ተጠናቀቀ!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`
      : `⏳ ፎቶ ደርሷል። ሰራተኛ ያረጋግጣሉ — ምዝገባ ከተረጋገጠ እናሳውቅዎታለን.\n${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" },
  ).catch(() => {});

  if (autoOk) sendChannelInvite(ctx.from.id).catch(() => {});

  const _ro2 = byRoute(r.routeId);
  sendPersonalNotification(
    `🚚 *Cargo ምዝገባ ደረሰ!*\n━━━━━━━━━━━━━━━━\n${_ro2?.emoji} *${_ro2?.label}*\n👤 *${r.fullName}*  |  📞 ${r.phone}\n🏘 ሰፈር: ${r.neighborhood || "—"}\n📦 ጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n💳 ክፍያ: ${r.totalPrice} ብር\n✅ ሁኔታ: ${autoOk ? "ራሱ ፈቅዷል" : "ፍተሻ ይጠብቃል"}\n🆔 User: ${r.userId}${r.username ? " @" + r.username : ""}\n⏰ ${new Date().toLocaleString("en-GB")}`
  ).catch(() => {});

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

/* ─── 23. ADMIN PANEL ───────────────────────────────────── */
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
    [Markup.button.callback("🙈 ዋጋ ደብቅ/አሳይ",                 "toggle_price_visible")],
    [Markup.button.callback("📋 ምናሌ አስተዳዳሪ",                   "menu_manager")],
    [Markup.button.callback("✏️ Prompts አስተዳዳሪ",               "prompt_manager")],
    [Markup.button.callback("📝 Welcome Message ቀይር",          "welcome_edit")],
    [Markup.button.callback("➕ አዲስ ምርት ጨምር",                  "add_product")],
    [Markup.button.callback("🗑 ምርት ሰርዝ",                      "remove_product")],
  ]);
}

bot.hears("🔧 Admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  ctx.session = {};
  const grpOn = await getSetting("group_notify_enabled", true);
  await ctx.reply("*የአስተዳዳሪ ፓነል*", { parse_mode: "Markdown", ...adminPanelKb(grpOn) });
});

/* ─── 24. PROMPTS MANAGER ───────────────────────────────── */
async function sendPromptManagerPanel(ctx) {
  const keys = Object.keys(DEFAULT_PROMPTS);
  const buttons = keys.map((key) => {
    const isCustom = promptCache[key] !== DEFAULT_PROMPTS[key];
    const icon = isCustom ? "✏️" : "📄";
    const label = PROMPT_LABELS[key] || key;
    return [Markup.button.callback(`${icon} ${label}`, `prm_edit_${key}`)];
  });
  buttons.push([
    Markup.button.callback("🔄 ሁሉንም Reset", "prm_reset_all"),
    Markup.button.callback("🔙 ተመለስ", "back_to_admin"),
  ]);
  await ctx.reply(
    `*✏️ Prompts አስተዳዳሪ*\n━━━━━━━━━━━━━━━━\n\n` +
    `📄 = Default ጽሑፍ\n✏️ = ተቀይሯል\n\n` +
    `ለመቀየር ቁልፍ ይጫኑ:`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
}

bot.action("prompt_manager", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await sendPromptManagerPanel(ctx);
});

bot.action(/^prm_edit_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  if (!(key in DEFAULT_PROMPTS)) return ctx.reply("❌ ቁልፍ አልተገኘም");
  const current = promptCache[key] || DEFAULT_PROMPTS[key];
  const isCustom = current !== DEFAULT_PROMPTS[key];
  ctx.session = { step: "ADMIN_EDIT_PROMPT", editingPromptKey: key };
  await ctx.reply(
    `*✏️ ${PROMPT_LABELS[key] || key}*\n━━━━━━━━━━━━━━━━\n\n` +
    `*አሁናዊ ጽሑፍ:*\n${current}\n\n` +
    (isCustom ? `*Default:*\n${DEFAULT_PROMPTS[key]}\n\n` : "") +
    `💬 አዲሱን ጽሑፍ ይላኩ:\n\n` +
    `_ጠቃሚ: {unit}, {product}, {fee}, {methods} placeholder ሊጠቀሙ ይችላሉ_`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[
        Markup.button.callback("🔄 Default ወደ Reset", `prm_reset_${key}`),
        Markup.button.callback("🔙 ተመለስ", "prompt_manager"),
      ]]),
    },
  );
});

bot.action(/^prm_reset_([^_].+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const raw = ctx.match[1];
  // Only match keys from DEFAULT_PROMPTS (not "all")
  if (raw === "all") return;
  // find the full key — the regex above captures everything after prm_reset_
  // We need to find the actual prompt key since it may contain underscores
  const key = Object.keys(DEFAULT_PROMPTS).find((k) => k === `prm_reset_${raw}`.replace("prm_reset_", ""));
  const actualKey = raw; // ctx.match[1] is directly the key portion
  if (!(actualKey in DEFAULT_PROMPTS)) return ctx.reply("❌ ቁልፍ አልተገኘም");
  await resetPrompt(actualKey);
  ctx.session = {};
  await ctx.reply(
    `✅ *${PROMPT_LABELS[actualKey] || actualKey}* — Default ወደ ተመልሷል!\n\n"${DEFAULT_PROMPTS[actualKey]}"`,
    { parse_mode: "Markdown" },
  );
  await sendPromptManagerPanel(ctx);
});

bot.action("prm_reset_all", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  for (const key of Object.keys(DEFAULT_PROMPTS)) {
    await resetPrompt(key);
  }
  ctx.session = {};
  await ctx.reply("✅ *ሁሉም Prompts ወደ Default ተመልሰዋል!*", { parse_mode: "Markdown" });
  await sendPromptManagerPanel(ctx);
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
  bot.telegram.sendMessage(r.userId, `✅ ስልክ ቁጥርዎ ተረጋግጧል — ምዝገባዎ ቀጥሏል.\n${SUPPORT_PHONE}`).catch(() => {});
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
  bot.telegram.sendMessage(r.userId, `❌ ስልክ ቁጥርዎ ተቀባይነት አላገኘም — እባክዎ ትክክለኛ ስልክ ቁጥር ይጠቀሙ.\n${SUPPORT_PHONE}`).catch(() => {});
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
  await ctx.reply(`🏘 *${nbr || "ሁሉም ሰፈሮች"}*\n${list.length} ሰው | ${totalKg} ኪሎ`, { parse_mode: "Markdown" });
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

bot.action("toggle_price_visible", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const current = await getSetting("price_visible", true);
  const next    = !current;
  await setSetting("price_visible", next);
  const icon  = next ? "👁" : "🙈";
  const label = next ? "ዋጋ ይታያል (ON)" : "ዋጋ ተደብቋል (OFF)";
  await ctx.reply(`${icon} *ዋጋ ታይነት — ${label}*\n\n${next ? "ተጠቃሚዎች የምርት ዋጋ ያዩታል" : "ተጠቃሚዎች ዋጋ አያዩም — Admin ብቻ ይታያል"}`, { parse_mode: "Markdown" });
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

/* ─── 25. ADD/REMOVE PRODUCT ────────────────────────────── */
bot.action("add_product", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "ADDPROD_EMOJI" };
  await ctx.reply(
    `➕ *አዲስ ምርት ጨምር*\n━━━━━━━━━━━━━━━━\n\nደረጃ 1: *Emoji* ያስገቡ (ምሳሌ: 🍅 🫑 🌶)`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.action("remove_product", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await loadExtraProducts();
  if (!EXTRA_PRODUCTS.length) return ctx.reply("ምንም custom ምርት የለም");
  const buttons = EXTRA_PRODUCTS.map((p) => [
    Markup.button.callback(`🗑 ${p.emoji} ${p.label}`, `del_prod_${p.id}`),
  ]);
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply("*🗑 የትኛውን ምርት ይሰርዙ?*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^del_prod_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const prodId = ctx.match[1];
  const prod   = EXTRA_PRODUCTS.find((p) => p.id === prodId);
  if (!prod) return ctx.reply("ምርቱ አልተገኘም");
  await CustomProduct.findOneAndUpdate({ id: prodId }, { enabled: false });
  await loadExtraProducts();
  await ctx.reply(`🗑 *${prod.emoji} ${prod.label}* ተሰርዟል — ምናሌው ዘምኗል`, { parse_mode: "Markdown" });
});

/* ─── 26. CARGO APPROVAL ────────────────────────────────── */
bot.action(/^ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("✅ ፈቅዷል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const r = await Reg.findByIdAndUpdate(id, { status: "approved" }, { new: true });
  if (!r) return ctx.reply("ምዝገባ አልተገኘም");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const ro = byRoute(r.routeId);
  await ctx.reply(`✅ ፈቅዷል — ${r.fullName} (${r.phone}) | ${ro?.label}`);
  bot.telegram.sendMessage(r.userId,
    `✅ *ምዝገባዎ ፈቅዷል!*\n\n${ro?.emoji} ${ro?.label}\nጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n\nጭነቱ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" }).catch(() => {});
  checkCapacity(r.routeId).catch(() => {});
});

bot.action(/^no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("❌ ከልክሏል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const r = await Reg.findByIdAndUpdate(id, { status: "rejected" }, { new: true });
  if (!r) return ctx.reply("ምዝገባ አልተገኘም");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const ro = byRoute(r.routeId);
  await ctx.reply(`❌ ከልክሏል — ${r.fullName} | ${ro?.label}`);
  bot.telegram.sendMessage(r.userId,
    `❌ *ክፍያዎ አልተቀበለም*\n\nይህ ሊሆን የቻለ ምክንያቶች:\n• ፎቶ ግልጽ አይደለም\n• ትክክለኛ ቁጥር አይደለም\n• ክፍያ ያልሆነ ይመስላል\n\nዳግም ይሞክሩ:\n${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" }).catch(() => {});
});

/* ─── 27. GB APPROVAL ───────────────────────────────────── */
bot.action(/^gb_ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("✅ GB ፈቅዷል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const g = await GBReg.findByIdAndUpdate(id, { paymentStatus: "approved" }, { new: true });
  if (!g) return ctx.reply("GB ምዝገባ አልተገኘም");
  const prod = byProduct(g.productId), ul = unitLabel(prod);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`✅ GB ፈቅዷል — ${g.fullName} (${g.phone}) | ${prod?.label} ${g.weightKg}${ul}`);
  bot.telegram.sendMessage(g.userId,
    `✅ *GB ምዝገባ ተፈቀደ!*\n\n${prod?.emoji} *${prod?.label}* — ${g.weightKg} ${ul}\n\nምዝገባ ሲሞላ እናሳውቅዎታለን!\n📞 ${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" }).catch(() => {});
  sendChannelInvite(g.userId).catch(() => {});
  checkGBCapacity(g.productId).catch(() => {});
});

bot.action(/^gb_no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery("❌ GB ከልክሏል").catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const g = await GBReg.findByIdAndUpdate(id, { paymentStatus: "rejected" }, { new: true });
  if (!g) return ctx.reply("GB ምዝገባ አልተገኘም");
  const prod = byProduct(g.productId), ul = unitLabel(prod);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`❌ GB ከልክሏል — ${g.fullName} | ${prod?.label}`);
  bot.telegram.sendMessage(g.userId,
    `❌ *GB ክፍያዎ አልተቀበለም*\n\nዳግም ለመሞከር:\n${SUPPORT_PHONE}`,
    { parse_mode: "Markdown" }).catch(() => {});
});

/* ─── 28. GB CONFIRM / ADDKG ACTIONS ────────────────────── */
bot.action("gb_confirm_yes", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbProductId, gbName, gbPhone, gbNeighborhood, gbKg } = ctx.session || {};
  if (!gbProductId) return;
  const prod       = byProduct(gbProductId), ul = unitLabel(prod);
  const serviceFee = Math.round(gbKg * REG_PER_KG);
  const methods    = METHODS.map((m) => `${m.emoji} *${m.label}:*\n\`${m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info}\``).join("\n\n");
  ctx.session.step = "GB_AWAIT_PHOTO";
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(
    getPrompt("prompt_gb_photo_request", { fee: serviceFee, methods }),
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
});

bot.action("gb_confirm_no", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply("ምዝገባ ተሰርዟል — ዋናው ምናሌ", await mainKb(ctx.from?.id));
});

bot.action(/^gb_del_confirm_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  await ctx.reply(
    `⚠️ *ምዝገባ መሰረዝ ይፈልጋሉ?*\n\n_ይህ ድርጊት ሊቀለበስ አይችልም_`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard([[
      Markup.button.callback("✅ አዎ ሰርዝ", `gb_del_${id}`),
      Markup.button.callback("❌ አይ",       "back_main"),
    ]])},
  );
});

bot.action(/^gb_del_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const g = await GBReg.findOne({ _id: id, userId: ctx.from?.id });
  if (!g) return ctx.reply("ምዝገባ አልተገኘም");
  const prod = byProduct(g.productId), ul = unitLabel(prod);
  await GBReg.deleteOne({ _id: id });
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`🗑 *GB ምዝገባ ተሰርዟል*\n\n${prod?.emoji} ${prod?.label} — ${g.weightKg} ${ul}`, { parse_mode: "Markdown" });
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(aid, `🗑 GB ምዝገባ ተሰርዟል: ${g.fullName} (${g.phone}) | ${prod?.label} ${g.weightKg}${ul}`).catch(() => {});
});

bot.action(/^gb_addkg_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const id = ctx.match[1];
  if (!isValidObjectId(id)) return;
  const g = await GBReg.findOne({ _id: id, userId: ctx.from?.id });
  if (!g) return ctx.reply("ምዝገባ አልተገኘም");
  const prod = byProduct(g.productId), ul = unitLabel(prod);
  ctx.session = { step: "GB_ADDKG", gbAddId: String(g._id), gbAddOldKg: g.weightKg, gbAddProductId: g.productId };
  await ctx.reply(
    `${prod?.emoji} *${prod?.label}*\nአሁን: *${g.weightKg} ${ul}*\n\nምን ያህል *ጠቅላላ ${ul}* ይፈልጋሉ?\n_ምሳሌ: ${g.weightKg + 10}_`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.action("gb_addkg_confirm", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbAddId, gbAddNewKg, gbAddDiffKg, gbAddDiffFee, gbAddProductId } = ctx.session || {};
  if (!gbAddId) return;
  const prod = byProduct(gbAddProductId), ul = unitLabel(prod);
  const serviceFee = gbAddDiffFee;
  const methods    = METHODS.map((m) => `${m.emoji} *${m.label}:*\n\`${m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info}\``).join("\n\n");
  ctx.session.step          = "GB_ADDKG_AWAIT_PHOTO";
  ctx.session.gbAddPhotoId  = gbAddId;
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).
