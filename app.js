/* =========================================================
   Souvenirs de Paris — Catalogue App (v2, Supabase)
   ========================================================= */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { headers: { 'Cache-Control': 'no-cache' } }
});

if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY && !EMAILJS_PUBLIC_KEY.startsWith('REMPLACER')) {
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
}

/* ---------- Constantes ---------- */
const TVA_RATE = 0.20; // 20% — appliqué uniquement au moment de la confirmation de commande

/* ---------- État ---------- */
let categories = [];
let products = [];
let settings = { shop_name: 'Souvenirs de Paris', whatsapp: '', email: '', admin_pin: '1234', next_order_number: 1 };
let cart = {}; // { productId: qty }  (qty déjà en unités réelles, multiples de unit_step)
let activeCategory = 'all';
let searchTerm = '';
let editingProductId = null;
let adminUnlocked = false;
let pendingImageData = null;
let currentUnitMode = 'unit'; // 'unit' | 'bulk'

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function fmtPrice(n) {
  return n.toFixed(2).replace('.', ',') + ' €';
}
function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

/* ---------- Drawers ---------- */
function openDrawer(id) {
  document.getElementById('overlay').classList.add('show');
  document.getElementById(id).classList.add('show');
}
function closeDrawer(id) {
  document.getElementById(id).classList.remove('show');
  const anyOpen = Array.from(document.querySelectorAll('.drawer')).some(d => d.classList.contains('show'));
  if (!anyOpen) document.getElementById('overlay').classList.remove('show');
}
function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.classList.remove('show'));
  document.getElementById('overlay').classList.remove('show');
}

/* =========================================================
   CHARGEMENT DES DONNÉES (Supabase)
   ========================================================= */
async function loadAllData() {
  try {
    const [catRes, prodRes, settRes] = await Promise.all([
      supabaseClient.from('categories').select('*').order('sort_order'),
      supabaseClient.from('products').select('*').order('sort_order'),
      supabaseClient.from('settings').select('*').eq('id', 1).single()
    ]);
    if (catRes.error) throw catRes.error;
    if (prodRes.error) throw prodRes.error;
    if (settRes.error) throw settRes.error;

    categories = (catRes.data || []).map(c => ({
      id: c.id, name: c.name, sort_order: c.sort_order,
      bulkGroupId: c.bulk_group_id || null,
      bulkThresholdQty: c.bulk_threshold_qty || null,
      bulkPrice: c.bulk_price != null ? Number(c.bulk_price) : null
    }));
    products = (prodRes.data || []).map(p => ({
      id: p.id, ref: p.ref, name: p.name, price: Number(p.price),
      categoryId: p.category_id, image: p.image,
      unitStep: p.unit_step || 1, unitLabel: p.unit_label || '',
      outOfStock: !!p.out_of_stock, featured: !!p.featured,
      hidden: !!p.hidden
    }));
    settings = settRes.data || settings;

    document.getElementById('shopNameDisplay').textContent = settings.shop_name || 'Souvenirs de Paris';
    document.getElementById('loadingState').style.display = 'none';
    renderCategoryStrip();
    renderGrid();
    renderHomeTiles();
    startOrderPolling();
  } catch (e) {
    console.error('Erreur de chargement', e);
    document.getElementById('loadingState').innerHTML =
      `<div style="opacity:0.85;">⚠️ Impossible de charger le catalogue.<br><small>${escapeHtml(e.message || '')}</small></div>`;
  }
}

/* =========================================================
   RENDU — Catégories
   ========================================================= */
function renderCategoryStrip() {
  const strip = document.getElementById('catStrip');
  const visibleProducts = products.filter(p => !p.hidden);
  const allCount = visibleProducts.length;
  let html = `<button class="cat-chip catalogue-chip" data-action="open-catalogue">🗂️ Catalogue</button>`;
  html += `<button class="cat-chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">Tout <span class="count">${allCount}</span></button>`;
  const featuredCount = visibleProducts.filter(p => p.featured).length;
  if (featuredCount > 0) {
    html += `<button class="cat-chip featured-chip ${activeCategory === 'featured' ? 'active' : ''}" data-cat="featured">⭐ Meilleures ventes <span class="count">${featuredCount}</span></button>`;
  }
  categories.forEach(c => {
    const count = visibleProducts.filter(p => p.categoryId === c.id).length;
    html += `<button class="cat-chip ${activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)} <span class="count">${count}</span></button>`;
  });
  strip.innerHTML = html;
  strip.querySelectorAll('.cat-chip[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderCategoryStrip();
      renderGrid();
    });
  });
  const catalogueBtn = strip.querySelector('[data-action="open-catalogue"]');
  if (catalogueBtn) {
    catalogueBtn.addEventListener('click', () => {
      renderHomeTiles();
      openDrawer('catalogueDrawer');
    });
  }
}

/* =========================================================
   Notifications — nouvelle commande (son + alerte interne)
   ========================================================= */
let knownOrderIds = new Set();
let orderPollingStarted = false;

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = ctx.currentTime;
    playTone(880, now, 0.18);
    playTone(1175, now + 0.16, 0.22);
  } catch (e) {
    console.warn('Son indisponible', e);
  }
}

function showNewOrderBanner(order) {
  const banner = document.createElement('div');
  banner.className = 'new-order-banner';
  banner.innerHTML = `
    <div class="nob-icon">🎫</div>
    <div class="nob-text">
      <strong>Nouvelle commande n°${escapeHtml(order.order_number)}</strong>
      <span>${escapeHtml(order.client_name || 'Client')}${order.shop_name ? ' — ' + escapeHtml(order.shop_name) : ''}</span>
    </div>
    <button class="nob-close">✕</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('.nob-close').addEventListener('click', () => banner.remove());
  setTimeout(() => banner.classList.add('show'), 50);
  setTimeout(() => {
    banner.classList.remove('show');
    setTimeout(() => banner.remove(), 400);
  }, 8000);
}

async function checkForNewOrders() {
  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('id, order_number, client_name, shop_name, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data) return;

    if (knownOrderIds.size === 0) {
      // premier chargement : juste mémoriser, ne pas notifier rétroactivement
      data.forEach(o => knownOrderIds.add(o.id));
      return;
    }

    const newOnes = data.filter(o => !knownOrderIds.has(o.id));
    newOnes.forEach(o => knownOrderIds.add(o.id));

    if (newOnes.length > 0) {
      playNotificationSound();
      newOnes.forEach(o => showNewOrderBanner(o));
      if (adminUnlocked) renderAdminOrderList();
    }
  } catch (e) {
    console.warn('Vérification des commandes échouée', e);
  }
}

function startOrderPolling() {
  if (orderPollingStarted) return;
  orderPollingStarted = true;
  checkForNewOrders(); // initialise knownOrderIds sans notifier
  setInterval(checkForNewOrders, 30000);
}

/* =========================================================
   CATALOGUE PAR CATÉGORIE — mosaïque dans un tiroir
   ========================================================= */
function renderHomeTiles() {
  const container = document.getElementById('homeTilesContainer');
  const visibleProducts = products.filter(p => !p.hidden);
  let html = '';
  const featuredCount = visibleProducts.filter(p => p.featured).length;
  if (featuredCount > 0) {
    const sample = visibleProducts.find(p => p.featured);
    html += `
    <div class="home-tile featured-tile" data-cat="featured">
      <img src="${sample.image || ''}" alt="">
      <div class="tile-label">⭐ Meilleures ventes<span class="tile-count">${featuredCount} article${featuredCount > 1 ? 's' : ''}</span></div>
    </div>`;
  }
  categories.forEach(cat => {
    const items = visibleProducts.filter(p => p.categoryId === cat.id);
    if (items.length === 0) return;
    const sample = items[0];
    html += `
    <div class="home-tile" data-cat="${cat.id}">
      <img src="${sample.image || ''}" alt="">
      <div class="tile-label">${escapeHtml(cat.name)}<span class="tile-count">${items.length} article${items.length > 1 ? 's' : ''}</span></div>
    </div>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.home-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      activeCategory = tile.dataset.cat;
      renderCategoryStrip();
      renderGrid();
      closeDrawer('catalogueDrawer');
    });
  });
}

