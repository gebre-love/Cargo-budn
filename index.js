"use strict";

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const Anthropic = require("@anthropic-ai/sdk");
const http = require("http");

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

const REG_PER_KG = 10;
const SHIP_PER_KG = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN እና MONGO_URI ያስፈልጋሉ");
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_KEY })
  : null;

/* ─── 2. የቡድን ግዥ ምርቶች ──────────────────────────────────── */
const GB_PRODUCTS = [
  {
    id: "teff",
    emoji: "🌾",
    label: "ጤፍ",
    unit: "kg",
    targetKg: Number(process.env.GB_TEFF_KG) || 5000,
    pricePerKg: Number(process.env.GB_TEFF_PRICE) || 75,
  },
  {
    id: "oil",
    emoji: "🛢",
    label: "ዘይት",
    unit: "liter",
    targetKg: Number(process.env.GB_OIL_KG) || 3000,
    pricePerKg: Number(process.env.GB_OIL_PRICE) || 120,
  },
  {
    id: "sugar",
    emoji: "🍚",
    label: "ስኳር",
    unit: "kg",
    targetKg: Number(process.env.GB_SUGAR_KG) || 3000,
    pricePerKg: Number(process.env.GB_SUGAR_PRICE) || 55,
  },
  {
    id: "flour",
    emoji: "🌽",
    label: "ዱቄት",
    unit: "kg",
    targetKg: Number(process.env.GB_FLOUR_KG) || 3000,
    pricePerKg: Number(process.env.GB_FLOUR_PRICE) || 60,
  },
  {
    id: "onion",
    emoji: "🧅",
    label: "ሽንኩርት",
    unit: "kg",
    targetKg: Number(process.env.GB_ONION_KG) || 2000,
    pricePerKg: Number(process.env.GB_ONION_PRICE) || 30,
  },
];
const byProduct = (id) => GB_PRODUCTS.find((p) => p.id === id);
const unitLabel = (p) => (p.unit === "liter" ? "ሊትር" : "ኪሎ");

/* ─── ምናሌ ቁልፎች (toggle keys) ──────────────────────────── */
// ለያንዳንዱ ቁልፍ setting key, emoji, label
const MENU_SETTINGS = [
  { key: "menu_cargo_toamhara", emoji: "🔼", label: "አዲስ አበባ → አማራ ክልል (ጭነት)" },
  { key: "menu_cargo_toaa", emoji: "🔽", label: "አማራ ክልል → አዲስ አበባ (ጭነት)" },
  { key: "menu_my_regs", emoji: "📋", label: "የምዝገባ ዝርዝሬ" },
  { key: "menu_counter", emoji: "📊", label: "የጭነት ቆጣሪ" },
  ...GB_PRODUCTS.map((p) => ({
    key: `menu_product_${p.id}`,
    emoji: p.emoji,
    label: p.label,
  })),
];

/* ─── 3. ROUTES / METHODS ───────────────────────────────── */
const ROUTES_TO_AMHARA = [
  {
    id: "aa_finotselam",
    emoji: "🟢",
    label: "አዲስ አበባ → ፍኖተሰላም",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_debre_markos",
    emoji: "🔵",
    label: "አዲስ አበባ → ደብረ ማርቆስ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_mota",
    emoji: "🟤",
    label: "አዲስ አበባ → ሞጣ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_bahirdar",
    emoji: "🔵",
    label: "አዲስ አበባ → ባህር ዳር",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_gondar",
    emoji: "🟣",
    label: "አዲስ አበባ → ጎንደር",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_debre_berhan",
    emoji: "🟡",
    label: "አዲስ አበባ → ደብረ ብርሃን",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_kemissie",
    emoji: "🟠",
    label: "አዲስ አበባ → ከሚሴ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "aa_dessie",
    emoji: "🔴",
    label: "አዲስ አበባ → ደሴ",
    targetKg: TARGET_KG_DEFAULT,
  },
];
const ROUTES_TO_AA = [
  {
    id: "finotselam_aa",
    emoji: "🟢",
    label: "ፍኖተሰላም → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "debre_markos_aa",
    emoji: "🔵",
    label: "ደብረ ማርቆስ → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "mota_aa",
    emoji: "🟤",
    label: "ሞጣ → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "bahirdar_aa",
    emoji: "🔵",
    label: "ባህር ዳር → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "gondar_aa",
    emoji: "🟣",
    label: "ጎንደር → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "debre_berhan_aa",
    emoji: "🟡",
    label: "ደብረ ብርሃን → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "kemissie_aa",
    emoji: "🟠",
    label: "ከሚሴ → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
  {
    id: "dessie_aa",
    emoji: "🔴",
    label: "ደሴ → አዲስ አበባ",
    targetKg: TARGET_KG_DEFAULT,
  },
];
const ROUTES = [...ROUTES_TO_AMHARA, ...ROUTES_TO_AA];

const METHODS = [
  {
    id: "telebirr",
    emoji: "📱",
    label: "ቴሌብር",
    info: process.env.TELEBIRR_INFO || "Telebirr: 0960336138",
  },
  {
    id: "cbe",
    emoji: "🏦",
    label: "CBE ባንክ",
    info: process.env.CBE_INFO || "CBE: 1000370308447",
  },
];

const byRoute = (id) => ROUTES.find((r) => r.id === id);
const byMethod = (id) => METHODS.find((m) => m.id === id);
const ACTIVE = ["pending", "reviewing", "approved"];

/* ─── 4. DB MODELS ──────────────────────────────────────── */
const Reg = mongoose.model(
  "Reg",
  new mongoose.Schema({
    userId: { type: Number, required: true },
    username: { type: String, default: "" },
    fullName: String,
    phone: String,
    routeId: String,
    cargoDesc: String,
    weightKg: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 0 },
    paymentMethod: { type: String, default: null },
    paymentFileId: { type: String, default: null },
    locationLat: { type: Number, default: null },
    locationLng: { type: Number, default: null },
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "reviewing", "approved", "rejected", "sent"],
    },
    aiVerdict: { type: mongoose.Schema.Types.Mixed, default: null },
    aiAutoApproved: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }),
);

const GBReg = mongoose.model(
  "GBReg",
  new mongoose.Schema({
    userId: { type: Number, required: true },
    username: { type: String, default: "" },
    productId: { type: String, required: true },
    fullName: String,
    phone: String,
    weightKg: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    pricePerKg: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  }),
);

const Session = mongoose.model(
  "Session",
  new mongoose.Schema({
    key: { type: String, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: {
      type: Date,
      default: Date.now,
      index: { expireAfterSeconds: 86400 * 3 },
    },
  }),
);

const RouteCap = mongoose.model(
  "RouteCap",
  new mongoose.Schema({
    routeId: { type: String, unique: true },
    notified: { type: Boolean, default: false },
  }),
);

const GBProductCap = mongoose.model(
  "GBProductCap",
  new mongoose.Schema({
    productId: { type: String, unique: true },
    notified: { type: Boolean, default: false },
  }),
);

const BotSettings = mongoose.model(
  "BotSettings",
  new mongoose.Schema({
    key: { type: String, unique: true },
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

/* ─── ዋጋ ከ DB ይጫናሉ (startup + setprice) ─────────────────── */
async function loadPricesFromDB() {
  for (const prod of GB_PRODUCTS) {
    const saved = await getSetting(`price_${prod.id}`, null);
    if (saved !== null && saved > 0) prod.pricePerKg = saved;
  }
}

/* ─── 5. SESSION ────────────────────────────────────────── */
async function getSession(key) {
  try {
    const d = await Session.findOne({ key }).lean();
    return d?.data || {};
  } catch {
    return {};
  }
}
async function saveSession(key, data) {
  try {
    await Session.findOneAndUpdate(
      { key },
      { data, updatedAt: new Date() },
      { upsert: true },
    );
  } catch {}
}
function sessionMW(ctx, next) {
  const key = `${ctx.chat?.id}:${ctx.from?.id}`;
  return getSession(key).then((data) => {
    ctx.session = data;
    return next().then(() => saveSession(key, ctx.session));
  });
}

/* ─── 6. RATE LIMITING ──────────────────────────────────── */
const rateLimitMap = new Map();
function isRateLimited(userId, limit = 20) {
  const now = Date.now();
  const e = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000 };
  if (now > e.reset) {
    e.count = 0;
    e.reset = now + 60_000;
  }
  e.count++;
  rateLimitMap.set(userId, e);
  return e.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitMap) if (now > v.reset) rateLimitMap.delete(k);
}, 5 * 60_000);

/* ─── 7. HELPERS ────────────────────────────────────────── */
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

const ST = {
  pending: "ክፍያ ይጠብቃል",
  reviewing: "እየተፈተሸ ነው",
  approved: "ተፈቅዷል",
  rejected: "አልተቀበለም",
  sent: "ተልኳል",
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId),
    me = byMethod(r.paymentMethod);
  let t =
    `${ro?.emoji} *${ro?.label}*\n` +
    `ስም: ${r.fullName} | ስልክ: ${r.phone}\n` +
    `ጭነት: ${r.cargoDesc} — ${r.weightKg} ኪሎ\n` +
    `ክፍያ: ${me?.label || "—"} | አድራሻ: ${r.locationLat ? `[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : "አልተላከም"}\n` +
    `ሁኔታ: ${ST[r.status]}`;
  if (r.aiAutoApproved) t += " (AI ያረጋገጠ)";
  if (admin) t += `\n\`${r.userId}\`${r.username ? " @" + r.username : ""}`;
  return t;
}

