/* ═══════════════════════════════════════════════════════════════
   PATCH — ሁለት አዲስ ፌቸሮች
   1) Cash Cargo Registration  (admin → cargo ደንበኛ ናቅድ ሲቀበል)
   2) Form Order Builder       (custom form + button inject)
   ═══════════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────────
   SECTION A — DB MODEL (ፋይሉ ውስጥ "4. DB MODELS" ክፍል ስር ጨምር)
   ─────────────────────────────────────────────────────────────

   ከ BotSettings model ቀጥሎ ይህን ጨምር:
*/

const FormTemplate = mongoose.model(
  "FormTemplate",
  new mongoose.Schema({
    id:          { type: String, unique: true, required: true },
    title:       { type: String, required: true },       // Button label (ምሳሌ: "🍕 ፒዛ ትዕዛዝ")
    description: { type: String, default: "" },          // Shown at form start
    fields:      [{ type: mongoose.Schema.Types.Mixed }],// [{key,label,type,options?,required?}]
    enabled:     { type: Boolean, default: true },
    createdAt:   { type: Date, default: Date.now },
  }),
);

const FormOrder = mongoose.model(
  "FormOrder",
  new mongoose.Schema({
    formId:    { type: String, required: true },
    formTitle: { type: String, default: "" },
    userId:    { type: Number, required: true },
    username:  { type: String, default: "" },
    fullName:  { type: String, default: "" },
    phone:     { type: String, default: "" },
    answers:   { type: mongoose.Schema.Types.Mixed, default: {} },
    status:    { type: String, default: "new", enum: ["new","seen","done","cancelled"] },
    createdAt: { type: Date, default: Date.now },
  }),
);

/* ─────────────────────────────────────────────────────────────
   SECTION B — In-memory cache (ፋይሉ ውስጥ "EXTRA_PRODUCTS" ክፋይ ስር)
   ─────────────────────────────────────────────────────────────

   ከ EXTRA_PRODUCTS cache ቀጥሎ ጨምር:
*/

let FORM_TEMPLATES = [];

async function loadFormTemplates() {
  try {
    FORM_TEMPLATES = await FormTemplate.find({ enabled: true }).sort({ createdAt: 1 }).lean();
  } catch { FORM_TEMPLATES = []; }
}

/* ─────────────────────────────────────────────────────────────
   SECTION C — mainKb() ውስጥ (ፋይሉ ውስጥ "8. KEYBOARDS" → mainKb)
   ─────────────────────────────────────────────────────────────

   mainKb() function ውስጥ "extraRow.length" push ቀጥሎ — dynamic form buttons:
*/

// ... after extra products rows, before admin row:
await loadFormTemplates();
let formRow = [];
for (const tmpl of FORM_TEMPLATES) {
  const enabled = await getSetting(`form_enabled_${tmpl.id}`, true);
  if (isAdminUser || enabled) {
    formRow.push(tmpl.title);
    if (formRow.length === 2) { rows.push(formRow); formRow = []; }
  }
}
if (formRow.length) rows.push(formRow);

/* ─────────────────────────────────────────────────────────────
   SECTION D — TEXT FLOW ውስጥ (bot.on("text") handler ውስጥ)
   ─────────────────────────────────────────────────────────────

   "reserved" array ውስጥ form titles ጨምር:
   ...FORM_TEMPLATES.map((f) => f.title),

   ከ "matchedExtra" block ቀጥሎ — form button handler:
*/