/* =========================================================
   RENDU — Grille produits
   ========================================================= */
function getFilteredProducts() {
  let list = products.filter(p => !p.hidden);
  if (activeCategory === 'featured') {
    list = list.filter(p => p.featured);
  } else if (activeCategory !== 'all') {
    list = list.filter(p => p.categoryId === activeCategory);
  }
  if (searchTerm.trim()) {
    const q = searchTerm.trim().toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q));
  }
  return list;
}

function renderGrid() {
  const container = document.getElementById('gridContainer');
  const empty = document.getElementById('emptyState');
  const list = getFilteredProducts();
  const visibleProducts = products.filter(p => !p.hidden);

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  let html = '';
  if (activeCategory === 'all' && !searchTerm.trim()) {
    const featured = visibleProducts.filter(p => p.featured);
    if (featured.length) {
      html += `<div class="section-title featured-title">⭐ Meilleures ventes</div><div class="grid">`;
      featured.forEach(p => html += productCardHtml(p));
      html += `</div>`;
    }
    categories.forEach(cat => {
      const items = visibleProducts.filter(p => p.categoryId === cat.id);
      if (items.length === 0) return;
      html += `<div class="section-title">${escapeHtml(cat.name)}</div><div class="grid">`;
      items.forEach(p => html += productCardHtml(p));
      html += `</div>`;
    });
    const orphan = visibleProducts.filter(p => !categories.some(c => c.id === p.categoryId));
    if (orphan.length) {
      html += `<div class="section-title">Autres</div><div class="grid">`;
      orphan.forEach(p => html += productCardHtml(p));
      html += `</div>`;
    }
  } else if (activeCategory === 'featured') {
    html += `<div class="grid">`;
    visibleProducts.filter(p => p.featured).forEach(p => html += productCardHtml(p));
    html += `</div>`;
  } else {
    html += `<div class="grid">`;
    list.forEach(p => html += productCardHtml(p));
    html += `</div>`;
  }

  container.innerHTML = html;
  attachCardListeners();
}

function productCardHtml(p) {
  const qty = cart[p.id] || 0; // en unités réelles
  const lots = p.unitStep > 1 ? Math.round(qty / p.unitStep) : qty;
  const img = p.image || '';
  const unitTag = p.unitStep > 1 ? `<span class="t-unit">📦 Lot de ${p.unitStep}</span>` : '';
  const bulkEligible = getBulkEligibleCategories();
  const effectivePrice = getEffectivePrice(p, bulkEligible);
  const isBulk = effectivePrice !== p.price;
  const priceDisplay = isBulk
    ? `<span class="price bulk">${fmtPrice(effectivePrice).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(effectivePrice).split(',')[1]}</span></span>`
    : `<span class="price">${fmtPrice(p.price).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(p.price).split(',')[1]}</span></span>`;

  if (p.outOfStock) {
    return `
    <div class="ticket out-of-stock" data-id="${p.id}">
      <div class="ticket-main">
        <div class="ticket-img-wrap">
          <img src="${img}" alt="${escapeHtml(p.name)}" loading="lazy">
          <span class="stamp">RÉF<br>${escapeHtml(p.ref)}</span>
          <div class="stock-banner">Rupture de stock</div>
        </div>
        <div class="ticket-body">
          <div class="t-name">${escapeHtml(p.name)}</div>
          <div class="t-ref">Réf. ${escapeHtml(p.ref)}</div>
          ${unitTag}
        </div>
      </div>
      <div class="perf-seam"></div>
      <div class="ticket-stub">
        ${priceDisplay}
        <span class="stock-label">Indisponible</span>
      </div>
    </div>`;
  }

  return `
  <div class="ticket" data-id="${p.id}">
    <div class="ticket-main">
      <div class="ticket-img-wrap">
        <img src="${img}" alt="${escapeHtml(p.name)}" loading="lazy">
        <span class="stamp">RÉF<br>${escapeHtml(p.ref)}</span>
      </div>
      <div class="ticket-body">
        <div class="t-name">${escapeHtml(p.name)}</div>
        <div class="t-ref">Réf. ${escapeHtml(p.ref)}</div>
        ${unitTag}
      </div>
    </div>
    <div class="perf-seam"></div>
    <div class="ticket-stub">
      ${priceDisplay}
      ${lots > 0 ? `
        <div class="qty-control">
          <button class="qty-minus" data-id="${p.id}">−</button>
          <span>${lots}</span>
          <button class="qty-plus" data-id="${p.id}">+</button>
        </div>
      ` : `
        <button class="add-btn" data-id="${p.id}">+</button>
      `}
    </div>
  </div>`;
}

function attachCardListeners() {
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1));
  });
  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1));
  });
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, -1));
  });
}

/* =========================================================
   PANIER (les deltas sont en "lots", convertis en unités réelles)
   ========================================================= */
function addToCart(id, deltaLots) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  if (p.outOfStock && deltaLots > 0) {
    showToast('Ce produit est en rupture de stock');
    return;
  }
  const step = p.unitStep || 1;
  const currentQty = cart[id] || 0;
  const newQty = currentQty + deltaLots * step;
  if (newQty <= 0) {
    delete cart[id];
  } else {
    cart[id] = newQty;
  }
  updateCartUI();
  renderGrid();
}

/* Calcule, pour chaque "groupe de prix de gros" (qui peut regrouper
   plusieurs catégories, ex. T-shirts Enfant + Adulte), si le seuil est
   atteint en additionnant les quantités de TOUTES les catégories du
   groupe présentes dans le panier. Retourne une Map categoryId -> bool
   (le résultat est répliqué sur chaque catégorie membre du groupe). */
function getBulkEligibleCategories() {
  const categoryQty = {};
  Object.entries(cart).forEach(([id, qty]) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    categoryQty[p.categoryId] = (categoryQty[p.categoryId] || 0) + qty;
  });

  // Regrouper les catégories par bulkGroupId (catégories sans groupe = groupe solo)
  const groups = {}; // groupKey -> { threshold, price, categoryIds: [] }
  categories.forEach(c => {
    if (!c.bulkThresholdQty || c.bulkPrice == null) return;
    const groupKey = c.bulkGroupId || ('solo:' + c.id);
    if (!groups[groupKey]) {
      groups[groupKey] = { threshold: c.bulkThresholdQty, price: c.bulkPrice, categoryIds: [] };
    }
    groups[groupKey].categoryIds.push(c.id);
  });

  const eligible = {};
  Object.values(groups).forEach(g => {
    const totalQty = g.categoryIds.reduce((sum, cid) => sum + (categoryQty[cid] || 0), 0);
    const isEligible = totalQty >= g.threshold;
    g.categoryIds.forEach(cid => { eligible[cid] = isEligible; });
  });
  return eligible;
}