function capLine(total, target) {
  const pct = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10),
    remain = Math.max(0, target - total);
  return (
    "█".repeat(filled) +
    "░".repeat(10 - filled) +
    " " +
    pct +
    "%\n" +
    "የተመዘገበ: " +
    total +
    " ኪሎ | ቀሪ: " +
    remain +
    " ኪሎ | ኢላማ: " +
    target +
    " ኪሎ"
  );
}

/* ─── 8. KEYBOARDS ──────────────────────────────────────── */
// mainKb: ለያንዳንዱ ቁልፍ setting ይፈትሻል
// Admin ዎች ሁሌ ሁሉንም ቁልፎች ያያሉ
async function mainKb(userId) {
  const isAdminUser = ADMIN_IDS.includes(userId);

  // ሁሉንም settings በአንድ ጊዜ ይጫናሉ
  const [cargoToAmhara, cargoToAA, myRegs, counter, ...productEnabled] =
    await Promise.all([
      getSetting("menu_cargo_toamhara", true),
      getSetting("menu_cargo_toaa", true),
      getSetting("menu_my_regs", true),
      getSetting("menu_counter", true),
      ...GB_PRODUCTS.map((p) => getSetting(`menu_product_${p.id}`, true)),
    ]);

  const rows = [];

  // ጭነት አቅጣጫዎች
  const row1 = [];
  if (isAdminUser || cargoToAmhara) row1.push("🔼 አዲስ አበባ → አማራ ክልል");
  if (isAdminUser || cargoToAA) row1.push("🔽 አማራ ክልል → አዲስ አበባ");
  if (row1.length) rows.push(row1);

  // ምዝገባ እና ቆጣሪ
  const row2 = [];
  if (isAdminUser || myRegs) row2.push("📋 የምዝገባ ዝርዝሬ");
  if (isAdminUser || counter) row2.push("📊 የጭነት ቆጣሪ");
  if (row2.length) rows.push(row2);

  // ምርቶች (ጤፍ, ዘይት, ስኳር | ዱቄት, ሽንኩርት)
  const prodRow1 = [],
    prodRow2 = [];
  GB_PRODUCTS.forEach((p, i) => {
    if (isAdminUser || productEnabled[i]) {
      const btn = `${p.emoji} ${p.label}`;
      if (i < 3) prodRow1.push(btn);
      else prodRow2.push(btn);
    }
  });
  if (prodRow1.length) rows.push(prodRow1);
  if (prodRow2.length) rows.push(prodRow2);

  // Admin ቁልፍ
  if (ADMIN_IDS.length) rows.push(["🔧 Admin"]);

  // ምንም ቁልፍ ከሌለ keyboard ያስወግዳል
  if (!isAdminUser && rows.length === (ADMIN_IDS.length ? 1 : 0)) {
    return Markup.removeKeyboard();
  }

  return Markup.keyboard(rows).resize();
}

const dirRoutesKb = (routes) =>
  Markup.inlineKeyboard(
    routes.map((r) => [
      Markup.button.callback(`${r.emoji} ${r.label}`, `goto_${r.id}`),
    ]),
  );
const locKb = () =>
  Markup.keyboard([
    [Markup.button.locationRequest("📍 አድራሻዬን ላክ")],
    ["⏭️ ሳላጋራ ጨርስ"],
  ])
    .resize()
    .oneTime();
const approveKb = (id) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("ፈቀድ", `ok_${id}`),
      Markup.button.callback("ከልክል", `no_${id}`),
    ],
  ]);

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
      bot.telegram
        .sendMessage(
          m.userId,
          `*${ro.label}* — ጭነቱ ሞልቷል!\n\nሠራተኞቻችን ቤትዎ ይሰበሰቡዎታል — ዝግጁ ይሁኑ.\n${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    for (const aid of ADMIN_IDS)
      bot.telegram
        .sendMessage(
          aid,
          `${ro.label} ሞልቷል — ${total}/${ro.targetKg}ኪሎ | ${members.length} ሰው`,
        )
        .catch(() => {});
    if (CHANNEL_ID)
      bot.telegram
        .sendMessage(
          CHANNEL_ID,
          `*${ro.label}*\n${capLine(total, ro.targetKg)}\n\nየጋራ ጭነት — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
  } else if (total < ro.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

/* ─── GB CAPACITY CHECK ─────────────────────────────────── */
async function checkGBCapacity(productId) {
  const prod = byProduct(productId);
  if (!prod) return;

  const agg = await GBReg.aggregate([
    { $match: { productId } },
    { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
  ]);
  const totalKg = agg[0]?.kg || 0;
  const totalCount = agg[0]?.count || 0;
  const ul = unitLabel(prod);

  let cap = await GBProductCap.findOne({ productId });
  if (!cap) cap = await GBProductCap.create({ productId, notified: false });

  if (totalKg >= prod.targetKg && !cap.notified) {
    cap.notified = true;
    await cap.save();

    // ሁሉም ተጠቃሚዎች notification ይደርሳቸዋል
    const members = await GBReg.find({ productId }).lean();
    const uniqueUsers = [
      ...new Map(members.map((m) => [m.userId, m])).values(),
    ];

    for (const m of uniqueUsers) {
      bot.telegram
        .sendMessage(
          m.userId,
          `🎉 *${prod.emoji} ${prod.label} — ምዝገባ ሞልቷል!*\n\n` +
            `ጠቅላላ: *${totalKg} ${ul}* | ${totalCount} ሰው\n\n` +
            `✅ ምርቱ ከምንጩ ይዘዛል — ከሂደቱ ለማወቅ ይጠብቁ!\n\n` +
            `ዋጋ: *${prod.pricePerKg} ብር/${ul}*\nለጥያቄ: ${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }

    // admins ያሳወቃቸዋል
    for (const aid of ADMIN_IDS) {
      bot.telegram
        .sendMessage(
          aid,
          `✅ *${prod.emoji} ${prod.label}* — ምዝገባ ሞልቷል!\n${totalKg}/${prod.targetKg} ${ul} | ${totalCount} ሰው`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }

    // ቻናል ማስታወቂያ
    if (CHANNEL_ID) {
      bot.telegram
        .sendMessage(
          CHANNEL_ID,
          `*${prod.emoji} ${prod.label} — ምዝገባ ሞልቷል!*\n\n` +
            `${capLine(totalKg, prod.targetKg)}\n\n` +
            `ቀጥታ ከ ምንጭ — *${prod.pricePerKg} ብር/${ul}*\n${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
  } else if (totalKg < prod.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

/* ─── 10. AI PAYMENT CHECK ──────────────────────────────── */
async function checkPayment(fileId, reg) {
  if (!anthropic) return null;
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const res = await fetch(link.href || String(link));
    if (!res.ok) throw new Error("fetch fail");
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    const mime = res.headers.get("content-type") || "image/jpeg";
    const m = byMethod(reg.paymentMethod);
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mime, data: b64 },
            },
            {
              type: "text",
              text: `Payment screenshot. Method:${m?.label} Account:"${m?.info}" Amount:${reg.totalPrice}ETB\nReply ONLY JSON: {"amount_match":true/false,"account_match":true/false,"looks_edited":true/false,"confidence":"high|medium|low","reason":"short amharic"}`,
            },
          ],
        },
      ],
    });
    const raw = msg.content.find((b) => b.type === "text")?.text || "{}";
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("AI:", e.message);
    return null;
  }
}
const aiOk = (r) =>
  r?.amount_match &&
  r?.account_match &&
  !r?.looks_edited &&
  r?.confidence === "high";
