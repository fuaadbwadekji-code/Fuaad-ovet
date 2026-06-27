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

/* Réglages d'apparence personnalisables depuis l'admin (onglet Réglages
   → Thème). Stockés en JSON dans settings.theme_settings et appliqués
   dynamiquement via des variables CSS sur :root. */
const DEFAULT_THEME = {
  glassOpacity: 50,       // 0-100 : opacité des panneaux en verre
  glassBlur: 28,          // 0-40px : intensité du flou
  cardOpacity: 62,        // 0-100 : opacité des cartes produit
  cardRadius: 16,         // 0-30px : arrondi des cartes
  cardShadow: 18,         // 0-40 : intensité de l'ombre des cartes (%)
  cardGap: 8,             // 2-24px : espace entre les cartes
  priceSize: 21,          // 14-30px : taille du prix sur les cartes
  nameSize: 13.5,         // 11-18px : taille du nom de produit
  fontHeading: "'Fraunces', serif",
  fontBody: "'Jost', sans-serif",
  chipRadius: 18,         // 0-30px : arrondi des chips de catégorie
  buttonRadius: 24,       // 0-34px : arrondi des boutons principaux
  addBtnSize: 34,         // 26-46px : taille du bouton rond "+"
  imagePadding: 14,       // 0-30px : marge intérieure des photos produit
  animSpeed: 100,         // 40-200% : multiplicateur de vitesse d'animation
  showPromoSection: true,
  showNewSection: true,
  promoLabel: '🔥 Promos',
  newLabel: '✨ Nouveauté',

  // ===== Transparence & flou (8 réglages supplémentaires) =====
  topbarOpacity: 92,      // 0-100 : opacité du bandeau du haut (logo + recherche)
  topbarBlur: 28,         // 0-40px : flou du bandeau du haut
  catStripOpacity: 38,    // 0-100 : opacité des chips de catégorie au repos
  drawerOpacity: 68,      // 0-100 : opacité des tiroirs (panier, admin...)
  drawerBlur: 28,         // 0-40px : flou des tiroirs
  cartFabOpacity: 55,     // 0-100 : opacité du bandeau panier flottant
  overlayOpacity: 55,     // 0-100 : opacité du voile sombre derrière un tiroir ouvert
  toastOpacity: 100,      // 0-100 : opacité des petits messages de confirmation

  // ===== 17 réglages additionnels =====
  shopNameSize: 21,        // 16-28px : taille du nom de la boutique dans l'en-tête
  logoSize: 38,            // 28-60px : taille du logo
  searchBarHeight: 45,     // 36-60px : hauteur de la barre de recherche
  searchFontSize: 14.5,    // 12-18px : taille du texte de recherche
  imageAspectRatio: 100,   // 80-130% : proportion des photos produit (100 = carré)
  lineHeight: 132,         // 110-160% : interligne du nom de produit
  refSize: 10,             // 8-14px : taille du texte "Réf. ..."
  headerShadow: 6,         // 0-20 : intensité de l'ombre sous l'en-tête (%)
  toastSpeed: 100,         // 40-200% : vitesse d'apparition des messages
  drawerCloseSize: 32,     // 26-44px : taille du bouton de fermeture des tiroirs
  catStripPadding: 14,     // 6-24px : hauteur de la bande de catégories
  chipGap: 9,              // 4-18px : espace entre les chips de catégorie
  cartIconSize: 48,        // 38-60px : taille de l'icône panier
  lotLabelSize: 11.5,      // 9-15px : taille du texte "Lot de X"
  imageRadius: 0,          // 0-20px : arrondi des photos produit elles-mêmes
  pressScale: 8,           // 0-20 : intensité de l'effet d'appui (% de réduction)
  bgImageOpacity: 100,      // 0-100 : opacité de la photo de fond (Paris ou personnalisée)
  bgOverlayOpacity: 55,     // 0-100 : opacité du voile crème posé sur la photo de fond
  emptyHint: 'Essayez une autre recherche ou catégorie.'
};
let theme = Object.assign({}, DEFAULT_THEME);
/* Copie du thème tel qu'enregistré en base, utilisée pour annuler un
   aperçu en direct non sauvegardé (bouton "Annuler / revenir à
   l'enregistré"). */
let savedTheme = Object.assign({}, DEFAULT_THEME);
let cart = {}; // { productId: qty }  (qty déjà en unités réelles, multiples de unit_step)

/* Persistance locale du panier : permet de retrouver le panier tel qu'il
   était si la page se recharge (perte de connexion, fermeture accidentelle
   de l'onglet, etc.). Le panier n'est jamais perdu tant que le client
   utilise le même navigateur sur le même appareil. */
const CART_STORAGE_KEY = 'souvenirs_paris_cart_v1';
function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (e) {
    console.warn('Impossible de sauvegarder le panier localement', e);
  }
}
function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') cart = parsed;
    }
  } catch (e) {
    console.warn('Impossible de charger le panier sauvegardé', e);
  }
}
let activeCategory = 'all';
let searchTerm = '';
let editingProductId = null;
let adminUnlocked = false;

/* Logo SVG par défaut (Tour Eiffel dessinée), utilisé tant qu'aucun
   logo personnalisé n'a été téléchargé, et pour le bouton "revenir au
   logo par défaut". */
const DEFAULT_LOGO_SVG = `<svg viewBox="0 0 100 130" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="64" r="46" fill="none" stroke="#D89A2C" stroke-width="2" opacity="0.55"/>
  <g fill="#1B2A45">
    <rect x="49.3" y="2" width="1.4" height="12"/>
    <path d="M47.5 14 L52.5 14 L51.3 24 L48.7 24 Z"/>
    <path d="M48.7 24 L51.3 24 L52.5 34 L47.5 34 Z"/>
    <path d="M48.2 26.5 L51.8 26.5 L50 30 Z" fill="#D89A2C" opacity="0.5"/>
    <rect x="46.5" y="34" width="7" height="1.6" fill="#D89A2C"/>
    <path d="M46.5 35.6 L53.5 35.6 L56.5 54 L43.5 54 Z"/>
    <path d="M45.5 39 L54.5 39 L48 46 Z" fill="#D89A2C" opacity="0.45"/>
    <path d="M54.5 39 L45.5 39 L52 46 Z" fill="#D89A2C" opacity="0.45"/>
    <path d="M44.7 47.5 L55.3 47.5 L50 53 Z" fill="#D89A2C" opacity="0.45"/>
    <rect x="41" y="54" width="18" height="2.2" fill="#D89A2C"/>
    <path d="M41.5 56.2 L58.5 56.2 L63 80 L37 80 Z"/>
    <path d="M40 62 L60 62 L52 70 L48 70 Z" fill="#D89A2C" opacity="0.4"/>
    <path d="M38.5 70 L61.5 70 L54 78 L46 78 Z" fill="#D89A2C" opacity="0.4"/>
    <rect x="35" y="80" width="30" height="2.4" fill="#D89A2C"/>
    <path d="M37 82.4 L43 82.4 L34 122 L25 122 Z"/>
    <path d="M63 82.4 L57 82.4 L66 122 L75 122 Z"/>
    <path d="M34 122 L25 122 L25 118 Q25 104 50 104 Q75 104 75 118 L75 122 L66 122 L66 119 Q66 110 50 110 Q34 110 34 119 Z"/>
    <rect x="20" y="122" width="60" height="2" fill="#D89A2C"/>
  </g>
</svg>`;
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

/* Un produit est visible dans la boutique publique seulement si :
   - il n'est pas masqué individuellement, ET
   - sa catégorie n'est pas masquée. */