/* Prix unitaire effectif d'un produit, en tenant compte d'un éventuel
   prix de gros déclenché par la catégorie. */
function getEffectivePrice(product, bulkEligible) {
  const cat = categories.find(c => c.id === product.categoryId);
  if (cat && cat.bulkThresholdQty && cat.bulkPrice != null) {
    const isEligible = bulkEligible ? bulkEligible[cat.id] : getBulkEligibleCategories()[cat.id];
    if (isEligible) return cat.bulkPrice;
  }
  return product.price;
}

function cartTotal() {
  let total = 0, count = 0;
  const bulkEligible = getBulkEligibleCategories();
  Object.entries(cart).forEach(([id, qty]) => {
    const p = products.find(x => x.id === id);
    if (p) {
      const price = getEffectivePrice(p, bulkEligible);
      total += price * qty; count += qty;
    }
  });
  return { total, count, bulkEligible };
}

function updateCartUI() {
  const { total, count } = cartTotal();
  const badge = document.getElementById('cartBadge');
  const fab = document.getElementById('cartFab');
  if (count > 0) {
    badge.style.display = 'flex';
    badge.textContent = count;
    fab.classList.add('show');
  } else {
    badge.style.display = 'none';
    fab.classList.remove('show');
  }
  document.getElementById('cartFabCount').textContent = count + (count === 1 ? ' article' : ' articles');
  document.getElementById('cartFabTotal').textContent = fmtPrice(total);
  renderCartDrawer();
}

function renderCartDrawer() {
  const body = document.getElementById('cartBody');
  const footer = document.getElementById('cartFooter');
  const ids = Object.keys(cart);

  if (ids.length === 0) {
    body.innerHTML = `<div class="empty-state"><span class="glyph">🧺</span><h3>Votre panier est vide</h3><p>Ajoutez des souvenirs depuis le catalogue.</p></div>`;
    footer.style.display = 'none';
    return;
  }
  footer.style.display = 'block';

  const { bulkEligible } = cartTotal();

  // Regroupe les avertissements de prix de gros par groupe (catégories combinées)
  const bulkGroups = {};
  categories.forEach(c => {
    if (!c.bulkThresholdQty || c.bulkPrice == null) return;
    const groupKey = c.bulkGroupId || ('solo:' + c.id);
    if (!bulkGroups[groupKey]) {
      bulkGroups[groupKey] = { threshold: c.bulkThresholdQty, price: c.bulkPrice, names: [], categoryIds: [] };
    }
    bulkGroups[groupKey].names.push(c.name);
    bulkGroups[groupKey].categoryIds.push(c.id);
  });

  const bulkNotices = [];
  Object.values(bulkGroups).forEach(g => {
    const qtyInGroup = Object.entries(cart).reduce((sum, [id, qty]) => {
      const p = products.find(x => x.id === id);
      return p && g.categoryIds.includes(p.categoryId) ? sum + qty : sum;
    }, 0);
    if (qtyInGroup === 0) return;
    const label = g.names.join(' + ');
    if (qtyInGroup >= g.threshold) {
      bulkNotices.push(`<div class="bulk-notice active">🎉 Tarif de gros activé pour « ${escapeHtml(label)} » : ${fmtPrice(g.price)} / article (${qtyInGroup} articles)</div>`);
    } else {
      const remaining = g.threshold - qtyInGroup;
      bulkNotices.push(`<div class="bulk-notice">Ajoutez encore ${remaining} article(s) « ${escapeHtml(label)} » pour débloquer le tarif de gros à ${fmtPrice(g.price)}/article</div>`);
    }
  });

  let html = bulkNotices.join('');
  ids.forEach(id => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const qty = cart[id];
    const step = p.unitStep || 1;
    const lots = step > 1 ? Math.round(qty / step) : qty;
    const lotLabel = step > 1 ? `${lots} lot${lots > 1 ? 's' : ''} de ${step} (${qty} unités)` : `${qty}`;
    const effectivePrice = getEffectivePrice(p, bulkEligible);
    const isBulk = effectivePrice !== p.price;
    html += `
    <div class="cart-line" data-id="${id}">
      <img src="${p.image || ''}" alt="">
      <div class="cart-line-info">
        <div class="nm">${escapeHtml(p.name)}</div>
        <div class="rf">Réf. ${escapeHtml(p.ref)} ${step > 1 ? '· ' + lotLabel : ''}</div>
        <div class="cart-line-bottom">
          <div class="qty-control">
            <button class="cl-minus" data-id="${id}">−</button>
            <span>${lots}</span>
            <button class="cl-plus" data-id="${id}">+</button>
          </div>
          <span class="cart-line-price">${isBulk ? `<span class="old-price">${fmtPrice(p.price * qty)}</span> ` : ''}${fmtPrice(effectivePrice * qty)}</span>
        </div>
      </div>
    </div>`;
  });
  body.innerHTML = html;

  body.querySelectorAll('.cl-plus').forEach(b => b.addEventListener('click', () => addToCart(b.dataset.id, 1)));
  body.querySelectorAll('.cl-minus').forEach(b => b.addEventListener('click', () => addToCart(b.dataset.id, -1)));

  const { total, count } = cartTotal();
  document.getElementById('sumCount').textContent = count;
  document.getElementById('sumTotal').textContent = fmtPrice(total);
}

/* =========================================================
   RECHERCHE
   ========================================================= */
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  input.addEventListener('input', () => {
    searchTerm = input.value;
    clearBtn.style.display = searchTerm ? 'block' : 'none';
    renderGrid();
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchTerm = '';
    clearBtn.style.display = 'none';
    renderGrid();
    input.focus();
  });
}

/* =========================================================
   COMMANDE — création + stockage dans Supabase
   ========================================================= */
function setupCheckout() {
  document.getElementById('checkoutBtn').addEventListener('click', () => {
    if (Object.keys(cart).length === 0) return;
    closeDrawer('cartDrawer');
    setTimeout(() => { openDrawer('checkoutDrawer'); renderInvoiceSummary(); }, 200);
  });

  document.getElementById('confirmOrderBtn').addEventListener('click', async () => {
    const name = document.getElementById('clientNameInput').value.trim();
    const shopName = document.getElementById('clientShopInput').value.trim();
    if (!name) {
      showToast('Merci d\'indiquer votre nom');
      return;
    }
    await submitOrder(name, shopName);
  });

  document.getElementById('clearCartBtn').addEventListener('click', () => {
    if (Object.keys(cart).length === 0) return;
    if (!confirm('Vider le panier ?')) return;
    cart = {};
    updateCartUI();
    renderGrid();
  });
}

function renderInvoiceSummary() {
  const { total, count } = cartTotal();
  const tva = total * TVA_RATE;
  const totalWithTva = total + tva;
  const box = document.getElementById('checkoutInvoiceSummary');
  box.innerHTML = `
    <div class="ln"><span>Sous-total (${count} article${count > 1 ? 's' : ''})</span><span>${fmtPrice(total)}</span></div>
    <div class="ln"><span>TVA (20%)</span><span>${fmtPrice(tva)}</span></div>
    <div class="ln total"><span>Total à payer</span><span>${fmtPrice(totalWithTva)}</span></div>
  `;
}