const aiSummary = (r) =>
  !r
    ? "AI ማረጋገጫ አልተሳካም"
    : `AI: ${aiOk(r) ? "ተረጋግጧል" : r?.looks_edited ? "ሊስተካከል ይችላል" : "አልተረጋገጠም"} (${r.confidence}) ${r.reason || ""}`;

/* ─── 11. PRINT MANIFEST ────────────────────────────────── */
const PRINT_STATUS = {
  approved: "ፈቃድ ያለው",
  reviewing: "እየተፈተሸ",
  pending: "ያልከፈለ",
  sent: "ተልኳል",
};

function buildManifestHTML(ro, list) {
  const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalReg = totalKg * REG_PER_KG,
    totalShip = totalKg * SHIP_PER_KG;
  const cnt = { approved: 0, reviewing: 0, pending: 0, sent: 0 };
  list.forEach((r) => {
    if (cnt[r.status] !== undefined) cnt[r.status]++;
  });
  const now = new Date(),
    dateStr = now.toLocaleDateString("en-GB"),
    timeStr = now.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const ORDER = ["approved", "sent", "reviewing", "pending"];
  const sorted = [...list].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status),
  );
  const rows = sorted
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.fullName || "—"}</td><td>${r.phone || "—"}</td><td>${r.cargoDesc || "—"}</td><td class="num">${r.weightKg || 0}</td><td class="status status-${r.status}">${PRINT_STATUS[r.status] || r.status}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><title>${ro.label} — የጭነት ዝርዝር</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:'Noto Sans Ethiopic','Nyala',Arial,sans-serif;color:#1a1a1a;margin:0;padding:18px;font-size:13px}.letterhead{display:flex;justify-content:space-between;border-bottom:3px solid #1a3c6e;padding-bottom:10px;margin-bottom:14px}.letterhead h1{font-size:18px;margin:0 0 4px;color:#1a3c6e}.letterhead .meta{text-align:right;font-size:12px}.route-banner{background:#1a3c6e;color:#fff;padding:8px 14px;border-radius:4px;font-size:15px;font-weight:bold;margin-bottom:14px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.box{border:1px solid #ccc;border-radius:5px;padding:7px 13px;text-align:center;background:#f7f8fa;min-width:95px}.box .v{font-size:18px;font-weight:bold;color:#1a3c6e}.box .l{font-size:10px;color:#666;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px}th{background:#1a3c6e;color:#fff;padding:7px 6px;text-align:left}td{padding:6px;border-bottom:1px solid #ddd}tr:nth-child(even){background:#f5f6f8}.num{text-align:center}.status{text-align:center;font-weight:bold;font-size:11px}.status-approved{color:#1a7d3b}.status-sent{color:#1565c0}.status-reviewing{color:#b8860b}.status-pending{color:#888}.footer{margin-top:30px;display:flex;justify-content:space-between;font-size:12px}.sign-box{width:45%}.sign-line{border-top:1px solid #333;margin-top:36px;padding-top:4px;text-align:center}.stamp-note{margin-top:26px;font-size:11px;color:#777;text-align:center}#printBtn{margin:16px 0;padding:10px 28px;font-size:14px;background:#1a3c6e;color:#fff;border:none;border-radius:6px;cursor:pointer}@media print{#printBtn{display:none}body{padding:0}}</style></head><body>
<button id="printBtn" onclick="window.print()">ይህን ፕሪንት ያድርጉ</button>
<div class="letterhead"><div><h1>የጋራ ጭነት አገልግሎት</h1><div style="font-size:12px;color:#555">Cargo Group-Booking Manifest</div></div><div class="meta">${dateStr} &nbsp; ${timeStr}<br>${SUPPORT_PHONE}</div></div>
<div class="route-banner">${ro.emoji} ${ro.label}</div>
<div class="summary"><div class="box"><div class="v">${list.length}</div><div class="l">ጠቅላላ ተሳፋሪ</div></div><div class="box"><div class="v">${totalKg}</div><div class="l">ጠቅላላ ኪሎ</div></div><div class="box"><div class="v">${cnt.approved + cnt.sent}</div><div class="l">ፈቃድ ያላቸው</div></div><div class="box"><div class="v">${cnt.pending + cnt.reviewing}</div><div class="l">በሂደት ላይ</div></div><div class="box"><div class="v">${totalReg.toLocaleString("en")}</div><div class="l">የምዝገባ ክፍያ (ብር)</div></div><div class="box"><div class="v">${totalShip.toLocaleString("en")}</div><div class="l">የጭነት ክፍያ (ብር)</div></div></div>
<table><thead><tr><th>#</th><th>ሙሉ ስም</th><th>ስልክ ቁጥር</th><th>የጭነት ዓይነት</th><th class="num">ኪሎ</th><th class="status">ሁኔታ</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer"><div class="sign-box"><div class="sign-line">የሹፍር ስም እና ፊርማ — Driver Name &amp; Signature</div></div><div class="sign-box"><div class="sign-line">የተረከበ ባለሥልጣን ፊርማ — Receiving Officer Signature</div></div></div>
<div class="stamp-note">ይህ ሰነድ በ${ro.label} የጭነት ጉዞ ላይ ለፖሊስ/ኬላ ማሳያ ሰነድ ነው።</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script></body></html>`;
}

async function sendDocumentWithRetry(chatId, doc, extra, retries = 4) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await bot.telegram.sendDocument(chatId, doc, extra);
    } catch (e) {
      lastErr = e;
      if (i < retries - 1)
        await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) {
    await ctx.reply("መስመር አልተገኘም");
    return;
  }
  let waitMsg;
  try {
    waitMsg = await ctx.reply("ሰነዱ እየተዘጋጀ ነው፣ ትንሽ ይጠብቁ...");
    const list = await Reg.find({ routeId, status: { $ne: "rejected" } })
      .sort({ createdAt: 1 })
      .lean();
    if (!list.length) {
      await ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);
      return;
    }
    const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    const html = buildManifestHTML(ro, list),
      buf = Buffer.from(html, "utf-8");
    const fname = `${ro.id}_${new Date().toISOString().slice(0, 10)}.html`;
    await sendDocumentWithRetry(
      ctx.chat.id,
      { source: buf, filename: fname },
      {
        caption: `*${ro.label}* — ፕሪንት ዝግጁ ሰነድ\n${list.length} ሰው | ${totalKg} ኪሎ\n\nፋይሉን ይክፈቱ — ፕሪንት ይከፈታል`,
        parse_mode: "Markdown",
      },
    );
    if (waitMsg)
      bot.telegram
        .deleteMessage(ctx.chat.id, waitMsg.message_id)
        .catch(() => {});
  } catch (e) {
    console.error("handlePrint:", e.message);
    await ctx.reply("ፋይሉን መላክ አልተሳካም\n\nትንሽ ቆይተው እንደገና ይሞክሩ።").catch(() => {});
  }
}

/* ─── 12. DAILY REPORT ──────────────────────────────────── */
async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;
  let txt = `ዕለታዊ ሪፖርት — ${new Date().toLocaleDateString("am-ET")}\n\n`;
  let gKg = 0,
    gPeople = 0,
    gPending = 0;
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } },
    ]);
    const m = {};
    counts.forEach((c) => {
      m[c._id] = { n: c.n, kg: c.kg };
    });
    const people = counts.reduce((s, c) => s + c.n, 0);
    const kg =
      (m.pending?.kg || 0) +
      (m.reviewing?.kg || 0) +
      (m.approved?.kg || 0) +
      (m.sent?.kg || 0);
    gKg += kg;
    gPeople += people;
    gPending += (m.pending?.n || 0) + (m.reviewing?.n || 0);
    if (!people) continue;
    txt += `${ro.emoji} ${ro.label}\n${people} ሰው | ${kg} ኪሎ | ፈቃድ: ${m.approved?.n || 0} | ፍተሻ: ${m.reviewing?.n || 0} | ያልከፈለ: ${m.pending?.n || 0} | ተልኳል: ${m.sent?.n || 0}\n\n`;
  }
  txt += `ጠቅላላ: ${gPeople} ሰው | ${gKg} ኪሎ | ያልተፈቀዱ: ${gPending}\nምዝ: ${(gKg * REG_PER_KG).toLocaleString()} ብ | ጭ: ${(gKg * SHIP_PER_KG).toLocaleString()} ብ`;
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(aid, txt).catch(() => {});
}

function startDailyReportScheduler() {
  let last = "";
  setInterval(async () => {
    const eat = new Date(Date.now() + 3 * 60 * 60 * 1000),
      date = eat.toISOString().slice(0, 10);
    if (eat.getUTCHours() === 7 && eat.getUTCMinutes() === 0 && last !== date) {
      last = date;
      await sendDailyReport().catch((e) =>
        console.error("Daily report:", e.message),
      );
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
  if (ctx.from?.id && !isAdmin(ctx) && isRateLimited(ctx.from.id))
    return ctx.reply("ብዙ ጥያቄ — ትንሽ ይጠብቁ").catch(() => {});
  return next();
});
bot.catch((err, ctx) =>
  console.error("Bot error:", err?.message, ctx?.updateType),
);

/* ─── 14. WELCOME ───────────────────────────────────────── */
function welcomeText(name) {
  const prices = GB_PRODUCTS.map((p) => {
    const ul = unitLabel(p);
    return `${p.emoji} *${p.label}* — ${p.pricePerKg} ብር/${ul}`;
  }).join("\n");

  return (
    `*እንኳን ደህና መጡ, ${name}!* 🎉\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `*🛒 የቡድን ግዥ ምንድን ነው?*\n` +
    `ብዙ ሰዎች አንድ ላይ በመሰብሰብ ምርቶችን\n` +
    `ቀጥታ ከ *ገበሬዎች* እና ከ *ፋብሪካዎች* እናመጣለን —\n` +
    `ሁሉም ሰው *ከገበያ ዋጋ ያነሰ* ዋጋ ያገኛል!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*አሁናዊ የቡድን ግዥ ዋጋዎች:*\n\n` +
    `${prices}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `*እንዴት ይሰራል?*\n` +
    `1️⃣ ምርቱን ከዚህ ይምረጡ (🌾 🛢 🍚 🌽 🧅)\n` +
    `2️⃣ ስምዎን፣ ስልክዎን እና ምን ያህል እንደሚፈልጉ ያስገቡ\n` +
    `3️⃣ ምዝገባ ሲሞላ ቤትዎ ድረስ ይደርሳል!\n\n` +
    `ቀጥታ ከ ምንጭ — *ፈጣን፣ ርካሽ፣ አስተማማኝ!*\n\n` +
    `ለጥያቄ: ${SUPPORT_PHONE}\n\n` +
    `*ከዚህ በታች ምርት ይምረጡ:*`
  );
}

bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});
bot.command("help", async (ctx) => {
  ctx.session = {};
  await ctx.reply(welcomeText(ctx.from?.first_name || "እንኳን ደህና መጡ"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});

/* ─── 15. ቆጣሪ / ምዝገባዬ ─────────────────────────────────── */
bot.hears("📊 የጭነት ቆጣሪ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_counter", true)))
    return ctx.reply(
      "ይህ አገልግሎት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE,
      await mainKb(ctx.from?.id),
    );
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
  await ctx.reply(txt, {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});

bot.hears("📋 የምዝገባ ዝርዝሬ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_my_regs", true)))
    return ctx.reply(
      "ይህ አገልግሎት አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE,
      await mainKb(ctx.from?.id),
    );
  ctx.session = {};
  const list = await Reg.find({
    userId: ctx.from.id,
    status: { $nin: ["rejected"] },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!list.length)
    return ctx.reply("ምዝገባ የለዎትም። አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
  for (const r of list) {
    const btns = [];
    if (r.status !== "sent")
      btns.push(Markup.button.callback("ሰርዝ", `del_${r._id}`));
    if (!r.locationLat && r.status !== "sent")
      btns.push(Markup.button.callback("አድራሻ ላክ", `addloc_${r._id}`));
    await ctx.reply(card(r), {
      parse_mode: "Markdown",
      ...(btns.length ? Markup.inlineKeyboard([btns]) : {}),
    });
  }
});

bot.action(/^addloc_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step: "LOC", locRegId: String(r._id), locTries: 0 };
  await ctx.reply("አድራሻዎን ያጋሩ:", locKb());
});

/* ─── 16. የቡድን ግዥ — ምርት ምዝገባ ──────────────────────────── */
for (const prod of GB_PRODUCTS) {
  bot.hears(`${prod.emoji} ${prod.label}`, async (ctx) => {
    // ምርቱ ተዘጋ ከሆነ
    if (!isAdmin(ctx) && !(await getSetting(`menu_product_${prod.id}`, true))) {
      return ctx.reply(
        `${prod.emoji} *${prod.label}* — አሁን ጊዜያዊ ተዘግቷል።\n\nሲከፈት እናሳውቅዎታለን!\nለጥያቄ: ${SUPPORT_PHONE}`,
        { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
      );
    }

    ctx.session = { step: "GB_NAME", gbProductId: prod.id };
    const agg = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0,
      regCount = agg[0]?.count || 0;
    const ul = unitLabel(prod);

    await ctx.reply(
      `${prod.emoji} *${prod.label} — የቡድን ግዥ*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💰 *አሁናዊ ዋጋ: ${prod.pricePerKg} ብር/${ul}*\n` +
        `_(ቀጥታ ከ ምንጭ — ከገበያ ዋጋ ያነሰ!)_\n\n` +
        `${capLine(regKg, prod.targetKg)}\n` +
        `ተሳታፊ ሰዎች: ${regCount}\n\n` +
        `ለመመዝገብ *ሙሉ ስምዎን* ያስገቡ:`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
  });
}

/* ─── 17. ROUTE SELECTION ───────────────────────────────── */
async function startRegistration(ctx, route) {
  const ex = await Reg.findOne({
    userId: ctx.from.id,
    routeId: route.id,
    status: { $nin: ["rejected", "sent"] },
  }).lean();
  if (ex) {
    const btns = [Markup.button.callback("ሰርዝ", `del_${ex._id}`)];
    if (!ex.locationLat)
      btns.push(Markup.button.callback("አድራሻ ላክ", `addloc_${ex._id}`));
    btns.push(Markup.button.callback("ሌላ እቃ ጨምር", `more_${route.id}`));
    return ctx.reply(card(ex) + "\n\n_ቀደም ሲል ተመዝግበዋል_", {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([btns]),
    });
  }
  ctx.session = { step: "NAME", routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}*\n\nሙሉ ስምዎን ያስገቡ:`, {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
}

