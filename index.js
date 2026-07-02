import { Telegraf, Markup } from "telegraf";
import mongoose from "mongoose";
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

/* ሰራተኞች (Staff) IDs — Cash ምዝገባ እና ማጽደቅ ብቻ ይፈቀዳቸዋል */
const STAFF_IDS = (process.env.STAFF_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

/* የግሌ Telegram chat — ምዝገባ ሲጠናቀቅ ወደዚህ ID ራሱ ማሳወቂያ ይሄዳል */
const PERSONAL_CHAT_ID = Number((process.env.PERSONAL_CHAT_ID || "").trim()) || 0;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN እና MONGO_URI ያስፈልጋሉ");
  process.exit(1);
}

/* ─── 2. DB MODELS ──────────────────────────────────────── */
const HouseListing = mongoose.model(
  "HouseListing",
  new mongoose.Schema({
    userId:      { type: Number, required: true },
    username:    { type: String, default: "" },
    dealType:    { type: String, enum: ["buy", "sell", "rent_in", "rent_out"], required: true },
    propertyKind:{ type: String, enum: ["residential", "commercial"], default: "residential" },
    fullName:    String,
    phone:       String,
    location:    { type: String, default: "" },
    houseType:   { type: String, default: "" },
    bedrooms:    { type: String, default: "" },
    bathrooms:   { type: String, default: "" },
    floor:       { type: String, default: "" },
    sizeSqm:     { type: String, default: "" },
    /* አጠቃላይ ተጨማሪ የህግ መረጃ (ለሁሉም ንብረት ዓይነት) */
    maritalStatus: { type: String, default: "" }, // ያገባ/ያላገባ
    nameTransfer:  { type: String, default: "" }, // ስም ዝውውር ተደርጓል/አልተደረገም
    fiveYears:     { type: String, default: "" }, // 5 ዓመት ሞልቷል/አልሞላም
    titleDeed:     { type: String, default: "" }, // ካርታ/ውል ሰነድ አለው/የለውም
    bankLoan:      { type: String, default: "" }, // የባንክ ብድር ቀሪ አለበት/የለበትም
    condoScheme:   { type: String, default: "" }, // 20/80, 40/60, 10/90
    parking:       { type: String, default: "" }, // ጋራዥ/parking አለው/የለውም
    kitchenCabinet:{ type: String, default: "" }, // ኪችን ካቢኔት አለው/የለውም (ለኪራይ/መኖሪያ ብቻ)
    wardrobe:      { type: String, default: "" }, // ቁም ሳጥን አለው/የለውም (ለኪራይ/መኖሪያ ብቻ)
    price:       { type: String, default: "" },
    description: { type: String, default: "" },
    media: [{
      type:   { type: String, enum: ["photo", "video"] },
      fileId: String,
    }],
    status: { type: String, default: "pending", enum: ["pending", "approved", "rejected"] },
    createdAt: { type: Date, default: Date.now },
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

/* ─── 3. SESSION ────────────────────────────────────────── */
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
  return getSession(key)
    .then((data) => {
      ctx.session = data;
      return next().finally(() => {
        try { saveSession(key, ctx.session).catch(() => {}); } catch {}
      });
    })
    .catch(() => {
      ctx.session = {};
      return next().catch(() => {});
    });
}

/* ─── 4. SECURITY ───────────────────────────────────────── */
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
function isValidObjectId(id) {
  return typeof id === "string" && OBJECT_ID_RE.test(id);
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

/* ─── 5. HELPERS ────────────────────────────────────────── */
const isAdmin     = (ctx) => ADMIN_IDS.includes(ctx.from?.id);
/* Staff — Admin ወይም ሰራተኛ ከሆነ true */
const isStaff     = (ctx) => ADMIN_IDS.includes(ctx.from?.id) || STAFF_IDS.includes(ctx.from?.id);
const isStaffOnly = (ctx) => STAFF_IDS.includes(ctx.from?.id) && !ADMIN_IDS.includes(ctx.from?.id);

/* ምዝገባ ሲጠናቀቅ ወደ የግሌ Telegram ራሱ ማሳወቂያ */
async function sendPersonalNotification(msg) {
  if (!PERSONAL_CHAT_ID) return;
  try {
    await bot.telegram.sendMessage(PERSONAL_CHAT_ID, msg, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("sendPersonalNotification error:", e.message);
  }
}

/* ─── 6. KEYBOARDS ──────────────────────────────────────── */
function mainKb(userId) {
  const isAdminUser = ADMIN_IDS.includes(userId);
  const isStaffUser = STAFF_IDS.includes(userId) && !isAdminUser;
  const rows = [
    ["ቤት ለመከራየት", "🔑 ቤት ለማከራየት"],
    ["🏘 ቤት ለመግዛት", "💰 ቤት ለመሸጥ"],
  ];
  if (isAdminUser) rows.push(["🔧 Admin"]);
  else if (isStaffUser) rows.push(["👔 Staff"]);
  return Markup.keyboard(rows).resize();
}

/* back button keyboard — shown during multi-step flows */
const backKb = () =>
  Markup.keyboard([["🔙 ወደ ዋናው ምናሌ"]]).resize().oneTime();

const locKb = () =>
  Markup.keyboard([
    [Markup.button.locationRequest("📍 አድራሻዬን ላክ")],
    ["⏭️ ሳላጋራ ጨርስ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* ─── 7. BOT + MIDDLEWARE ───────────────────────────────── */
const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 120_000,
  telegram: { timeout: 120 },
});
bot.use(sessionMW);

bot.use(async (ctx, next) => {
  if (ctx.from?.is_bot) return;
  const uid = ctx.from?.id;
  if (!uid) return next();
  if (isAdmin(ctx) || isStaff(ctx)) return next();
  if (isRateLimited(uid))
    return ctx.reply("⛔ ብዙ ጥያቄ ልከዋል — ከ 10 ደቂቃ በኋላ ይሞክሩ።").catch(() => {});
  return next();
});

bot.catch((err, ctx) => {
  console.error("Bot error:", err?.message, ctx?.updateType);
  try { if (ctx?.session) ctx.session = {}; } catch {}
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(aid, `⚠️ Bot Error: ${err?.message || "unknown"}\nUpdate: ${ctx?.updateType || "—"}`).catch(() => {});
  ctx?.reply("ይቅርታ፣ ትንሽ ስህተት ተፈጥሯል። ዳግም ይሞክሩ።").catch(() => {});
});

/* ─── 8. WELCOME ────────────────────────────────────────── */
function defaultWelcomeText(name) {
  return (
    `👋 *እንኳን ወደ ቤት አገልግሎት በደህና መጡ, ${name}!*\n\n` +
    `🏠 ቤት መግዛት፣ መሸጥ፣ መከራየት ወይም ማከራየት ይፈልጋሉ?\n\n` +
    `ከታች ካሉት ውስጥ ይምረጡ እና መረጃዎን ይሙሉ — ባለሙያዎቻችን በቅርቡ ያገናኝዎታል።\n\n` +
    `📞 ለጥያቄ: ${SUPPORT_PHONE}`
  );
}

async function welcomeText(name) {
  const custom = await getSetting("welcome_message", null);
  if (custom) return custom.replace(/\{name\}/g, name);
  return defaultWelcomeText(name);
}

bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...mainKb(ctx.from?.id),
  });
});
bot.command("help", async (ctx) => {
  ctx.session = {};
  await ctx.reply(await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...mainKb(ctx.from?.id),
  });
});