function isProductVisible(p) {
  if (p.hidden) return false;
  const cat = categories.find(c => c.id === p.categoryId);
  if (cat && cat.hidden) return false;
  return true;
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
/* Récupère tous les produits depuis Supabase, par petits lots, pour
   éviter un timeout côté base de données (la table contient 900+ lignes,
   certaines avec des images encodées en base64 assez lourdes). Réutilisée
   au chargement initial et lors du rafraîchissement manuel de l'admin. */
async function fetchAllProductsFromDB() {
  let allProducts = [];
  let from = 0;
  let pageSize = 40;
  while (true) {
    let data, error;
    try {
      const res = await supabaseClient
        .from('products')
        .select('*')
        .range(from, from + pageSize - 1);
      data = res.data; error = res.error;
    } catch (e) {
      error = e;
    }
    if (error) {
      if (pageSize > 10) {
        pageSize = Math.max(10, Math.floor(pageSize / 2));
        continue;
      }
      throw error;
    }
    if (!data || data.length === 0) break;
    allProducts = allProducts.concat(data);
    if (data.length < pageSize) break;
    from += data.length;
  }
  allProducts.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return allProducts;
}

function mapDbProductToLocal(p) {
  return {
    id: p.id, ref: p.ref, name: p.name, price: Number(p.price),
    categoryId: p.category_id, image: p.image, sortOrder: p.sort_order || 0,
    unitStep: p.unit_step || 1, unitLabel: p.unit_label || '',
    outOfStock: !!p.out_of_stock, featured: !!p.featured,
    hidden: !!p.hidden, isNew: !!p.is_new, isPromo: !!p.is_promo
  };
}

async function loadAllData() {
  try {
    const [catRes, settRes] = await Promise.all([
      supabaseClient.from('categories').select('*').order('sort_order'),
      supabaseClient.from('settings').select('*').eq('id', 1).single()
    ]);
    if (catRes.error) throw catRes.error;
    if (settRes.error) throw settRes.error;

    categories = (catRes.data || []).map(c => ({
      id: c.id, name: c.name, sort_order: c.sort_order,
      bulkGroupId: c.bulk_group_id || null,
      bulkThresholdQty: c.bulk_threshold_qty || null,
      bulkPrice: c.bulk_price != null ? Number(c.bulk_price) : null,
      hidden: !!c.hidden,
      coverImage: c.cover_image || null
    }));
    settings = settRes.data || settings;
    theme = Object.assign({}, DEFAULT_THEME, settings.theme_settings || {});
    savedTheme = Object.assign({}, theme);
    applyThemeToPage();

    const allProducts = await fetchAllProductsFromDB();
    products = allProducts.map(mapDbProductToLocal);

    loadCartFromStorage();
    if (wasAdminPreviouslyUnlocked()) {
      unlockAdminPanel();
    }

    applyBrandingToPage();
    document.getElementById('loadingState').style.display = 'none';
    renderCategoryStrip();
    renderGrid();
    renderHomeTiles();
    updateCartUI();
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
  const visibleProducts = products.filter(isProductVisible);
  const allCount = visibleProducts.length;
  let html = `<button class="cat-chip catalogue-chip" data-action="open-catalogue">🗂️ Catalogue</button>`;
  html += `<button class="cat-chip ${activeCategory === 'all' ? 'active' : ''}" data-cat="all">Tout <span class="count">${allCount}</span></button>`;
  const featuredCount = visibleProducts.filter(p => p.featured).length;
  if (featuredCount > 0) {
    html += `<button class="cat-chip featured-chip ${activeCategory === 'featured' ? 'active' : ''}" data-cat="featured">⭐ Meilleures ventes <span class="count">${featuredCount}</span></button>`;
  }
  const promoCount = visibleProducts.filter(p => p.isPromo).length;
  if (promoCount > 0 && theme.showPromoSection) {
    html += `<button class="cat-chip promo-chip ${activeCategory === 'promo' ? 'active' : ''}" data-cat="promo">${escapeHtml(theme.promoLabel || '🔥 Promos')} <span class="count">${promoCount}</span></button>`;
  }
  const newCount = visibleProducts.filter(p => p.isNew).length;
  if (newCount > 0 && theme.showNewSection) {
    html += `<button class="cat-chip new-chip ${activeCategory === 'new' ? 'active' : ''}" data-cat="new">${escapeHtml(theme.newLabel || '✨ Nouveauté')} <span class="count">${newCount}</span></button>`;
  }
  categories.filter(c => !c.hidden).forEach(c => {
    const count = visibleProducts.filter(p => p.categoryId === c.id).length;
    html += `<button class="cat-chip ${activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)} <span class="count">${count}</span></button>`;
  });
  strip.innerHTML = html;
  strip.querySelectorAll('.cat-chip[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      window.scrollTo({ top: 0, behavior: 'instant' });
      // requestAnimationFrame laisse le navigateur terminer le scroll et
      // la mise à jour visuelle des chips avant de lancer le rendu de la
      // grille, ce qui évite l'impression de saccade quand on bascule
      // rapidement entre plusieurs catégories à la suite.
      renderCategoryStrip();
      requestAnimationFrame(() => renderGrid());
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
  const visibleProducts = products.filter(isProductVisible);
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
  categories.filter(cat => !cat.hidden).forEach(cat => {
    const items = visibleProducts.filter(p => p.categoryId === cat.id);
    if (items.length === 0) return;
    // Utilise la photo de couverture personnalisée si l'admin en a défini
    // une pour cette catégorie ; sinon, retombe sur la photo du premier
    // produit du rayon, comme avant.
    const coverImage = cat.coverImage || items[0].image;
    html += `
    <div class="home-tile" data-cat="${cat.id}">
      <img src="${coverImage || ''}" alt="">
      <div class="tile-label">${escapeHtml(cat.name)}<span class="tile-count">${items.length} article${items.length > 1 ? 's' : ''}</span></div>
    </div>`;
  });
  container.innerHTML = html;
  observeCardsForScrollReveal('.home-tile');
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
  let list = products.filter(isProductVisible);
  if (activeCategory === 'featured') {
    list = list.filter(p => p.featured);
  } else if (activeCategory === 'promo') {
    list = list.filter(p => p.isPromo);
  } else if (activeCategory === 'new') {
    list = list.filter(p => p.isNew);
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
  const visibleProducts = products.filter(isProductVisible);
  // Calculé UNE SEULE fois par rendu (et non une fois par produit, comme
  // c'était le cas avant) : c'est ce qui causait le ralentissement
  // ressenti dans "Tout", où ce calcul tournait jusqu'à 900 fois.
  const bulkEligible = getBulkEligibleCategories();

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
      featured.forEach(p => html += productCardHtml(p, bulkEligible));
      html += `</div>`;
    }
    const promoItems = visibleProducts.filter(p => p.isPromo);
    if (promoItems.length && theme.showPromoSection) {
      html += `<div class="section-title promo-title">${escapeHtml(theme.promoLabel || '🔥 Promos')}</div><div class="grid">`;
      promoItems.forEach(p => html += productCardHtml(p, bulkEligible));
      html += `</div>`;
    }
    const newOnes = visibleProducts.filter(p => p.isNew);
    if (newOnes.length && theme.showNewSection) {
      html += `<div class="section-title new-title">${escapeHtml(theme.newLabel || '✨ Nouveauté')}</div><div class="grid">`;
      newOnes.forEach(p => html += productCardHtml(p, bulkEligible));
      html += `</div>`;
    }
    categories.filter(cat => !cat.hidden).forEach(cat => {
      const items = visibleProducts.filter(p => p.categoryId === cat.id);
      if (items.length === 0) return;
      html += `<div class="section-title">${escapeHtml(cat.name)}</div><div class="grid">`;
      items.forEach(p => html += productCardHtml(p, bulkEligible));
      html += `</div>`;
    });
    const orphan = visibleProducts.filter(p => !categories.some(c => c.id === p.categoryId));
    if (orphan.length) {
      html += `<div class="section-title">Autres</div><div class="grid">`;
      orphan.forEach(p => html += productCardHtml(p, bulkEligible));
      html += `</div>`;
    }
  } else if (activeCategory === 'featured') {
    html += `<div class="grid">`;
    visibleProducts.filter(p => p.featured).forEach(p => html += productCardHtml(p, bulkEligible));
    html += `</div>`;
  } else {
    html += `<div class="grid">`;
    list.forEach(p => html += productCardHtml(p, bulkEligible));
    html += `</div>`;
  }

  container.innerHTML = html;
  attachCardListeners();
}

function productCardHtml(p, bulkEligible) {
  const qty = cart[p.id] || 0; // en unités réelles
  const lots = p.unitStep > 1 ? Math.round(qty / p.unitStep) : qty;
  const img = p.image || '';
  const unitTag = p.unitStep > 1 ? `<span class="t-unit">📦 Lot de ${p.unitStep}</span>` : '';
  bulkEligible = bulkEligible || getBulkEligibleCategories();
  const effectivePrice = getEffectivePrice(p, bulkEligible);
  const isBulk = effectivePrice !== p.price;
  const priceDisplay = isBulk
    ? `<span class="price bulk">${fmtPrice(effectivePrice).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(effectivePrice).split(',')[1]}</span></span>`
    : `<span class="price">${fmtPrice(p.price).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(p.price).split(',')[1]}</span></span>`;

  if (p.outOfStock) {
    return `
    <div class="ticket out-of-stock" data-id="${p.id}">
      <div class="ticket-main">
        <div class="ticket-img-wrap" data-detailid="${p.id}">
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
      <div class="ticket-img-wrap" data-detailid="${p.id}">
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
          <input type="number" class="qty-input" data-id="${p.id}" value="${qty}" min="0" inputmode="numeric">
          <button class="qty-plus" data-id="${p.id}">+</button>
        </div>
      ` : `
        <button class="add-btn" data-id="${p.id}">+</button>
      `}
    </div>
  </div>`;
}

/* Ajuste dynamiquement la largeur d'un champ de quantité selon le
   nombre de caractères affichés, pour que les nombres à 3+ chiffres
   (ex. 120, 1000) restent toujours entièrement visibles au lieu d'être
   coupés par la largeur fixe d'origine. */
function resizeQtyInput(input) {
  const len = String(input.value || '0').length;
  const fontSize = parseFloat(getComputedStyle(input).fontSize) || 12.5;
  const charWidth = fontSize * 0.62;
  input.style.width = Math.max(24, Math.ceil(len * charWidth + 8)) + 'px';
}

function attachCardListeners() {
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1, btn));
  });
  document.querySelectorAll('.qty-plus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1));
  });
  document.querySelectorAll('.qty-minus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, -1));
  });
  document.querySelectorAll('.qty-input').forEach(inp => {
    resizeQtyInput(inp);
    inp.addEventListener('input', () => resizeQtyInput(inp));
    inp.addEventListener('change', () => setCartQtyLots(inp.dataset.id, inp.value));
    inp.addEventListener('click', (e) => e.target.select());
  });
  // Le clic sur la photo n'ouvre plus le tiroir de détail produit (retiré
  // sur demande) : on reste simplement sur la grille du catalogue.
  observeCardsForScrollReveal();
}

/* Observateur unique et réutilisé (plutôt qu'une instance par carte,
   trop coûteuse) qui ajoute la classe "in-view" à chaque carte au
   moment où elle entre dans l'écran pendant le défilement, déclenchant
   un fondu + léger glissement vers le haut défini en CSS. Rend le
   défilement du catalogue plus agréable visuellement sans aucun coût de
   performance notable (l'observation est passive, gérée par le
   navigateur). */
let scrollRevealObserver = null;
function observeCardsForScrollReveal(selector) {
  selector = selector || '.ticket';
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll(selector).forEach(el => el.classList.add('in-view'));
    return;
  }
  if (!scrollRevealObserver) {
    scrollRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          el.classList.add('animating');
          // requestAnimationFrame garantit que will-change est bien
          // appliqué par le navigateur avant le changement d'état qui
          // déclenche la transition (sinon le navigateur peut "rater"
          // l'optimisation sur certains appareils).
          requestAnimationFrame(() => {
            el.classList.add('in-view');
            setTimeout(() => el.classList.remove('animating'), 170);
          });
          scrollRevealObserver.unobserve(el);
        }
      });
    }, { rootMargin: '150px 0px 0px 0px', threshold: 0 });
  }
  document.querySelectorAll(`${selector}:not(.in-view)`).forEach(el => {
    scrollRevealObserver.observe(el);
  });
}

/* Construit uniquement le contenu du "ticket-stub" (prix + bouton/qty)
   pour un produit donné, identique à ce que produit productCardHtml(). */
function ticketStubInnerHtml(p) {
  const qty = cart[p.id] || 0;
  const lots = p.unitStep > 1 ? Math.round(qty / p.unitStep) : qty;
  const bulkEligible = getBulkEligibleCategories();
  const effectivePrice = getEffectivePrice(p, bulkEligible);
  const isBulk = effectivePrice !== p.price;
  const priceDisplay = isBulk
    ? `<span class="price bulk">${fmtPrice(effectivePrice).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(effectivePrice).split(',')[1]}</span></span>`
    : `<span class="price">${fmtPrice(p.price).replace(' €','').split(',')[0]}<span class="cents">,${fmtPrice(p.price).split(',')[1]}</span></span>`;

  if (p.outOfStock) {
    return `${priceDisplay}<span class="stock-label">Indisponible</span>`;
  }

  return `
    ${priceDisplay}
    ${lots > 0 ? `
      <div class="qty-control">
        <button class="qty-minus" data-id="${p.id}">−</button>
        <input type="number" class="qty-input" data-id="${p.id}" value="${qty}" min="0" inputmode="numeric">
        <button class="qty-plus" data-id="${p.id}">+</button>
      </div>
    ` : `
      <button class="add-btn" data-id="${p.id}">+</button>
    `}`;
}

/* Met à jour, dans toute la page, uniquement les cartes correspondant à
   ce produit (prix + zone quantité), sans reconstruire toute la grille.
   C'est ce qui évite le ralentissement perceptible dans "Tout" : avant,
   chaque clic +/- déclenchait un renderGrid() complet sur ~900 produits ;
   maintenant, seules les quelques cartes de CE produit sont retouchées. */
function patchProductCardsInPlace(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  document.querySelectorAll(`.ticket[data-id="${productId}"] .ticket-stub`).forEach(stub => {
    stub.innerHTML = ticketStubInnerHtml(p);
    attachStubListeners(stub);
  });
}

/* Réattache les écouteurs +/- et l'input quantité juste après un patch
   ciblé (le innerHTML précédent a été remplacé, donc les anciens
   écouteurs ont disparu avec lui). */
function attachStubListeners(stub) {
  stub.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1, btn));
  });
  stub.querySelectorAll('.qty-plus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, 1));
  });
  stub.querySelectorAll('.qty-minus').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset.id, -1));
  });
  stub.querySelectorAll('.qty-input').forEach(inp => {
    resizeQtyInput(inp);
    inp.addEventListener('input', () => resizeQtyInput(inp));
    inp.addEventListener('change', () => setCartQtyLots(inp.dataset.id, inp.value));
    inp.addEventListener('click', (e) => e.target.select());
  });
}

/* Joue une petite animation de "pop" + halo sur le bouton +, pour un
   retour visuel agréable à l'ajout (appelée juste après le patch ciblé,
   donc sur le nouveau bouton qui vient d'être inséré). */
function playAddPulse(productId) {
  document.querySelectorAll(`.ticket[data-id="${productId}"] .add-btn, .ticket[data-id="${productId}"] .qty-plus`).forEach(btn => {
    btn.classList.remove('pop');
    // force un reflow pour pouvoir relancer l'animation si cliqué plusieurs fois vite
    void btn.offsetWidth;
    btn.classList.add('pop');
  });
  const badge = document.getElementById('cartBadge');
  if (badge) {
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
  }
}

/* =========================================================
   DÉTAIL PRODUIT (drawer affiché au clic sur la photo d'un produit)
   ========================================================= */
function openProductDetail(id) {
  const p = products.find(x => x.id === id);
  if (!p) return;

  const qty = cart[p.id] || 0;
  const lots = p.unitStep > 1 ? Math.round(qty / p.unitStep) : qty;
  const bulkEligible = getBulkEligibleCategories();
  const effectivePrice = getEffectivePrice(p, bulkEligible);
  const isBulk = effectivePrice !== p.price;
  const unitTag = p.unitStep > 1 ? `<span class="t-unit">📦 Lot de ${p.unitStep}</span>` : '';

  const body = document.getElementById('productDetailBody');
  body.innerHTML = `
    <div class="ticket-img-wrap" style="aspect-ratio:1/1;border-radius:14px;margin-bottom:16px;">
      <img src="${p.image || ''}" alt="${escapeHtml(p.name)}">
    </div>
    <div class="t-name" style="font-size:18px;-webkit-line-clamp:none;min-height:auto;margin-bottom:6px;">${escapeHtml(p.name)}</div>
    <div class="t-ref" style="font-size:11px;">Réf. ${escapeHtml(p.ref)}</div>
    ${unitTag}
    <div style="margin-top:14px;font-family:'Fraunces',serif;font-weight:700;font-size:24px;color:var(--ink, #1A1814);">
      ${isBulk ? `<span class="old-price">${fmtPrice(p.price)}</span> ` : ''}${fmtPrice(effectivePrice)}
    </div>
    ${p.outOfStock ? `<div class="stock-label" style="margin-top:8px;">Rupture de stock — indisponible</div>` : ''}
  `;

  const footer = document.getElementById('productDetailFooter');
  if (p.outOfStock) {
    footer.innerHTML = `<button class="btn-secondary" disabled style="opacity:0.5;">Indisponible</button>`;
  } else {
    footer.innerHTML = `
      <div class="qty-control" style="justify-content:center;margin-bottom:12px;background:var(--paper-dim, #F7F4EE);">
        <button class="qty-minus" data-id="${p.id}" style="width:38px;height:38px;font-size:18px;">−</button>
        <input type="number" class="qty-input" data-id="${p.id}" value="${qty}" min="0" inputmode="numeric" style="font-size:16px;">
        <button class="qty-plus" data-id="${p.id}" style="width:38px;height:38px;font-size:18px;">+</button>
      </div>
      <button class="btn-primary" id="detailAddToCartBtn" data-id="${p.id}">Ajouter au panier</button>
    `;
    footer.querySelector('.qty-minus').addEventListener('click', () => { addToCart(p.id, -1); openProductDetail(p.id); });
    footer.querySelector('.qty-plus').addEventListener('click', () => { addToCart(p.id, 1); openProductDetail(p.id); });
    resizeQtyInput(footer.querySelector('.qty-input'));
    footer.querySelector('.qty-input').addEventListener('input', (e) => resizeQtyInput(e.target));
    footer.querySelector('.qty-input').addEventListener('change', (e) => { setCartQtyLots(p.id, e.target.value); openProductDetail(p.id); });
    footer.querySelector('#detailAddToCartBtn').addEventListener('click', () => {
      addToCart(p.id, 1);
      showToast(`✓ ${p.ref} ajouté au panier`);
    });
  }

  openDrawer('productDetailDrawer');
}

/* =========================================================
   PANIER (les deltas sont en "lots", convertis en unités réelles)
   ========================================================= */
function addToCart(id, deltaLots, btnEl) {
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
  // Ne retouche QUE les cartes de ce produit (pas tout renderGrid()) :
  // c'est ce qui élimine le ralentissement ressenti dans "Tout" où des
  // centaines de cartes étaient reconstruites à chaque clic +/-.
  patchProductCardsInPlace(id);
  if (deltaLots > 0) playAddPulse(id);
}

/* Permet au client de taper directement un nombre de lots dans le champ
   de quantité (au lieu de cliquer +/- plusieurs fois). La valeur saisie
   reste exprimée en lots ; elle est convertie en unités réelles via
   unitStep, comme pour les boutons +/-. */
/* Permet à l'admin de taper directement le nombre d'unités RÉELLES
   souhaité dans le champ de quantité (ex. 57 = exactement 57 unités),
   même pour un produit vendu par lot. Le chiffre tapé n'est PAS
   multiplié par la taille du lot. */
function setCartQtyLots(id, typedValue) {
  const p = products.find(x => x.id === id);
  if (!p) return;
  let units = parseInt(typedValue, 10);
  if (isNaN(units) || units < 0) units = 0;
  if (p.outOfStock && units > 0) {
    showToast('Ce produit est en rupture de stock');
    units = 0;
  }
  if (units <= 0) {
    delete cart[id];
  } else {
    cart[id] = units;
  }
  updateCartUI();
  patchProductCardsInPlace(id);
}
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
      total += price * qty;
      // Le compteur "articles" affiché au client compte le nombre de
      // lots/sélections, pas les unités réelles à l'intérieur des lots.
      // Ex. 1 lot de 12 ajouté = 1 article (pas 12), pour que le total
      // affiché corresponde à "combien de produits différents tu as
      // pris", et non à la quantité physique totale.
      const step = p.unitStep || 1;
      count += step > 1 ? Math.round(qty / step) : qty;
    }
  });
  return { total, count, bulkEligible };
}

function updateCartUI() {
  saveCartToStorage();
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
            <input type="number" class="qty-input cl-input" data-id="${id}" value="${qty}" min="0" inputmode="numeric">
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
  body.querySelectorAll('.cl-input').forEach(inp => {
    resizeQtyInput(inp);
    inp.addEventListener('input', () => resizeQtyInput(inp));
    inp.addEventListener('change', () => setCartQtyLots(inp.dataset.id, inp.value));
    inp.addEventListener('click', (e) => e.target.select());
  });

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
  let searchDebounceTimer = null;
  input.addEventListener('input', () => {
    searchTerm = input.value;
    clearBtn.style.display = searchTerm ? 'block' : 'none';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderGrid();
    }, 180);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchTerm = '';
    clearBtn.style.display = 'none';
    clearTimeout(searchDebounceTimer);
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
    const nameInput = document.getElementById('clientNameInput');
    const shopInput = document.getElementById('clientShopInput');
    const name = nameInput.value.trim();
    const shopName = shopInput.value.trim();
    const nameError = document.getElementById('clientNameError');
    const shopError = document.getElementById('clientShopError');
    if (!name) {
      nameInput.classList.add('input-error');
      nameError.style.display = 'block';
      nameInput.focus();
      showToast('⚠️ Merci d\'indiquer votre nom');
      return;
    }
    nameInput.classList.remove('input-error');
    nameError.style.display = 'none';
    if (!shopName) {
      shopInput.classList.add('input-error');
      shopError.style.display = 'block';
      shopInput.focus();
      showToast('⚠️ Merci d\'indiquer le nom du magasin');
      return;
    }
    shopInput.classList.remove('input-error');
    shopError.style.display = 'none';
    await submitOrder(name, shopName);
  });
  document.getElementById('clientNameInput').addEventListener('input', (e) => {
    if (e.target.value.trim()) {
      e.target.classList.remove('input-error');
      document.getElementById('clientNameError').style.display = 'none';
    }
  });
  document.getElementById('clientShopInput').addEventListener('input', (e) => {
    if (e.target.value.trim()) {
      e.target.classList.remove('input-error');
      document.getElementById('clientShopError').style.display = 'none';
    }
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
/* Persistance du déverrouillage admin : une fois le code entré
   correctement, l'accès reste ouvert même après un rechargement de la
   page, jusqu'à ce que l'utilisateur clique sur "Verrouiller". */
const ADMIN_UNLOCK_KEY = 'souvenirs_paris_admin_unlocked_v1';
function saveAdminUnlockState(unlocked) {
  try {
    if (unlocked) localStorage.setItem(ADMIN_UNLOCK_KEY, '1');
    else localStorage.removeItem(ADMIN_UNLOCK_KEY);
  } catch (e) {
    console.warn('Impossible de sauvegarder l\'état admin', e);
  }
}
function wasAdminPreviouslyUnlocked() {
  try {
    return localStorage.getItem(ADMIN_UNLOCK_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function unlockAdminPanel() {
  adminUnlocked = true;
  saveAdminUnlockState(true);
  document.getElementById('adminLockScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  renderAdminProductList();
  renderAdminCatList();
  renderAdminOrderList();
  prefillSettings();
  prefillThemeControls();
}

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
      document.getElementById('pinError').textContent = '';
      inputs.forEach(i => i.value = '');
      unlockAdminPanel();
    } else {
      document.getElementById('pinError').textContent = 'Code incorrect, réessayez.';
      inputs.forEach(i => i.value = '');
      inputs[0].focus();
    }
  });
}

function setupAdminTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['orders', 'products', 'categories', 'settings'].forEach(t => {
        const panel = document.getElementById('tab' + capitalize(t));
        if (t === btn.dataset.tab) {
          panel.style.display = 'block';
          panel.classList.remove('tab-fade-in');
          // Force un reflow pour pouvoir relancer l'animation à chaque clic.
          void panel.offsetWidth;
          panel.classList.add('tab-fade-in');
        } else {
          panel.style.display = 'none';
          panel.classList.remove('tab-fade-in');
        }
      });
      // Toujours repartir des données les plus récentes de la base avant
      // d'afficher la liste des produits : évite qu'un autre appareil
      // resté ouvert (tablette, téléphone) n'écrase un changement récent
      // avec une copie locale obsolète.
      if (btn.dataset.tab === 'products') {
        await refreshAdminProducts();
      }
    });
  });
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* Recharge uniquement les produits depuis la base (sans toucher au
   panier ni aux catégories) et redessine la liste admin + le catalogue
   public, pour que l'admin voie toujours l'état réel le plus récent. */
async function refreshAdminProducts() {
  const list = document.getElementById('adminProductList');
  const previousHtml = list.innerHTML;
  list.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const allProducts = await fetchAllProductsFromDB();
    products = allProducts.map(mapDbProductToLocal);
    renderAdminProductList();
    renderGrid();
    renderHomeTiles();
    renderCategoryStrip();
  } catch (e) {
    console.error('Erreur de rafraîchissement des produits', e);
    list.innerHTML = previousHtml;
    showToast('⚠️ Impossible de rafraîchir les produits');
  }
}

/* =========================================================
   ADMIN — Commandes
   ========================================================= */
async function renderAdminOrderList() {
  const list = document.getElementById('adminOrderList');
  list.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(100);
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
            <option value="nouvelle" ${o.status === 'nouvelle' ? 'selected' : ''}>🆕 Nouvelle</option>
            <option value="en_cours" ${o.status === 'en_cours' ? 'selected' : ''}>⏳ En cours</option>
            <option value="terminee" ${o.status === 'terminee' ? 'selected' : ''}>✅ Terminée</option>
          </select>
        </div>
        <div class="oc-notes-wrap">
          <label class="oc-notes-label">📝 Note interne</label>
          <textarea class="oc-notes-input" data-order-id="${o.id}" placeholder="Ex. Appeler le client avant livraison…">${escapeHtml(o.notes || '')}</textarea>
        </div>
        <button class="copy-order-btn" data-copyitems='${escapeHtml(JSON.stringify(o.items || []))}'>📋 Copier (réf. × qté)</button>
        <div class="oc-action-row">
          <button class="oc-archive-btn" data-archiveorder="${o.id}">🗂 Archiver</button>
          <button class="oc-delete-btn" data-delorder-active="${o.id}">🗑 Supprimer</button>
        </div>
      </div>`;
    });
    list.innerHTML = html;
    observeCardsForScrollReveal('.order-card');
    list.querySelectorAll('.copy-order-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        let items = [];
        try { items = JSON.parse(btn.dataset.copyitems); } catch (e) { items = []; }
        const text = items.map(it => `${it.ref} x${it.qty}`).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          showToast('✓ Copié dans le presse-papiers');
        } catch (e) {
          showToast('⚠️ Copie impossible sur cet appareil');
        }
      });
    });
    list.querySelectorAll('[data-delorder-active]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer DÉFINITIVEMENT cette commande ? Cette action est irréversible.')) return;
        const { error } = await supabaseClient.from('orders').delete().eq('id', btn.dataset.delorderActive);
        if (error) { showToast('⚠️ Erreur lors de la suppression'); return; }
        showToast('Commande supprimée définitivement');
        renderAdminOrderList();
      });
    });
    list.querySelectorAll('.oc-notes-input').forEach(textarea => {
      let noteSaveTimer = null;
      textarea.addEventListener('input', () => {
        clearTimeout(noteSaveTimer);
        noteSaveTimer = setTimeout(async () => {
          const { error } = await supabaseClient.from('orders').update({ notes: textarea.value }).eq('id', textarea.dataset.orderId);
          if (!error) showToast('✓ Note enregistrée');
        }, 600);
      });
    });
    list.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        sel.parentElement.parentElement.classList.add('status-just-changed');
        const { error } = await supabaseClient.from('orders').update({ status: sel.value }).eq('id', sel.dataset.orderId);
        if (error) showToast('Erreur de mise à jour');
        else showToast('Statut mis à jour');
        setTimeout(() => sel.parentElement.parentElement.classList.remove('status-just-changed'), 600);
      });
    });
    list.querySelectorAll('[data-archiveorder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archiver cette commande ? Elle disparaîtra de cette liste mais restera consultable dans l\'onglet "Archivées".')) return;
        const { error } = await supabaseClient.from('orders').update({ archived: true }).eq('id', btn.dataset.archiveorder);
        if (error) { showToast('⚠️ Erreur lors de l\'archivage'); return; }
        showToast('Commande archivée');
        renderAdminOrderList();
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">⚠️</span><h3>Erreur</h3><p>${escapeHtml(e.message || '')}</p></div>`;
  }
}