const matchedForm = FORM_TEMPLATES.find((f) => f.title === txt);
if (matchedForm) {
  if (!isAdmin(ctx) && !(await getSetting(`form_enabled_${matchedForm.id}`, true)))
    return ctx.reply("ይህ ፎርም አሁን አልተከፈተም።\nለጥያቄ: " + SUPPORT_PHONE, await mainKb(ctx.from?.id));
  ctx.session = {
    step:          "FORM_FIELD",
    formId:        matchedForm.id,
    formFieldIdx:  0,
    formAnswers:   {},
  };
  return ctx.reply(
    `${matchedForm.title}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    (matchedForm.description ? matchedForm.description + "\n\n" : "") +
    `👤 *ሙሉ ስምዎን ያስገቡ:*`,
    { parse_mode: "Markdown", ...backKb() },
  );
}

/* ─────────────────────────────────────────────────────────────
   SECTION E — FORM FLOW steps (TEXT FLOW ውስጥ step handlers)
   ─────────────────────────────────────────────────────────────

   ከ step === "GB_AWAIT_PHOTO" return ቀጥሎ ጨምር:
*/

if (step === "FORM_FIELD_NAME") {
  if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
  ctx.session.formFullName = txt;
  ctx.session.step         = "FORM_FIELD_PHONE";
  return ctx.reply("ስልክ ቁጥርዎን ያስገቡ:", backKb());
}

if (step === "FORM_FIELD_PHONE") {
  const phone      = txt.replace(/\s/g, "");
  ctx.session.formPhone = phone;
  // Start custom fields
  const tmpl = FORM_TEMPLATES.find((f) => f.id === ctx.session.formId);
  if (!tmpl?.fields?.length) {
    // No custom fields — save directly
    return _saveFormOrder(ctx, tmpl);
  }
  ctx.session.step         = "FORM_FIELD";
  ctx.session.formFieldIdx = 0;
  return _askFormField(ctx, tmpl, 0);
}

if (step === "FORM_FIELD") {
  const tmpl = FORM_TEMPLATES.find((f) => f.id === ctx.session.formId);
  const idx  = ctx.session.formFieldIdx || 0;
  const field = tmpl?.fields?.[idx];
  if (!field) return _saveFormOrder(ctx, tmpl);

  // Validate
  if (field.required && !txt.trim()) return ctx.reply(`${field.label} ያስፈልጋል:`, backKb());

  ctx.session.formAnswers[field.key] = txt.trim();
  const nextIdx = idx + 1;
  if (nextIdx < (tmpl?.fields?.length || 0)) {
    ctx.session.formFieldIdx = nextIdx;
    return _askFormField(ctx, tmpl, nextIdx);
  }
  return _saveFormOrder(ctx, tmpl);
}

/* helper — ask one field */
async function _askFormField(ctx, tmpl, idx) {
  const field = tmpl.fields[idx];
  if (field.type === "select" && field.options?.length) {
    return ctx.reply(
      `*${field.label}*${field.required ? " *" : ""}:`,
      { parse_mode: "Markdown",
        reply_markup: { keyboard: field.options.map((o) => [o]), one_time_keyboard: true, resize_keyboard: true } },
    );
  }
  return ctx.reply(`*${field.label}*${field.required ? " *" : ""}:`, { parse_mode: "Markdown", ...backKb() });
}

/* helper — save form order */
async function _saveFormOrder(ctx, tmpl) {
  const { formId, formFullName, formPhone, formAnswers } = ctx.session;
  ctx.session = {};

  const order = await FormOrder.create({
    formId,
    formTitle: tmpl?.title || formId,
    userId:    ctx.from.id,
    username:  ctx.from.username || "",
    fullName:  formFullName,
    phone:     formPhone,
    answers:   formAnswers,
    status:    "new",
  });

  // Confirm to user
  let summary = `✅ *ትዕዛዝ ደረሰ!*\n━━━━━━━━━━━━━━━━\n${tmpl?.title || ""}\n\n👤 ${formFullName}\n📞 ${formPhone}\n`;
  for (const [k, v] of Object.entries(formAnswers || {})) summary += `• ${k}: ${v}\n`;
  summary += `\n📞 ለጥያቄ: ${SUPPORT_PHONE}`;

  await ctx.reply(summary, { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) });

  // Notify admins
  for (const aid of ADMIN_IDS)
    bot.telegram.sendMessage(
      aid,
      `📋 *አዲስ Form ትዕዛዝ!*\n━━━━━━━━━━━━━━━━\n${tmpl?.title}\n\n👤 ${formFullName}\n📞 ${formPhone}\n` +
      Object.entries(formAnswers || {}).map(([k,v]) => `• ${k}: ${v}`).join("\n") +
      `\n\n🆔 User: ${ctx.from.id}${ctx.from.username ? " @"+ctx.from.username : ""}\n⏰ ${new Date().toLocaleString("en-GB")}`,
      { parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[
          { text: "✅ ታይቷል",   callback_data: `ford_seen_${order._id}` },
          { text: "✔️ ተጠናቀቀ",  callback_data: `ford_done_${order._id}` },
          { text: "❌ ሰርዝ",     callback_data: `ford_cancel_${order._id}` },
        ]]}},
    ).catch(() => {});

  // Personal notify
  sendPersonalNotification(
    `📋 *Form Order — ${tmpl?.title}*\n👤 ${formFullName} | 📞 ${formPhone}\n` +
    Object.entries(formAnswers || {}).map(([k,v]) => `• ${k}: ${v}`).join("\n"),
  ).catch(() => {});
}

/* ─────────────────────────────────────────────────────────────
   SECTION F — FORM ORDER CALLBACKS
   (bot.action() handlers ፋይሉ ስር ጨምር — "22. ADMIN PANEL" ቀጥሎ)
   ─────────────────────────────────────────────────────────────
*/

bot.action(/^ford_(seen|done|cancel)_([a-f\d]{24})$/i, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const action = ctx.match[1], id = ctx.match[2];
  if (!isValidObjectId(id)) return;
  const statusMap = { seen: "seen", done: "done", cancel: "cancelled" };
  const labelMap  = { seen: "👁 ታይቷል", done: "✔️ ተጠናቀቀ", cancel: "❌ ተሰርዟል" };
  const order = await FormOrder.findByIdAndUpdate(id, { status: statusMap[action] }, { new: true });
  if (!order) return ctx.reply("Order አልተገኘም");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`${labelMap[action]} — ${order.formTitle}\n👤 ${order.fullName} (${order.phone})`);
  // Notify user
  if (action === "done")
    bot.telegram.sendMessage(order.userId,
      `✔️ *ትዕዛዝዎ ተጠናቀቀ!*\n${order.formTitle}\n\nለጥያቄ: ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" }).catch(() => {});
  if (action === "cancel")
    bot.telegram.sendMessage(order.userId,
      `❌ *ትዕዛዝዎ ተሰርዟል*\n${order.formTitle}\n\nለጥያቄ: ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" }).catch(() => {});
});

/* ─────────────────────────────────────────────────────────────
   SECTION G — ADMIN PANEL additions
   ─────────────────────────────────────────────────────────────

   1) adminPanelKb() ውስጥ ሁለት button ጨምር (ከ "add_product" ቀጥሎ):

   [Markup.button.callback("📝 Form ፍጠር",       "form_create")],
   [Markup.button.callback("📋 Form Orders",      "form_orders")],
   [Markup.button.callback("🚚 Cash Cargo ምዝ",   "admin_cash_cargo")],

   2) ቀጥሎ ያሉት handlers ጨምር:
*/

/* ── Form Create (Admin) ─────────────────────────────────── */
bot.action("form_create", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  ctx.session = { step: "FC_TITLE" };
  await ctx.reply(
    `*📝 አዲስ Form ፍጠር*\n━━━━━━━━━━━━━━━━\n\n` +
    `ደረጃ 1: *Button ስም ያስገቡ*\n\n` +
    `ምሳሌ:\n• 🍕 ፒዛ ትዕዛዝ\n• 🧴 ምርት ትዕዛዝ\n• 📦 ማቅረቢያ ጥያቄ`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* FC steps — inside TEXT FLOW, add these: */
if (step === "FC_TITLE") {
  if (txt.length < 2) return ctx.reply("ስም ያስገቡ:", backKb());
  ctx.session.fcTitle = txt;
  ctx.session.step    = "FC_DESC";
  return ctx.reply(
    `✅ Button ስም: *${txt}*\n\nደረጃ 2: *መግለጫ* (ምሳሌ: "ትዕዛዝ ለመስጠት ሙሉ ቅጹን ይሙሉ")\n\n_ሳይፈልጉ "—" ይጻፉ_`,
    { parse_mode: "Markdown", ...backKb() },
  );
}

if (step === "FC_DESC") {
  ctx.session.fcDesc = txt === "—" ? "" : txt;
  ctx.session.fcFields = [];
  ctx.session.step = "FC_FIELD_ADD";
  return ctx.reply(
    `*ደረጃ 3: ተጨማሪ ጥያቄዎች*\n\n` +
    `ስም እና ስልክ ሁሌ ይጠየቃሉ።\n\n` +
    `ተጨማሪ ጥያቄ ለማስፈጠር ቅርጸቱ:\n\`ስያሜ|ዓይነት\`\n\n` +
    `ዓይነቶች:\n• \`text\` — ጽሑፍ\n• \`number\` — ቁጥር\n• \`select:አ,ቢ,ሲ\` — ምርጫ\n\n` +
    `ምሳሌ:\n\`ብዛት|number\`\n\`መጠን|select:ትንሽ,መካከለኛ,ትልቅ\`\n\`ማስታወሻ|text\`\n\n` +
    `ሁሉም ዝርዝሮች ሲጨምሩ — ትዕዛዛቱን *"ጨርስ"* ይጻፉ`,
    { parse_mode: "Markdown", ...backKb() },
  );
}

if (step === "FC_FIELD_ADD") {
  if (txt.toLowerCase() === "ጨርስ" || txt === "done") {
    // Save form
    const { fcTitle, fcDesc, fcFields } = ctx.session;
    const formId = "form_" + fcTitle.replace(/\s+/g,"_").replace(/[^\w\u1200-\u137F]/g,"").slice(0,20) + "_" + Date.now();
    await FormTemplate.create({
      id:          formId,
      title:       fcTitle,
      description: fcDesc || "",
      fields:      fcFields || [],
      enabled:     true,
    });
    await loadFormTemplates();
    ctx.session = {};
    await ctx.reply(
      `✅ *Form ተፈጠረ!*\n━━━━━━━━━━━━━━━━\n\n*${fcTitle}*\n` +
      (fcDesc ? `📝 ${fcDesc}\n` : "") +
      (fcFields?.length ? `\n*ጥያቄዎች (${fcFields.length}):*\n` + fcFields.map((f,i) => `${i+1}. ${f.label} (${f.type})`).join("\n") : "\n_ስም እና ስልክ ብቻ_") +
      `\n\nButton ወዲያው ለደንበኞች ይታያል!`,
      { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
    );
    return;
  }
  // Parse field definition
  const parts = txt.split("|");
  if (parts.length < 2) return ctx.reply(
    `❌ ቅርጸቱ ስህተት። ምሳሌ:\n\`ብዛት|number\`\n\`መጠን|select:ትንሽ,መካከለኛ,ትልቅ\`\n\nወይም *"ጨርስ"* ይጻፉ`,
    { parse_mode: "Markdown", ...backKb() },
  );
  const label   = parts[0].trim();
  const typePart = parts[1].trim();
  let type = typePart, options = null;
  if (typePart.startsWith("select:")) {
    type    = "select";
    options = typePart.replace("select:", "").split(",").map((o) => o.trim()).filter(Boolean);
  }
  ctx.session.fcFields = ctx.session.fcFields || [];
  ctx.session.fcFields.push({ key: label, label, type, options, required: true });
  await ctx.reply(
    `✅ ጥያቄ ተጨምሯል: *${label}* (${type})\n\n` +
    `ጠቅላላ ጥያቄዎች: ${ctx.session.fcFields.length}\n\n` +
    `ሌላ ጥያቄ ለማስፈጠር ቅርጸቱ ይጻፉ — ወይም *"ጨርስ"* ይጻፉ`,
    { parse_mode: "Markdown", ...backKb() },
  );
  return;
}

/* ── Form Orders View (Admin) ────────────────────────────── */
bot.action("form_orders", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await loadFormTemplates();
  if (!FORM_TEMPLATES.length) return ctx.reply("Form ፎርም የለም — ፍጠሩ");
  const buttons = FORM_TEMPLATES.map((f) => [Markup.button.callback(`📋 ${f.title}`, `ford_view_${f.id}`)]);
  buttons.push([Markup.button.callback("📊 ሁሉም Orders ዛሬ", "ford_view_today")]);
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply("*Form Orders*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^ford_view_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const fid = ctx.match[1];
  let orders;
  if (fid === "today") {
    const today = new Date(); today.setHours(0,0,0,0);
    orders = await FormOrder.find({ createdAt: { $gte: today } }).sort({ createdAt: -1 }).lean();
  } else {
    orders = await FormOrder.find({ formId: fid, status: { $ne: "cancelled" } }).sort({ createdAt: -1 }).lean();
  }
  if (!orders.length) return ctx.reply("Order አልተገኘም");
  for (const o of orders.slice(0, 20)) {
    const date = new Date(o.createdAt).toLocaleDateString("en-GB");
    let txt2 = `📋 *${o.formTitle}* — ${date}\n👤 ${o.fullName} | 📞 ${o.phone}\n`;
    for (const [k,v] of Object.entries(o.answers || {})) txt2 += `• ${k}: ${v}\n`;
    txt2 += `ሁኔታ: ${o.status}`;
    await ctx.reply(txt2, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[
        { text: "✔️ ተጠናቀቀ", callback_data: `ford_done_${o._id}` },
        { text: "❌ ሰርዝ",    callback_data: `ford_cancel_${o._id}` },
      ]]},
    });
  }
});

