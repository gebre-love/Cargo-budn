/**
 * Ethiopian Cargo & Group-Buy Telegram Bot
 * ==========================================
 * Required env vars:
 *   BOT_TOKEN  — Telegram bot token from @BotFather
 *   MONGO_URI  — MongoDB connection string
 *   ADMIN_IDS  — comma-separated admin Telegram user IDs  e.g. "111,222"
 *
 * Install: npm install telegraf mongoose
 * Run:     node bot.js
 */

"use strict";

const { Telegraf, Markup, session } = require("telegraf");
const mongoose = require("mongoose");

/* ─────────────────────────────────────────────────
   ENV
───────────────────────────────────────────────── */
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI  = process.env.MONGO_URI;
const ADMIN_IDS  = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(s => parseInt(s.trim()))
  .filter(Boolean);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env var is required");
if (!MONGO_URI)  throw new Error("MONGO_URI env var is required");

/* ─────────────────────────────────────────────────
   MONGOOSE MODELS
───────────────────────────────────────────────── */
const Reg = mongoose.models.Reg || mongoose.model("Reg", new mongoose.Schema({
  userId:         { type: Number, required: true },
  username:       { type: String, default: "" },
  fullName:       String,
  phone:          String,
  neighborhood:   { type: String, default: "" },
  routeId:        String,
  cargoDesc:      String,
  weightKg:       { type: Number, default: 0 },
  totalPrice:     { type: Number, default: 0 },
  paymentMethod:  { type: String, default: null },
  paymentFileId:  { type: String, default: null },
  status:         { type: String, default: "pending", enum: ["pending","reviewing","approved"] },
  autoApproved:   { type: Boolean, default: false },
  createdAt:      { type: Date, default: Date.now },
}));

const GBReg = mongoose.models.GBReg || mongoose.model("GBReg", new mongoose.Schema({
  userId:         { type: Number, required: true },
  username:       { type: String, default: "" },
  productId:      { type: String, required: true },
  fullName:       String,
  phone:          String,
  neighborhood:   { type: String, default: "" },
  weightKg:       { type: Number, default: 0 },
  totalCost:      { type: Number, default: 0 },
  pricePerKg:     { type: Number, default: 0 },
  paymentFileId:  { type: String, default: null },
  paymentStatus:  { type: String, default: "pending", enum: ["pending","reviewing","approved"] },
  createdAt:      { type: Date, default: Date.now },
}));

