/* category-filter-patch.js
 * ضع هذا الكود بعد كود التطبيق الحالي، أو استبدل به دالتي
 * renderPosChips و renderPosList في index.html.
 */
(function () {
  'use strict';

  function productCategories() {
    const counts = new Map();

    activeProducts().forEach((product) => {
      const category = String(product.category || 'عام').trim() || 'عام';
      counts.set(category, (counts.get(category) || 0) + 1);
    });

    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'ar'))
      .map(([name, count]) => ({ name, count }));
  }

  function renderCategoriesFromProducts() {
    const wrap = document.getElementById('posChips');
    if (!wrap) {
      return;
    }

    const categories = productCategories();
    const validNames = new Set(categories.map((item) => item.name));

    if (posFilterCat !== 'الكل' && !validNames.has(posFilterCat)) {
      posFilterCat = 'الكل';
    }

    const total = activeProducts().length;
    const buttons = [
      `<button type="button" class="chip category-chip ${posFilterCat === 'الكل' ? 'active' : ''}" data-cat="الكل">الكل <span>${total}</span></button>`,
      ...categories.map(
        (item) => `
        <button type="button" class="chip category-chip ${item.name === posFilterCat ? 'active' : ''}" data-cat="${esc(item.name)}">
          ${esc(item.name)} <span>${item.count}</span>
        </button>
      `
      ),
    ];

    wrap.innerHTML = buttons.join('');
  }

  function renderProductsBySelectedCategory() {
    const term = posSearchTerm.trim().toLowerCase();
    const products = activeProducts().filter((product) => {
      const category = String(product.category || 'عام').trim() || 'عام';
      const categoryMatches = posFilterCat === 'الكل' || category === posFilterCat;
      const textMatches =
        !term ||
        String(product.name || '')
          .toLowerCase()
          .includes(term) ||
        String(product.barcode || '')
          .toLowerCase()
          .includes(term);

      return categoryMatches && textMatches;
    });

    const list = document.getElementById('posList');
    const more = document.getElementById('posLoadMoreWrap');
    if (!list || !more) {
      return;
    }

    if (!products.length) {
      list.innerHTML = '<div class="empty">لا توجد أصناف في هذا القسم.</div>';
      more.innerHTML = '';
      return;
    }

    const visible = products.slice(0, posRenderLimit);
    list.innerHTML = visible
      .map((product) => {
        const qty = Number(product.qty || 0);
        const low = qty <= Number(product.minQty || 0);
        const initial = esc(
          String(product.name || 'م')
            .trim()
            .charAt(0) || 'م'
        );

        return `
        <button class="product-tile ${qty <= 0 ? 'is-empty' : ''}"
          data-add="${esc(product.id)}"
          type="button"
          aria-label="إضافة ${esc(product.name)} إلى السلة">
          <span class="product-tile-head">
            <span class="product-avatar">${initial}</span>
            <span class="product-category">${esc(product.category || 'عام')}</span>
          </span>
          <span class="product-tile-name">${esc(product.name)}</span>
          <span class="product-tile-footer">
            <span class="product-stock ${low ? 'is-low' : ''}">
              ${qty > 0 ? `متاح ${qty} ${esc(product.unit || '')}` : 'نفد المخزون'}
            </span>
            <strong class="product-price num">${money(product.sellPrice)}</strong>
          </span>
        </button>
      `;
      })
      .join('');

    if (products.length > visible.length) {
      more.innerHTML = `<button class="btn btn-ghost btn-block" id="posLoadMoreBtn" type="button">عرض المزيد (متبقي ${products.length - visible.length})</button>`;
      document.getElementById('posLoadMoreBtn').addEventListener('click', () => {
        posRenderLimit += 60;
        renderProductsBySelectedCategory();
      });
    } else {
      more.innerHTML = '';
    }
  }

  // استبدال دوال العرض الأصلية.
  window.renderPosChips = renderCategoriesFromProducts;
  window.renderPosList = renderProductsBySelectedCategory;

  // تشغيل التعديل بعد اكتمال تحميل التطبيق.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderCategoriesFromProducts();
      renderProductsBySelectedCategory();
    });
  } else {
    renderCategoriesFromProducts();
    renderProductsBySelectedCategory();
  }
})();