function sendOrderNotificationEmail(orderNumber, clientName, shopName, items, totalWithTva) {
  if (typeof emailjs === 'undefined') return;
  if (!EMAILJS_SERVICE_ID || EMAILJS_SERVICE_ID.startsWith('REMPLACER')) return;

  const itemsText = items.map(it => `${it.ref} x${it.qty} — ${it.name}`).join('\n');
  const params = {
    to_email: EMAILJS_NOTIFY_EMAIL,
    order_number: orderNumber,
    client_name: clientName,
    shop_name: shopName || '—',
    items_list: itemsText,
    total: fmtPrice(totalWithTva)
  };
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, params).catch(e => {
    console.warn('Envoi e-mail échoué', e);
  });
}

async function submitOrder(clientName, shopName) {
  const { total, count, bulkEligible } = cartTotal();
  const tva = total * TVA_RATE;
  const totalWithTva = total + tva;
  const items = Object.keys(cart).map(id => {
    const p = products.find(x => x.id === id);
    const qty = cart[id];
    const price = getEffectivePrice(p, bulkEligible);
    return { ref: p.ref, name: p.name, qty, price: price, lineTotal: +(price * qty).toFixed(2) };
  });

  const btn = document.getElementById('confirmOrderBtn');
  btn.style.opacity = '0.6';

  try {
    // numéro de commande séquentiel atomique
    const orderNumber = String(settings.next_order_number || 1);

    const { error: insertError } = await supabaseClient.from('orders').insert({
      order_number: orderNumber,
      client_name: clientName,
      shop_name: shopName || null,
      items: items,
      total: total,
      tva: +tva.toFixed(2),
      total_with_tva: +totalWithTva.toFixed(2),
      status: 'nouvelle'
    });
    if (insertError) throw insertError;

    const { error: updateError } = await supabaseClient
      .from('settings')
      .update({ next_order_number: (settings.next_order_number || 1) + 1 })
      .eq('id', 1);
    if (updateError) throw updateError;
    settings.next_order_number = (settings.next_order_number || 1) + 1;

    sendOrderNotificationEmail(orderNumber, clientName, shopName, items, totalWithTva);

    document.getElementById('successOrderNum').textContent = `Commande n°${orderNumber}`;
    cart = {};
    updateCartUI();
    renderGrid();
    document.getElementById('clientNameInput').value = '';
    document.getElementById('clientShopInput').value = '';
    closeDrawer('checkoutDrawer');
    setTimeout(() => openDrawer('orderSuccessDrawer'), 200);
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de l\'envoi de la commande');
  } finally {
    btn.style.opacity = '1';
  }
}

/* =========================================================
   ADMIN — PIN
   ========================================================= */
function setupAdminLock() {
  const inputs = Array.from(document.querySelectorAll('.pin-input input'));
  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 1);
      if (inp.value && idx < inputs.length - 1) inputs[idx + 1].focus();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) inputs[idx - 1].focus();
    });
  });
  document.getElementById('pinSubmit').addEventListener('click', () => {
    const code = inputs.map(i => i.value).join('');
    if (code.length < 4) {
      document.getElementById('pinError').textContent = 'Entrez les 4 chiffres.';
      return;
    }
    if (code === (settings.admin_pin || '1234')) {
      adminUnlocked = true;
      document.getElementById('pinError').textContent = '';
      inputs.forEach(i => i.value = '');
      document.getElementById('adminLockScreen').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      renderAdminProductList();
      renderAdminCatList();
      renderAdminOrderList();
      prefillSettings();
    } else {
      document.getElementById('pinError').textContent = 'Code incorrect, réessayez.';
      inputs.forEach(i => i.value = '');
      inputs[0].focus();
    }
  });
}

function setupAdminTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['orders', 'products', 'categories', 'settings'].forEach(t => {
        document.getElementById('tab' + capitalize(t)).style.display = (t === btn.dataset.tab) ? 'block' : 'none';
      });
    });
  });
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* =========================================================
   ADMIN — Commandes
   ========================================================= */
async function renderAdminOrderList() {
  const list = document.getElementById('adminOrderList');
  list.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const { data, error } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    if (!data || data.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="glyph">🎫</span><h3>Aucune commande</h3><p>Les commandes des clients apparaîtront ici.</p></div>`;
      return;
    }
    let html = '';
    data.forEach(o => {
      const date = new Date(o.created_at);
      const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const itemsLines = (o.items || []).map(it => `<strong>${escapeHtml(it.ref)}</strong> x${it.qty} — ${escapeHtml(it.name)}`).join('<br>');
      const clientLine = o.shop_name
        ? `${escapeHtml(o.client_name || 'Client')} <span style="opacity:0.6;font-weight:500;">— ${escapeHtml(o.shop_name)}</span>`
        : escapeHtml(o.client_name || 'Client');
      const totalWithTva = o.total_with_tva != null ? Number(o.total_with_tva) : Number(o.total);
      const tvaLine = o.tva != null
        ? `<div style="font-size:11px;color:#7a6f5c;margin-top:4px;">Sous-total ${fmtPrice(Number(o.total))} + TVA 20% (${fmtPrice(Number(o.tva))})</div>`
        : '';
      html += `
      <div class="order-card" data-order-id="${o.id}">
        <div class="oc-top">
          <span class="oc-num">Commande n°${escapeHtml(o.order_number)}</span>
          <span class="oc-date">${dateStr}</span>
        </div>
        <div class="oc-client">${clientLine}</div>
        <div class="oc-items">${itemsLines}</div>
        ${tvaLine}
        <div class="oc-bottom">
          <span class="oc-total">${fmtPrice(totalWithTva)}</span>
          <select class="status-select" data-order-id="${o.id}">
            <option value="nouvelle" ${o.status === 'nouvelle' ? 'selected' : ''}>Nouvelle</option>
            <option value="en_cours" ${o.status === 'en_cours' ? 'selected' : ''}>En cours</option>
            <option value="terminee" ${o.status === 'terminee' ? 'selected' : ''}>Terminée</option>
          </select>
        </div>
        <button class="delete-order-btn" data-delorder="${o.id}">🗑 Supprimer cette commande</button>
      </div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        const { error } = await supabaseClient.from('orders').update({ status: sel.value }).eq('id', sel.dataset.orderId);
        if (error) showToast('Erreur de mise à jour');
        else showToast('Statut mis à jour');
      });
    });
    list.querySelectorAll('[data-delorder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement cette commande ?')) return;
        const { error } = await supabaseClient.from('orders').delete().eq('id', btn.dataset.delorder);
        if (error) { showToast('⚠️ Erreur lors de la suppression'); return; }
        showToast('Commande supprimée');
        renderAdminOrderList();
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">⚠️</span><h3>Erreur</h3><p>${escapeHtml(e.message || '')}</p></div>`;
  }
}

/* =========================================================
   ADMIN — Produits
   ========================================================= */
let adminProductSearchTerm = '';