const BotSettings = mongoose.models.BotSettings || mongoose.model("BotSettings", new mongoose.Schema({
  key:   { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
}));

const CustomProduct = mongoose.models.CustomProduct || mongoose.model("CustomProduct", new mongoose.Schema({
  id:         { type: String, unique: true, required: true },
  emoji:      { type: String, default: "📦" },
  label:      { type: String, required: true },
  unit:       { type: String, default: "kg" },
  targetKg:   { type: Number, default: 2000 },
  pricePerKg: { type: Number, default: 0 },
  enabled:    { type: Boolean, default: true },
  createdAt:  { type: Date, default: Date.now },
}));

const AdminRoute = mongoose.models.AdminRoute || mongoose.model("AdminRoute", new mongoose.Schema({
  id:        { type: String, unique: true, required: true },
  emoji:     { type: String, default: "🟢" },
  label:     { type: String, required: true },
  direction: { type: String, required: true, enum: ["toAmhara","toAA"] },
  targetKg:  { type: Number, default: 5000 },
  createdAt: { type: Date, default: Date.now },
}));

const AdminPayment = mongoose.models.AdminPaymentMethod || mongoose.model("AdminPaymentMethod", new mongoose.Schema({
  id:        { type: String, unique: true, required: true },
  emoji:     { type: String, default: "💳" },
  label:     { type: String, required: true },
  info:      { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
}));

/* ─────────────────────────────────────────────────
   DEFAULT SEED DATA
───────────────────────────────────────────────── */
const DEFAULT_ROUTES = [
  { id: "aa_finotselam",   emoji: "🟢", label: "አዲስ አበባ → ፍኖተሰላም",   direction: "toAmhara", targetKg: 5000 },
  { id: "aa_debre_markos", emoji: "🔵", label: "አዲስ አበባ → ደብረ ማርቆስ", direction: "toAmhara", targetKg: 5000 },
  { id: "aa_mota",         emoji: "🟤", label: "አዲስ አበባ → ሞጣ",         direction: "toAmhara", targetKg: 5000 },
  { id: "aa_bahirdar",     emoji: "🔵", label: "አዲስ አበባ → ባህር ዳር",     direction: "toAmhara", targetKg: 5000 },
  { id: "aa_gondar",       emoji: "🟣", label: "አዲስ አበባ → ጎንደር",       direction: "toAmhara", targetKg: 5000 },
  { id: "aa_debre_berhan", emoji: "🟡", label: "አዲስ አበባ → ደብረ ብርሃን",  direction: "toAmhara", targetKg: 5000 },
  { id: "aa_kemissie",     emoji: "🟠", label: "አዲስ አበባ → ከሚሴ",       direction: "toAmhara", targetKg: 5000 },
  { id: "aa_dessie",       emoji: "🔴", label: "አዲስ አበባ → ደሴ",         direction: "toAmhara", targetKg: 5000 },
  { id: "finotselam_aa",   emoji: "🟢", label: "ፍኖተሰላም → አዲስ አበባ",   direction: "toAA", targetKg: 5000 },
  { id: "debre_markos_aa", emoji: "🔵", label: "ደብረ ማርቆስ → አዲስ አበባ", direction: "toAA", targetKg: 5000 },
  { id: "mota_aa",         emoji: "🟤", label: "ሞጣ → አዲስ አበባ",         direction: "toAA", targetKg: 5000 },
  { id: "bahirdar_aa",     emoji: "🔵", label: "ባህር ዳር → አዲስ አበባ",     direction: "toAA", targetKg: 5000 },
  { id: "gondar_aa",       emoji: "🟣", label: "ጎንደር → አዲስ አበባ",       direction: "toAA", targetKg: 5000 },
  { id: "debre_berhan_aa", emoji: "🟡", label: "ደብረ ብርሃን → አዲስ አበባ",  direction: "toAA", targetKg: 5000 },
  { id: "kemissie_aa",     emoji: "🟠", label: "ከሚሴ → አዲስ አበባ",       direction: "toAA", targetKg: 5000 },
  { id: "dessie_aa",       emoji: "🔴", label: "ደሴ → አዲስ አበባ",         direction: "toAA", targetKg: 5000 },
];

const DEFAULT_PAYMENTS = [
  { id: "telebirr", emoji: "📱", label: "ቴሌብር",   info: "Telebirr: 0960336138\nስም: አቤ ከበደ" },
  { id: "cbe",      emoji: "🏦", label: "CBE ባንክ", info: "CBE: 1000370308447\nስም: አቤ ከበደ" },
];

const STATIC_PRODUCTS = [
  { id: "teff",   emoji: "🌾", label: "ጤፍ",    unit: "kg",    targetKg: 5000, pricePerKg: 75  },
  { id: "oil",    emoji: "🛢",  label: "ዘይት",   unit: "liter", targetKg: 3000, pricePerKg: 120 },
  { id: "sugar",  emoji: "🍚", label: "ስኳር",   unit: "kg",    targetKg: 3000, pricePerKg: 55  },
  { id: "flour",  emoji: "🌽", label: "ዱቄት",   unit: "kg",    targetKg: 3000, pricePerKg: 60  },
  { id: "onion",  emoji: "🧅", label: "ሽንኩርት", unit: "kg",    targetKg: 2000, pricePerKg: 30  },
  { id: "potato", emoji: "🥔", label: "ድንች",   unit: "kg",    targetKg: 2000, pricePerKg: 15  },
];

const STATIC_MENU = [
  { key: "menu_cargo_toamhara", emoji: "🔼", label: "አዲስ አበባ → አማራ ክልል (ጭነት)" },
  { key: "menu_cargo_toaa",    emoji: "🔽", label: "አማራ ክልል → አዲስ አበባ (ጭነት)" },
  { key: "menu_my_regs",       emoji: "📋", label: "የምዝገባ ዝርዝሬ" },
  { key: "menu_counter",       emoji: "📊", label: "የጭነት ቆጣሪ" },
  ...STATIC_PRODUCTS.map(p => ({ key: `menu_product_${p.id}`, emoji: p.emoji, label: p.label })),
];

/* ─────────────────────────────────────────────────
   DB HELPERS
───────────────────────────────────────────────── */
async function getSetting(key, def) {
  const doc = await BotSettings.findOne({ key }).lean();
  return doc ? doc.value : def;
}
async function setSetting(key, value) {
  await BotSettings.findOneAndUpdate({ key }, { value }, { upsert: true });
}
async function getSettings() {
  return {
    regPerKg:      await getSetting("fee_reg_per_kg",  5),
    shipPerKg:     await getSetting("fee_ship_per_kg", 25),
    supportPhone:  await getSetting("support_phone",   "0960336138"),
    channelId:     await getSetting("channel_id",      ""),
    memberChannel: await getSetting("member_channel",  ""),
  };
}
async function seedIfEmpty() {
  const rc = await AdminRoute.countDocuments();
  if (rc === 0) await AdminRoute.insertMany(DEFAULT_ROUTES);
  const pc = await AdminPayment.countDocuments();
  if (pc === 0) await AdminPayment.insertMany(DEFAULT_PAYMENTS);
}
async function getAllProducts() {
  const statics = await Promise.all(STATIC_PRODUCTS.map(async p => ({
    ...p,
    pricePerKg: (await getSetting(`price_${p.id}`, null)) ?? p.pricePerKg,
    targetKg:   (await getSetting(`target_${p.id}`, null)) ?? p.targetKg,
    isCustom: false,
  })));
  const customs = await CustomProduct.find({ enabled: true }).sort({ createdAt: 1 }).lean();
  return [...statics, ...customs.map(c => ({ ...c, isCustom: true }))];
}
async function getRoutes() {
  return AdminRoute.find().sort({ createdAt: 1 }).lean();
}
async function getPayments() {
  return AdminPayment.find().sort({ createdAt: 1 }).lean();
}
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}
function makeId(label) {
  return label.toLowerCase().replace(/[^a-z0-9\u1200-\u137F]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) + "_" + Date.now();
}
function progressBar(cur, target) {
  const pct = Math.min(100, Math.round((cur / target) * 100));
  const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
  return { pct, bar };
}

/* ─────────────────────────────────────────────────
   MAIN MENU KEYBOARD
───────────────────────────────────────────────── */
async function mainMenu() {
  const buttons = [];
  if (await getSetting("menu_cargo_toamhara", true)) buttons.push(["🔼 አዲስ አበባ → አማራ ክልል (ጭነት)"]);
  if (await getSetting("menu_cargo_toaa", true))     buttons.push(["🔽 አማራ ክልል → አዲስ አበባ (ጭነት)"]);

  const products = await getAllProducts();
  const pbts = [];
  for (const p of products) {
    if (await getSetting(`menu_product_${p.id}`, true)) pbts.push(`${p.emoji} ${p.label}`);
  }
  for (let i = 0; i < pbts.length; i += 2) {
    buttons.push(pbts[i + 1] ? [pbts[i], pbts[i + 1]] : [pbts[i]]);
  }

  if (await getSetting("menu_my_regs", true))  buttons.push(["📋 የምዝገባ ዝርዝሬ"]);
  if (await getSetting("menu_counter", true))  buttons.push(["📊 የጭነት ቆጣሪ"]);
  buttons.push(["📞 ድጋፍ"]);
  return Markup.keyboard(buttons).resize();
}

/* ─────────────────────────────────────────────────
   BOT
───────────────────────────────────────────────── */
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({ defaultSession: () => ({ step: null, data: {} }) }));

/* /start */
bot.start(async ctx => {
  const menu = await mainMenu();
  await ctx.reply(
    `ሰላም ${ctx.from.first_name || "ተጠቃሚ"}! 👋\nወደ *አብርነ ንጓዝ ካርጎ* እንኳን ደህና መጡ! 🚚\n\nከዝርዝሩ ይምረጡ:`,
    { parse_mode: "Markdown", ...menu }
  );
});

/* /cancel */
bot.command("cancel", async ctx => {
  ctx.session.step = null;
  ctx.session.data = {};
  await ctx.reply("ተሰርዟል ✅", await mainMenu());
});

/* ══════════════════════════════════════════════════════
   ████  ADMIN PANEL — Telegram commands  ████
══════════════════════════════════════════════════════ */

/* /admin  — admin main menu */
bot.command("admin", async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Admin ብቻ ይጠቀማሉ።");
  await ctx.reply(
    "⚙️ *Admin Panel*\n\nምን ማስተካከል ይፈልጋሉ?",
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🛣️ Routes", "admin:routes"), Markup.button.callback("📦 Products", "admin:products")],
        [Markup.button.callback("💳 Payments", "admin:payments"), Markup.button.callback("⚙️ Settings", "admin:settings")],
        [Markup.button.callback("📋 Menu Visibility", "admin:menu"), Markup.button.callback("📊 Stats", "admin:stats")],
      ])
    }
  );
});