/* ── Form Delete (Admin) ─────────────────────────────────── */
bot.action("form_delete_pick", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await loadFormTemplates();
  if (!FORM_TEMPLATES.length) return ctx.reply("Form የለም");
  const buttons = FORM_TEMPLATES.map((f) => [Markup.button.callback(`🗑 ${f.title}`, `form_del_${f.id}`)]);
  buttons.push([Markup.button.callback("🔙 ተመለስ", "back_to_admin")]);
  await ctx.reply("ሊሰርዙት የሚፈልጉትን Form:", Markup.inlineKeyboard(buttons));
});

bot.action(/^form_del_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await FormTemplate.deleteOne({ id: ctx.match[1] });
  await loadFormTemplates();
  await ctx.reply("✅ Form ተሰርዟል");
});

/* ─────────────────────────────────────────────────────────────
   SECTION H — Cash CARGO Registration (Admin)
   (ፋይሉ ውስጥ "admin_cash_reg" action ቀጥሎ ጨምር)
   ─────────────────────────────────────────────────────────────
*/

bot.action("admin_cash_cargo", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  // Pick direction first
  await ctx.reply(
    `*🚚 Cash Cargo ምዝገባ*\n\n_ደንበኛ ናቅድ ሲከፍል admin ያስገባሉ_\n\nአቅጣጫ ምረጡ:`,
    { parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [
        [{ text: "🔼 አዲስ አበባ → አማራ ክልል", callback_data: "csh_cgo_dir_toamhara" }],
        [{ text: "🔽 አማራ ክልል → አዲስ አበባ", callback_data: "csh_cgo_dir_toaa" }],
        [{ text: "🔙 ተመለስ", callback_data: "back_to_admin" }],
      ]}},
  );
});

