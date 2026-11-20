/* =========================================================
   NØRTE · Capa de datos
   Orden de carga:
   1) API PHP (/api/*.php)  -> hosting real (Hostinger / HostGator)
   2) localStorage           -> pruebas locales / respaldo
   3) JSON estático (/data)  -> servidor sin PHP (ej. Live Server)
   4) Semilla embebida       -> abrir index.html con doble clic (file://)
   ========================================================= */
(function (global) {
  'use strict';

  var KEYS = {
    productos: 'norte_productos',
    config: 'norte_config',
    sync: 'norte_sync',
    override: 'norte_override',
    cacheProductos: 'norte_cache_productos',
    cacheConfig: 'norte_cache_config'
  };

  var ENDPOINTS = {
    productos: { api: 'api/productos.php', json: 'data/productos.json' },
    config: { api: 'api/config.php', json: 'data/config.json' }
  };

  var SEED = global.NORTE_SEED || { productos: [], config: {} };
  var ES_SERVIDOR = global.location.protocol === 'http:' || global.location.protocol === 'https:';
  /* GitHub Pages no ejecuta PHP: se omite la API y se lee el JSON directamente */
  var ES_GITHUB_PAGES = /\.github\.io$/i.test(global.location.hostname);

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function leerLS(clave) {
    try {
      var raw = global.localStorage.getItem(clave);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function guardarLS(clave, valor) {
    try {
      global.localStorage.setItem(clave, JSON.stringify(valor));
      return true;
    } catch (e) {
      return false;
    }
  }

  function pedirJSON(url) {
    var controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var temporizador = controlador ? setTimeout(function () { controlador.abort(); }, 6000) : null;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return fetch(url + sep + 't=' + Date.now(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controlador ? controlador.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).finally(function () {
      if (temporizador) clearTimeout(temporizador);
    });
  }

  var validar = {
    productos: function (d) { return Array.isArray(d); },
    config: function (d) { return !!d && typeof d === 'object' && !Array.isArray(d); }
  };

  function numero(v) {
    return Math.max(0, Math.round(Number(v) || 0));
  }

  /*
   * Convierte el producto guardado al formato que pinta la tienda.
   * Formato del panel: precio (normal) + precioOferta + enPromocion.
   * Formato antiguo:   precio (final) + precioAnterior (tachado).
   */
  function normalizarProducto(p) {
    var imagenes = Array.isArray(p.imagenes) ? p.imagenes.filter(Boolean).slice(0, 3) : [];
    while (imagenes.length < 3 && imagenes.length > 0) imagenes.push(imagenes[0]);

    var precio = numero(p.precio);
    var precioAnterior = 0;
    var formatoPanel = Object.prototype.hasOwnProperty.call(p, 'enPromocion') ||
      Object.prototype.hasOwnProperty.call(p, 'precioOferta');

    if (formatoPanel) {
      var oferta = numero(p.precioOferta);
      if (p.enPromocion && oferta > 0 && oferta < precio) {
        precioAnterior = precio;
        precio = oferta;
      }
    } else {
      precioAnterior = numero(p.precioAnterior);
    }

    return {
      id: String(p.id || ''),
      nombre: String(p.nombre || 'Producto'),
      categoria: String(p.categoria || 'camisetas'),
      descripcion: String(p.descripcion || ''),
      precio: precio,
      precioAnterior: precioAnterior > precio ? precioAnterior : 0,
      imagenes: imagenes,
      tallas: Array.isArray(p.tallas) ? p.tallas.map(String) : [],
      nuevo: !!p.nuevo,
      masVendido: !!p.masVendido,
      agotado: !!p.agotado,
      activo: p.activo !== false
    };
  }

  function normalizarConfig(c) {
    var base = clonar(SEED.config || {});
    var cfg = Object.assign({}, base, c || {});
    cfg.hero = Object.assign({}, base.hero || {}, (c && c.hero) || {});
    cfg.anuncios = Array.isArray(cfg.anuncios) ? cfg.anuncios.filter(Boolean) : [];
    cfg.whatsapp = String(cfg.whatsapp || '').replace(/\D/g, '');
    cfg.envioGratisDesde = Number(cfg.envioGratisDesde) || 0;
    cfg.costoEnvio = Number(cfg.costoEnvio) || 0;
    return cfg;
  }

  /* Intenta cada fuente en orden y devuelve la primera válida */
  function cargarRecurso(tipo) {
    var ok = validar[tipo];
    var ep = ENDPOINTS[tipo];
    var claveLocal = tipo === 'productos' ? KEYS.productos : KEYS.config;
    var claveCache = tipo === 'productos' ? KEYS.cacheProductos : KEYS.cacheConfig;

    function desdeLocal() {
      var local = leerLS(claveLocal);
      if (ok(local)) return Promise.resolve({ datos: local, fuente: 'localStorage' });
      if (!ES_SERVIDOR) return Promise.reject(new Error('sin servidor'));
      return pedirJSON(ep.json).then(function (d) {
        if (!ok(d)) throw new Error('JSON inválido');
        return { datos: d, fuente: 'json' };
      });
    }

    function desdeRespaldo() {
      var cache = leerLS(claveCache);
      if (ok(cache)) return { datos: cache, fuente: 'cache' };
      return { datos: clonar(SEED[tipo]), fuente: 'semilla' };
    }

    /*
     * Recién publicado desde el panel (modo GitHub): GitHub Pages tarda ~1 min
     * en desplegar, así que el navegador del administrador ve los cambios ya.
     */
    var publicado = leerLS(KEYS.override);
    if (publicado && publicado.hasta > Date.now() && ok(publicado[tipo])) {
      return Promise.resolve({ datos: publicado[tipo], fuente: 'publicando' });
    }

    var intentoApi = ES_SERVIDOR && !ES_GITHUB_PAGES
      ? pedirJSON(ep.api).then(function (d) {
          if (!ok(d)) throw new Error('API inválida');
          guardarLS(claveCache, d);
          return { datos: d, fuente: 'servidor' };
        })
      : Promise.reject(new Error('file://'));

    return intentoApi
      .catch(desdeLocal)
      .catch(desdeRespaldo);
  }

  function cargar() {
    return Promise.all([cargarRecurso('productos'), cargarRecurso('config')]).then(function (r) {
      return {
        productos: r[0].datos.map(normalizarProducto).filter(function (p) { return p.id && p.activo; }),
        config: normalizarConfig(r[1].datos),
        fuente: { productos: r[0].fuente, config: r[1].fuente }
      };
    });
  }

  global.NorteData = {
    cargar: cargar,
    KEYS: KEYS,
    ENDPOINTS: ENDPOINTS,
    leerLS: leerLS,
    guardarLS: guardarLS,
    pedirJSON: pedirJSON,
    esServidor: ES_SERVIDOR,
    esGithubPages: ES_GITHUB_PAGES,
    semilla: function () { return clonar(SEED); },
    normalizarProducto: normalizarProducto,
    normalizarConfig: normalizarConfig
  };
})(window);