function renderAdminProductList() {
  const list = document.getElementById('adminProductList');
  let displayProducts = products;
  if (adminProductSearchTerm.trim()) {
    const q = adminProductSearchTerm.trim().toLowerCase();
    displayProducts = products.filter(p => p.ref.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }
  if (displayProducts.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">📦</span><h3>${adminProductSearchTerm ? 'Aucun résultat' : 'Aucun produit'}</h3><p>${adminProductSearchTerm ? 'Essayez une autre référence.' : 'Ajoutez votre premier produit.'}</p></div>`;
    return;
  }
  let html = '';
  displayProducts.forEach(p => {
    const cat = categories.find(c => c.id === p.categoryId);
    const unitInfo = p.unitStep > 1 ? ` · lot de ${p.unitStep}` : '';
    const badges = `${p.outOfStock ? ' <span style="color:var(--brick);font-weight:700;">· Rupture</span>' : ''}${p.featured ? ' <span style="color:var(--mustard);font-weight:700;">· ⭐</span>' : ''}${p.hidden ? ' <span style="color:var(--brass);font-weight:700;">· Masqué</span>' : ''}`;
    html += `
    <div class="admin-product-row-wrap">
      <div class="admin-product-row${p.hidden ? ' hidden-product-row' : ''}">
        <img src="${p.image || ''}" alt="">
        <div class="info">
          <div class="nm">${escapeHtml(p.name)}</div>
          <div class="meta">Réf. ${escapeHtml(p.ref)} · ${fmtPrice(p.price)} · ${cat ? escapeHtml(cat.name) : '—'}${unitInfo}${badges}</div>
        </div>
        <div class="admin-row-actions">
          <button class="admin-icon-btn ${p.hidden ? 'active-hide' : ''}" data-hide="${p.id}" title="${p.hidden ? 'Réafficher ce produit' : 'Masquer ce produit'}">${p.hidden ? '👁️‍🗨️' : '👁️'}</button>
          <button class="admin-icon-btn" data-quickphoto="${p.id}" title="Changer la photo rapidement">📷</button>
          <button class="admin-icon-btn" data-lotmenu="${p.id}" title="Définir un lot">📦</button>
          <button class="admin-icon-btn" data-edit="${p.id}">✎</button>
          <button class="admin-icon-btn danger" data-del="${p.id}">🗑</button>
        </div>
      </div>
      <input type="file" accept="image/*" class="quickphoto-input" data-quickphoto-input="${p.id}" style="display:none;">
      <div class="lot-quickpicker" id="lotpicker-${p.id}" style="display:none;">
        <span class="lqp-label">Vente par lot de :</span>
        <button class="lqp-btn ${p.unitStep === 6 ? 'active' : ''}" data-quicklot="${p.id}" data-qty="6">6</button>
        <button class="lqp-btn ${p.unitStep === 10 ? 'active' : ''}" data-quicklot="${p.id}" data-qty="10">10</button>
        <button class="lqp-btn ${p.unitStep === 12 ? 'active' : ''}" data-quicklot="${p.id}" data-qty="12">12</button>
        <button class="lqp-btn unit ${p.unitStep === 1 ? 'active' : ''}" data-quicklot="${p.id}" data-qty="1">À l'unité</button>
      </div>
    </div>`;
  });
  list.innerHTML = html;
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openProductForm(b.dataset.edit)));
  list.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => toggleHideProduct(b.dataset.hide)));
  list.querySelectorAll('[data-quickphoto]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.quickphoto;
    const fileInput = list.querySelector(`[data-quickphoto-input="${id}"]`);
    if (fileInput) fileInput.click();
  }));
  list.querySelectorAll('[data-quickphoto-input]').forEach(input => input.addEventListener('change', (e) => {
    const id = input.dataset.quickphotoInput;
    const file = e.target.files[0];
    if (file) quickSetProductImage(id, file);
    input.value = '';
  }));
  list.querySelectorAll('[data-lotmenu]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.lotmenu;
    const picker = document.getElementById('lotpicker-' + id);
    const isOpen = picker.style.display !== 'none';
    list.querySelectorAll('.lot-quickpicker').forEach(p => p.style.display = 'none');
    picker.style.display = isOpen ? 'none' : 'flex';
  }));
  list.querySelectorAll('[data-quicklot]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.quicklot;
    const qty = parseInt(b.dataset.qty, 10);
    await quickSetUnitStep(id, qty);
  }));
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.del)));
}

/* Bascule l'état masqué/visible d'un produit. Un produit masqué reste
   en base de données (donc récupérable instantanément) mais disparaît
   complètement de la boutique publique (recherche, catégories, tiroir
   catalogue) tant qu'il n'est pas réaffiché depuis l'administration. */
async function toggleHideProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  const newHidden = !p.hidden;
  try {
    const { error } = await supabaseClient.from('products').update({ hidden: newHidden }).eq('id', id);
    if (error) throw error;
    p.hidden = newHidden;
    showToast(newHidden ? `✓ ${p.ref} masqué de la boutique` : `✓ ${p.ref} de nouveau visible`);
    renderAdminProductList();
    renderCategoryStrip();
    renderGrid();
    renderHomeTiles();
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de la mise à jour');
  }
}

/* Remplace rapidement la photo d'un produit depuis la liste admin,
   sans passer par le formulaire complet. Aucun traitement (pas de
   détourage) : la photo est juste redimensionnée puis enregistrée
   immédiatement. */
function quickSetProductImage(productId, file) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  if (file.size > 6 * 1024 * 1024) {
    showToast('Image trop lourde (max 6 Mo)');
    return;
  }
  showToast('⏳ Envoi de la photo…');

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const maxDim = 800;
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
      else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const newImageData = canvas.toDataURL('image/jpeg', 0.85);

      try {
        const { error } = await supabaseClient.from('products').update({ image: newImageData }).eq('id', productId);
        if (error) throw error;
        p.image = newImageData;
        showToast(`✓ Photo de ${p.ref} mise à jour`);
        renderAdminProductList();
        renderGrid();
        renderHomeTiles();
      } catch (e) {
        console.error(e);
        showToast('⚠️ Erreur lors de l\'enregistrement de la photo');
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function quickSetUnitStep(productId, qty) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const unitStep = qty;
  const unitLabel = qty > 1 ? `Lot de ${qty}` : '';
  try {
    const { error } = await supabaseClient.from('products').update({
      unit_step: unitStep, unit_label: unitLabel
    }).eq('id', productId);
    if (error) throw error;
    p.unitStep = unitStep;
    p.unitLabel = unitLabel;
    showToast(qty > 1 ? `✓ ${p.ref} vendu par lot de ${qty}` : `✓ ${p.ref} vendu à l'unité`);
    renderAdminProductList();
    renderGrid();
  } catch (e) {
    showToast('⚠️ Erreur lors de la mise à jour');
  }
}


async function deleteProduct(id) {
  if (!confirm('Supprimer ce produit définitivement ?')) return;
  try {
    const { error } = await supabaseClient.from('products').delete().eq('id', id);
    if (error) throw error;
    products = products.filter(p => p.id !== id);
    delete cart[id];
    renderAdminProductList();
    renderCategoryStrip();
    renderGrid();
    updateCartUI();
    showToast('Produit supprimé');
  } catch (e) {
    showToast('⚠️ Erreur lors de la suppression');
  }
}

/* =========================================================
   ADMIN — Catégories
   ========================================================= */
