/* =========================================================
   NØRTE · Tienda pública
   Renderizado dinámico, filtros, modal de producto,
   carrito lateral y checkout por WhatsApp.
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Constantes ---------- */
  const CATEGORIAS = {
    todo: 'Todo',
    camisetas: 'Camisetas',
    pantalones: 'Pantalones',
    calzado: 'Calzado',
    gorras: 'Gorras Deportivas'
  };

  const TALLAS_POR_CATEGORIA = {
    camisetas: ['S', 'M', 'L', 'XL'],
    pantalones: ['S', 'M', 'L', 'XL'],
    calzado: ['38', '39', '40', '41', '42'],
    gorras: ['Única']
  };

  const LS_CARRITO = 'norte_carrito';
  const LS_CLIENTE = 'norte_cliente';
  const MAX_CANT = 10;

  const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#1c1c1f"/>' +
    '<path d="M150 310V190h30l50 66v-66h30v120h-30l-50-66v66z" fill="#2c2c31"/></svg>'
  );

  /* ---------- Estado ---------- */
  const state = {
    productos: [],
    config: { anuncios: [], hero: {}, whatsapp: '', envioGratisDesde: 0, costoEnvio: 0, marca: 'NØRTE' },
    filtro: 'todo',
    busqueda: '',
    orden: 'destacados',
    carrito: [],
    ultimoAgregado: null,
    urlWhatsapp: '',
    modal: { producto: null, img: 0, talla: null, cant: 1 }
  };

  /* ---------- Utilidades ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const miles = (n) => String(Math.round(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cop = (n) => '$' + miles(n) + ' COP';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  const icono = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

  const descuento = (p) =>
    p.precioAnterior > p.precio && p.precio > 0 ? Math.round((1 - p.precio / p.precioAnterior) * 100) : 0;

  const tallasDe = (p) => (p.tallas && p.tallas.length ? p.tallas : TALLAS_POR_CATEGORIA[p.categoria] || ['Única']);

  const nombreCategoria = (cat) => CATEGORIAS[cat] || cat;

  const porId = (id) => state.productos.find((p) => p.id === id);

  const imagenesDe = (p) => (p.imagenes && p.imagenes.length ? p.imagenes : [PLACEHOLDER]);

  const lsLeer = (clave, defecto) => {
    try {
      const raw = localStorage.getItem(clave);
      return raw ? JSON.parse(raw) : defecto;
    } catch (e) {
      return defecto;
    }
  };

  const lsGuardar = (clave, valor) => {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) {
      /* almacenamiento no disponible (modo privado): se ignora */
    }
  };

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const hayHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Plantillas ---------- */
  function badgesHTML(p) {
    const d = descuento(p);
    if (p.agotado) return '<span class="badge badge--out">Agotado</span>';
    return [
      p.nuevo ? '<span class="badge badge--drop">Drop</span>' : '',
      p.masVendido ? '<span class="badge badge--hot">Hot</span>' : '',
      d ? `<span class="badge badge--sale">-${d}%</span>` : ''
    ].join('');
  }

  function precioHTML(p, clase = 'price') {
    const d = descuento(p);
    return `<div class="${clase}${d ? ' price--sale' : ''}">` +
      (d ? `<s>${cop(p.precioAnterior)}</s>` : '') +
      `<strong>${cop(p.precio)}</strong>` +
      (d ? `<span class="price__off">-${d}%</span>` : '') +
      '</div>';
  }

  function tarjetaHTML(p, i) {
    const imgs = imagenesDe(p);
    const id = esc(p.id);
    const nombre = esc(p.nombre);
    return `
      <article class="card${p.agotado ? ' is-out' : ''}" style="--i:${i % 8}">
        <div class="card__visual">
          <button class="card__media" type="button" data-open="${id}" aria-label="Ver ${nombre}">
            <img src="${esc(imgs[0])}" alt="${nombre}" loading="lazy" decoding="async" width="400" height="500">
            <img class="card__alt" src="${esc(imgs[1] || imgs[0])}" alt="" aria-hidden="true" loading="lazy" decoding="async" width="400" height="500">
            <span class="card__badges">${badgesHTML(p)}</span>
          </button>
          <button class="card__add" type="button" data-open="${id}" aria-label="Elegir talla de ${nombre}">${icono('i-plus')}</button>
        </div>
        <div class="card__body">
          <p class="card__cat">${esc(nombreCategoria(p.categoria))}</p>
          <h3 class="card__title"><button type="button" data-open="${id}">${nombre}</button></h3>
          ${precioHTML(p)}
        </div>
      </article>`;
  }

  function skeletonHTML(n) {
    return Array.from({ length: n }, () =>
      '<div class="card skeleton" aria-hidden="true"><div class="card__media"></div>' +
      '<div class="sk-line"></div><div class="sk-line sk-line--short"></div></div>'
    ).join('');
  }

  /* ---------- Configuración (anuncios, hero, envío) ---------- */
  function renderAnuncios() {
    const barra = $('#announce');
    const pista = $('#announceTrack');
    const lista = state.config.anuncios || [];
    if (!lista.length) {
      barra.hidden = true;
      return;
    }
    barra.hidden = false;
    let set = lista.slice();
    while (set.length < 4) set = set.concat(lista);
    const items = (oculto) => set
      .map((t) => `<span class="announce__item"${oculto ? ' aria-hidden="true"' : ''}>${esc(t)}</span>`)
      .join('');
    pista.innerHTML = items(false) + items(true);
    const caracteres = set.join('').length;
    pista.style.setProperty('--marquee-dur', Math.max(18, Math.round(caracteres * 0.18)) + 's');
  }

  function renderConfig() {
    const c = state.config;
    const h = c.hero || {};
    renderAnuncios();

    if (h.etiqueta) $('#heroTagText').textContent = h.etiqueta;
    if (h.titulo) $('#heroTitleText').textContent = h.titulo;
    if (h.subtitulo) $('#heroSub').textContent = h.subtitulo;
    if (h.cta) $('#heroCtaText').textContent = h.cta;
    if (h.imagen && $('#heroImg').getAttribute('src') !== h.imagen) $('#heroImg').src = h.imagen;

    $('#perkShipping').textContent = c.envioGratisDesde > 0
      ? `Gratis desde ${cop(c.envioGratisDesde)}`
      : (c.costoEnvio > 0 ? `Tarifa fija de ${cop(c.costoEnvio)}` : 'Envío gratis en todos los pedidos');

    const wa = $('#footerWa');
    if (c.whatsapp) wa.href = `https://wa.me/${c.whatsapp}`;
    else wa.hidden = true;

    if (c.marca) document.title = `${c.marca} · Streetwear Drops Colombia`;
  }

  /* ---------- Secciones destacadas ---------- */
  function renderRiel(idRiel, lista) {
    const riel = $('#' + idRiel);
    const seccion = riel.closest('section');
    seccion.hidden = lista.length === 0;
    riel.innerHTML = lista.map(tarjetaHTML).join('');
  }

  function renderSecciones() {
    const ps = state.productos;
    renderRiel('railDrops', ps.filter((p) => p.nuevo));
    renderRiel('railTop', ps.filter((p) => p.masVendido));
    renderRiel('railSale', ps.filter((p) => descuento(p) > 0).sort((a, b) => descuento(b) - descuento(a)));
  }

  /* ---------- Catálogo + filtros ---------- */
  function coincideBusqueda(p, q) {
    if (!q) return true;
    return normalizar(`${p.nombre} ${p.descripcion} ${nombreCategoria(p.categoria)}`).includes(q);
  }

  function ordenar(lista) {
    const ordenada = ordenarPorCriterio(lista);
    /* Los agotados siempre al final */
    return ordenada.filter((p) => !p.agotado).concat(ordenada.filter((p) => p.agotado));
  }

  function ordenarPorCriterio(lista) {
    const copia = lista.slice();
    switch (state.orden) {
      case 'precio-asc':
        return copia.sort((a, b) => a.precio - b.precio);
      case 'precio-desc':
        return copia.sort((a, b) => b.precio - a.precio);
      case 'descuento':
        return copia.sort((a, b) => descuento(b) - descuento(a));
      default: {
        const peso = (p) => (p.nuevo ? 2 : 0) + (p.masVendido ? 1 : 0);
        return copia
          .map((p, i) => ({ p, i }))
          .sort((a, b) => peso(b.p) - peso(a.p) || a.i - b.i)
          .map((x) => x.p);
      }
    }
  }

  function renderCatalogo() {
    const q = normalizar(state.busqueda);
    const porBusqueda = state.productos.filter((p) => coincideBusqueda(p, q));
    const filtrados = state.filtro === 'todo' ? porBusqueda : porBusqueda.filter((p) => p.categoria === state.filtro);
    const lista = ordenar(filtrados);

    $$('#filters .chip').forEach((chip) => {
      const cat = chip.dataset.cat;
      const n = cat === 'todo' ? porBusqueda.length : porBusqueda.filter((p) => p.categoria === cat).length;
      const activo = cat === state.filtro;
      chip.innerHTML = `${esc(nombreCategoria(cat))} <span class="chip__n">${n}</span>`;
      chip.classList.toggle('is-active', activo);
      chip.setAttribute('aria-selected', String(activo));
    });

    $('#catalogGrid').innerHTML = lista.map(tarjetaHTML).join('');
    $('#catalogEmpty').hidden = lista.length > 0;
    $('#catalogCount').textContent = `${lista.length} ${lista.length === 1 ? 'producto' : 'productos'}`;

    const pill = $('#searchPill');
    pill.hidden = !state.busqueda.trim();
    $('#searchPillText').textContent = state.busqueda.trim();
  }

  function setFiltro(cat) {
    if (!CATEGORIAS[cat]) return;
    state.filtro = cat;
    renderCatalogo();
  }

  function setBusqueda(texto) {
    state.busqueda = texto;
    renderCatalogo();
  }

  function limpiarBusqueda() {
    $('#searchInput').value = '';
    setBusqueda('');
  }

  /* ---------- Bloqueo de scroll y foco ---------- */
  function actualizarBloqueoScroll() {
    const abierto = $('#productModal').classList.contains('is-open') || $('#cartDrawer').classList.contains('is-open');
    document.body.classList.toggle('no-scroll', abierto);
  }

  function atraparFoco(e, contenedor) {
    if (e.key !== 'Tab') return;
    const focusables = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', contenedor)
      .filter((el) => el.offsetParent !== null && !el.closest('[hidden]'));
    if (!focusables.length) return;
    const primero = focusables[0];
    const ultimo = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === primero || !contenedor.contains(document.activeElement))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }

  /* ---------- Modal de producto ---------- */
  let focoPrevioModal = null;

  function abrirProducto(id) {
    const p = porId(id);
    if (!p) return;
    const tallas = tallasDe(p);
    state.modal = { producto: p, img: 0, talla: tallas.length === 1 ? tallas[0] : null, cant: 1 };
    renderModal();

    const modal = $('#productModal');
    const panel = $('.modal__panel', modal);
    focoPrevioModal = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    panel.scrollTop = 0;
    actualizarBloqueoScroll();
    setTimeout(() => panel.focus({ preventScroll: true }), 60);
  }

  function cerrarModal() {
    const modal = $('#productModal');
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    actualizarBloqueoScroll();
    if (focoPrevioModal && document.contains(focoPrevioModal)) focoPrevioModal.focus({ preventScroll: true });
  }

  function renderModal() {
    const { producto: p, img, talla, cant } = state.modal;
    const imgs = imagenesDe(p);
    const tallas = tallasDe(p);
    const d = descuento(p);
    const nombre = esc(p.nombre);

    $('#pmBody').innerHTML = `
      <div class="pm">
        <div class="pm__gallery">
          <div class="pm__stage" id="pmStage">
            <img id="pmMain" src="${esc(imgs[img])}" alt="${nombre} · foto ${img + 1}" draggable="false" width="600" height="750">
            ${imgs.length > 1 ? `
              <button class="pm__arrow pm__arrow--prev" type="button" data-step="-1" aria-label="Foto anterior">${icono('i-chev-l')}</button>
              <button class="pm__arrow pm__arrow--next" type="button" data-step="1" aria-label="Foto siguiente">${icono('i-chev-r')}</button>` : ''}
            <span class="pm__counter" id="pmCounter">${img + 1} / ${imgs.length}</span>
            <span class="pm__hint">${hayHover() ? 'Pasa el cursor para zoom' : 'Toca para zoom · desliza'}</span>
          </div>
          <div class="pm__thumbs">
            ${imgs.map((src, i) => `
              <button class="pm__thumb${i === img ? ' is-active' : ''}" type="button" data-thumb="${i}" aria-label="Ver foto ${i + 1}" aria-pressed="${i === img}">
                <img src="${esc(src)}" alt="" loading="lazy" width="150" height="150">
              </button>`).join('')}
          </div>
        </div>

        <div class="pm__info">
          <div class="pm__badges">${badgesHTML(p)}</div>
          <p class="pm__cat">${esc(nombreCategoria(p.categoria))}</p>
          <h2 class="pm__title" id="pmTitle">${nombre}</h2>
          ${precioHTML(p, 'pm__price')}
          ${d ? `<p class="pm__save">Ahorras ${cop(p.precioAnterior - p.precio)}</p>` : ''}
          <p class="pm__desc">${esc(p.descripcion)}</p>

          <div class="pm__block">
            <div class="pm__label">Talla <span id="pmSizeHint">${p.agotado ? 'Sin unidades disponibles' : talla ? 'Seleccionada: ' + esc(talla) : 'Elige tu talla'}</span></div>
            <div class="sizes" id="pmSizes" role="radiogroup" aria-label="Talla">
              ${tallas.map((t) => `<button class="size${t === talla && !p.agotado ? ' is-active' : ''}" type="button" role="radio" aria-checked="${t === talla}" data-size="${esc(t)}"${p.agotado ? ' disabled' : ''}>${esc(t)}</button>`).join('')}
            </div>
          </div>

          ${p.agotado ? `
          <div class="pm__actions">
            <button class="btn btn--block btn--soldout" type="button" disabled>AGOTADO · VUELVE PRONTO</button>
          </div>` : `
          <div class="pm__actions">
            <div class="qty" role="group" aria-label="Cantidad">
              <button type="button" data-qty="-1" aria-label="Restar una unidad"${cant <= 1 ? ' disabled' : ''}>${icono('i-minus')}</button>
              <output id="pmQty" aria-live="polite">${cant}</output>
              <button type="button" data-qty="1" aria-label="Sumar una unidad"${cant >= MAX_CANT ? ' disabled' : ''}>${icono('i-plus')}</button>
            </div>
            <button class="btn btn--primary" type="button" id="pmAdd">
              <span id="pmAddText">Agregar · ${cop(p.precio * cant)}</span>
            </button>
          </div>`}

          <ul class="pm__perks">
            <li>${icono('i-truck')} ${state.config.envioGratisDesde > 0 ? `Envío gratis desde ${cop(state.config.envioGratisDesde)}` : 'Envíos a todo Colombia'}</li>
            <li>${icono('i-swap')} 15 días para cambios de talla</li>
            <li>${icono('i-wa')} Confirmamos tu pedido por WhatsApp</li>
          </ul>
        </div>
      </div>`;

    activarZoom();
  }

  function cambiarImagen(indice) {
    const p = state.modal.producto;
    if (!p) return;
    const imgs = imagenesDe(p);
    const n = imgs.length;
    const i = ((indice % n) + n) % n;
    if (i === state.modal.img) return;
    state.modal.img = i;

    const stage = $('#pmStage');
    const main = $('#pmMain');
    stage.classList.remove('is-zoom');
    main.classList.add('is-fading');
    setTimeout(() => {
      const mostrar = () => main.classList.remove('is-fading');
      main.onload = mostrar;
      main.onerror = mostrar;
      main.src = imgs[i];
      main.alt = `${p.nombre} · foto ${i + 1}`;
      if (main.complete) mostrar();
    }, 160);

    $('#pmCounter').textContent = `${i + 1} / ${n}`;
    $$('.pm__thumb').forEach((t, k) => {
      t.classList.toggle('is-active', k === i);
      t.setAttribute('aria-pressed', String(k === i));
    });
  }

  function activarZoom() {
    const stage = $('#pmStage');
    const img = $('#pmMain');
    if (!stage || !img) return;

    const fijarOrigen = (x, y) => {
      const r = stage.getBoundingClientRect();
      const px = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
      const py = Math.min(100, Math.max(0, ((y - r.top) / r.height) * 100));
      img.style.transformOrigin = `${px.toFixed(1)}% ${py.toFixed(1)}%`;
    };

    if (hayHover()) {
      stage.addEventListener('mousemove', (e) => {
        const sobreFlecha = !!e.target.closest('.pm__arrow');
        stage.classList.toggle('is-zoom', !sobreFlecha);
        if (!sobreFlecha) fijarOrigen(e.clientX, e.clientY);
      });
      stage.addEventListener('mouseleave', () => stage.classList.remove('is-zoom'));
      return;
    }

    /* Táctil: tocar = zoom, arrastrar con zoom = mover, deslizar sin zoom = cambiar foto */
    let inicioX = 0;
    let inicioY = 0;
    let desplazo = false;

    stage.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      inicioX = t.clientX;
      inicioY = t.clientY;
      desplazo = false;
    }, { passive: true });

    stage.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (stage.classList.contains('is-zoom')) {
        e.preventDefault();
        fijarOrigen(t.clientX, t.clientY);
      } else if (Math.abs(t.clientX - inicioX) > 10 || Math.abs(t.clientY - inicioY) > 10) {
        desplazo = true;
      }
    }, { passive: false });

    stage.addEventListener('touchend', (e) => {
      if (stage.classList.contains('is-zoom')) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - inicioX;
      const dy = t.clientY - inicioY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        cambiarImagen(state.modal.img + (dx < 0 ? 1 : -1));
      }
    });

    stage.addEventListener('click', (e) => {
      if (e.target.closest('.pm__arrow') || desplazo) return;
      fijarOrigen(e.clientX, e.clientY);
      stage.classList.toggle('is-zoom');
    });
  }

  function seleccionarTalla(talla) {
    state.modal.talla = talla;
    $$('#pmSizes .size').forEach((b) => {
      const activo = b.dataset.size === talla;
      b.classList.toggle('is-active', activo);
      b.setAttribute('aria-checked', String(activo));
    });
    const hint = $('#pmSizeHint');
    hint.textContent = 'Seleccionada: ' + talla;
    hint.classList.remove('is-error');
  }

  function cambiarCantidadModal(delta) {
    const m = state.modal;
    m.cant = Math.min(MAX_CANT, Math.max(1, m.cant + delta));
    $('#pmQty').textContent = m.cant;
    $('#pmAddText').textContent = `Agregar · ${cop(m.producto.precio * m.cant)}`;
    $('[data-qty="-1"]', $('#pmBody')).disabled = m.cant <= 1;
    $('[data-qty="1"]', $('#pmBody')).disabled = m.cant >= MAX_CANT;
  }

  function agregarDesdeModal() {
    const { producto: p, talla, cant } = state.modal;
    if (!p || p.agotado) return;
    if (!talla) {
      const hint = $('#pmSizeHint');
      hint.textContent = 'Selecciona una talla primero';
      hint.classList.add('is-error');
      const sizes = $('#pmSizes');
      sizes.classList.remove('shake');
      void sizes.offsetWidth;
      sizes.classList.add('shake');
      return;
    }
    agregarAlCarrito(p.id, talla, cant);
    cerrarModal();
    toast(`${esc(p.nombre)}<small>Talla ${esc(talla)} · ${cant} ${cant === 1 ? 'unidad' : 'unidades'}</small>`, {
      imagen: imagenesDe(p)[0],
      accion: 'Ver carrito',
      alAccion: abrirCarrito
    });
  }

  /* ---------- Carrito ---------- */
  function cargarCarrito() {
    const guardado = lsLeer(LS_CARRITO, []);
    if (!Array.isArray(guardado)) return [];
    return guardado
      .filter((i) => i && i.id && i.talla && Number(i.cant) > 0)
      .map((i) => ({
        key: `${i.id}|${i.talla}`,
        id: String(i.id),
        talla: String(i.talla),
        cant: Math.min(MAX_CANT, Math.max(1, Math.round(Number(i.cant))))
      }));
  }

  function guardarCarrito() {
    lsGuardar(LS_CARRITO, state.carrito.map(({ id, talla, cant }) => ({ id, talla, cant })));
  }

  function lineasCarrito() {
    return state.carrito
      .map((item) => ({ ...item, producto: porId(item.id) }))
      .filter((l) => l.producto && !l.producto.agotado);
  }

  function totales() {
    const subtotal = lineasCarrito().reduce((s, l) => s + l.producto.precio * l.cant, 0);
    const { envioGratisDesde, costoEnvio } = state.config;
    const gratis = envioGratisDesde > 0 && subtotal >= envioGratisDesde;
    const envio = subtotal === 0 || gratis ? 0 : costoEnvio;
    const unidades = state.carrito.reduce((s, i) => s + i.cant, 0);
    return { subtotal, envio, total: subtotal + envio, unidades };
  }

  function agregarAlCarrito(id, talla, cant) {
    const key = `${id}|${talla}`;
    const existente = state.carrito.find((i) => i.key === key);
    if (existente) existente.cant = Math.min(MAX_CANT, existente.cant + cant);
    else state.carrito.push({ key, id, talla, cant: Math.min(MAX_CANT, cant) });
    state.ultimoAgregado = key;
    guardarCarrito();
    renderCarrito();
    const btn = $('#cartOpen');
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  }

  function cambiarCantidadItem(key, delta) {
    const item = state.carrito.find((i) => i.key === key);
    if (!item) return;
    item.cant = Math.min(MAX_CANT, Math.max(1, item.cant + delta));
    state.ultimoAgregado = null;
    guardarCarrito();
    renderCarrito();
  }

  function eliminarItem(key) {
    const quitar = () => {
      state.carrito = state.carrito.filter((i) => i.key !== key);
      state.ultimoAgregado = null;
      guardarCarrito();
      renderCarrito();
    };
    const li = $$('#cartList .cart-item').find((el) => el.dataset.key === key);
    if (!li || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      quitar();
      return;
    }
    li.classList.add('is-removing');
    setTimeout(quitar, 280);
  }

  function vaciarCarrito() {
    state.carrito = [];
    guardarCarrito();
    renderCarrito();
  }

  function envioHTML(t) {
    if (t.subtotal === 0) return '—';
    return t.envio === 0 ? '<span class="is-free">GRATIS</span>' : cop(t.envio);
  }

  function renderCarrito() {
    const lineas = lineasCarrito();
    const t = totales();
    const vacio = lineas.length === 0;

    const contador = $('#cartCount');
    contador.textContent = t.unidades > 99 ? '99+' : String(t.unidades);
    contador.classList.toggle('has-items', t.unidades > 0);
    $('#cartOpen').setAttribute('aria-label', `Abrir carrito (${t.unidades} ${t.unidades === 1 ? 'producto' : 'productos'})`);
    $('#drawerCount').textContent = `(${t.unidades})`;

    $('#cartEmpty').hidden = !vacio;
    $('#cartFoot').hidden = vacio;
    $('#cartList').hidden = vacio;

    /* Barra de envío gratis */
    const meta = state.config.envioGratisDesde;
    const meter = $('#shipMeter');
    meter.hidden = vacio || !(meta > 0);
    if (meta > 0) {
      const falta = meta - t.subtotal;
      $('#shipText').innerHTML = falta > 0
        ? `Te faltan <strong>${cop(falta)}</strong> para el envío gratis`
        : '¡Desbloqueaste el <strong>envío GRATIS</strong>!';
      $('#shipBar').style.width = Math.min(100, (t.subtotal / meta) * 100) + '%';
    }

    $('#cartList').innerHTML = lineas.map((l) => {
      const p = l.producto;
      const key = esc(l.key);
      return `
        <li class="cart-item${l.key === state.ultimoAgregado ? ' is-new' : ''}" data-key="${key}">
          <button class="cart-item__img" type="button" data-open="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
            <img src="${esc(imagenesDe(p)[0])}" alt="" loading="lazy" width="78" height="98">
          </button>
          <div>
            <div class="cart-item__top">
              <div>
                <p class="cart-item__name">${esc(p.nombre)}</p>
                <p class="cart-item__meta">Talla: <b>${esc(l.talla)}</b> · ${cop(p.precio)} c/u</p>
              </div>
              <button class="cart-item__remove" type="button" data-remove aria-label="Eliminar ${esc(p.nombre)} talla ${esc(l.talla)}">${icono('i-trash')}</button>
            </div>
            <div class="cart-item__bottom">
              <div class="qty qty--sm" role="group" aria-label="Cantidad">
                <button type="button" data-dec aria-label="Restar una unidad"${l.cant <= 1 ? ' disabled' : ''}>${icono('i-minus')}</button>
                <output>${l.cant}</output>
                <button type="button" data-inc aria-label="Sumar una unidad"${l.cant >= MAX_CANT ? ' disabled' : ''}>${icono('i-plus')}</button>
              </div>
              <div class="cart-item__price">${cop(p.precio * l.cant)}${l.cant > 1 ? `<small>${l.cant} × ${cop(p.precio)}</small>` : ''}</div>
            </div>
          </div>
        </li>`;
    }).join('');

    $('#tSubtotal').textContent = cop(t.subtotal);
    $('#tShipping').innerHTML = envioHTML(t);
    $('#tTotal').textContent = cop(t.total);
    $('#cSubtotal').textContent = cop(t.subtotal);
    $('#cShipping').innerHTML = envioHTML(t);
    $('#cTotal').textContent = cop(t.total);

    if (vacio && !$('#viewCheckout').hidden) setVista('cart');
  }

  /* ---------- Drawer ---------- */
  let focoPrevioDrawer = null;

  function setVista(vista) {
    $('#viewCart').hidden = vista !== 'cart';
    $('#viewCheckout').hidden = vista !== 'checkout';
    $('#viewDone').hidden = vista !== 'done';
    $('#drawerTitle').firstChild.textContent = vista === 'checkout' ? 'Datos de envío ' : vista === 'done' ? 'Pedido ' : 'Tu carrito ';
  }

  function abrirCarrito() {
    const drawer = $('#cartDrawer');
    if (drawer.classList.contains('is-open')) return;
    focoPrevioDrawer = document.activeElement;
    if ($('#viewDone').hidden === false && state.carrito.length) setVista('cart');
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    $('#drawerBackdrop').classList.add('is-open');
    actualizarBloqueoScroll();
    setTimeout(() => drawer.focus({ preventScroll: true }), 60);
  }

  function cerrarCarrito() {
    const drawer = $('#cartDrawer');
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    $('#drawerBackdrop').classList.remove('is-open');
    actualizarBloqueoScroll();
    if (focoPrevioDrawer && document.contains(focoPrevioDrawer)) focoPrevioDrawer.focus({ preventScroll: true });
  }

  /* ---------- Checkout WhatsApp ---------- */
  const REGLAS = {
    nombre: (v) => v.trim().length >= 3 || 'Escribe tu nombre completo',
    telefono: (v) => /^(\+?57)?3\d{9}$/.test(v.replace(/[\s().-]/g, '')) || 'Ingresa un celular válido de 10 dígitos (ej. 300 123 4567)',
    ciudad: (v) => v.trim().length >= 2 || 'Indica tu ciudad',
    direccion: (v) => v.trim().length >= 5 || 'Escribe la dirección completa de entrega'
  };

  function mostrarErrorCampo(input, mensaje) {
    const campo = input.closest('.field');
    campo.classList.toggle('is-invalid', !!mensaje);
    $('.field__error', campo).textContent = mensaje || '';
    input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }

  function validarFormulario(form) {
    let primero = null;
    Object.keys(REGLAS).forEach((nombre) => {
      const input = form.elements[nombre];
      const r = REGLAS[nombre](input.value);
      const mensaje = r === true ? '' : r;
      mostrarErrorCampo(input, mensaje);
      if (mensaje && !primero) primero = input;
    });
    if (primero) primero.focus();
    return !primero;
  }

  function datosCliente(form) {
    const v = (n) => form.elements[n].value.trim();
    return {
      nombre: v('nombre'),
      telefono: v('telefono'),
      ciudad: v('ciudad'),
      barrio: v('barrio'),
      direccion: v('direccion'),
      pago: v('pago'),
      notas: v('notas')
    };
  }

  function precargarCliente() {
    const c = lsLeer(LS_CLIENTE, null);
    if (!c || typeof c !== 'object') return;
    const form = $('#checkoutForm');
    ['nombre', 'telefono', 'ciudad', 'barrio', 'direccion', 'pago'].forEach((n) => {
      if (c[n] && form.elements[n]) form.elements[n].value = c[n];
    });
  }

  function construirMensaje(cliente) {
    const lineas = lineasCarrito();
    const t = totales();
    const marca = state.config.marca || 'NØRTE';
    const sep = '------------------------------';
    const m = [];

    m.push(`🛒 *NUEVO PEDIDO · ${marca}*`);
    m.push('');
    lineas.forEach((l, i) => {
      m.push(`*${i + 1}. ${l.producto.nombre}*`);
      m.push(`   Ref: ${l.producto.id} · Talla: ${l.talla} · Cant: ${l.cant}`);
      m.push(`   ${cop(l.producto.precio)} c/u = ${cop(l.producto.precio * l.cant)}`);
    });
    m.push(sep);
    m.push(`Productos (${t.unidades} und): ${cop(t.subtotal)}`);
    m.push(`Envío: ${t.envio === 0 ? 'GRATIS' : cop(t.envio)}`);
    m.push(`*TOTAL A PAGAR: ${cop(t.total)}*`);
    m.push('');
    m.push('📦 *DATOS DE ENVÍO*');
    m.push(`Nombre: ${cliente.nombre}`);
    m.push(`Celular: ${cliente.telefono}`);
    m.push(`Ciudad: ${cliente.ciudad}`);
    if (cliente.barrio) m.push(`Barrio: ${cliente.barrio}`);
    m.push(`Dirección: ${cliente.direccion}`);
    m.push(`Método de pago: ${cliente.pago}`);
    if (cliente.notas) m.push(`Notas: ${cliente.notas}`);
    m.push('');
    m.push('Quedo atento(a) a la confirmación. ¡Gracias!');
    return m.join('\n');
  }

  function enviarPedido(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!lineasCarrito().length) {
      setVista('cart');
      return;
    }
    if (!validarFormulario(form)) {
      toast('Revisa los datos marcados en rojo', { tipo: 'error' });
      return;
    }
    const cliente = datosCliente(form);
    const { notas, ...persistente } = cliente;
    lsGuardar(LS_CLIENTE, persistente);

    const numero = state.config.whatsapp;
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(construirMensaje(cliente))}`;
    state.urlWhatsapp = url;
    $('#waRetry').href = url;

    const ventana = window.open(url, '_blank');
    if (ventana) ventana.opener = null;
    else window.location.href = url;

    setVista('done');
  }

  /* ---------- Toasts ---------- */
  function toast(html, opciones = {}) {
    const { imagen, accion, alAccion, tipo, duracion = 3400 } = opciones;
    const cont = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (tipo === 'error' ? ' toast--error' : '');
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML =
      (imagen ? `<img src="${esc(imagen)}" alt="">` : '') +
      `<div class="toast__msg">${html}</div>` +
      (accion ? `<button class="toast__action" type="button">${esc(accion)}</button>` : '');

    let temporizador = null;
    const quitar = () => {
      clearTimeout(temporizador);
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 320);
    };

    if (accion && typeof alAccion === 'function') {
      $('.toast__action', el).addEventListener('click', () => {
        alAccion();
        quitar();
      });
    }

    cont.appendChild(el);
    while (cont.children.length > 3) cont.firstElementChild.remove();
    temporizador = setTimeout(quitar, duracion);
  }

  /* ---------- Eventos ---------- */
  function enlazarEventos() {
    /* Imágenes rotas -> placeholder */
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && !t.dataset.fallback) {
        t.dataset.fallback = '1';
        t.src = PLACEHOLDER;
      }
    }, true);

    /* Abrir producto desde cualquier tarjeta */
    document.addEventListener('click', (e) => {
      const disparador = e.target.closest('[data-open]');
      if (!disparador) return;
      e.preventDefault();
      if ($('#cartDrawer').contains(disparador)) cerrarCarrito();
      abrirProducto(disparador.dataset.open);
    });

    /* Header con borde al hacer scroll */
    const header = $('#header');
    const alScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    window.addEventListener('scroll', alScroll, { passive: true });
    alScroll();

    /* Búsqueda */
    const barra = $('#searchBar');
    const input = $('#searchInput');
    const toggle = $('#searchToggle');
    const abrirBusqueda = (abrir) => {
      barra.hidden = !abrir;
      toggle.setAttribute('aria-expanded', String(abrir));
      if (abrir) input.focus();
    };
    toggle.addEventListener('click', () => abrirBusqueda(barra.hidden));
    $('#searchClose').addEventListener('click', () => {
      abrirBusqueda(false);
      limpiarBusqueda();
    });
    const irACatalogo = () => {
      const cat = $('#catalogo');
      const r = cat.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.5 || r.bottom < 120) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    input.addEventListener('input', debounce(() => {
      setBusqueda(input.value);
      if (input.value.trim()) irACatalogo();
    }, 220));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setBusqueda(input.value);
        irACatalogo();
        input.blur();
      }
    });
    $('#searchPillClear').addEventListener('click', limpiarBusqueda);

    /* Filtros y orden */
    $('#filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) setFiltro(chip.dataset.cat);
    });
    $('#sortSelect').addEventListener('change', (e) => {
      state.orden = e.target.value;
      renderCatalogo();
    });
    $('#resetFilters').addEventListener('click', () => {
      state.filtro = 'todo';
      limpiarBusqueda();
    });
    $$('[data-cat-link]').forEach((a) => a.addEventListener('click', () => setFiltro(a.dataset.catLink)));

    /* Flechas de los rieles */
    $$('.rail-nav').forEach((nav) => {
      const riel = $('#' + nav.dataset.rail);
      nav.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dir]');
        if (!b) return;
        riel.scrollBy({ left: Number(b.dataset.dir) * riel.clientWidth * 0.8, behavior: 'smooth' });
      });
    });

    /* Modal */
    const modal = $('#productModal');
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) return cerrarModal();
      const paso = e.target.closest('[data-step]');
      if (paso) return cambiarImagen(state.modal.img + Number(paso.dataset.step));
      const thumb = e.target.closest('[data-thumb]');
      if (thumb) return cambiarImagen(Number(thumb.dataset.thumb));
      const talla = e.target.closest('[data-size]');
      if (talla) return seleccionarTalla(talla.dataset.size);
      const qty = e.target.closest('[data-qty]');
      if (qty) return cambiarCantidadModal(Number(qty.dataset.qty));
      if (e.target.closest('#pmAdd')) return agregarDesdeModal();
      return undefined;
    });
    modal.addEventListener('keydown', (e) => {
      atraparFoco(e, $('.modal__panel', modal));
      if (e.key === 'ArrowRight' && !e.target.matches('input, textarea')) cambiarImagen(state.modal.img + 1);
      if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea')) cambiarImagen(state.modal.img - 1);
    });

    /* Drawer */
    $('#cartOpen').addEventListener('click', abrirCarrito);
    $('#cartClose').addEventListener('click', cerrarCarrito);
    $('#drawerBackdrop').addEventListener('click', cerrarCarrito);
    const drawer = $('#cartDrawer');
    drawer.addEventListener('keydown', (e) => atraparFoco(e, drawer));
    drawer.addEventListener('click', (e) => {
      const item = e.target.closest('.cart-item');
      if (item) {
        const key = item.dataset.key;
        if (e.target.closest('[data-inc]')) return cambiarCantidadItem(key, 1);
        if (e.target.closest('[data-dec]')) return cambiarCantidadItem(key, -1);
        if (e.target.closest('[data-remove]')) return eliminarItem(key);
      }
      const cerrar = e.target.closest('[data-close-drawer]');
      if (cerrar) {
        cerrarCarrito();
        const destino = cerrar.dataset.goto && $(cerrar.dataset.goto);
        if (destino) setTimeout(() => destino.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
      }
      return undefined;
    });

    $('#goCheckout').addEventListener('click', () => {
      setVista('checkout');
      const primero = $$('#checkoutForm input').find((i) => !i.value);
      setTimeout(() => (primero || $('#fNombre')).focus({ preventScroll: true }), 80);
    });
    $('#backToCart').addEventListener('click', () => setVista('cart'));

    const form = $('#checkoutForm');
    form.addEventListener('submit', enviarPedido);
    form.addEventListener('input', (e) => {
      const n = e.target.name;
      if (REGLAS[n] && e.target.closest('.field').classList.contains('is-invalid')) {
        const r = REGLAS[n](e.target.value);
        mostrarErrorCampo(e.target, r === true ? '' : r);
      }
    });

    $('#finishOrder').addEventListener('click', () => {
      vaciarCarrito();
      form.elements.notas.value = '';
      setVista('cart');
      cerrarCarrito();
      toast('¡Gracias por tu pedido! Te escribimos pronto por WhatsApp 🖤');
    });

    /* Teclado global */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#productModal').classList.contains('is-open')) cerrarModal();
      else if ($('#cartDrawer').classList.contains('is-open')) cerrarCarrito();
      else if (!barra.hidden) abrirBusqueda(false);
    });

    /* Sincronizar carrito entre pestañas */
    window.addEventListener('storage', (e) => {
      if (e.key === LS_CARRITO) {
        state.carrito = cargarCarrito();
        renderCarrito();
      }
    });
  }

  /* ---------- Arranque ---------- */
  function pintarCargando() {
    ['railDrops', 'railTop', 'railSale'].forEach((id) => { $('#' + id).innerHTML = skeletonHTML(4); });
    $('#catalogGrid').innerHTML = skeletonHTML(8);
  }

  let ultimaCarga = 0;
  let cargando = null;

  function aplicarDatos({ productos, config, fuente }) {
    state.productos = productos;
    state.config = config;
    ultimaCarga = Date.now();
    document.documentElement.dataset.fuente = fuente.productos;

    /* Quitar del carrito productos eliminados, ocultos o agotados */
    const antes = state.carrito.length;
    state.carrito = state.carrito.filter((i) => {
      const p = porId(i.id);
      return p && !p.agotado;
    });
    if (state.carrito.length !== antes) {
      guardarCarrito();
      if (document.documentElement.dataset.ready === 'true') {
        toast('Actualizamos tu carrito: algunos productos ya no están disponibles', { duracion: 4500 });
      }
    }

    renderConfig();
    renderSecciones();
    renderCatalogo();
    renderCarrito();

    /* Si el modal está abierto, refrescarlo con los datos nuevos */
    if ($('#productModal').classList.contains('is-open') && state.modal.producto) {
      const actualizado = porId(state.modal.producto.id);
      if (!actualizado) {
        cerrarModal();
      } else {
        const tallas = tallasDe(actualizado);
        state.modal.producto = actualizado;
        if (state.modal.img >= imagenesDe(actualizado).length) state.modal.img = 0;
        if (!tallas.includes(state.modal.talla)) state.modal.talla = tallas.length === 1 ? tallas[0] : null;
        renderModal();
      }
    }
  }

  /* Vuelve a leer el catálogo (cambios hechos desde el panel) */
  function recargarDatos() {
    if (cargando) return cargando;
    cargando = window.NorteData.cargar()
      .then(aplicarDatos)
      .catch((err) => console.error('[NØRTE] Error recargando datos', err))
      .finally(() => { cargando = null; });
    return cargando;
  }

  function escucharCambiosDelPanel() {
    const K = window.NorteData.KEYS;
    /* Misma máquina: el panel escribe en localStorage y las pestañas abiertas se actualizan al instante */
    window.addEventListener('storage', (e) => {
      if (e.key === K.productos || e.key === K.config || e.key === K.sync) recargarDatos();
    });
    /* Otros dispositivos: refrescar al volver a la pestaña y cada 60 s mientras esté visible */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - ultimaCarga > 10000) recargarDatos();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && window.NorteData.esServidor) recargarDatos();
    }, 60000);
  }

  function iniciar() {
    $('#year').textContent = new Date().getFullYear();
    pintarCargando();
    enlazarEventos();
    state.carrito = cargarCarrito();

    window.NorteData.cargar()
      .then((datos) => {
        aplicarDatos(datos);
        precargarCliente();
        escucharCambiosDelPanel();
        document.documentElement.dataset.ready = 'true';
      })
      .catch((err) => {
        console.error('[NØRTE] Error cargando datos', err);
        $('#catalogGrid').innerHTML = '';
        $('#catalogCount').textContent = 'Error al cargar';
        toast('No pudimos cargar el catálogo. Recarga la página.', { tipo: 'error', duracion: 6000 });
      });
  }

  /* API mínima para pruebas automatizadas */
  window.NorteTienda = {
    state,
    cop,
    agregarAlCarrito,
    cambiarCantidadItem,
    eliminarItem,
    totales,
    construirMensaje,
    setFiltro,
    setBusqueda,
    abrirProducto,
    cerrarModal,
    recargarDatos
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
