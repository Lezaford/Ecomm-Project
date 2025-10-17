// checkout.js — modal checkout for cart.html (frontend-only, mailto fallback)
(function () {
  "use strict";

  const TAX_RATE = 0.075;
  const SHIPPING_FLAT = 14.99;

  /* ---------------- Utilities ---------------- */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "style") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }
  function fmt(n) { return "$" + Number(n || 0).toFixed(2); }
  function nowOrderId() {
    const d = new Date();
    return "ORD-" +
      d.getFullYear().toString().slice(-2) +
      String(d.getMonth()+1).padStart(2,"0") +
      String(d.getDate()).padStart(2,"0") + "-" +
      d.getTime().toString().slice(-5);
  }
  function getCart() {
    try { return JSON.parse(localStorage.getItem("cart") || "[]"); } catch { return []; }
  }
  function setCart(cart) {
    localStorage.setItem("cart", JSON.stringify(cart));
    const count = cart.reduce((s, it) => s + (Number(it.qty)||0), 0);
    localStorage.setItem("cartCount", String(count));
    const cc = document.getElementById("cart-count");
    if (cc) cc.textContent = String(count);
  }
  function stripDigits(s) { return String(s||"").replace(/\D+/g, ""); }

  // Luhn check for card numbers
  function luhnOK(num) {
    const s = stripDigits(num);
    let sum = 0, dbl = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let d = s.charCodeAt(i) - 48;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return (sum % 10) === 0;
  }

  function validate(form) {
    const errors = {};

    // Names
    if (!form.firstName.value.trim()) errors.firstName = "Required";
    if (!form.lastName.value.trim())  errors.lastName  = "Required";

    // Email
    const email = form.email.value.trim();
    if (!email) errors.email = "Required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Invalid email";

    // Address
    if (!form.address1.value.trim()) errors.address1 = "Required";
    if (!form.city.value.trim())     errors.city     = "Required";

    const st = form.state.value.trim().toUpperCase();
    if (!/^[A-Za-z]{2}$/.test(st)) errors.state = "Use 2-letter code";

    const zip = stripDigits(form.zip.value);
    if (!zip) errors.zip = "Required";
    else if (!(zip.length === 5 || zip.length === 9)) errors.zip = "Use 5 or 9 digits";

    // Card number: 16 digits + Luhn
    const card = stripDigits(form.card.value);
    if (card.length !== 16) errors.card = "Must be 16 digits";
    else if (!luhnOK(card)) errors.card = "Invalid Card number";

    // Exp (MM/YY) and not expired (end of month)
    const exp = form.exp.value.trim();
    const m = /^(\d{2})\/(\d{2})$/.exec(exp);
    if (!m) errors.exp = "Use MM/YY";
    else {
      const mm = Number(m[1]), yy = Number(m[2]);
      if (mm < 1 || mm > 12) errors.exp = "Invalid month";
      const year = 2000 + yy;
      const expDate = new Date(year, mm, 0, 23, 59, 59, 999); // last day of month
      if (expDate < new Date()) errors.exp = "Card expired";
    }

    // CVV 3–4 digits
    const cvv = stripDigits(form.cvv.value);
    if (!(cvv.length === 3 || cvv.length === 4)) errors.cvv = "3 or 4 digits";

    return errors;
  }

  function showErrors(form, errors) {
    for (const el of form.querySelectorAll(".err")) el.textContent = "";
    Object.entries(errors).forEach(([key, message]) => {
      const span = form.querySelector(`[data-err="${key}"]`);
      if (span) span.textContent = message;
    });
  }

  async function buildOrderSummary() {
    const lines = getCart(); // [{id, qty}]
    const detailed = [];
    let subtotal = 0;

    for (const line of lines) {
      const part = await DB.getPartByIdOrNumber(line.id);
      const qty  = Number(line.qty) || 0;
      const unit = (part && typeof part.price === "number") ? part.price : 0;
      const name = part ? (part.name || part.description || "(Unnamed Part)") : "(Unknown Part)";
      const num  = part ? (part.number || part.id || line.id) : line.id;
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      detailed.push({ id: (part?.id || line.id), num, name, qty, unit, lineTotal });
    }

    const tax = subtotal * TAX_RATE;
    const shipping = subtotal > 0 ? SHIPPING_FLAT : 0;
    const total = subtotal + tax + shipping;

    return { detailed, subtotal, tax, shipping, total };
  }

  function sendEmails({ orderId, customer, summary }) {
    // Frontend-only fallback: open 2 mailto: drafts.
    // Replace this with a real API call on your backend to actually send emails.
    const toCustomer = encodeURIComponent(customer.email);
    const toOwner    = encodeURIComponent("evanbradleymayo94@gmail.com");

    const itemsText = summary.detailed.map(
      d => `• ${d.name} (Part #${d.num}) — ${d.qty} × ${fmt(d.unit)} = ${fmt(d.lineTotal)}`
    ).join("%0A");

    const shipText = [
      `${customer.firstName} ${customer.lastName}`,
      customer.address1,
      `${customer.city}, ${customer.state} ${customer.zip}`
    ].map(encodeURIComponent).join("%0A");

    const subjectCust = encodeURIComponent(`Your order ${orderId} is on the way`);
    const bodyCust =
      `Hi ${encodeURIComponent(customer.firstName)},%0A%0A` +
      `Thanks for your order ${orderId}. Here’s your summary:%0A` +
      `${itemsText}%0A%0A` +
      `Subtotal: ${fmt(summary.subtotal)}%0A` +
      `Tax (7.5%): ${fmt(summary.tax)}%0A` +
      `Shipping: ${fmt(summary.shipping)}%0A` +
      `Total: ${fmt(summary.total)}%0A%0A` +
      `Ship To:%0A${shipText}%0A%0A` +
      `We’ll notify you when it ships.`;

    const subjectOwner = encodeURIComponent(`New order ${orderId}`);
    const bodyOwner =
      `Order ID: ${orderId}%0A` +
      `Customer: ${encodeURIComponent(customer.firstName + " " + customer.lastName)}%0A` +
      `Email: ${toCustomer}%0A%0A` +
      `Ship To:%0A${shipText}%0A%0A` +
      `Items:%0A${itemsText}%0A%0A` +
      `Subtotal: ${fmt(summary.subtotal)}%0A` +
      `Tax: ${fmt(summary.tax)}%0A` +
      `Shipping: ${fmt(summary.shipping)}%0A` +
      `Total: ${fmt(summary.total)}`;

    // Open drafts (user may need to allow popups)
    window.open(`mailto:${toCustomer}?subject=${subjectCust}&body=${bodyCust}`, "_blank");
    window.open(`mailto:${toOwner}?subject=${subjectOwner}&body=${bodyOwner}`, "_blank");
  }

  function closeModal(overlay) {
    overlay.remove();
    document.body.style.overflow = "";
  }

  function openModal() {
    // Overlay + modal
    const overlay = el("div", { style: {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.45)", zIndex: "1000",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "16px"
    }});
    const modal = el("div", { style: {
      width: "min(680px, 100%)", maxHeight: "90vh", overflow: "auto",
      background: "#fff", borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
      padding: "20px"
    }});

    const title = el("h2", {}, "Checkout");

    // Address row with Street, City, State, ZIP
    const addressGrid = el("div", { style: { display: "grid", gap: "8px" } },
      field("Street Address", "address1", "text", {autocomplete:"street-address"}),
      grid3(
        field("City", "city", "text", {autocomplete:"address-level2"}),
        field("State", "state", "text", {autocomplete:"address-level1", maxlength:"2"}),
        field("ZIP Code", "zip", "text", {inputmode:"numeric", autocomplete:"postal-code"})
      )
    );

    const form = el("form", { id: "checkout-form" },
      el("h3", {}, "Shipping"),
      row2(
        field("First Name", "firstName", "text", {autocomplete:"given-name"}),
        field("Last Name",  "lastName",  "text", {autocomplete:"family-name"})
      ),
      field("Email", "email", "email", {autocomplete:"email"}),
      addressGrid,

      el("h3", { style: { marginTop: "12px" } }, "Payment"),
      field("Card Number", "card", "text", {inputmode:"numeric", placeholder:"1234 5678 9012 3456"}),
      row2(
        field("Expiration (MM/YY)", "exp", "text", {placeholder:"MM/YY"}),
        field("CVV", "cvv", "text", {inputmode:"numeric", placeholder:"3 or 4 digits"})
      ),

      el("div", { style: { display: "flex", gap: "8px", marginTop: "16px", justifyContent: "flex-end" } },
        el("button", { type: "button", id: "cancel-btn" }, "Cancel"),
        el("button", { type: "submit", id: "place-order" }, "Place Order")
      )
    );

    modal.appendChild(title);
    modal.appendChild(form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    // Dismiss behavior
    function doClose() { closeModal(overlay); document.removeEventListener("keydown", escClose); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) doClose(); });
    document.getElementById("cancel-btn").addEventListener("click", doClose);
    function escClose(e){ if (e.key === "Escape") doClose(); }
    document.addEventListener("keydown", escClose);

    // Normalize state to uppercase
    form.state.addEventListener("blur", () => { form.state.value = form.state.value.trim().toUpperCase(); });

    // Submit handler
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Guard: no items
      const cart = getCart();
      if (!cart.length) { alert("Your cart is empty."); return; }

      // Validate
      const errs = validate(form);
      showErrors(form, errs);
      if (Object.keys(errs).length) return;

      // Build order summary
      const orderId = nowOrderId();
      const summary = await buildOrderSummary();

      // “Send” emails via mailto (replace with real API later)
      const customer = {
        firstName: form.firstName.value.trim(),
        lastName:  form.lastName.value.trim(),
        email:     form.email.value.trim(),
        address1:  form.address1.value.trim(),
        city:      form.city.value.trim(),
        state:     form.state.value.trim().toUpperCase(),
        zip:       stripDigits(form.zip.value)
      };
      sendEmails({ orderId, customer, summary });

      // Clear cart
      setCart([]);

      // Close modal and notify
      doClose();
      alert("Order placed! Confirmation drafts were opened in your email client.");

      // Optional: refresh cart page
      try {
        if (location.pathname.endsWith("cart.html")) location.reload();
      } catch {}
    });
  }

  // Field helpers
  function field(label, name, type, attrs={}) {
    const input = el("input", Object.assign({ id: name, name, type: type || "text", required: "" }, attrs));
    const err = el("div", { class: "err", "data-err": name, style: { color: "#c21500", fontSize: "0.85rem", minHeight: "1.1em", marginTop: "2px" } }, "");
    const wrap = el("label", { for: name, style: { display: "block", marginBottom: "8px" } },
      el("span", { style: { display:"block", fontWeight: "600", marginBottom: "4px" } }, label),
      input,
      err
    );
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.padding = "8px";
    input.style.border = "1px solid #ddd";
    input.style.borderRadius = "6px";
    return wrap;
  }
  function row2(a, b) {
    return el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } }, a, b);
  }
  function grid3(a, b, c) {
    return el("div", { style: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px" } }, a, b, c);
  }

  // Wire the cart page button
  function attach() {
    const btn = document.getElementById("checkout-btn");
    if (!btn) return;
    btn.disabled = false;
    btn.addEventListener("click", (e) => { e.preventDefault(); openModal(); });
  }

  // Initialize
  (async function init() {
    try { await DB.load(); } catch (e) { /* still allow opening the modal; pricing may be $0 */ }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attach);
    } else {
      attach();
    }
  })();
})();
