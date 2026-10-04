/* تحسين عرض فئات المنتجات — يعمل عبر واجهة التطبيق العامة فقط. */
(function () {
  "use strict";
  const app = window.MatgarUI;
  if (!app) return;

  function productCategories() {
    const counts = new Map();
    app.activeProducts().forEach((product) => {
      const category = String(product.category || "عام").trim() || "عام";
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ar"))
      .map(([name, count]) => ({ name, count }));
  }

  function renderCategoriesFromProducts() {
    const wrap = document.getElementById("posChips");
    if (!wrap) return;
    const categories = productCategories();
    const current = app.getCategory();
    const validNames = new Set(categories.map((item) => item.name));
    if (current !== "الكل" && !validNames.has(current)) app.setCategory("الكل");
    const selected = app.getCategory();
    const total = app.activeProducts().length;
    const buttons = [
      `<button type="button" class="chip category-chip ${selected === "الكل" ? "active" : ""}" data-cat="الكل">الكل <span>${total}</span></button>`,
      ...categories.map((item) => `
        <button type="button" class="chip category-chip ${item.name === selected ? "active" : ""}" data-cat="${app.esc(item.name)}">
          ${app.esc(item.name)} <span>${item.count}</span>
        </button>`)
    ];
    wrap.innerHTML = buttons.join("");
  }

  function renderProductsBySelectedCategory() {
    const term = app.getSearch().trim().toLowerCase();
    const selected = app.getCategory();
    const products = app.activeProducts().filter((product) => {
      const category = String(product.category || "عام").trim() || "عام";
      return (selected === "الكل" || category === selected) &&
        (!term || String(product.name || "").toLowerCase().includes(term) || String(product.barcode || "").toLowerCase().includes(term));
    });
    const list = document.getElementById("posList");
    const more = document.getElementById("posLoadMoreWrap");
    if (!list || !more) return;
    if (!products.length) {
      list.innerHTML = '<div class="empty">لا توجد أصناف في هذا القسم.</div>';
      more.innerHTML = "";
      return;
    }
    const visible = products.slice(0, app.getLimit());
    list.innerHTML = visible.map((product) => {
      const qty = Number(product.qty || 0);
      const low = qty <= Number(product.minQty || 0);
      const initial = app.esc(String(product.name || "م").trim().charAt(0) || "م");
      return `<button class="product-tile ${qty <= 0 ? "is-empty" : ""}" data-add="${app.esc(product.id)}" type="button" aria-label="إضافة ${app.esc(product.name)} إلى السلة">
        <span class="product-tile-head"><span class="product-avatar">${initial}</span><span class="product-category">${app.esc(product.category || "عام")}</span></span>
        <span class="product-tile-name">${app.esc(product.name)}</span>
        <span class="product-tile-footer"><span class="product-stock ${low ? "is-low" : ""}">${qty > 0 ? `متاح ${qty} ${app.esc(product.unit || "")}` : "نفد المخزون"}</span><strong class="product-price num">${app.money(product.sellPrice)}</strong></span>
      </button>`;
    }).join("");
    if (products.length > visible.length) {
      more.innerHTML = `<button class="btn btn-ghost btn-block" id="posLoadMoreBtn" type="button">عرض المزيد (متبقي ${products.length - visible.length})</button>`;
      document.getElementById("posLoadMoreBtn").addEventListener("click", () => {
        app.setLimit(app.getLimit() + 60);
        renderProductsBySelectedCategory();
      });
    } else more.innerHTML = "";
  }

  window.renderPosChips = renderCategoriesFromProducts;
  window.renderPosList = renderProductsBySelectedCategory;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      renderCategoriesFromProducts();
      renderProductsBySelectedCategory();
    }, { once: true });
  } else {
    renderCategoriesFromProducts();
    renderProductsBySelectedCategory();
  }
})();