/* ─────────────────────────────────────────────────
   ROUTES ADMIN
───────────────────────────────────────────────── */
bot.action("admin:routes", async ctx => {
  await ctx.answerCbQuery();
  const routes = await getRoutes();
  if (routes.length === 0) {
    return ctx.editMessageText("ምንም route የለም።", {
      ...Markup.inlineKeyboard([[Markup.button.callback("➕ Route ጨምር", "admin:route:add")]])
    });
  }
  const btns = routes.map(r => [
    Markup.button.callback(`${r.emoji} ${r.label}`, `admin:route:edit:${r.id}`),
  ]);
  btns.push([Markup.button.callback("➕ Route ጨምር", "admin:route:add"), Markup.button.callback("🔙 ተመለስ", "admin:back")]);
  await ctx.editMessageText("🛣️ *Routes* — ለማስተካከል ይምረጡ:", { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

bot.action("admin:route:add", async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_route_add_direction";
  ctx.session.data = {};
  await ctx.reply(
    "🛣️ *አዲስ Route*\n\nአቅጣጫ ይምረጡ:",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([["🔼 አዲስ አበባ → አማራ (toAmhara)", "🔽 አማራ → አዲስ አበባ (toAA)"], ["❌ ሰርዝ"]]).resize()
    }
  );
});

bot.action(/^admin:route:edit:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  const route = await AdminRoute.findOne({ id }).lean();
  if (!route) return ctx.editMessageText("Route አልተገኘም።");
  await ctx.editMessageText(
    `🛣️ *${route.emoji} ${route.label}*\n` +
    `📍 አቅጣጫ: ${route.direction === "toAmhara" ? "→ አማራ" : "→ አዲስ አበባ"}\n` +
    `🎯 Target: ${route.targetKg} KG\n\n` +
    `ምን ማስተካከል ይፈልጋሉ?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✏️ Label ቀይር", `admin:route:setlabel:${id}`), Markup.button.callback("🎯 Target ቀይር", `admin:route:settarget:${id}`)],
        [Markup.button.callback("😀 Emoji ቀይር", `admin:route:setemoji:${id}`), Markup.button.callback("🗑️ ሰርዝ", `admin:route:delete:${id}`)],
        [Markup.button.callback("🔙 ተመለስ", "admin:routes")],
      ])
    }
  );
});

bot.action(/^admin:route:setlabel:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  ctx.session.step = "admin_route_setlabel";
  ctx.session.data = { id };
  await ctx.reply("✏️ አዲስ Label ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:route:settarget:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  ctx.session.step = "admin_route_settarget";
  ctx.session.data = { id };
  await ctx.reply("🎯 አዲስ Target KG ያስገቡ (ምሳሌ: 5000):", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:route:setemoji:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  ctx.session.step = "admin_route_setemoji";
  ctx.session.data = { id };
  await ctx.reply("😀 አዲስ Emoji ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:route:delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  const route = await AdminRoute.findOne({ id }).lean();
  if (!route) return ctx.editMessageText("Route አልተገኘም።");
  await ctx.editMessageText(
    `🗑️ *${route.label}* ሊሰረዝ ነው!\nእርግጠኛ ነዎት?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ አዎ ሰርዝ", `admin:route:confirm_delete:${id}`), Markup.button.callback("❌ አይ", "admin:routes")],
      ])
    }
  );
});

bot.action(/^admin:route:confirm_delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  await AdminRoute.findOneAndDelete({ id });
  await ctx.editMessageText("✅ Route ተሰርዟል!");
  await notifyAdmins(ctx.telegram, `🗑️ Route ተሰርዟል: \`${id}\``, ctx.from.id);
});

/* ─────────────────────────────────────────────────
   PRODUCTS ADMIN
───────────────────────────────────────────────── */
bot.action("admin:products", async ctx => {
  await ctx.answerCbQuery();
  const products = await getAllProducts();
  const btns = products.map(p => [
    Markup.button.callback(`${p.emoji} ${p.label} — ${p.pricePerKg}ብር/${p.unit}`, `admin:prod:edit:${p.id}`)
  ]);
  btns.push([Markup.button.callback("➕ Product ጨምር", "admin:prod:add"), Markup.button.callback("🔙 ተመለስ", "admin:back")]);
  await ctx.editMessageText("📦 *Products* — ለማስተካከል ይምረጡ:", { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

bot.action("admin:prod:add", async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_prod_add_emoji";
  ctx.session.data = {};
  await ctx.reply("📦 *አዲስ Product*\n\nEmoji ያስገቡ:", { parse_mode: "Markdown", ...Markup.keyboard([["❌ ሰርዝ"]]).resize() });
});

bot.action(/^admin:prod:edit:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  const products = await getAllProducts();
  const p = products.find(x => x.id === id);
  if (!p) return ctx.editMessageText("Product አልተገኘም።");
  const btns = [
    [Markup.button.callback("💰 ዋጋ ቀይር", `admin:prod:setprice:${id}`), Markup.button.callback("🎯 Target ቀይር", `admin:prod:settarget:${id}`)],
    [Markup.button.callback("✏️ Label ቀይር", `admin:prod:setlabel:${id}`), Markup.button.callback("😀 Emoji ቀይር", `admin:prod:setemoji:${id}`)],
  ];
  if (p.isCustom) btns.push([Markup.button.callback("🗑️ ሰርዝ", `admin:prod:delete:${id}`)]);
  btns.push([Markup.button.callback("🔙 ተመለስ", "admin:products")]);
  await ctx.editMessageText(
    `📦 *${p.emoji} ${p.label}*\n💰 ዋጋ: ${p.pricePerKg} ብር/${p.unit}\n🎯 Target: ${p.targetKg} ${p.unit}\n\nምን ማስተካቀል?`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) }
  );
});

bot.action(/^admin:prod:setprice:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_prod_setprice";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("💰 አዲስ ዋጋ (ብር) ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:prod:settarget:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_prod_settarget";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("🎯 አዲስ Target ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:prod:setlabel:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_prod_setlabel";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("✏️ አዲስ Label ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:prod:setemoji:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_prod_setemoji";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("😀 አዲስ Emoji ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:prod:delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  await ctx.editMessageText(`🗑️ Product ሊሰረዝ ነው። እርግጠኛ ነዎት?`, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("✅ አዎ ሰርዝ", `admin:prod:confirm_delete:${id}`), Markup.button.callback("❌ አይ", "admin:products")],
    ])
  });
});

bot.action(/^admin:prod:confirm_delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  await CustomProduct.findOneAndUpdate({ id: ctx.match[1] }, { enabled: false });
  await ctx.editMessageText("✅ Product ተሰርዟል!");
});