/* ─── ቤት ኪራይ / ሽያጭ-ግዢ ─────────────────────────────── */
const houseMediaDoneKb = () =>
  Markup.keyboard([["✅ ጨርሻለሁ"], ["🔙 ወደ ዋናው ምናሌ"]]).resize();

bot.hears("ቤት ለመከራየት", async (ctx) => {
  ctx.session = { step: "HOUSE_NAME", houseDealType: "rent_in" };
  await ctx.reply(
    "*ለመከራየት የሚፈልጉትን ቤት መረጃ ይሙሉ*\n━━━━━━━━━━━━━━━━\n\nሙሉ ስምዎን ያስገቡ:",
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.hears("🔑 ቤት ለማከራየት", async (ctx) => {
  ctx.session = { step: "HOUSE_NAME", houseDealType: "rent_out" };
  await ctx.reply(
    "🔑 *ቤትዎን ለማከራየት መረጃ ይሙሉ*\n━━━━━━━━━━━━━━━━\n\nሙሉ ስምዎን ያስገቡ:",
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.hears("🏘 ቤት ለመግዛት", async (ctx) => {
  ctx.session = { step: "HOUSE_NAME", houseDealType: "buy" };
  await ctx.reply(
    "🏘 *ለመግዛት የሚፈልጉትን ቤት መረጃ ይሙሉ*\n━━━━━━━━━━━━━━━━\n\nሙሉ ስምዎን ያስገቡ:",
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.hears("💰 ቤት ለመሸጥ", async (ctx) => {
  ctx.session = { step: "HOUSE_NAME", houseDealType: "sell" };
  await ctx.reply(
    "💰 *ቤትዎን ለመሸጥ መረጃ ይሙሉ*\n━━━━━━━━━━━━━━━━\n\nሙሉ ስምዎን ያስገቡ:",
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* ቤት የራሳቸው ያላቸው (ለመሸጥ/ለማከራየት) ብቻ ፎቶ/ቪዲዮ ማቅረብ ይጠበቅባቸዋል */
const HOUSE_LISTING_TYPES = ["sell", "rent_out"]; // የራሳቸውን ቤት የሚያስተዋውቁ
const HOUSE_SEEKING_TYPES = ["buy", "rent_in"];   // ቤት የሚፈልጉ

/* ── የንብረት አይነት (የንግድ / መኖሪያ) እና የቤት ዝርዝር መረጃ ቁልፎች ──── */
const PROPERTY_KIND_LABELS = { residential: "መኖሪያ", commercial: "🏢 የንግድ" };

const housePropertyKindKb = () =>
  Markup.keyboard([
    ["መኖሪያ", "🏢 የንግድ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* መኖሪያ ንብረት ከሆነ የሚታዩ የቤት አይነቶች */
const houseTypeResidentialKb = () =>
  Markup.keyboard([
    ["ቪላ ቤት", "🏢 አፓርትመንት"],
    ["🏗 G+ ህንፃ", "🏘 ኮንዶሚኒየም"],
    ["🔷 ሌላ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* የንግድ ንብረት ከሆነ የሚታዩ የቤት/ቦታ አይነቶች */
const houseTypeCommercialKb = () =>
  Markup.keyboard([
    ["🏪 ሱቅ/መደብር", "🏢 ቢሮ"],
    ["🏭 መጋዘን", "🏗 ህንፃ"],
    ["🔷 ሌላ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* ከ propertyKind ጋር የሚመጣጠን የቤት አይነት ቁልፍ ይመልሳል */
const houseTypeKbFor = (propertyKind) =>
  propertyKind === "commercial" ? houseTypeCommercialKb() : houseTypeResidentialKb();

/* "ህንፃ" ሲመረጥ ስንት ፎቅ እንደሆነ (G+1 እስከ G+15) የሚያመርጥ ቁልፍ፣ ከዛ በላይ ከሆነ "ሌላ" */
const HOUSE_BUILDING_FLOOR_OPTIONS = Array.from({ length: 15 }, (_, i) => `G+${i + 1}`);
const houseBuildingFloorsKb = () => {
  const rows = [];
  for (let i = 0; i < HOUSE_BUILDING_FLOOR_OPTIONS.length; i += 4) {
    rows.push(HOUSE_BUILDING_FLOOR_OPTIONS.slice(i, i + 4));
  }
  rows.push(["ሌላ (ከ G+15 በላይ)"]);
  rows.push(["🔙 ወደ ዋናው ምናሌ"]);
  return Markup.keyboard(rows).resize().oneTime();
};

/* ህንፃው ሙሉ በሙሉ ነው ወይስ በክፍል (በክፍል ደረጃ) ነው የሚቀርበው */
const houseBuildingUnitKb = () =>
  Markup.keyboard([
    ["🏢 ሙሉ ህንፃ", "🚪 በክፍል ሽያጭ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* ሙሉ ህንፃ ከሆነ — ጠቅላላ የክፍል/መታጠቢያ ብዛት (ክልል) */
const houseBuildingRoomsKb = () =>
  Markup.keyboard([
    ["1-5", "6-10"],
    ["11-20", "20+"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseBuildingBathroomsKb = () =>
  Markup.keyboard([
    ["1-3", "4-6"],
    ["7-10", "10+"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseRoomsKb = () =>
  Markup.keyboard([
    ["1", "2", "3"],
    ["4", "5", "6+"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseBathroomsKb = () =>
  Markup.keyboard([
    ["1", "2"],
    ["3", "4+"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseFloorKb = () =>
  Markup.keyboard([
    ["Ground Floor", "1ኛ ፎቅ"],
    ["2ኛ ፎቅ", "3ኛ ፎቅ"],
    ["4+ ፎቅ", "🔷 ሌላ"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* የንግድ ቦታ ስፋት (ካሬ ሜትር) — commercial ብቻ */
const houseSizeKb = () =>
  Markup.keyboard([
    ["< 50 m²", "50-100 m²"],
    ["100-200 m²", "200+ m²"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* ── አጠቃላይ ተጨማሪ የህግ ጥያቄዎች (ለሁሉም ንብረት ዓይነት) ────────── */
const isCondo = (houseType) => (houseType || "").includes("ኮንዶሚኒየም");

const houseMaritalKb = () =>
  Markup.keyboard([
    ["ያገባ/ያገባች", "ያላገባ/ያላገባች"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseTransferKb = () =>
  Markup.keyboard([
    ["ተደርጓል", "አልተደረገም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseFiveYearsKb = () =>
  Markup.keyboard([
    ["5 ዓመት ሞልቷል", "5 ዓመት አልሞላም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseTitleDeedKb = () =>
  Markup.keyboard([
    ["ካርታ/ውል አለው", "ካርታ/ውል የለውም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseLoanKb = () =>
  Markup.keyboard([
    ["ብድር አለበት", "ብድር የለበትም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseSchemeKb = () =>
  Markup.keyboard([
    ["20/80", "40/60"],
    ["10/90", "አላውቅም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseParkingKb = () =>
  Markup.keyboard([
    ["ጋራዥ አለው", "ጋራዥ የለውም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

/* ለኪራይ (rent_in/rent_out) + መኖሪያ (residential) ቤቶች ብቻ የሚጠየቁ ተጨማሪ ጥያቄዎች */
const houseKitchenKb = () =>
  Markup.keyboard([
    ["ኪችን ካቢኔት አለው", "ኪችን ካቢኔት የለውም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

const houseWardrobeKb = () =>
  Markup.keyboard([
    ["ቁም ሳጥን አለው", "ቁም ሳጥን የለውም"],
    ["🔙 ወደ ዋናው ምናሌ"],
  ]).resize().oneTime();

function houseDetailsLine(r) {
  const parts = [];
  if (r.propertyKind) parts.push(PROPERTY_KIND_LABELS[r.propertyKind] || "");
  if (r.houseType)  parts.push(r.houseType);
  if (r.bedrooms)   parts.push(`🛏 መኝታ: ${r.bedrooms}`);
  if (r.bathrooms)  parts.push(`🚿 መታጠቢያ: ${r.bathrooms}`);
  if (r.floor)      parts.push(`🏢 ${r.floor}`);
  if (r.sizeSqm)     parts.push(`📐 ${r.sizeSqm}`);
  if (r.maritalStatus) parts.push(`💍 ${r.maritalStatus}`);
  if (r.nameTransfer)  parts.push(`📝 ስም ዝውውር: ${r.nameTransfer}`);
  if (r.fiveYears)     parts.push(`📅 ${r.fiveYears}`);
  if (r.titleDeed)     parts.push(`📄 ${r.titleDeed}`);
  if (r.bankLoan)      parts.push(`🏦 ${r.bankLoan}`);
  if (r.condoScheme)   parts.push(`🏘 ደረጃ: ${r.condoScheme}`);
  if (r.parking)       parts.push(`🚗 ${r.parking}`);
  if (r.kitchenCabinet) parts.push(`🍽 ${r.kitchenCabinet}`);
  if (r.wardrobe)       parts.push(`🗄 ${r.wardrobe}`);
  return parts.join("\n");
}

function houseTypeLabel(dt) {
  return dt === "rent_out" ? "🔑 ለማከራየት" :
         dt === "rent_in"  ? "ለመከራየት" :
         dt === "sell"     ? "💰 ለመሸጥ" :
                              "🏘 ለመግዛት";
}

/* ፈላጊው ምን አይነት ቤት ይፈልጋል → የትኛውን ዝርዝር ዓይነት ማሳየት እንዳለበት */
const HOUSE_MATCH_COUNTERPART = { buy: "sell", rent_in: "rent_out" };

/* ለ ቤት ፈላጊዎች የሚመጥኑ የተመዘገቡ ቤቶችን (ከ ሻጭ/አከራይ) በራስ-ሰር መላክ።
   የሚታየው ስልክ ሁልጊዜ SUPPORT_PHONE ብቻ ነው — የሻጩ/አከራዩ ስልክ አይላክም። */
async function sendMatchingHouseListings(ctx, seekerDealType) {
  const targetType = HOUSE_MATCH_COUNTERPART[seekerDealType];
  if (!targetType) return;

  const matches = await HouseListing.find({ dealType: targetType, status: "approved" })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (!matches.length) {
    await ctx.reply(
      `ℹ️ በአሁኑ ሰዓት የሚመጥን ቤት አልተገኘም — እንዳገኘን እናሳውቅዎታለን!\n📞 ${SUPPORT_PHONE}`,
    );
    return;
  }

  await ctx.reply(
    `🔎 *ለእርስዎ የሚመጥኑ ${matches.length} ቤት(ቶች) አግኝተናል:*\n━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" },
  );

  for (const m of matches) {
    const typeLabel = houseTypeLabel(m.dealType);
    const detailsLine = houseDetailsLine(m);
    const caption =
      `${typeLabel}\n📍 ${m.location}\n` +
      (detailsLine ? `${detailsLine}\n` : "") +
      `💰 ${m.price}\n📝 ${m.description || "—"}\n\n📞 ${SUPPORT_PHONE}`;
    const firstMedia = m.media?.[0];
    try {
      if (firstMedia?.type === "photo") {
        await ctx.telegram.sendPhoto(ctx.from.id, firstMedia.fileId, { caption, parse_mode: "Markdown" });
      } else if (firstMedia?.type === "video") {
        await ctx.telegram.sendVideo(ctx.from.id, firstMedia.fileId, { caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(caption, { parse_mode: "Markdown" });
      }
    } catch (e) { console.error("sendMatchingHouseListings:", e.message); }
  }
}

async function finalizeHouseListing(ctx) {
  const {
    houseDealType, housePropertyKind, houseName, housePhone, houseLocation, housePrice, houseDesc, houseMedia,
    houseType, houseBedrooms, houseBathrooms, houseFloor, houseSize,
    houseMarital, houseTransfer, houseFiveYears,
    houseTitleDeed, houseLoan, houseScheme, houseParking,
    houseKitchen, houseWardrobe,
  } = ctx.session;
  const media = houseMedia || [];

  const listing = await HouseListing.create({
    userId:      ctx.from.id,
    username:    ctx.from.username || "",
    dealType:    houseDealType,
    propertyKind: housePropertyKind || "residential",
    fullName:    houseName,
    phone:       housePhone,
    location:    houseLocation,
    houseType:   houseType || "",
    bedrooms:    houseBedrooms || "",
    bathrooms:   houseBathrooms || "",
    floor:       houseFloor || "",
    sizeSqm:     houseSize || "",
    maritalStatus: houseMarital   || "",
    nameTransfer:  houseTransfer  || "",
    fiveYears:     houseFiveYears || "",
    titleDeed:     houseTitleDeed || "",
    bankLoan:      houseLoan      || "",
    condoScheme:   houseScheme    || "",
    parking:       houseParking   || "",
    kitchenCabinet: houseKitchen  || "",
    wardrobe:       houseWardrobe || "",
    price:       housePrice,
    description: houseDesc,
    media,
  });
  ctx.session = {};

  const typeLabel = houseTypeLabel(houseDealType);
  const isSeeking  = HOUSE_SEEKING_TYPES.includes(houseDealType);
  const locLabel   = isSeeking ? "የሚፈልጉት አካባቢ" : "📍";
  const priceLabel = isSeeking ? "በጀት" : "💰";
  const detailsLine = houseDetailsLine(listing);

  await ctx.reply(
    `✅ *ምዝገባዎ ተልኳል!*\n━━━━━━━━━━━━━━━━\n` +
    `${typeLabel}\n👤 ${houseName} | 📞 ${housePhone}\n${locLabel}: ${houseLocation}\n` +
    (detailsLine ? `${detailsLine}\n` : "") +
    `${priceLabel}: ${housePrice}\n\n` +
    `ባለሙያዎቻችን አይተው በቅርቡ ያገናኝዎታል።\n📞 ${SUPPORT_PHONE}`,
    { parse_mode: "Markdown", ...mainKb(ctx.from?.id) },
  );

  for (const aid of ADMIN_IDS) {
    bot.telegram.sendMessage(
      aid,
      `🆕 *አዲስ የቤት ምዝገባ* (${typeLabel})\n👤 ${houseName} | 📞 ${housePhone}\n📍 ${houseLocation}\n` +
      (detailsLine ? `${detailsLine}\n` : "") +
      `💰 ${housePrice}\n📝 ${houseDesc || "—"}\n🖼 ${media.length} ፎቶ/ቪዲዮ\nID: ${listing._id}`,
      { parse_mode: "Markdown" },
    ).catch(() => {});
    for (const m of media) {
      if (m.type === "photo") bot.telegram.sendPhoto(aid, m.fileId).catch(() => {});
      else bot.telegram.sendVideo(aid, m.fileId).catch(() => {});
    }
  }

  if (isSeeking) {
    await sendMatchingHouseListings(ctx, houseDealType);
  }
}

/* የቤት ዝርዝር (bedrooms/bathrooms/floor/size) ተጠናቅቆ ቀጣይ ደረጃ ይወስናል፦
   ፈላጊ ከሆነ ወዲያው ይጠናቀቃል፣ ባለቤት ከሆነ ፎቶ/ቪዲዮ ይጠየቃል። */
async function finishHouseDetails(ctx) {
  const dt = ctx.session.houseDealType;
  if (HOUSE_SEEKING_TYPES.includes(dt)) {
    ctx.session.houseMedia = [];
    await finalizeHouseListing(ctx);
    return;
  }
  ctx.session.step = "HOUSE_MEDIA";
  ctx.session.houseMedia = [];
  return ctx.reply(
    "📸 *አሁን የቤቱን ፎቶ ወይም ቪዲዮ ይላኩ* (ብዙ መላክ ይችላሉ)።\nሲጨርሱ *✅ ጨርሻለሁ* የሚለውን ይጫኑ።",
    { parse_mode: "Markdown", ...houseMediaDoneKb() },
  );
}

/* የባለቤትነት/ሽያጭ ነክ የህግ ጥያቄዎች (ጋብቻ ሁኔታ፣ ስም ዝውውር፣ 5 ዓመት፣ ካርታ/ውል፣ ብድር፣ ኮንዶ ደረጃ)
   ለሽያጭ/ግዢ ብቻ ይመለከታሉ — ለኪራይ (rent_in/rent_out) አይጠየቁም። */
function afterSizeStep(ctx) {
  const dt = ctx.session.houseDealType;
  if (dt === "rent_in" || dt === "rent_out") {
    if (ctx.session.housePropertyKind === "residential") {
      ctx.session.step = "HOUSE_KITCHEN";
      return ctx.reply("🍽 ኪችን ካቢኔት አለው?", { parse_mode: "Markdown", ...houseKitchenKb() });
    }
    ctx.session.step = "HOUSE_LEGAL_PARKING";
    return ctx.reply("🚗 ጋራዥ/parking ይኖረዋል?", { parse_mode: "Markdown", ...houseParkingKb() });
  }
  ctx.session.step = "HOUSE_LEGAL_MARITAL";
  return ctx.reply("💍 የባለቤቱ የጋብቻ ሁኔታ ይምረጡ:", { parse_mode: "Markdown", ...houseMaritalKb() });
}

/* ወደ "አካባቢ" ጥያቄ ደረጃ ያሸጋግራል፣ ጥያቄውንም ይልካል */
function askHouseLocation(ctx) {
  ctx.session.step = "HOUSE_LOCATION";
  const dt = ctx.session.houseDealType;
  const locQ =
    dt === "sell" || dt === "rent_out"
      ? "📍 የቤቱ አድራሻ/አካባቢ ይጻፉ:"
      : "📍 የሚፈልጉትን ቤት አካባቢ ይጻፉ:";
  return ctx.reply(locQ, backKb());
}

bot.hears("✅ ጨርሻለሁ", async (ctx) => {
  if (ctx.session?.step !== "HOUSE_MEDIA") return;
  const { houseMedia } = ctx.session;
  if (!houseMedia || !houseMedia.length)
    return ctx.reply("⚠️ ቢያንስ አንድ ፎቶ ወይም ቪዲዮ ይላኩ።", houseMediaDoneKb());
  await finalizeHouseListing(ctx);
});

/* back_main inline callback — resets session and returns to main menu */
bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  await ctx.reply("ዋናው ምናሌ", mainKb(ctx.from?.id));
});

/* ─── 9. TEXT FLOW ───────────────────────────────────────── */
bot.on("text", async (ctx, next) => {
  const { step } = ctx.session || {};
  const txt = ctx.message.text.trim();

  /* ── Global back button — resets session ─────────────── */
  if (txt === "🔙 ወደ ዋናው ምናሌ") {
    ctx.session = {};
    await ctx.reply("ዋናው ምናሌ", mainKb(ctx.from?.id));
    return;
  }

  if (!step) return next();

  /* ── House rent/sale flow steps ───────────────────── */
  if (step === "HOUSE_NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
    ctx.session.houseName = txt;
    ctx.session.step = "HOUSE_PHONE";
    return ctx.reply("📞 ስልክ ቁጥርዎን ያስገቡ:", backKb());
  }

  if (step === "HOUSE_PHONE") {
    ctx.session.housePhone = txt.replace(/\s/g, "");
    ctx.session.step = "HOUSE_PROPERTY_KIND";
    return ctx.reply("🏢 ንብረቱ የንግድ ነው ወይስ መኖሪያ?", { parse_mode: "Markdown", ...housePropertyKindKb() });
  }

  if (step === "HOUSE_PROPERTY_KIND") {
    let kind = null;
    if (txt.includes("የንግድ")) kind = "commercial";
    else if (txt.includes("መኖሪያ")) kind = "residential";
    if (!kind) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", housePropertyKindKb());
    ctx.session.housePropertyKind = kind;
    ctx.session.step = "HOUSE_TYPE";
    return ctx.reply("የቤት/ቦታ አይነት ይምረጡ:", { parse_mode: "Markdown", ...houseTypeKbFor(kind) });
  }

  if (step === "HOUSE_TYPE") {
    const kind = ctx.session.housePropertyKind;
    const validOptions = kind === "commercial"
      ? ["🏪 ሱቅ/መደብር", "🏢 ቢሮ", "🏭 መጋዘን", "🏗 ህንፃ", "🔷 ሌላ"]
      : ["ቪላ ቤት", "🏢 አፓርትመንት", "🏗 G+ ህንፃ", "🏘 ኮንዶሚኒየም", "🔷 ሌላ"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseTypeKbFor(kind));
    if (txt === "🔷 ሌላ") {
      ctx.session.step = "HOUSE_TYPE_OTHER";
      return ctx.reply("የቤት/ቦታ አይነቱን ይጻፉ:", backKb());
    }
    ctx.session.houseType = txt;
    if (txt === "🏗 G+ ህንፃ" || txt === "🏗 ህንፃ") {
      ctx.session.step = "HOUSE_TYPE_FLOORS";
      return ctx.reply("🏗 ስንት ፎቅ ነው? (G+):", { parse_mode: "Markdown", ...houseBuildingFloorsKb() });
    }
    return askHouseLocation(ctx);
  }

  if (step === "HOUSE_TYPE_OTHER") {
    ctx.session.houseType = txt.slice(0, 60);
    return askHouseLocation(ctx);
  }

  if (step === "HOUSE_TYPE_FLOORS") {
    if (txt === "ሌላ (ከ G+15 በላይ)") {
      ctx.session.step = "HOUSE_TYPE_FLOORS_OTHER";
      return ctx.reply("🏗 ስንት ፎቅ እንደሆነ ይጻፉ (ለምሳሌ: G+20):", backKb());
    }
    if (!HOUSE_BUILDING_FLOOR_OPTIONS.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseBuildingFloorsKb());
    ctx.session.houseType = `${ctx.session.houseType} (${txt})`;
    ctx.session.step = "HOUSE_TYPE_UNIT_KIND";
    return ctx.reply("🏢 ሙሉ ህንፃ ነው ወይስ በክፍል ይቀርባል?", { parse_mode: "Markdown", ...houseBuildingUnitKb() });
  }

  if (step === "HOUSE_TYPE_FLOORS_OTHER") {
    const floors = txt.slice(0, 20);
    ctx.session.houseType = `${ctx.session.houseType} (${floors})`;
    ctx.session.step = "HOUSE_TYPE_UNIT_KIND";
    return ctx.reply("🏢 ሙሉ ህንፃ ነው ወይስ በክፍል ይቀርባል?", { parse_mode: "Markdown", ...houseBuildingUnitKb() });
  }

  if (step === "HOUSE_TYPE_UNIT_KIND") {
    const validOptions = ["🏢 ሙሉ ህንፃ", "🚪 በክፍል ሽያጭ"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseBuildingUnitKb());
    ctx.session.houseType = `${ctx.session.houseType} - ${txt}`;
    if (txt === "🏢 ሙሉ ህንፃ") {
      ctx.session.houseIsWholeBuilding = true;
      ctx.session.step = "HOUSE_UNIT_ROOMS";
      return ctx.reply("🚪 ጠቅላላ የክፍል ብዛት ይምረጡ:", { parse_mode: "Markdown", ...houseBuildingRoomsKb() });
    }
    return askHouseLocation(ctx);
  }

  if (step === "HOUSE_UNIT_ROOMS") {
    const validOptions = ["1-5", "6-10", "11-20", "20+"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseBuildingRoomsKb());
    ctx.session.houseBedrooms = txt;
    ctx.session.step = "HOUSE_UNIT_BATHROOMS";
    return ctx.reply("🚿 ጠቅላላ የመታጠቢያ ብዛት ይምረጡ:", { parse_mode: "Markdown", ...houseBuildingBathroomsKb() });
  }

  if (step === "HOUSE_UNIT_BATHROOMS") {
    const validOptions = ["1-3", "4-6", "7-10", "10+"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseBuildingBathroomsKb());
    ctx.session.houseBathrooms = txt;
    return askHouseLocation(ctx);
  }

  if (step === "HOUSE_LOCATION") {
    ctx.session.houseLocation = txt.slice(0, 200);
    ctx.session.step = "HOUSE_PRICE";
    const dt = ctx.session.houseDealType;
    const label =
      dt === "rent_out" ? "ወርሃዊ ኪራይ ዋጋ" :
      dt === "sell"     ? "የሽያጭ ዋጋ" :
      dt === "rent_in"  ? "የሚፈልጉት ኪራይ በጀት" :
                          "የሚፈልጉት ግዢ በጀት";
    return ctx.reply(`💰 ${label} ያስገቡ:`, backKb());
  }

  if (step === "HOUSE_PRICE") {
    ctx.session.housePrice = txt.slice(0, 60);
    if (ctx.session.houseIsWholeBuilding) {
      /* ሙሉ ህንፃ ከሆነ የክፍል/መታጠቢያ ብዛት ቀድሞ ተጠይቋል — ደግሞ አይጠየቅም */
      return finishHouseDetails(ctx);
    }
    const kind = ctx.session.housePropertyKind;
    if (kind === "commercial") {
      ctx.session.step = "HOUSE_FLOOR";
      return ctx.reply("🏢 ፎቅ/ደረጃ ይምረጡ:", { parse_mode: "Markdown", ...houseFloorKb() });
    }
    ctx.session.step = "HOUSE_BEDROOMS";
    return ctx.reply("🛏 የመኝታ ክፍል ብዛት ይምረጡ:", { parse_mode: "Markdown", ...houseRoomsKb() });
  }

  if (step === "HOUSE_BEDROOMS") {
    const validOptions = ["1", "2", "3", "4", "5", "6+"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseRoomsKb());
    ctx.session.houseBedrooms = txt;
    ctx.session.step = "HOUSE_BATHROOMS";
    return ctx.reply("🚿 የመታጠቢያ ክፍል ብዛት ይምረጡ:", { parse_mode: "Markdown", ...houseBathroomsKb() });
  }

  if (step === "HOUSE_BATHROOMS") {
    const validOptions = ["1", "2", "3", "4+"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseBathroomsKb());
    ctx.session.houseBathrooms = txt;
    ctx.session.step = "HOUSE_FLOOR";
    return ctx.reply("🏢 ፎቅ/ደረጃ ይምረጡ:", { parse_mode: "Markdown", ...houseFloorKb() });
  }

  if (step === "HOUSE_FLOOR") {
    const validOptions = ["Ground Floor", "1ኛ ፎቅ", "2ኛ ፎቅ", "3ኛ ፎቅ", "4+ ፎቅ", "🔷 ሌላ"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseFloorKb());
    if (txt === "🔷 ሌላ") {
      ctx.session.step = "HOUSE_FLOOR_OTHER";
      return ctx.reply("🏢 ፎቅ/ደረጃውን ይጻፉ:", backKb());
    }
    ctx.session.houseFloor = txt;
    const kind = ctx.session.housePropertyKind;
    if (kind === "commercial") {
      ctx.session.step = "HOUSE_SIZE";
      return ctx.reply("📐 የቦታው ስፋት ይምረጡ:", { parse_mode: "Markdown", ...houseSizeKb() });
    }
    ctx.session.step = "HOUSE_SQM";
    return ctx.reply("📐 የቤቱ ስፋት በካሬ ሜትር ይጻፉ (ለምሳሌ: 50):", backKb());
  }

  if (step === "HOUSE_FLOOR_OTHER") {
    if (txt.length < 1 || txt.length > 40) return ctx.reply("🏢 ፎቅ/ደረጃውን ይጻፉ:", backKb());
    ctx.session.houseFloor = txt.slice(0, 40);
    const kind = ctx.session.housePropertyKind;
    if (kind === "commercial") {
      ctx.session.step = "HOUSE_SIZE";
      return ctx.reply("📐 የቦታው ስፋት ይምረጡ:", { parse_mode: "Markdown", ...houseSizeKb() });
    }
    ctx.session.step = "HOUSE_SQM";
    return ctx.reply("📐 የቤቱ ስፋት በካሬ ሜትር ይጻፉ (ለምሳሌ: 50):", backKb());
  }

  if (step === "HOUSE_SIZE") {
    const validOptions = ["< 50 m²", "50-100 m²", "100-200 m²", "200+ m²"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseSizeKb());
    ctx.session.houseSize = txt;
    return afterSizeStep(ctx);
  }

  /* ── አጠቃላይ ተጨማሪ የህግ ጥያቄዎች (ለሽያጭ/ግዢ ብቻ) ────────────── */
  if (step === "HOUSE_SQM") {
    const n = txt.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(n)) return ctx.reply("⚠️ ቁጥር ብቻ ያስገቡ (ለምሳሌ: 50):", backKb());
    ctx.session.houseSize = `${n} m²`;
    return afterSizeStep(ctx);
  }

  if (step === "HOUSE_LEGAL_MARITAL") {
    const validOptions = ["ያገባ/ያገባች", "ያላገባ/ያላገባች"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseMaritalKb());
    ctx.session.houseMarital = txt;
    ctx.session.step = "HOUSE_LEGAL_TRANSFER";
    return ctx.reply("📝 የስም ዝውውር ተደርጓል ወይ?", { parse_mode: "Markdown", ...houseTransferKb() });
  }

  if (step === "HOUSE_LEGAL_TRANSFER") {
    const validOptions = ["ተደርጓል", "አልተደረገም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseTransferKb());
    ctx.session.houseTransfer = txt;
    ctx.session.step = "HOUSE_LEGAL_5YEARS";
    return ctx.reply("📅 ከተመዘገበ/ከተላለፈ 5 ዓመት ሞልቷል ወይ?", { parse_mode: "Markdown", ...houseFiveYearsKb() });
  }

  if (step === "HOUSE_LEGAL_5YEARS") {
    const validOptions = ["5 ዓመት ሞልቷል", "5 ዓመት አልሞላም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseFiveYearsKb());
    ctx.session.houseFiveYears = txt;
    ctx.session.step = "HOUSE_LEGAL_TITLE";
    return ctx.reply("📄 የካርታ/ውል ሰነድ ሁኔታ ይምረጡ:", { parse_mode: "Markdown", ...houseTitleDeedKb() });
  }

  if (step === "HOUSE_LEGAL_TITLE") {
    const validOptions = ["ካርታ/ውል አለው", "ካርታ/ውል የለውም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseTitleDeedKb());
    ctx.session.houseTitleDeed = txt;
    ctx.session.step = "HOUSE_LEGAL_LOAN";
    return ctx.reply("🏦 የባንክ ብድር ቀሪ ሁኔታ ይምረጡ:", { parse_mode: "Markdown", ...houseLoanKb() });
  }

  if (step === "HOUSE_LEGAL_LOAN") {
    const validOptions = ["ብድር አለበት", "ብድር የለበትም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseLoanKb());
    ctx.session.houseLoan = txt;
    /* የኮንዶ ደረጃ (20/80 ወዘተ) ለኮንዶሚኒየም ብቻ ይመለከታል */
    if (isCondo(ctx.session.houseType)) {
      ctx.session.step = "HOUSE_LEGAL_SCHEME";
      return ctx.reply("🏘 የኮንዶ ደረጃ ይምረጡ:", { parse_mode: "Markdown", ...houseSchemeKb() });
    }
    ctx.session.step = "HOUSE_LEGAL_PARKING";
    return ctx.reply("🚗 ጋራዥ/parking ይኖረዋል?", { parse_mode: "Markdown", ...houseParkingKb() });
  }

  if (step === "HOUSE_LEGAL_SCHEME") {
    const validOptions = ["20/80", "40/60", "10/90", "አላውቅም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseSchemeKb());
    ctx.session.houseScheme = txt;
    ctx.session.step = "HOUSE_LEGAL_PARKING";
    return ctx.reply("🚗 ጋራዥ/parking ይኖረዋል?", { parse_mode: "Markdown", ...houseParkingKb() });
  }

  /* ── ኪችን ካቢኔት / ቁም ሳጥን — ለኪራይ (rent_in/rent_out) + መኖሪያ ቤቶች ብቻ ─── */
  if (step === "HOUSE_KITCHEN") {
    const validOptions = ["ኪችን ካቢኔት አለው", "ኪችን ካቢኔት የለውም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseKitchenKb());
    ctx.session.houseKitchen = txt;
    ctx.session.step = "HOUSE_WARDROBE";
    return ctx.reply("🗄 ቁም ሳጥን አለው?", { parse_mode: "Markdown", ...houseWardrobeKb() });
  }

  if (step === "HOUSE_WARDROBE") {
    const validOptions = ["ቁም ሳጥን አለው", "ቁም ሳጥን የለውም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseWardrobeKb());
    ctx.session.houseWardrobe = txt;
    ctx.session.step = "HOUSE_LEGAL_PARKING";
    return ctx.reply("🚗 ጋራዥ/parking ይኖረዋል?", { parse_mode: "Markdown", ...houseParkingKb() });
  }

  if (step === "HOUSE_LEGAL_PARKING") {
    const validOptions = ["ጋራዥ አለው", "ጋራዥ የለውም"];
    if (!validOptions.includes(txt)) return ctx.reply("⚠️ ከቁልፎቹ ውስጥ ይምረጡ:", houseParkingKb());
    ctx.session.houseParking = txt;
    return finishHouseDetails(ctx);
  }

  /* Security checks */
  if (isSuspicious(txt)) {
    console.warn(`Suspicious input from ${ctx.from?.id}: ${txt.slice(0, 80)}`);
    recordFailedInput(ctx.from?.id);
    return ctx.reply("⛔ ትክክለኛ ያልሆነ ግብዓት — ምዝገባ ተሰርዟል።");
  }

  /* ── admin steps ─────────────────────────────────────── */
  if (step === "ADMIN_WELCOME") {
    await setSetting("welcome_message", txt);
    ctx.session = {};
    await ctx.reply("✅ *Welcome Message ተቀይሯል!*", { parse_mode: "Markdown" });
    const preview = await welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ");
    await ctx.reply(`*👁 ቅድመ-እይታ:*\n\n${preview}`, { parse_mode: "Markdown", ...mainKb(ctx.from?.id) });
    return;
  }

  /* ── Staff Cash House flow ──────────────────────────────── */
  if (step === "HOUSE_CASH_NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
    ctx.session.houseCashName = txt;
    ctx.session.step          = "HOUSE_CASH_PHONE";
    return ctx.reply("ደንበኛው ስልክ ቁጥር:", backKb());
  }

  if (step === "HOUSE_CASH_PHONE") {
    ctx.session.houseCashPhone = txt.replace(/\s/g, "");
    ctx.session.step           = "HOUSE_CASH_LOCATION";
    const dt = ctx.session.houseCashDealType;
    return ctx.reply(
      HOUSE_SEEKING_TYPES.includes(dt) ? "📍 የሚፈልጉትን ቤት አካባቢ:" : "📍 የቤቱ አካባቢ:",
      backKb(),
    );
  }

  if (step === "HOUSE_CASH_LOCATION") {
    ctx.session.houseCashLocation = txt.slice(0, 200);
    ctx.session.step              = "HOUSE_CASH_PRICE";
    const dt = ctx.session.houseCashDealType;
    return ctx.reply(
      dt === "buy" || dt === "rent_in" ? "💰 ሊከፍሉ የሚችሉት ዋጋ:" : "💰 ዋጋ:",
      backKb(),
    );
  }

  if (step === "HOUSE_CASH_PRICE") {
    ctx.session.houseCashPrice = txt.slice(0, 60);
    ctx.session.step           = "HOUSE_CASH_DESC";
    return ctx.reply("📝 የቤቱን አጠቃላይ መረጃ ያስገቡ:", { parse_mode: "Markdown", ...backKb() });
  }

  if (step === "HOUSE_CASH_DESC") {
    const { houseCashDealType, houseCashName, houseCashPhone, houseCashLocation, houseCashPrice } = ctx.session;
    const houseCashDesc = txt.slice(0, 500);

    const listing = await HouseListing.create({
      userId:      0,
      username:    "",
      dealType:    houseCashDealType,
      fullName:    houseCashName,
      phone:       houseCashPhone,
      location:    houseCashLocation,
      price:       houseCashPrice,
      description: houseCashDesc,
      media:       [],
      status:      "approved",
    });

    ctx.session = {};
    const typeLabel = houseTypeLabel(houseCashDealType);

    await ctx.reply(
      `✅ *Cash House ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n${typeLabel}\n` +
      `👤 ${houseCashName}  |  📞 ${houseCashPhone}\n` +
      `📍 ${houseCashLocation}\n💰 ${houseCashPrice}\n📝 ${houseCashDesc || "—"}\n\nፈቃድ ተሰጥቷል (ID: ${listing._id})`,
      { parse_mode: "Markdown", ...mainKb(ctx.from?.id) },
    );

    sendPersonalNotification(
      `✅ *Cash House ምዝገባ!*\n━━━━━━━━━━━━━━━━\n${typeLabel}\n` +
      `👤 *${houseCashName}*  |  📞 ${houseCashPhone}\n📍 ${houseCashLocation}\n💰 ${houseCashPrice}\n` +
      `⏰ ${new Date().toLocaleString("en-GB")}`,
    ).catch(() => {});

    return;
  }

  return next();
});

/* ─── 10. PHOTO / VIDEO — House Media ───────────────────── */
bot.on("video", async (ctx) => {
  const { step } = ctx.session || {};
  if (step !== "HOUSE_MEDIA") return;
  const fileId = ctx.message.video.file_id;
  ctx.session.houseMedia = ctx.session.houseMedia || [];
  ctx.session.houseMedia.push({ type: "video", fileId });
  await ctx.reply(`✅ ቪዲዮ ${ctx.session.houseMedia.length} ደርሷል። ተጨማሪ ይላኩ ወይም *✅ ጨርሻለሁ* ይጫኑ።`, { parse_mode: "Markdown" });
});

bot.on("photo", async (ctx) => {
  const { step } = ctx.session || {};
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (step === "HOUSE_MEDIA") {
    ctx.session.houseMedia = ctx.session.houseMedia || [];
    ctx.session.houseMedia.push({ type: "photo", fileId });
    await ctx.reply(`✅ ፎቶ ${ctx.session.houseMedia.length} ደርሷል። ተጨማሪ ይላኩ ወይም *✅ ጨርሻለሁ* ይጫኑ።`, { parse_mode: "Markdown" });
    return;
  }
});

/* ─── 11. STAFF / ADMIN PANEL ────────────────────────────── */
function staffPanelKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("የቤት ምዝገቦች",       "lst_house_menu")],
    [Markup.button.callback("Cash ምዝገባ — ቤት", "admin_cash_house")],
  ]);
}

function adminPanelKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("የቤት ምዝገቦች",           "lst_house_menu")],
    [Markup.button.callback("Cash ምዝገባ — ቤት",     "admin_cash_house")],
    [Markup.button.callback("📝 Welcome Message ቀይር", "welcome_edit")],
  ]);
}

bot.hears("🔧 Admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  ctx.session = {};
  await ctx.reply("*የአስተዳዳሪ ፓነል*", { parse_mode: "Markdown", ...adminPanelKb() });
});

bot.hears("👔 Staff", async (ctx) => {
  if (!isStaff(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  ctx.session = {};
  await ctx.reply("*የሰራተኛ ፓነል*", { parse_mode: "Markdown", ...staffPanelKb() });
});

bot.action("back_to_admin", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  if (isStaffOnly(ctx)) {
    await ctx.reply("*የሰራተኛ ፓነል*", { parse_mode: "Markdown", ...staffPanelKb() });
  } else {
    await ctx.reply("*የአስተዳዳሪ ፓነል*", { parse_mode: "Markdown", ...adminPanelKb() });
  }
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
    `\n\n━━━━━━━━━━━━━━━━\n👇 *አዲሱን መልዕክት* ይላኩ። \`{name}\` ይጠቀሙ\n\nወደ default: /resetwelcome`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

bot.command("resetwelcome", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await setSetting("welcome_message", null);
  ctx.session = {};
  await ctx.reply("✅ Welcome Message ወደ default ተመልሷል።", { parse_mode: "Markdown" });
});

/* ── Staff: Cash House Registration ─────────────────────── */
bot.action("admin_cash_house", async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("*Cash House ምዝገባ — ዓይነት ይምረጡ:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("ለመከራየት ይፈልጋል", "chouse_dt_rent_in")],
      [Markup.button.callback("🔑 ቤት ለማከራየት ያለው", "chouse_dt_rent_out")],
      [Markup.button.callback("🏘 ለመግዛት ይፈልጋል",   "chouse_dt_buy")],
      [Markup.button.callback("💰 ቤት ለመሸጥ ያለው",   "chouse_dt_sell")],
      [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
    ]),
  });
});

bot.action(/^chouse_dt_(rent_in|rent_out|buy|sell)$/, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "HOUSE_CASH_NAME", houseCashDealType: ctx.match[1] };
  await ctx.reply(
    `${houseTypeLabel(ctx.match[1])} — Cash ምዝገባ\n\n👤 ደንበኛው ሙሉ ስም:`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* ── House listings (Buy/Sell/Rent) — Admin/Staff viewer ──────────── */
bot.action("lst_house_menu", async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const counts = await HouseListing.aggregate([{ $group: { _id: "$dealType", n: { $sum: 1 } } }]);
  const cnt = (t) => counts.find((c) => c._id === t)?.n || 0;
  await ctx.reply("*የቤት ምዝገቦች — ዓይነት ይምረጡ:*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`🏘 ለመግዛት የተመዘገቡ (${cnt("buy")})`,       "lst_house_buy")],
      [Markup.button.callback(`💰 ለመሸጥ የተመዘገቡ (${cnt("sell")})`,       "lst_house_sell")],
      [Markup.button.callback(`ለመከራየት የተመዘገቡ (${cnt("rent_in")})`,  "lst_house_rent_in")],
      [Markup.button.callback(`🔑 ለማከራየት የተመዘገቡ (${cnt("rent_out")})`, "lst_house_rent_out")],
      [Markup.button.callback("🔙 ተመለስ", "back_to_admin")],
    ]),
  });
});

bot.action(/^lst_house_(buy|sell|rent_in|rent_out)$/, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const dealType = ctx.match[1];
  const list = await HouseListing.find({ dealType }).sort({ createdAt: -1 }).limit(30).lean();
  if (!list.length) return ctx.reply("ምንም ምዝገባ የለም።", { ...Markup.inlineKeyboard([[Markup.button.callback("🔙 ተመለስ", "lst_house_menu")]]) });

  const typeLabel = houseTypeLabel(dealType);
  await ctx.reply(`*${typeLabel} — ${list.length} ምዝገቦች (የቅርብ ጊዜ 30):*`, { parse_mode: "Markdown" });
  for (const r of list) {
    const detailsLine = houseDetailsLine(r);
    const caption =
      `${typeLabel}\n👤 ${r.fullName} | 📞 ${r.phone}\n📍 ${r.location}\n` +
      (detailsLine ? `${detailsLine}\n` : "") +
      `💰 ${r.price}\n📝 ${r.description || "—"}\n` +
      `📌 ሁኔታ: ${r.status}\n🆔 ${r._id}\n🗓 ${new Date(r.createdAt).toLocaleString("en-GB")}`;
    const firstMedia = r.media?.[0];
    try {
      if (firstMedia?.type === "photo") {
        await bot.telegram.sendPhoto(ctx.chat.id, firstMedia.fileId, { caption, parse_mode: "Markdown", ...houseApproveKb(r._id) });
      } else if (firstMedia?.type === "video") {
        await bot.telegram.sendVideo(ctx.chat.id, firstMedia.fileId, { caption, parse_mode: "Markdown", ...houseApproveKb(r._id) });
      } else {
        await ctx.reply(caption, { parse_mode: "Markdown", ...houseApproveKb(r._id) });
      }
    } catch (e) { console.error("lst_house:", e.message); }
  }
  await ctx.reply("⬆️ ዝርዝሩ ተጠናቋል", { ...Markup.inlineKeyboard([[Markup.button.callback("🔙 ተመለስ", "lst_house_menu")]]) });
});

function houseApproveKb(id) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ አፅድቅ", `house_appr_${id}`),
      Markup.button.callback("❌ ውድቅ",  `house_rej_${id}`),
    ],
    [Markup.button.callback("🗑 ሰርዝ", `house_del_${id}`)],
  ]);
}

bot.action(/^house_del_([a-f\d]{24})$/i, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("እርግጠኛ ነዎት ይህን ምዝገባ መሰረዝ ይፈልጋሉ?", Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ አዎ ሰርዝ", `house_delconfirm_${ctx.match[1]}`),
      Markup.button.callback("🚫 ይቅር",     "house_delcancel"),
    ],
  ]));
});

bot.action(/^house_delconfirm_([a-f\d]{24})$/i, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const r = await HouseListing.findByIdAndDelete(ctx.match[1]);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(r ? "🗑 ምዝገባው ተሰርዟል" : "❌ ምዝገባው አልተገኘም (ምናልባት ቀደም ብሎ ተሰርዟል)");
});

bot.action("house_delcancel", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply("🚫 ስረዛ ተሰርዟል");
});

bot.action(/^house_appr_([a-f\d]{24})$/i, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await HouseListing.findByIdAndUpdate(ctx.match[1], { status: "approved" });
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply("✅ ጸድቋል");
});

bot.action(/^house_rej_([a-f\d]{24})$/i, async (ctx) => {
  if (!isStaff(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await HouseListing.findByIdAndUpdate(ctx.match[1], { status: "rejected" });
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply("❌ ውድቅ ተደርጓል");
});

/* ─── 12. LAUNCH ─────────────────────────────────────────── */
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
  // ፖርቱን መጀመሪያ ክፈት — Render port scan ፈጥኖ ያልፍ፣ Mongo ቢዘገይም ችግር እንዳይፈጥር
  const server = http.createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); });
  await new Promise((resolve) => server.listen(PORT, () => { console.log("Port", PORT); resolve(); }));

  await connectMongo();

  try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); console.log("Webhook deleted"); }
  catch (e) { console.warn("deleteWebhook:", e.message); }

  const RURL = (process.env.RENDER_EXTERNAL_URL || "").trim();
  if (RURL) {
    setInterval(() => https.get(`${RURL}/`).on("error", () => {}), 14 * 60 * 1000);
  }

  bot.launch({ allowedUpdates: ["message", "callback_query"] }).catch((e) => {
    console.error("bot.launch error:", e.message);
  });

  console.log("Bot started — 24/7 active (ቤት ብቻ)");
  notifyAdmins(`✅ Bot ተጀምሯል — ${new Date().toLocaleString("en-GB")}\n24/7 active (ቤት ብቻ)`);

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