bot.hears("🔼 አዲስ አበባ → አማራ ክልል", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_cargo_toamhara", true)))
    return ctx.reply(
      "ይህ አቅጣጫ አሁን ጊዜያዊ ተዘግቷል።\nለጥያቄ: " + SUPPORT_PHONE,
      await mainKb(ctx.from?.id),
    );
  ctx.session = {};
  await ctx.reply("*አዲስ አበባ → አማራ ክልል* — መስመር ይምረጡ:", {
    parse_mode: "Markdown",
    ...dirRoutesKb(ROUTES_TO_AMHARA),
  });
});

bot.hears("🔽 አማራ ክልል → አዲስ አበባ", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_cargo_toaa", true)))
    return ctx.reply(
      "ይህ አቅጣጫ አሁን ጊዜያዊ ተዘግቷል።\nለጥያቄ: " + SUPPORT_PHONE,
      await mainKb(ctx.from?.id),
    );
  ctx.session = {};
  await ctx.reply("*አማራ ክልል → አዲስ አበባ* — መስመር ይምረጡ:", {
    parse_mode: "Markdown",
    ...dirRoutesKb(ROUTES_TO_AA),
  });
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
    `${route.emoji} *${route.label}* — ሌላ እቃ ጨምር\n\nሙሉ ስምዎን ያስገቡ:`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
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
    userId: ctx.from.id,
    username: ctx.from.username || "",
    fullName: d.name,
    phone: d.phone,
    routeId,
    cargoDesc: d.cargo,
    weightKg: d.kg,
    totalPrice: d.kg * REG_PER_KG,
    paymentMethod: m.id,
    status: "pending",
  });
  await checkCapacity(routeId);
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const acct = m.info.includes(":")
    ? m.info.split(":").slice(1).join(":").trim()
    : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `ቁጥር: \`${acct}\`\n\n` +
      `*የምዝገባ ክፍያ: ${r.totalPrice} ብር* (${d.kg} ኪሎ × ${REG_PER_KG} ብር/ኪሎ)\n\n` +
      `⚠️ ክፍያ ከፈጸሙ በኋላ *የደረሰኝ ፎቶ (screenshot)* ይላኩ።\n` +
      `ፎቶ ሳይልኩ ምዝገባ አይጠናቀቅም!`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
});