/* Liste des commandes archivées : permet de les consulter, les
   désarchiver (retour à la liste normale), ou de les supprimer
   définitivement si besoin. */
async function renderArchivedOrderList() {
  const list = document.getElementById('adminArchivedOrderList');
  if (!list) return;
  list.innerHTML = `<div class="empty-state"><div class="spinner"></div></div>`;
  try {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('archived', true)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    if (!data || data.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="glyph">🗂</span><h3>Aucune commande archivée</h3></div>`;
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
      const notesLine = o.notes && o.notes.trim()
        ? `<div class="oc-notes-display">📝 ${escapeHtml(o.notes)}</div>`
        : '';
      html += `
      <div class="order-card" data-order-id="${o.id}">
        <div class="oc-top">
          <span class="oc-num">Commande n°${escapeHtml(o.order_number)}</span>
          <span class="oc-date">${dateStr}</span>
        </div>
        <div class="oc-client">${clientLine}</div>
        <div class="oc-items">${itemsLines}</div>
        ${notesLine}
        <div class="oc-bottom">
          <span class="oc-total">${fmtPrice(totalWithTva)}</span>
          <span class="status-pill ${o.status}">${o.status === 'nouvelle' ? 'Nouvelle' : o.status === 'en_cours' ? 'En cours' : 'Terminée'}</span>
        </div>
        <button class="copy-order-btn" data-unarchiveorder="${o.id}" style="background:var(--mustard-deep, var(--mustard));">↺ Désarchiver</button>
        <button class="delete-order-btn" data-delorder="${o.id}">🗑 Supprimer définitivement</button>
      </div>`;
    });
    list.innerHTML = html;
    list.querySelectorAll('[data-unarchiveorder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { error } = await supabaseClient.from('orders').update({ archived: false }).eq('id', btn.dataset.unarchiveorder);
        if (error) { showToast('⚠️ Erreur'); return; }
        showToast('✓ Commande désarchivée');
        renderArchivedOrderList();
        renderAdminOrderList();
      });
    });
    list.querySelectorAll('[data-delorder]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer DÉFINITIVEMENT cette commande ? Cette action est irréversible.')) return;
        const { error } = await supabaseClient.from('orders').delete().eq('id', btn.dataset.delorder);
        if (error) { showToast('⚠️ Erreur lors de la suppression'); return; }
        showToast('Commande supprimée définitivement');
        renderArchivedOrderList();
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
  const q = adminProductSearchTerm.trim().toLowerCase();

  // Tant qu'aucune recherche n'est tapée, on n'affiche rien : avec ~900
  // produits, construire toute la liste (des milliers d'éléments DOM)
  // à chaque ouverture de l'onglet rendait le défilement de l'admin très
  // lourd. La liste ne se construit donc plus qu'à partir des résultats
  // de recherche réels, ce qui élimine ce poids inutile.
  if (!q) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">🔎</span><h3>Tapez une référence ou un nom</h3><p>Les produits correspondants s'afficheront ici.</p></div>`;
    return;
  }

  const displayProducts = products.filter(p => p.ref.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  if (displayProducts.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">📦</span><h3>Aucun résultat</h3><p>Essayez une autre référence.</p></div>`;
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
  observeCardsForScrollReveal('.admin-product-row-wrap');
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

/* Définit une photo de couverture personnalisée pour une catégorie,
   utilisée dans la mosaïque du tiroir "Catalogue" à la place de la
   première photo de produit prise automatiquement. Même traitement
   (redimensionnement, compression) que pour les photos de produit. */
function setCategoryCoverImage(categoryId, file) {
  const cat = categories.find(c => c.id === categoryId);
  if (!cat) return;
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
        const { error } = await supabaseClient.from('categories').update({ cover_image: newImageData }).eq('id', categoryId);
        if (error) throw error;
        cat.coverImage = newImageData;
        showToast(`✓ Photo de « ${cat.name} » mise à jour`);
        renderAdminCatList();
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

async function resetCategoryCoverImage(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  if (!cat) return;
  try {
    const { error } = await supabaseClient.from('categories').update({ cover_image: null }).eq('id', categoryId);
    if (error) throw error;
    cat.coverImage = null;
    showToast(`✓ Photo de « ${cat.name} » réinitialisée`);
    renderAdminCatList();
    renderHomeTiles();
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de la réinitialisation');
  }
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
/* Réordonne les catégories (haut/bas/début/fin), met à jour sort_order
   pour TOUTES les catégories en conséquence, et sauvegarde le nouvel
   ordre dans Supabase. Le catalogue public et la liste admin sont
   redessinés immédiatement après. */
async function moveCategory(categoryId, action) {
  const idx = categories.findIndex(c => c.id === categoryId);
  if (idx === -1) return;

  let newIdx = idx;
  if (action === 'up') newIdx = Math.max(0, idx - 1);
  else if (action === 'down') newIdx = Math.min(categories.length - 1, idx + 1);
  else if (action === 'totop') newIdx = 0;
  else if (action === 'tobottom') newIdx = categories.length - 1;

  if (newIdx === idx) return;

  const [moved] = categories.splice(idx, 1);
  categories.splice(newIdx, 0, moved);

  // Réassigne un sort_order séquentiel propre à toutes les catégories
  categories.forEach((c, i) => { c.sort_order = i + 1; });

  renderAdminCatList();
  renderCategoryStrip();
  renderGrid();
  renderHomeTiles();

  try {
    const updates = categories.map(c => supabaseClient.from('categories').update({ sort_order: c.sort_order }).eq('id', c.id));
    const results = await Promise.all(updates);
    const failed = results.find(r => r.error);
    if (failed) throw failed.error;
    showToast('✓ Ordre des catégories mis à jour');
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de l\'enregistrement de l\'ordre');
  }
}

function renderAdminCatList() {
  const list = document.getElementById('adminCatList');
  if (categories.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="glyph">🏷️</span><h3>Aucune catégorie</h3></div>`;
    return;
  }
  let html = '';
  categories.forEach((c, idx) => {
    const count = products.filter(p => p.categoryId === c.id).length;
    const hasBulk = c.bulkThresholdQty && c.bulkPrice != null;
    const isFirst = idx === 0;
    const isLast = idx === categories.length - 1;
    html += `
    <div class="cat-manage-card${c.hidden ? ' hidden-product-row' : ''}">
      <div class="cat-manage-row">
        <div class="cat-reorder-buttons">
          <button class="admin-icon-btn" data-movecat="totop" data-cat-id="${c.id}" ${isFirst ? 'disabled' : ''} title="Déplacer en premier">⏫</button>
          <button class="admin-icon-btn" data-movecat="up" data-cat-id="${c.id}" ${isFirst ? 'disabled' : ''} title="Monter">⬆️</button>
          <button class="admin-icon-btn" data-movecat="down" data-cat-id="${c.id}" ${isLast ? 'disabled' : ''} title="Descendre">⬇️</button>
          <button class="admin-icon-btn" data-movecat="tobottom" data-cat-id="${c.id}" ${isLast ? 'disabled' : ''} title="Déplacer en dernier">⏬</button>
        </div>
        <input type="text" value="${escapeHtml(c.name)}" data-cat-id="${c.id}">
        <span style="font-size:11px;color:var(--brass);flex-shrink:0;">${count} art.</span>
        <button class="admin-icon-btn ${c.hidden ? 'active-hide' : ''}" data-hidecat="${c.id}" title="${c.hidden ? 'Réafficher cette catégorie' : 'Masquer cette catégorie'}">${c.hidden ? '👁️‍🗨️' : '👁️'}</button>
        <button class="admin-icon-btn danger" data-delcat="${c.id}">🗑</button>
      </div>
      <details class="cat-advanced">
        <summary>⚙️ Réglages avancés${hasBulk ? ' · tarif de gros actif' : ''}</summary>
        <div class="cat-cover-box">
          <div class="lqp-label" style="margin-bottom:8px;">🖼️ Photo de couverture (vignette « Catalogue »)</div>
          <div class="cat-cover-row">
            <div class="cat-cover-preview">
              <img src="${c.coverImage || (products.find(p => p.categoryId === c.id)?.image || '')}" alt="">
            </div>
            <div class="cat-cover-actions">
              <button class="btn-secondary cat-cover-choose-btn" data-cat-id="${c.id}" style="padding:9px;font-size:12.5px;margin-bottom:6px;">📷 Choisir une photo</button>
              ${c.coverImage ? `<button class="btn-secondary cat-cover-reset-btn" data-cat-id="${c.id}" style="padding:7px;font-size:11.5px;">↺ Revenir au produit</button>` : ''}
            </div>
            <input type="file" accept="image/*" class="cat-cover-input" data-cat-id="${c.id}" style="display:none;">
          </div>
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
        </div>
      </details>
    </div>`;
  });
  list.innerHTML = html;
  observeCardsForScrollReveal('.cat-manage-card');

  list.querySelectorAll('input[data-cat-id]:not(.bulk-toggle):not(.bulk-threshold):not(.bulk-price):not(.cat-cover-input)').forEach(inp => {
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
  list.querySelectorAll('[data-hidecat]').forEach(btn => {
    btn.addEventListener('click', () => toggleHideCategory(btn.dataset.hidecat));
  });
  list.querySelectorAll('[data-movecat]').forEach(btn => {
    btn.addEventListener('click', () => moveCategory(btn.dataset.catId, btn.dataset.movecat));
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
  list.querySelectorAll('.cat-cover-choose-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = list.querySelector(`.cat-cover-input[data-cat-id="${btn.dataset.catId}"]`);
      if (input) input.click();
    });
  });
  list.querySelectorAll('.cat-cover-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) setCategoryCoverImage(input.dataset.catId, file);
      input.value = '';
    });
  });
  list.querySelectorAll('.cat-cover-reset-btn').forEach(btn => {
    btn.addEventListener('click', () => resetCategoryCoverImage(btn.dataset.catId));
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

/* Bascule l'état masqué/visible d'une catégorie entière. Masquer une
   catégorie cache TOUS ses produits de la boutique publique, qu'ils
   soient masqués individuellement ou non. Réafficher la catégorie fait
   réapparaître tous ses produits, y compris ceux qui avaient été
   masqués individuellement avant le masquage de la catégorie. */
async function toggleHideCategory(categoryId) {
  const cat = categories.find(c => c.id === categoryId);
  if (!cat) return;
  const newHidden = !cat.hidden;
  const catProducts = products.filter(p => p.categoryId === categoryId);

  try {
    const { error: catError } = await supabaseClient.from('categories').update({ hidden: newHidden }).eq('id', categoryId);
    if (catError) throw catError;
    cat.hidden = newHidden;

    if (!newHidden && catProducts.length > 0) {
      // Réaffichage de la catégorie : on réaffiche aussi tous ses produits
      const { error: prodError } = await supabaseClient
        .from('products')
        .update({ hidden: false })
        .eq('category_id', categoryId);
      if (prodError) throw prodError;
      catProducts.forEach(p => { p.hidden = false; });
    }

    showToast(newHidden
      ? `✓ Catégorie « ${cat.name} » masquée (${catProducts.length} produit${catProducts.length > 1 ? 's' : ''})`
      : `✓ Catégorie « ${cat.name} » de nouveau visible`);
    renderAdminCatList();
    renderAdminProductList();
    renderCategoryStrip();
    renderGrid();
    renderHomeTiles();
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de la mise à jour de la catégorie');
  }
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
/* Applique le nom, le sous-titre et le logo de la boutique sur la page
   publique. Si aucun logo personnalisé n'est défini, le logo SVG par
   défaut (Tour Eiffel dessinée) reste affiché. */
function applyBrandingToPage() {
  document.getElementById('shopNameDisplay').textContent = settings.shop_name || 'Souvenirs de Paris';
  const subtitleEl = document.getElementById('shopSubtitleDisplay');
  if (subtitleEl) subtitleEl.textContent = settings.subtitle || 'Souvenirs de Paris';

  const markEl = document.getElementById('brandMark');
  if (markEl) {
    if (settings.logo_image) {
      markEl.innerHTML = `<img src="${settings.logo_image}" alt="Logo">`;
    } else {
      markEl.innerHTML = DEFAULT_LOGO_SVG;
    }
  }
}

/* Convertit une couleur hex (#RRGGBB) en chaîne rgba(...) avec l'alpha
   donné (0-1), utilisé pour générer les variables de "verre". */
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* Applique tous les réglages de thème (flou, tailles, espacements...) en
   tant que variables CSS sur :root, ce qui les fait immédiatement
   prendre effet partout dans la feuille de style sans avoir à dupliquer
   la logique CSS en JS. Appelée au chargement et en direct à chaque
   modification d'un curseur dans l'admin (aperçu live avant sauvegarde). */
function applyThemeToPage() {
  const r = document.documentElement.style;
  const t = theme;

  const glassAlpha = (t.glassOpacity != null ? t.glassOpacity : 50) / 100;
  const blurPx = t.glassBlur != null ? t.glassBlur : 28;
  r.setProperty('--glass-bg', hexToRgba('#ffffff', Math.max(0.1, glassAlpha - 0.12)));
  r.setProperty('--glass-bg-strong', hexToRgba('#ffffff', Math.min(0.95, glassAlpha + 0.18)));
  r.setProperty('--glass-bg-navy', hexToRgba('#1B2A45', glassAlpha + 0.05));
  r.setProperty('--glass-blur', `blur(${blurPx}px) saturate(180%)`);
  r.setProperty('--glass-blur-soft', `blur(${Math.max(0, blurPx - 10)}px) saturate(160%)`);

  r.setProperty('--card-radius', `${t.cardRadius != null ? t.cardRadius : 16}px`);
  r.setProperty('--chip-radius', `${t.chipRadius != null ? t.chipRadius : 18}px`);
  r.setProperty('--price-size', `${t.priceSize != null ? t.priceSize : 21}px`);
  r.setProperty('--name-size', `${t.nameSize != null ? t.nameSize : 13.5}px`);
  r.setProperty('--font-heading', t.fontHeading || "'Fraunces', serif");
  r.setProperty('--font-body', t.fontBody || "'Jost', sans-serif");
  r.setProperty('--button-radius', `${t.buttonRadius != null ? t.buttonRadius : 24}px`);
  r.setProperty('--add-btn-size', `${t.addBtnSize != null ? t.addBtnSize : 34}px`);
  r.setProperty('--image-padding', `${t.imagePadding != null ? t.imagePadding : 14}px`);
  r.setProperty('--card-gap', `${t.cardGap != null ? t.cardGap : 8}px`);

  const shadowAlpha = (t.cardShadow != null ? t.cardShadow : 18) / 100;
  r.setProperty('--glass-shadow', `0 8px 32px rgba(20,20,30,${shadowAlpha})`);

  const speedMultiplier = 100 / (t.animSpeed != null ? t.animSpeed : 100);
  r.setProperty('--anim-speed-fast', `${(0.12 * speedMultiplier).toFixed(3)}s`);
  r.setProperty('--anim-speed-normal', `${(0.3 * speedMultiplier).toFixed(3)}s`);
  r.setProperty('--anim-speed-slow', `${(0.45 * speedMultiplier).toFixed(3)}s`);

  // ===== Transparence & flou par zone =====
  r.setProperty('--topbar-bg', hexToRgba('#F7F4EE', (t.topbarOpacity != null ? t.topbarOpacity : 92) / 100));
  r.setProperty('--topbar-blur', `blur(${t.topbarBlur != null ? t.topbarBlur : 28}px) saturate(180%)`);
  r.setProperty('--catstrip-chip-bg', hexToRgba('#ffffff', (t.catStripOpacity != null ? t.catStripOpacity : 38) / 100));
  const drawerAlpha = (t.drawerOpacity != null ? t.drawerOpacity : 68) / 100;
  r.setProperty('--drawer-bg', hexToRgba('#ffffff', drawerAlpha));
  r.setProperty('--drawer-blur', `blur(${t.drawerBlur != null ? t.drawerBlur : 28}px) saturate(180%)`);
  r.setProperty('--cartfab-bg', hexToRgba('#1B2A45', (t.cartFabOpacity != null ? t.cartFabOpacity : 55) / 100));
  r.setProperty('--overlay-bg', hexToRgba('#080c16', (t.overlayOpacity != null ? t.overlayOpacity : 55) / 100));
  r.setProperty('--toast-opacity', String((t.toastOpacity != null ? t.toastOpacity : 100) / 100));

  // ===== 17 réglages additionnels =====
  r.setProperty('--shop-name-size', `${t.shopNameSize != null ? t.shopNameSize : 21}px`);
  r.setProperty('--logo-size', `${t.logoSize != null ? t.logoSize : 38}px`);
  r.setProperty('--search-bar-height', `${t.searchBarHeight != null ? t.searchBarHeight : 45}px`);
  r.setProperty('--search-font-size', `${t.searchFontSize != null ? t.searchFontSize : 14.5}px`);
  r.setProperty('--image-aspect', `${(t.imageAspectRatio != null ? t.imageAspectRatio : 100) / 100}`);
  r.setProperty('--name-line-height', `${(t.lineHeight != null ? t.lineHeight : 132) / 100}`);
  r.setProperty('--ref-size', `${t.refSize != null ? t.refSize : 10}px`);
  r.setProperty('--header-shadow', `0 6px 18px rgba(20,20,30,${(t.headerShadow != null ? t.headerShadow : 6) / 100})`);
  const toastSpeedMultiplier = 100 / (t.toastSpeed != null ? t.toastSpeed : 100);
  r.setProperty('--toast-speed', `${(0.3 * toastSpeedMultiplier).toFixed(3)}s`);
  r.setProperty('--drawer-close-size', `${t.drawerCloseSize != null ? t.drawerCloseSize : 32}px`);
  r.setProperty('--catstrip-padding', `${t.catStripPadding != null ? t.catStripPadding : 14}px`);
  r.setProperty('--chip-gap', `${t.chipGap != null ? t.chipGap : 9}px`);
  r.setProperty('--cart-icon-size', `${t.cartIconSize != null ? t.cartIconSize : 48}px`);
  r.setProperty('--lot-label-size', `${t.lotLabelSize != null ? t.lotLabelSize : 11.5}px`);
  r.setProperty('--image-radius', `${t.imageRadius != null ? t.imageRadius : 0}px`);
  r.setProperty('--press-scale', `${1 - (t.pressScale != null ? t.pressScale : 8) / 100}`);
  r.setProperty('--bg-image-opacity', String((t.bgImageOpacity != null ? t.bgImageOpacity : 100) / 100));
  r.setProperty('--bg-overlay-opacity', String((t.bgOverlayOpacity != null ? t.bgOverlayOpacity : 55) / 100));
  if (settings.background_image) {
    r.setProperty('--bg-image', `url('${settings.background_image}')`);
  } else {
    r.removeProperty('--bg-image');
  }

  // Les cartes utilisent directement une couleur rgba (pas backdrop-filter,
  // pour les raisons de performance vues plus haut) : on la recalcule ici.
  const cardAlpha = (t.cardOpacity != null ? t.cardOpacity : 62) / 100;
  document.querySelectorAll('.ticket').forEach(el => {
    el.style.background = `rgba(255,255,255,${cardAlpha})`;
    el.style.borderRadius = `${t.cardRadius != null ? t.cardRadius : 16}px`;
  });
}

function prefillSettings() {
  document.getElementById('settingWhatsapp').value = settings.whatsapp || '';
  document.getElementById('settingEmail').value = settings.email || '';
  document.getElementById('settingShopName').value = settings.shop_name || '';
  document.getElementById('settingSubtitle').value = settings.subtitle || '';
  const logoPreview = document.getElementById('logoPreview');
  const logoPlaceholder = document.getElementById('logoPlaceholder');
  if (settings.logo_image) {
    logoPreview.src = settings.logo_image;
    logoPreview.style.display = 'block';
    logoPlaceholder.style.display = 'none';
  } else {
    logoPreview.style.display = 'none';
    logoPlaceholder.style.display = 'block';
  }
}
function setupSettingsSave() {
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const shop_name = document.getElementById('settingShopName').value.trim() || 'Souvenirs de Paris';
    const subtitle = document.getElementById('settingSubtitle').value.trim() || 'Souvenirs de Paris';
    const whatsapp = document.getElementById('settingWhatsapp').value.trim();
    const email = document.getElementById('settingEmail').value.trim();
    const { error } = await supabaseClient.from('settings').update({ shop_name, subtitle, whatsapp, email }).eq('id', 1);
    if (error) { showToast('⚠️ Erreur'); return; }
    settings.shop_name = shop_name; settings.subtitle = subtitle; settings.whatsapp = whatsapp; settings.email = email;
    applyBrandingToPage();
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

/* Remplit les contrôles du panneau "Thème & apparence" avec les valeurs
   actuelles (sauvegardées ou par défaut). */
function prefillThemeControls() {
  document.getElementById('themeGlassOpacity').value = theme.glassOpacity;
  document.getElementById('valGlassOpacity').textContent = theme.glassOpacity + '%';
  document.getElementById('themeGlassBlur').value = theme.glassBlur;
  document.getElementById('valGlassBlur').textContent = theme.glassBlur + 'px';
  document.getElementById('themeTopbarOpacity').value = theme.topbarOpacity;
  document.getElementById('valTopbarOpacity').textContent = theme.topbarOpacity + '%';
  document.getElementById('themeCatStripOpacity').value = theme.catStripOpacity;
  document.getElementById('valCatStripOpacity').textContent = theme.catStripOpacity + '%';
  document.getElementById('themeDrawerOpacity').value = theme.drawerOpacity;
  document.getElementById('valDrawerOpacity').textContent = theme.drawerOpacity + '%';
  document.getElementById('themeDrawerBlur').value = theme.drawerBlur;
  document.getElementById('valDrawerBlur').textContent = theme.drawerBlur + 'px';
  document.getElementById('themeCartFabOpacity').value = theme.cartFabOpacity;
  document.getElementById('valCartFabOpacity').textContent = theme.cartFabOpacity + '%';
  document.getElementById('themeOverlayOpacity').value = theme.overlayOpacity;
  document.getElementById('valOverlayOpacity').textContent = theme.overlayOpacity + '%';
  document.getElementById('themeToastOpacity').value = theme.toastOpacity;
  document.getElementById('valToastOpacity').textContent = theme.toastOpacity + '%';

  document.getElementById('themeShopNameSize').value = theme.shopNameSize;
  document.getElementById('valShopNameSize').textContent = theme.shopNameSize + 'px';
  document.getElementById('themeLogoSize').value = theme.logoSize;
  document.getElementById('valLogoSize').textContent = theme.logoSize + 'px';
  document.getElementById('themeSearchBarHeight').value = theme.searchBarHeight;
  document.getElementById('valSearchBarHeight').textContent = theme.searchBarHeight + 'px';
  document.getElementById('themeSearchFontSize').value = theme.searchFontSize;
  document.getElementById('valSearchFontSize').textContent = theme.searchFontSize + 'px';
  document.getElementById('themeCartIconSize').value = theme.cartIconSize;
  document.getElementById('valCartIconSize').textContent = theme.cartIconSize + 'px';
  document.getElementById('themeCatStripPadding').value = theme.catStripPadding;
  document.getElementById('valCatStripPadding').textContent = theme.catStripPadding + 'px';

  document.getElementById('themeCardOpacity').value = theme.cardOpacity;
  document.getElementById('valCardOpacity').textContent = theme.cardOpacity + '%';
  document.getElementById('themeCardRadius').value = theme.cardRadius;
  document.getElementById('valCardRadius').textContent = theme.cardRadius + 'px';
  document.getElementById('themeCardShadow').value = theme.cardShadow;
  document.getElementById('valCardShadow').textContent = theme.cardShadow + '%';
  document.getElementById('themeCardGap').value = theme.cardGap;
  document.getElementById('valCardGap').textContent = theme.cardGap + 'px';
  document.getElementById('themeHeaderShadow').value = theme.headerShadow;
  document.getElementById('valHeaderShadow').textContent = theme.headerShadow + '%';
  document.getElementById('themePressScale').value = theme.pressScale;
  document.getElementById('valPressScale').textContent = theme.pressScale + '%';
  document.getElementById('themeBgImageOpacity').value = theme.bgImageOpacity;
  document.getElementById('valBgImageOpacity').textContent = theme.bgImageOpacity + '%';
  document.getElementById('themeBgOverlayOpacity').value = theme.bgOverlayOpacity;
  document.getElementById('valBgOverlayOpacity').textContent = theme.bgOverlayOpacity + '%';
  const bgPreview = document.getElementById('bgImagePreview');
  if (settings.background_image) {
    bgPreview.src = settings.background_image;
    bgPreview.style.display = 'block';
  } else {
    bgPreview.style.display = 'none';
  }

  document.getElementById('themeChipRadius').value = theme.chipRadius;
  document.getElementById('valChipRadius').textContent = theme.chipRadius + 'px';
  document.getElementById('themeChipGap').value = theme.chipGap;
  document.getElementById('valChipGap').textContent = theme.chipGap + 'px';

  document.getElementById('themePriceSize').value = theme.priceSize;
  document.getElementById('valPriceSize').textContent = theme.priceSize + 'px';
  document.getElementById('themeNameSize').value = theme.nameSize;
  document.getElementById('valNameSize').textContent = theme.nameSize + 'px';
  document.getElementById('themeLineHeight').value = theme.lineHeight;
  document.getElementById('valLineHeight').textContent = theme.lineHeight + '%';
  document.getElementById('themeRefSize').value = theme.refSize;
  document.getElementById('valRefSize').textContent = theme.refSize + 'px';
  document.getElementById('themeLotLabelSize').value = theme.lotLabelSize;
  document.getElementById('valLotLabelSize').textContent = theme.lotLabelSize + 'px';
  document.getElementById('themeFontHeading').value = theme.fontHeading;
  document.getElementById('themeFontBody').value = theme.fontBody;

  document.getElementById('themeButtonRadius').value = theme.buttonRadius;
  document.getElementById('valButtonRadius').textContent = theme.buttonRadius + 'px';
  document.getElementById('themeAddBtnSize').value = theme.addBtnSize;
  document.getElementById('valAddBtnSize').textContent = theme.addBtnSize + 'px';
  document.getElementById('themeDrawerCloseSize').value = theme.drawerCloseSize;
  document.getElementById('valDrawerCloseSize').textContent = theme.drawerCloseSize + 'px';

  document.getElementById('themeImagePadding').value = theme.imagePadding;
  document.getElementById('valImagePadding').textContent = theme.imagePadding + 'px';
  document.getElementById('themeImageAspectRatio').value = theme.imageAspectRatio;
  document.getElementById('valImageAspectRatio').textContent = theme.imageAspectRatio + '%';
  document.getElementById('themeImageRadius').value = theme.imageRadius;
  document.getElementById('valImageRadius').textContent = theme.imageRadius + 'px';

  document.getElementById('themeAnimSpeed').value = theme.animSpeed;
  document.getElementById('valAnimSpeed').textContent = theme.animSpeed + '%';
  document.getElementById('themeToastSpeed').value = theme.toastSpeed;
  document.getElementById('valToastSpeed').textContent = theme.toastSpeed + '%';

  document.getElementById('themeShowPromo').checked = theme.showPromoSection;
  document.getElementById('themePromoLabel').value = theme.promoLabel;
  document.getElementById('themeShowNew').checked = theme.showNewSection;
  document.getElementById('themeNewLabel').value = theme.newLabel;
}

/* Lit l'état actuel de tous les contrôles du panneau et retourne l'objet
   thème correspondant (utilisé à la fois par l'aperçu live et par la
   sauvegarde, pour ne jamais avoir deux logiques de lecture différentes). */
function readThemeFromControls() {
  return {
    glassOpacity: parseInt(document.getElementById('themeGlassOpacity').value, 10),
    glassBlur: parseInt(document.getElementById('themeGlassBlur').value, 10),
    topbarOpacity: parseInt(document.getElementById('themeTopbarOpacity').value, 10),
    catStripOpacity: parseInt(document.getElementById('themeCatStripOpacity').value, 10),
    drawerOpacity: parseInt(document.getElementById('themeDrawerOpacity').value, 10),
    drawerBlur: parseInt(document.getElementById('themeDrawerBlur').value, 10),
    cartFabOpacity: parseInt(document.getElementById('themeCartFabOpacity').value, 10),
    overlayOpacity: parseInt(document.getElementById('themeOverlayOpacity').value, 10),
    toastOpacity: parseInt(document.getElementById('themeToastOpacity').value, 10),

    shopNameSize: parseInt(document.getElementById('themeShopNameSize').value, 10),
    logoSize: parseInt(document.getElementById('themeLogoSize').value, 10),
    searchBarHeight: parseInt(document.getElementById('themeSearchBarHeight').value, 10),
    searchFontSize: parseFloat(document.getElementById('themeSearchFontSize').value),
    cartIconSize: parseInt(document.getElementById('themeCartIconSize').value, 10),
    catStripPadding: parseInt(document.getElementById('themeCatStripPadding').value, 10),

    cardOpacity: parseInt(document.getElementById('themeCardOpacity').value, 10),
    cardRadius: parseInt(document.getElementById('themeCardRadius').value, 10),
    cardShadow: parseInt(document.getElementById('themeCardShadow').value, 10),
    cardGap: parseInt(document.getElementById('themeCardGap').value, 10),
    headerShadow: parseInt(document.getElementById('themeHeaderShadow').value, 10),
    pressScale: parseInt(document.getElementById('themePressScale').value, 10),
    bgImageOpacity: parseInt(document.getElementById('themeBgImageOpacity').value, 10),
    bgOverlayOpacity: parseInt(document.getElementById('themeBgOverlayOpacity').value, 10),

    chipRadius: parseInt(document.getElementById('themeChipRadius').value, 10),
    chipGap: parseInt(document.getElementById('themeChipGap').value, 10),

    priceSize: parseInt(document.getElementById('themePriceSize').value, 10),
    nameSize: parseFloat(document.getElementById('themeNameSize').value),
    lineHeight: parseInt(document.getElementById('themeLineHeight').value, 10),
    refSize: parseInt(document.getElementById('themeRefSize').value, 10),
    lotLabelSize: parseFloat(document.getElementById('themeLotLabelSize').value),
    fontHeading: document.getElementById('themeFontHeading').value,
    fontBody: document.getElementById('themeFontBody').value,

    buttonRadius: parseInt(document.getElementById('themeButtonRadius').value, 10),
    addBtnSize: parseInt(document.getElementById('themeAddBtnSize').value, 10),
    drawerCloseSize: parseInt(document.getElementById('themeDrawerCloseSize').value, 10),

    imagePadding: parseInt(document.getElementById('themeImagePadding').value, 10),
    imageAspectRatio: parseInt(document.getElementById('themeImageAspectRatio').value, 10),
    imageRadius: parseInt(document.getElementById('themeImageRadius').value, 10),

    animSpeed: parseInt(document.getElementById('themeAnimSpeed').value, 10),
    toastSpeed: parseInt(document.getElementById('themeToastSpeed').value, 10),

    showPromoSection: document.getElementById('themeShowPromo').checked,
    showNewSection: document.getElementById('themeShowNew').checked,
    promoLabel: document.getElementById('themePromoLabel').value.trim() || DEFAULT_THEME.promoLabel,
    newLabel: document.getElementById('themeNewLabel').value.trim() || DEFAULT_THEME.newLabel
  };
}

/* Définit une photo de fond personnalisée pour tout le site, remplaçant
   la photo de Paris par défaut. Même traitement (redimensionnement,
   compression) que pour le logo et les photos de catégorie. */
function setBackgroundImage(file) {
  if (file.size > 6 * 1024 * 1024) {
    showToast('Image trop lourde (max 6 Mo)');
    return;
  }
  showToast('⏳ Envoi de la photo…');
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const maxDim = 1600;
      let w = img.width, h = img.height;
      if (w > maxDim) { h = h * maxDim / w; w = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const newImageData = canvas.toDataURL('image/jpeg', 0.85);
      try {
        const { error } = await supabaseClient.from('settings').update({ background_image: newImageData }).eq('id', 1);
        if (error) throw error;
        settings.background_image = newImageData;
        applyThemeToPage();
        prefillThemeControls();
        showToast('✓ Photo de fond mise à jour');
      } catch (e) {
        console.error(e);
        showToast('⚠️ Erreur lors de l\'enregistrement de la photo');
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function resetBackgroundImage() {
  try {
    const { error } = await supabaseClient.from('settings').update({ background_image: null }).eq('id', 1);
    if (error) throw error;
    settings.background_image = null;
    applyThemeToPage();
    prefillThemeControls();
    showToast('✓ Photo de Paris par défaut restaurée');
  } catch (e) {
    console.error(e);
    showToast('⚠️ Erreur lors de la réinitialisation');
  }
}

function setupThemeControls() {
  // Mise à jour en direct des étiquettes de valeur ET application
  // immédiate sur le site (aperçu live) à chaque glissement de curseur,
  // sans attendre la sauvegarde. Les curseurs n'affectent que des
  // variables CSS (déjà appliquées en direct à chaque élément par
  // applyThemeToPage) : on évite donc tout renderGrid()/renderCategoryStrip()
  // ici, sinon le glissement reconstruit tout le catalogue à chaque pixel
  // de déplacement et provoque un vrai ralentissement perceptible.
  const sliderMap = [
    ['themeGlassOpacity', 'valGlassOpacity', '%'],
    ['themeGlassBlur', 'valGlassBlur', 'px'],
    ['themeTopbarOpacity', 'valTopbarOpacity', '%'],
    ['themeCatStripOpacity', 'valCatStripOpacity', '%'],
    ['themeDrawerOpacity', 'valDrawerOpacity', '%'],
    ['themeDrawerBlur', 'valDrawerBlur', 'px'],
    ['themeCartFabOpacity', 'valCartFabOpacity', '%'],
    ['themeOverlayOpacity', 'valOverlayOpacity', '%'],
    ['themeToastOpacity', 'valToastOpacity', '%'],
    ['themeShopNameSize', 'valShopNameSize', 'px'],
    ['themeLogoSize', 'valLogoSize', 'px'],
    ['themeSearchBarHeight', 'valSearchBarHeight', 'px'],
    ['themeSearchFontSize', 'valSearchFontSize', 'px'],
    ['themeCartIconSize', 'valCartIconSize', 'px'],
    ['themeCatStripPadding', 'valCatStripPadding', 'px'],
    ['themeCardOpacity', 'valCardOpacity', '%'],
    ['themeCardRadius', 'valCardRadius', 'px'],
    ['themeCardShadow', 'valCardShadow', '%'],
    ['themeCardGap', 'valCardGap', 'px'],
    ['themeHeaderShadow', 'valHeaderShadow', '%'],
    ['themePressScale', 'valPressScale', '%'],
    ['themeBgImageOpacity', 'valBgImageOpacity', '%'],
    ['themeBgOverlayOpacity', 'valBgOverlayOpacity', '%'],
    ['themeChipRadius', 'valChipRadius', 'px'],
    ['themeChipGap', 'valChipGap', 'px'],
    ['themePriceSize', 'valPriceSize', 'px'],
    ['themeNameSize', 'valNameSize', 'px'],
    ['themeLineHeight', 'valLineHeight', '%'],
    ['themeRefSize', 'valRefSize', 'px'],
    ['themeLotLabelSize', 'valLotLabelSize', 'px'],
    ['themeButtonRadius', 'valButtonRadius', 'px'],
    ['themeAddBtnSize', 'valAddBtnSize', 'px'],
    ['themeDrawerCloseSize', 'valDrawerCloseSize', 'px'],
    ['themeImagePadding', 'valImagePadding', 'px'],
    ['themeImageAspectRatio', 'valImageAspectRatio', '%'],
    ['themeImageRadius', 'valImageRadius', 'px'],
    ['themeAnimSpeed', 'valAnimSpeed', '%'],
    ['themeToastSpeed', 'valToastSpeed', '%']
  ];
  function livePreviewStyleOnly() {
    theme = readThemeFromControls();
    applyThemeToPage();
  }
  sliderMap.forEach(([inputId, labelId, unit]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    input.addEventListener('input', () => {
      label.textContent = input.value + unit;
      livePreviewStyleOnly();
    });
  });

  // Les bascules Promo/Nouveauté et leurs libellés changent du texte et
  // la présence de sections entières : elles ont réellement besoin de
  // renderGrid()/renderCategoryStrip(), mais ça reste rare (toggle/texte
  // tapé) donc sans impact sur la fluidité des curseurs ci-dessus.
  function livePreviewFull() {
    theme = readThemeFromControls();
    applyThemeToPage();
    renderGrid();
    renderCategoryStrip();
  }
  ['themeFontHeading', 'themeFontBody', 'themeShowPromo', 'themeShowNew'].forEach(id => {
    document.getElementById(id).addEventListener('change', livePreviewFull);
  });
  let labelDebounceTimer = null;
  ['themePromoLabel', 'themeNewLabel'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      clearTimeout(labelDebounceTimer);
      labelDebounceTimer = setTimeout(livePreviewFull, 250);
    });
  });

  document.getElementById('chooseBgImageBtn').addEventListener('click', () => {
    document.getElementById('bgImageInput').click();
  });
  document.getElementById('bgImageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setBackgroundImage(file);
    e.target.value = '';
  });
  document.getElementById('resetBgImageBtn').addEventListener('click', () => resetBackgroundImage());

  document.getElementById('saveThemeBtn').addEventListener('click', async () => {
    const newTheme = readThemeFromControls();
    try {
      const { error } = await supabaseClient.from('settings').update({ theme_settings: newTheme }).eq('id', 1);
      if (error) throw error;
      theme = newTheme;
      savedTheme = Object.assign({}, newTheme);
      applyThemeToPage();
      renderGrid();
      renderCategoryStrip();
      showToast('✓ Apparence enregistrée');
    } catch (e) {
      console.error(e);
      showToast('⚠️ Erreur lors de l\'enregistrement de l\'apparence');
    }
  });

  document.getElementById('resetThemeBtn').addEventListener('click', () => {
    // Annule l'aperçu en cours et revient à la dernière version
    // effectivement enregistrée (pas forcément les valeurs par défaut).
    theme = Object.assign({}, savedTheme);
    applyThemeToPage();
    prefillThemeControls();
    renderGrid();
    renderCategoryStrip();
    showToast('Aperçu annulé');
  });
}

/* Téléchargement et réinitialisation du logo de la boutique, stocké
   directement (image légère redimensionnée) dans settings.logo_image,
   comme pour les photos de produits. */
function setupLogoUpload() {
  const fileInput = document.getElementById('logoFileInput');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast('Image trop lourde (max 4 Mo)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const maxDim = 300;
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
        else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const logoData = canvas.toDataURL('image/png');

        try {
          const { error } = await supabaseClient.from('settings').update({ logo_image: logoData }).eq('id', 1);
          if (error) throw error;
          settings.logo_image = logoData;
          applyBrandingToPage();
          prefillSettings();
          showToast('✓ Logo mis à jour');
        } catch (err) {
          console.error(err);
          showToast('⚠️ Erreur lors de l\'enregistrement du logo');
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('resetLogoBtn').addEventListener('click', async () => {
    try {
      const { error } = await supabaseClient.from('settings').update({ logo_image: null }).eq('id', 1);
      if (error) throw error;
      settings.logo_image = null;
      applyBrandingToPage();
      prefillSettings();
      showToast('✓ Logo par défaut restauré');
    } catch (err) {
      console.error(err);
      showToast('⚠️ Erreur lors de la réinitialisation');
    }
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
    document.getElementById('newToggle').checked = !!p.isNew;
    document.getElementById('promoToggle').checked = !!p.isPromo;
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
    document.getElementById('newToggle').checked = false;
    document.getElementById('promoToggle').checked = false;
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
    const isNew = document.getElementById('newToggle').checked;
    const isPromo = document.getElementById('promoToggle').checked;
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
    // La photo n'est obligatoire que pour un NOUVEAU produit. Modifier un
    // produit existant (même sans photo) — par ex. juste cocher "Rupture
    // de stock" — doit toujours fonctionner, sinon la mise à jour est
    // silencieusement bloquée et semble "revenir en arrière" plus tard.
    if (!editingProductId && !pendingImageData) {
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
          out_of_stock: outOfStock, featured: featured, is_new: isNew, is_promo: isPromo
        }).eq('id', editingProductId);
        if (error) throw error;
        const p = products.find(x => x.id === editingProductId);
        p.name = name; p.ref = ref; p.price = price; p.categoryId = categoryId;
        p.image = pendingImageData; p.unitStep = unitStep; p.unitLabel = unitLabel;
        p.outOfStock = outOfStock; p.featured = featured; p.isNew = isNew; p.isPromo = isPromo;
        showToast('Produit mis à jour');
      } else {
        const newId = uid('prod');
        const { error } = await supabaseClient.from('products').insert({
          id: newId, ref, name, price, category_id: categoryId, image: pendingImageData,
          unit_step: unitStep, unit_label: unitLabel, sort_order: products.length + 1,
          out_of_stock: outOfStock, featured: featured, is_new: isNew, is_promo: isPromo
        });
        if (error) throw error;
        products.push({ id: newId, ref, name, price, categoryId, image: pendingImageData, unitStep, unitLabel, outOfStock, featured, isNew, isPromo, hidden: false });
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
    saveAdminUnlockState(false);
    document.getElementById('adminLockScreen').style.display = 'flex';
    document.getElementById('adminPanel').style.display = 'none';
    closeDrawer('adminDrawer');
  });

  // rafraîchir la liste des commandes chaque fois qu'on rouvre l'onglet
  document.querySelector('[data-tab="orders"]').addEventListener('click', () => {
    if (adminUnlocked) renderAdminOrderList();
  });

  let adminSearchDebounceTimer = null;
  document.getElementById('adminProductSearch').addEventListener('input', (e) => {
    adminProductSearchTerm = e.target.value;
    clearTimeout(adminSearchDebounceTimer);
    adminSearchDebounceTimer = setTimeout(() => {
      renderAdminProductList();
    }, 200);
  });

  document.getElementById('toggleArchivedBtn').addEventListener('click', () => {
    const section = document.getElementById('archivedOrdersSection');
    const btn = document.getElementById('toggleArchivedBtn');
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? '🗂 Masquer les commandes archivées' : '🗂 Voir les commandes archivées';
    if (isHidden) renderArchivedOrderList();
  });
}

/* ---------- Init ---------- */
function init() {
  setupSearch();
  setupAdminLock();
  setupAdminTabs();
  setupAddCategory();
  setupSettingsSave();
  setupThemeControls();
  setupLogoUpload();
  setupImageUpload();
  setupImageCropper();
  setupProductFormSave();
  setupUnitToggle();
  setupCheckout();
  setupGeneralUI();
  loadAllData();
}

document.addEventListener('DOMContentLoaded', init);