function renderAdminCatList() {
  const list = document.getElementById('adminCatList');
  if (categories.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">🏷️</span><h3>Aucune catégorie</h3></div>`;
    return;
  }
  let html = '';
  categories.forEach(c => {
    const count = products.filter(p => p.categoryId === c.id).length;
    const hasBulk = c.bulkThresholdQty && c.bulkPrice != null;
    html += `
    <div class="cat-manage-row">
      <input type="text" value="${escapeHtml(c.name)}" data-cat-id="${c.id}">
      <span style="font-size:11px;color:var(--brass);flex-shrink:0;">${count} art.</span>
      <button class="admin-icon-btn danger" data-delcat="${c.id}">🗑</button>
    </div>
    <div class="bulk-pricing-box">
      <div class="bg-remove-toggle" style="margin:0;">
        <div class="lb">Tarif de gros par palier
          <small>Ex. dès 200 articles (toutes catégories liées), prix réduit</small>
        </div>
        <label class="switch">
          <input type="checkbox" class="bulk-toggle" data-cat-id="${c.id}" ${hasBulk ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>
      <div class="row bulk-fields" data-cat-id="${c.id}" style="display:${hasBulk ? 'flex' : 'none'};flex-wrap:wrap;">
        <div class="form-group">
          <label>Seuil (quantité)</label>
          <input type="number" class="bulk-threshold" data-cat-id="${c.id}" value="${c.bulkThresholdQty || ''}" placeholder="200">
        </div>
        <div class="form-group">
          <label>Prix de gros (€)</label>
          <input type="number" step="0.01" class="bulk-price" data-cat-id="${c.id}" value="${c.bulkPrice != null ? c.bulkPrice : ''}" placeholder="2.50">
        </div>
        <div class="form-group" style="flex-basis:100%;">
          <label>Groupe lié (optionnel)</label>
          <input type="text" class="bulk-group" data-cat-id="${c.id}" value="${escapeHtml(c.bulkGroupId || '')}" placeholder="ex. tshirts">
          <div class="form-hint">Donnez le même nom de groupe à plusieurs catégories (ex. "tshirts" pour Enfant et Adulte) pour que leurs quantités s'additionnent vers le même seuil.</div>
        </div>
      </div>
      <button class="btn-secondary save-bulk-btn" data-cat-id="${c.id}" style="margin-top:10px;padding:9px;font-size:13px;">Enregistrer le tarif de gros</button>
    </div>
    <div class="lot-bulk-box">
      <div class="lqp-label" style="margin-bottom:8px;">📦 Définir le lot pour tous les produits de cette catégorie (${count} article${count > 1 ? 's' : ''})</div>
      <div class="lot-bulk-buttons">
        <button class="lqp-btn" data-bulklot-cat="${c.id}" data-bulklot-qty="6">6</button>
        <button class="lqp-btn" data-bulklot-cat="${c.id}" data-bulklot-qty="10">10</button>
        <button class="lqp-btn" data-bulklot-cat="${c.id}" data-bulklot-qty="12">12</button>
        <button class="lqp-btn unit" data-bulklot-cat="${c.id}" data-bulklot-qty="1">À l'unité</button>
      </div>
    </div>`;
  });
  list.innerHTML = html;

  list.querySelectorAll('input[data-cat-id]:not(.bulk-toggle):not(.bulk-threshold):not(.bulk-price)').forEach(inp => {
    inp.addEventListener('change', async () => {
      const cat = categories.find(c => c.id === inp.dataset.catId);
      if (cat && inp.value.trim()) {
        cat.name = inp.value.trim();
        const { error } = await supabaseClient.from('categories').update({ name: cat.name }).eq('id', cat.id);
        if (error) { showToast('⚠️ Erreur'); return; }
        renderCategoryStrip();
        renderGrid();
        showToast('Catégorie mise à jour');
      }
    });
  });
  list.querySelectorAll('[data-delcat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delcat;
      const count = products.filter(p => p.categoryId === id).length;
      const msg = count > 0
        ? `Cette catégorie contient ${count} produit(s). Ils seront déplacés vers "Autres".`
        : 'Supprimer cette catégorie ?';
      if (!confirm(msg)) return;
      const { error } = await supabaseClient.from('categories').delete().eq('id', id);
      if (error) { showToast('⚠️ Erreur'); return; }
      categories = categories.filter(c => c.id !== id);
      renderAdminCatList();
      renderCategoryStrip();
      renderGrid();
      showToast('Catégorie supprimée');
    });
  });
  list.querySelectorAll('.bulk-toggle').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const fieldsRow = list.querySelector(`.bulk-fields[data-cat-id="${toggle.dataset.catId}"]`);
      fieldsRow.style.display = toggle.checked ? 'flex' : 'none';
    });
  });
  list.querySelectorAll('.save-bulk-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.catId;
      const cat = categories.find(c => c.id === catId);
      const toggle = list.querySelector(`.bulk-toggle[data-cat-id="${catId}"]`);
      let bulk_threshold_qty = null, bulk_price = null, bulk_group_id = null;
      if (toggle.checked) {
        const thresholdInp = list.querySelector(`.bulk-threshold[data-cat-id="${catId}"]`);
        const priceInp = list.querySelector(`.bulk-price[data-cat-id="${catId}"]`);
        const groupInp = list.querySelector(`.bulk-group[data-cat-id="${catId}"]`);
        bulk_threshold_qty = parseInt(thresholdInp.value, 10);
        bulk_price = parseFloat(priceInp.value);
        bulk_group_id = groupInp.value.trim() || null;
        if (!bulk_threshold_qty || bulk_threshold_qty < 1 || isNaN(bulk_price) || bulk_price < 0) {
          showToast('Indiquez un seuil et un prix valides');
          return;
        }
      }
      try {
        const { error } = await supabaseClient.from('categories').update({
          bulk_threshold_qty, bulk_price, bulk_group_id
        }).eq('id', catId);
        if (error) throw error;
        cat.bulkThresholdQty = bulk_threshold_qty;
        cat.bulkPrice = bulk_price;
        cat.bulkGroupId = bulk_group_id;
        renderGrid();
        showToast(toggle.checked ? 'Tarif de gros activé' : 'Tarif de gros désactivé');
      } catch (e) {
        showToast('⚠️ Erreur lors de l\'enregistrement');
      }
    });
  });
  list.querySelectorAll('[data-bulklot-cat]').forEach(btn => {
    btn.addEventListener('click', () => bulkSetUnitStepForCategory(btn.dataset.bulklotCat, parseInt(btn.dataset.bulklotQty, 10)));
  });
}

async function bulkSetUnitStepForCategory(categoryId, qty) {
  const cat = categories.find(c => c.id === categoryId);
  const catProducts = products.filter(p => p.categoryId === categoryId);
  if (catProducts.length === 0) {
    showToast('Aucun produit dans cette catégorie');
    return;
  }
  const label = qty > 1 ? `lot de ${qty}` : 'la vente à l\'unité';
  if (!confirm(`Appliquer "${label}" aux ${catProducts.length} produit(s) de « ${cat.name} » ?`)) return;

  const unitLabel = qty > 1 ? `Lot de ${qty}` : '';
  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ unit_step: qty, unit_label: unitLabel })
      .eq('category_id', categoryId);
    if (error) throw error;
    catProducts.forEach(p => { p.unitStep = qty; p.unitLabel = unitLabel; });
    showToast(`✓ ${catProducts.length} produit(s) mis à jour`);
    renderAdminProductList();
    renderGrid();
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de la mise à jour groupée');
  }
}

function setupAddCategory() {
  document.getElementById('addCatBtn').addEventListener('click', async () => {
    const input = document.getElementById('newCatInput');
    const name = input.value.trim();
    if (!name) return;
    const newCat = { id: uid('cat'), name, sort_order: categories.length + 1 };
    const { error } = await supabaseClient.from('categories').insert(newCat);
    if (error) { showToast('⚠️ Erreur'); return; }
    categories.push({ id: newCat.id, name: newCat.name });
    input.value = '';
    renderAdminCatList();
    renderCategoryStrip();
    showToast('Catégorie ajoutée');
  });
}