/* ─── 19. TEXT FLOW ─────────────────────────────────────── */
bot.on("text", async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();

  const reserved = [
    "📋 የምዝገባ ዝርዝሬ",
    "📊 የጭነት ቆጣሪ",
    "🔧 Admin",
    "⏭️ ሳላጋራ ጨርስ",
    "🔼 አዲስ አበባ → አማራ ክልል",
    "🔽 አማራ ክልል → አዲስ አበባ",
    ...GB_PRODUCTS.map((p) => `${p.emoji} ${p.label}`),
  ];
  if (reserved.includes(txt)) return next();

  /* ── የቡድን ግዥ ምዝገባ steps ── */
  if (step === "GB_NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል)");
    ctx.session.gbName = txt;
    ctx.session.step = "GB_PHONE";
    return ctx.reply("ስልክ ቁጥርዎን ያስገቡ (ምሳሌ: 0912345678):");
  }

  if (step === "GB_PHONE") {
    const phone = txt.replace(/\s/g, "");
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply("ትክክለኛ ስልክ ያስገቡ\nምሳሌ: 0912345678");
    ctx.session.gbPhone = phone;
    ctx.session.step = "GB_KG";
    const prod = byProduct(ctx.session.gbProductId);
    const ul = unitLabel(prod);
    return ctx.reply(
      `ምን ያህል *${ul}* *${prod?.label}* ይፈልጋሉ?\n` +
        `_(1 ${ul} = ${prod?.pricePerKg} ብር)_\n\nቁጥር ያስገቡ:`,
      { parse_mode: "Markdown" },
    );
  }

  if (step === "GB_KG") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 5000)
      return ctx.reply("ትክክለኛ ቁጥር ያስገቡ (1–5000)");
    const prod = byProduct(ctx.session.gbProductId);
    const ul = unitLabel(prod);
    const { gbName, gbPhone, gbProductId } = ctx.session;
    const totalCost = Math.round(kg * (prod?.pricePerKg || 0));
    ctx.session = {};

    await GBReg.create({
      userId: ctx.from.id,
      username: ctx.from.username || "",
      productId: gbProductId,
      fullName: gbName,
      phone: gbPhone,
      weightKg: kg,
      totalCost,
      pricePerKg: prod?.pricePerKg || 0,
    });

    const agg = await GBReg.aggregate([
      { $match: { productId: gbProductId } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0,
      regCount = agg[0]?.count || 0;

    await ctx.reply(
      `✅ *ምዝገባ ተጠናቀቀ!*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${prod?.emoji} *${prod?.label}*\n` +
        `ስም: ${gbName} | ስልክ: ${gbPhone}\n` +
        `ተመዝግቦ: *${kg} ${ul}*\n` +
        `💰 ዋጋ: ${prod?.pricePerKg} ብር/${ul}\n` +
        `💵 ጠቅላላ: *${totalCost.toLocaleString()} ብር*\n\n` +
        `*ጠቅላላ ሁኔታ:*\n${capLine(regKg, prod?.targetKg || 5000)}\n` +
        `ተሳታፊ ሰዎች: ${regCount}\n\n` +
        `ምዝገባ ሲሞላ እናሳውቅዎታለን!\nለጥያቄ: ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );

    for (const aid of ADMIN_IDS)
      bot.telegram
        .sendMessage(
          aid,
          `አዲስ GB ምዝገባ: ${prod?.emoji}${prod?.label} — ${gbName} (${gbPhone}) — ${kg}${ul} @ ${prod?.pricePerKg}ብ/${ul} = ${totalCost.toLocaleString()}ብ`,
        )
        .catch(() => {});

    // ምዝገባ ሞልቷል ከሆነ ሁሉንም ያሳውቃቸዋል
    checkGBCapacity(gbProductId).catch(() => {});
    return;
  }

  /* ── የጭነት ምዝገባ steps ── */
  if (step === "PAYMETHOD") return ctx.reply("ከቁልፍ ይምረጡ");
  if (step === "NAME") {
    if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል)");
    ctx.session.d.name = txt;
    ctx.session.step = "PHONE";
    return ctx.reply("ስልክ ቁጥርዎን ያስገቡ:");
  }
  if (step === "PHONE") {
    const phone = txt.replace(/\s/g, "");
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply("ትክክለኛ ስልክ ያስገቡ\nምሳሌ: 0912345678");
    ctx.session.d.phone = phone;
    ctx.session.step = "CARGO";
    return ctx.reply("ጭነት ዓይነት (ምን ዓይነት እቃ?):");
  }
  if (step === "CARGO") {
    ctx.session.d.cargo = txt;
    ctx.session.step = "WEIGHT";
    return ctx.reply("ክብደት (ኪሎ):");
  }
  if (step === "WEIGHT") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 2000)
      return ctx.reply("ትክክለኛ ቁጥር ያስገቡ (1–2000)");
    ctx.session.d.kg = kg;
    ctx.session.step = "PAYMETHOD";
    return ctx.reply(
      `*ማጠቃለያ*\n━━━━━━━━━━━━━━━━\n` +
        `ስም: ${ctx.session.d.name}\n` +
        `ጭነት: ${ctx.session.d.cargo} — *${kg} ኪሎ*\n\n` +
        `💳 *የምዝገባ ክፍያ: ${kg * REG_PER_KG} ብር* (አሁን ይከፈላል)\n` +
        `🚚 የጭነት ክፍያ: ${kg * SHIP_PER_KG} ብር (ሲሰበሰብ)\n\n` +
        `ክፍያ ዘዴ ይምረጡ:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(
          METHODS.map((m) => [
            Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`),
          ]),
        ),
      },
    );
  }

  /* ── Send note step ── */
  if (step === "SEND_NOTE") {
    const { sendRoute } = ctx.session;
    ctx.session = {};
    const ready = await Reg.find({
      routeId: sendRoute,
      status: "approved",
    }).lean();
    if (!ready.length) return ctx.reply("ፈቃድ ያለው ምዝገባ የለም");
    const ro = byRoute(sendRoute);
    const note = txt;
    for (const r of ready) {
      await Reg.findByIdAndUpdate(r._id, { status: "sent" });
      bot.telegram
        .sendMessage(
          r.userId,
          `*ጭነትዎ ተልኳል!*\n${ro?.emoji} ${ro?.label}\n\n${note}\n\nለጥያቄ: ${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
    await ctx.reply(`✅ ${ready.length} ሰው ታወቀ — ${ro?.label}`);
    return;
  }

  /* ── Collector location step ── */
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
    const approved = await Reg.find({
      routeId: colRoute,
      status: "approved",
      locationLat: { $ne: null },
    }).lean();
    if (!approved.length)
      return ctx.reply(`${ro.label} — አድራሻ ያላቸው ፈቃድ ያለው ምዝገባ የለም`);
    const nearby = approved
      .map((r) => {
        const dlat = r.locationLat - lat,
          dlng = r.locationLng - lng;
        const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
        return { ...r, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);
    let txt = `${ro.emoji} *${ro.label}* — ቅርብ ደንበኞች\n━━━━━━━━━━━━━━━━\n\n`;
    for (const r of nearby) {
      txt += `${r.fullName} | ${r.phone} | ${r.weightKg}ኪ | ${r.dist.toFixed(1)}ኪሜ\n[ካርታ](https://maps.google.com/?q=${r.locationLat},${r.locationLng})\n\n`;
    }
    return ctx.reply(txt, { parse_mode: "Markdown" });
  }

  if (step === "LOC") {
    const regId = ctx.session.locRegId;
    ctx.session = {};
    const r = await Reg.findByIdAndUpdate(
      regId,
      { locationLat: lat, locationLng: lng },
      { new: true },
    );
    if (!r) return ctx.reply("ምዝገባ አልተገኘም", await mainKb(ctx.from?.id));
    const total = await routeWeight(r.routeId),
      ro2 = byRoute(r.routeId);
    await ctx.reply(
      `*ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n\n${ro2?.emoji} *${ro2?.label}*\n${capLine(total, ro2?.targetKg || TARGET_KG_DEFAULT)}\n\nጭነቱ ሲሞላ ቤትዎ ይሰበሰብለዎታል\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    for (const aid of ADMIN_IDS) {
      bot.telegram
        .sendMessage(
          aid,
          `አድራሻ ደረሰ: ${r.fullName} (${r.phone}) → ${ro2?.label}`,
        )
        .catch(() => {});
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }
  return next();
});

bot.hears("⏭️ ሳላጋራ ጨርስ", async (ctx) => {
  if (ctx.session?.step !== "LOC")
    return ctx.reply("አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply(
    `*ምዝገባ ተጠናቀቀ!*\n\nአድራሻ ኋላ ለማጨምር:\n"📋 የምዝገባ ዝርዝሬ" → "አድራሻ ላክ"\n\n${SUPPORT_PHONE}`,
    await mainKb(ctx.from?.id),
  );
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r)
      for (const aid of ADMIN_IDS)
        bot.telegram
          .sendMessage(aid, `አድራሻ አልተላከም — ${r.fullName} (${r.phone})`)
          .catch(() => {});
  }
});

/* ─── 21. PAYMENT PHOTO ─────────────────────────────────── */
bot.on("photo", async (ctx) => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: "pending" }).sort({
    createdAt: -1,
  });
  if (!r)
    return ctx.reply("ምዝገባ አልተገኘም። አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = "reviewing";
  await r.save();
  await ctx.reply("ፎቶ ደርሷል — ክፍያ እየተረጋገጠ ነው...");
  const verdict = await checkPayment(fileId, r);
  r.aiVerdict = verdict;
  const autoOk = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) {
    r.status = "approved";
    r.aiAutoApproved = true;
  }
  await r.save();
  bot.telegram
    .sendMessage(
      ctx.from.id,
      autoOk
        ? `*ክፍያ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`
        : `ፎቶ ደርሷል. ክፍያ እየተፈተሸ ነው — ትንሽ ይጠብቁ.\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    )
    .catch(() => {});
  ctx.session = { step: "LOC", locRegId: String(r._id), locTries: 0 };
  await ctx.reply("አድራሻዎን ያጋሩ — ቤትዎ ይሰበሰብለዎታል:", locKb());
  const caption =
    aiSummary(verdict) +
    "\n\n" +
    (autoOk ? "AI ያረጋገጠ\n\n" : "") +
    card(r.toObject(), true);
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        autoOk ? "ሰርዝ" : "ፈቀድ",
        autoOk ? `no_${r._id}` : `ok_${r._id}`,
      ),
      Markup.button.callback("ከልክል", `no_${r._id}`),
    ],
  ]);
  for (const aid of ADMIN_IDS)
    bot.telegram
      .sendPhoto(aid, fileId, { caption, parse_mode: "Markdown", ...kb })
      .catch(() => {});
});

/* ─── 22. ADMIN PANEL ───────────────────────────────────── */
bot.hears("🔧 Admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  ctx.session = {};

  await ctx.reply("*የአስተዳዳሪ ፓነል*", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("አዲስ አበባ → አማራ ክልል ምዝገቦች", "lst_dir_toamhara")],
      [Markup.button.callback("አማራ ክልል → አዲስ አበባ ምዝገቦች", "lst_dir_toaa")],
      [Markup.button.callback("ያልተፈቀዱ ክፍያዎች", "lst_pay")],
      [Markup.button.callback("ጭነት ሰብሳቢ (አቅራቢያ ዝርዝር)", "col_pick")],
      [Markup.button.callback("ጭነት ላክ (ለደንበኞች ማሳወቂያ)", "snd_pick")],
      [Markup.button.callback("የጭነት ሪፖርት", "admin_report")],
      [Markup.button.callback("ቻናል ማስታወቂያ", "channel_panel")],
      [Markup.button.callback("ዝርዝር አትም (Print Manifest)", "print_pick")],
      [Markup.button.callback("📦 የቡድን ግዥ ሁኔታ", "gb_status")],
      [Markup.button.callback("📣 ቀሪ ኪሎ ለተጠቃሚዎች ላክ", "gb_broadcast_remain")],
      [Markup.button.callback("📋 ምናሌ አስተዳዳሪ (Menu Manager)", "menu_manager")],
    ]),
  });
});