/* ─────────────────────────────────────────────────
   PAYMENTS ADMIN
───────────────────────────────────────────────── */
bot.action("admin:payments", async ctx => {
  await ctx.answerCbQuery();
  const methods = await getPayments();
  const btns = methods.map(m => [Markup.button.callback(`${m.emoji} ${m.label}`, `admin:pay:edit:${m.id}`)]);
  btns.push([Markup.button.callback("➕ Payment ጨምር", "admin:pay:add"), Markup.button.callback("🔙 ተመለስ", "admin:back")]);
  await ctx.editMessageText("💳 *Payment Methods* — ለማስተካቀል ይምረጡ:", { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

bot.action("admin:pay:add", async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_pay_add_emoji";
  ctx.session.data = {};
  await ctx.reply("💳 *አዲስ Payment Method*\n\nEmoji ያስገቡ:", { parse_mode: "Markdown", ...Markup.keyboard([["❌ ሰርዝ"]]).resize() });
});

bot.action(/^admin:pay:edit:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  const m = await AdminPayment.findOne({ id }).lean();
  if (!m) return ctx.editMessageText("Payment method አልተገኘም።");
  await ctx.editMessageText(
    `💳 *${m.emoji} ${m.label}*\n\n📋 Info:\n${m.info}\n\nምን ማስተካቀል?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✏️ Label ቀይር", `admin:pay:setlabel:${id}`), Markup.button.callback("😀 Emoji ቀይር", `admin:pay:setemoji:${id}`)],
        [Markup.button.callback("📋 Info ቀይር", `admin:pay:setinfo:${id}`), Markup.button.callback("🗑️ ሰርዝ", `admin:pay:delete:${id}`)],
        [Markup.button.callback("🔙 ተመለስ", "admin:payments")],
      ])
    }
  );
});

bot.action(/^admin:pay:setlabel:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_pay_setlabel";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("✏️ አዲስ Label ያስገቡ (ምሳሌ: CBE ባንክ):", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:pay:setemoji:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_pay_setemoji";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply("😀 አዲስ Emoji ያስገቡ:", Markup.keyboard([["❌ ሰርዝ"]]).resize());
});

bot.action(/^admin:pay:setinfo:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  ctx.session.step = "admin_pay_setinfo";
  ctx.session.data = { id: ctx.match[1] };
  await ctx.reply(
    "📋 አዲስ Account Info ያስገቡ:\n(ምሳሌ:\nCBE: 1000370308447\nስም: አቤ ከበደ)",
    Markup.keyboard([["❌ ሰርዝ"]]).resize()
  );
});

bot.action(/^admin:pay:delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const id = ctx.match[1];
  await ctx.editMessageText("🗑️ Payment method ሊሰረዝ ነው። እርግጠኛ ነዎት?", {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("✅ አዎ ሰርዝ", `admin:pay:confirm_delete:${id}`), Markup.button.callback("❌ አይ", "admin:payments")],
    ])
  });
});

bot.action(/^admin:pay:confirm_delete:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  await AdminPayment.findOneAndDelete({ id: ctx.match[1] });
  await ctx.editMessageText("✅ Payment method ተሰርዟል!");
});

/* ─────────────────────────────────────────────────
   SETTINGS ADMIN
───────────────────────────────────────────────── */
bot.action("admin:settings", async ctx => {
  await ctx.answerCbQuery();
  const s = await getSettings();
  await ctx.editMessageText(
    `⚙️ *Bot Settings*\n\n` +
    `💰 ምዝገባ ክፍያ/KG: ${s.regPerKg} ብር\n` +
    `🚚 የጭነት ዋጋ/KG: ${s.shipPerKg} ብር\n` +
    `📞 ድጋፍ ስልክ: ${s.supportPhone}\n` +
    `📢 Channel: ${s.channelId || "—"}\n\n` +
    `ምን ማቀያየር ይፈልጋሉ?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("💰 ምዝገባ ክፍያ/KG", "admin:set:regPerKg"), Markup.button.callback("🚚 የጭነት ዋጋ/KG", "admin:set:shipPerKg")],
        [Markup.button.callback("📞 ድጋፍ ስልክ", "admin:set:supportPhone"), Markup.button.callback("📢 Channel ID", "admin:set:channelId")],
        [Markup.button.callback("🔙 ተመለስ", "admin:back")],
      ])
    }
  );
});

["regPerKg", "shipPerKg", "supportPhone", "channelId"].forEach(key => {
  bot.action(`admin:set:${key}`, async ctx => {
    await ctx.answerCbQuery();
    ctx.session.step = `admin_set_${key}`;
    ctx.session.data = {};
    const labels = {
      regPerKg:     "💰 አዲስ ምዝገባ ክፍያ (ብር/KG) ያስገቡ:",
      shipPerKg:    "🚚 አዲስ የጭነት ዋጋ (ብር/KG) ያስገቡ:",
      supportPhone: "📞 አዲስ ድጋፍ ስልክ ቁጥር ያስገቡ:",
      channelId:    "📢 አዲስ Channel ID ያስገቡ (ምሳሌ: @mychannel):",
    };
    await ctx.reply(labels[key], Markup.keyboard([["❌ ሰርዝ"]]).resize());
  });
});

/* ─────────────────────────────────────────────────
   MENU VISIBILITY ADMIN
───────────────────────────────────────────────── */
bot.action("admin:menu", async ctx => {
  await ctx.answerCbQuery();
  const customs = await CustomProduct.find({ enabled: true }).lean();
  const allItems = [...STATIC_MENU, ...customs.map(p => ({ key: `menu_product_${p.id}`, emoji: p.emoji, label: p.label }))];
  const btns = [];
  for (const item of allItems) {
    const enabled = await getSetting(item.key, true);
    btns.push([Markup.button.callback(
      `${enabled ? "✅" : "❌"} ${item.emoji} ${item.label}`,
      `admin:menu:toggle:${item.key}`
    )]);
  }
  btns.push([Markup.button.callback("🔙 ተመለስ", "admin:back")]);
  await ctx.editMessageText("📋 *Menu Visibility* — ✅=ታይ ❌=ተሰወር", { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

bot.action(/^admin:menu:toggle:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  const key = ctx.match[1];
  const current = await getSetting(key, true);
  await setSetting(key, !current);

  // Refresh menu display
  const customs = await CustomProduct.find({ enabled: true }).lean();
  const allItems = [...STATIC_MENU, ...customs.map(p => ({ key: `menu_product_${p.id}`, emoji: p.emoji, label: p.label }))];
  const btns = [];
  for (const item of allItems) {
    const enabled = await getSetting(item.key, true);
    btns.push([Markup.button.callback(
      `${enabled ? "✅" : "❌"} ${item.emoji} ${item.label}`,
      `admin:menu:toggle:${item.key}`
    )]);
  }
  btns.push([Markup.button.callback("🔙 ተመለስ", "admin:back")]);
  await ctx.editMessageText("📋 *Menu Visibility* — ✅=ታይ ❌=ተሰወር", { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

/* ─────────────────────────────────────────────────
   STATS
───────────────────────────────────────────────── */
bot.action("admin:stats", async ctx => {
  await ctx.answerCbQuery();
  const [counts, kgAgg] = await Promise.all([
    Reg.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Reg.aggregate([{ $group: { _id: null, kg: { $sum: "$weightKg" } } }]),
  ]);
  const s = { total: 0, pending: 0, reviewing: 0, approved: 0 };
  for (const c of counts) {
    if (c._id in s) s[c._id] = c.count;
    s.total += c.count;
  }
  const [gbTotal, gbPending] = await Promise.all([GBReg.countDocuments(), GBReg.countDocuments({ paymentStatus: "pending" })]);
  await ctx.editMessageText(
    `📊 *Stats*\n\n` +
    `🚚 *ጭነት:*\n• ጠቅላላ: ${s.total}\n• ⏳ Pending: ${s.pending}\n• 🔍 Reviewing: ${s.reviewing}\n• ✅ Approved: ${s.approved}\n• 📦 ጠቅላላ KG: ${kgAgg[0]?.kg || 0}\n\n` +
    `🛒 *ቡድን ግዢ:*\n• ጠቅላላ: ${gbTotal}\n• ⏳ Pending: ${gbPending}`,
    { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("🔙 ተመለስ", "admin:back")]]) }
  );
});

bot.action("admin:back", async ctx => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("⚙️ *Admin Panel*\n\nምን ማስተካቀል ይፈልጋሉ?", {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("🛣️ Routes", "admin:routes"), Markup.button.callback("📦 Products", "admin:products")],
      [Markup.button.callback("💳 Payments", "admin:payments"), Markup.button.callback("⚙️ Settings", "admin:settings")],
      [Markup.button.callback("📋 Menu Visibility", "admin:menu"), Markup.button.callback("📊 Stats", "admin:stats")],
    ])
  });
});

