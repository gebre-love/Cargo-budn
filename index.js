"use strict";

const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const Anthropic = require("@anthropic-ai/sdk");
const http = require("http");

/* â”€â”€â”€ 1. CONFIG â”€â
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

let REG_PER_KG = 5;
let SHIP_PER_KG = 25;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error("BOT_TOKEN áŠ¥áŠ“ MONGO_URI á‹«áˆµá ˆáˆ áŒ‹áˆ‰");
  process.exit(1);
}

const anthropic = ANTHROPIC_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_KEY })
  : null;

/* â”€â”€â”€ 2. á‹¨á‰¡á‹µáŠ• áŒ á‹¥ áˆ áˆá‰¶á‰½ â”€â
const GB_PRODUCTS = [
  {
    id: "teff",
    emoji: "ðŸŒ¾",
    label: "áŒ¤á",
    unit: "kg",
    targetKg: Number(process.env.GB_TEFF_KG) || 5000,
    pricePerKg: Number(process.env.GB_TEFF_PRICE) || 75,
  },
  {
    id: "oil",
    emoji: "ðŸ›¢",
    label: "á‹˜á‹á‰µ",
    unit: "liter",
    targetKg: Number(process.env.GB_OIL_KG) || 3000,
    pricePerKg: Number(process.env.GB_OIL_PRICE) || 120,
  },
  {
    id: "sugar",
    emoji: "ðŸš",
    label: "áˆµáŠ³áˆ",
    unit: "kg",
    targetKg: Number(process.env.GB_SUGAR_KG) || 3000,
    pricePerKg: Number(process.env.GB_SUGAR_PRICE) || 55,
  },
  {
    id: "flour",
    emoji: "ðŸŒ½",
    label: "á‹±á‰„á‰µ",
    unit: "kg",
    targetKg: Number(process.env.GB_FLOUR_KG) || 3000,
    pricePerKg: Number(process.env.GB_FLOUR_PRICE) || 60,
  },
  {
    id: "onion",
    emoji: "ðŸ§…",
    label: "áˆ½áŠ•áŠ©áˆá‰µ",
    unit: "kg",
    targetKg: Number(process.env.GB_ONION_KG) || 2000,
    pricePerKg: Number(process.env.GB_ONION_PRICE) || 30,
  },
];
const byProduct = (id) => GB_PRODUCTS.find((p) => p.id === id);
const unitLabel = (p) => (p.unit === "liter" ? "áˆŠá‰µáˆ" : "áŠªáˆŽ");

/* â”€â”€â”€ áˆ áŠ“áˆŒ á‰ áˆ á Á‰½ €â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ €â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const MENU_SETTINGS = [
  { key: "menu_cargo_toamhara", emoji: "ðŸ”¼", label: "áŠ á‹2áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ (áŒáŠ á‰µ)"
  { key: "menu_cargo_toaa", emoji: "ðŸ”1⁄2", label: "áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ (áŒáŠ á‰µ)"
  { key: "menu_my_regs", emoji: "ðŸ“‹", label: "á‹¨áˆ á‹ áŒˆá‰£ á‹ áˆá‹ áˆ¬" },
  { key: "menu_counter", emoji: "ðŸ“Š", label: "á‹¨áŒáŠ á‰µ á‰†áŒ£áˆa" },
  ...GB_PRODUCTS.map((p) => ({
    key: `menu_product_${p.id}`,
    emoji: p.emoji,
    label: p.label,
  })),
];

/* â”€â”€â”€ 3. ROUTES / METHODS â”€â
const ROUTES_TO_AMHARA = [
  { id: "aa_finotselam", emoji: "ðŸŸ¢", label: "áŠ á‹2áˆµ áŠ á‰ á‰£ â†' á áŠ–á‰°áˆ°áˆ‹áˆ ", targetKg: TARGET_KG_DEFAULT},
  { id: "aa_debre_markos", emoji: "ðŸ”µ", label: "áŠ á‹2áˆµ áŠ á‰ á‰£ â†' á‹°á‰¥áˆ ̈ áˆ›áˆá‰†áˆµg: T_GKUG_KAR}, target},
  { id: "aa_mota", emoji: "ðŸŸ¤", label: "áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áˆžáŒ£", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_bahirdar", emoji: "ðŸ”µ", label: "áŠ á‹2áˆµ áŠ á‰ á‰£ â†' á‰£áˆ...áˆ á‹³áˆ", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_gondar", emoji: "ðŸŸ£", label: "áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŒŽáŠ•á‹°áˆ", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_debre_berhan", emoji: "ðŸŸ¡", label: "áŠ á‹²áˆµ áŠ á‰ á‰£ â†' á‹°á‰¥áˆ¨ á‰¥áˆáˆƒáŠ TAR: G_G_G_GETFAU}, target
  { id: "aa_kemissie", emoji: "ðŸŸ ", label: "áŠ á‹2áˆµ áŠ á‰ á‰£ â†' áŠ¨áˆšáˆ´", targetKg: TARGET_KG_DEFAULT },
  { id: "aa_dessie", emoji: "ðŸ”´", label: "áŠ á‹²áˆµ áŠ á‰ á‰£ â†' á‹°áˆ´", targetKg: TARGET_KG_DEFAULT },
];
const ROUTES_TO_AA = [
  { id: "finotselam_aa", emoji: "ðŸŸ¢", label: "á áŠ–á‰°áˆ°áˆ‹áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
  { id: "debre_markos_aa", emoji: "ðŸ”µ", label: "á‹°á‰¥áˆ¨ áˆ›áˆá‰†áˆµ â†' áŠ á‹²áˆµ áŠ á‰ á‰ á‰K£_GGUG_GAR_DE,
  { id: "mota_aa", emoji: "ðŸŸ¤", label: "áˆžáŒ£ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
  { id: "bahirdar_aa", emoji: "ðŸ”µ", label: "á‰£áˆ...áˆ á‹3áˆ â†' áŠ á‹2áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
  { id: "gondar_aa", emoji: "ðŸŸ£", label: "áŒŽáŠ•á‹°áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
  { id: "debre_berhan_aa", emoji: "ðŸŸ¡", label: "á‹°á‰¥áˆ¨ á‰¥áˆáˆƒáŠ• â†' áŠ á‹²áˆµ áŠ á‰ á‰£, target_GET_GET_GET_GET},
  { id: "kemissie_aa", emoji: "ðŸŸ ", label: "áŠ¨áˆšáˆ´ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
  { id: "dessie_aa", emoji: "ðŸ”´", label: "á‹°áˆ´ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", targetKg: TARGET_KG_DEFAULT },
];
const ROUTES = [...ROUTES_TO_AMHARA, ...ROUTES_TO_AA];

const METHODS = [
  {
    id: "telebirr",
    emoji: "ðŸ“±",
    label: "á‰´áˆŒá‰¥áˆ",
    info: process.env.TELEBIRR_INFO || "Telebirr: 0960336138",
  },
  {
    id: "cbe",
    emoji: "ðŸ¦",
    label: "CBE á‰£áŠ•áŠ",
    info: process.env.CBE_INFO || "CBE: 1000370308447",
  },
];

const byRoute = (id) => ROUTES.find((r) => r.id === id);
const byMethod = (id) => METHODS.find((m) => m.id === id);
const ACTIVE = ["pending", "reviewing", "approved"];

/* â”€â”€â”€ 4. DB MODELS â”€â
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

/* â”€â”€â”€ á‹‹áŒ‹ áŠ¨ DB á‹áŒ«áŠ“áˆ‰ â”€â
async function loadPricesFromDB() {
  for (const prod of GB_PRODUCTS) {
    const saved = await getSetting(`price_${prod.id}`, null);
    if (saved !== null && saved > 0) prod.pricePerKg = saved;
  }
  const savedReg = await getSetting("fee_reg_per_kg", null);
  if (savedReg !== null && savedReg > 0) REG_PER_KG = savedReg;
  const savedShip = await getSetting("fee_ship_per_kg", null);
  if (savedShip !== null && savedShip > 0) SHIP_PER_KG = savedShip;
}

/* â”€â”€â”€ 5. SESSION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

/* â”€â”€â”€ 6. SECURITY â”€â
function sanitize(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/[`*_[\]()~>#+=|{}.!\\-]/g, (c) => "\\" + c)
    .slice(0, 500);
}

const rateLimitMap = new Map();
const blocklist = new Set();

function isRateLimited(userId, limit = 20) {
  if (blocklist.has(userId)) return true;
  const now = Date.now();
  const e = rateLimitMap.get(userId) || { count: 0, reset: now + 60_000, violations: 0 };
  if (now > e.reset) {
    e.count = 0;
    e.reset = now + 60_000;
  }
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
  const patterns = [
    /\$where/i, /\$ne/i, /\$gt/i, /\$lt/i,
    /<script/i, /javascript:/i,
    /\.\.\//,
  ];
  return patterns.some((p) => p.test(text));
}

/* â”€â”€â”€ 7. HELPERS â”€â
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

const ST = {
  pending: "áŠá á‹« á‹áŒ á‰¥á‰ƒáˆ ",
  reviewing: "áŠ¥á‹¨á‰°á ˆá‰°áˆ¸ áŠ á‹ ",
  approved: "á‰°á ˆá‰…á‹·áˆ ",
  rejected: "áŠ áˆ á‰°á‰€á‰ áˆˆáˆ ",
  sent: "á‰°áˆ áŠ³áˆ ",
};

function card(r, admin = false) {
  const ro = byRoute(r.routeId),
    me = byMethod(r.paymentMethod);
  let t =
    `${for?.emoji} *${for?.label}*\n` +
    `áˆµáˆ: ${r.fullName} | áˆµáˆáŠ­: ${r.phone}\n` +
    `áŒáŠ á‰µ: ${r.cargoDesc} â€” ${r.weightKg} áŠaáˆŽ\n` +
    `áŠá á‹«: ${me?.label || "â€”"} | áŠ á‹µáˆ«áˆ»: ${r.locationLat ? `[áŠ«áˆá‰³](https://maps.google.com/?q=${r.locationLat},${r.locationLng})` : "áŠ áˆ á‰°áˆ‹áŠ¨áˆ "}\n` +
    `áˆ áŠ”á‰³: ${ST[r.status]}`;
  if (r.aiAutoApproved) t += " (AI á‹«áˆ¨áŒ‹áŒˆáŒ )";
  if (admin) t += `\n\`${r.userId}\`${r.username ? " @" + r.username : ""}`;
  return t;
}

function capLine(total, target, unit = "áŠªáˆŽ") {
  const pct = Math.max(0, Math.min(100, Math.round((total / target) * 100)));
  const filled = Math.round(pct / 10),
    remain = Math.max(0, target - total);
  return (
    "â–ˆ".repeat(filled) +
    "â–‘".repeat(10 - filled) +
    " " + pct + "%\n" +
    "á‹¨á‰°áˆ˜á‹˜áŒˆá‰ : " + total + " " + unit +
    " | á‰€áˆa: " + remain + " " + unit +
    " | áŠ¢áˆ‹áˆ›: " + target + " " + unit
  );
}

/* â”€â”€â”€ 8. KEYBOARDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function mainKb(userId) {
  const isAdminUser = ADMIN_IDS.includes(userId);
  const [ loadToAmhara , loadToAA , myRegs , counter , ...productEnabled ] =
    await Promise.all([
      getSetting("menu_cargo_toamhara", true),
      getSetting("menu_cargo_toaa", true),
      getSetting("menu_my_regs", true),
      getSetting("menu_counter", true),
      ...GB_PRODUCTS.map((p) => getSetting(`menu_product_${p.id}`, true)),
    ]);

  const rows = [];
  const row1 = [];
  if (isAdminUser || cargoToAmhara) row1.push("ðŸ”¼ áŠ á‹2áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ");
  if (isAdminUser || cargoToAA) row1.push("ðŸ”½ áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£");
  if (row1.length) rows.push(row1);

  const row2 = [];
  if (isAdminUser || myRegs) row2.push("ðŸ“‹ á‹¨áˆ á‹ áŒˆá‰£ á‹ áˆá‹ áˆ¬");
  if (isAdminUser || counter) row2.push("ðŸ“Š á‹¨áŒáŠ á‰µ á‰†áŒ£áˆa");
  if (row2.length) rows.push(row2);

  const prodRow1 = [], prodRow2 = [];
  GB_PRODUCTS.forEach((p, i) => {
    if (isAdminUser || productEnabled[i]) {
      const btn = `${p.emoji} ${p.label}`;
      if (i < 3) prodRow1.push(btn);
      else prodRow2.push(btn);
    }
  });
  if (prodRow1.length) rows.push(prodRow1);
  if (prodRow2.length) rows.push(prodRow2);

  if (ADMIN_IDS.length) rows.push(["ðŸ”§ Admin"]);

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
    [Markup.button.locationRequest("ðŸ“ áŠ á‹µáˆ«áˆ»á‹¬áŠ• áˆ‹áŠ")],
    ["â ï¸ áˆ³áˆ‹áŒ‹áˆ« áŒ¨áˆáˆµ"],
  ]).resize().oneTime();
const approveKb = (id) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("á ˆá‰€á‹µ", `ok_${id}`),
      Markup.button.callback("áŠ¨áˆáŠ­áˆ", `no_${id}`),
    ],
  ]);

/* â”€â”€â”€ 9. CAPACITY TRACKING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
          `*${ro.label}* â€” áŒáŠ á‰± áˆžáˆ á‰·áˆ !\n\náˆ áˆ«á‰°áŠžá‰»á‰½áŠ• á‰¤á‰µá‹Ž á‹áˆ°á‰ áˆ°á‰¡á‹Žá‰³áˆ â€” á‹ áŒ áŒ á‹áˆ áŠ'.\n${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    for (const aid of ADMIN_IDS)
      bot.telegram
        .sendMessage(aid, `${ro.label} áˆžáˆ á‰·áˆ â€” ${total}/${ro.targetKg}áŠaáˆŽ | ${members.length} áˆ°á‹ `)
        .catch(() => {});
    if (CHANNEL_ID)
      bot.telegram
        .sendMessage(
          CHANNEL_ID,
          `*${ro.label}*\n${capLine(total, ro.targetKg)}\n\ná‹¨áŒ‹áˆ« áŒáŠ á‰µ â€” áˆáŠ«áˆ1⁄2 áŠ¥áŠ“ á ˆáŒ£áŠ|PHOON_SUPPO_{}`
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
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
  const totalKg = agg[0]?.kg || 0;
  const totalCount = agg[0]?.count || 0;
  const ul = unitLabel(prod);
  let cap = await GBProductCap.findOne({ productId });
  if (!cap) cap = await GBProductCap.create({ productId, notified: false });
  if (totalKg >= prod.targetKg && !cap.notified) {
    cap.notified = true;
    await cap.save();
    const members = await GBReg.find({ productId }).lean();
    const uniqueUsers = [...new Map(members.map((m) => [m.userId, m])).values()];
    for (const m of uniqueUsers) {
      bot.telegram
        .sendMessage(
          m.userId,
          `ðŸŽ‰ *${prod.emoji} ${prod.label} â€” áˆ á‹ áŒˆá‰£ áˆžáˆ á‰·áˆ !*\n\n` +
            `áŒ á‰…áˆ‹áˆ‹: *${totalKg} ${ul}* | ${totalCount} áˆ°á‹ \n\n` +
            `âœ… áˆ áˆá‰± áŠ¨áˆ áŠ•áŒ© á‹á‹˜á‹›áˆ â€” áŠ¨áˆ‚á‹°á‰± áˆˆáˆ›á‹ˆá‰… á‹áŒ á‰¥á‰ !\n\n` +
            `á‹‹áŒ‹: *${prod.pricePerKg} á‰¥áˆ/${ul}*\náˆˆáŒ¥á‹«á‰„: ${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
    for (const aid of ADMIN_IDS) {
      bot.telegram
        .sendMessage(
          aid,
          `âœ... *${prod.emoji} ${prod.label}* â€” âˆ a‹ âˆ°á‰£ âˆžáˆ Á‰·áˆ !\n${totalKg}/${prod.targetKg} ${ul} | ${totalCount} `,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
    if (CHANNEL_ID) {
      bot.telegram
        .sendMessage(
          CHANNEL_ID,
          `*${prod.emoji} ${prod.label} â€” áˆá‹áŒˆá‰£ áˆžáˆá‰·áˆ!*\n\n` +
            `${capLine(totalKg, prod.targetKg, ul)}\n` +
            `á‰€áŒ¥á‰³ áŠ¨ áˆ áŠ•áŒ â€” *${prod.pricePerKg} á‰¥áˆ/${ul}*\n${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
  } else if (totalKg < prod.targetKg && cap.notified) {
    cap.notified = false;
    await cap.save();
  }
}

/* â”€â”€â”€ 10. AI PAYMENT CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
            { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
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
  r?.amount_match && r?.account_match && !r?.looks_edited && r?.confidence === "high";
const aiSummary = (r) =>
  !r
    ? "AI áˆ›áˆ¨áŒ‹áŒˆáŒ« áŠ áˆ á‰°áˆ³áŠ«áˆ "
    : `AI: ${aiOk(r) ? "á‰°áˆ¨áŒ‹áŒ áŒ§áˆ " : r?.looks_edited ? "áˆŠáˆµá‰°áŠ«áŠ¨áˆ á‹á‰½áˆ‹áˆ " : "áŠ áˆ á‰°áˆ¨áŒ‹áŒˆáŒ áˆ "} (${r.confidence}) ${r.reason || ""}`;

/* â”€â”€â”€ 11. PRINT MANIFEST â”€â
const PRINT_STATUS = {
  approved: "á ˆá‰ƒá‹µ á‹«áˆˆá‹ ",
  reviewing: "áŠ¥á‹¨á‰°á ˆá‰°áˆ¸",
  pending: "á‹«áˆ áŠ¨á ˆáˆˆ",
  sent: "á‰°áˆ áŠ³áˆ ",
};

function buildManifestHTML(ro, list) {
  const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
  const totalReg = totalKg * REG_PER_KG,
    totalShip = totalKg * SHIP_PER_KG;
  const cnt = { approved: 0, reviewing: 0, pending: 0, sent: 0 };
  list.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
  const now = new Date(),
    dateStr = now.toLocaleDateString("en-GB"),
    timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const ORDER = ["approved", "sent", "reviewing", "pending"];
  const sorted = [...list].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const rows = sorted
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.fullName || "â€”"}</td><td>${r.phone || "â€”"}</td><td>${r.cargoDesc || "â€”"}</td><td class="num">${r.weightKg || 0}</td><td class="status status-${r.status}">${PRINT_STATUS[r.status] || r.status}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><title>${ro.label} â€” á‹¨áŒ­áŠá‰µ á‹áˆ­á‹áˆ­</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:'Noto Sans Ethiopic','Nyala',Arial,sans-serif;color:#1a1a1a;margin:0;padding:18px;font-size:13px}.letterhead{display:flex;justify-content:space-between;border-bottom:3px solid #1a3c6e;padding-bottom:10px;margin-bottom:14px}.letterhead h1{font-size:18px;margin:0 0 4px;color:#1a3c6e}.letterhead .meta{text-align:right;font-size:12px}.route-banner{background:#1a3c6e;color:#fff;padding:8px 14px;border-radius:4px;font-size:15px;font-weight:bold;margin-bottom:14px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.box{border:1px solid #ccc;border-radius:5px;padding:7px 13px;text-align:center;background:#f7f8fa;min-width:95px}.box .v{font-size:18px;font-weight:bold;color:#1a3c6e}.box .l{font-size:10px;color:#666;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:18px}th{background:#1a3c6e;color:#fff;padding:7px 6px;text-align:left}td{padding:6px;border-bottom:1px solid #ddd}tr:nth-child(even){background:#f5f6f8}.num{text-align:center}.status{text-align:center;font-weight:bold;font-size:11px}.status-approved{color:#1a7d3b}.status-sent{color:#1565c0}.status-reviewing{color:#b8860b}.status-pending{color:#888}.footer{margin-top:30px;display:flex;justify-content:space-between;font-size:12px}.sign-box{width:45%}.sign-line{border-top:1px solid #333;margin-top:36px;padding-top:4px;text-align:center}.stamp-note{margin-top:26px;font-size:11px;color:#777;text-align:center}#printBtn{margin:16px 0;padding:10px 28px;font-size:14px;background:#1a3c6e;color:#fff;border:none;border-radius:6px;cursor:pointer}@media print{#printBtn{display:none}body{padding:0}}</style></head><body>
<button id="printBtn" onclick="window.print()">á‹áˆ…áŠ• á •áˆªáŠ•á‰µ á‹«á‹µáˆáŒ‰</button>
<div class="letterhead"><div><h1>á‹¨áŒ‹áˆ« áŒ­áŠá‰µ áŠ áŒˆáˆáŒáˆŽá‰µ</h1><div style="font-size:12px;color:#555">Cargo Group-Booking Manifest</div></div><div class="meta">${dateStr} &nbsp; ${timeStr}<br>${SUPPORT_PHONE}</div></div>
<div class="route-banner">${ro.emoji} ${ro.label}</div>
<div class="summary"><div class="box"><div class="v">${list.length}</div><div class="l">áŒ á‰...áˆ‹áˆ‹ á‰°áˆ3á ‹áˆa</div></div></div_div_div><div><div class="v">${totalKg}</div><div class="l">áŒ á‰...áˆ‹áˆ‹ áŠaáˆŽ</div></div><div class="box"><div class="v">${cnt.approved + cnt.sent}</div. ˆá‰ƒá‹µ á‹«áˆ‹á‰¸á‹ </div></div><div class="box"><div class="v">${cnt.pending + cnt.reviewing}</div><div class="l">á‰ áˆ‚္°‰° áˆ‹á‹</div></div><div class="box"><div class="v">${totalReg.toLocaleString("en")}</div><div class="l">á‹¨áˆ á‹ áŒˆá‰£ áŠá á‹« (á‰¥áˆ)</div></div><div class="box"><div class="v">${totalShip.toLocaleString("en")}</div><div class="l">á‹¨áŒáŠ á‰µ áŠá á‹« (á↥/div)</div></></><>
<table><thead><tr><th>#</th><th>áˆ™áˆ‰ áˆµáˆ</th><th>áˆµáˆáŠ­ á‰áŒ¥áˆ­</th><th>á‹¨áŒ­áŠá‰µ á‹“á‹­áŠá‰µ</th><th class="num">áŠªáˆŽ</th><th class="status">áˆáŠ”á‰³</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer"><div class="sign-box"><div class="sign-line">á‹¨áˆ¹á áˆ áˆµáˆ áŠ¥áŠ“ á Šáˆáˆ› â€” Driver Name & Signature</div></div><div class="sign-box"><div class="sign-line">á‹¨á‰°áˆ¨áŠ¨á‰ á‰£áˆˆáˆ¥áˆ áŒ£áŠ• á Šáˆáˆ› â€” Receiving Officer Signature</div></div></div>
<div class="stamp-note">á‹áˆ… áˆ°áŠ á‹µ á‰ ${ro.label} á‹¨áŒáŠ á‰µ áŒ‰á‹ž áˆ‹á‹ áˆˆá –áˆŠáˆµ/áŠ¬áˆ‹ áˆ›áˆ³á‹« áˆ°áŠ á‹µ áŠ á‹ á ¢</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script></body></html>`;
}

async function sendDocumentWithRetry(chatId, doc, extra, retries = 4) {
  Lasterr’s letter;
  for (let i = 0; i < retries; i++) {
    try {
      return await bot.telegram.sendDocument(chatId, doc, extra);
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function handlePrint(ctx, routeId) {
  const ro = byRoute(routeId);
  if (!ro) { await ctx.reply("áˆ˜áˆµáˆ˜áˆ­ áŠ áˆá‰°áŒˆáŠ˜áˆ"); return; }
  let waitMsg;
  try {
    waitMsg = await ctx.reply("Please send me the message...");
    const list = await Reg.find({ routeId, status: { $ne: "rejected" } })
      .sort({ createdAt: 1 }).lean();
    if (!list.length) { await ctx.reply(`${ro.emoji} ${ro.label} â€” áˆá‹áŒˆá‰£ á‹¨áˆˆáˆ`); return; }
    const totalKg = list.reduce((s, r) => s + (r.weightKg || 0), 0);
    const html = buildManifestHTML(ro, list),
      buf = Buffer.from(html, "utf-8");
    const fname = `${ro.id}_${new Date().toISOString().slice(0, 10)}.html`;
    await sendDocumentWithRetry(
      ctx.chat.id,
      { source: buf, filename: fname },
      {
        caption: `*${ro.label}* â€” á •áˆaáŠ•á‰µ á‹ áŒ áŒ áˆ°áŠ á‹µ\n${list.length} áˆ°á‹ | ${totalKg} áŠaáˆŽ\n\ná   ‹†á•á á‹áŠá ˆá‰± â€” á •áˆaáŠ•á‰μ á‹áŠ ̈á ˆá‰3áˆ `,
        parse_mode: "Markdown",
      },
    );
    if (waitMsg) bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
  } catch (e) {
    console.error("handlePrint:", e.message);
    await ctx.reply("á ‹á‹áˆ‰áŠ• áˆ˜áˆ‹áŠ áŠ áˆ á‰°áˆ³áŠ«áˆ \n\ná‰µáŠ•áˆ½ á‰†á‹á‰°á‹ áŠ¥áŠ•á‹°áŒˆáŠ" á‹áˆžáŠáˆ©á ¢").catch(() => {});
  }
}

/* â”€â”€â”€ 12. DAILY REPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function sendDailyReport() {
  if (!ADMIN_IDS.length) return;
  let txt = `á‹•áˆˆá‰³á‹Š áˆªá –áˆá‰µ â€” ${new Date().toLocaleDateString("am-ET")}\n\n`;
  let gKg = 0, gPeople = 0, gPending = 0;
  for (const ro of ROUTES) {
    const counts = await Reg.aggregate([
      { $match: { routeId: ro.id } },
      { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } },
    ]);
    const m = {};
    counts.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = counts.reduce((s, c) => s + c.n, 0);
    const kg =
      (m.pending?.kg || 0) + (m.reviewing?.kg || 0) +
      (m.approved?.kg || 0) + (m.sent?.kg || 0);
    gKg += kg;
    gPeople += people;
    gPending += (m.pending?.n || 0) + (m.reviewing?.n || 0);
    if (!people) continue;
    txt += `${ro.emoji} ${ro.label}\n${people} áˆ°á‹ | ${kg} áŠaáˆŽ | á ˆá‰ƒá‹μ: ${m.approved?.n || 0} | á á‰°áˆ»: ${m.reviewing?.n || 0} | á‹«áˆ áŠ ̈á ˆáˆˆ: ${m.pending?.n || 0} | á‰°áˆ áŠ3áˆ : ${m.sent?.n || 0}\n\n`;
  }
  txt += `áŒ á‰…áˆ‹áˆ‹: ${gPeople} áˆ°á‹ | ${gKg} áŠªáˆŽ | á‹«áˆ á‰°á ˆá‰€á‹±: ${gPending}\náˆ á‹ : ${(gKg * REG_PER_KG).toLocaleString()} á‰¥ | áŒ: ${(gKg * SHIP_PER_KG).toLocaleString()} á‰¥`;
  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, txt).catch(() => {});
}

function startDailyReportScheduler() {
  let last = "";
  setInterval(async () => {
    const eat = new Date(Date.now() + 3 * 60 * 60 * 1000),
      date = eat.toISOString().slice(0, 10);
    if (eat.getUTCHours() === 7 && eat.getUTCMinutes() === 0 && last !== date) {
      last = date;
      await sendDailyReport().catch((e) => console.error("Daily report:", e.message));
    }
  }, 60_000);
}

/* â”€â”€â”€ 13. BOT + MIDDLEWARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const bot = new Telegraph(BOT_TOKEN, {
  handlerTimeout: 120_000,
  telegram: { timeout: 120 },
});
bot.use(sessionMW);

bot.use(async (ctx, next) => {
  if (ctx.from?.is_bot) return;
  const uid = ctx.from?.id;
  if (!uid) return next();
  if (isAdmin(ctx)) return next();
  if (isRateLimited(uid)) {
    return ctx.reply("â›” á‰¥á‹™ áŒ¥á‹«á‰„ áˆ áŠ¨á‹‹áˆ â€” áŠ¨ 10 á‹°á‰‚á‰ƒ á‰ áŠ‹áˆ‹ á‹áˆžáŠáˆ©á ¢").catch(() => {});
  }
  return next();
});

bot.catch((err, ctx) => {
  console.error("Bot error:", err?.message, ctx?.updateType);
  for (const aid of ADMIN_IDS)
    bot.telegram
      .sendMessage(aid, `âš ï¸ Bot Error: ${err?.message || "unknown"}\nUpdate: ${ctx?.updateType || "â€”"}`)
      .catch(() => {});
});

/* â”€â”€â”€ 14. WELCOME â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function welcomeText(name) {
  return (
    `ðŸ'‹ *áŠ¥áŠ•áŠ³áŠ• á‹ˆá‹° Group Buying á‰ á‹°áˆ…áŠ“ áˆ˜áŒ¡, ${name}!*\n\n` +
    `2ï¸ âƒ£ áˆ áˆá‰µáŠ• á‰€áŒ¥á‰³ áŠ¨á ‹á‰¥áˆªáŠ«áŠ“ áŠ¨áŒˆá‰ áˆ¬á‹Žá‰½ á‰ áˆ›áˆ áŒ£á‰µ á‹¨áŠ'áˆ® á‹ á‹µáŠ á‰±áŠ• áˆˆáˆ˜áŒ£áˆ á‰°áŠ áˆµá‰°áŠ“áˆ á ¢\n\n` +
    `3ï¸ âƒ£ á‰ áŒ‹áˆ« áŒ á‹¥ (Group Buying) á‰ áŠ áŠ•á‹µ áˆ‹á‹ á‰ áˆ˜áˆ†áŠ• áˆ›áŠ•áŠ›á‹ áŠ•áˆ á‹•á‰ƒ á‰ áŒ…áˆ áˆ‹ á‹‹áŒ‹ áŠ¨á ‹á‰¥áˆªáŠ« áŠ¥áŠ“ á‰ á‰€áŒ¥á‰³ áŠ¨ áŒˆá‰ áˆ¬á‹ áŠ¥áŠ•áŒˆá‹›áˆˆáŠ•á ¢\n\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â” \n` +
    `ðŸ“‹ *á‹¨áˆ á‹ áŒˆá‰£ áŠá á‹«:* ${REG_PER_KG} á‰¥áˆ/áŠªáˆŽ\n` +
    `_á‹¨áˆ áˆá‰µ á‹‹áŒ‹ áˆ á‹ áŒˆá‰£ áˆ²áˆžáˆ‹ á‹áŒ á‹¨á‰ƒáˆ‰_\n\n` +
    `ðŸ“ž áˆˆáŒ¥á‹«á‰„: ${SUPPORT_PHONE}\n\n` +
    `*áŠ¨á‹šáˆ… á‰ á‰³á‰½ áˆ áˆá‰µ á‹ˆá‹áˆ áŠ á‰…áŒ£áŒ« á‹áˆ áˆ¨áŒ¡:*`
  );
}

bot.start(async (ctx) => {
  ctx.session = {};
  await ctx.reply(welcomeText(ctx.from?.first_name || "áŠ¥áŠ•áŠ³áŠ• á‹°áˆ…áŠ“ áˆ˜áŒ¡"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});
bot.command("help", async (ctx) => {
  ctx.session = {};
  await ctx.reply(welcomeText(ctx.from?.first_name || "áŠ¥áŠ•áŠ³áŠ• á‹°áˆ…áŠ“ áˆ˜áŒ¡"), {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});

/* â”€â”€â”€ 15. á‰†áŒ£áˆª / áˆ á‹ áŒˆá‰£á‹¬ â”€â
bot.hears("ðŸ“Š á‹¨áŒáŠ á‰µ á‰†áŒ£áˆa", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_counter", true)))
    return ctx.reply("Please contact us: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  let txt = "*á‹¨áŒáŠ á‰µ áˆ áŠ”á‰³*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n*áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ *\n\n";
  for (const ro of ROUTES_TO_AMHARA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }
  txt += "*áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£*\n\n";
  for (const ro of ROUTES_TO_AA) {
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) });
});

bot.hears("ðŸ“‹ á‹¨áˆ á‹ áŒˆá‰£ á‹ áˆá‹ áˆ¬", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_my_regs", true)))
    return ctx.reply("Please contact us: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  const regs = await Reg.find({
    userId: ctx.from.id,
    status: { $nin: ["rejected"] },
  }).sort({ createdAt: -1 }).lean();

  const gbRegs = await GBReg.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();

  if (!regs.length && !gbRegs.length)
    return ctx.reply("áˆá‹áŒˆá‰£ áŠ áˆá‰°áŒˆáŠ˜áˆ", await mainKb(ctx.from?.id));

  for (const r of regs) {
    const btns = [Markup.button.callback("áˆ°áˆ­á‹", `del_${r._id}`)];
    if (!r.locationLat && ACTIVE.includes(r.status))
      btns.push(Markup.button.callback("áŠ á‹µáˆ«áˆ» áˆ‹áŠ", `addloc_${r._id}`));
    await ctx.reply(card(r), {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([btns]),
    });
  }

  for (const g of gbRegs) {
    const prod = byProduct(g.productId);
    const ul = unitLabel(prod);
    const agg = await GBReg.aggregate([
      { $match: { productId: g.productId } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0;
    const regCount = agg[0]?.count || 0;
    await ctx.reply(
      `${prod?.emoji} *${prod?.label}*\n` +
        `áˆµáˆ: ${g.fullName} | áˆµáˆáŠ­: ${g.phone}\n` +
        `á‰°áˆ˜á‹áŒá‰§áˆ: *${g.weightKg} ${ul}*\n` +
        `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
        `ðŸ'¥ á‰°áˆ³á‰³á Š: ${regCount} áˆ°á‹ \n\n` +
        `ðŸ'¤ áˆ™áˆ‰ áˆµáˆ á‹ŽáŠ• á‹«áˆµáŒˆá‰¡:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("âž• áŠªáˆŽ áŒ¨áˆ áˆ", `gb_addkg_${g._id}`)],
        ]),
      },
    );
  }
});

bot.action(/^addloc_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]).lean();
  if (!r || r.userId !== ctx.from?.id) return;
  ctx.session = { step: "LOC", locRegId: String(r._id) };
  await ctx.reply("áŠ á‹µáˆ«áˆ»á‹ŽáŠ• á‹«áŒ‹áˆ©:", locKb());
});

/* â”€â”€â”€ 16. GROUP BUYING PRODUCT MENU â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
for (const prod of GB_PRODUCTS) {
  bot.hears(`${prod.emoji} ${prod.label}`, async (ctx) => {
    if (!isAdmin(ctx) && !(await getSetting(`menu_product_${prod.id}`, true)))
      return ctx.reply("á‹áˆ… áˆ áˆá‰µ áŠ áˆ áŠ• áŠ áˆ á‰°áŠ¨á ˆá‰°áˆ á ¢\náˆˆáŒ¥á‹«á‰„: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
    ctx.session = { step: "GB_NAME", gbProductId: prod.id };
    const ul = unitLabel(prod);
    const agg = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = agg[0]?.kg || 0;
    const regCount = agg[0]?.count || 0;
    await ctx.reply(
      `${prod.emoji} *${prod.label}*\nâ”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n\n` +
        `ðŸ'° á‹¨áˆ áˆá‰µ á‹‹áŒ‹: *${prod.pricePerKg} á‰¥áˆ/${ul}*\n` +
        `ðŸ“‹ á‹¨áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹«: *${REG_PER_KG} á‰¥áˆ/${ul}*\n\n` +
        `${capLine(regKg, prod.targetKg, ul)}\n` +
        `ðŸ'¥ á‰°áˆ³á‰³á Š: ${regCount} áˆ°á‹ \n\n` +
        `ðŸ'¤ áˆ™áˆ‰ áˆµáˆ á‹ŽáŠ• á‹«áˆµáŒˆá‰¡:`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
  });
}

/* â”€â”€â”€ 17. ROUTE SELECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function startRegistration(ctx, route) {
  const ex = await Reg.findOne({
    userId: ctx.from.id,
    status: { $nin: ["rejected", "sent"] },
  }).lean();
  if (ex) {
    const ro = byRoute(ex.routeId);
    const btns = [Markup.button.callback("áˆ°áˆ­á‹", `del_${ex._id}`)];
    if (!ex.locationLat) btns.push(Markup.button.callback("áŠ á‹µáˆ«áˆ» áˆ‹áŠ­", `addloc_${ex._id}`));
    return ctx.reply(
      `âš ï¸ _áŠ áŠ•á‹µ áˆ á‹ áŒˆá‰£ á‰¥á‰» á‹á ˆá‰€á‹³áˆ _\n\n` + card(ex) + `\n\n_áˆŒáˆ‹ áˆˆáˆ˜áˆ˜á‹ áŒˆá‰¥ á‰€á‹°áˆ™áŠ• áˆ°áˆá‹˜á‹ á‹áˆžáŠáˆ©_`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([btns]) },
    );
  }
  ctx.session = { step: "NAME", routeId: route.id, d: {} };
  await ctx.reply(`${route.emoji} *${route.label}*\n\náˆ™áˆ‰ áˆµáˆá‹ŽáŠ• á‹«áˆµáŒˆá‰¡:`, {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
}

bot.hears("ðŸ”¼ áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ", async (ctx) => {
  if (! isAdmin(ctx) && !(await getSetting("load_menu_toamhara", true)))
    return ctx.reply("Please contact us for more information: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  await ctx.reply("*áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ * â€” áˆ˜áˆµáˆ˜áˆ á‹áˆ áˆ¨áŒ¡:", {
    parse_mode: "Markdown",
    ...dirRoutesKb(ROUTES_TO_AMHARA),
  });
});

bot.hears("ðŸ”½ áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", async (ctx) => {
  if (!isAdmin(ctx) && !(await getSetting("menu_cargo_toaa", true)))
    return ctx.reply("Please contact us for more information: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {};
  await ctx.reply("*áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£* â€” áˆ˜áˆµáˆ˜áˆ á‹áˆ áˆ¨áŒ¡:", {
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
  await ctx.reply(`${route.emoji} *${route.label}* â€” áˆŒáˆ‹ áŠ¥á‰ƒ áŒ¨áˆ áˆ\n\náˆ™áˆ‰ áˆµáˆ á‹ŽáŠ• á‹«áˆµáŒˆá‰¡:`, {
    parse_mode: "Markdown",
    ...(await mainKb(ctx.from?.id)),
  });
});

/* â”€â”€â”€ 18. PAYMENT METHOD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action(/^pm_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if ( ctx . session ? . step ! == " PAYMETHOD " ) return ;
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
  const acct = m.info.includes(":") ? m.info.split(":").slice(1).join(":").trim() : m.info;
  await ctx.reply(
    `${m.emoji} *${m.label}*\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â” \n` +
      `á‰ áŒ¥áˆ: \`${acct}\`\n\n` +
      `*á‹¨áˆ á‹ áŒˆá‰£ áŠá á‹«: ${r.totalPrice} á‰¥áˆ* (${d.kg} áŠªáˆŽ Ã— ${REG_PER_KG} á‰¥áˆ/áŠªáˆŽ)\n\n` +
      `âš ï¸ áŠá á‹« áŠ¨á ˆáŒ¸áˆ™ á‰ áŠ‹áˆ‹ *á‹¨á‹°áˆ¨áˆ°áŠ á Žá‰¶ (screenshot)* á‹áˆ‹áŠ©á ¢\n` +
      `á Žá‰¶ áˆ³á‹áˆ áŠ© áˆ á‹ áŒˆá‰£ áŠ á‹áŒ áŠ“á‰€á‰…áˆ !`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
});

/* â”€â”€â”€ 19. TEXT FLOW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.on("text", async (ctx, next) => {
  const { step } = ctx.session || {};
  if (!step) return next();
  const txt = ctx.message.text.trim();

  if (isSuspicious(txt)) {
    console.warn(`Suspicious input from ${ctx.from?.id}: ${txt.slice(0, 80)}`);
    return ctx.reply("â›” á‰µáŠáŠáˆˆáŠ› á‹«áˆ áˆ†áŠ áŒ á‰¥á‹“á‰µ â€” áˆ á‹ áŒˆá‰£ á‰°áˆ°áˆá‹Ÿáˆ á ¢").catch(() => {});
  }

  const reserved = [
    "ðŸ“‹ á‹¨áˆ á‹ áŒˆá‰£ á‹ áˆá‹ áˆ¬",
    "ðŸ“Š á‹¨áŒáŠ á‰µ á‰†áŒ£áˆª",
    "ðŸ”§ Admin",
    "â ï¸ áˆ³áˆ‹áŒ‹áˆ« áŒ¨áˆáˆµ",
    "ðŸ”¼ áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ",
    "ðŸ”½ áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£",
    ...GB_PRODUCTS.map((p) => `${p.emoji} ${p.label}`),
  ];
  if (reserved.includes(txt)) return next();

  if (step === "GB_NAME") {
    if (txt.length < 3) return ctx.reply("áˆ™áˆ‰ áˆµáˆ á‹«áˆµáŒˆá‰¡ (3+ áŠá‹°áˆ)");
    ctx.session.gbName = txt;
    ctx.session.step = "GB_PHONE";
    return ctx.reply("áˆµáˆ áŠ á‰ áŒ¥áˆá‹ŽáŠ• á‹«áˆµáŒˆá‰¡ (áˆ áˆ³áˆŒ: 0912345678):");
  }

  if (step === "GB_PHONE") {
    const phone = txt.replace(/\s/g, "");
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply("á‰µáŠáŠáˆˆáŠ› áˆµáˆ áŠ á‹«áˆµáŒˆá‰¡\náˆ áˆ³áˆŒ: 0912345678");
    ctx.session.gbPhone = phone;
    ctx.session.step = "GB_KG";
    const prod = byProduct(ctx.session.gbProductId);
    const ul = unitLabel(prod);
    return ctx.reply(
      `áˆ áŠ• á‹«áˆ…áˆ *${ul}* *${prod?.label}* á‹á ˆáˆ áŒ‹áˆ‰?\n` +
        `_(1 ${ul} = ${prod?.pricePerKg} á‰¥áˆ)_\n\ná‰ áŒ¥áˆ á‹«áˆµáŒˆá‰¡:`,
      { parse_mode: "Markdown" },
    );
  }

  if (step === "GB_KG") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 5000) return ctx.reply("á‰µáŠ­áŠ­áˆˆáŠ› á‰áŒ¥áˆ­ á‹«áˆµáŒˆá‰¡ (1â€“5000)");
    const prod = byProduct(ctx.session.gbProductId);
    const ul = unitLabel(prod);
    const serviceFee = Math.round(kg * REG_PER_KG);
    ctx.session.gbKg = kg;
    ctx.session.step = "GB_CONFIRM";
    return ctx.reply(
      `ðŸ“‹ *á‹¨áˆ á‹ áŒˆá‰£ áˆ›áˆ¨áŒ‹áŒˆáŒ«*\n` +
        `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â” \n` +
        `${prod?.emoji} *${prod?.label}*  â€¢  ${kg} ${ul}\n` +
        `ðŸ'¤ ${ctx.session.gbName} | ðŸ“ž ${ctx.session.gbPhone}\n\n` +
        `ðŸ'° á‹¨áˆ áˆá‰µ á‹‹áŒ‹: ${prod?.pricePerKg} á‰¥áˆ/${ul}\n` +
        `ðŸ“‹ *á‹¨áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹«:*\n` +
        ` ${kg} ${ul} Ã— ${REG_PER_KG} á‰¥áˆ = *${serviceFee.toLocalString()} á‰¥áˆ* âœ…\n\n` +
        `âš ï¸ _á‹áˆ… áŠá á‹« á‰¥á‰» áˆˆ bot á‹áŠ¨á ˆáˆ‹áˆ â€” á‹¨áˆ áˆá‰µ á‹‹áŒ‹ áˆ á‹ áŒˆá‰£ áˆ²áˆžáˆ‹ á‹áŒ á‹¨á‰ƒáˆ‰_\n\n` +
        `What is the name of the city?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "âœ… áŠ áˆ¨áŒ‹áŒ áŒ¥áŠ“ áˆ á‹ áŒˆá‰¥", callback_data: "gb_confirm_yes" },
              { text: "âŒ áˆ°áˆ­á‹", callback_data: "gb_confirm_no" },
            ],
          ],
        },
      },
    );
  }

  if (step === "GB_CONFIRM") return ctx.reply("Please confirm your entry");

  if (step === "GB_ADDKG") {
    const newTotal = parseFloat(txt.replace(/[^0-9.]/g, ""));
    const { gbAddId, gbAddOldKg, gbAddProductId } = ctx.session;
    const prod = byProduct(gbAddProductId);
    const ul = unitLabel(prod);
    if (!newTotal || newTotal <= 0 || newTotal > 5000)
      return ctx.reply("á‰µáŠáŠáˆˆáŠ› á‰ áŒ¥áˆ á‹«áˆµáŒˆá‰¡ (1â€“5000)");
    if (newTotal <= gbAddOldKg)
      return ctx.reply(
        `âš ï¸ áŠ áˆ áŠ• *${gbAddOldKg} ${ul}* á‰°áˆ˜á‹ áŒ á‰ á‹‹áˆ â€” áŠ¨á‹šáˆ… á‹¨áˆšá‰ áˆ áŒ¥ á‰ áŒ¥áˆ á‹«áˆµáŒˆá‰¡\n_(áˆˆáˆ áˆ³áˆŒ ${gbAddOldKg + 5})_`,
        { parse_mode: "Markdown" },
      );
    const diffKg = newTotal - gbAddOldKg;
    const diffFee = Math.round(diffKg * REG_PER_KG);
    ctx.session.gbAddNewKg = newTotal;
    ctx.session.gbAddDiffKg = diffKg;
    ctx.session.gbAddDiffFee = diffFee;
    ctx.session.step = "GB_ADDKG_CONFIRM";
    return ctx.reply(
      `ðŸ“‹ *áŠªáˆŽ áˆ›áˆ»áˆ»á‹« áˆ›áˆ¨áŒ‹áŒˆáŒ«*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n` +
        `${prod?.emoji} *${prod?.label}*\n` +
        `á‰€á‹µáˆž: *${gbAddOldKg} ${ul}* â†' áŠ á‹²áˆµ: *${newTotal} ${ul}*\n\n` +
        `âž• áŒáˆ›áˆª: ${diffKg} ${ul}\n` +
        `ðŸ'³ *á‹¨áˆšáŠ¨á ˆáˆˆá‹ : ${diffFee} á‰¥áˆ* (${diffKg} ${ul} Ã— ${REG_PER_KG} á‰¥áˆ)\n\n` +
        `á‹«áˆ¨áŒ‹áŒ áŒ¡?`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "âœ… áŠ áˆ¨áŒ‹áŒ áŒ¥", callback_data: "gb_addkg_confirm" },
              { text: "âŒ áˆ°áˆ­á‹", callback_data: "gb_addkg_cancel" },
            ],
          ],
        },
      },
    );
  }

  if (step === "GB_ADDKG_CONFIRM") return ctx.reply("Please confirm your entry");

  if (step === "ADMIN_PRICE") {
    const price = parseFloat(txt.replace(/[^0-9.]/g, ""));
    const { adminPriceId } = ctx.session;
    const prod = byProduct(adminPriceId);
    if (!prod) { ctx.session = {}; return ctx.reply("âŒ áˆáˆ­á‰µ áŠ áˆá‰°áŒˆáŠ˜áˆ"); }
    if (!price || price <= 0 || price > 100000)
      return ctx.reply("â Œ á‰µáŠáŠáˆˆáŠ› á‹‹áŒ‹ á‹«áˆµáŒˆá‰¡ (áˆˆáˆ áˆ³áˆŒ: 80)");
    const oldPrice = product.pricePerKg;
    product.pricePerKg = price;
    await setSetting(`price_${adminPriceId}`, price);
    ctx.session = {};
    const ul = unitLabel(prod);
    await ctx.reply(
      `âœ… *á‹‹áŒ‹ á‰°á‰€á‹áˆ¯áˆ !*\n\n${prod.emoji} *${prod.label}*\ná‰€á‹µáˆž: ${oldPrice} á‰¥áˆ/${ul}\náŠ áˆ áŠ•: *${price} á‰¥áˆ/${ul}*`,
      { parse_mode: "Markdown" },
    );
    for (const aid of ADMIN_IDS) {
      if (aid === ctx.from.id) continue;
      bot.telegram.sendMessage(
        aid,
        `${prod.emoji} *${prod.label}* á‹‹áŒ‹ á‰°á‰€á‹áˆ¯áˆ \n${oldPrice} â†' *${price}* á‰¥áˆ/${ul}`,
        { parse_mode: "Markdown" },
      ).catch(() => {});
    }
    return;
  }

  if (step === "PAYMETHOD") return ctx.reply("áŠ¨á‰áˆá á‹­áˆáˆ¨áŒ¡");
  if (step === "NAME") {
    if (txt.length < 3) return ctx.reply("áˆ™áˆ‰ áˆµáˆ á‹«áˆµáŒˆá‰¡ (3+ áŠá‹°áˆ)");
    ctx.session.d.name = txt;
    ctx.session.step = "PHONE";
    return ctx.reply("Please reply:");
  }
  if (step === "PHONE") {
    const phone = txt.replace(/\s/g, "");
    if (!/^0[79]\d{8}$/.test(phone) && !/^\+251[79]\d{8}$/.test(phone))
      return ctx.reply("á‰µáŠáŠáˆˆáŠ› áˆµáˆ áŠ á‹«áˆµáŒˆá‰¡\náˆ áˆ³áˆŒ: 0912345678");
    ctx.session.d.phone = phone;
    ctx.session.step = "CARGO";
    return ctx.reply("What is the name of the person (what is the name of the person?):");
  }
  if (step === "CARGO") {
    ctx.session.d.cargo = txt;
    ctx.session.step = "WEIGHT";
    return ctx.reply("áŠá‰¥á‹°á‰µ (áŠªáˆŽ):");
  }
  if (step === "WEIGHT") {
    const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
    if (!kg || kg <= 0 || kg > 2000) return ctx.reply("á‰µáŠ­áŠ­áˆˆáŠ› á‰áŒ¥áˆ­ á‹«áˆµáŒˆá‰¡ (1â€“2000)");
    ctx.session.d.kg = kg;
    ctx.session.step = "PAYMETHOD";
    return ctx.reply(
      `*áˆ›áŒ á‰ƒáˆˆá‹«*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n` +
        `áˆµáˆ: ${ctx.session.d.name}\n` +
        `cargo: ${ctx.session.d.cargo} â€” *${kg} cargo` +
        `ðŸ'³ *á‹¨áˆ á‹ áŒˆá‰£ (áŠ áŒˆáˆ áŒ áˆŽá‰µ) áŠá á‹«: ${kg * REG_PER_KG} á‰¥áˆ* (${kg} áŠªáˆŽ Ã— ${REG_PER_KG} á‰¥áˆ/áŠªáˆŽ)\n` +
        `_áˆŒáˆŽá‰¹ áŠá á‹«á‹Žá‰½ á‹•á‰ƒ áˆ²á‹ˆáŒ£ á‰ áˆŒáˆ‹ áˆ˜áŠ•áŒˆá‹µ á‹áˆµá‰°áŠ«áŠ¨áˆ‹áˆ‰_\n\n` +
        `áŠá á‹« á‹˜á‹´ á‹áˆ áˆ¨áŒ¡:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(
          METHODS.map((m) => [Markup.button.callback(`${m.emoji} ${m.label}`, `pm_${m.id}`)]),
        ),
      },
    );
  }

  if (step === "SEND_NOTE") {
    const { sendRoute } = ctx.session;
    ctx.session = {};
    const ready = await Reg.find({ routeId: sendRoute, status: "approved" }).lean();
    if (!ready.length) return ctx.reply("Please wait until the end of the message is displayed");
    const ro = byRoute(sendRoute);
    const note = txt;
    for (const r of ready) {
      await Reg.findByIdAndUpdate(r._id, { status: "sent" });
      bot.telegram
        .sendMessage(
          r.userId,
          `*áŒáŠ á‰µá‹Ž á‰°áˆ áŠ³áˆ !*\n${ro?.emoji} ${ro?.label}\n\n${note}\n\n\náˆˆáŒ¥á‹«á‰„: ${SUPPORT_PHONE}`,
          { parse_mode: "Markdown" },
        )
        .catch(() => {});
    }
    await ctx.reply(`âœ… ${ready.length} áˆ°á‹ á‰³á‹ˆá‰€ â€” ${ro?.label}`);
    return;
  }

  if (step === "COL_LOC") return next();
  return next();
});

/* â”€â”€â”€ 20. LOCATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
    if (!approved.length) return ctx.reply(`${ro.label} â€” áŠ á‹µáˆ«áˆ» á‹«áˆ‹á‰¸á‹ á ˆá‰ƒá‹µ á‹«áˆˆá‹ áˆ á‹ áŒˆá‰£ á‹¨áˆˆáˆ `);
    const nearby = approved
      .map((r) => {
        const dlat = r.locationLat - lat, dlng = r.locationLng - lng;
        const dist = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
        return { ...r, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);
    let txt = `${ro.emoji} *${ro.label}* â€” á‰…áˆá‰¥ á‹°áŠ•á‰ áŠžá‰½\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n`;
    for (const r of nearby) {
      txt += `${r.fullName} | ${r.phone} | ${r.weightKg}áŠª | ${r.dist.toFixed(1)}áŠªáˆœ\n[áŠ«áˆá‰³](https://maps.google.com/?q=${r.locationLat},${r.locationLng})\n\n`;
    }
    return ctx.reply(txt, { parse_mode: "Markdown" });
  }

  if (step === "LOC") {
    const regId = ctx.session.locRegId;
    ctx.session = {};
    const r = await Reg.findByIdAndUpdate(regId, { locationLat: lat, locationLng: lng }, { new: true });
    if (!r) return ctx.reply("áˆá‹áŒˆá‰£ áŠ áˆá‰°áŒˆáŠ˜áˆ", await mainKb(ctx.from?.id));
    const total = await routeWeight(r.routeId),
      ro2 = byRoute(r.routeId);
    await ctx.reply(
      `*áˆ á‹ áŒˆá‰£ á‰°áŒ áŠ“á‰€á‰€!*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n${ro2?.emoji} *${ro2?.label}*\n${capLine(total, ro2?.targetKg || TARGET_KG_DEFAULT)}\n\náŒáŠ á‰± áˆ²áˆžáˆ‹ á‰¤á‰µá‹Ž á‹áˆ°á‰ áˆ°á‰¥áˆˆá‹Žá‰³áˆ \n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    for (const aid of ADMIN_IDS) {
      bot.telegram.sendMessage(aid, `áŠ á‹µáˆ«áˆ» á‹°áˆ¨áˆ°: ${r.fullName} (${r.phone}) â†' ${ro2?.label}`).catch(() => {});
      bot.telegram.sendLocation(aid, lat, lng).catch(() => {});
    }
    return;
  }
  return next();
});

bot.hears("â ï¸ áˆ³áˆ‹áŒ‹áˆ« áŒ¨áˆáˆµ", async (ctx) => {
  if (ctx.session?.step !== "LOC")
    return ctx.reply("áŠ á‰…áŒ£áŒ« á‹­áˆáˆ¨áŒ¡", await mainKb(ctx.from?.id));
  const regId = ctx.session.locRegId;
  ctx.session = {};
  await ctx.reply(
    `*Please contact us!*\n
    await mainKb(ctx.from?.id),
  );
  if (regId) {
    const r = await Reg.findById(regId).lean();
    if (r)
      for (const aid of ADMIN_IDS)
        bot.telegram.sendMessage(aid, `áŠ á‹µáˆ«áˆ» áŠ áˆ á‰°áˆ‹áŠ¨áˆ â€” ${r.fullName} (${r.phone})`).catch(() => {});
  }
});

/* â”€â”€â”€ 21. PAYMENT PHOTO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.on("photo", async (ctx) => {
  const r = await Reg.findOne({ userId: ctx.from.id, status: "pending" }).sort({ createdAt: -1 });
  if (!r) return ctx.reply("áˆ á‹ áŒˆá‰£ áŠ áˆ á‰°áŒˆáŠ˜áˆ á ¢ áŠ á‰…áŒ£áŒ« á‹áˆ áˆ¨áŒ¡", await mainKb(ctx.from?.id));
  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  r.paymentFileId = fileId;
  r.status = "reviewing";
  await r.save();
  await ctx.reply("á Žá‰¶ á‹°áˆáˆ·áˆ â€” áŠá á‹« áŠ¥á‹¨á‰°áˆ¨áŒ‹áŒˆáŒ áŠ á‹ ...");
  const verdict = await checkPayment(fileId, r);
  r.aiVerdict = verdict;
  const autoOk = AI_AUTO_APPROVE && aiOk(verdict);
  if (autoOk) { r.status = "approved"; r.aiAutoApproved = true; }
  await r.save();
  bot.telegram
    .sendMessage(
      ctx.from.id,
      autoOk
        ? `*áŠá á‹« á‰°á ˆá‰…á‹·áˆ !*\n\n${card(r.toObject())}\n\nnáŒáŠ á‰µá‹Ž áˆ²áˆ‹áŠ á‹áŠ áŒˆáˆá‹Žá‰³áˆ .\n${SUPPORT_PHONE}`
        : `á Žá‰¶ á‹°áˆáˆ·áˆ . áŠá á‹« áŠ¥á‹¨á‰°á ˆá‰°áˆ¸ áŠ á‹ â€” á‰µáŠ•áˆ½ á‹áŒ á‰¥á‰ .\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    )
    .catch(() => {});
  ctx.session = { step: "LOC", locRegId: String(r._id), locTries: 0 };
  await ctx.reply("áŠ á‹µáˆ«áˆ»á‹ŽáŠ• á‹«áŒ‹áˆ© â€” á‰¤á‰µá‹Ž á‹áˆ°á‰ áˆ°á‰¥áˆˆá‹Žá‰³áˆ :", locKb());
  const caption = aiSummary(verdict) + "\n\n" + (autoOk ? "AI á‹«áˆ¨áŒ‹áŒˆáŒ \n\n" : "") + card(r.toObject(), true);
  const kb = Markup.inlineKeyboard([
    [
      Markup.button.callback(autoOk ? "áˆ°áˆ­á‹" : "áˆá‰€á‹µ", autoOk ? `no_${r._id}` : `ok_${r._id}`),
      Markup.button.callback("áŠ¨áˆáŠ­áˆ", `no_${r._id}`),
    ],
  ]);
  for (const aid of ADMIN_IDS)
    bot.telegram.sendPhoto(aid, fileId, { caption, parse_mode: "Markdown", ...kb }).catch(() => {});
});

/* â”€â”€â”€ 22. ADMIN PANEL â”€â
bot.hears("ðŸ”§ Admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  ctx.session = {};
  const grpOn = await getSetting("group_notify_enabled", true);
  const grpIcon = grpOn ? "ðŸŸ¢" : "ðŸ”´";
  await ctx.reply("*á‹¨áŠ áˆµá‰°á‹³á‹³áˆª á “áŠ áˆ *", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ áˆ á‹ áŒˆá‰¦á‰½", "lst_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ áˆ á‹ áŒˆá‰¦á‰½", "lst_dir_toaa")],
      [Markup.button.callback("pay", "lst_pay")],
      [Markup.button.callback("áŒáŠ á‰µ áˆ°á‰¥áˆ³á‰¢ (áŠ á‰…áˆ«á‰¢á‹« á‹ áˆá‹ áˆ)", "col_pick")],
      [Markup.button.callback("áŒáŠ á‰µ áˆ‹áŠ (áˆˆá‹°áŠ•á‰ áŠžá‰½ áˆ›áˆ³á‹ˆá‰‚á‹«)", "snd_pick")],
      [Markup.button.callback("á‹¨áŒáŠ á‰µ áˆªá –áˆá‰µ", "admin_report")],
      [Markup.button.callback("á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "channel_panel")],
      [Markup.button.callback("Print Manifest", "print_pick")],
      [Markup.button.callback("ðŸ"¦ á‹¨á‰¡á‹µáŠ• áŒ á‹¥ áˆ áŠ”á‰³", "gb_status")],
      [Markup.button.callback("ðŸ“£ á‰€áˆª áŠªáˆŽ áˆˆá‰°áŒ á‰ƒáˆšá‹Žá‰½ áˆ‹áŠ", "gb_broadcast_remain")],
      [Markup.button.callback("ðŸ“¢ GB á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "gb_channel_panel")],
      [Markup.button.callback(`${grpIcon} Group Notify (Auto-Post)`, "toggle_group_notify")],
      [Markup.button.callback("ðŸ'° á‹‹áŒ‹ áˆ›áˆ»áˆ»á‹«", "price_panel")],
      [Markup.button.callback("ðŸ“‹ áˆ áŠ“áˆŒ áŠ áˆµá‰°á‹³á‹³áˆª (Menu Manager)", "menu_manager")],
    ]),
  });
});

bot.action("price_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const buttons = GB_PRODUCTS.map((p) => {
    const ul = p.unit === "liter" ? "áˆŠá‰µáˆ" : "áŠªáˆŽ";
    return [ Markup . button . callback ( ` $ { p . emoji } $ { p . label } â€” $ { p . pricePerKg } price / $ { ul }` , ` adm_setprice_ $ { p . id }` )] ;
  });
  buttons.push([Markup.button.callback("â†©ï¸ á‰°áˆ˜áˆˆáˆµ", "back_to_admin")]);
  await ctx.reply(
    `ðŸ'° *á‹‹áŒ‹ áˆ›áˆ»áˆ»á‹«*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \ná‹¨á‰µáŠ›á‹ áŠ• áˆ áˆá‰µ á‹‹áŒ‹ áˆˆáˆ˜á‰€á‹¨áˆ?`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
});

bot.action(/^adm_setprice_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const prodId = ctx.match[1];
  const prod = byProduct(prodId);
  if (!prod) return ctx.reply("âŒ áˆáˆ­á‰µ áŠ áˆá‰°áŒˆáŠ˜áˆ");
  const ul = unitLabel(prod);
  ctx.session = { step: "ADMIN_PRICE", adminPriceId: prodId };
  await ctx.reply(
    `${prod.emoji} *${prod.label}*\náŠ áˆ áŠ“á‹Š á‹‹áŒ‹: *${prod.pricePerKg} á‰¥áˆ/${ul}*\n\náŠ á‹²áˆµ á‹‹áŒ‹ á‹«áˆµáŒˆá‰¡ (á‰¥áˆ):`,
    { parse_mode: "Markdown" },
  );
});

bot.action("back_to_admin", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  const grpOn = await getSetting("group_notify_enabled", true);
  const grpIcon = grpOn ? "ðŸŸ¢" : "ðŸ”´";
  await ctx.reply("*á‹¨áŠ áˆµá‰°á‹³á‹³áˆª á “áŠ áˆ *", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ áˆ á‹ áŒˆá‰¦á‰½", "lst_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ áˆ á‹ áŒˆá‰¦á‰½", "lst_dir_toaa")],
      [Markup.button.callback("pay", "lst_pay")],
      [Markup.button.callback("áŒáŠ á‰µ áˆ°á‰¥áˆ³á‰¢ (áŠ á‰…áˆ«á‰¢á‹« á‹ áˆá‹ áˆ)", "col_pick")],
      [Markup.button.callback("áŒáŠ á‰µ áˆ‹áŠ (áˆˆá‹°áŠ•á‰ áŠžá‰½ áˆ›áˆ³á‹ˆá‰‚á‹«)", "snd_pick")],
      [Markup.button.callback("á‹¨áŒáŠ á‰µ áˆªá –áˆá‰µ", "admin_report")],
      [Markup.button.callback("á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "channel_panel")],
      [Markup.button.callback("Print Manifest", "print_pick")],
      [Markup.button.callback("ðŸ"¦ á‹¨á‰¡á‹µáŠ• áŒ á‹¥ áˆ áŠ”á‰³", "gb_status")],
      [Markup.button.callback("ðŸ“£ á‰€áˆª áŠªáˆŽ áˆˆá‰°áŒ á‰ƒáˆšá‹Žá‰½ áˆ‹áŠ", "gb_broadcast_remain")],
      [Markup.button.callback("ðŸ“¢ GB á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "gb_channel_panel")],
      [Markup.button.callback(`${grpIcon} Group Notify (Auto-Post)`, "toggle_group_notify")],
      [Markup.button.callback("ðŸ'° á‹‹áŒ‹ áˆ›áˆ»áˆ»á‹«", "price_panel")],
      [Markup.button.callback("ðŸ“‹ áˆ áŠ“áˆŒ áŠ áˆµá‰°á‹³á‹³áˆª (Menu Manager)", "menu_manager")],
    ]),
  });
});

bot.action("toggle_group_notify", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const current = await getSetting("group_notify_enabled", true);
  const next = !current;
  await setSetting("group_notify_enabled", next);
  const icon = next ? "ðŸŸ¢" : "ðŸ”´";
  const label = next ? "á‰°áŠ á‰ƒá‰ (ON)" : "á‰°á‹˜áŒ‹ (OFF)";
  await ctx.reply(
    `${icon} *Group áˆ›áˆµá‰³á‹ˆá‰‚á‹« â€” ${label}*\n\n` +
      (next
        ? `á‹°áŠ•á‰ áŠ› áˆ²áˆ˜á‹˜áŒˆá‰¥ á‹ˆá‹²á‹«á‹ á‹ˆá‹° Group á‹áˆ‹áŠ«áˆ á ¢\n_(GROUP_ID: ${GROUP_ID || "áŠ áˆ á‰°á‰€áˆ˜áŒ áˆ "})_`
        : `Group áˆ›áˆµá‰³á‹ˆá‰‚á‹« á‰†áˆŸáˆ â€” áˆ á‹ áŒˆá‰£ áˆˆ Channel/Admin á‰¥á‰» á‹áˆ‹áŠ«áˆ á ¢`),
    { parse_mode: "Markdown" },
  );
});

/* â”€â”€ áˆ áŠ“áˆŒ áŠ áˆµá‰°á‹³á‹³áˆª â”€â
bot.action("menu_manager", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await sendMenuManagerPanel(ctx);
});

async function sendMenuManagerPanel(ctx) {
  const states = await Promise.all(MENU_SETTINGS.map((m) => getSetting(m.key, true)));
  const buttons = MENU_SETTINGS.map((m, i) => {
    const on = states[i];
    const icon = on ? "ðŸŸ¢" : "ðŸ” ́";
    return [Markup.button.callback(`${icon} ${m.emoji} ${m.label}`, `tmitem_${m.key}`)];
  });
  buttons.push([
    Markup.button.callback("ðŸ”´ áˆáˆ‰áŠ•áˆ áŒ¥á‹", "tmall_off"),
    Markup.button.callback("ðŸŸ¢ áˆáˆ‰áŠ•áˆ á‰¥áˆ«", "tmall_on"),
  ]);
  const lines = MENU_SETTINGS.map((m, i) => `${states[i] ? "ðŸŸ¢" : "ðŸ”´"} ${m.emoji} ${m.label}`).join("\n");
  await ctx.reply(
    `*ðŸ“‹ áˆ áŠ“áˆŒ áŠ áˆµá‰°á‹³á‹³áˆª*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n${lines}\n\n_á‰ áˆ á‹áŒ«áŠ' áˆˆáˆ˜á‰€á‹«á‹¨áˆ:_`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) },
  );
}

bot.action(/^tmitem_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const key = ctx.match[1];
  const item = MENU_SETTINGS.find((m) => m.key === key);
  if (!item) return;
  const current = await getSetting(key, true);
  const next = !current;
  await setSetting(key, next);
  const statusWord = next ? "ðŸŸ¢ á‰°áŠ¨á ˆá‰° (ON)" : "ðŸ”´ á‰°á‹˜áŒ‹ (OFF)";
  await ctx.reply(`${item.emoji} *${item.label}*\n${statusWord}`, { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

bot.action("tmall_on", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, true)));
  await ctx.reply("ðŸŸ¢ *áˆ áˆ‰áˆ áˆ áŠ“áˆŒ á‰ áˆ á Žá‰½ á‰°áŠ¨á ˆá‰±*", { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

bot.action("tmall_off", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await Promise.all(MENU_SETTINGS.map((m) => setSetting(m.key, false)));
  await ctx.reply("ðŸ”´ *áˆ áˆ‰áˆ áˆ áŠ“áˆŒ á‰ áˆ á Žá‰½ á‰°á‹˜áŒ‰*", { parse_mode: "Markdown" });
  await sendMenuManagerPanel(ctx);
});

/* â”€â”€ GB status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("gb_status", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = "*ðŸ“¦ á‹¨á‰¡á‹µáŠ• áŒ á‹¥ áˆ áŠ”á‰³*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n";
  for (const prod of GB_PRODUCTS) {
    const ul = unitLabel(prod);
    const res = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 }, revenue: { $sum: "$totalCost" } } },
    ]);
    const regKg = res[0]?.kg || 0, regCount = res[0]?.count || 0, revenue = res[0]?.revenue || 0;
    txt +=
      `${prod.emoji} *${prod.label}* â€” ${prod.pricePerKg} á‰¥áˆ/${ul}\n` +
      `${capLine(regKg, prod.targetKg)}\n` +
      `á‰°áˆ³á‰³á Š áˆ°á‹Žá‰½: ${regCount} | áŒ á‰…áˆ‹áˆ‹ á‹‹áŒ‹: ${revenue.toLocaleString()} á‰¥áˆ\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* â”€â”€ GB Confirm / Cancel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("gb_confirm_yes", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbProductId, gbName, gbPhone, gbKg } = ctx.session || {};
  if (!gbProductId || !gbName || !gbPhone || !gbKg) {
    ctx.session = {};
    return ctx.reply("âš ï¸ áˆ á‹ áŒˆá‰£ áŒŠá‹œ áŠ áˆ á Žá‰³áˆ â€” áŠ¥áŠ•á‹°áŒˆáŠ" á‹áŒ€áˆ áˆ©á ¢", await mainKb(ctx.from?.id));
  }
  const prod = byProduct(gbProductId);
  const ul = unitLabel(prod);
  const totalCost = Math.round(gbKg * (prod?.pricePerKg || 0));
  const serviceFee = Math.round(gbKg * REG_PER_KG);
  ctx.session = {};
  await GBReg.create({
    userId: ctx.from.id,
    username: ctx.from.username || "",
    productId: gbProductId,
    fullName: gbName,
    phone: gbPhone,
    weightKg: gbKg,
    totalCost,
    pricePerKg: prod?.pricePerKg || 0,
  });
  const agg = await GBReg.aggregate([
    { $match: { productId: gbProductId } },
    { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
  ]);
  const regKg = agg[0]?.kg || 0, regCount = agg[0]?.count || 0;
  await ctx.reply(
    `ðŸŽ‰ *áˆ á‹ áŒˆá‰£ á‰°áŒ áŠ“á‰€á‰€!*\n` +
      `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â” \n` +
      `${prod?.emoji} *${prod?.label}* â€” ${gbKg} ${ul}\n` +
      `ðŸ'¤ ${gbName} | ðŸ“ž ${gbPhone}\n\n` +
      `ðŸ“‹ *áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹«: ${serviceFee.toLocaleString()} á‰¥áˆ* âœ…\n` +
      `_(${gbKg} ${ul} Ã— ${REG_PER_KG} á‰¥áˆ â€” áˆˆ bot á‰¥á‰»)_\n\n` +
      `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
      `ðŸ'¥ á‰°áˆ³á‰³á Š: ${regCount} áˆ°á‹ \n\n` +
      `âœ¨ _áˆ á‹ áŒˆá‰£ áˆ²áˆžáˆ‹ áŠ¥áŠ“áˆ3á‹ á‰...á‹Žá‰3áˆˆáŠ•!_\nðŸ“ž $_{SUPPORT_PHONE}`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
  for (const aid of ADMIN_IDS)
    bot.telegram
      .sendMessage(aid, `ðŸ†• GB: ${prod?.emoji}${prod?.label} â€” ${gbName} (${gbPhone}) â€” ${gbKg}${ul} | ${serviceFee}á‰¥`)
      .catch(() => {});
  const regMsg =
    `${prod?.emoji} *${prod?.label} â€” áŠ á‹²áˆµ áˆ á‹ áŒˆá‰£!*\n` +
    `â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â” \n` +
    `ðŸ'¤ ${gbName} | ðŸ“ž ${gbPhone}\n` +
    `âš–ï¸ *${gbKg} ${ul}* â€¢ ${prod?.pricePerKg} á‰¥áˆ/${ul}\n` +
    `ðŸ“‹ áŠ áŒˆáˆ áŒ áˆŽá‰µ: ${serviceFee.toLocaleString()} á‰¥áˆ\n\n` +
    `${capLine(regKg, prod?.targetKg || 5000, ul)}\n` +
    `ðŸ'¥ á‰°áˆ³á‰³á Š: ${regCount} áˆ°á‹ `;
  if (CHANNEL_ID)
    bot.telegram.sendMessage(CHANNEL_ID, regMsg, { parse_mode: "Markdown" }).catch(() => {});
  if (GROUP_ID) {
    const groupEnabled = await getSetting("group_notify_enabled", true);
    if (groupEnabled)
      bot.telegram.sendMessage(GROUP_ID, regMsg, { parse_mode: "Markdown" }).catch(() => {});
  }
  checkGBCapacity(gbProductId).catch(() => {});
});

bot.action(/^gb_addkg_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const regId = ctx.match[1];
  const reg = await GBReg.findById(regId).lean();
  if (!reg || reg.userId !== ctx.from?.id)
    return ctx.reply("â Œ áˆ á‹ áŒˆá‰£ áŠ áˆ á‰°áŒˆáŠ˜áˆ á‹ˆá‹áˆ á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ");
  const prod = byProduct(reg.productId);
  const ul = unitLabel(prod);
  ctx.session = { step: "GB_ADDKG", gbAddId: regId, gbAddProductId: reg.productId, gbAddOldKg: reg.weightKg };
  await ctx.reply(
    `âž• *áŠªáˆŽ áŒ¨áˆ áˆ â€” ${prod?.emoji} ${prod?.label}*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n` +
      `áŠ áˆ áŠ• á‹«áˆˆ: *${reg.weightKg} ${ul}*\n\n` +
      `*áŠ á‹²áˆ± áŒ á‰…áˆ‹áˆ‹ áŠªáˆŽ* áˆµáŠ•á‰µ á‹áˆ áŠ•? (áŠ¨ ${reg.weightKg} + 1 â€‹á‹ˆá‹²áˆ…)\n` +
      `_(áˆ áˆ³áˆŒ: á‰€á‹µáˆž 5kg áŠ¨áˆ†áŠ áŠ áˆ áŠ• 10 á‹«áˆµáŒˆá‰¡ â†' 5kg áˆ á‹©áŠ á‰µ á‰¥á‰» á‹áŠ¨á áˆ‹áˆ‰)_`,
    { parse_mode: "Markdown" },
  );
});

bot.action("gb_addkg_confirm", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const { gbAddId, gbAddProductId, gbAddOldKg, gbAddNewKg, gbAddDiffKg, gbAddDiffFee } = ctx.session || {};
  if (!gbAddId || !gbAddNewKg) {
    ctx.session = {};
    return ctx.reply("âš ï¸ áŒŠá‹œ áŠ áˆ á Žá‰³áˆ â€” áŠ¥áŠ•á‹°áŒˆáŠ" á‹áˆžáŠáˆ©");
  }
  const prod = byProduct(gbAddProductId);
  const ul = unitLabel(prod);
  await GBReg.findByIdAndUpdate(gbAddId, { $inc: { weightKg: gbAddDiffKg } });
  ctx.session = {};
  const updated = await GBReg.findById(gbAddId).lean();
  await ctx.reply(
    `âœ… *áŠªáˆŽ á‰°áŒ¨áˆ áˆ¯áˆ !*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n` +
      `${prod?.emoji} *${prod?.label}*\n` +
      `á‰€á‹µáˆž: ${gbAddOldKg} ${ul} â†' áŠ áˆ áŠ•: *${updated?.weightKg || gbAddNewKg} ${ul}*\n` +
      `ðŸ'3 *áˆ á‹©áŠ á‰µ áŠá á‹«: ${gbAddDiffFee} á‰¥áˆ* (${gbAddDiffKg} ${ul} Ã— ${REG_PER_KG} á‰¥\n\`)
      `ðŸ“ž ${SUPPORT_PHONE}`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(
      aid,
      `ðŸ”„ GB áŠªáˆŽ á‰°áŒ¨áˆ áˆ¯áˆ : ${prod?.emoji}${prod?.label} â€” ${gbAddOldKg}â†'${gbAddNewKg}${ul} (+$Add}{Diff}) ${updated?.fullName}`,
    ).catch(() => {});
  checkGBCapacity(gbAddProductId).catch(() => {});
});

bot.action("gb_addkg_cancel", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  return ctx.reply("áˆ°áˆ­á‹Ÿáˆá¢", await mainKb(ctx.from?.id));
});

bot.action("gb_confirm_no", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = {};
  return ctx.reply("â Œ áˆ á‹ áŒˆá‰£ á‰°áˆ°áˆá‹Ÿáˆ á ¢\náˆˆáˆ›áˆµáŒ€áˆ áˆ á‹³áŒ áˆ áˆ áˆ áˆá‰±áŠ• á‹áˆ áˆ¨áŒ¡á ¢", await mainKb(ctx.from?.id));
});

/* â”€â”€ Broadcast remaining kg â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("gb_broadcast_remain", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let summary = "*ðŸ›' á‹¨á‰¡á‹µáŠ• áŒ á‹¥ â€” á‰€áˆª áˆ áŠ”á‰³*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n";
  for (const prod of GB_PRODUCTS) {
    const ul = unitLabel(prod);
    const res = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = res[0]?.kg || 0, regCount = res[0]?.count || 0;
    summary +=
      `${prod.emoji} *${prod.label}* â€” *${prod.pricePerKg} á‰¥áˆ/${ul}*\n` +
      `${capLine(regKg, prod.targetKg, ul)}\nðŸ'¥ á‰°áˆ3á‰3á Š: ${regCount} áˆ°á‹ \n`;
  }
  summary +=
    `á‰€áŒ¥á‰³ áŠ¨ *áŒˆá‰ áˆ¬á‹Žá‰½* áŠ¥áŠ“ *á ‹á‰¥áˆªáŠ«á‹Žá‰½*!\n` +
    `áŠ áŠ áˆµá‰°áŠ› á‹¨áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹« á‰¥á‰» â€” *á á‰±áŠ• áˆ˜á‹µáˆƒáŠ'á‰µ!*\n\n` +
    `áˆˆáˆ á‹ áŒˆá‰£ á‰¦á‰±áŠ• á‹áŒ á‰€áˆ™ | ${SUPPORT_PHONE}`;
  const gbUsers = await GBReg.distinct("userId");
  const cargoUsers = await Reg.distinct("userId", { status: { $nin: ["rejected"] } });
  const allUsers = [...new Set([...gbUsers, ...cargoUsers])];
  let sent = 0;
  for (const uid of allUsers) {
    try { await bot.telegram.sendMessage(uid, summary, { parse_mode: "Markdown" }); sent++; } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`âœ… á‰€áˆª áˆ áŠ”á‰³ áˆˆ ${sent} áˆ°á‹ á‰°áˆ áŠ³áˆ `);
});

/* â”€â”€ GB á‰»áŠ“áˆ â”€â
bot.action("gb_channel_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID áŠ áˆá‰°á‰€áˆ˜áŒ áˆ");
  await ctx.reply(
    "*ðŸ“¢ GB á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«*\n\náˆ áˆá‰µ áˆ áˆ¨áŒ¥ â€” á‹ˆá‹° á‰»áŠ“áˆ á‹áˆ‹áŠ«áˆ :",
    Markup.inlineKeyboard([
      ...GB_PRODUCTS.map((p) => [Markup.button.callback(`${p.emoji} ${p.label}`, `gb_ch_ann_${p.id}`)]),
      [Markup.button.callback("ðŸ“¢ áˆáˆ‰áŠ•áˆ áˆáˆ­á‰¶á‰½ áˆ‹áŠ­", "gb_ch_ann_all")],
    ]),
  );
});

bot.action(/^gb_ch_ann_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID áŠ áˆá‰°á‰€áˆ˜áŒ áˆ");
  const targetId = ctx.match[1];
  const products = targetId === "all" ? GB_PRODUCTS : [byProduct(targetId)].filter(Boolean);
  let msg = `*ðŸ›' á‹¨á‰¡á‹µáŠ• áŒ á‹¥ â€” áŠ áˆ áŠ“á‹Š áˆ áŠ”á‰³*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n`;
  for (const prod of products) {
    const ul = unitLabel(prod);
    const res = await GBReg.aggregate([
      { $match: { productId: prod.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" }, count: { $sum: 1 } } },
    ]);
    const regKg = res[0]?.kg || 0, regCount = res[0]?.count || 0;
    msg +=
      `${prod.emoji} *${prod.label}*\n` +
      `ðŸ'° á‹¨áˆ áˆá‰µ á‹‹áŒ‹: *${prod.pricePerKg} á‰¥áˆ/${ul}*\n` +
      `ðŸ“‹ á‹¨áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹«: *${REG_PER_KG} á‰¥áˆ/${ul}*\n` +
      `${capLine(regKg, prod.targetKg, ul)}\n` +
      `ðŸ'¥ á‰°áˆ³á‰³á Š: ${regCount} áˆ°á‹ \n\n`;
  }
  msg +=
    `âœ¨ á‰€áŒ¥á‰³ áŠ¨ *áŒˆá‰ áˆ¬á‹Žá‰½* áŠ¥áŠ“ *á ‹á‰¥áˆªáŠ«á‹Žá‰½*!\n` +
    `_á‰µáŠ•áˆ½ áŠ áŒˆáˆ áŒ áˆŽá‰µ áŠá á‹« á‰¥á‰» â€” áˆŒáˆ‹ áŠá á‹« á‹¨áˆˆáˆ !_\n\n` +
    `áˆˆáˆ á‹ áŒˆá‰£ á‰¦á‰±áŠ• á‹áŒ á‰€áˆ™ | ${SUPPORT_PHONE}`;
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, msg, { parse_mode: "Markdown" });
    await ctx.reply(`âœ… á‰»áŠ“áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹« á‰°áˆ áŠ³áˆ `);
  } catch (e) {
    await ctx.reply(`â Œ áŠ áˆ á‰°áˆ³áŠ«áˆ : ${e.message}`);
  }
});

/* â”€â”€ Route lists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("lst_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "The following is a list of the most important things to know:",
    Markup.inlineKeyboard(ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)])),
  );
});
bot.action("lst_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ â€” áˆ˜áˆµáˆ˜áˆ áˆ áˆ áˆ¨áŒ¥:",
    Markup.inlineKeyboard(ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `lst_${r.id}`)])),
  );
});

bot.action("lst_pay", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const list = await Reg.find({ status: "reviewing" }).sort({ createdAt: 1 }).lean();
  if (!list.length) return ctx.reply("á‹«áˆ á‰°á ˆá‰€á‹° áŠá á‹« á‹¨áˆˆáˆ ");
  for (const r of list) {
    const txt = aiSummary(r.aiVerdict) + "\n\n" + card(r, true);
    if (r.paymentFileId)
      await bot.telegram.sendPhoto(ctx.chat.id, r.paymentFileId, { caption: txt, parse_mode: "Markdown", ...approveKb(r._id) });
    else await ctx.reply(txt, { parse_mode: "Markdown", ...approveKb(r._id) });
  }
});

bot.action(/^lst_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const list = await Reg.find({ routeId: ro.id }).sort({ createdAt: -1 }).lean();
  if (!list.length) return ctx.reply(`${ro.emoji} ${ro.label} â€” áˆá‹áŒˆá‰£ á‹¨áˆˆáˆ`);
  const cnt = {};
  list.forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  const total = await routeWeight(ro.id);
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n${list.length} áˆ°á‹ | á ˆá‰ƒá‹µ: ${cnt.approved || 0} | á á‰°áˆ»: ${cnt.reviewing || 0} | á‹«áˆ áŠ¨á ˆáˆˆ: ${cnt.pending || 0} | á‰°áˆ áŠ³áˆ : ${cnt.sent || 0}\n${capLine(total, ro.targetKg)}`,
    { parse_mode: "Markdown" },
  );
  for (const r of list) {
    const kb =
      r.status === "reviewing"
        ? approveKb(r._id)
        : r.status === "approved"
          ? Markup.inlineKeyboard([[Markup.button.callback("áˆ°áˆ­á‹", `no_${r._id}`)]])
          : {};
    await ctx.reply(card(r, true), { parse_mode: "Markdown", ...kb });
  }
});

async function setStatus(ctx, id, newStatus, notifyFn) {
  const r = await Reg.findByIdAndUpdate(id, { status: newStatus }, { new: true });
  if (!r) return;
  const fn = ctx.editMessageCaption ? "editMessageCaption" : "editMessageText";
  await ctx[fn](card(r.toObject(), true), { parse_mode: "Markdown" }).catch(() => {});
  if (notifyFn)
    bot.telegram.sendMessage(r.userId, notifyFn(r), { parse_mode: "Markdown" }).catch(() => {});
  await checkCapacity(r.routeId);
}

bot.action(/^ok_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery("á‰°áˆá‰…á‹·áˆ").catch(() => {});
  await setStatus(
    ctx, ctx.match[1], "approved",
    (r) => `*áŠá á‹« á‰°á ˆá‰…á‹·áˆ !*\n\n${card(r.toObject())}\n\náŒáŠ á‰µá‹Ž áˆ²áˆ‹áŠ á‹áŠ áŒˆáˆá‹Žá‰³áˆ .\n${SUPPORT_PHONE}`,
  );
});
bot.action(/^no_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery("áŠ áˆá‰°á‰€á‰ áˆˆáˆ").catch(() => {});
  await setStatus(ctx, ctx.match[1], "rejected", () => `áŠ­áá‹« áŠ áˆá‰°á‰€á‰ áˆˆáˆ.\n${SUPPORT_PHONE}`);
});

bot.action(/^del_([a-f\d]{24})$/i, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const r = await Reg.findById(ctx.match[1]);
  if (!r) return;
  if (r.userId !== ctx.from?.id && !isAdmin(ctx)) return;
  if (r.status === "sent") return ctx.reply("áŒ­áŠá‰± á‰°áˆáŠ³áˆ â€” áˆ˜áˆ°áˆ¨á‹ áŠ á‹­á‰»áˆáˆ");
  const routeId = r.routeId;
  await r.deleteOne();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await checkCapacity(routeId);
  await ctx.reply("áˆá‹áŒˆá‰£ á‰°áˆ°áˆ­á‹Ÿáˆ. áˆˆáˆ˜áˆ˜á‹áŒˆá‰¥ áŠ á‰…áŒ£áŒ« á‹­áˆáˆ¨áŒ¡", await mainKb(ctx.from?.id));
});

/* â”€â”€ Send shipment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("snd_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "áˆ áŠ• áŠ á‰…áŒ£áŒ«?",
    Markup.inlineKeyboard([
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ", "snd_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", "snd_dir_toaa")],
    ]),
  );
});
bot.action("snd_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ :", Markup.inlineKeyboard(ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])));
});
bot.action("snd_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£:", Markup.inlineKeyboard(ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `snd_${r.id}`)])));
});
bot.action(/^snd_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const ready = await Reg.find({ routeId: ro.id, status: "approved" }).lean();
  if (!ready.length) return ctx.reply("Please wait until the end of the message is displayed");
  const total = ready.reduce((s, r) => s + (r.weightKg || 0), 0);
  ctx.session = { step: "SEND_NOTE", sendRoute: ro.id };
  await ctx.reply(`${ro.label} | ${ready.length} áˆ°á‹ | ${total} áŠaáˆŽ\n\náˆˆá‹°áŠ•á‰ áŠžá‰1⁄2 áˆ›áˆμá‰3á‹ˆáˆ» á‹«áˆμáŒˆá‰¡:`);
});

/* â”€â”€ Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("admin_report", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  let txt = "*á‹¨áŒáŠ á‰µ áˆªá –áˆá‰µ*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n*áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ *\n";
  for (const ro of ROUTES_TO_AMHARA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    const m = {};
    counts.forEach((c) => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\ná ˆá‰ƒá‹µ: ${m.approved || 0} | á á‰°áˆ»: ${m.reviewing || 0} | á‹«áˆ áŠ¨á ˆáˆˆ: ${m.pending || 0} | á‰°áˆ áŠ³áˆ : ${m.sent || 0} | ${total}/${ro.targetKg} áŠªáˆŽ\n\n`;
  }
  txt += "*áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£*\n";
  for (const ro of ROUTES_TO_AA) {
    const counts = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    const m = {};
    counts.forEach((c) => { m[c._id] = c.n; });
    const total = await routeWeight(ro.id);
    txt += `${ro.emoji} ${ro.label}\ná ˆá‰ƒá‹µ: ${m.approved || 0} | á á‰°áˆ»: ${m.reviewing || 0} | á‹«áˆ áŠ¨á ˆáˆˆ: ${m.pending || 0} | á‰°áˆ áŠ³áˆ : ${m.sent || 0} | ${total}/${ro.targetKg} áŠªáˆŽ\n\n`;
  }
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

/* â”€â”€ Collector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
bot.action("col_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "áŠ á‰…áŒ£áŒ« áˆ áˆ¨áŒ¥:",
    Markup.inlineKeyboard([
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ", "col_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", "col_dir_toaa")],
    ]),
  );
});
bot.action("col_dir_all", async(ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ :", Markup.inlineKeyboard(ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])));
});
bot.action("col_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£:", Markup.inlineKeyboard(ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `col_${r.id}`)])));
});
bot.action(/^col_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "COL_LOC", colRoute: ctx.match[1] };
  await ctx.reply("á‹«áˆ‰á‰ á‰µáŠ• á‰¦á‰³ á‹«áŒ‹áˆ©:", locKb());
});

/* â”€â”€ Print â”€â
bot.action("print_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    "áŠ á‰…áŒ£áŒ« áˆ áˆ¨áŒ¥:",
    Markup.inlineKeyboard([
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ ", "prnt_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£", "prnt_dir_toaa")],
    ]),
  );
});
bot.action("prnt_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ â€” áˆ˜áˆµáˆ˜áˆ áˆ áˆ áˆ¨áŒ¥:", Markup.inlineKeyboard(ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])));
});
bot.action("prnt_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ â€” áˆ˜áˆµáˆ˜áˆ áˆ áˆ¨áŒ¥:", Markup.inlineKeyboard(ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `prnt_${r.id}`)])));
});
bot.action(/^prnt_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await handlePrint(ctx, ctx.match[1]);
});

/* â”€â”€ Channel â”€â
bot.action("channel_panel", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    `á‰»áŠ“áˆ : ${CHANNEL_ID || "áŠ áˆ á‰°á‰€áˆ˜áŒ áˆ "}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("áá‰°áˆ» áˆ‹áŠ­", "ch_test")],
      [Markup.button.callback("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "ch_dir_toamhara")],
      [Markup.button.callback("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£ áˆ›áˆµá‰³á‹ˆá‰‚á‹«", "ch_dir_toaa")],
    ]),
  );
});
bot.action("ch_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ :", Markup.inlineKeyboard(ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`)])));
});
bot.action("ch_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£:", Markup.inlineKeyboard(ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `ch_ann_${r.id}`))));
});
bot.action("ch_test", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID áŠ áˆá‰°á‰€áˆ˜áŒ áˆ");
  try {
    await bot.telegram.sendMessage(CHANNEL_ID, "á á‰°áˆ» á‰°áˆ³áŠá‰·áˆ ");
    await ctx.reply("á‰°áˆ³áŠ­á‰·áˆ");
  } catch (e) {
    await ctx.reply(`áŠ áˆ á‰°áˆ³áŠ«áˆ : ${e.message}`);
  }
});
bot.action(/^ch_ann_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("á ˆá‰ƒá‹µ á‹¨áˆˆá‹Žá‰µáˆ ").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  if (!CHANNEL_ID) return ctx.reply("CHANNEL_ID áŠ áˆá‰°á‰€áˆ˜áŒ áˆ");
  const ro = byRoute(ctx.match[1]);
  if (!ro) return;
  const total = await routeWeight(ro.id);
  try {
    await bot.telegram.sendMessage(
      CHANNEL_ID,
      `${ro.emoji} *${ro.label}*\n${capLine(total, ro.targetKg)}\n\ná‰€áŒ¥á‰³ áŠ¨ áŒˆá‰ áˆ¬á‹Žá‰½ â€” áˆáŠ«áˆ½ áŠ¥áŠ“ á ˆáŒ£áŠ•!\n${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    );
    await ctx.reply(`á‰°áˆáŠ³áˆ â€” ${ro.label}`);
  } catch (e) {
    await ctx.reply(`áŠ áˆ á‰°áˆ³áŠ«áˆ : ${e.message}`);
  }
});

/* â”€â”€ Admin commands â”€â
bot.command("report_now", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  await sendDailyReport();
  await ctx.reply("áˆªá –áˆá‰µ á‰°áˆ áŠ³áˆ ");
});

bot.command("stats", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const now = new Date(),
    date = now.toLocaleDateString("en-GB") + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  let toAmKg = 0, toAmPeople = 0, toAmRev = 0, toAAKg = 0, toAAPeople = 0, toAArev = 0;
  let txt = `*Quick Stats* â€” ${date}\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n*áŠ á‹²áˆµ áŠ á‰ á‰£ â†' áŠ áˆ›áˆ« áŠáˆ áˆ *\n`;
  for (const ro of ROUTES_TO_AMHARA) {
    const agg = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } }]);
    const m = {};
    agg.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0),
      kg = ["pending", "reviewing", "approved", "sent"].reduce((s, st) => s + (m[st]?.kg || 0), 0),
      rev = kg * SHIP_PER_KG;
    toAmharaKg += kg; toAmharaPeople += people; toAmharaRev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _áˆá‹áŒˆá‰£ á‹¨áˆˆáˆ_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n ${people} | ${kg}áŠa | á ˆá‰ƒá‹μ: ${m.approved?.n || 0} | á á‰°áˆ»: ${m.reviewing?.n || 0} | á‹«áˆ áŠ ̈á ˆáˆˆ: ${m.pending?.n || 0} | á‰°áˆ áŠ3áˆ : ${m.sent?.n || 0}\n áŒ. field field‹«: ${rev.toLocaleString()} field\n`;
  }
  txt += `\n*áŠ áˆ›áˆ« áŠáˆ áˆ â†' áŠ á‹²áˆµ áŠ á‰ á‰£*\n`;
  for (const ro of ROUTES_TO_AA) {
    const agg = await Reg.aggregate([{ $match: { routeId: ro.id } }, { $group: { _id: "$status", n: { $sum: 1 }, kg: { $sum: "$weightKg" } } }]);
    const m = {};
    agg.forEach((c) => { m[c._id] = { n: c.n, kg: c.kg }; });
    const people = agg.reduce((s, c) => s + c.n, 0),
      kg = ["pending", "reviewing", "approved", "sent"].reduce((s, st) => s + (m[st]?.kg || 0), 0),
      rev = kg * SHIP_PER_KG;
    toAAKg += kg; toAAPeople += people; toAArev += rev;
    if (!people) { txt += `${ro.emoji} ${ro.label}: _áˆá‹áŒˆá‰£ á‹¨áˆˆáˆ_\n`; continue; }
    txt += `${ro.emoji} ${ro.label}\n ${people} | ${kg}áŠa | á ˆá‰ƒá‹μ: ${m.approved?.n || 0} | á á‰°áˆ»: ${m.reviewing?.n || 0} | á‹«áˆ áŠ ̈á ˆáˆˆ: ${m.pending?.n || 0} | á‰°áˆ áŠ3áˆ : ${m.sent?.n || 0}\n áŒ. field field‹«: ${rev.toLocaleString()} field\n`;
  }
  const gP = toAmharaPeople + toAAPeople , gK = toAmharaKg + toAAKg , gR = toAmharaRev + toAArev , gReg = gK * REG_PER_KG ;
  txt += `\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n*áŒ á‰…áˆ‹áˆ‹ á‹µáˆ áˆ*\n${gP} áˆ°á‹ | ${gK} áŠªáˆŽ\náˆ á‹ : ${gReg.toLocaleString()} á‰¥ | áŒ: ${gR.toLocaleString()} á‰¥ | á‹µáˆ áˆ: ${(gReg + gR).toLocaleString()} á‰¥`;
  await ctx.reply(txt, { parse_mode: "Markdown" });
});

bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const text = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!text) return ctx.reply("áŠ áŒ á‰ƒá‰€áˆ : /broadcast áˆ˜áˆ á‹•áŠá‰µ");
  const users = await Reg.distinct("userId", { status: { $nin: ["rejected"] } });
  let sent = 0, failed = 0;
  for (const uid of users) {
    try { await bot.telegram.sendMessage(uid, `${text}\n\n${SUPPORT_PHONE}`, { parse_mode: "Markdown" }); sent++; }
    catch { failed++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  await ctx.reply(`á‰°áˆáŠ³áˆ: ${sent} | áŠ áˆá‹°áˆ¨áˆ³á‰¸á‹áˆ: ${failed}`);
});

bot.command("prices", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const lines = GB_PRODUCTS.map((p) => {
    const ul = p.unit === "liter" ? "áˆŠá‰µáˆ" : "áŠªáˆŽ";
    return `${p.emoji} *${p.label}* (${p.id}) â€” ${p.pricePerKg} price/${ul}`;
  }).join("\n");
  await ctx.reply(
    `*áŠ áˆ áŠ“á‹Š á‹‹áŒ‹á‹Žá‰½*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n${lines}\n\n` +
      `á‹‹áŒ‹ áˆˆáˆ˜á‰€á‹¨áˆ:\n\`/setprice <id> <á‹‹áŒ‹>\`\n\náˆ áˆ³áˆŒ: \`/setprice teff 80\``,
    { parse_mode: "Markdown" },
  );
});

bot.command("setprice", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `*áŠ áŒ á‰ƒá‰€áˆ :* \`/setprice <id> <á‹‹áŒ‹>\`\n\n*áˆ áˆ³áˆŒ:*\n` +
        GB_PRODUCTS.map((p) => `\`/setprice ${p.id} ${p.pricePerKg}\``).join("\n"),
      { parse_mode: "Markdown" },
    );
  }
  const id = parts[1].toLowerCase();
  const price = parseFloat(parts[2]);
  const prod = byProduct(id);
  if (!prod)
    return ctx.reply(
      `â Œ áˆ áˆá‰µ áŠ áˆ á‰°áŒˆáŠ˜áˆ : *${id}*\n\ná‰µáŠáŠáˆˆáŠ› IDs: ${GB_PRODUCTS.map((p) => `\`${p.id}\``).join(", ")}`,
      { parse_mode: "Markdown" },
    );
  if (!price || price <= 0 || price > 100000) return ctx.reply("âŒ á‰µáŠ­áŠ­áˆˆáŠ› á‹‹áŒ‹ á‹«áˆµáŒˆá‰¡ (áˆˆáˆáˆ³áˆŒ: 80)");
  const oldPrice = product.pricePerKg;
  product.pricePerKg = price;
  await setSetting(`price_${id}`, price);
  const ul = prod.unit === "liter" ? "áˆŠá‰µáˆ" : "áŠªáˆŽ";
  await ctx.reply(
    `âœ… *á‹‹áŒ‹ á‰°á‰€á‹áˆ¯áˆ !*\n\n${prod.emoji} *${prod.label}*\ná‰€á‹µáˆž: ${oldPrice} á‰¥áˆ/${ul}\náŠ áˆ áŠ•: *${price} á‰¥áˆ/${ul}*`,
    { parse_mode: "Markdown" },
  );
  for (const aid of ADMIN_IDS) {
    if (aid === ctx.from.id) continue;
    bot.telegram.sendMessage(
      aid,
      `${prod.emoji} *${prod.label}* á‹‹áŒ‹ á‰°á‰€á‹­áˆ¯áˆ\n${oldPrice} â†’ *${price}* á‰¥áˆ­/${ul}\ná‰  @${ctx.from.username || ctx.from.first_name}`,
      { parse_mode: "Markdown" },
    ).catch(() => {});
  }
});

bot.command("exportgb", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const parts = ctx.message.text.trim().split(/\s+/);
  const filterProd = parts[1]?.toLowerCase() || "all";
  const query = filterProd === "all" ? {} : { productId: filterProd };
  const records = await GBReg.find(query).sort({ createdAt: 1 }).lean();
  if (!records.length) {
    return ctx.reply(
      filterProd === "all" ? "GB áˆ á‹ áŒˆá‰£ á‹¨áˆˆáˆ " : `â Œ áˆ áˆá‰µ áŠ áˆ á‰°áŒˆáŠ˜áˆ á‹ˆá‹áˆ áˆ á‹ áŒˆá‰£ á‹¨áˆˆáˆ : *${filterProd}*`,
      { parse_mode: "Markdown" },
    );
  }
  const header = "á‰°.á‰ ,áˆ áˆá‰µ,áˆ™áˆ‰ áˆµáˆ ,áˆµáˆ áŠ,áŠªáˆŽ/áˆŠá‰µáˆ,á‹‹áŒ‹/áŠªáˆŽ,áŒ á‰…áˆ‹áˆ‹ á‹‹áŒ‹ (á‰¥áˆ),á‰€áŠ•";
  const rows = records.map((r, i) => {
    const prod = byProduct(r.productId);
    const date = new Date(r.createdAt).toLocaleDateString("en-GB");
    return [i + 1, `${prod?.emoji || ""} ${prod?.label || r.productId}`, (r.fullName || "").replace(/,/g, " "), r.phone || "", r.weightKg, r.pricePerKg, r.totalCost, date].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const buf = Buffer.from("\uFEFF" + csv, "utf-8");
  const prodLabel = filterProd === "all" ? "áˆáˆ‰áˆ" : byProduct(filterProd)?.label || filterProd;
  const fname = `GB_${filterProd}_${new Date().toISOString().slice(0, 10)}.csv`;
  await ctx.replyWithDocument(
    { source: buf, filename: fname },
    {
      caption:
        `ðŸ“Š *GB áˆ á‹ áŒˆá‰£ â€” ${prodLabel}*\n` +
        `áŒ á‰…áˆ‹áˆ‹: ${records.length} áˆ°á‹ \n` +
        `áŒ á‰…áˆ‹áˆ‹ áŠªáˆŽ: ${records.reduce((s, r) => s + (r.weightKg || 0), 0)}\n` +
        `áŒ á‰…áˆ‹áˆ‹ á‹‹áŒ‹: ${records.reduce((s, r) => s + (r.totalCost || 0), 0).toLocaleString()} á‰¥áˆ`,
      parse_mode: "Markdown",
    },
  );
});

bot.command("backup", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const adminId = ctx.from.id;
  const today = new Date().toISOString().slice(0, 10);
  await ctx.reply("â ³ Backup áŠ¥á‹¨á‰°á‹˜áŒ‹áŒ€ áŠ á‹ â€” á‰µáŠ•áˆ½ á‹áŒ á‰¥á‰ ...");
  const gbRecords = await GBReg.find({}).sort({ createdAt: 1 }).lean();
  if (gbRecords.length) {
    const header = "á‰°.á‰ ,áˆ áˆá‰µ,áˆ™áˆ‰ áˆµáˆ ,áˆµáˆ áŠ,áŠªáˆŽ/áˆŠá‰µáˆ,á‹‹áŒ‹/áŠªáˆŽ,áŒ á‰…áˆ‹áˆ‹ á‹‹áŒ‹ (á‰¥áˆ),á‰€áŠ•";
    const rows = gbRecords.map((r, i) => {
      const prod = byProduct(r.productId);
      const date = new Date(r.createdAt).toLocaleDateString("en-GB");
      return [i + 1, prod?.label || r.productId, (r.fullName || "").replace(/,/g, " "), r.phone || "", r.weightKg, r.pricePerKg, r.totalCost, date].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const buf = Buffer.from("\uFEFF" + csv, "utf-8");
    await bot.telegram.sendDocument(
      adminId,
      { source: buf, filename: `backup_GB_${today}.csv` },
      {
        caption:
          `ðŸ“¦ *GB áˆ á‹ áŒˆá‰¦á‰½ â€” Backup*\n` +
          `áŒ á‰…áˆ‹áˆ‹: ${gbRecords.length} áˆ°á‹ \n` +
          `áŒ á‰…áˆ‹áˆ‹ áŠªáˆŽ: ${gbRecords.reduce((s, r) => s + (r.weightKg || 0), 0)}\n` +
          `${today}`,
        parse_mode: "Markdown",
      },
    ).catch(() => {});
  }
  const cargoRecords = await Reg.find({}).sort({ createdAt: 1 }).lean();
  if (cargoRecords.length) {
    const header2 = "á‰°.á‰ ,áŠ á‰…áŒ£áŒ«,áˆ™áˆ‰ áˆµáˆ ,áˆµáˆ áŠ,áŒáŠ á‰µ,áŠªáˆŽ,áŠá á‹« (á‰¥áˆ),áˆ áŠ”á‰³,á‰€áŠ•";
    const rows2 = cargoRecords.map((r, i) => {
      const ro = byRoute(r.routeId);
      const date = new Date(r.createdAt).toLocaleDateString("en-GB");
      return [i + 1, ro?.label || r.routeId, (r.fullName || "").replace(/,/g, " "), r.phone || "", (r.cargoDesc || "").replace(/,/g, " "), r.weightKg, r.totalPrice, ST[r.status] || r.status, date].join(",");
    });
    const csv2 = [header2, ...rows2].join("\n");
    const buf2 = Buffer.from("\uFEFF" + csv2, "utf-8");
    await bot.telegram.sendDocument(
      adminId,
      { source: buf2, filename: `backup_Cargo_${today}.csv` },
      {
        caption:
          `ðŸšš *Cargo áˆ á‹ áŒˆá‰¦á‰½ â€” Backup*\n` +
          `áŒ á‰…áˆ‹áˆ‹: ${cargoRecords.length} áˆ°á‹ \n` +
          `áŒ á‰…áˆ‹áˆ‹ áŠªáˆŽ: ${cargoRecords.reduce((s, r) => s + (r.weightKg || 0), 0)}\n` +
          `${today}`,
        parse_mode: "Markdown",
      },
    ).catch(() => {});
  }
  const total = gbRecords.length + cargoRecords.length;
  await ctx.reply(
    total === 0
      ? "âš ï¸ áˆ á‹ áŒˆá‰£ á‹¨áˆˆáˆ â€” Backup áˆ áŠ•áˆ áŠ áˆ á‰°áˆ‹áŠ¨áˆ "
      : `âœ… *Backup á‰°áŒ áŠ“á‰€á‰€!*\nðŸ“¦ GB: ${gbRecords.length} áˆ°á‹ \nðŸšš Cargo: ${cargoRecords.length} áˆ°á‹ on Telegram on ¢`,
    { parse_mode: "Markdown" },
  );
});

bot.command("fees", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  await ctx.reply(
    `*áŠ áˆ áŠ“á‹Š áŠá á‹«á‹Žá‰½*\nâ” â” â” â” â” â” â” â” â” â” â” â” â” â” â” â” \n\n` +
      `ðŸ“‹ *á‹¨áˆ á‹ áŒˆá‰£ (áŠ áŒˆáˆ áŒ áˆŽá‰µ) áŠá á‹«:* ${REG_PER_KG} á‰¥áˆ/áŠªáˆŽ\n` +
      `ðŸšš *á‹¨á‰µáˆ«áŠ•áˆµá –áˆá‰µ áŠá á‹«:* ${SHIP_PER_KG} á‰¥áˆ/áŠaáˆŽ\n\n` +
      `áŠá á‹« áˆˆáˆ˜á‰€á‹¨áˆ:\n` +
      `\`/setfee reg <á‹‹áŒ‹>\` â€” á‹¨áˆ á‹ áŒˆá‰£ áŠá á‹«\n` +
      `\`/setfee ship <á‹‹áŒ‹>\` â€” á‹¨á‰µáˆ«áŠ•áˆµá –áˆá‰µ áŠá á‹«\n\n` +
      `áˆ áˆ³áˆŒ: \`/setfee reg 12\``,
    { parse_mode: "Markdown" },
  );
});

bot.command("setfee", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Please send me a message ");
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply(
      `*áŠ áŒ á‰ƒá‰€áˆ:*\n` +
        `\`/setfee reg <á‹‹áŒ‹>\` â€” setfee á‹ áŒˆá‰£ (áŠ áŒˆáˆ áŒ áˆŽá‰μ) áŠá á‹«\n` +
        `\`/setfee ship <á‹‹áŒ‹>\` â€” á‹¨á‰µáˆ«áŠ•áˆµá –áˆá‰µ áŠá á‹«\n\n` +
        `áˆáˆ³áˆŒ: \`/setfee reg 12\`\náˆáˆ³áˆŒ: \`/setfee ship 30\``,
      { parse_mode: "Markdown" },
    );
  }
  const type = parts[1].toLowerCase();
  const price = parseFloat(parts[2]);
  if (!["reg", "ship"].includes(type))
    return ctx.reply(`â Œ á‹“á‹áŠ á‰µ áˆµáˆ…á‰°á‰µá ¢ \`reg\` á‹ˆá‹áˆ \`ship\` á‹«áˆµáŒˆá‰¡`, { parse_mode: "Markdown" });
  if (!price || price <= 0 || price > 100000)
    return ctx.reply("â Œ á‰µáŠáŠáˆˆáŠ› á‹‹áŒ‹ á‹«áˆµáŒˆá‰¡ (áˆˆáˆ áˆ³áˆŒ: 12)");
  if (type === "reg") {
    const old = REG_PER_KG;
    REG_PER_KG = price;
    await setSetting("fee_reg_per_kg", price);
    await ctx.reply(`âœ… *á‹¨áˆ á‹ áŒˆá‰£ áŠá á‹« á‰°á‰€á‹áˆ¯áˆ !*\n\ná‰€á‹µáˆž: ${old} á‰¥áˆ/áŠªáˆŽ\náŠ áˆ áŠ•: *${price} á‰¥áˆ/áŠªáˆŽ*`, { parse_mode: "Markdown" });
    for (const aid of ADMIN_IDS) {
      if (aid === ctx.from.id) continue;
      bot.telegram.sendMessage(aid, `ðŸ“‹ á‹¨áˆá‹áŒˆá‰£ áŠ­áá‹« á‰°á‰€á‹­áˆ¯áˆ\n${old} â†’ *${price}* á‰¥áˆ­/áŠªáˆŽ\ná‰  @${ctx.from.username || ctx.from.first_name}`, { parse_mode: "Markdown" }).catch(() => {});
    }
  } else {
    const old = SHIP_PER_KG;
    SHIP_PER_KG = price;
    await setSetting("fee_ship_per_kg", price);
    await ctx.reply(`âœ… *á‹¨á‰µáˆ«áŠ•áˆµá –áˆá‰µ áŠá á‹« á‰°á‰€á‹áˆ¯áˆ !*\n\ná‰€á‹µáˆž: ${old} á‰¥áˆ/áŠªáˆŽ\náŠ áˆ áŠ•: *${price} á‰¥áˆ/áŠªáˆŽ*`, { parse_mode: "Markdown" });
    for (const aid of ADMIN_IDS) {
      if (aid === ctx.from.id) continue;
      bot.telegram.sendMessage(aid, `ðŸšš á‹¨á‰µáˆ«áŠ•áˆµá –áˆá‰µ áŠá á‹« á‰°á‰€á‹áˆ{¯áˆ \n${old} *$ â†}'*price* á‰¥áˆ/áŠªáˆŽ\ná‰ @${ctx.from.username || ctx.from.first_name}`, { parse_mode: "Markdown" }).catch(() => {});
    }
  }
});

/* â”€â”€â”€ 23. LAUNCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PORT = Number(process.env.PORT) || 3000;

function notifyAdmins(msg) {
  for (const aid of ADMIN_IDS) bot.telegram.sendMessage(aid, msg).catch(() => {});
}

async function connectMongo() {
  const opts = { maxPoolSize: 20, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 };
  await mongoose.connect(MONGO_URI, opts);
  console.log("MongoDB connected");
  mongoose.connection.on("disconnected", () => {
    console.warn("MongoDB disconnected â€” áŠ¥áŠ•á‹°áŒˆáŠ“ áˆˆáˆ˜á‹«á‹«á‹ á‹áˆžáŠáˆ«áˆ ...");
    notifyAdmins("Database is not available for this account...");
    setTimeout(() => { mongoose.connect(MONGO_URI, opts).catch((e) => console.error("MongoDB reconnect failed:", e.message)); }, 5000);
  });
  mongoose.connection.on("reconnected", () => { console.log("MongoDB reconnected"); notifyAdmins("âœ… Database áŠ¥áŠ•á‹°áŒˆáŠ“ á‰°á‹«á‹«á‹˜"); });
  mongoose.connection.on("error", (e) => { console.error("MongoDB error:", e.message); });
}

async function main() {
  await connectMongo();
  await loadPricesFromDB();
  console.log("Prices loaded from DB");

  const server = http.createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("OK"); });
  await new Promise((resolve) => server.listen(PORT, () => { console.log("Port", PORT); resolve(); }));

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("Webhook deleted");
  } catch (e) {
    console.warn("deleteWebhook:", e.message);
  }

  const RURL = (process.env.RENDER_EXTERNAL_URL || "").trim();
  if (RURL) {
    const https = require("https");
    setInterval(() => https.get(`${RURL}/`).on("error", () => {}), 14 * 60 * 1000);
  }

  startDailyReportScheduler();

  bot.launch({ allowedUpdates: ["message", "callback_query", "channel_post"] }).catch((e) => {
    console.error("bot.launch error:", e.message);
  });

  console.log("Bot started â€” 24/7 active");
  notifyAdmins(`âœ... Bot á‰°áŒ€áˆ áˆ¯áˆ â€” ${new Date().toLocaleString("en-GB")}\n24/7 active`);

  process.once("SIGINT", () => { bot.stop("SIGINT"); server.close(); });
  process.once("SIGTERM", () => { bot.stop("SIGTERM"); server.close(); });
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message, err.stack);
  notifyAdmins(`ðŸš¨ Bot crash (uncaughtException):\n${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled Rejection:", msg);
  notifyAdmins(`ðŸš¨ Bot error (unhandledRejection):\n${msg}`);
});

main().catch((e) => {
  console.error("Fatal startup error:", e.message);
  setTimeout(() => main().catch(() => process.exit(1)), 10_000);
});