/* ── ምናሌ አስተዳዳሪ — ሁሉንም ቁልፎች ያሳያል ──────────────────────── */
bot.action("menu_manager", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await sendMenuManagerPanel(ctx);
});

async function sendMenuManagerPanel(ctx) {
  // ሁሉንም ቁልፎች ያለ ሁኔታ ያግኛሉ
  const states = await Promise.all(
    MENU_SETTINGS.map((m) => getSetting(m.key, true)),
  );

  const buttons = MENU_SETTINGS.map((m, i) => {
    const on = states[i];
    const icon = on ? "🟢" : "🔴";
    const action = on ? "OFF" : "ON";
    return [
      Markup.button.callback(
        `${icon} ${m.emoji} ${m.label}`,
        `tmitem_${m.key}`,
      ),
    ];
  });

  buttons.push([
    Markup.button.callback("🔴 ሁሉንም ጥፋ", "tmall_off"),
    Markup.button.callback("🟢 ሁሉንም ብራ", "tmall_on"),
  ]);

  const lines = MENU_SETTINGS.map(
    (m, i) => `${states[i] ? "🟢" : "🔴"} ${m.emoji} ${m.label}`,
  ).join("\n");

  await ctx.reply(
    `*📋 ምናሌ አስተዳዳሪ*\n━━━━━━━━━━━━━━━━\n\n${lines}\n\n_ቁልፍ ይጫኑ ለመቀያየር:_`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
}

/* ── ለያንዳንዱ ምናሌ ቁልፍ toggle ── */
bot.action(/^tmitem_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});

  const key = ctx.match[1];
  const item = MENU_SETTINGS.find((m) => m.key === key);
  if (!item) return;

  const current = await getSetting(key, true);
  const next = !current;
  await setSetting(key, next);

  const statusWord = next ? "🟢 ተከፈተ (ON)" : "🔴 ተዘጋ (OFF)";
  await ctx.reply(`${item.emoji} *${item.label}*\n${statusWord}`, {
    parse_mode: "Markdown",
  });

  // ፓነሉን ያዘምናል
  await sendMenuManagerPanel(ctx);
});

/* ── ሁሉንም አብራ / ጥፋ ── */
bot.action("tmall_on", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, true)));
  await ctx.reply("🟢 *ሁሉም ምናሌ ቁልፎች ተከፈቱ*", { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

bot.action("tmall_off", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, false)));
  await ctx.reply("🔴 *ሁሉም ምናሌ ቁልፎች ተዘጉ*", { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

/* ── GB status per product ── */
bot.action("gb_status", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});

  let txt = "*📦 የቡድን ግዥ ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n";
  for (const prod of GB_PRODUCTS) {
    const ul = unitLabel(prod);
    const res = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      {
        $group: {
          _id: null,
          kg: { $sum: "$weightKg" },
          count: { $sum: 1 },
          revenue: { $sum: "$totalCost" },
        },
      },
    ]);
    const regKg = res[0]?.kg || 0,
      regCount = res[0]?.count || 0,
      revenue = res[0]?.revenue || 0;
    txt +=
      `${prod.emoji} *${prod.label}* — ${prod.pricePerKg} ብር/${ul}\n` +
      `${capLine(regKg, prod.targetKg)}\n` +
      `ተሳታፊ ሰዎች: ${regCount} | ጠቅላላ ዋጋ: ${revenue.toLocaleString()} ብር\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* ── Broadcast remaining kg to all users ── */
bot.action("gb_broadcast_remain", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});

  let summary = "*🛒 የቡድን ግዥ — ቀሪ ሁኔታ*\n━━━━━━━━━━━━━━━━\n\n";
  for (const prod of GB_PRODUCTS) {
    const ul = unitLabel(prod);
    const res = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = res[0]?.kg || 0,
      regCount = res[0]?.count || 0;
    summary +=
      `${prod.emoji} *${prod.label}* — *${prod.pricePerKg} ብር/${ul}*\n` +
      `${capLine(regKg, prod.targetKg)}\nተሳታፊ ሰዎች: ${regCount}\n\n`;
  }
  summary +=
    `ቀጥታ ከ *ገበሬዎች* እና *ፋብሪካዎች*!\n` +
    `አነስተኛ የአገልግሎት ክፍያ ብቻ — *ፍቱን መድሃኒት!*\n\n` +
    `ለምዝገባ ቦቱን ይጠቀሙ | ${SUPPORT_PHONE}`;

  const gbUsers = await GBReg.distinct("userId");
  const cargoUsers = await Reg.distinct("userId", {
    status: { $nin: ["rejected"] },
  });
  const allUsers = [...new Set([...gbUsers, ...cargoUsers])];

  let sent = 0;
  for (const uid of allUsers) {
    try {
      await bot.telegram.sendMessage(uid, summary, { parse_mode: "Markdown" });
      sent++;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`✅ ቀሪ ሁኔታ ለ ${sent} ሰው ተልኳል`);
});

/* ── Route lists ── */
bot.action("lst_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አዲስ አበባ → አማራ ክልል — መስመር ምረጥ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AMHARA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`),
      ]),
    ),
  );
});
bot.action("lst_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አማራ ክልል → አዲስ አበባ — መስመር ምረጥ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`),
      ]),
    ),
  );
});