/* ══════════════════════════════════════════════════════
   ████  TEXT HANDLER — user flows + admin input  ████
══════════════════════════════════════════════════════ */
bot.on("text", async ctx => {
  const text = ctx.message.text.trim();
  const sess = ctx.session;

  // Cancel
  if (text === "❌ ሰርዝ" || text === "/cancel") {
    sess.step = null; sess.data = {};
    return ctx.reply("ተሰርዟል ✅", await mainMenu());
  }

  // ── Active step ───────────────────────────────────────
  if (sess.step) {
    await handleStep(ctx, text);
    return;
  }

  // ── Main menu actions ─────────────────────────────────
  if (text.includes("አዲስ አበባ → አማራ ክልል"))  return startCargoFlow(ctx, "toAmhara");
  if (text.includes("አማራ ክልል → አዲስ አበባ"))  return startCargoFlow(ctx, "toAA");
  if (text === "📋 የምዝገባ ዝርዝሬ")             return showMyRegs(ctx);
  if (text === "📊 የጭነት ቆጣሪ")               return showCounter(ctx);
  if (text === "📞 ድጋፍ")                       return showSupport(ctx);

  // ── Group-buy product tap ─────────────────────────────
  const products = await getAllProducts();
  for (const p of products) {
    if (text.startsWith(`${p.emoji} ${p.label}`)) {
      const ok = await getSetting(`menu_product_${p.id}`, true);
      if (ok) return startGbFlow(ctx, p);
    }
  }

  await ctx.reply("ከዝርዝሩ ይምረጡ:", await mainMenu());
});