/* =========================================================
   ADMIN — Réglages
   ========================================================= */
function prefillSettings() {
  document.getElementById('settingWhatsapp').value = settings.whatsapp || '';
  document.getElementById('settingEmail').value = settings.email || '';
  document.getElementById('settingShopName').value = settings.shop_name || '';
}
function setupSettingsSave() {
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const shop_name = document.getElementById('settingShopName').value.trim() || 'Souvenirs de Paris';
    const whatsapp = document.getElementById('settingWhatsapp').value.trim();
    const email = document.getElementById('settingEmail').value.trim();
    const { error } = await supabaseClient.from('settings').update({ shop_name, whatsapp, email }).eq('id', 1);
    if (error) { showToast('⚠️ Erreur'); return; }
    settings.shop_name = shop_name; settings.whatsapp = whatsapp; settings.email = email;
    document.getElementById('shopNameDisplay').textContent = shop_name;
    showToast('Réglages enregistrés');
  });
  document.getElementById('savePinBtn').addEventListener('click', async () => {
    const val = document.getElementById('newPinInput').value.trim();
    if (!/^\d{4}$/.test(val)) {
      showToast('Le code doit comporter 4 chiffres');
      return;
    }
    const { error } = await supabaseClient.from('settings').update({ admin_pin: val }).eq('id', 1);
    if (error) { showToast('⚠️ Erreur'); return; }
    settings.admin_pin = val;
    document.getElementById('newPinInput').value = '';
    showToast('Code admin mis à jour');
  });
}

/* =========================================================
   ADMIN — Formulaire produit + détourage local
   ========================================================= */
function populateCategorySelect() {
  const sel = document.getElementById('formCategory');
  sel.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function setupUnitToggle() {
  const unitBtn = document.getElementById('unitToggleUnit');
  const bulkBtn = document.getElementById('unitToggleBulk');
  const bulkWrap = document.getElementById('bulkSizeWrap');
  unitBtn.addEventListener('click', () => {
    currentUnitMode = 'unit';
    unitBtn.classList.add('active'); bulkBtn.classList.remove('active');
    bulkWrap.style.display = 'none';
  });
  bulkBtn.addEventListener('click', () => {
    currentUnitMode = 'bulk';
    bulkBtn.classList.add('active'); unitBtn.classList.remove('active');
    bulkWrap.style.display = 'block';
  });
}

function openProductForm(productId) {
  editingProductId = productId || null;
  populateCategorySelect();
  pendingImageData = null;

  const title = document.getElementById('productFormTitle');
  const imgPreview = document.getElementById('imagePreview');
  const imgPlaceholder = document.getElementById('imagePlaceholder');
  const delBtn = document.getElementById('deleteProductBtn');
  const cropBtn = document.getElementById('openCropBtn');

  if (editingProductId) {
    const p = products.find(x => x.id === editingProductId);
    title.textContent = 'Modifier le produit';
    document.getElementById('formName').value = p.name;
    document.getElementById('formRef').value = p.ref;
    document.getElementById('formPrice').value = p.price;
    document.getElementById('formCategory').value = p.categoryId;
    document.getElementById('outOfStockToggle').checked = !!p.outOfStock;
    document.getElementById('featuredToggle').checked = !!p.featured;
    imgPreview.src = p.image || '';
    imgPreview.style.display = 'block';
    imgPlaceholder.style.display = 'none';
    pendingImageData = p.image;
    delBtn.style.display = 'block';
    cropBtn.style.display = p.image ? 'block' : 'none';

    if (p.unitStep > 1) {
      currentUnitMode = 'bulk';
      document.getElementById('unitToggleBulk').classList.add('active');
      document.getElementById('unitToggleUnit').classList.remove('active');
      document.getElementById('bulkSizeWrap').style.display = 'block';
      document.getElementById('formUnitStep').value = p.unitStep;
    } else {
      currentUnitMode = 'unit';
      document.getElementById('unitToggleUnit').classList.add('active');
      document.getElementById('unitToggleBulk').classList.remove('active');
      document.getElementById('bulkSizeWrap').style.display = 'none';
      document.getElementById('formUnitStep').value = '';
    }
  } else {
    title.textContent = 'Nouveau produit';
    document.getElementById('formName').value = '';
    document.getElementById('formRef').value = '';
    document.getElementById('formPrice').value = '';
    if (categories.length) document.getElementById('formCategory').value = categories[0].id;
    document.getElementById('outOfStockToggle').checked = false;
    document.getElementById('featuredToggle').checked = false;
    imgPreview.style.display = 'none';
    imgPlaceholder.style.display = 'block';
    delBtn.style.display = 'none';
    cropBtn.style.display = 'none';
    currentUnitMode = 'unit';
    document.getElementById('unitToggleUnit').classList.add('active');
    document.getElementById('unitToggleBulk').classList.remove('active');
    document.getElementById('bulkSizeWrap').style.display = 'none';
    document.getElementById('formUnitStep').value = '';
  }
  openDrawer('productFormDrawer');
}

function setupImageUpload() {
  const fileInput = document.getElementById('imageFileInput');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      showToast('Image trop lourde (max 6 Mo)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 800;
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
        else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        pendingImageData = canvas.toDataURL('image/jpeg', 0.85);
        document.getElementById('imagePreview').src = pendingImageData;
        document.getElementById('imagePreview').style.display = 'block';
        document.getElementById('imagePlaceholder').style.display = 'none';
        document.getElementById('openCropBtn').style.display = 'block';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- Recadrage / ajustement manuel de la photo ----------
   Permet de zoomer et déplacer l'image existante dans un cadre carré,
   puis d'exporter le résultat comme nouvelle image du produit. */
let cropImageObj = null;
let cropState = { scale: 1, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };

function setupImageCropper() {
  const canvas = document.getElementById('cropCanvas');
  const ctx = canvas.getContext('2d');
  const zoomSlider = document.getElementById('cropZoomSlider');

  function drawCrop() {
    if (!cropImageObj) return;
    const size = canvas.width; // carré
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    const iw = cropImageObj.naturalWidth, ih = cropImageObj.naturalHeight;
    const baseScale = Math.max(size / iw, size / ih); // couvre tout le cadre
    const scale = baseScale * cropState.scale;
    const drawW = iw * scale, drawH = ih * scale;
    const drawX = (size - drawW) / 2 + cropState.offsetX;
    const drawY = (size - drawH) / 2 + cropState.offsetY;
    ctx.drawImage(cropImageObj, drawX, drawY, drawW, drawH);
  }

  function clampOffsets() {
    if (!cropImageObj) return;
    const size = canvas.width;
    const iw = cropImageObj.naturalWidth, ih = cropImageObj.naturalHeight;
    const baseScale = Math.max(size / iw, size / ih);
    const scale = baseScale * cropState.scale;
    const drawW = iw * scale, drawH = ih * scale;
    const maxOffsetX = Math.max(0, (drawW - size) / 2);
    const maxOffsetY = Math.max(0, (drawH - size) / 2);
    cropState.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, cropState.offsetX));
    cropState.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, cropState.offsetY));
  }

  function pointerDown(x, y) {
    cropState.dragging = true;
    cropState.lastX = x;
    cropState.lastY = y;
  }
  function pointerMove(x, y) {
    if (!cropState.dragging) return;
    cropState.offsetX += (x - cropState.lastX);
    cropState.offsetY += (y - cropState.lastY);
    cropState.lastX = x;
    cropState.lastY = y;
    clampOffsets();
    drawCrop();
  }
  function pointerUp() { cropState.dragging = false; }

  canvas.addEventListener('mousedown', (e) => pointerDown(e.offsetX, e.offsetY));
  canvas.addEventListener('mousemove', (e) => pointerMove(e.offsetX, e.offsetY));
  window.addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches[0];
    pointerDown(t.clientX - r.left, t.clientY - r.top);
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches[0];
    pointerMove(t.clientX - r.left, t.clientY - r.top);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', pointerUp);

  zoomSlider.addEventListener('input', () => {
    cropState.scale = zoomSlider.value / 100;
    clampOffsets();
    drawCrop();
  });

  document.getElementById('openCropBtn').addEventListener('click', () => {
    if (!pendingImageData) return;
    cropImageObj = new Image();
    cropImageObj.onload = () => {
      cropState = { scale: 1, offsetX: 0, offsetY: 0, dragging: false, lastX: 0, lastY: 0 };
      zoomSlider.value = 100;
      drawCrop();
    };
    cropImageObj.src = pendingImageData;
    openDrawer('cropDrawer');
  });

  document.getElementById('cancelCropBtn').addEventListener('click', () => {
    closeDrawer('cropDrawer');
  });

  document.getElementById('applyCropBtn').addEventListener('click', () => {
    const outSize = 700;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize; outCanvas.height = outSize;
    const outCtx = outCanvas.getContext('2d');
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, outSize, outSize);

    const iw = cropImageObj.naturalWidth, ih = cropImageObj.naturalHeight;
    const baseScale = Math.max(outSize / iw, outSize / ih);
    const scale = baseScale * cropState.scale;
    const ratio = outSize / canvas.width;
    const drawW = iw * scale, drawH = ih * scale;
    const drawX = (outSize - drawW) / 2 + cropState.offsetX * ratio;
    const drawY = (outSize - drawH) / 2 + cropState.offsetY * ratio;
    outCtx.drawImage(cropImageObj, drawX, drawY, drawW, drawH);

    pendingImageData = outCanvas.toDataURL('image/jpeg', 0.88);
    document.getElementById('imagePreview').src = pendingImageData;
    document.getElementById('imagePreview').style.display = 'block';
    document.getElementById('imagePlaceholder').style.display = 'none';
    closeDrawer('cropDrawer');
    showToast('✓ Photo recadrée');
  });
}

