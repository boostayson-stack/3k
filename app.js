(() => {
  "use strict";

  const STORE_KEY = "3k-jewelry-workspace-v2";
  const KARATS = [18, 21, 24];
  const NAV = [
    ["invoices", "📋", "الفواتير"],
    ["transactions", "🔁", "المعاملات"],
    ["customers", "👥", "العملاء"],
    ["new", "➕", "جديدة"],
    ["suppliers", "🤝", "الموردين"],
    ["balance", "⚖️", "المسواجي"],
    ["safe", "🏦", "الخزنة والمخزن"],
    ["debts", "🧾", "مديونيات القطاعي"],
    ["permissions", "🔐", "الصلاحيات"],
    ["backup", "💾", "نسخة احتياطية"],
    ["settings", "⚙️", "الإعدادات"]
  ];
  const COLLECTIONS = ["invoices", "customers", "suppliers", "traders", "transactions"];
  const cloud = { user: null, csrfToken: "", revision: null, users: [], permissions: [], syncEnabled: false, lastPayload: "", syncTimer: null, busy: false };
  const emptyData = () => ({
    version: 2,
    page: "invoices",
    range: "الكل",
    search: "",
    invoices: [],
    customers: [],
    suppliers: [],
    traders: [],
    transactions: [],
    settings: { shopName: "3K Jewelry Store", phone: "", emblem: "👑", defaultKarat: 21, footer: "" },
    users: [{ email: "صاحب المحل", role: "مالك" }]
  });
  const scopedStoreKey = email => email ? `${STORE_KEY}:${email.toLowerCase()}` : STORE_KEY;
  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    state = saved && saved.version === 2 ? { ...emptyData(), ...saved } : emptyData();
  } catch (error) {
    console.error("تعذر قراءة بيانات 3K المحفوظة:", error);
    state = emptyData();
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const fmt = (value, decimals = 2) => numeric(value).toLocaleString("ar-EG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const grams = value => `${fmt(value, 2)} g`;
  const pounds = value => `${fmt(value, 2)} ج`;
  const gold21 = (weight, karat) => numeric(weight) * numeric(karat) / 21;
  const timestamp = date => new Date(date || Date.now()).toLocaleString("ar-EG");
  const roundingDescription = amount => amount > 0
    ? `زيادة تقريب ${pounds(amount)}`
    : `خصم كسور ${pounds(Math.abs(amount))}`;
  const persist = () => {
    localStorage.setItem(scopedStoreKey(cloud.user?.email), JSON.stringify(state));
    scheduleCloudSync();
  };
  const byId = (list, key) => list.find(item => item.id === key);
  const customerName = invoice => invoice.customerName || byId(state.customers, invoice.customerId)?.name || "عميل نقدي";
  const clampMoney = value => Math.max(0, Math.round(numeric(value) * 100) / 100);

  function whatsappPhone(value) {
    let phone = String(value || "").replace(/\D/g, "");
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (phone.startsWith("0")) phone = `20${phone.slice(1)}`;
    else if (phone.length === 10 && phone.startsWith("1")) phone = `20${phone}`;
    return /^\d{10,15}$/.test(phone) ? phone : "";
  }

  function openInvoiceWhatsApp(invoice) {
    const phone = whatsappPhone(invoice.phone || byId(state.customers, invoice.customerId)?.phone);
    if (!phone) return { opened: false, reason: "phone" };

    const items = [
      ...invoice.sales.map(item => ({ ...item, label: item.description || "مبيعات" })),
      ...invoice.purchases.map(item => ({ ...item, label: item.description || item.kind || "شراء كسر", deduction: true })),
      ...invoice.workItems.map(item => ({ ...item, label: item.description || "شغل" })),
      ...invoice.scrapItems.map(item => ({ ...item, label: item.description || item.kind || "كسر" }))
    ];
    const itemLines = items.slice(0, 20).map(item =>
      `- ${item.label}: ${grams(item.weight)} عيار ${item.karat}${item.total !== undefined ? `، ${item.deduction ? "-" : ""}${pounds(item.total)}` : item.fee !== undefined ? `، أجرة ${pounds(item.fee)}` : ""}`
    );
    if (items.length > itemLines.length) itemLines.push(`- وباقي الأصناف (${items.length - itemLines.length} صنف)`);

    const message = [
      `أهلًا ${customerName(invoice)}،`,
      `فاتورة ${invoice.type} من ${state.settings.shopName}`,
      `رقم الفاتورة: #${invoice.number || invoice.id.slice(-6)}`,
      `التاريخ: ${timestamp(invoice.createdAt)}`,
      ...(itemLines.length ? ["تفاصيل الفاتورة:", ...itemLines] : []),
      `الإجمالي المستحق: ${pounds(invoice.due)}`,
      ...(invoice.roundingAdjustment ? [roundingDescription(invoice.roundingAdjustment)] : []),
      `المدفوع: ${pounds(invoice.paid)}`,
      `المتبقي: ${pounds(invoice.remaining)}`,
      "شكرًا لثقتكم بنا."
    ].join("\n");
    const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const whatsappUrl = mobileDevice
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    const whatsappWindow = window.open(whatsappUrl, "_blank");
    if (!whatsappWindow) return { opened: false, reason: "popup" };
    whatsappWindow.opener = null;
    return { opened: true };
  }

  function notify(message, error = false) {
    $(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    if (error) toast.style.background = "#8b312d";
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 3000);
  }

  function hasPermission(resource, action) {
    return !cloud.user || cloud.user.isOwner || cloud.user.permissions?.includes(`${resource}.${action}`);
  }

  function canOpenPage(page) {
    if (!cloud.user || cloud.user.isOwner) return true;
    if (page === "settings") return true;
    if (page === "permissions") return false;
    if (page === "safe") return hasPermission("safe", "view") && hasPermission("transactions", "view");
    if (page === "debts") return hasPermission("debts", "view") && hasPermission("invoices", "view");
    if (page === "balance") return hasPermission("balance", "view") && hasPermission("traders", "view") && hasPermission("transactions", "view");
    const required = {
      invoices: [["invoices", "view"]],
      transactions: [["transactions", "view"]],
      customers: [["customers", "view"]],
      suppliers: [["suppliers", "view"]],
      backup: [["backup", "view"]],
      settings: []
    }[page] || [];
    return required.some(([resource, action]) => hasPermission(resource, action));
  }

  function canRunAction(action, button) {
    const kind = button?.dataset.kind;
    const requirements = {
      "new-wholesale": [["invoices", "view"], ["invoices", "create"]],
      "new-retail": [["invoices", "view"], ["invoices", "create"]],
      "add-person": [[kind === "supplier" ? "suppliers" : "customers", "view"], [kind === "supplier" ? "suppliers" : "customers", "create"]],
      "edit-person": [[kind === "supplier" ? "suppliers" : "customers", "view"], [kind === "supplier" ? "suppliers" : "customers", "update"]],
      "add-trader": [["traders", "view"], ["traders", "create"]],
      "trader-transaction": [["transactions", "view"], ["transactions", "create"], ["traders", "view"]],
      "new-transaction": [["transactions", "view"], ["transactions", "create"]],
      "collect-debt": [["debts", "view"], ["debts", "update"], ["invoices", "view"], ["invoices", "update"], ["transactions", "view"], ["transactions", "create"]],
      "export-json": [["backup", "view"], ["backup", "export"]],
      "export-csv": [["backup", "view"], ["backup", "export"]],
      "export-xlsx": [["backup", "view"], ["backup", "export"]]
    }[action];
    return !requirements || requirements.every(([resource, permission]) => hasPermission(resource, permission));
  }

  function enforceVisiblePermissions() {
    $$("#main-content [data-action]").forEach(button => {
      if (!canRunAction(button.dataset.action, button)) button.hidden = true;
    });
    const settingsForm = $("#settings-form");
    if (settingsForm && !hasPermission("settings", "update")) {
      $$("input,select,textarea,button", settingsForm).forEach(field => { field.disabled = true; });
    }
  }

  function cloudSyncKey() {
    return cloud.user ? `3k-cloud-sync:${cloud.user.email}` : "";
  }

  function cloudLastPayloadKey() {
    return cloud.user ? `3k-cloud-last:${cloud.user.email}` : "";
  }

  function loadLocalState(key) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (!saved || saved.version !== 2) return emptyData();
      const loaded = { ...emptyData(), ...saved };
      for (const collection of COLLECTIONS) {
        if (!Array.isArray(loaded[collection])) loaded[collection] = [];
      }
      loaded.settings = { ...emptyData().settings, ...(loaded.settings || {}) };
      loaded.invoices = loaded.invoices.map(normalizeInvoice);
      return loaded;
    } catch (error) {
      console.error("تعذر قراءة بيانات المستخدم المحفوظة:", error);
      return emptyData();
    }
  }

  function cloudPayload(data = state) {
    return {
      version: 2,
      ...Object.fromEntries(COLLECTIONS.map(key => [key, data[key]])),
      settings: data.settings
    };
  }

  async function apiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (options.csrf && cloud.csrfToken) headers.set("X-CSRF-Token", cloud.csrfToken);
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || `تعذر إكمال الطلب (${response.status}).`);
      error.status = response.status;
      error.revision = result.revision;
      if (response.status === 401 && cloud.user) {
        const syncKey = cloudSyncKey();
        if (cloud.syncTimer) window.clearTimeout(cloud.syncTimer);
        cloud.user = null;
        cloud.csrfToken = "";
        cloud.revision = null;
        cloud.syncEnabled = false;
        localStorage.removeItem(syncKey);
        state = loadLocalState(STORE_KEY);
        render();
        notify("انتهت جلسة الحساب أو تم إيقافه. عُد إلى بيانات هذا الجهاز.", true);
      }
      throw error;
    }
    return result;
  }

  async function fetchCloudStore() {
    const result = await apiRequest("/api/data");
    cloud.revision = result.revision;
    return result.data;
  }

  function mergeCollection(local, remote) {
    const records = new Map((remote || []).map(record => [record.id, record]));
    for (const record of local || []) records.set(record.id, record);
    return [...records.values()];
  }

  async function writeCloudStore(data) {
    try {
      const result = await apiRequest("/api/data", {
        method: "PUT",
        csrf: true,
        body: JSON.stringify({ revision: cloud.revision, data })
      });
      cloud.revision = result.revision;
      cloud.lastPayload = JSON.stringify(data);
      localStorage.setItem(`3k-cloud-revision:${cloud.user.email}`, String(result.revision));
      localStorage.setItem(cloudLastPayloadKey(), cloud.lastPayload);
    } catch (error) {
      if (error.status === 409) cloud.syncEnabled = false;
      throw error;
    }
  }

  async function reconcileCloud(mode) {
    if (!cloud.user || cloud.user.forcePasswordChange) {
      notify("يجب تغيير كلمة المرور قبل استخدام المزامنة.", true);
      return;
    }
    cloud.busy = true;
    try {
      const remote = await fetchCloudStore();
      if (mode === "load") {
        if (!window.confirm("سيتم استبدال بيانات هذا الجهاز بالبيانات المسموح بها على الخادم. نزّل نسخة احتياطية محلية أولًا إذا أردت الاحتفاظ بها. هل تتابع؟")) return;
        state = { ...emptyData(), ...remote, settings: { ...emptyData().settings, ...(remote.settings || {}) } };
        cloud.lastPayload = JSON.stringify(cloudPayload());
        localStorage.setItem(cloudLastPayloadKey(), cloud.lastPayload);
        localStorage.setItem(`3k-cloud-revision:${cloud.user.email}`, String(cloud.revision));
      } else {
        const merged = cloudPayload();
        for (const key of COLLECTIONS) {
          if (cloud.user.isOwner || cloud.user.permissions.includes(`${key}.view`)) {
            merged[key] = mergeCollection(state[key], remote[key]);
          }
        }
        if (cloud.user.isOwner || cloud.user.permissions.includes("settings.view")) {
          merged.settings = { ...(remote.settings || {}), ...state.settings };
        }
        await writeCloudStore(merged);
        state = { ...state, ...merged };
      }
      cloud.syncEnabled = true;
      localStorage.setItem(cloudSyncKey(), "true");
      persist();
      render();
      notify(mode === "load" ? "تم تحميل بيانات الخادم وتفعيل المزامنة." : "تم دمج البيانات وتفعيل المزامنة.");
    } catch (error) {
      console.error("تعذرت مزامنة بيانات 3K:", error);
      if (cloud.user) {
        cloud.syncEnabled = false;
        localStorage.removeItem(cloudSyncKey());
      }
      notify(error.message || "تعذرت مزامنة البيانات.", true);
    } finally {
      cloud.busy = false;
      render();
    }
  }

  async function syncNow() {
    if (!cloud.syncEnabled || !cloud.user || cloud.user.forcePasswordChange || cloud.busy) return;
    const payload = cloudPayload();
    const serialized = JSON.stringify(payload);
    if (serialized === cloud.lastPayload) return;
    cloud.busy = true;
    try {
      await writeCloudStore(payload);
    } catch (error) {
      console.error("تعذر حفظ التغييرات على الخادم:", error);
      const syncKey = cloudSyncKey();
      cloud.syncEnabled = false;
      localStorage.removeItem(syncKey);
      notify(error.status === 409
        ? "توجد تغييرات أحدث على جهاز آخر. أوقفت المزامنة؛ راجع بيانات الخادم ثم أعد الدمج."
        : `${error.message || "تعذر حفظ التغييرات على الخادم."} أوقفت المزامنة حتى تراجع التغييرات.`, true);
    } finally {
      cloud.busy = false;
    }
  }

  function scheduleCloudSync() {
    if (!cloud.syncEnabled || !cloud.user) return;
    window.clearTimeout(cloud.syncTimer);
    cloud.syncTimer = window.setTimeout(syncNow, 700);
  }

  async function loadCloudSession() {
    if (location.protocol === "file:") return;
    try {
      const session = await apiRequest("/api/auth/session");
      cloud.user = session.user;
      state = loadLocalState(scopedStoreKey(cloud.user.email));
      cloud.syncEnabled = localStorage.getItem(cloudSyncKey()) === "true";
      const csrf = await apiRequest("/api/auth/csrf", { method: "POST" });
      cloud.csrfToken = csrf.csrfToken;
      if (cloud.syncEnabled && !cloud.user.forcePasswordChange) {
        await fetchCloudStore();
        cloud.lastPayload = localStorage.getItem(cloudLastPayloadKey()) || "";
      }
      if (state.page === "permissions" && cloud.user.isOwner) loadCloudUsers();
    } catch (error) {
      if (error.status !== 401) console.warn("خدمة الحسابات السحابية غير متاحة؛ يعمل التطبيق محليًا.", error);
    } finally {
      if (cloud.user) persist();
      render();
    }
  }

  async function loadCloudUsers() {
    if (!cloud.user?.isOwner) return;
    try {
      const [users, permissions] = await Promise.all([
        apiRequest("/api/users"),
        apiRequest("/api/permissions")
      ]);
      cloud.users = users.users;
      cloud.permissions = permissions.permissions;
      if (state.page === "permissions") render();
      return true;
    } catch (error) {
      console.error("تعذر تحميل حسابات المستخدمين:", error);
      notify(error.message, true);
      return false;
    }
  }

  async function handleCloudLogin(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      const result = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") })
      });
      cloud.user = result.user;
      cloud.csrfToken = result.csrfToken;
      state = loadLocalState(scopedStoreKey(cloud.user.email));
      cloud.syncEnabled = localStorage.getItem(cloudSyncKey()) === "true" && !cloud.user.forcePasswordChange;
      if (cloud.syncEnabled) {
        await fetchCloudStore();
        cloud.lastPayload = localStorage.getItem(cloudLastPayloadKey()) || "";
      }
      persist();
      render();
      if (cloud.user.isOwner) loadCloudUsers();
      notify(cloud.user.forcePasswordChange ? "تم الدخول. غيّر كلمة المرور المؤقتة للمتابعة." : "تم تسجيل الدخول؛ اختر طريقة التعامل مع البيانات المحلية.");
    } catch (error) {
      console.error("تعذر تسجيل الدخول إلى 3K:", error);
      notify(error.message || "تعذر تسجيل الدخول. تحقق من اتصال الخادم.", true);
    }
  }

  async function handleCloudLogout() {
    if (cloud.syncTimer) window.clearTimeout(cloud.syncTimer);
    try {
      await apiRequest("/api/auth/logout", { method: "POST", csrf: true, body: "{}" });
    } catch (error) {
      console.error("تعذر تسجيل الخروج من الخادم:", error);
      notify(error.message || "تعذر تسجيل الخروج.", true);
      return;
    }
    cloud.user = null;
    cloud.csrfToken = "";
    cloud.revision = null;
    cloud.syncEnabled = false;
    state = loadLocalState(STORE_KEY);
    render();
    notify("تم تسجيل الخروج. بيانات هذا الحساب محفوظة في مساحة منفصلة على هذا الجهاز.");
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      await apiRequest("/api/auth/password", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ currentPassword: values.get("currentPassword"), newPassword: values.get("newPassword") })
      });
      cloud.user.forcePasswordChange = false;
      persist();
      render();
      notify("تم تغيير كلمة المرور.");
    } catch (error) {
      console.error("تعذر تغيير كلمة المرور:", error);
      notify(error.message || "تعذر تغيير كلمة المرور.", true);
    }
  }

  async function createCloudUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest("/api/users", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          email: values.get("email"),
          temporaryPassword: values.get("temporaryPassword"),
          permissions: values.getAll("permissions")
        })
      });
      if (!await loadCloudUsers()) return;
      render();
      notify("تم إنشاء الحساب. شارك كلمة المرور المؤقتة مع المستخدم بأمان.");
    } catch (error) {
      console.error("تعذر إنشاء حساب المستخدم:", error);
      notify(error.message || "تعذر إنشاء الحساب.", true);
    }
  }

  async function updateCloudUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest(`/api/users/${encodeURIComponent(form.dataset.userId)}`, {
        method: "PATCH",
        csrf: true,
        body: JSON.stringify({
          active: values.has("active"),
          permissions: values.getAll("permissions")
        })
      });
      if (!await loadCloudUsers()) return;
      render();
      notify("تم حفظ الصلاحيات.");
    } catch (error) {
      console.error("تعذر حفظ صلاحيات المستخدم:", error);
      notify(error.message || "تعذر حفظ الصلاحيات.", true);
    }
  }

  async function deleteCloudUser(userId) {
    if (!window.confirm("سيتم حذف الحساب وإلغاء جلساته. هل تريد المتابعة؟")) return;
    try {
      await apiRequest(`/api/users/${encodeURIComponent(userId)}`, { method: "DELETE", csrf: true });
      if (!await loadCloudUsers()) return;
      render();
      notify("تم حذف الحساب.");
    } catch (error) {
      console.error("تعذر حذف حساب المستخدم:", error);
      notify(error.message || "تعذر حذف الحساب.", true);
    }
  }

  function totals(items, property) {
    return items.reduce((sum, item) => sum + numeric(item[property]), 0);
  }

  function calculateRetail(sales, purchases) {
    const salesTotal = totals(sales, "total");
    const purchaseTotal = totals(purchases, "total");
    const saleWeight21 = totals(sales, "weight21");
    const scrapWeight21 = totals(purchases, "weight21");
    return {
      salesTotal,
      purchaseTotal,
      due: salesTotal - purchaseTotal,
      refundDue: Math.max(0, purchaseTotal - salesTotal),
      saleWeight21,
      scrapWeight21,
      netWeight21: saleWeight21 - scrapWeight21
    };
  }

  function calculateWholesale(workItems, scrapItems, paid) {
    const workFees = totals(workItems, "fee");
    const scrapFees = totals(scrapItems, "fee");
    const workWeight21 = totals(workItems, "weight21");
    const scrapWeight21 = totals(scrapItems, "weight21");
    const due = workFees + scrapFees;
    return {
      workFees,
      scrapFees,
      due,
      paid: clampMoney(paid),
      remaining: due - clampMoney(paid),
      workWeight21,
      scrapWeight21,
      netWeight21: workWeight21 - scrapWeight21
    };
  }

  function normalizeInvoice(invoice) {
    const copy = { ...invoice };
    copy.payments ||= [];
    copy.sales ||= [];
    copy.purchases ||= [];
    copy.workItems ||= [];
    copy.scrapItems ||= [];
    copy.paid = copy.payments.length
      ? copy.payments.reduce((sum, payment) => sum + numeric(payment.amount), 0)
      : numeric(copy.paid);
    copy.due = numeric(copy.due);
    copy.roundingAdjustment = numeric(copy.roundingAdjustment);
    copy.remaining = Math.max(0, copy.due - copy.paid);
    return copy;
  }

  function renderNav() {
    const button = ([key, icon, label]) => `<button class="nav-btn ${state.page === key ? "active" : ""}" data-page="${key}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
    const visibleNav = NAV.filter(([key]) => key === "new"
      ? (hasPermission("invoices", "view") && hasPermission("invoices", "create")) || (hasPermission("transactions", "view") && hasPermission("transactions", "create"))
      : canOpenPage(key));
    $("#side-nav").innerHTML = visibleNav.map(button).join("");
    $("#mobile-nav").innerHTML = ["new", "customers", "transactions", "invoices"].map(key => NAV.find(item => item[0] === key)).filter(item => item && visibleNav.some(([key]) => key === item[0])).map(button).join("");
    $(".account").innerHTML = cloud.user
      ? `الحساب<strong>${safe(cloud.user.email)}</strong><small>${cloud.user.isOwner ? "مالك" : "مستخدم"}</small>`
      : `المحل<strong>${safe(state.settings.shopName)}</strong>`;
    $("#backup-button").hidden = !!cloud.user && (!hasPermission("backup", "view") || !hasPermission("backup", "export"));
    $(".brand-name").textContent = state.settings.shopName;
    $(".top-center .coin").textContent = state.settings.emblem || "🪙";
    document.title = `${state.settings.shopName} | حسابات الذهب`;
    const contact = $(".top-help");
    if (state.settings.phone) {
      contact.innerHTML = `للمساعدة أو الاستفسار تواصل معنا <a href="tel:${safe(state.settings.phone)}">${safe(state.settings.phone)}</a>`;
    } else {
      contact.textContent = cloud.syncEnabled ? "حسابات الذهب · المزامنة مفعّلة" : "حسابات الذهب · بياناتك محفوظة على هذا الجهاز";
    }
  }

  function render() {
    if (!canOpenPage(state.page)) state.page = NAV.find(([key]) => canOpenPage(key))?.[0] || "invoices";
    renderNav();
    const main = $("#main-content");
    switch (state.page) {
      case "invoices": main.innerHTML = invoicesPage(); break;
      case "customers": main.innerHTML = peoplePage("customers"); break;
      case "suppliers": main.innerHTML = peoplePage("suppliers"); break;
      case "balance": main.innerHTML = tradersPage(); break;
      case "transactions": main.innerHTML = transactionsPage(); break;
      case "safe": main.innerHTML = safePage(); break;
      case "debts": main.innerHTML = debtsPage(); break;
      case "permissions": main.innerHTML = permissionsPage(); break;
      case "settings": main.innerHTML = settingsPage(); break;
      case "backup": main.innerHTML = backupPage(); break;
      default: state.page = "invoices"; main.innerHTML = invoicesPage();
    }
    bindMain();
    enforceVisiblePermissions();
  }

  function visibleInvoices() {
    const now = new Date();
    const start = new Date(now);
    if (state.range === "اليوم") start.setHours(0, 0, 0, 0);
    if (state.range === "الأسبوع") start.setDate(start.getDate() - 7);
    if (state.range === "الشهر") start.setMonth(start.getMonth() - 1);
    if (state.range === "السنة") start.setFullYear(start.getFullYear() - 1);
    const query = state.search.trim().toLocaleLowerCase();
    return state.invoices.map(normalizeInvoice).filter(invoice => {
      const date = new Date(invoice.createdAt);
      const dateOk = state.range === "مخصص"
        ? (!state.fromDate || date >= new Date(`${state.fromDate}T00:00:00`)) && (!state.toDate || date <= new Date(`${state.toDate}T23:59:59`))
        : state.range === "الكل" || date >= start;
      const searchOk = !query || `${invoice.id} ${invoice.customerName} ${invoice.phone}`.toLocaleLowerCase().includes(query);
      return dateOk && searchOk;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function invoicesPage() {
    const invoices = visibleInvoices();
    const workWeight = invoices.reduce((sum, invoice) => sum + numeric(invoice.goldSales21), 0);
    const scrapWeight = invoices.reduce((sum, invoice) => sum + numeric(invoice.goldScrap21), 0);
    const fees = invoices.reduce((sum, invoice) => sum + numeric(invoice.due), 0);
    const paid = invoices.reduce((sum, invoice) => sum + numeric(invoice.paid), 0);
    const ranges = ["الكل", "اليوم", "الأسبوع", "الشهر", "السنة"];
    const rows = invoices.map(invoice => `<tr data-invoice="${safe(invoice.id)}">
      <td><button class="table-link" data-action="view-invoice" data-id="${safe(invoice.id)}">#${safe(invoice.number || invoice.id.slice(-6))}</button></td>
      <td>${safe(customerName(invoice))}${invoice.phone ? `<small class="muted block">${safe(invoice.phone)}</small>` : ""}</td>
      <td>${safe(invoice.type)}</td><td>${grams(invoice.goldSales21)}</td><td>${pounds(invoice.due)}</td>
      <td>${timestamp(invoice.createdAt)}</td><td>${statusBadge(invoice)}</td>
    </tr>`).join("");
    return `<div class="subscription">✨ نظام حسابات <strong>${safe(state.settings.shopName)}</strong> — تُحفظ البيانات محليًا على هذا الجهاز.</div>
      <div class="page-head"><h1>📋 الفواتير</h1><div class="head-actions">
        <button class="btn" data-action="new-wholesale">＋ جملة</button><button class="btn btn-primary" data-action="new-retail">＋ قطاعي</button>
      </div></div>
      <div class="filters">${ranges.map(range => `<button class="filter-btn ${state.range === range ? "active" : ""}" data-range="${range}">${range}</button>`).join("")}<button class="filter-btn" data-action="date-range">📅 مخصص</button></div>
      <section class="stats">
        <div class="stat-card gold"><div class="stat-title"><span>🪙 الذهب (معادل عيار ٢١)</span><span>g</span></div>
          <div class="stat-row"><span>إجمالي الشغل المسلم:</span><strong>${grams(workWeight)}</strong></div><div class="stat-row"><span>إجمالي الكسر المستلم:</span><strong>${grams(scrapWeight)}</strong></div></div>
        <div class="stat-card blue"><div class="stat-title"><span>💰 الأجور</span><span>ج</span></div>
          <div class="stat-row"><span>إجمالي الأجور المطلوبة:</span><strong>${pounds(fees)}</strong></div><div class="stat-row"><span>إجمالي الأجور المدفوعة:</span><strong>${pounds(paid)}</strong></div></div>
      </section>
      <div class="search"><input id="invoice-search" type="search" value="${safe(state.search)}" placeholder="🔍 بحث بالاسم أو الهاتف..."></div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>النوع</th><th>الشغل (عيار٢١)</th><th>الأجور</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("📋", state.search ? "لا توجد نتائج مطابقة" : "لا توجد فواتير بعد", "new-retail", "أنشئ أول فاتورة")}
    `;
  }

  function statusBadge(invoice) {
    const settled = invoice.remaining <= 0.005;
    return `<span class="badge ${settled ? "" : "badge-warning"}">${settled ? "مكتملة" : `متبقي ${pounds(invoice.remaining)}`}</span>`;
  }

  function emptyState(icon, text, action, label) {
    return `<div class="empty"><div class="empty-icon">${icon}</div><p>${text}</p>${action ? `<button class="btn btn-primary" data-action="${action}">${label}</button>` : ""}</div>`;
  }

  function peoplePage(kind) {
    const customers = kind === "customers";
    const list = customers ? state.customers : state.suppliers;
    const label = customers ? "العملاء" : "الموردين";
    const singular = customers ? "عميل" : "مورد";
    const hasBalanceData = customers ? hasPermission("invoices", "view") : hasPermission("transactions", "view");
    const query = state.search.trim().toLocaleLowerCase();
    const matches = list.filter(item => `${item.name} ${item.phone || ""}`.toLocaleLowerCase().includes(query));
    const rows = matches.map(person => {
      const openBalance = !hasBalanceData ? null : customers
        ? openCustomerCash(person.id)
        : state.transactions.filter(tx => tx.partyId === person.id && tx.partyType === "supplier").reduce((sum, tx) => {
          if (tx.kind === "سداد مورد") return sum - numeric(tx.amount);
          return sum + numeric(tx.amount);
        }, 0);
      const count = !hasBalanceData ? null : customers ? state.invoices.filter(invoice => invoice.customerId === person.id).length : state.transactions.filter(tx => tx.partyId === person.id).length;
      return `<tr><td><button class="table-link" data-action="person-details" data-kind="${customers ? "customer" : "supplier"}" data-id="${safe(person.id)}">${safe(person.name)}</button></td>
        <td>${safe(person.phone || "—")}</td><td>${count === null ? "—" : count}</td><td>${openBalance === null ? "—" : pounds(openBalance)}</td>
        <td><button class="btn btn-small" data-action="edit-person" data-kind="${customers ? "customer" : "supplier"}" data-id="${safe(person.id)}">تعديل</button></td></tr>`;
    }).join("");
    return `<div class="page-head"><h1>${customers ? "👥" : "🤝"} ${label}</h1>
      <button class="btn btn-primary" data-action="add-person" data-kind="${customers ? "customer" : "supplier"}">＋ ${singular} جديد</button></div>
      <div class="search"><input id="people-search" type="search" value="${safe(state.search)}" placeholder="🔍 بحث بالاسم أو الهاتف..."></div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>عدد التعاملات</th><th>الرصيد النقدي</th><th>إجراءات</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState(customers ? "👥" : "🤝", query ? "لا توجد نتائج مطابقة" : `لا يوجد ${label} بعد`, `add-person`, `أضف أول ${singular}`)}
    `;
  }

  function openCustomerCash(customerId) {
    return state.invoices.filter(invoice => invoice.customerId === customerId)
      .reduce((sum, invoice) => sum + Math.max(0, numeric(invoice.due) - numeric(invoice.paid)), 0);
  }

  function tradersPage() {
    const query = state.search.trim().toLocaleLowerCase();
    const traders = state.traders.filter(item => `${item.name} ${item.phone || ""}`.toLocaleLowerCase().includes(query));
    const cashOwed = state.transactions.filter(tx => tx.partyType === "trader" && tx.direction === "from-us").reduce((sum, tx) => sum + numeric(tx.amount), 0);
    const cashDueUs = state.transactions.filter(tx => tx.partyType === "trader" && tx.direction === "to-us").reduce((sum, tx) => sum + numeric(tx.amount), 0);
    const goldOwed = state.transactions.filter(tx => tx.partyType === "trader" && tx.direction === "from-us").reduce((sum, tx) => sum + numeric(tx.gold21), 0);
    const rows = traders.map(trader => {
      const txs = state.transactions.filter(tx => tx.partyId === trader.id && tx.partyType === "trader");
      const owes = txs.filter(tx => tx.direction === "from-us");
      const due = txs.filter(tx => tx.direction === "to-us");
      return `<tr><td><button class="table-link" data-action="trader-details" data-id="${safe(trader.id)}">${safe(trader.name)}</button></td>
        <td>${safe(trader.phone || "—")}</td><td>${pounds(owes.reduce((sum, tx) => sum + numeric(tx.amount), 0))}</td>
        <td>${pounds(due.reduce((sum, tx) => sum + numeric(tx.amount), 0))}</td>
        <td>${grams(owes.reduce((sum, tx) => sum + numeric(tx.gold21), 0))}</td>
        <td><button class="btn btn-small" data-action="trader-transaction" data-id="${safe(trader.id)}">＋ معاملة</button></td></tr>`;
    }).join("");
    return `<div class="page-head"><h1>⚖️ المسواجي</h1><button class="btn btn-primary" data-action="add-trader">＋ تاجر جديد</button></div>
      <section class="stats stats-three">
        <div class="stat-card"><div class="stat-title">💸 علينا نقدية</div><strong>${pounds(cashOwed)}</strong></div>
        <div class="stat-card"><div class="stat-title">💰 لنا نقدية</div><strong>${pounds(cashDueUs)}</strong></div>
        <div class="stat-card gold"><div class="stat-title">⚖️ علينا ذهب (عيار٢١)</div><strong>${grams(goldOwed)}</strong></div>
      </section>
      <div class="search"><input id="trader-search" type="search" value="${safe(state.search)}" placeholder="🔍 بحث باسم التاجر أو الهاتف..."></div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>التاجر</th><th>الهاتف</th><th>علينا نقدية</th><th>لنا نقدية</th><th>علينا ذهب</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("⚖️", "لا يوجد تجار كسر بعد", "add-trader", "أضف أول تاجر")}
    `;
  }

  function transactionRecords() {
    const query = state.search.trim().toLocaleLowerCase();
    const from = $("#from-date")?.value;
    const to = $("#to-date")?.value;
    return state.transactions.filter(tx => {
      const name = tx.partyName || customerName(byId(state.invoices, tx.invoiceId) || {});
      const searchable = `${name} ${tx.memo || ""} ${tx.kind || ""}`.toLocaleLowerCase();
      const date = tx.createdAt.slice(0, 10);
      return (!query || searchable.includes(query)) && (!from || date >= from) && (!to || date <= to) && (state.txFilter === "الكل" || tx.group === state.txFilter);
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function transactionsPage() {
    const list = transactionRecords();
    const types = ["الكل", "جملة", "قطاعي", "سداد عملاء", "موردين", "مسواجي"];
    const rows = list.map(tx => `<tr><td>${timestamp(tx.createdAt)}</td><td>${safe(tx.partyName || "—")}</td><td>${safe(tx.kind || tx.group)}</td>
      <td>${tx.amount || tx.cashOut ? pounds(numeric(tx.amount) - numeric(tx.cashOut)) : grams(tx.gold21)}</td><td>${safe(tx.paymentMethod || "—")}</td><td>${safe(tx.memo || "—")}</td></tr>`).join("");
    return `<div class="page-head"><h1>🔁 المعاملات</h1><div class="head-actions"><button class="btn" data-action="refresh">🔄 تحديث</button><button class="btn btn-primary" data-action="new-transaction">＋ معاملة جديدة</button></div></div>
      <div class="search"><input id="tx-search" type="search" value="${safe(state.search)}" placeholder="🔍 ابحث باسم العميل / المورد / التاجر..."></div>
      <div class="filters">${types.map(type => `<button class="filter-btn ${state.txFilter === type ? "active" : ""}" data-tx-filter="${type}">${type}</button>`).join("")}</div>
      <div class="date-filter"><label>من<input id="from-date" type="date" value="${safe(state.fromDate || "")}"></label><label>إلى<input id="to-date" type="date" value="${safe(state.toDate || "")}"></label><strong>${list.length} معاملة</strong></div>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>العميل / الطرف</th><th>البيان</th><th>المبلغ</th><th>طريقة الدفع</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("🔁", "لا توجد معاملات مطابقة", "new-transaction", "إضافة معاملة")}
    `;
  }

  function safePage() {
    const retailSales21 = state.invoices.filter(i => i.type === "قطاعي").reduce((sum, i) => sum + numeric(i.goldSales21), 0);
    const retailPurchases21 = state.invoices.filter(i => i.type === "قطاعي").reduce((sum, i) => sum + numeric(i.goldScrap21), 0);
    const wholesaleSales21 = state.invoices.filter(i => i.type === "جملة").reduce((sum, i) => sum + numeric(i.goldSales21), 0);
    const wholesaleScrap21 = state.invoices.filter(i => i.type === "جملة").reduce((sum, i) => sum + numeric(i.goldScrap21), 0);
    const supplierStock = state.transactions.filter(tx => tx.group === "موردين" && ["شراء شغل", "شراء سبيكة"].includes(tx.kind)).reduce((sum, tx) => sum + numeric(tx.gold21), 0);
    const supplierScrap = state.transactions.filter(tx => tx.group === "موردين" && ["استلام كسر", "تسليم كسر"].includes(tx.kind)).reduce((sum, tx) => sum + numeric(tx.gold21) * (tx.kind === "تسليم كسر" ? -1 : 1), 0);
    const cashFromCustomers = state.transactions.filter(tx => ["سداد عملاء", "قطاعي", "جملة"].includes(tx.group)).reduce((sum, tx) => sum + numeric(tx.cashIn), 0);
    const supplierCashOut = state.transactions.filter(tx => tx.group === "موردين").reduce((sum, tx) => sum + numeric(tx.cashOut), 0);
    const retailRefunds = state.transactions.filter(tx => tx.group === "قطاعي").reduce((sum, tx) => sum + numeric(tx.cashOut), 0);
    const netCash = cashFromCustomers - supplierCashOut - retailRefunds;
    return `<div class="page-head"><h1>🏦 جرد الخزنة والمخزن الإجمالي</h1></div>
      <section class="stats stats-three">
        <div class="stat-card"><div class="stat-title">📦 رصيد الشغل بالمخزن (عيار ٢١)</div><div class="stat-row"><span>الشغل الفعلي المتاح للبيع:</span><strong>${grams(supplierStock - retailSales21)}</strong></div>
          <div class="stat-row"><span>استلاف موردين:</span><strong>${grams(supplierStock)}</strong></div><div class="stat-row"><span>مباع للزبائن:</span><strong>${grams(retailSales21)}</strong></div></div>
        <div class="stat-card gold"><div class="stat-title">♻️ رصيد كسر الخزنة (عيار ٢١)</div><div class="stat-row"><span>الكسر المتوفر بالخزنة حالياً:</span><strong>${grams(retailPurchases21 + wholesaleScrap21 + supplierScrap)}</strong></div>
          <div class="stat-row"><span>مستلم من الزبائن والموردين:</span><strong>${grams(retailPurchases21 + wholesaleScrap21 + Math.max(0, supplierScrap))}</strong></div><div class="stat-row"><span>مسلم لموردين:</span><strong>${grams(Math.max(0, -supplierScrap))}</strong></div></div>
        <div class="stat-card blue"><div class="stat-title">💵 رصيد النقدية بالخزنة (الأجرة)</div><div class="stat-row"><span>إجمالي النقدية بالخزنة:</span><strong>${pounds(netCash)}</strong></div>
          <div class="stat-row"><span>نقدية من الزبائن (أجور وسداد):</span><strong>${pounds(cashFromCustomers)}</strong></div><div class="stat-row"><span>مسدد للموردين / مردودات:</span><strong>-${pounds(supplierCashOut + retailRefunds)}</strong></div></div>
      </section>
      <p class="muted">الأرصدة محسوبة من العمليات المسجلة داخل النسخة المحلية. الذهب معروض بمعادل عيار ٢١.</p>`;
  }

  function debtsPage() {
    const debts = state.invoices.filter(invoice => invoice.type === "قطاعي" && invoice.remaining > 0.005);
    const cashDue = debts.reduce((sum, invoice) => sum + invoice.remaining, 0);
    const goldDue = debts.reduce((sum, invoice) => sum + numeric(invoice.goldDebt21), 0);
    const rows = debts.map(invoice => `<tr><td>#${safe(invoice.number || invoice.id.slice(-6))}</td><td>${safe(customerName(invoice))}</td><td>${timestamp(invoice.createdAt)}</td>
      <td>${pounds(invoice.remaining)}</td><td>${grams(invoice.goldDebt21)}</td>
      <td><button class="btn btn-small btn-primary" data-action="collect-debt" data-id="${safe(invoice.id)}">تسجيل سداد</button></td></tr>`).join("");
    return `<div class="page-head"><h1>🧾 مديونيات فواتير القطاعي</h1></div>
      <p class="muted">سجّل المبلغ النقدي أو وزن الذهب الذي سدّده العميل؛ ويظل الرصيد المتبقي ظاهرًا حتى التسوية.</p>
      <section class="stats"><div class="stat-card blue"><div class="stat-title">💵 إجمالي نقدية مستحقة</div><strong>${pounds(cashDue)}</strong></div>
      <div class="stat-card gold"><div class="stat-title">🪙 إجمالي ذهب مستحق</div><strong>${grams(goldDue)}</strong></div></section>
      ${rows ? `<div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>التاريخ</th><th>المبلغ النقدي</th><th>ذهب عيار٢١</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState("🧾", "لا توجد مديونيات قطاعي حالياً 🎉")}
    `;
  }

  function settingsPage() {
    const s = state.settings;
    return `<div class="page-head"><h1>⚙️ الإعدادات العامة</h1></div>
      ${cloudPanel()}
      ${hasPermission("settings", "view") ? `<form class="settings-card" id="settings-form"><h3>🏢 هوية المحل / التاجر</h3><div class="form-grid">
        <label class="field">اسم المحل أو التاجر<input name="shopName" required maxlength="80" value="${safe(s.shopName)}"></label>
        <label class="field">رقم الهاتف<input name="phone" type="tel" maxlength="25" value="${safe(s.phone)}"></label>
        <label class="field">العيار الافتراضي عند الإدخال<select name="defaultKarat">${KARATS.map(k => `<option value="${k}" ${Number(s.defaultKarat) === k ? "selected" : ""}>عيار ${k}</option>`).join("")}</select></label>
        <label class="field">شعار الفاتورة المميز (Emoji)<select name="emblem">${["🏆", "🥇", "👑", "💎", "💫", "✨", "⚜️", "💰"].map(icon => `<option ${s.emblem === icon ? "selected" : ""}>${icon}</option>`).join("")}</select></label>
        <label class="field full">تذييل الفاتورة الثابت<textarea name="footer" rows="2" maxlength="300">${safe(s.footer)}</textarea></label>
      </div><button class="btn btn-primary" style="margin-top:16px" ${hasPermission("settings", "update") ? "" : "disabled"}>💾 حفظ الإعدادات</button></form>` : ""}
      <div class="settings-card"><h3>التخزين والخصوصية</h3><p>الوضع المحلي يحفظ البيانات على هذا الجهاز فقط. لا تُرفع أي بيانات إلى الخادم قبل تسجيل الدخول واختيار الدمج أو تحميل بيانات الخادم.</p></div>
    `;
  }

  function cloudPanel() {
    if (!cloud.user) {
      return `<section class="settings-card"><h3>☁️ الحساب والمزامنة بين الأجهزة</h3>
        <p>يعمل التطبيق محليًا دون حساب. لتفعيل الحسابات والصلاحيات والمزامنة، سجّل الدخول إلى خادم 3K. لن تُرفع بيانات الجهاز دون اختيارك.</p>
        <form id="cloud-login-form" class="form-grid" style="margin-top:14px">
          <label class="field">البريد الإلكتروني<input name="email" type="email" autocomplete="username" required></label>
          <label class="field">كلمة المرور<input name="password" type="password" autocomplete="current-password" required></label>
          <div class="field full"><button class="btn btn-primary" type="submit">تسجيل الدخول</button></div>
        </form></section>`;
    }
    const identity = `<p>الحساب: <strong>${safe(cloud.user.email)}</strong> · ${cloud.user.isOwner ? "مالك" : "مستخدم"}</p>`;
    if (cloud.user.forcePasswordChange) {
      return `<section class="settings-card"><h3>🔐 تغيير كلمة المرور المؤقتة</h3>${identity}
        <p>يجب تعيين كلمة مرور جديدة بطول 12 حرفًا على الأقل قبل متابعة استخدام الحساب.</p>
        <form id="cloud-password-form" class="form-grid" style="margin-top:14px">
          <label class="field">كلمة المرور الحالية<input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label class="field">كلمة المرور الجديدة<input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></label>
          <div class="field full"><button class="btn btn-primary" type="submit">تغيير كلمة المرور</button><button class="btn" type="button" data-action="cloud-logout">تسجيل الخروج</button></div>
        </form></section>`;
    }
    return `<section class="settings-card"><h3>☁️ الحساب والمزامنة بين الأجهزة</h3>${identity}
      <p>حالة المزامنة: <strong>${cloud.syncEnabled ? (cloud.busy ? "جارٍ العمل..." : "مفعّلة") : "متوقفة"}</strong>. يلزم إعداد الخادم على استضافة HTTPS للوصول من أجهزة أخرى.</p>
      <div class="head-actions" style="margin-top:14px;flex-wrap:wrap">
        <button class="btn" data-action="cloud-server-load">تحميل بيانات الخادم محل بيانات هذا الجهاز</button>
        <button class="btn btn-primary" data-action="cloud-merge">دمج بيانات الجهاز مع الخادم وتفعيل المزامنة</button>
        ${cloud.syncEnabled ? `<button class="btn" data-action="cloud-stop-sync">إيقاف المزامنة</button>` : ""}
        <button class="btn" data-action="cloud-logout">تسجيل الخروج</button>
      </div>
    </section>`;
  }

  const RESOURCE_NAMES = {
    invoices: "الفواتير", customers: "العملاء", suppliers: "الموردون", traders: "المسواجي",
    transactions: "المعاملات", balance: "أرصدة المسواجي", safe: "الخزنة والمخزن",
    debts: "المديونيات", settings: "الإعدادات", backup: "النسخ الاحتياطي", users: "المستخدمون"
  };
  const ACTION_NAMES = { view: "عرض", create: "إضافة", update: "تعديل", delete: "حذف", export: "تصدير", import: "استيراد" };

  function permissionOptions(selected) {
    return cloud.permissions.map(({ key, resource, action }) => `<label class="permission-option">
      <input type="checkbox" name="permissions" value="${safe(key)}" ${selected.includes(key) ? "checked" : ""}>
      <span>${safe(RESOURCE_NAMES[resource] || resource)} · ${safe(ACTION_NAMES[action] || action)}</span>
    </label>`).join("");
  }

  function permissionsPage() {
    if (!cloud.user) return `<div class="page-head"><h1>🔐 الحسابات والصلاحيات</h1></div>
      <div class="settings-card"><p>إدارة المستخدمين تتطلب تسجيل دخول المالك إلى الخادم. يمكنك تسجيل الدخول من صفحة الإعدادات. الوضع المحلي لا يوفر حسابات أو صلاحيات آمنة.</p></div>`;
    if (!cloud.user.isOwner) return `<div class="page-head"><h1>🔐 الحسابات والصلاحيات</h1></div>
      <div class="settings-card"><p>إدارة الحسابات متاحة للمالك فقط.</p></div>`;
    const createForm = `<form id="user-create-form" class="settings-card"><h3>إضافة حساب مستخدم</h3>
      <div class="form-grid"><label class="field">البريد الإلكتروني<input name="email" type="email" required maxlength="254"></label>
      <label class="field">كلمة مرور مؤقتة (12 حرفًا على الأقل)<input name="temporaryPassword" type="password" minlength="12" required autocomplete="new-password"></label></div>
      <h4>الصلاحيات الأولية</h4><div class="permission-grid">${permissionOptions([])}</div>
      <button class="btn btn-primary" type="submit" style="margin-top:14px">إنشاء الحساب</button></form>`;
    const userCards = cloud.users.map(user => `<section class="settings-card">
      <h3>${user.isOwner ? "👑 المالك" : "👤"} ${safe(user.email)}</h3>
      ${user.isOwner ? `<p>صلاحيات المالك كاملة ولا يمكن تعطيل حسابه من هذه الصفحة.</p>` : `<form class="user-permission-form" data-user-id="${safe(user.id)}">
        <label class="permission-option"><input type="checkbox" name="active" ${user.active ? "checked" : ""}><span>الحساب مفعّل</span></label>
        <div class="permission-grid">${permissionOptions(user.permissions)}</div>
        <div class="head-actions" style="margin-top:14px"><button class="btn btn-primary">حفظ الصلاحيات</button>
        <button class="btn" type="button" data-action="delete-user" data-id="${safe(user.id)}">حذف الحساب</button></div>
      </form>`}
    </section>`).join("");
    return `<div class="page-head"><h1>🔐 الحسابات والصلاحيات</h1><button class="btn" data-action="reload-users">تحديث القائمة</button></div>
      <p class="muted">كل خيار مستقل ويتم التحقق منه على الخادم، وليس من الواجهة فقط. حساب المستخدم الجديد يطلب تغيير كلمة المرور عند أول دخول. لعرض الخزنة أو المسواجي أو المديونيات يلزم أيضًا إذن عرض البيانات التي يعتمد عليها الملخص.</p>
      ${createForm}${userCards || `<div class="settings-card"><p>لا توجد حسابات مستخدمين بعد.</p></div>`}`;
  }

  function backupPage() {
    return `<div class="page-head"><h1>💾 النسخة الاحتياطية</h1></div>
      <div class="settings-card"><h3>📤 تصدير البيانات</h3><p>نزّل نسخة JSON قابلة للاسترجاع، أو ملف Excel حقيقي بصيغة XLSX.</p>
        <div class="head-actions" style="margin-top:14px"><button class="btn btn-primary" data-action="export-json">🛟 تحميل ملف الاسترجاع</button><button class="btn" data-action="export-xlsx">📥 تصدير Excel XLSX</button></div>
      </div>
      <div class="settings-card"><h3>📂 استيراد نسخة احتياطية</h3><p>اختر ملف JSON صادرًا من 3K. سيتم دمج السجلات دون حذف بياناتك الحالية.</p>
        ${hasPermission("backup", "import") ? `<label class="btn" for="backup-file" style="display:inline-block;margin-top:12px">📁 اختيار ملف الاسترجاع</label><input id="backup-file" type="file" accept=".json,application/json" hidden>` : `<p>لا تملك صلاحية استيراد نسخة احتياطية.</p>`}
      </div>
      <div class="settings-card"><h3>💡 نصائح</h3><p>نزّل نسخة احتياطية أسبوعيًا واحتفظ بنسخة خارج الجهاز. الاستيراد يدمج السجلات ويتجاوز المعرفات الموجودة مسبقًا.</p></div>`;
  }

  function bindMain() {
    $$(".filter-btn[data-range]").forEach(button => button.addEventListener("click", () => { state.range = button.dataset.range; render(); }));
    $$(".filter-btn[data-tx-filter]").forEach(button => button.addEventListener("click", () => { state.txFilter = button.dataset.txFilter; render(); }));
    const search = $("#invoice-search, #people-search, #trader-search, #tx-search");
    if (search) search.addEventListener("input", () => {
      state.search = search.value;
      const selection = search.selectionStart;
      persist();
      render();
      const next = $("#invoice-search, #people-search, #trader-search, #tx-search");
      next?.focus();
      next?.setSelectionRange(selection, selection);
    });
    const dates = [$("#from-date"), $("#to-date")].filter(Boolean);
    dates.forEach(field => field.addEventListener("change", () => {
      state.fromDate = $("#from-date")?.value || "";
      state.toDate = $("#to-date")?.value || "";
      persist();
      render();
    }));
    $("#settings-form")?.addEventListener("submit", saveSettings);
    $("#user-form")?.addEventListener("submit", addUser);
    $("#backup-file")?.addEventListener("change", importBackup);
    $("#cloud-login-form")?.addEventListener("submit", handleCloudLogin);
    $("#cloud-password-form")?.addEventListener("submit", handlePasswordChange);
    $("#user-create-form")?.addEventListener("submit", createCloudUser);
    $$(".user-permission-form").forEach(form => form.addEventListener("submit", updateCloudUser));
  }

  function handleNavigation(page) {
    if (page === "new") {
      if (canRunAction("new-wholesale", { dataset: {} })) openInvoiceForm("جملة");
      else if (hasPermission("transactions", "view") && hasPermission("transactions", "create")) openTransactionChooser();
      else notify("ليس لديك صلاحية إنشاء سجل جديد.", true);
      return;
    }
    state.page = page;
    state.search = "";
    persist();
    render();
    if (page === "permissions" && cloud.user?.isOwner) loadCloudUsers();
  }

  function bindGlobalControls() {
    const oldBackup = $("#backup-button");
    const newBackup = oldBackup.cloneNode(true);
    oldBackup.replaceWith(newBackup);
    newBackup.addEventListener("click", () => exportJson());
    const oldMenu = $("#menu-button");
    const newMenu = oldMenu.cloneNode(true);
    oldMenu.replaceWith(newMenu);
    newMenu.addEventListener("click", () => {
      const sidebar = $(".sidebar");
      sidebar.classList.toggle("sidebar-open");
      if (sidebar.classList.contains("sidebar-open") && innerWidth <= 760) sidebar.scrollIntoView({ behavior: "smooth" });
    });
  }

  function configurePwa() {
    const installButton = $("#install-button");
    let installPrompt = null;
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
      installButton.hidden = true;
    }
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      installPrompt = event;
      installButton.title = "تثبيت 3K على الجهاز";
      installButton.setAttribute("aria-label", "تثبيت 3K على الجهاز");
    });
    window.addEventListener("appinstalled", () => {
      installPrompt = null;
      installButton.hidden = true;
      notify("تم تثبيت 3K على الجهاز.");
    });
    installButton.addEventListener("click", async () => {
      if (!installPrompt) {
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
        notify(ios
          ? "من Safari اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية»."
          : "استخدم خيار «تثبيت التطبيق» أو «إنشاء اختصار» من قائمة المتصفح.");
        return;
      }
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      if (choice.outcome === "accepted") installButton.hidden = true;
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js")
        .catch(error => {
          console.error("تعذر تسجيل خدمة التطبيق للعمل دون إنترنت:", error);
          notify("تعذر تفعيل وضع العمل دون إنترنت.", true);
        });
    }
  }

  document.addEventListener("click", event => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleNavigation(pageButton.dataset.page);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button || !$("#main-content").contains(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = button.dataset.action;
    if (!canRunAction(action, button)) {
      notify("ليس لديك صلاحية تنفيذ هذا الإجراء.", true);
      return;
    }
    const recordId = button.dataset.id;
    if (action === "new-wholesale") openInvoiceForm("جملة");
    else if (action === "new-retail") openInvoiceForm("قطاعي");
    else if (action === "add-person") openPersonForm(button.dataset.kind);
    else if (action === "edit-person") openPersonForm(button.dataset.kind, recordId);
    else if (action === "person-details") showPersonDetails(button.dataset.kind, recordId);
    else if (action === "add-trader") openTraderForm();
    else if (action === "trader-transaction") openTraderTransaction(recordId);
    else if (action === "trader-details") showTraderDetails(recordId);
    else if (action === "new-transaction") openTransactionChooser();
    else if (action === "refresh") render();
    else if (action === "collect-debt") openDebtPayment(recordId);
    else if (action === "view-invoice") showInvoice(recordId);
    else if (action === "date-range") openDateRange();
    else if (action === "export-json") exportJson();
    else if (action === "export-csv") exportCsv();
    else if (action === "export-xlsx") exportXlsx();
    else if (action === "cloud-server-load") reconcileCloud("load");
    else if (action === "cloud-merge") reconcileCloud("merge");
    else if (action === "cloud-stop-sync") {
      cloud.syncEnabled = false;
      localStorage.removeItem(cloudSyncKey());
      notify("تم إيقاف المزامنة. يستمر حفظ البيانات محليًا.");
      render();
    }
    else if (action === "cloud-logout") handleCloudLogout();
    else if (action === "reload-users") loadCloudUsers();
    else if (action === "delete-user") deleteCloudUser(recordId);
    else if (action === "remove-user") removeUser(Number(button.dataset.index));
  }, true);

  function openModal(title, body, onSubmit, submitText = "حفظ") {
    $("#overlay-root").innerHTML = `<div class="modal-backdrop" id="app-modal"><section class="modal" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${title}</h2><button class="close-btn" data-dismiss aria-label="إغلاق">×</button></div>
      <form class="modal-body" id="dialog-form">${body}<div class="form-footer"><button class="btn btn-primary" type="submit">${submitText}</button><button class="btn" type="button" data-dismiss>إلغاء</button></div></form></section></div>`;
    const dialog = $("#app-modal");
    $$("[data-dismiss]", dialog).forEach(button => button.addEventListener("click", closeModal));
    dialog.addEventListener("click", event => { if (event.target === dialog) closeModal(); });
    $("#dialog-form").addEventListener("submit", event => { event.preventDefault(); onSubmit(new FormData(event.currentTarget), event.currentTarget); });
    $("#dialog-form input, #dialog-form select")?.focus();
  }

  function closeModal() { $("#overlay-root").innerHTML = ""; }

  const textField = (label, name, value = "", options = {}) => `<label class="field ${options.full ? "full" : ""}">${label}<input name="${name}" ${options.type ? `type="${options.type}"` : "type=\"text\""} value="${safe(value)}" ${options.required ? "required" : ""} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""} ${options.maxlength ? `maxlength="${options.maxlength}"` : ""} placeholder="${safe(options.placeholder || "")}"></label>`;
  const numberField = (label, name, value = 0, options = {}) => textField(label, name, value, { ...options, type: "number", min: options.min ?? 0, step: options.step || "0.001" });
  const textareaField = (label, name, value = "", full = true) => `<label class="field ${full ? "full" : ""}">${label}<textarea name="${name}" rows="2" maxlength="300">${safe(value)}</textarea></label>`;
  const karatSelect = name => `<label class="field">العيار<select name="${name}">${KARATS.map(k => `<option value="${k}" ${Number(state.settings.defaultKarat) === k ? "selected" : ""}>عيار ${k}</option>`).join("")}</select></label>`;
  const partySelect = name => `<label class="field">العميل المسجل<select name="${name}"><option value="">عميل جديد / نقدي</option>${state.customers.map(c => `<option value="${safe(c.id)}">${safe(c.name)}${c.phone ? ` — ${safe(c.phone)}` : ""}</option>`).join("")}</select></label>`;

  function openInvoiceForm(type) {
    const wholesale = type === "جملة";
    const workItems = [];
    const scrapItems = [];
    const sales = [];
    const purchases = [];
    const payRecords = [];
    let activeTab = wholesale ? "work" : "sales";
    let retailPayMethod = "كاش";
    let goldOnAccount = false;
    const header = `<div class="customer-fields"><h3>👤 العميل</h3><div class="form-grid">
      ${partySelect("customerId")}${textField("الاسم *", "customerName", "", { required: true, maxlength: 80 })}
      ${textField("رقم الهاتف", "phone", "", { type: "tel", maxlength: 25, placeholder: "01xxxxxxxxx" })}
    </div></div>`;
    const tabBar = wholesale
      ? `<div class="form-tabs"><button type="button" data-invoice-tab="work">🪙 شغل للعميل</button><button type="button" data-invoice-tab="scrap">📤 تسليم كسر</button><button type="button" data-invoice-tab="cash">💵 نقدية</button><button type="button" data-invoice-tab="summary">📊 الملخص</button></div>`
      : "";
    const body = `<div class="wide-dialog">${header}${tabBar}<div id="invoice-workspace"></div></div>`;
    openModal(`فاتورة ${type} جديدة`, body, (formData, form) => {
      const clientId = String(formData.get("customerId") || "");
      let name = String(formData.get("customerName") || "").trim();
      let phone = String(formData.get("phone") || "").trim();
      const savedCustomer = byId(state.customers, clientId);
      if (!name && savedCustomer) name = savedCustomer.name;
      if (!phone && savedCustomer) phone = savedCustomer.phone || "";
      if (!name) { notify("اكتب اسم العميل أولاً.", true); return; }
      const payment = wholesale ? clampMoney(formData.get("wholesalePaid")) : clampMoney(formData.get("retailPaid"));
      let calculation;
      if (wholesale) calculation = calculateWholesale(workItems, scrapItems, payment);
      else calculation = calculateRetail(sales, purchases);
      const moneyDue = wholesale ? calculation.due : Math.max(0, calculation.due);
      const difference = payment - moneyDue;
      const wholePoundPayment = Math.abs(payment - Math.round(payment)) < 0.005;
      const canRoundFraction = moneyDue > 0 && payment > 0 && wholePoundPayment && Math.abs(difference) > 0.005 && Math.abs(difference) < 1;
      let roundingAdjustment = 0;
      if (difference > 0.005) {
        if (!canRoundFraction) {
          notify(wholesale ? "المبلغ المدفوع يزيد عن إجمالي الأجور بأكثر من جنيه؛ راجع المبلغ." : "المبلغ المدفوع يزيد عن صافي المستحق بأكثر من جنيه؛ راجع المبلغ.", true);
          return;
        }
        const message = `المبلغ المدفوع يزيد عن المستحق بمقدار ${pounds(difference)}.\nهل توافق على تقريب إجمالي الفاتورة للمبلغ المدفوع؟`;
        if (!window.confirm(message)) return;
        roundingAdjustment = Math.round(difference * 100) / 100;
      } else if (canRoundFraction) {
        const message = `المبلغ المدفوع أقل من المستحق بمقدار ${pounds(Math.abs(difference))}.\nهل توافق على خصم فرق الكسور وتسوية الفاتورة؟`;
        if (window.confirm(message)) roundingAdjustment = Math.round(difference * 100) / 100;
      }
      const due = clampMoney(moneyDue + roundingAdjustment);
      const paid = payment;
      const invoice = {
        id: id(), number: String(Date.now()).slice(-8), type, customerId: clientId, customerName: name,
        phone, createdAt: new Date().toISOString(), notes: String(formData.get("notes") || "").trim(),
        sales: wholesale ? [] : structuredClone(sales), purchases: wholesale ? [] : structuredClone(purchases),
        workItems: wholesale ? structuredClone(workItems) : [], scrapItems: wholesale ? structuredClone(scrapItems) : [],
        salesAmount: wholesale ? 0 : calculation.salesTotal, purchaseAmount: wholesale ? 0 : calculation.purchaseTotal,
        due, roundingAdjustment, paid, remaining: Math.max(0, due - paid),
        payments: paid > 0 ? [{ amount: paid, paymentMethod: wholesale ? "نقدية" : retailPayMethod, createdAt: new Date().toISOString() }] : [],
        refundDue: wholesale ? 0 : calculation.refundDue,
        cashIn: wholesale ? paid : (retailPayMethod === "كاش" ? paid : 0),
        onlineIn: retailPayMethod === "أونلاين" ? paid : 0,
        paymentMethod: wholesale ? "نقدية" : retailPayMethod,
        goldSales21: wholesale ? calculation.workWeight21 : calculation.saleWeight21,
        goldScrap21: wholesale ? calculation.scrapWeight21 : calculation.scrapWeight21,
        goldDebt21: !wholesale && goldOnAccount ? Math.max(0, calculation.netWeight21) : 0,
        goldOnAccount, adjustments: payRecords
      };
      state.invoices.push(invoice);
      if (clientId) {
        const customer = byId(state.customers, clientId);
        if (customer) { customer.invoiceCount = numeric(customer.invoiceCount) + 1; customer.balance = numeric(customer.balance) + invoice.remaining; }
      } else if (phone && name !== "عميل نقدي") {
        let customer = state.customers.find(item => item.phone === phone);
        if (!customer) {
          customer = { id: id(), name, phone, notes: "", invoiceCount: 0, balance: 0, createdAt: new Date().toISOString() };
          state.customers.push(customer);
        }
        customer.invoiceCount += 1;
        customer.balance += invoice.remaining;
        invoice.customerId = customer.id;
      }
      if (invoice.paid > 0 || invoice.refundDue > 0) state.transactions.push({
        id: id(), group: wholesale ? "جملة" : "قطاعي", kind: `سداد فاتورة ${type}`,
        partyType: "customer", partyId: invoice.customerId, partyName: name, invoiceId: invoice.id,
        amount: invoice.paid, cashIn: invoice.cashIn,
        cashOut: invoice.refundDue && retailPayMethod === "كاش" ? invoice.refundDue : 0,
        paymentMethod: invoice.paymentMethod,
        createdAt: invoice.createdAt, memo: invoice.number
      });
      persist(); closeModal(); state.page = "invoices"; state.range = "الكل"; render();
      const whatsapp = openInvoiceWhatsApp(invoice);
      const roundingNotice = roundingAdjustment ? ` ${roundingDescription(roundingAdjustment)}.` : "";
      if (whatsapp.opened) notify(`تم حفظ الفاتورة وفتح واتساب بالرسالة؛ راجعها واضغط إرسال.${roundingNotice}`);
      else if (whatsapp.reason === "phone") notify(`تم حفظ الفاتورة، لكن لم يُفتح واتساب لعدم وجود رقم هاتف صالح للعميل.${roundingNotice}`, true);
      else notify(`تم حفظ الفاتورة، لكن المتصفح منع فتح واتساب. افتح الفاتورة واضغط إرسال واتساب.${roundingNotice}`, true);
    }, "✅ إنشاء الفاتورة");

    const form = $("#dialog-form");
    form.classList.add("dialog-wide");
    const updateCustomer = () => {
      const customer = byId(state.customers, form.elements.customerId.value);
      if (customer) { form.elements.customerName.value = customer.name; form.elements.phone.value = customer.phone || ""; }
    };
    form.elements.customerId.addEventListener("change", updateCustomer);
    if (wholesale) bindWholesaleTabs(form, workItems, scrapItems, payRecords, () => activeTab, value => { activeTab = value; }, state.settings.defaultKarat);
    else renderRetail(form, sales, purchases, {
      getPayMethod: () => retailPayMethod,
      setPayMethod: value => { retailPayMethod = value; },
      getGoldOnAccount: () => goldOnAccount,
      setGoldOnAccount: value => { goldOnAccount = value; }
    });
  }

  function bindWholesaleTabs(form, workItems, scrapItems, payments, getTab, setTab, defaultKarat) {
    const workspace = $("#invoice-workspace");
    const paint = () => {
      const tab = getTab();
      $$("[data-invoice-tab]", form).forEach(button => button.classList.toggle("active", button.dataset.invoiceTab === tab));
      workspace.innerHTML = tab === "work" ? wholesaleWorkForm(workItems, defaultKarat)
        : tab === "scrap" ? wholesaleScrapForm(scrapItems, defaultKarat)
          : tab === "cash" ? wholesaleCashForm(workItems, scrapItems, payments)
            : wholesaleSummary(form, workItems, scrapItems);
      bindWholesaleSection();
    };
    $$("[data-invoice-tab]", form).forEach(button => button.addEventListener("click", () => {
      if (button.dataset.invoiceTab === "summary") {
        const values = formValues(form);
        payments.length = 0;
        payments.push({ amount: clampMoney(values.get("wholesalePaid")) });
      }
      setTab(button.dataset.invoiceTab); paint();
    }));
    const bindWholesaleSection = () => {
      $$("[data-add-work]", workspace).forEach(button => button.addEventListener("click", () => {
        const itemForm = $("#work-item-form", workspace);
        const values = formValues(itemForm);
        const weight = numeric(values.get("weight"));
        const karat = numeric(values.get("karat"));
        const feePerGram = numeric(values.get("feePerGram"));
        if (weight <= 0 || !KARATS.includes(karat)) { notify("أدخل وزنًا وعيارًا صحيحين.", true); return; }
        workItems.push({ id: id(), weight, karat, weight21: gold21(weight, karat), feePerGram, fee: clampMoney(weight * feePerGram), description: String(values.get("description") || "").trim() });
        paint();
      }));
      $$("[data-add-scrap]", workspace).forEach(button => button.addEventListener("click", () => {
        const itemForm = $("#scrap-item-form", workspace);
        const values = formValues(itemForm);
        const weight = numeric(values.get("weight"));
        const karat = numeric(values.get("karat"));
        const kind = String(values.get("kind"));
        const fee = clampMoney(numeric(values.get("feePerGram")) * weight);
        if (weight <= 0 || !KARATS.includes(karat)) { notify("أدخل وزنًا وعيارًا صحيحين.", true); return; }
        scrapItems.push({ id: id(), kind, weight, karat, weight21: gold21(weight, karat), fee, feePerGram: numeric(values.get("feePerGram")), description: String(values.get("description") || "").trim() });
        paint();
      }));
      $$("[data-remove-work]", workspace).forEach(button => button.addEventListener("click", () => { workItems.splice(Number(button.dataset.index), 1); paint(); }));
      $$("[data-remove-scrap]", workspace).forEach(button => button.addEventListener("click", () => { scrapItems.splice(Number(button.dataset.index), 1); paint(); }));
      $("#wholesale-paid", workspace)?.addEventListener("input", () => refreshWholesaleTotals(form, workItems, scrapItems));
    };
    paint();
  }

  function wholesaleWorkForm(items, defaultKarat) {
    const rows = items.map((item, index) => `<div class="line-item"><div><strong>${grams(item.weight)} عيار ${item.karat}</strong><small>${safe(item.description || "شغل للعميل")} · ${pounds(item.feePerGram)}/g</small></div>
      <div class="line-total">${grams(item.weight21)} (٢١)<br>${pounds(item.fee)}</div><button type="button" class="remove-line" data-remove-work="${index}">✕</button></div>`).join("");
    return `<div class="form-panel"><h3>🪙 إضافة صنف شغل للعميل</h3><div id="work-item-form" class="form-grid">
      ${numberField("الوزن الفعلي (g)", "weight", "", { step: "0.001" })}${karatField("karat", defaultKarat)}
      ${numberField("أجرة الجرام (ج)", "feePerGram", 0, { step: "0.01" })}${textField("وصف (اختياري)", "description", "", { maxlength: 80 })}
      <button type="button" class="btn btn-primary field full" data-add-work>➕ أضف صنف الشغل للفاتورة</button></div></div>
      ${rows ? `<div class="line-list"><h3>📦 أصناف الشغل</h3>${rows}</div><div class="form-panel totals-preview" id="wholesale-totals"></div>` : emptyState("🪙", "لم تتم إضافة أصناف شغل بعد")}`;
  }

  function wholesaleScrapForm(items, defaultKarat) {
    const rows = items.map((item, index) => `<div class="line-item"><div><strong>${safe(item.kind)} · ${grams(item.weight)} عيار ${item.karat}</strong><small>${safe(item.description || "")}</small></div>
      <div class="line-total">${grams(item.weight21)} (٢١)<br>${pounds(item.fee)} أجرة</div><button type="button" class="remove-line" data-remove-scrap="${index}">✕</button></div>`).join("");
    return `<div class="form-panel"><h3>📤 إضافة ذهب مسلّم من العميل (كسر / سبائك)</h3><div id="scrap-item-form" class="form-grid">
      <label class="field">نوع الذهب<select name="kind"><option>كسر عادي</option><option>شراء ذهب بالنقدية</option><option>سبيكة ذهب</option><option>حوالة ذهب</option></select></label>
      ${numberField("الوزن الفعلي (g)", "weight", "", { step: "0.001" })}${karatField("karat", defaultKarat)}
      ${numberField("أجرة الكسر للجرام (ج) — اختياري", "feePerGram", 0, { step: "0.01" })}${textField("وصف (اختياري)", "description")}
      <button type="button" class="btn btn-primary field full" data-add-scrap>➕ أضف الذهب للفاتورة</button></div></div>
      ${rows ? `<div class="line-list">${rows}</div><div class="form-panel totals-preview">إجمالي الكسر المستلم: <strong>${grams(totals(items, "weight21"))}</strong></div>` : emptyState("♻️", "لم يتم إضافة أي ذهب مسلّم بعد")}`;
  }

  function wholesaleCashForm(workItems, scrapItems) {
    const summary = calculateWholesale(workItems, scrapItems, 0);
    return `<div class="form-panel"><h3>💵 نقدية مسددة من العميل (لتسوية الأجور)</h3>
      <div class="stats stats-three compact-stats"><div><span>أجور الشغل</span><strong>${pounds(summary.workFees)}</strong></div><div><span>أجور الكسر</span><strong>${pounds(summary.scrapFees)}</strong></div><div><span>إجمالي الأجور</span><strong>${pounds(summary.due)}</strong></div></div>
      <label class="field">المبلغ المدفوع (ج)<input id="wholesale-paid" name="wholesalePaid" form="dialog-form" type="number" min="0" step="0.01" value="0"></label>
      <p class="muted">المبلغ المدفوع يُخصم من أجور العميل ويُسجل كحركة نقدية.</p><div id="wholesale-cash-totals" class="totals-preview">${pounds(summary.due)} أجور مطلوبة</div></div>`;
  }

  function wholesaleSummary(form, workItems, scrapItems) {
    const paid = clampMoney(new FormData(form).get("wholesalePaid"));
    const summary = calculateWholesale(workItems, scrapItems, paid);
    const notes = $("#invoice-notes", form)?.value || "";
    return `<div class="form-panel"><h3>📊 ملخص الفاتورة</h3>
      <div class="summary-grid"><div><span>🪙 إجمالي أجور الشغل</span><strong>${pounds(summary.workFees)}</strong></div>
      <div><span>أجور الكسر</span><strong>${pounds(summary.scrapFees)}</strong></div>
      <div><span>إجمالي الأجور</span><strong>${pounds(summary.due)}</strong></div>
      <div><span>المبلغ المدفوع</span><strong>${pounds(summary.paid)}</strong></div>
      <div><span>المتبقي</span><strong>${pounds(summary.remaining)}</strong></div>
      <div><span>صافي الذهب (عيار ٢١)</span><strong>${grams(summary.netWeight21)}</strong></div></div>
      <label class="field full">ملاحظات إضافية<textarea id="invoice-notes" name="notes" form="dialog-form" rows="3" maxlength="300">${safe(notes)}</textarea></label></div>`;
  }

  function refreshWholesaleTotals(form, workItems, scrapItems) {
    const summary = calculateWholesale(workItems, scrapItems, $("#wholesale-paid")?.value);
    const totalsBox = $("#wholesale-totals");
    if (totalsBox) totalsBox.innerHTML = `إجمالي أجور الشغل: <strong>${pounds(summary.workFees)}</strong> · إجمالي المبيعات عيار ٢١: <strong>${grams(summary.workWeight21)}</strong>`;
    const cashBox = $("#wholesale-cash-totals");
    if (cashBox) cashBox.innerHTML = `المتبقي بعد السداد: <strong>${pounds(summary.remaining)}</strong>`;
    const summaryButton = $('[data-invoice-tab="summary"]', form);
    if (summaryButton?.classList.contains("active")) {
      $("#invoice-workspace").innerHTML = wholesaleSummary(form, workItems, scrapItems);
      $("#invoice-notes", form)?.addEventListener("input", () => {});
    }
  }

  function renderRetail(form, sales, purchases, paymentState) {
    const workspace = $("#invoice-workspace");
    const paint = () => {
      const calc = calculateRetail(sales, purchases);
      const saleRows = sales.map((item, index) => `<div class="line-item"><div><strong>${grams(item.weight)} عيار ${item.karat}</strong><small>${item.wageType === "percentage" ? `مصنعية ${fmt(item.wageRate)}%` : item.wageType === "piece" ? `مصنعية قطعة ${pounds(item.wageRate)}` : `مصنعية ${pounds(item.wageRate)}/g`} · سعر ${pounds(item.price)}/g</small></div><div class="line-total">${pounds(item.total)}</div><button type="button" class="remove-line" data-remove-sale="${index}">✕</button></div>`).join("");
      const scrapRows = purchases.map((item, index) => `<div class="line-item"><div><strong>${grams(item.weight)} عيار ${item.karat} · خصم ${fmt(item.discount)}%</strong><small>شراء كسر بسعر ${pounds(item.price)}/g</small></div><div class="line-total">${pounds(item.total)}</div><button type="button" class="remove-line" data-remove-purchase="${index}">✕</button></div>`).join("");
      workspace.innerHTML = `<div class="form-panel"><h3>🪙 إضافة صنف (بيع للعميل)</h3><div id="retail-sale-form" class="form-grid">
        ${numberField("الوزن (g)", "weight", "", {})}${karatField("karat", state.settings.defaultKarat)}
        ${numberField("سعر الجرام (ج)", "price", "", { step: "0.01" })}
        <label class="field">نوع المصنعية<select name="wageType"><option value="gram">بالجرام</option><option value="percentage">بالنسبة %</option><option value="piece">بالقطعة</option></select></label>
        ${numberField("المصنعية للجرام (ج)", "wageRate", 0, { step: "0.01" })}${textField("وصف (اختياري)", "description", "", { maxlength: 80 })}
        <button type="button" class="btn btn-primary field full" data-add-sale>➕ أضف الصنف</button></div>${saleRows || `<p class="muted">لم تتم إضافة أصناف مبيعات بعد</p>`}</div>
        <div class="form-panel"><h3>♻️ شراء ذهب من العميل (كسر)</h3><div id="retail-scrap-form" class="form-grid">
          ${numberField("الوزن (g)", "weight", "", {})}${karatField("karat", state.settings.defaultKarat)}
          ${numberField("سعر جرام الذهب (ج)", "price", "", { step: "0.01" })}
          <label class="field">نسبة الخصم %<select name="discount"><option value="0">بدون خصم</option><option value="1">1%</option><option value="2">2%</option><option value="custom">مخصص</option></select></label>
          ${numberField("نسبة خصم مخصصة %", "customDiscount", 0, { step: "0.01", max: "100" })}
          <button type="button" class="btn btn-primary field full" data-add-purchase>➕ أضف الصنف</button></div>${scrapRows || `<p class="muted">لم تتم إضافة مشتريات بعد</p>`}</div>
        <div class="form-panel"><h3>📊 ملخص الفاتورة</h3><div class="summary-grid">
          <div><span>إجمالي المبيعات</span><strong>${pounds(calc.salesTotal)}</strong></div>
          <div><span>إجمالي المشتريات</span><strong>-${pounds(calc.purchaseTotal)}</strong></div>
          <div class="summary-primary"><span>الصافي المطلوب من العميل</span><strong>${pounds(calc.due)}</strong></div>
          <div><span>صافي الذهب (عيار ٢١)</span><strong>${grams(calc.netWeight21)}</strong></div></div>
          <div class="form-grid payment-grid"><div class="field full"><span>💳 طريقة الدفع</span><div class="form-tabs compact">
            <button type="button" data-pay-method="كاش" class="${paymentState.getPayMethod() === "كاش" ? "active" : ""}">💵 كاش</button>
            <button type="button" data-pay-method="أونلاين" class="${paymentState.getPayMethod() === "أونلاين" ? "active" : ""}">📱 أونلاين</button>
          </div></div>
          ${numberField("المبلغ المدفوع من العميل (ج)", "retailPaid", 0, { step: "0.01", max: String(Math.max(0, calc.due)) })}
          <label class="field check-field"><input type="checkbox" name="goldOnAccount" ${paymentState.getGoldOnAccount() ? "checked" : ""}> الذهب يبقى طرفنا (يسجل للعميل)</label>
          ${textareaField("ملاحظات", "notes")}</div></div>`;
      bindRetailItems();
    };
    const bindRetailItems = () => {
      $$("[data-add-sale]", workspace).forEach(button => button.addEventListener("click", () => {
        const values = formValues($("#retail-sale-form", workspace));
        const weight = numeric(values.get("weight"));
        const karat = numeric(values.get("karat"));
        const price = numeric(values.get("price"));
        const wageType = String(values.get("wageType"));
        const wageRate = numeric(values.get("wageRate"));
        if (weight <= 0 || price <= 0 || !KARATS.includes(karat) || wageRate < 0) { notify("أدخل وزنًا وسعرًا وعيارًا صحيحًا.", true); return; }
        const goldValue = weight * price;
        const fee = wageType === "gram" ? weight * wageRate : wageType === "percentage" ? goldValue * wageRate / 100 : wageRate;
        sales.push({ id: id(), weight, karat, weight21: gold21(weight, karat), price, wageType, wageRate, fee: clampMoney(fee), total: clampMoney(goldValue + fee), description: String(values.get("description") || "").trim() });
        paint();
      }));
      $$("[data-add-purchase]", workspace).forEach(button => button.addEventListener("click", () => {
        const values = formValues($("#retail-scrap-form", workspace));
        const weight = numeric(values.get("weight"));
        const karat = numeric(values.get("karat"));
        const price = numeric(values.get("price"));
        const discount = values.get("discount") === "custom" ? numeric(values.get("customDiscount")) : numeric(values.get("discount"));
        if (weight <= 0 || price <= 0 || !KARATS.includes(karat) || discount < 0 || discount > 100) { notify("راجع الوزن والسعر والخصم؛ الخصم يجب أن يكون بين 0 و100%.", true); return; }
        purchases.push({ id: id(), weight, karat, weight21: gold21(weight, karat), price, discount, total: clampMoney(weight * price * (1 - discount / 100)) });
        paint();
      }));
      $$("[data-remove-sale]", workspace).forEach(button => button.addEventListener("click", () => { sales.splice(Number(button.dataset.removeSale), 1); paint(); }));
      $$("[data-remove-purchase]", workspace).forEach(button => button.addEventListener("click", () => { purchases.splice(Number(button.dataset.removePurchase), 1); paint(); }));
      $$("[data-pay-method]", workspace).forEach(button => button.addEventListener("click", () => {
        paymentState.setPayMethod(button.dataset.payMethod);
        $$("[data-pay-method]", workspace).forEach(option => option.classList.toggle("active", option.dataset.payMethod === paymentState.getPayMethod()));
      }));
      const checkbox = $('input[name="goldOnAccount"]', workspace);
      checkbox?.addEventListener("change", () => paymentState.setGoldOnAccount(checkbox.checked));
      const wageType = $('select[name="wageType"]', workspace);
      wageType?.addEventListener("change", () => {
        const label = $$("label.field", workspace).find(field => $("input[name='wageRate']", field));
        if (label?.firstChild) {
          label.firstChild.textContent = wageType.value === "percentage" ? "نسبة المصنعية (٪ من قيمة الذهب)" : wageType.value === "piece" ? "المصنعية للقطعة (ج)" : "المصنعية للجرام (ج)";
        }
      });
    };
    paint();
  }

  function karatField(name, selected) {
    return `<label class="field">العيار<select name="${name}">${KARATS.map(k => `<option value="${k}" ${Number(selected) === k ? "selected" : ""}>عيار ${k}</option>`).join("")}</select></label>`;
  }

  function formValues(root) {
    const values = new FormData();
    $$("[name]", root).forEach(field => {
      if ((field.type === "checkbox" || field.type === "radio") && !field.checked) return;
      values.append(field.name, field.value);
    });
    return values;
  }

  function openPersonForm(kind, personId = "") {
    const customer = kind === "customer";
    const list = customer ? state.customers : state.suppliers;
    const person = byId(list, personId);
    const label = customer ? "عميل" : "مورد";
    openModal(`${person ? "تعديل" : "إضافة"} ${label}`, `<div class="form-grid">
      ${textField("الاسم *", "name", person?.name || "", { required: true, maxlength: 80 })}
      ${textField("رقم الهاتف", "phone", person?.phone || "", { type: "tel", maxlength: 25, placeholder: "01xxxxxxxxx" })}
      ${textareaField("ملاحظات", "notes")}
    </div>`, values => {
      const name = String(values.get("name") || "").trim();
      const phone = String(values.get("phone") || "").trim();
      if (!name) { notify("الاسم مطلوب.", true); return; }
      if (phone && list.some(item => item.phone === phone && item.id !== personId)) { notify("رقم الهاتف مسجل بالفعل.", true); return; }
      if (person) Object.assign(person, { name, phone, notes: String(values.get("notes") || "").trim() });
      else list.push({ id: id(), name, phone, notes: String(values.get("notes") || "").trim(), invoiceCount: 0, balance: 0, createdAt: new Date().toISOString() });
      persist(); closeModal(); state.page = customer ? "customers" : "suppliers"; render(); notify(`تم حفظ بيانات ${label}.`);
    }, person ? "حفظ التعديلات" : `✅ إضافة ${label}`);
  }

  function openTraderForm() {
    openModal("⚖️ تاجر كسر جديد", `<div class="form-grid">
      ${textField("اسم التاجر *", "name", "", { required: true, maxlength: 80 })}
      ${textField("رقم الهاتف", "phone", "", { type: "tel", maxlength: 25, placeholder: "01xxxxxxxxx" })}
      ${textareaField("ملاحظات", "notes")}
    </div>`, values => {
      const name = String(values.get("name") || "").trim();
      const phone = String(values.get("phone") || "").trim();
      if (!name) { notify("اسم التاجر مطلوب.", true); return; }
      state.traders.push({ id: id(), name, phone, notes: String(values.get("notes") || "").trim(), createdAt: new Date().toISOString() });
      persist(); closeModal(); state.page = "balance"; render(); notify("تمت إضافة التاجر.");
    }, "✅ إضافة التاجر");
  }

  function showPersonDetails(kind, personId) {
    const customer = kind === "customer";
    const person = byId(customer ? state.customers : state.suppliers, personId);
    if (!person) { notify("تعذر العثور على السجل.", true); return; }
    const records = customer
      ? state.invoices.filter(invoice => invoice.customerId === personId).map(invoice => `<tr><td>#${safe(invoice.number || invoice.id.slice(-6))}</td><td>${safe(invoice.type)}</td><td>${timestamp(invoice.createdAt)}</td><td>${pounds(invoice.remaining)}</td></tr>`).join("")
      : state.transactions.filter(tx => tx.partyId === personId).map(tx => `<tr><td>${timestamp(tx.createdAt)}</td><td>${safe(tx.kind)}</td><td>${pounds(tx.amount)}</td><td>${safe(tx.memo || "—")}</td></tr>`).join("");
    openModal(`${customer ? "العميل" : "المورد"}: ${safe(person.name)}`, `<p>الهاتف: ${safe(person.phone || "—")}</p>${person.notes ? `<p>${safe(person.notes)}</p>` : ""}
      ${records ? `<div class="table-wrap"><table><tbody>${records}</tbody></table></div>` : `<p class="muted">لا توجد تعاملات مسجلة.</p>`}
      <button type="button" class="btn" data-dismiss>إغلاق</button>`, () => closeModal(), "إغلاق");
  }

  function showTraderDetails(traderId) {
    const trader = byId(state.traders, traderId);
    if (!trader) { notify("تعذر العثور على التاجر.", true); return; }
    const records = state.transactions.filter(tx => tx.partyId === traderId && tx.partyType === "trader")
      .map(tx => `<tr><td>${timestamp(tx.createdAt)}</td><td>${safe(tx.kind)}</td><td>${pounds(tx.amount)}</td><td>${grams(tx.gold21)}</td></tr>`).join("");
    openModal(`حساب التاجر: ${safe(trader.name)}`, `<p>الهاتف: ${safe(trader.phone || "—")}</p>${records ? `<div class="table-wrap"><table><tbody>${records}</tbody></table></div>` : `<p class="muted">لا توجد معاملات.</p>`}`, () => closeModal(), "إغلاق");
  }

  function openTraderTransaction(traderId = "") {
    if (!state.traders.length) { notify("أضف تاجر كسر أولاً."); openTraderForm(); return; }
    const options = state.traders.map(trader => `<option value="${safe(trader.id)}" ${trader.id === traderId ? "selected" : ""}>${safe(trader.name)}</option>`).join("");
    openModal("⚖️ معاملة مسواجي", `<div class="form-grid">
      <label class="field">التاجر<select name="partyId">${options}</select></label>
      <label class="field">نوع المعاملة<select name="direction"><option value="from-us">علينا للتاجر (ذهب أو نقدية)</option><option value="to-us">لنا عند التاجر (ذهب أو نقدية)</option></select></label>
      <label class="field">نوع التسوية<select name="asset"><option value="gold">ذهب</option><option value="cash">نقدية</option></select></label>
      ${numberField("الوزن (g)", "weight", 0, { step: "0.001" })}${karatField("karat", 21)}
      ${numberField("المبلغ (ج)", "amount", 0, { step: "0.01" })}${textField("ملاحظات", "memo", "", { maxlength: 120 })}
    </div>`, values => {
      const trader = byId(state.traders, String(values.get("partyId")));
      const asset = String(values.get("asset"));
      const weight = asset === "gold" ? numeric(values.get("weight")) : 0;
      const amount = asset === "cash" ? clampMoney(values.get("amount")) : 0;
      if (!trader || (asset === "gold" ? weight <= 0 : amount <= 0)) { notify("أدخل كمية ذهب أو مبلغًا صحيحًا.", true); return; }
      const tx = {
        id: id(), group: "مسواجي", partyType: "trader", partyId: trader.id, partyName: trader.name,
        direction: String(values.get("direction")), kind: asset === "gold" ? "تسوية ذهب" : "تسوية نقدية",
        amount, gold21: asset === "gold" ? gold21(weight, numeric(values.get("karat"))) : 0,
        createdAt: new Date().toISOString(), memo: String(values.get("memo") || "").trim()
      };
      state.transactions.push(tx); persist(); closeModal(); render(); notify("تم تسجيل معاملة المسواجي.");
    }, "حفظ المعاملة");
  }

  function openTransactionChooser() {
    openModal("معاملة جديدة", `<div class="transaction-choices">
      <button type="button" class="choice-card" data-choice="wholesale">📋 فاتورة جملة</button>
      <button type="button" class="choice-card" data-choice="customer">👥 سداد من عميل</button>
      <button type="button" class="choice-card" data-choice="supplier">🤝 معاملة مورد</button>
      <button type="button" class="choice-card" data-choice="trader">⚖️ معاملة مسواجي</button>
    </div>`, () => {}, "إغلاق");
    $$(".choice-card").forEach(button => button.addEventListener("click", () => {
      const choice = button.dataset.choice;
      if (button.hidden) return;
      closeModal();
      if (choice === "wholesale") openInvoiceForm("جملة");
      else if (choice === "customer") openCustomerPayment();
      else if (choice === "supplier") openSupplierTransaction();
      else openTraderTransaction();
    }));
    const choicePermissions = {
      wholesale: [["invoices", "view"], ["invoices", "create"]],
      customer: [["customers", "view"], ["customers", "update"], ["invoices", "view"], ["invoices", "update"], ["transactions", "view"], ["transactions", "create"]],
      supplier: [["suppliers", "view"], ["transactions", "view"], ["transactions", "create"]],
      trader: [["traders", "view"], ["transactions", "view"], ["transactions", "create"]]
    };
    $$(".choice-card", $("#app-modal")).forEach(button => {
      button.hidden = !choicePermissions[button.dataset.choice].every(([resource, permission]) => hasPermission(resource, permission));
    });
    $(".form-footer", $("#app-modal")).hidden = true;
  }

  function openCustomerPayment() {
    if (!state.customers.length) { notify("أضف عميلًا أولاً حتى تسجل السداد."); state.page = "customers"; render(); return; }
    openModal("سداد من عميل", `<div class="form-grid">
      <label class="field">العميل<select name="partyId">${state.customers.map(customer => `<option value="${safe(customer.id)}">${safe(customer.name)}</option>`).join("")}</select></label>
      <label class="field">طريقة السداد<select name="paymentMethod"><option>كاش</option><option>أونلاين</option></select></label>
      ${numberField("المبلغ المدفوع (ج)", "amount", "", { required: true, step: "0.01" })}${textField("ملاحظات", "memo", "", { maxlength: 120 })}
    </div>`, values => {
      const customer = byId(state.customers, String(values.get("partyId")));
      const amount = clampMoney(values.get("amount"));
      if (!customer || amount <= 0) { notify("أدخل مبلغًا صحيحًا.", true); return; }
      const tx = { id: id(), group: "سداد عملاء", kind: "سداد عميل", partyType: "customer", partyId: customer.id, partyName: customer.name, amount, cashIn: values.get("paymentMethod") === "كاش" ? amount : 0, paymentMethod: String(values.get("paymentMethod")), createdAt: new Date().toISOString(), memo: String(values.get("memo") || "").trim() };
      let remaining = amount;
      state.invoices.filter(invoice => invoice.customerId === customer.id && invoice.remaining > 0).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach(invoice => {
        if (remaining <= 0) return;
        const applied = Math.min(invoice.remaining, remaining);
        invoice.paid += applied; invoice.remaining -= applied; remaining -= applied;
        invoice.payments ||= []; invoice.payments.push({ amount: applied, createdAt: tx.createdAt, paymentMethod: tx.paymentMethod });
      });
      state.transactions.push(tx);
      customer.balance = openCustomerCash(customer.id);
      persist(); closeModal(); state.page = "transactions"; render(); notify("تم تسجيل سداد العميل.");
    }, "تسجيل السداد");
  }

  function openSupplierTransaction() {
    if (!state.suppliers.length) { notify("أضف موردًا أولاً."); state.page = "suppliers"; render(); return; }
    openModal("معاملة مورد", `<div class="form-grid">
      <label class="field">المورد<select name="partyId">${state.suppliers.map(supplier => `<option value="${safe(supplier.id)}">${safe(supplier.name)}</option>`).join("")}</select></label>
      <label class="field">نوع المعاملة<select name="kind"><option value="شراء شغل">شراء شغل للمخزن</option><option value="استلام كسر">استلام كسر</option><option value="تسليم كسر">تسليم كسر لمورد</option><option value="سداد مورد">سداد نقدي للمورد</option><option value="شراء سبيكة">شراء سبيكة</option></select></label>
      ${numberField("الوزن (g)", "weight", 0, { step: "0.001" })}${karatField("karat", 21)}
      ${numberField("المبلغ (ج)", "amount", 0, { step: "0.01" })}${textField("ملاحظات", "memo", "", { maxlength: 120 })}
    </div>`, values => {
      const supplier = byId(state.suppliers, String(values.get("partyId")));
      const kind = String(values.get("kind"));
      const weight = numeric(values.get("weight"));
      const amount = clampMoney(values.get("amount"));
      if (!supplier || (kind === "سداد مورد" ? amount <= 0 : weight <= 0)) { notify("أدخل بيانات صحيحة للمعاملة.", true); return; }
      state.transactions.push({
        id: id(), group: "موردين", kind, partyType: "supplier", partyId: supplier.id, partyName: supplier.name,
        amount, gold21: weight ? gold21(weight, numeric(values.get("karat"))) : 0,
        cashOut: kind === "سداد مورد" ? amount : 0, createdAt: new Date().toISOString(), memo: String(values.get("memo") || "").trim()
      });
      persist(); closeModal(); render(); notify("تم تسجيل معاملة المورد.");
    }, "حفظ المعاملة");
  }

  function openDebtPayment(invoiceId) {
    const invoice = byId(state.invoices, invoiceId);
    if (!invoice) { notify("الفاتورة غير موجودة.", true); return; }
    openModal(`سداد مديونية الفاتورة #${safe(invoice.number || invoice.id.slice(-6))}`, `<p>العميل: <strong>${safe(customerName(invoice))}</strong> · المتبقي: <strong>${pounds(invoice.remaining)}</strong></p>
      <div class="form-grid">${numberField("المبلغ النقدي المسدد (ج)", "amount", 0, { step: "0.01" })}
      ${numberField("وزن الذهب المسدد (g)", "goldWeight", 0, { step: "0.001" })}${karatField("karat", 21)}
      <label class="field">طريقة الدفع<select name="paymentMethod"><option>كاش</option><option>أونلاين</option><option>ذهب</option></select></label></div>`, values => {
      const amount = clampMoney(values.get("amount"));
      const weight = numeric(values.get("goldWeight"));
      if (amount <= 0 && weight <= 0) { notify("أدخل مبلغًا أو وزنًا للسداد.", true); return; }
      const tx = { id: id(), group: "سداد عملاء", kind: "سداد مديونية قطاعي", partyType: "customer", partyId: invoice.customerId, partyName: customerName(invoice), invoiceId: invoice.id, amount, cashIn: values.get("paymentMethod") === "كاش" ? amount : 0, gold21: gold21(weight, numeric(values.get("karat"))), paymentMethod: String(values.get("paymentMethod")), createdAt: new Date().toISOString(), memo: "سداد مديونية" };
      invoice.paid = numeric(invoice.paid) + amount; invoice.remaining = Math.max(0, invoice.due - invoice.paid);
      invoice.goldDebt21 = Math.max(0, numeric(invoice.goldDebt21) - tx.gold21);
      invoice.payments ||= []; invoice.payments.push({ amount, gold21: tx.gold21, paymentMethod: tx.paymentMethod, createdAt: tx.createdAt });
      state.transactions.push(tx);
      const customer = byId(state.customers, invoice.customerId);
      if (customer) customer.balance = openCustomerCash(customer.id);
      persist(); closeModal(); render(); notify("تم تسجيل السداد.");
    }, "تسجيل السداد");
  }

  function showInvoice(invoiceId) {
    const invoice = byId(state.invoices, invoiceId);
    if (!invoice) { notify("الفاتورة غير موجودة.", true); return; }
    const itemList = [...invoice.sales, ...invoice.purchases, ...invoice.workItems, ...invoice.scrapItems];
    const lines = itemList.map(item => `<tr><td>${safe(item.description || item.kind || "صنف")}</td><td>${grams(item.weight)} عيار ${safe(item.karat)}</td><td>${grams(item.weight21)}</td><td>${pounds(item.total ?? item.fee)}</td></tr>`).join("");
    openModal(`فاتورة ${safe(invoice.type)} #${safe(invoice.number || invoice.id.slice(-6))}`, `<div class="summary-grid"><div><span>العميل</span><strong>${safe(customerName(invoice))}</strong></div><div><span>التاريخ</span><strong>${timestamp(invoice.createdAt)}</strong></div><div><span>الأجور/الصافي</span><strong>${pounds(invoice.due)}</strong></div>${invoice.roundingAdjustment ? `<div><span>فرق التقريب</span><strong>${safe(roundingDescription(invoice.roundingAdjustment))}</strong></div>` : ""}<div><span>المدفوع</span><strong>${pounds(invoice.paid)}</strong></div><div><span>المتبقي</span><strong>${pounds(invoice.remaining)}</strong></div><div><span>صافي الذهب (عيار٢١)</span><strong>${grams(numeric(invoice.goldSales21) - numeric(invoice.goldScrap21))}</strong></div></div>
      ${lines ? `<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>الصنف</th><th>الوزن والعيار</th><th>معادل عيار٢١</th><th>القيمة/الأجرة</th></tr></thead><tbody>${lines}</tbody></table></div>` : ""}
      ${invoice.notes ? `<p>ملاحظات: ${safe(invoice.notes)}</p>` : ""}
      ${invoice.remaining > 0 && canRunAction("collect-debt", { dataset: {} }) ? `<button type="button" class="btn btn-primary" data-modal-action="pay" data-id="${safe(invoice.id)}">تسجيل سداد</button>` : ""}
      <button type="button" class="btn btn-primary" data-modal-action="whatsapp">📲 إرسال الفاتورة واتساب</button>
      <button type="button" class="btn" data-modal-action="print">🖨️ طباعة الفاتورة</button>
      <button type="button" class="btn" data-dismiss style="margin-top:10px">إغلاق</button>`, () => closeModal(), "إغلاق");
    $(".form-footer", $("#app-modal")).hidden = true;
    $('[data-modal-action="pay"]')?.addEventListener("click", () => { closeModal(); openDebtPayment(invoice.id); });
    $('[data-modal-action="whatsapp"]')?.addEventListener("click", () => {
      const result = openInvoiceWhatsApp(invoice);
      if (result.opened) notify("تم فتح رسالة الفاتورة في واتساب؛ راجعها واضغط إرسال.");
      else notify(result.reason === "phone" ? "لا يوجد رقم هاتف صالح للعميل على واتساب." : "المتصفح منع فتح واتساب. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.", true);
    });
    $('[data-modal-action="print"]')?.addEventListener("click", () => printInvoice(invoice));
  }

  function printInvoice(invoice) {
    const items = [...invoice.sales, ...invoice.purchases, ...invoice.workItems, ...invoice.scrapItems];
    const itemRows = items.map(item => `<tr><td>${safe(item.description || item.kind || "صنف")}</td><td>${grams(item.weight)} عيار ${safe(item.karat)}</td><td>${grams(item.weight21)}</td><td>${pounds(item.total ?? item.fee)}</td></tr>`).join("");
    const printSheet = document.createElement("section");
    printSheet.id = "print-sheet";
    printSheet.innerHTML = `<header><img src="3K%20photo.png" alt=""><div><h1>${safe(state.settings.shopName)}</h1><p>${safe(state.settings.phone)}</p></div><strong>${safe(state.settings.emblem)}</strong></header>
      <h2>فاتورة ${safe(invoice.type)} رقم #${safe(invoice.number || invoice.id.slice(-6))}</h2>
      <p>العميل: ${safe(customerName(invoice))} · الهاتف: ${safe(invoice.phone || "—")} · التاريخ: ${timestamp(invoice.createdAt)}</p>
      ${itemRows ? `<table><thead><tr><th>الصنف</th><th>الوزن والعيار</th><th>المعادل عيار ٢١</th><th>القيمة / الأجرة</th></tr></thead><tbody>${itemRows}</tbody></table>` : ""}
      <div class="summary-grid"><div>الإجمالي المستحق <strong>${pounds(invoice.due)}</strong></div>${invoice.roundingAdjustment ? `<div>فرق التقريب <strong>${safe(roundingDescription(invoice.roundingAdjustment))}</strong></div>` : ""}<div>المدفوع <strong>${pounds(invoice.paid)}</strong></div><div>المتبقي <strong>${pounds(invoice.remaining)}</strong></div></div>
      ${invoice.notes ? `<p>ملاحظات: ${safe(invoice.notes)}</p>` : ""}
      ${state.settings.footer ? `<footer>${safe(state.settings.footer)}</footer>` : ""}`;
    $("#print-sheet")?.remove();
    document.body.append(printSheet);
    const clean = () => printSheet.remove();
    window.addEventListener("afterprint", clean, { once: true });
    window.print();
  }

  function openDateRange() {
    openModal("فترة مخصصة", `<div class="form-grid"><label class="field">من<input name="from" type="date" value="${safe(state.fromDate || "")}"></label><label class="field">إلى<input name="to" type="date" value="${safe(state.toDate || "")}"></label></div>`, values => {
      state.fromDate = String(values.get("from") || "");
      state.toDate = String(values.get("to") || "");
      state.range = "مخصص";
      persist(); closeModal(); render();
    }, "تطبيق");
  }

  function saveSettings(event) {
    event.preventDefault();
    if (!hasPermission("settings", "view") || !hasPermission("settings", "update")) {
      notify("ليس لديك صلاحية تعديل الإعدادات.", true);
      return;
    }
    const values = new FormData(event.currentTarget);
    state.settings = {
      shopName: String(values.get("shopName") || "").trim(),
      phone: String(values.get("phone") || "").trim(),
      emblem: String(values.get("emblem") || "👑"),
      defaultKarat: Number(values.get("defaultKarat")),
      footer: String(values.get("footer") || "").trim()
    };
    persist(); render(); notify("تم حفظ الإعدادات.");
  }

  function addUser(event) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") || "").trim().toLowerCase();
    if (state.users.some(user => user.email.toLowerCase() === email)) { notify("هذا المستخدم مضاف بالفعل.", true); return; }
    state.users.push({ email, role: "مستخدم محلي" });
    persist(); render(); notify("تمت إضافة المستخدم إلى القائمة المحلية.");
  }

  function removeUser(index) {
    if (index <= 0 || !state.users[index]) return;
    state.users.splice(index, 1); persist(); render(); notify("تمت إزالة المستخدم.");
  }

  function exportJson() {
    if (!canRunAction("export-json")) { notify("ليس لديك صلاحية تصدير البيانات.", true); return; }
    try {
      download(new Blob([JSON.stringify({ application: "3K Jewelry Store", version: 2, exportedAt: new Date().toISOString(), data: state }, null, 2)], { type: "application/json" }), `3K-Backup-${new Date().toISOString().slice(0, 10)}.json`);
      notify("تم تنزيل ملف الاسترجاع.");
    } catch (error) {
      console.error("تعذر إنشاء ملف الاسترجاع:", error);
      notify("تعذر تنزيل النسخة الاحتياطية.", true);
    }
  }

  function exportCsv() {
    if (!canRunAction("export-csv")) { notify("ليس لديك صلاحية تصدير البيانات.", true); return; }
    const rows = [["رقم الفاتورة", "النوع", "العميل", "الهاتف", "التاريخ", "صافي المبلغ", "المدفوع", "المتبقي", "ذهب بيع عيار21", "ذهب كسر عيار21"]];
    state.invoices.forEach(invoice => rows.push([
      invoice.number || invoice.id, invoice.type, customerName(invoice), invoice.phone || "",
      new Date(invoice.createdAt).toLocaleDateString("ar-EG"), invoice.due, invoice.paid, invoice.remaining,
      invoice.goldSales21, invoice.goldScrap21
    ]));
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `3K-Invoices-${new Date().toISOString().slice(0, 10)}.csv`);
    notify("تم تنزيل ملف الفواتير.");
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let name = "";
    while (index > 0) {
      const remainder = (index - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      index = Math.floor((index - 1) / 26);
    }
    return name;
  }

  function worksheetXml(rows) {
    const sheetRows = rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const address = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
        if (typeof value === "number" && Number.isFinite(value)) return `<c r="${address}"><v>${value}</v></c>`;
        return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let value = n;
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        crc32.table[n] = value >>> 0;
      }
    }
    let checksum = 0xffffffff;
    for (const byte of bytes) checksum = crc32.table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
    return (checksum ^ 0xffffffff) >>> 0;
  }

  function zipFiles(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const centralChunks = [];
    let localOffset = 0;
    for (const [fileName, contents] of files) {
      const name = encoder.encode(fileName);
      const data = encoder.encode(contents);
      const checksum = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      chunks.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, localOffset, true);
      central.set(name, 46);
      centralChunks.push(central);
      localOffset += local.length + data.length;
    }
    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    return new Blob([...chunks, ...centralChunks, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function exportXlsx() {
    if (!canRunAction("export-xlsx")) { notify("ليس لديك صلاحية تصدير البيانات.", true); return; }
    try {
      const invoiceRows = [["رقم الفاتورة", "النوع", "العميل", "الهاتف", "التاريخ", "المستحق", "المدفوع", "المتبقي", "ذهب البيع عيار 21", "ذهب الكسر عيار 21", "ذهب الدين عيار 21", "ملاحظات"]];
      const itemRows = [["رقم الفاتورة", "نوع البند", "الصنف", "الوزن", "العيار", "المعادل عيار 21", "القيمة", "الأجرة"]];
      state.invoices.forEach(invoice => {
        invoiceRows.push([
          invoice.number || invoice.id, invoice.type, customerName(invoice), invoice.phone || "",
          invoice.createdAt || "", numeric(invoice.due), numeric(invoice.paid), numeric(invoice.remaining),
          numeric(invoice.goldSales21), numeric(invoice.goldScrap21), numeric(invoice.goldDebt21), invoice.notes || ""
        ]);
        for (const [kind, items] of [["بيع", invoice.sales], ["شراء كسر", invoice.purchases], ["شغل جملة", invoice.workItems], ["كسر جملة", invoice.scrapItems]]) {
          for (const item of items || []) itemRows.push([
            invoice.number || invoice.id, kind, item.description || item.kind || "", numeric(item.weight),
            numeric(item.karat), numeric(item.weight21), numeric(item.total), numeric(item.fee)
          ]);
        }
      });
      const peopleRows = records => [
        ["الاسم", "الهاتف", "الرصيد", "ملاحظات"],
        ...records.map(person => [person.name || "", person.phone || "", numeric(person.balance), person.notes || ""])
      ];
      const transactionRows = [
        ["التاريخ", "المجموعة", "النوع", "الطرف", "المبلغ", "نقدية داخلة", "نقدية خارجة", "ذهب عيار 21", "ملاحظات"],
        ...state.transactions.map(tx => [tx.createdAt || "", tx.group || "", tx.kind || "", tx.partyName || "", numeric(tx.amount), numeric(tx.cashIn), numeric(tx.cashOut), numeric(tx.gold21), tx.memo || ""])
      ];
      const sheets = [
        ["الفواتير", invoiceRows],
        ["أصناف الفواتير", itemRows],
        ["العملاء", peopleRows(state.customers)],
        ["الموردون", peopleRows(state.suppliers)],
        ["المسواجي", peopleRows(state.traders)],
        ["المعاملات", transactionRows]
      ];
      const sheetParts = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
      const workbookSheets = sheets.map(([name], index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
      const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
      const files = [
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetParts}</Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`],
        ...sheets.map(([, rows], index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(rows)])
      ];
      download(zipFiles(files), `3K-Store-${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify("تم تنزيل ملف Excel بأوراق الفواتير والأصناف والعملاء والموردين والمسواجي والمعاملات.");
    } catch (error) {
      console.error("تعذر إنشاء ملف Excel:", error);
      notify("تعذر إنشاء ملف Excel.", true);
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(event) {
    if (!hasPermission("backup", "view") || !hasPermission("backup", "import")) {
      notify("ليس لديك صلاحية استيراد نسخة احتياطية.", true);
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed?.data;
      const collections = ["invoices", "customers", "suppliers", "traders", "transactions"];
      if (parsed?.application !== "3K Jewelry Store" || !incoming || collections.some(key => !Array.isArray(incoming[key]))) {
        throw new Error("ملف النسخة الاحتياطية غير صالح أو غير مدعوم.");
      }
      for (const key of collections) {
        const existing = new Set(state[key].map(record => record.id));
        const fresh = [];
        for (const record of incoming[key]) {
          if (!record?.id || existing.has(record.id)) continue;
          existing.add(record.id);
          fresh.push(record);
        }
        state[key].push(...fresh);
      }
      state.settings = { ...state.settings, ...(incoming.settings || {}) };
      persist(); render(); notify("تم دمج بيانات النسخة الاحتياطية.");
    } catch (error) {
      console.error("تعذر استيراد النسخة الاحتياطية:", error);
      notify(error.message || "تعذر قراءة ملف النسخة الاحتياطية.", true);
    } finally {
      event.target.value = "";
    }
  }

  function boot() {
    state.txFilter ||= "الكل";
    state.transactions ||= [];
    state.traders ||= [];
    state.users ||= [{ email: "صاحب المحل", role: "مالك" }];
    state.invoices = state.invoices.map(normalizeInvoice);
    const priorMenu = $("#menu-button");
    const priorBackup = $("#backup-button");
    if (priorMenu && priorBackup) {
      bindGlobalControls();
      configurePwa();
      render();
      persist();
      window.ThreeKStore = { calculateRetail, calculateWholesale, gold21, getData: () => structuredClone(state) };
      loadCloudSession();
    }
  }

  function runAction(button) {
    const action = button.dataset.action;
    const recordId = button.dataset.id;
    if (action === "new-wholesale") openInvoiceForm("جملة");
    else if (action === "new-retail") openInvoiceForm("قطاعي");
    else if (action === "add-person") openPersonForm(button.dataset.kind);
    else if (action === "edit-person") openPersonForm(button.dataset.kind, recordId);
    else if (action === "person-details") showPersonDetails(button.dataset.kind, recordId);
    else if (action === "add-trader") openTraderForm();
    else if (action === "trader-transaction") openTraderTransaction(recordId);
    else if (action === "trader-details") showTraderDetails(recordId);
    else if (action === "new-transaction") openTransactionChooser();
    else if (action === "refresh") render();
    else if (action === "collect-debt") openDebtPayment(recordId);
    else if (action === "view-invoice") showInvoice(recordId);
    else if (action === "date-range") openDateRange();
    else if (action === "export-json") exportJson();
    else if (action === "export-csv") exportCsv();
    else if (action === "remove-user") removeUser(Number(button.dataset.index));
  }

  boot();
})();