bot.action("lst_pay", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  const list = await Reg.find({ status: "reviewing" })
    .sort({ createdAt: 1 })
    .lean();
  if (!list.length) return ctx.reply("ያልተፈቀደ ክፍያ የለም");
  for (const r of list) {
    const txt = aiSummary(r.aiVerdict) + "\n\n" + card(r, true);
    if (r.paymentFileId)
      await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, {
        caption: txt,
        parse_mode: "Markdown",
        ...approveKb(r._id),
      });
    else await ctx.reply(txt, { parse_mode: "Markdown", ...approveKb(r._id) });
  }
});

bot.action(/^lst_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const list = await Reg.find({ routeId: ro.id })
    .sort({ createdAt: -1 })
    .lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} — ምዝገባ የለም`);
  const cnt = {};
  list.forEach((r) => {
    cnt[r.status] = (cnt[r.status] || 0) + 1;
  });
  const total = await routeWeight(ro.id);
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n${list.length} ሰው | ፈቃድ: ${cnt.approved || 0} | ፍተሻ: ${cnt.reviewing || 0} | ያልከፈለ: ${cnt.pending || 0} | ተልኳል: ${cnt.sent || 0}\n${capLine(total, ro.targetKg)}`,
    { parse_mode: "Markdown" },
  );
  for (const r of list) {
    const kb =
      r.status === "reviewing"
        ? approveKb(r._id)
        : r.status === "approved"
          ? Markup.inlineKeyboard([
              [Markup.button.callback("ሰርዝ", `no_${r._id}`)],
            ])
          : {};
    await ctx.reply(card(r, true), { parse_mode: "Markdown", ...kb });
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(
    id,
    { status: newStatus },
    { new: true },
  );
  if (!r) return;
  const fn = ctx.editMessageCaption ? "editMessageCaption" : "editMessageText";
  await ctx[fn](card(r.toObject(), true), { parse_mode: "Markdown" }).catch(
    () => {},
  );
  if (notifyFn)
    bot.telegram
      .sendMessage(r.userId, notifyFn(r), { parse_mode: "Markdown" })
      .catch(() => {});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery("ተፈቅዷል").catch(() => {});
  await setStatus(
    ctx,
    ctx.match[1],
    "approved",
    (r) =>
      `*ክፍያ ተፈቅዷል!*\n\n${card(r.toObject())}\n\nጭነትዎ ሲላክ ይነገርዎታል.\n${SUPPORT_PHONE}`,
  );
});
bot.action(/^no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery("አልተቀበለም").catch(() => {});
  await setStatus(
    ctx,
    ctx.match[1],
    "rejected",
    () => `ክፍያ አልተቀበለም.\n${SUPPORT_PHONE}`,
  );
});

bot.action(/^del_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === "sent") return ctx.reply("ጭነቱ ተልኳል — መሰረዝ አይቻልም");
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply("ምዝገባ ተሰርዟል. ለመመዝገብ አቅጣጫ ይምረጡ", await mainKb(ctx.from?.id));
});

/* ── Send shipment ── */
bot.action("snd_pick", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "ምን አቅጣጫ?",
    Markup.inlineKeyboard([
      [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "snd_dir_toamhara")],
      [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "snd_dir_toaa")],
    ]),
  );
});
bot.action("snd_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አዲስ አበባ → አማራ ክልል:",
    Markup.inlineKeyboard(
      ROUTES_TO_AMHARA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`),
      ]),
    ),
  );
});
bot.action("snd_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አማራ ክልል → አዲስ አበባ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`),
      ]),
    ),
  );
});

bot.action(/^snd_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const ready = await Reg.find({ routeId: ro.id, status: "approved" }).lean();
  if (!ready.length) return ctx.reply("ፈቃድ ያለው ምዝገባ የለም");
  const total = ready.reduce((s, r) => s + (r.weightKg || 0), 0);
  ctx.session = { step: "SEND_NOTE", sendRoute: ro.id };
  await ctx.reply(
    `${ro.label} | ${ready.length} ሰው | ${total} ኪሎ\n\nለደንበኞች ማስታወሻ ያስገቡ:`,
  );
});

/* ── Report ── */
bot.action("admin_report", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  let txt = "*የጭነት ሪፖርት*\n━━━━━━━━━━━━━━━━\n\n*አዲስ አበባ → አማራ ክልል*\n";
  for (const ro of ROUTES_TO_AMHARA) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const m = {};
    counts.forEach((c) => {
      m[c._id] = c.n;
    });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\nፈቃድ: ${m.approved || 0} | ፍተሻ: ${m.reviewing || 0} | ያልከፈለ: ${m.pending || 0} | ተልኳል: ${m.sent || 0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  txt += "*አማራ ክልል → አዲስ አበባ*\n";
  for (const ro of ROUTES_TO_AA) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const m = {};
    counts.forEach((c) => {
      m[c._id] = c.n;
    });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\nፈቃድ: ${m.approved || 0} | ፍተሻ: ${m.reviewing || 0} | ያልከፈለ: ${m.pending || 0} | ተልኳል: ${m.sent || 0} | ${total}/${ro.targetKg} ኪሎ\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* ── Collector ── */
bot.action("col_pick", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አቅጣጫ ምረጥ:",
    Markup.inlineKeyboard([
      [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "col_dir_toamhara")],
      [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "col_dir_toaa")],
    ]),
  );
});
bot.action("col_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አዲስ አበባ → አማራ ክልል:",
    Markup.inlineKeyboard(
      ROUTES_TO_AMHARA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`),
      ]),
    ),
  );
});
bot.action("col_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አማራ ክልል → አዲስ አበባ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`),
      ]),
    ),
  );
});
bot.action(/^col_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "COL_LOC", colRoute: ctx.match[1] };
  await ctx.reply("ያሉበትን ቦታ ያጋሩ:", locKb());
});

/* ── Print ── */
bot.action("print_pick", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አቅጣጫ ምረጥ:",
    Markup.inlineKeyboard([
      [Markup.button.callback("አዲስ አበባ → አማራ ክልል", "prnt_dir_toamhara")],
      [Markup.button.callback("አማራ ክልል → አዲስ አበባ", "prnt_dir_toaa")],
    ]),
  );
});
bot.action("prnt_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አዲስ አበባ → አማራ ክልል — መስመር ምረጥ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AMHARA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`),
      ]),
    ),
  );
});
bot.action("prnt_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አማራ ክልል → አዲስ አበባ — መስመር ምረጥ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`),
      ]),
    ),
  );
});
bot.action(/^prnt_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await handlePrint(ctx, ctx.match[1]);
});