bot.action("csh_cgo_dir_toamhara", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አዲስ አበባ → አማራ ክልል — መስመር ምረጡ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AMHARA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `csh_cgo_route_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "admin_cash_cargo")],
  ]));
});

bot.action("csh_cgo_dir_toaa", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply("አማራ ክልል → አዲስ አበባ — መስመር ምረጡ:", Markup.inlineKeyboard([
    ...ROUTES_TO_AA.map((r) => [Markup.button.callback(`${r.emoji} ${r.label}`, `csh_cgo_route_${r.id}`)]),
    [Markup.button.callback("🔙 ተመለስ", "admin_cash_cargo")],
  ]));
});

bot.action(/^csh_cgo_route_(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCbQuery("ፈቃድ የለዎትም").catch(() => {}); return; }
  await ctx.answerCbQuery().catch(() => {});
  const routeId = ctx.match[1];
  const ro      = byRoute(routeId);
  if (!ro) return ctx.reply("መስመር አልተገኘም");
  ctx.session = { step: "CASH_CGO_NAME", cashCargoRouteId: routeId };
  await ctx.reply(
    `${ro.emoji} *${ro.label}*\n\n💵 Cash Cargo ምዝገባ\n\n👤 ደንበኛው ሙሉ ስም:`,
    { parse_mode: "Markdown", ...backKb() },
  );
});

/* Cash Cargo TEXT steps — add inside bot.on("text") handler: */

if (step === "CASH_CGO_NAME") {
  if (txt.length < 3) return ctx.reply("ሙሉ ስም ያስገቡ (3+ ፊደል):", backKb());
  ctx.session.cashCargoName = txt;
  ctx.session.step          = "CASH_CGO_NBR";
  return ctx.reply("🏘 ሰፈር (ወይም ዳሽ —):", backKb());
}

if (step === "CASH_CGO_NBR") {
  ctx.session.cashCargoNbr = txt === "—" ? "" : txt.slice(0, 60);
  ctx.session.step         = "CASH_CGO_PHONE";
  return ctx.reply("📞 ስልክ ቁጥር:", backKb());
}

if (step === "CASH_CGO_PHONE") {
  ctx.session.cashCargoPhone = txt.replace(/\s/g, "");
  ctx.session.step           = "CASH_CGO_CARGO";
  return ctx.reply("📦 ጭነት ዓይነት (ምን ዓይነት እቃ?):", backKb());
}

if (step === "CASH_CGO_CARGO") {
  if (txt.length < 2 || txt.length > 200) return ctx.reply("ጭነቱን ያስገቡ (2–200 ፊደል):", backKb());
  ctx.session.cashCargoCargo = txt;
  ctx.session.step           = "CASH_CGO_KG";
  return ctx.reply("⚖️ ክብደት (ኪሎ):", backKb());
}

if (step === "CASH_CGO_KG") {
  const kg = parseFloat(txt.replace(/[^0-9.]/g, ""));
  if (!kg || kg <= 0 || kg > 2000) return ctx.reply("ትክክለኛ ቁጥር ያስገቡ (1–2000):", backKb());
  ctx.session.cashCargoKg = kg;
  ctx.session.step        = "CASH_CGO_TGID";
  return ctx.reply(
    `*ማጠቃለያ*\n━━━━━━━━━━━━━━━━\n` +
    `${byRoute(ctx.session.cashCargoRouteId)?.emoji} ${byRoute(ctx.session.cashCargoRouteId)?.label}\n` +
    `👤 ${ctx.session.cashCargoName}\n🏘 ${ctx.session.cashCargoNbr || "—"}\n📞 ${ctx.session.cashCargoPhone}\n` +
    `📦 ${ctx.session.cashCargoCargo} — *${kg} ኪሎ*\n` +
    `💳 Cash — *${kg * REG_PER_KG} ብር*\n\n` +
    `ደንበኛው Telegram User ID (ካለ — ለማሳወቅ)\n_ከሌለ 0 ይጻፉ:_`,
    { parse_mode: "Markdown", ...backKb() },
  );
}

if (step === "CASH_CGO_TGID") {
  const { cashCargoRouteId, cashCargoName, cashCargoNbr, cashCargoPhone, cashCargoCargo, cashCargoKg } = ctx.session;
  const ro     = byRoute(cashCargoRouteId);
  const tgId   = parseInt(txt.replace(/\D/g, ""), 10) || 0;
  const regFee = Math.round(cashCargoKg * REG_PER_KG);

  const r = await Reg.create({
    userId:          tgId || ctx.from.id,
    username:        tgId ? "" : (ctx.from.username || ""),
    fullName:        cashCargoName,
    phone:           cashCargoPhone,
    neighborhood:    cashCargoNbr || "",
    phoneUnverified: false,
    routeId:         cashCargoRouteId,
    cargoDesc:       cashCargoCargo,
    weightKg:        cashCargoKg,
    totalPrice:      regFee,
    paymentMethod:   "cash",
    paymentFileId:   null,
    status:          "approved",
    aiVerdict:       { method: "cash", admin: ctx.from?.id },
    autoApproved:    true,
  });

  ctx.session = {};

  const total = await routeWeight(cashCargoRouteId);
  await ctx.reply(
    `✅ *Cash Cargo ምዝገባ ተጠናቀቀ!*\n━━━━━━━━━━━━━━━━\n\n` +
    `${ro?.emoji} *${ro?.label}*\n` +
    `👤 ${cashCargoName}  |  📞 ${cashCargoPhone}\n` +
    `🏘 ሰፈር: ${cashCargoNbr || "—"}\n` +
    `📦 ${cashCargoCargo} — *${cashCargoKg} ኪሎ*\n` +
    `💵 Cash — ${regFee} ብር ✅\n\n` +
    `${capLine(total, ro?.targetKg || TARGET_KG_DEFAULT)}\n`,
    { parse_mode: "Markdown", ...(await mainKb(ctx.from?.id)) },
  );

  // Notify the customer if they have Telegram
  if (tgId) {
    bot.telegram.sendMessage(
      tgId,
      `✅ *ምዝገባ ተጠናቀቀ!*\n\n${ro?.emoji} *${ro?.label}*\n📦 ${cashCargoCargo} — ${cashCargoKg} ኪሎ\n💵 _ክፍያ በ አካል ተቀቢሏል_\n\nጭነቱ ሲላክ ይነገርዎታል!\n📞 ${SUPPORT_PHONE}`,
      { parse_mode: "Markdown" },
    ).catch(() => {});
    sendChannelInvite(tgId).catch(() => {});
  }

  sendPersonalNotification(
    `🚚 *Cash Cargo ምዝገባ!*\n${ro?.emoji} ${ro?.label}\n` +
    `👤 ${cashCargoName} | 📞 ${cashCargoPhone}\n` +
    `📦 ${cashCargoCargo} — ${cashCargoKg}ኪ | 💵 ${regFee}ብር\n✅ Admin ፈቅዷል`,
  ).catch(() => {});

  // Notify all admins
  for (const aid of ADMIN_IDS) {
    if (aid === ctx.from?.id) continue;
    bot.telegram.sendMessage(aid,
      `💵 *Cash Cargo ምዝገባ ደረሰ!*\n${ro?.emoji} ${ro?.label}\n` +
      `👤 ${cashCargoName} | ${cashCargoPhone}\n${cashCargoCargo} — ${cashCargoKg}ኪ`,
      { parse_mode: "Markdown" }).catch(() => {});
  }

  await checkCapacity(cashCargoRouteId).catch(() => {});
  return;
}