function setupProductFormSave() {
  document.getElementById('saveProductBtn').addEventListener('click', async () => {
    const name = document.getElementById('formName').value.trim();
    const ref = document.getElementById('formRef').value.trim();
    const price = parseFloat(document.getElementById('formPrice').value);
    const categoryId = document.getElementById('formCategory').value;
    const outOfStock = document.getElementById('outOfStockToggle').checked;
    const featured = document.getElementById('featuredToggle').checked;
    let unitStep = 1, unitLabel = '';
    if (currentUnitMode === 'bulk') {
      unitStep = parseInt(document.getElementById('formUnitStep').value, 10);
      if (!unitStep || unitStep < 2) {
        showToast('Indiquez une taille de lot valide (ex. 12)');
        return;
      }
      unitLabel = `Lot de ${unitStep}`;
    }

    if (!name || !ref || isNaN(price) || price < 0) {
      showToast('Merci de remplir tous les champs correctement');
      return;
    }
    if (!pendingImageData) {
      showToast('Ajoutez une photo du produit');
      return;
    }

    const btn = document.getElementById('saveProductBtn');
    btn.style.opacity = '0.6';

    try {
      if (editingProductId) {
        const { error } = await supabaseClient.from('products').update({
          name, ref, price, category_id: categoryId, image: pendingImageData,
          unit_step: unitStep, unit_label: unitLabel,
          out_of_stock: outOfStock, featured: featured
        }).eq('id', editingProductId);
        if (error) throw error;
        const p = products.find(x => x.id === editingProductId);
        p.name = name; p.ref = ref; p.price = price; p.categoryId = categoryId;
        p.image = pendingImageData; p.unitStep = unitStep; p.unitLabel = unitLabel;
        p.outOfStock = outOfStock; p.featured = featured;
        showToast('Produit mis à jour');
      } else {
        const newId = uid('prod');
        const { error } = await supabaseClient.from('products').insert({
          id: newId, ref, name, price, category_id: categoryId, image: pendingImageData,
          unit_step: unitStep, unit_label: unitLabel, sort_order: products.length + 1,
          out_of_stock: outOfStock, featured: featured
        });
        if (error) throw error;
        products.push({ id: newId, ref, name, price, categoryId, image: pendingImageData, unitStep, unitLabel, outOfStock, featured, hidden: false });
        showToast('Produit ajouté');
      }
      closeDrawer('productFormDrawer');
      renderAdminProductList();
      renderCategoryStrip();
      renderGrid();
    } catch (e) {
      console.error(e);
      showToast('⚠️ Erreur lors de l\'enregistrement');
    } finally {
      btn.style.opacity = '1';
    }
  });

  document.getElementById('deleteProductBtn').addEventListener('click', async () => {
    if (!editingProductId) return;
    if (!confirm('Supprimer ce produit définitivement ?')) return;
    try {
      const { error } = await supabaseClient.from('products').delete().eq('id', editingProductId);
      if (error) throw error;
      products = products.filter(p => p.id !== editingProductId);
      delete cart[editingProductId];
      closeDrawer('productFormDrawer');
      renderAdminProductList();
      renderCategoryStrip();
      renderGrid();
      updateCartUI();
      showToast('Produit supprimé');
    } catch (e) {
      showToast('⚠️ Erreur lors de la suppression');
    }
  });
}

/* =========================================================
   UI générale
   ========================================================= */
function setupGeneralUI() {
  document.getElementById('cartIconBtn').addEventListener('click', () => openDrawer('cartDrawer'));
  document.getElementById('cartFabBtn').addEventListener('click', () => openDrawer('cartDrawer'));
  document.getElementById('adminFabBtn').addEventListener('click', () => openDrawer('adminDrawer'));
  document.getElementById('newProductBtn').addEventListener('click', () => openProductForm(null));

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeDrawer(btn.dataset.close));
  });
  document.getElementById('overlay').addEventListener('click', closeAllDrawers);

  document.getElementById('adminLogoutBtn').addEventListener('click', () => {
    adminUnlocked = false;
    document.getElementById('adminLockScreen').style.display = 'flex';
    document.getElementById('adminPanel').style.display = 'none';
    closeDrawer('adminDrawer');
  });

  // rafraîchir la liste des commandes chaque fois qu'on rouvre l'onglet
  document.querySelector('[data-tab="orders"]').addEventListener('click', () => {
    if (adminUnlocked) renderAdminOrderList();
  });

  document.getElementById('adminProductSearch').addEventListener('input', (e) => {
    adminProductSearchTerm = e.target.value;
    renderAdminProductList();
  });
}

/* ---------- Init ---------- */
function init() {
  setupSearch();
  setupAdminLock();
  setupAdminTabs();
  setupAddCategory();
  setupSettingsSave();
  setupImageUpload();
  setupImageCropper();
  setupProductFormSave();
  setupUnitToggle();
  setupCheckout();
  setupGeneralUI();
  loadAllData();
}

document.addEventListener('DOMContentLoaded', init);