/* ── Channel ── */
bot.action("channel_panel", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    `ቻናል: ${CHANNEL_ID || "አልተቀመጠም"}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("ፍተሻ ላክ", "ch_test")],
      [Markup.button.callback("አዲስ አበባ → አማራ ክልል ማስታወቂያ", "ch_dir_toamhara")],
      [Markup.button.callback("አማራ ክልል → አዲስ አበባ ማስታወቂያ", "ch_dir_toaa")],
    ]),
  );
});
bot.action("ch_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አዲስ አበባ → አማራ ክልል:",
    Markup.inlineKeyboard(
      ROUTES_TO_AMHARA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`),
      ]),
    ),
  );
});
bot.action("ch_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "አማራ ክልል → አዲስ አበባ:",
    Markup.inlineKeyboard(
      ROUTES_TO_AA.map((r) => [
        Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`),
      ]),
    ),
  );
});
bot.action("ch_test", async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, "ፍተሻ ተሳክቷል");
    await ctx.reply("ተሳክቷል");
  } catch (e) {
    await ctx.reply(`አልተሳካም: ${e.message}`);
  }
});
bot.action(/^ch_ann_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {});
    return;
  }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID አልተቀመጠም");
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);
  try {
    await bot.telegram.sendMessage(
      CHANNEL_ID,
      `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\nቀጥታ ከ ገበሬዎች — ርካሽ እና ፈጣን!\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    );
    await ctx.reply(`ተልኳል — ${ro.label}`);
  } catch (e) {
    await ctx.reply(`አልተሳካም: ${e.message}`);
  }
});

/* ── Admin commands ── */
bot.command("report_now", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  await sendDailyReport();
  await ctx.reply("ሪፖርት ተልኳል");
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const now = new Date(),
    date =
      now.toLocaleDateString("en-GB") +
      " " +
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  let toAmharaKg = 0,
    toAmharaPeople = 0,
    toAmharaRev = 0,
    toAAKg = 0,
    toAAPeople = 0,
    toAArev = 0;
  let txt = `*Quick Stats* — ${date}\n━━━━━━━━━━━━━━━━━━━━\n\n*አዲስ አበባ → አማራ ክልል*\n`;
  for (const ro of ROUTES_TO_AMHARA) {
    const agg = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } },
    ]);
    const m = {};
    agg.forEach((c) => {
      m[c._id] = { n: c.n, kg: c.kg };
    });
    const people = agg.reduce((s, c) => s + c.n, 0),
      kg = ["pending", "reviewing", "approved", "sent"].reduce(
        (s, st) => s + (m[st]?.kg || 0),
        0,
      ),
      rev = kg * SHIP_PER_KG;
    toAmharaKg += kg;
    toAmharaPeople += people;
    toAmharaRev += rev;
    if (!people) {
      txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`;
      continue;
    }
    txt += `${ro.emoji} ${ro.label}\n   ${people} ሰው | ${kg}ኪ | ፈቃድ: ${m.approved?.n || 0} | ፍተሻ: ${m.reviewing?.n || 0} | ያልከፈለ: ${m.pending?.n || 0} | ተልኳል: ${m.sent?.n || 0}\n   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }
  txt += `\n*አማራ ክልል → አዲስ አበባ*\n`;
  for (const ro of ROUTES_TO_AA) {
    const agg = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } },
    ]);
    const m = {};
    agg.forEach((c) => {
      m[c._id] = { n: c.n, kg: c.kg };
    });
    const people = agg.reduce((s, c) => s + c.n, 0),
      kg = ["pending", "reviewing", "approved", "sent"].reduce(
        (s, st) => s + (m[st]?.kg || 0),
        0,
      ),
      rev = kg * SHIP_PER_KG;
    toAAKg += kg;
    toAAPeople += people;
    toAArev += rev;
    if (!people) {
      txt += `${ro.emoji} ${ro.label}: _ምዝገባ የለም_\n`;
      continue;
    }
    txt += `${ro.emoji} ${ro.label}\n   ${people} ሰው | ${kg}ኪ | ፈቃድ: ${m.approved?.n || 0} | ፍተሻ: ${m.reviewing?.n || 0} | ያልከፈለ: ${m.pending?.n || 0} | ተልኳል: ${m.sent?.n || 0}\n   ጭ. ክፍያ: ${rev.toLocaleString()} ብር\n`;
  }
  const gP = toAmharaPeople + toAAPeople,
    gK = toAmharaKg + toAAKg,
    gR = toAmharaRev + toAArev,
    gReg = gK * REG_PER_KG;
  txt += `\n━━━━━━━━━━━━━━━━━━━━\n*ጠቅላላ ድምር*\n${gP} ሰው | ${gK} ኪሎ\nምዝ: ${gReg.toLocaleString()} ብ | ጭ: ${gR.toLocaleString()} ብ | ድምር: ${(gReg + gR).toLocaleString()} ብ`;
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!text) return ctx.reply("አጠቃቀም: /broadcast መልዕክት");
  const users = await Reg.distinct("userId", {
    status: { $nin: ["rejected"] },
  });
  let sent = 0,
    failed = 0;
  for (const uid of users) {
    try {
      await bot.telegram.sendMessage(uid, `${text}\n\n${SUPPORT_PHONE}`, {
        parse_mode: "Markdown",
      });
      sent++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`ተልኳል: ${sent} | አልደረሳቸውም: ${failed}`);
});

/* ── /prices — አሁናዊ ዋጋዎች ── */
bot.command("prices", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const lines = GB_PRODUCTS.map((p) => {
    const ul = p.unit === "liter" ? "ሊትር" : "ኪሎ";
    return `${p.emoji} *${p.label}* (${p.id}) — ${p.pricePerKg} ብር/${ul}`;
  }).join("\n");
  await ctx.reply(
    `*አሁናዊ ዋጋዎች*\n━━━━━━━━━━━━━━━━\n\n${lines}\n\n` +
      `ዋጋ ለመቀየር:\n\`/setprice <id> <ዋጋ>\`\n\nምሳሌ: \`/setprice teff 80\``,
    { parse_mode: "Markdown" },
  );
});

/* ── /setprice <id> <ዋጋ> — ዋጋ ቀይር ── */
bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("ፈቃድ የለዎትም");
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `*አጠቃቀም:* \`/setprice <id> <ዋጋ>\`\n\n` +
        `*ምሳሌ:*\n` +
        GB_PRODUCTS.map((p) => `\`/setprice ${p.id} ${p.pricePerKg}\``).join(
          "\n",
        ),
      { parse_mode: "Markdown" },
    );
  }
  const id = parts[1].toLowerCase();
  const price = parseFloat(parts[2]);
  const prod = byProduct(id);

  if (!prod)
    return ctx.reply(
      `❌ ምርት አልተገኘም: *${id}*\n\nትክክለኛ IDs: ${GB_PRODUCTS.map((p) => `\`${p.id}\``).join(", ")}`,
      { parse_mode: "Markdown" },
    );
  if (!price || price <= 0 || price > 100000)
    return ctx.reply("❌ ትክክለኛ ዋጋ ያስገቡ (ለምሳሌ: 80)");

  const oldPrice = prod.pricePerKg;
  prod.pricePerKg = price;
  await setSetting(`price_${id}`, price);

  const ul = prod.unit === "liter" ? "ሊትር" : "ኪሎ";
  await ctx.reply(
    `✅ *ዋጋ ተቀይሯል!*\n\n` +
      `${prod.emoji} *${prod.label}*\n` +
      `ቀድሞ: ${oldPrice} ብር/${ul}\n` +
      `አሁን: *${price} ብር/${ul}*`,
    { parse_mode: "Markdown" },
  );
  // admins ሁሉ ያሳወቃቸዋል
  for (const aid of ADMIN_IDS) {
    if (aid === ctx.from.id) continue;
    bot.telegram
      .sendMessage(
        aid,
        `${prod.emoji} *${prod.label}* ዋጋ ተቀይሯል\n${oldPrice} → *${price}* ብር/${ul}\nበ @${ctx.from.username || ctx.from.first_name}`,
        { parse_mode: "Markdown" },
      )
      .catch(() => {});
  }
});

/* ─── 23. LAUNCH ────────────────────────────────────────── */
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await mongoose.connect(MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");
  await loadPricesFromDB();
  console.log("Prices loaded from DB");
  await new Promise((resolve) => {
    http
      .createServer((_, res) => {
        res.writeHead(200);
        res.end("OK");
      })
      .listen(PORT, () => {
        console.log("Port", PORT);
        resolve();
      });
  });
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("Webhook deleted");
  } catch (e) {
    console.warn("deleteWebhook:", e.message);
  }
  const RURL = (process.env.RENDER_EXTERNAL_URL || "").trim();
  if (RURL) {
    const https = require("https");
    setInterval(
      () => https.get(`${RURL}/`).on("error", () => {}),
      14 * 60 * 1000,
    );
  }
  startDailyReportScheduler();
  await bot.launch();
  console.log("Bot started");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