/* ─────────────────────────────────────────────────
   STEP HANDLER  (admin input + user flow steps)
───────────────────────────────────────────────── */
async function handleStep(ctx, text) {
  const sess = ctx.session;
  const step = sess.step;

  /* ════ ADMIN: Route add ════ */
  if (step === "admin_route_add_direction") {
    let dir = null;
    if (text.includes("toAmhara")) dir = "toAmhara";
    if (text.includes("toAA"))     dir = "toAA";
    if (!dir) return ctx.reply("ከዝርዝሩ ይምረጡ:");
    sess.data.direction = dir;
    sess.step = "admin_route_add_emoji";
    return ctx.reply("😀 Route Emoji ያስገቡ (ምሳሌ: 🟢):", Markup.removeKeyboard());
  }
  if (step === "admin_route_add_emoji") {
    sess.data.emoji = text;
    sess.step = "admin_route_add_label";
    return ctx.reply("✏️ Route Label ያስገቡ (ምሳሌ: አዲስ አበባ → ፍኖተሰላም):");
  }
  if (step === "admin_route_add_label") {
    sess.data.label = text;
    sess.step = "admin_route_add_target";
    return ctx.reply("🎯 Target KG ያስገቡ (ምሳሌ: 5000):");
  }
  if (step === "admin_route_add_target") {
    const kg = parseFloat(text);
    if (isNaN(kg) || kg <= 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    const id = makeId(sess.data.label);
    await AdminRoute.create({ id, emoji: sess.data.emoji, label: sess.data.label, direction: sess.data.direction, targetKg: kg });
    sess.step = null; sess.data = {};
    await ctx.reply(`✅ Route ተጨምሯል!\n\n/admin ለተጨማሪ`, await mainMenu());
    return;
  }

  if (step === "admin_route_setlabel") {
    await AdminRoute.findOneAndUpdate({ id: sess.data.id }, { label: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Label ተቀይሯል: *${text}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_route_settarget") {
    const kg = parseFloat(text);
    if (isNaN(kg) || kg <= 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    await AdminRoute.findOneAndUpdate({ id: sess.data.id }, { targetKg: kg });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Target ተቀይሯል: *${kg} KG*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_route_setemoji") {
    await AdminRoute.findOneAndUpdate({ id: sess.data.id }, { emoji: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Emoji ተቀይሯል: ${text}`, await mainMenu());
  }

  /* ════ ADMIN: Product add ════ */
  if (step === "admin_prod_add_emoji") {
    sess.data.emoji = text; sess.step = "admin_prod_add_label";
    return ctx.reply("✏️ Product Label ያስገቡ (ምሳሌ: ቅቤ):");
  }
  if (step === "admin_prod_add_label") {
    sess.data.label = text; sess.step = "admin_prod_add_unit";
    return ctx.reply("📏 Unit ይምረጡ:", Markup.keyboard([["kg", "liter"], ["❌ ሰርዝ"]]).resize());
  }
  if (step === "admin_prod_add_unit") {
    if (!["kg", "liter"].includes(text.toLowerCase())) return ctx.reply("kg ወይም liter ይምረጡ:");
    sess.data.unit = text.toLowerCase(); sess.step = "admin_prod_add_price";
    return ctx.reply("💰 ዋጋ (ብር/unit) ያስገቡ:", Markup.removeKeyboard());
  }
  if (step === "admin_prod_add_price") {
    const p = parseFloat(text);
    if (isNaN(p) || p < 0) return ctx.reply("ትክክለኛ ዋጋ ያስገቡ:");
    sess.data.pricePerKg = p; sess.step = "admin_prod_add_target";
    return ctx.reply("🎯 Target quantity ያስገቡ:");
  }
  if (step === "admin_prod_add_target") {
    const kg = parseFloat(text);
    if (isNaN(kg) || kg <= 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    const id = "custom_" + makeId(sess.data.label);
    await CustomProduct.create({ id, emoji: sess.data.emoji, label: sess.data.label, unit: sess.data.unit, targetKg: kg, pricePerKg: sess.data.pricePerKg });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Product ተጨምሯል!`, await mainMenu());
  }

  if (step === "admin_prod_setprice") {
    const p = parseFloat(text);
    if (isNaN(p) || p < 0) return ctx.reply("ትክክለኛ ዋጋ ያስገቡ:");
    const id = sess.data.id;
    if (STATIC_PRODUCTS.some(x => x.id === id)) await setSetting(`price_${id}`, p);
    else await CustomProduct.findOneAndUpdate({ id }, { pricePerKg: p });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ ዋጋ ተቀይሯል: *${p} ብር*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_prod_settarget") {
    const kg = parseFloat(text);
    if (isNaN(kg) || kg <= 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    const id = sess.data.id;
    if (STATIC_PRODUCTS.some(x => x.id === id)) await setSetting(`target_${id}`, kg);
    else await CustomProduct.findOneAndUpdate({ id }, { targetKg: kg });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Target ተቀይሯል: *${kg}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_prod_setlabel") {
    const id = sess.data.id;
    await CustomProduct.findOneAndUpdate({ id }, { label: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Label ተቀይሯል: *${text}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_prod_setemoji") {
    const id = sess.data.id;
    await CustomProduct.findOneAndUpdate({ id }, { emoji: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Emoji ተቀይሯል: ${text}`, await mainMenu());
  }

  /* ════ ADMIN: Payment edit ════ */
  if (step === "admin_pay_add_emoji") {
    sess.data.emoji = text; sess.step = "admin_pay_add_label";
    return ctx.reply("✏️ Bank/Method Name ያስገቡ (ምሳሌ: Awash Bank):");
  }
  if (step === "admin_pay_add_label") {
    sess.data.label = text; sess.step = "admin_pay_add_info";
    return ctx.reply("📋 Account Info ያስገቡ:\n(ምሳሌ:\nAwash: 01320836282001\nስም: አቤ ከበደ):");
  }
  if (step === "admin_pay_add_info") {
    const id = "pay_" + makeId(sess.data.label);
    await AdminPayment.create({ id, emoji: sess.data.emoji, label: sess.data.label, info: text });
    sess.step = null; sess.data = {};
    return ctx.reply("✅ Payment method ተጨምሯል!", await mainMenu());
  }
  if (step === "admin_pay_setlabel") {
    await AdminPayment.findOneAndUpdate({ id: sess.data.id }, { label: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Label ተቀይሯል: *${text}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_pay_setemoji") {
    await AdminPayment.findOneAndUpdate({ id: sess.data.id }, { emoji: text });
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Emoji ተቀይሯል: ${text}`, await mainMenu());
  }
  if (step === "admin_pay_setinfo") {
    await AdminPayment.findOneAndUpdate({ id: sess.data.id }, { info: text });
    sess.step = null; sess.data = {};
    return ctx.reply("✅ Account info ተቀይሯል!", await mainMenu());
  }

  /* ════ ADMIN: Settings ════ */
  if (step === "admin_set_regPerKg") {
    const v = parseFloat(text);
    if (isNaN(v) || v < 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    await setSetting("fee_reg_per_kg", v);
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ ምዝገባ ክፍያ: *${v} ብር/KG*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_set_shipPerKg") {
    const v = parseFloat(text);
    if (isNaN(v) || v < 0) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ:");
    await setSetting("fee_ship_per_kg", v);
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ የጭነት ዋጋ: *${v} ብር/KG*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_set_supportPhone") {
    await setSetting("support_phone", text);
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ ድጋፍ ስልክ: *${text}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }
  if (step === "admin_set_channelId") {
    await setSetting("channel_id", text);
    sess.step = null; sess.data = {};
    return ctx.reply(`✅ Channel ID: *${text}*`, { parse_mode: "Markdown", ...await mainMenu() });
  }

  /* ════ CARGO FLOW ════ */
  if (step === "cargo_route") {
    const routes = await getRoutes();
    const route = routes.find(r => text.includes(r.label));
    if (!route) return ctx.reply("ካልተወቀ ከተማ ይምረጡ:");
    sess.data.routeId = route.id;
    sess.step = "cargo_fullname";
    return ctx.reply("👤 *ሙሉ ስምዎን ያስገቡ:*", { parse_mode: "Markdown", ...Markup.removeKeyboard() });
  }
  if (step === "cargo_fullname") {
    if (text.length < 3) return ctx.reply("ስም ቢያንስ 3 ፊደል ሊሆን ይገባዋል:");
    sess.data.fullName = text; sess.step = "cargo_phone";
    return ctx.reply("📞 *ስልክ ቁጥርዎን ያስገቡ:*\nምሳሌ: 0912345678", { parse_mode: "Markdown" });
  }
  if (step === "cargo_phone") {
    const c = text.replace(/\s+/g, "");
    if (!/^(09|07|\+2519|\+2517)\d{8}$/.test(c) && !/^\d{10,13}$/.test(c)) return ctx.reply("ትክክለኛ ስልክ ቁጥር ያስገቡ:");
    sess.data.phone = c; sess.step = "cargo_neighborhood";
    return ctx.reply("🏘️ *አካባቢ/ሰፈር ያስገቡ:*\n(ካልፈለጉ \"አቋርጥ\" ይፃፉ)", { parse_mode: "Markdown" });
  }
  if (step === "cargo_neighborhood") {
    sess.data.neighborhood = text === "አቋርጥ" ? "" : text;
    sess.step = "cargo_desc";
    return ctx.reply("📦 *ምን ዓይነት ጭነት ነው? ዝርዝር ያስገቡ:*", { parse_mode: "Markdown" });
  }
  if (step === "cargo_desc") {
    if (text.length < 2) return ctx.reply("ዝርዝሩን ያስገቡ:");
    sess.data.cargoDesc = text; sess.step = "cargo_weight";
    return ctx.reply("⚖️ *ክብደት በKG ያስገቡ:*\nምሳሌ: 50", { parse_mode: "Markdown" });
  }
  if (step === "cargo_weight") {
    const kg = parseFloat(text);
    if (isNaN(kg) || kg <= 0 || kg > 10000) return ctx.reply("ትክክለኛ ክብደት ያስገቡ (1 - 10000 KG):");
    sess.data.weightKg = kg;
    const s = await getSettings();
    sess.data.totalPrice = Math.round((s.regPerKg + s.shipPerKg) * kg);
    const methods = await getPayments();
    if (methods.length === 0) { await saveCargoReg(ctx, null, null); return; }
    sess.data.paymentMethods = methods;
    sess.step = "cargo_payment_method";
    const btns = methods.map(m => [`${m.emoji} ${m.label}`]);
    btns.push(["❌ ሰርዝ"]);
    return ctx.reply(
      `💰 *ክፍያ ዝርዝር:*\n• ምዝገባ: ${s.regPerKg}×${kg} = *${Math.round(s.regPerKg*kg)} ብር*\n• ጭነት: ${s.shipPerKg}×${kg} = *${Math.round(s.shipPerKg*kg)} ብር*\n📊 *ጠቅላላ: ${sess.data.totalPrice} ብር*\n\n💳 *የክፍያ ዘዴ ይምረጡ:*`,
      { parse_mode: "Markdown", ...Markup.keyboard(btns).resize() }
    );
  }
  if (step === "cargo_payment_method") {
    const methods = sess.data.paymentMethods || [];
    const m = methods.find(x => text.includes(x.label));
    if (!m) return ctx.reply("ከዝርዝሩ ይምረጡ:");
    sess.data.paymentMethod = m.label;
    sess.step = "cargo_payment_photo";
    return ctx.reply(
      `✅ *${m.label}* ምርጫዎ!\n\n📋 *የክፍያ መረጃ:*\n${m.info}\n\n💰 *${sess.data.totalPrice} ብር* ይላኩ\n\n📸 *ክፍያ ከፈፀሙ በኋላ screenshot ያስላኩ:*`,
      { parse_mode: "Markdown", ...Markup.keyboard([["❌ ሰርዝ"]]).resize() }
    );
  }

  /* ════ GB FLOW ════ */
  if (step === "gb_fullname") {
    if (text.length < 3) return ctx.reply("ስም ቢያንስ 3 ፊደል:");
    sess.data.fullName = text; sess.step = "gb_phone";
    return ctx.reply("📞 *ስልክ ቁጥርዎን ያስገቡ:*", { parse_mode: "Markdown" });
  }
  if (step === "gb_phone") {
    const c = text.replace(/\s+/g, "");
    if (!/^(09|07|\+2519|\+2517)\d{8}$/.test(c) && !/^\d{10,13}$/.test(c)) return ctx.reply("ትክክለኛ ስልክ ቁጥር ያስገቡ:");
    sess.data.phone = c; sess.step = "gb_neighborhood";
    return ctx.reply("🏘️ *አካባቢ/ሰፈር ያስገቡ:*\n(ካልፈለጉ \"አቋርጥ\" ይፃፉ)", { parse_mode: "Markdown" });
  }
  if (step === "gb_neighborhood") {
    sess.data.neighborhood = text === "አቋርጥ" ? "" : text;
    const p = sess.data.product;
    sess.step = "gb_weight";
    return ctx.reply(`⚖️ *ምን ያህል ${p.unit} ይፈልጋሉ?*\n(ዋጋ: ${p.pricePerKg} ብር/${p.unit})`, { parse_mode: "Markdown" });
  }
  if (step === "gb_weight") {
    const qty = parseFloat(text);
    if (isNaN(qty) || qty <= 0) return ctx.reply("ትክክለኛ ብዛት ያስገቡ:");
    const p = sess.data.product;
    sess.data.weightKg = qty;
    sess.data.totalCost = Math.round(p.pricePerKg * qty);
    const methods = await getPayments();
    if (methods.length === 0) { await saveGbReg(ctx, null); return; }
    sess.data.paymentMethods = methods;
    sess.step = "gb_payment_method";
    const btns = methods.map(m => [`${m.emoji} ${m.label}`]);
    btns.push(["❌ ሰርዝ"]);
    return ctx.reply(
      `💰 ${qty} ${p.unit} × ${p.pricePerKg} ብር = *${sess.data.totalCost} ብር*\n\n💳 *የክፍያ ዘዴ ይምረጡ:*`,
      { parse_mode: "Markdown", ...Markup.keyboard(btns).resize() }
    );
  }
  if (step === "gb_payment_method") {
    const methods = sess.data.paymentMethods || [];
    const m = methods.find(x => text.includes(x.label));
    if (!m) return ctx.reply("ከዝርዝሩ ይምረጡ:");
    sess.data.paymentMethod = m.label;
    sess.step = "gb_payment_photo";
    return ctx.reply(
      `✅ *${m.label}*\n\n📋 ${m.info}\n\n💰 *${sess.data.totalCost} ብር* ይላኩ\n\n📸 *ፎቶ ያስላኩ:*`,
      { parse_mode: "Markdown", ...Markup.keyboard([["❌ ሰርዝ"]]).resize() }
    );
  }
}

/* ══════════════════════════════════════════════════════
   PHOTO HANDLER
══════════════════════════════════════════════════════ */
bot.on("photo", async ctx => {
  const fileId = ctx.message.photo.at(-1).file_id;
  if (ctx.session.step === "cargo_payment_photo") await saveCargoReg(ctx, ctx.session.data.paymentMethod, fileId);
  else if (ctx.session.step === "gb_payment_photo") await saveGbReg(ctx, fileId);
  else await ctx.reply("ምዝገባ ሳይጀምሩ ፎቶ ላኩ። ከዝርዝሩ ይምረጡ:");
});

/* ─────────────────────────────────────────────────
   CARGO FLOW START  (now shows per-route progress, GB-style)
───────────────────────────────────────────────── */
async function startCargoFlow(ctx, direction) {
  const routes = (await getRoutes()).filter(r => r.direction === direction);
  if (routes.length === 0) return ctx.reply("አሁን ምንም route አልተዘጋጀም።");

  ctx.session.step = "cargo_route";
  ctx.session.data = { direction };

  let msg = direction === "toAmhara"
    ? "🔼 *አዲስ አበባ → አማራ ክልል*\n\n"
    : "🔽 *አማራ ክልል → አዲስ አበባ*\n\n";

  const btns = [];
  for (const r of routes) {
    const agg = await Reg.aggregate([
      { $match: { routeId: r.id } },
      { $group: { _id: null, kg: { $sum: "$weightKg" } } },
    ]);
    const cur = agg[0]?.kg || 0;
    const { pct, bar } = progressBar(cur, r.targetKg);
    msg += `${r.emoji} *${r.label}*\n📊 [${bar}] ${pct}%  (${cur.toLocaleString()}/${r.targetKg.toLocaleString()} KG)\n\n`;
    btns.push([`${r.emoji} ${r.label}`]);
  }
  btns.push(["❌ ሰርዝ"]);
  msg += "📍 *መዳረሻ ከተማ ይምረጡ:*";

  await ctx.reply(msg, { parse_mode: "Markdown", ...Markup.keyboard(btns).resize() });
}

/* ─────────────────────────────────────────────────
   GROUP-BUY FLOW START
───────────────────────────────────────────────── */
async function startGbFlow(ctx, product) {
  const agg = await GBReg.aggregate([
    { $match: { productId: product.id } },
    { $group: { _id: null, kg: { $sum: "$weightKg" } } },
  ]);
  const cur = agg[0]?.kg || 0;
  const { pct, bar } = progressBar(cur, product.targetKg);
  ctx.session.step = "gb_fullname";
  ctx.session.data = { product };
  await ctx.reply(
    `${product.emoji} *${product.label} — ቡድን ግዢ*\n\n💰 ዋጋ: *${product.pricePerKg} ብር/${product.unit}*\n📊 [${bar}] ${pct}%\n${cur.toLocaleString()} / ${product.targetKg.toLocaleString()} ${product.unit}\n\n👤 *ሙሉ ስምዎን ያስገቡ:*`,
    { parse_mode: "Markdown", ...Markup.keyboard([["❌ ሰርዝ"]]).resize() }
  );
}

/* ─────────────────────────────────────────────────
   SAVE CARGO REG
───────────────────────────────────────────────── */
async function saveCargoReg(ctx, paymentMethod, paymentFileId) {
  const d = ctx.session.data;
  try {
    const reg = await Reg.create({
      userId: ctx.from.id, username: ctx.from.username || "",
      fullName: d.fullName, phone: d.phone, neighborhood: d.neighborhood || "",
      routeId: d.routeId, cargoDesc: d.cargoDesc,
      weightKg: d.weightKg, totalPrice: d.totalPrice || 0,
      paymentMethod, paymentFileId, status: "pending",
    });
    ctx.session.step = null; ctx.session.data = {};
    await ctx.reply(
      `✅ *ምዝገባዎ ተቀብሏል!*\n\n• ስም: ${reg.fullName}\n• መንገድ: ${reg.routeId}\n• ክብደት: ${reg.weightKg} KG\n• ጠቅላላ: ${reg.totalPrice} ብር\n• ሁኔታ: ⏳ በጥበቃ ላይ\n\nቡድናችን ምዝገባዎን ካረጋገጠ በኋላ ያሳውቅዎታል!`,
      { parse_mode: "Markdown", ...await mainMenu() }
    );
    await notifyAdmins(ctx.telegram, `🆕 *አዲስ ጭነት!*\n👤 ${reg.fullName} (@${reg.username||"N/A"})\n📍 ${reg.routeId}\n⚖️ ${reg.weightKg} KG — ${reg.totalPrice} ብር\n💳 ${paymentMethod||"-"}\n🔑 \`${reg._id}\``);
    if (paymentFileId) for (const a of ADMIN_IDS) try { await ctx.telegram.sendPhoto(a, paymentFileId, { caption: `💳 ጭነት ፎቶ — ${reg.fullName} ${reg.weightKg} KG` }); } catch {}
  } catch (e) {
    console.error(e);
    ctx.session.step = null; ctx.session.data = {};
    await ctx.reply("⚠️ ስህተት ተፈጠረ። ዳግም ይሞክሩ:", await mainMenu());
  }
}

/* ─────────────────────────────────────────────────
   SAVE GB REG
───────────────────────────────────────────────── */
async function saveGbReg(ctx, paymentFileId) {
  const d = ctx.session.data;
  const p = d.product;
  try {
    const reg = await GBReg.create({
      userId: ctx.from.id, username: ctx.from.username || "",
      productId: p.id, fullName: d.fullName, phone: d.phone,
      neighborhood: d.neighborhood || "", weightKg: d.weightKg,
      totalCost: d.totalCost, pricePerKg: p.pricePerKg,
      paymentFileId, paymentStatus: "pending",
    });
    ctx.session.step = null; ctx.session.data = {};
    await ctx.reply(
      `✅ *ምዝገባዎ ተቀብሏል!*\n\n• ምርት: ${p.emoji} ${p.label}\n• ብዛት: ${reg.weightKg} ${p.unit}\n• ዋጋ: ${reg.totalCost} ብር\n• ሁኔታ: ⏳ በጥበቃ ላይ\n\nቡድናችን ያሳውቅዎታል!`,
      { parse_mode: "Markdown", ...await mainMenu() }
    );
    await notifyAdmins(ctx.telegram, `🛒 *አዲስ ቡድን ግዢ!*\n👤 ${reg.fullName}\n📦 ${p.emoji} ${p.label}: ${reg.weightKg} ${p.unit}\n💰 ${reg.totalCost} ብር\n🔑 \`${reg._id}\``);
    if (paymentFileId) for (const a of ADMIN_IDS) try { await ctx.telegram.sendPhoto(a, paymentFileId, { caption: `💳 ቡድን ግዢ ፎቶ — ${reg.fullName} ${p.label} ${reg.weightKg}` }); } catch {}
  } catch (e) {
    console.error(e);
    ctx.session.step = null; ctx.session.data = {};
    await ctx.reply("⚠️ ስህተት ተፈጠረ:", await mainMenu());
  }
}

/* ─────────────────────────────────────────────────
   MY REGISTRATIONS
───────────────────────────────────────────────── */
async function showMyRegs(ctx) {
  const [cargo, gb] = await Promise.all([
    Reg.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).limit(10).lean(),
    GBReg.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const SE = { pending:"⏳", reviewing:"🔍", approved:"✅" };
  const GE = { pending:"⏳", reviewing:"🔍", approved:"✅" };
  let msg = "📋 *የምዝገባ ዝርዝሬ*\n\n";
  if (cargo.length) {
    msg += "🚚 *ጭነት ምዝገቦቼ:*\n";
    for (const r of cargo) msg += `• ${SE[r.status]||"❓"} ${r.routeId} — ${r.weightKg} KG\n`;
    msg += "\n";
  }
  if (gb.length) {
    msg += "🛒 *ቡድን ግዢ ምዝገቦቼ:*\n";
    const prods = await getAllProducts();
    for (const r of gb) {
      const p = prods.find(x => x.id === r.productId) || { label: r.productId, unit: "unit" };
      msg += `• ${GE[r.paymentStatus]||"❓"} ${p.label} — ${r.weightKg} ${p.unit}\n`;
    }
  }
  if (!cargo.length && !gb.length) msg += "ምንም ምዝገባ አልተገኘም።";
  await ctx.reply(msg, { parse_mode: "Markdown", ...await mainMenu() });
}

/* ─────────────────────────────────────────────────
   COUNTER
───────────────────────────────────────────────── */
async function showCounter(ctx) {
  const routes = await getRoutes();
  if (!routes.length) return ctx.reply("ምንም route አልተዘጋጀም።");
  let msg = "📊 *የጭነት ቆጣሪ*\n\n";
  for (const dir of ["toAmhara","toAA"]) {
    const label = dir === "toAmhara" ? "🔼 አዲስ አበባ → አማራ:" : "🔽 አማራ → አዲስ አበባ:";
    const r = routes.filter(x => x.direction === dir);
    if (!r.length) continue;
    msg += `${label}\n`;
    for (const route of r) {
      const agg = await Reg.aggregate([{ $match: { routeId: route.id } }, { $group: { _id: null, t: { $sum: "$weightKg" } } }]);
      const cur = agg[0]?.t || 0;
      const { pct, bar } = progressBar(cur, route.targetKg);
      msg += `${route.emoji} ${route.label}\n   [${bar}] ${cur.toLocaleString()}/${route.targetKg.toLocaleString()} KG (${pct}%)\n\n`;
    }
  }
  await ctx.reply(msg, { parse_mode: "Markdown", ...await mainMenu() });
}

/* ─────────────────────────────────────────────────
   SUPPORT
───────────────────────────────────────────────── */
async function showSupport(ctx) {
  const s = await getSettings();
  await ctx.reply(
    `📞 *ድጋፍ*\n\n📱 ${s.supportPhone}\n${s.channelId ? `📢 @${s.channelId.replace("@","")}` : ""}`,
    { parse_mode: "Markdown", ...await mainMenu() }
  );
}

/* ─────────────────────────────────────────────────
   NOTIFY ADMINS
───────────────────────────────────────────────── */
async function notifyAdmins(telegram, msg, excludeId) {
  for (const id of ADMIN_IDS) {
    if (id === excludeId) continue;
    try { await telegram.sendMessage(id, msg, { parse_mode: "Markdown" }); } catch {}
  }
}

/* ─────────────────────────────────────────────────
   ERROR HANDLER
───────────────────────────────────────────────── */
bot.catch((err, ctx) => {
  console.error("Bot error:", err.message);
  ctx.reply("⚠️ ስህተት ተፈጠረ። ዳግም ይሞክሩ:").catch(() => {});
});

/* ─────────────────────────────────────────────────
   LAUNCH
───────────────────────────────────────────────── */
(async () => {
  console.log("⏳ Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB connected");
  await seedIfEmpty();
  console.log("✅ DB seeded");
  await bot.launch();
  console.log("✅ Bot is running!");
  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
})();
