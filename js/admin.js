/* =========================================================
   NØRTE · Panel de administración
   - Modo SERVIDOR (hosting con PHP): sesión PHP + /api/*.php
     escriben /data/productos.json, /data/config.json e /img/productos/
   - Modo LOCAL (sin PHP / abriendo el archivo): los cambios se
     guardan en localStorage y la tienda los lee de ahí.
   ========================================================= */
(() => {
  'use strict';

  const D = window.NorteData;
  const K = D.KEYS;

  /* ---------- Constantes ---------- */
  const CATEGORIAS = {
    camisetas: 'Camisetas',
    pantalones: 'Pantalones',
    calzado: 'Calzado',
    gorras: 'Gorras Deportivas'
  };
  const TALLAS = {
    camisetas: ['S', 'M', 'L', 'XL'],
    pantalones: ['S', 'M', 'L', 'XL'],
    calzado: ['38', '39', '40', '41', '42'],
    gorras: ['Única']
  };
  const CRED_DEFECTO = { usuario: 'admin.norte', clave: 'NorteDrop#2026' };
  const LS_CRED = 'norte_admin_cred';
  const SS_SESION = 'norte_admin_sesion';
  const MAX_IMG_BYTES = 5 * 1024 * 1024;
  const TIPOS_IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_ANUNCIOS = 8;
  const LS_GH = 'norte_github';
  const SS_MODO_LOCAL = 'norte_modo_local';
  const ARCHIVO_CRED_GH = 'data/admin.json';
  const PBKDF2_ITER = 150000;

  /* ---------- Estado ---------- */
  const state = {
    modo: null,
    csrf: '',
    usuario: '',
    porDefecto: false,
    productos: [],
    config: {},
    busqueda: '',
    filtro: 'todo',
    borrador: null,
    original: '',
    editandoId: null,
    guardando: false,
    vistas: {},   /* ruta subida -> dataURL (mientras GitHub Pages despliega la imagen) */
    shas: {}      /* ruta -> sha del archivo en GitHub */
  };

  /* ---------- Utilidades ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const miles = (n) => String(Math.round(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cop = (n) => '$' + miles(n) + ' COP';
  const entero = (v) => Math.max(0, Math.round(Number(v) || 0));
  const clonar = (o) => JSON.parse(JSON.stringify(o));
  const icono = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalizarTexto = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nuevoId = () => 'nrt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  const enPromo = (p) => p.enPromocion && p.precioOferta > 0 && p.precioOferta < p.precio;
  const pctDescuento = (p) => (enPromo(p) ? Math.round((1 - p.precioOferta / p.precio) * 100) : 0);

  function urlImagenValida(s) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(s) ||
      /^img\/productos\/[A-Za-z0-9._-]+\.(jpe?g|png|webp|gif)$/i.test(s) ||
      (state.modo === 'local' && /^data:image\/(jpeg|png|webp|gif);base64,/i.test(s));
  }

  /* SHA-256 (solo para el modo local de pruebas; en el hosting se usa password_hash de PHP) */
  const SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function sha256(texto) {
    const bytes = new TextEncoder().encode(texto);
    const largo = bytes.length;
    const total = (((largo + 9) + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[largo] = 0x80;
    const dv = new DataView(m.buffer);
    const bits = largo * 8;
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rot(e, 6) ^ rot(e, 11) ^ rot(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA_K[t] + w[t]) >>> 0;
        const S0 = rot(a, 2) ^ rot(a, 13) ^ rot(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  /* PBKDF2-SHA256: las credenciales del modo GitHub viven en un repositorio público */
  async function pbkdf2(clave, salHex, iteraciones = PBKDF2_ITER) {
    const enc = new TextEncoder();
    const sal = new Uint8Array(salHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const llave = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' }, llave, 256);
    return Array.from(new Uint8Array(bits), (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* Base64 compatible con UTF-8 (tildes, Ñ, Ø) */
  function bytesABase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const textoABase64 = (t) => bytesABase64(new TextEncoder().encode(t));
  function base64ATexto(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* Imagen que se muestra en el panel (la subida reciente aún no está desplegada) */
  const vista = (src) => state.vistas[src] || src;

  function salAleatoria() {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- Modelo de producto en el panel ---------- */
  function normalizarProductoAdmin(p) {
    p = p || {};
    const legado = !('enPromocion' in p) && !('precioOferta' in p) && Number(p.precioAnterior) > Number(p.precio);
    const categoria = CATEGORIAS[p.categoria] ? p.categoria : 'camisetas';
    const imagenes = Array.isArray(p.imagenes) ? p.imagenes.slice(0, 3).map((s) => String(s || '')) : [];
    while (imagenes.length < 3) imagenes.push('');
    return {
      id: String(p.id || nuevoId()),
      nombre: String(p.nombre || ''),
      categoria,
      descripcion: String(p.descripcion || ''),
      precio: entero(legado ? p.precioAnterior : p.precio),
      precioOferta: entero(legado ? p.precio : p.precioOferta),
      enPromocion: legado || !!p.enPromocion,
      imagenes,
      tallas: Array.isArray(p.tallas) && p.tallas.length ? p.tallas.map(String) : TALLAS[categoria].slice(),
      nuevo: !!p.nuevo,
      masVendido: !!p.masVendido,
      agotado: !!p.agotado,
      activo: p.activo !== false
    };
  }

  function paraGuardar(p) {
    return {
      id: p.id,
      nombre: p.nombre.trim(),
      categoria: p.categoria,
      descripcion: p.descripcion.trim(),
      precio: entero(p.precio),
      precioOferta: entero(p.precioOferta),
      enPromocion: !!p.enPromocion,
      imagenes: p.imagenes.map((s) => String(s || '').trim()).filter(Boolean),
      tallas: p.tallas.slice(),
      nuevo: !!p.nuevo,
      masVendido: !!p.masVendido,
      agotado: !!p.agotado,
      activo: !!p.activo
    };
  }

  function borradorVacio() {
    return {
      id: nuevoId(),
      nombre: '',
      categoria: 'camisetas',
      descripcion: '',
      precio: 0,
      precioOferta: 0,
      enPromocion: false,
      imagenes: ['', '', ''],
      tallas: TALLAS.camisetas.slice(),
      nuevo: true,
      masVendido: false,
      agotado: false,
      activo: true
    };
  }

  /* ---------- Imágenes ---------- */
  function validarArchivo(file) {
    if (!file) throw new Error('No se seleccionó ningún archivo');
    if (!TIPOS_IMG.includes(file.type)) throw new Error('Formato no permitido. Usa JPG, PNG, WEBP o GIF.');
    if (file.size > MAX_IMG_BYTES) throw new Error('La imagen supera los 5 MB');
  }

  function archivoADataURL(file, max = 1000, calidad = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * r));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * r));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen'));
      };
      img.src = url;
    });
  }

  function dataURLaArchivo(dataUrl, nombre) {
    const [cabecera, base64] = dataUrl.split(',');
    const mime = (cabecera.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], nombre, { type: mime });
  }

  /* ---------- Backend SERVIDOR (PHP) ---------- */
  async function pedir(url, opciones = {}) {
    const sep = url.includes('?') ? '&' : '?';
    let res;
    try {
      res = await fetch(url + sep + '_=' + Date.now(), {
        credentials: 'same-origin',
        cache: 'no-store',
        ...opciones,
        headers: { Accept: 'application/json', ...(opciones.headers || {}) }
      });
    } catch (e) {
      throw new Error('Sin conexión con el servidor. Revisa tu internet.');
    }
    let datos = null;
    try {
      datos = await res.json();
    } catch (e) {
      datos = null;
    }
    if (!res.ok || !datos) {
      const err = new Error((datos && datos.error) || `Error del servidor (${res.status})`);
      err.status = res.status;
      if (res.status === 401 && state.usuario) sesionExpirada();
      throw err;
    }
    return datos;
  }

  function post(url, cuerpo) {
    return pedir(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf },
      body: JSON.stringify(cuerpo)
    });
  }

  const Servidor = {
    estado: () => pedir('api/auth.php'),
    async login(usuario, clave) {
      const d = await post('api/auth.php', { accion: 'login', usuario, clave });
      return { usuario: d.usuario, csrf: d.csrf, porDefecto: !!d.porDefecto };
    },
    async logout() {
      try { await post('api/auth.php', { accion: 'logout' }); } catch (e) { /* la sesión igual se descarta */ }
    },
    async cargar() {
      const d = await pedir('api/guardar.php?accion=leer');
      return { productos: d.productos || [], config: d.config || {} };
    },
    async guardarProductos(lista) {
      const d = await post('api/guardar.php', { accion: 'productos', productos: lista });
      return d.productos;
    },
    async guardarConfig(config) {
      const d = await post('api/guardar.php', { accion: 'config', config });
      return d.config;
    },
    async credenciales(datos) {
      const d = await post('api/auth.php', { accion: 'credenciales', ...datos });
      state.csrf = d.csrf || state.csrf;
      return d.usuario;
    },
    async subirImagen(file) {
      validarArchivo(file);
      const fd = new FormData();
      fd.append('imagen', file);
      const d = await pedir('api/subir.php', { method: 'POST', headers: { 'X-CSRF-Token': state.csrf }, body: fd });
      return d.ruta;
    },
    async diagnostico() {
      const d = await pedir('api/guardar.php?accion=diagnostico');
      return d.chequeos || [];
    }
  };

  /* ---------- Backend LOCAL (localStorage) ---------- */
  function escribirLocal(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) {
      throw new Error('El almacenamiento del navegador está lleno. Usa URLs de imágenes o sube la tienda a tu hosting.');
    }
  }

  function leerCredLocal() {
    const c = D.leerLS(LS_CRED);
    return c && c.usuario && c.hash && c.salt ? c : null;
  }

  async function datosArchivo(tipo) {
    if (D.esServidor) {
      try {
        return await D.pedirJSON(D.ENDPOINTS[tipo].json);
      } catch (e) { /* se usa la semilla */ }
    }
    return D.semilla()[tipo];
  }

  const Local = {
    async estado() {
      let usuario = null;
      try { usuario = sessionStorage.getItem(SS_SESION); } catch (e) { usuario = null; }
      return { autenticado: !!usuario, usuario, porDefecto: !leerCredLocal() };
    },
    async login(usuario, clave) {
      const cred = leerCredLocal();
      const u = usuario.trim().toLowerCase();
      const ok = cred
        ? u === cred.usuario.toLowerCase() && sha256(cred.salt + clave) === cred.hash
        : u === CRED_DEFECTO.usuario && clave === CRED_DEFECTO.clave;
      if (!ok) {
        await esperar(400);
        throw new Error('Usuario o contraseña incorrectos');
      }
      const nombre = cred ? cred.usuario : CRED_DEFECTO.usuario;
      try { sessionStorage.setItem(SS_SESION, nombre); } catch (e) { /* sesión solo en memoria */ }
      return { usuario: nombre, csrf: '', porDefecto: !cred };
    },
    async logout() {
      try { sessionStorage.removeItem(SS_SESION); } catch (e) { /* nada */ }
    },
    async cargar() {
      let productos = D.leerLS(K.productos);
      let config = D.leerLS(K.config);
      if (!Array.isArray(productos)) productos = await datosArchivo('productos');
      if (!config || typeof config !== 'object' || Array.isArray(config)) config = await datosArchivo('config');
      return { productos, config };
    },
    async guardarProductos(lista) {
      escribirLocal(K.productos, lista);
      return clonar(lista);
    },
    async guardarConfig(config) {
      escribirLocal(K.config, config);
      return clonar(config);
    },
    async credenciales({ claveActual, usuarioNuevo, claveNueva }) {
      const cred = leerCredLocal();
      const actualOk = cred ? sha256(cred.salt + claveActual) === cred.hash : claveActual === CRED_DEFECTO.clave;
      if (!actualOk) throw new Error('La contraseña actual no es correcta');
      const salt = salAleatoria();
      escribirLocal(LS_CRED, { usuario: usuarioNuevo, salt, hash: sha256(salt + claveNueva), actualizado: new Date().toISOString() });
      try { sessionStorage.setItem(SS_SESION, usuarioNuevo); } catch (e) { /* nada */ }
      return usuarioNuevo;
    },
    async subirImagen(file) {
      validarArchivo(file);
      return archivoADataURL(file);
    },
    async diagnostico() {
      let usado = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          usado += (k.length + (localStorage.getItem(k) || '').length) * 2;
        }
      } catch (e) { usado = 0; }
      return [
        { nombre: 'Modo local de pruebas (sin PHP)', ok: false, detalle: 'Los cambios solo se guardan en este navegador. Sube la carpeta a tu hosting para guardarlos en el servidor.' },
        { nombre: 'Almacenamiento del navegador', ok: true, detalle: `${Math.round(usado / 1024)} KB usados de ~5.000 KB` },
        { nombre: 'Sincronización con la tienda', ok: true, detalle: 'Las pestañas de la tienda abiertas en este navegador se actualizan al instante' }
      ];
    }
  };

  /* ---------- Backend GITHUB (GitHub Pages + API de GitHub) ---------- */
  const ghCfg = () => {
    const c = D.leerLS(LS_GH);
    return c && c.owner && c.repo && c.token ? c : null;
  };

  const rutaApi = (ruta) => ruta.split('/').map(encodeURIComponent).join('/');

  async function ghApi(ruta, opciones = {}, cfg = ghCfg()) {
    if (!cfg) throw new Error('Conecta tu repositorio de GitHub en Seguridad.');
    let res;
    try {
      res = await fetch('https://api.github.com' + ruta, {
        method: opciones.method || 'GET',
        body: opciones.body,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + cfg.token,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(opciones.body ? { 'Content-Type': 'application/json' } : {})
        }
      });
    } catch (e) {
      throw new Error('No hay conexión con GitHub. Revisa tu internet.');
    }
    if (res.status === 404 && opciones.permitir404) return null;
    let datos = null;
    try { datos = await res.json(); } catch (e) { datos = null; }
    if (!res.ok) {
      const mensajes = {
        401: 'El token de GitHub no es válido o expiró. Crea uno nuevo y conéctalo otra vez.',
        403: 'El token no tiene permiso para escribir en el repositorio (Contents: Read and write).',
        404: 'No se encontró el repositorio o la rama. Revisa el usuario, el repositorio y la rama.'
      };
      const err = new Error(mensajes[res.status] || (datos && datos.message) || `Error de GitHub (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return datos;
  }

  async function ghLeer(ruta, cfg = ghCfg()) {
    const d = await ghApi(`/repos/${cfg.owner}/${cfg.repo}/contents/${rutaApi(ruta)}?ref=${encodeURIComponent(cfg.branch)}`, { permitir404: true }, cfg);
    if (!d) {
      delete state.shas[ruta];
      return null;
    }
    state.shas[ruta] = d.sha;
    return { sha: d.sha, texto: base64ATexto(d.content || '') };
  }

  async function ghEscribir(ruta, base64, mensaje) {
    const cfg = ghCfg();
    const url = `/repos/${cfg.owner}/${cfg.repo}/contents/${rutaApi(ruta)}`;
    const cuerpo = () => JSON.stringify({ message: mensaje, content: base64, branch: cfg.branch, ...(state.shas[ruta] ? { sha: state.shas[ruta] } : {}) });
    let d;
    try {
      d = await ghApi(url, { method: 'PUT', body: cuerpo() });
    } catch (e) {
      /* sha desactualizado (otro dispositivo guardó antes): se relee y se reintenta una vez */
      if (e.status !== 409 && e.status !== 422) throw e;
      await ghLeer(ruta);
      d = await ghApi(url, { method: 'PUT', body: cuerpo() });
    }
    state.shas[ruta] = d.content.sha;
    return d;
  }

  async function ghLeerJSON(ruta) {
    const f = await ghLeer(ruta);
    if (!f) return null;
    try {
      return JSON.parse(f.texto);
    } catch (e) {
      throw new Error(`El archivo ${ruta} del repositorio no es un JSON válido`);
    }
  }

  /* Credenciales del panel: en el repo (data/admin.json) o las de fábrica si no existe */
  async function leerCredGithub() {
    if (ghCfg()) {
      try { return await ghLeerJSON(ARCHIVO_CRED_GH); } catch (e) { if (e.status !== 401) throw e; }
    }
    let res;
    try {
      res = await fetch(ARCHIVO_CRED_GH + '?t=' + Date.now(), { cache: 'no-store' });
    } catch (e) {
      throw new Error('Sin conexión. Revisa tu internet.');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('No se pudieron leer las credenciales del panel');
    try {
      return await res.json();
    } catch (e) {
      throw new Error('El archivo de credenciales está dañado');
    }
  }

  async function verificarCredGithub(cred, usuario, clave) {
    const u = usuario.trim().toLowerCase();
    if (!cred || !cred.hash || !cred.salt) return u === CRED_DEFECTO.usuario && clave === CRED_DEFECTO.clave;
    const hash = await pbkdf2(clave, cred.salt, cred.iter || PBKDF2_ITER);
    return u === String(cred.usuario).toLowerCase() && hash === cred.hash;
  }

  /* Muestra los cambios al instante en las pestañas de la tienda de este navegador */
  function publicarEnNavegador(parcial) {
    const actual = D.leerLS(K.override) || {};
    try {
      localStorage.setItem(K.override, JSON.stringify({ ...actual, ...parcial, hasta: Date.now() + 3 * 60 * 1000 }));
    } catch (e) { /* sin espacio: la tienda se actualizará al desplegar */ }
  }

  function adivinarRepo() {
    const m = location.hostname.toLowerCase().match(/^([a-z0-9-]+)\.github\.io$/);
    if (!m) return { owner: '', repo: '' };
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg && !/\.html?$/i.test(seg) ? seg : location.hostname.toLowerCase() };
  }

  async function conectarGithub(owner, repo, branch, token) {
    const cfg = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim(), token: token.trim() };
    if (!/^[A-Za-z0-9-]+$/.test(cfg.owner)) throw new Error('Revisa el usuario de GitHub');
    if (!/^[A-Za-z0-9._-]+$/.test(cfg.repo)) throw new Error('Revisa el nombre del repositorio');
    if (cfg.token.length < 20) throw new Error('Pega el token completo (empieza por github_pat_)');
    const info = await ghApi(`/repos/${cfg.owner}/${cfg.repo}`, {}, cfg);
    if (!cfg.branch) cfg.branch = info.default_branch || 'main';
    await ghApi(`/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`, {}, cfg);
    if (info.permissions && info.permissions.push === false) {
      throw new Error('Tu cuenta no tiene permiso de escritura en ese repositorio');
    }
    escribirLocal(LS_GH, cfg);
    state.shas = {};
    /* La tienda debe leer el JSON publicado, no datos de pruebas locales */
    try {
      localStorage.removeItem(K.productos);
      localStorage.removeItem(K.config);
    } catch (e) { /* nada */ }
    return cfg;
  }

  const Github = {
    async estado() {
      let usuario = null;
      try { usuario = sessionStorage.getItem(SS_SESION); } catch (e) { usuario = null; }
      if (!usuario) return { autenticado: false };
      const cred = await leerCredGithub().catch(() => null);
      return { autenticado: true, usuario, porDefecto: !(cred && cred.hash) };
    },
    async login(usuario, clave) {
      const cred = await leerCredGithub();
      if (!(await verificarCredGithub(cred, usuario, clave))) {
        await esperar(400);
        throw new Error('Usuario o contraseña incorrectos');
      }
      const nombre = cred && cred.hash ? cred.usuario : CRED_DEFECTO.usuario;
      try { sessionStorage.setItem(SS_SESION, nombre); } catch (e) { /* nada */ }
      return { usuario: nombre, csrf: '', porDefecto: !(cred && cred.hash) };
    },
    logout: Local.logout,
    async cargar() {
      const [productos, config] = await Promise.all([ghLeerJSON('data/productos.json'), ghLeerJSON('data/config.json')]);
      const semilla = D.semilla();
      return { productos: Array.isArray(productos) ? productos : semilla.productos, config: config || semilla.config };
    },
    async guardarProductos(lista) {
      await ghEscribir('data/productos.json', textoABase64(JSON.stringify(lista, null, 2) + '\n'), 'Panel: actualizar catálogo');
      publicarEnNavegador({ productos: lista });
      return clonar(lista);
    },
    async guardarConfig(config) {
      await ghEscribir('data/config.json', textoABase64(JSON.stringify(config, null, 2) + '\n'), 'Panel: actualizar configuración');
      publicarEnNavegador({ config });
      return clonar(config);
    },
    async credenciales({ claveActual, usuarioNuevo, claveNueva }) {
      const cred = await leerCredGithub();
      const actualOk = cred && cred.hash
        ? (await pbkdf2(claveActual, cred.salt, cred.iter || PBKDF2_ITER)) === cred.hash
        : claveActual === CRED_DEFECTO.clave;
      if (!actualOk) throw new Error('La contraseña actual no es correcta');
      const salt = salAleatoria();
      const nuevo = {
        usuario: usuarioNuevo,
        alg: 'pbkdf2-sha256',
        iter: PBKDF2_ITER,
        salt,
        hash: await pbkdf2(claveNueva, salt),
        actualizado: new Date().toISOString()
      };
      await ghEscribir(ARCHIVO_CRED_GH, textoABase64(JSON.stringify(nuevo, null, 2) + '\n'), 'Panel: actualizar credenciales');
      try { sessionStorage.setItem(SS_SESION, usuarioNuevo); } catch (e) { /* nada */ }
      return usuarioNuevo;
    },
    async subirImagen(file) {
      validarArchivo(file);
      const dataUrl = await archivoADataURL(file, 1400, 0.85);
      const nombre = new Date().toISOString().slice(0, 19).replace(/\D/g, '') + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
      const ruta = 'img/productos/' + nombre;
      await ghEscribir(ruta, dataUrl.split(',')[1], 'Panel: subir imagen ' + nombre);
      state.vistas[ruta] = dataUrl;
      return ruta;
    },
    async diagnostico() {
      const cfg = ghCfg();
      const chequeos = [];
      try {
        const info = await ghApi(`/repos/${cfg.owner}/${cfg.repo}`);
        chequeos.push({ nombre: `Repositorio ${cfg.owner}/${cfg.repo}`, ok: true, detalle: `Rama: ${cfg.branch} · ${info.private ? 'privado' : 'público'}` });
        chequeos.push({ nombre: 'Token de acceso válido', ok: true, detalle: 'Guardado solo en este navegador' });
      } catch (e) {
        chequeos.push({ nombre: 'Acceso al repositorio', ok: false, detalle: e.message });
      }
      const cred = await leerCredGithub().catch(() => null);
      chequeos.push({
        nombre: cred && cred.hash ? 'Credenciales personalizadas' : 'Credenciales por defecto',
        ok: !!(cred && cred.hash),
        detalle: cred && cred.hash ? 'Protegidas con PBKDF2 (150.000 iteraciones)' : 'Cámbialas en el formulario de esta página'
      });
      chequeos.push({ nombre: 'Publicación', ok: true, detalle: 'GitHub Pages despliega cada cambio en ~1 minuto' });
      chequeos.push({ nombre: 'Conexión segura (HTTPS)', ok: location.protocol === 'https:', detalle: 'GitHub Pages incluye HTTPS gratis' });
      return chequeos;
    }
  };

  let B = Local;

  async function detectarModo() {
    if (!/^https?:$/.test(location.protocol)) return { modo: 'local', estado: null };
    if (!D.esGithubPages) {
      try {
        const d = await pedir('api/auth.php');
        if (d && d.servidor === true) return { modo: 'servidor', estado: d };
      } catch (e) { /* sin PHP */ }
    }
    let localElegido = false;
    try { localElegido = sessionStorage.getItem(SS_MODO_LOCAL) === '1'; } catch (e) { localElegido = false; }
    /* Sin PHP en la web: se publica a través de GitHub (salvo que se elija modo local) */
    return { modo: localElegido ? 'local' : 'github', estado: null };
  }

  /* Avisa a las pestañas de la tienda abiertas para que recarguen */
  function notificarTienda() {
    try { localStorage.setItem(K.sync, String(Date.now())); } catch (e) { /* sin almacenamiento */ }
  }

  /* ---------- Toasts y confirmaciones ---------- */
  function toast(mensaje, tipo = 'ok', duracion = 3200) {
    const cont = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (tipo === 'error' ? ' toast--error' : tipo === 'ok' ? ' toast--ok' : '');
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = `<div class="toast__msg">${esc(mensaje)}</div>`;
    cont.appendChild(el);
    while (cont.children.length > 3) cont.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 320);
    }, duracion);
  }

  function confirmar({ titulo, texto, ok = 'CONFIRMAR', peligro = true }) {
    return new Promise((resolve) => {
      const dlg = $('#confirmDlg');
      const btn = $('#confirmOk');
      $('#confirmTitle').textContent = titulo;
      $('#confirmText').textContent = texto;
      btn.textContent = ok;
      btn.classList.toggle('btn--danger', peligro);
      dlg.hidden = false;
      setTimeout(() => btn.focus(), 30);
      const cerrar = (v) => {
        dlg.hidden = true;
        dlg.removeEventListener('click', alClic);
        document.removeEventListener('keydown', alTecla, true);
        resolve(v);
      };
      const alClic = (e) => {
        const b = e.target.closest('[data-confirm]');
        if (b) cerrar(b.dataset.confirm === 'si');
      };
      const alTecla = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cerrar(false);
        }
      };
      dlg.addEventListener('click', alClic);
      document.addEventListener('keydown', alTecla, true);
    });
  }

  const avisoDespliegue = () => (state.modo === 'github' ? ' · tus clientes lo verán en ~1 minuto' : '');

  function cargandoBoton(btn, activo) {
    if (!btn) return;
    btn.classList.toggle('is-loading', activo);
    btn.disabled = activo;
  }

  /* ---------- Vistas: login / app ---------- */
  function pintarModo() {
    const modos = {
      servidor: ['Servidor', 'mode-pill--server', 'Los cambios se guardan en el hosting y se ven al instante en la tienda', 'Conexión segura con el servidor'],
      github: ['GitHub', 'mode-pill--github', 'Los cambios se publican en tu repositorio de GitHub (~1 min en verse)', 'Publicación mediante GitHub Pages'],
      local: ['Modo local', 'mode-pill--local', 'Sin servidor: los cambios se guardan en este navegador', 'Modo local de pruebas · los cambios se guardan en este navegador']
    };
    const [texto, clase, titulo, login] = modos[state.modo] || modos.local;
    const pill = $('#modePill');
    pill.textContent = texto;
    pill.className = 'mode-pill ' + clase;
    pill.title = titulo;
    $('#loginMode').textContent = login;
    const gh = ghCfg();
    $('#ghCard').hidden = !(state.modo === 'github' && gh);
    if (gh) $('#ghRepoLabel').textContent = `${gh.owner}/${gh.repo} (${gh.branch})`;
  }

  function mostrarConexionGithub(mensaje) {
    $('#bootView').hidden = true;
    $('#appView').hidden = true;
    $('#loginView').hidden = true;
    $('#ghView').hidden = false;
    const f = $('#ghForm');
    const previo = D.leerLS(LS_GH) || {};
    const guess = adivinarRepo();
    f.elements.owner.value = previo.owner || guess.owner;
    f.elements.repo.value = previo.repo || guess.repo;
    f.elements.branch.value = previo.branch || '';
    f.elements.token.value = '';
    const err = $('#ghError');
    err.hidden = !mensaje;
    err.textContent = mensaje || '';
    setTimeout(() => (f.elements.owner.value ? f.elements.token : f.elements.owner).focus(), 50);
  }

  /* Tras iniciar sesión: en modo GitHub hace falta el token en este dispositivo */
  async function continuarTrasLogin() {
    if (state.modo === 'github' && !ghCfg()) {
      mostrarConexionGithub();
      return;
    }
    await entrar();
  }

  function mostrarLogin(mensaje) {
    $('#bootView').hidden = true;
    $('#appView').hidden = true;
    $('#ghView').hidden = true;
    $('#loginView').hidden = false;
    $('#editor').hidden = true;
    document.body.classList.remove('no-scroll');
    const err = $('#loginError');
    err.hidden = !mensaje;
    err.textContent = mensaje || '';
    $('#lClave').value = '';
    setTimeout(() => ($('#lUsuario').value ? $('#lClave') : $('#lUsuario')).focus(), 50);
  }

  async function entrar() {
    const datos = await B.cargar();
    state.productos = (datos.productos || []).map(normalizarProductoAdmin);
    state.config = D.normalizarConfig(datos.config || {});
    $('#loginView').hidden = true;
    $('#ghView').hidden = true;
    $('#bootView').hidden = true;
    $('#appView').hidden = false;
    pintarModo();
    $('#userLabel').textContent = state.usuario;
    $('#credUser').textContent = state.usuario;
    $('#sUsuario').value = state.usuario;
    $('#defaultAlert').hidden = !state.porDefecto;
    renderLista();
    renderConfigForm();
    cambiarTab('productos');
    document.documentElement.dataset.adminReady = 'true';
  }

  function sesionExpirada() {
    state.usuario = '';
    state.csrf = '';
    $('#editor').hidden = true;
    mostrarLogin('Tu sesión expiró. Inicia sesión de nuevo.');
  }

  async function alEnviarLogin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const usuario = form.elements.usuario.value.trim();
    const clave = form.elements.clave.value;
    const err = $('#loginError');
    if (!usuario || !clave) {
      err.textContent = 'Escribe tu usuario y contraseña';
      err.hidden = false;
      return;
    }
    const btn = $('#loginBtn');
    cargandoBoton(btn, true);
    try {
      const r = await B.login(usuario, clave);
      state.usuario = r.usuario;
      state.csrf = r.csrf || '';
      state.porDefecto = !!r.porDefecto;
      err.hidden = true;
      await continuarTrasLogin();
      toast(`Bienvenido, ${state.usuario}`);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      const card = $('.login__card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      form.elements.clave.select();
    } finally {
      cargandoBoton(btn, false);
    }
  }

  async function cerrarSesion() {
    await B.logout();
    state.usuario = '';
    state.csrf = '';
    state.productos = [];
    document.documentElement.dataset.adminReady = 'false';
    mostrarLogin();
    toast('Sesión cerrada', 'info');
  }

  function cambiarTab(tab) {
    $$('.a-tab').forEach((b) => {
      const activo = b.dataset.tab === tab;
      b.classList.toggle('is-active', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    $('#tab-productos').hidden = tab !== 'productos';
    $('#tab-config').hidden = tab !== 'config';
    $('#tab-seguridad').hidden = tab !== 'seguridad';
    if (tab === 'seguridad') renderDiagnostico();
    if (tab === 'config') renderConfigPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Lista de productos ---------- */
  function renderStats() {
    const ps = state.productos;
    const datos = [
      { n: ps.length, l: 'Productos' },
      { n: ps.filter((p) => p.activo).length, l: 'Visibles', c: 'accent' },
      { n: ps.filter(enPromo).length, l: 'En promoción', c: 'hot' },
      { n: ps.filter((p) => p.agotado).length, l: 'Agotados' }
    ];
    $('#stats').innerHTML = datos.map((s) =>
      `<div class="stat${s.c ? ' stat--' + s.c : ''}"><span class="stat__n">${s.n}</span><span class="stat__l">${s.l}</span></div>`
    ).join('');
  }

  function etiquetasHTML(p) {
    const t = [];
    if (!p.activo) t.push('<span class="ptag ptag--hidden">Oculto</span>');
    if (p.agotado) t.push('<span class="ptag ptag--out">Agotado</span>');
    if (p.nuevo) t.push('<span class="ptag ptag--drop">Nuevo drop</span>');
    if (p.masVendido) t.push('<span class="ptag ptag--hot">Más vendido</span>');
    if (enPromo(p)) t.push(`<span class="ptag ptag--sale">Promo -${pctDescuento(p)}%</span>`);
    else if (p.enPromocion) t.push('<span class="ptag">Promo sin precio válido</span>');
    return t.join('');
  }

  function renderLista() {
    renderStats();
    const q = normalizarTexto(state.busqueda.trim());
    const lista = state.productos.filter((p) =>
      (state.filtro === 'todo' || p.categoria === state.filtro) &&
      (!q || normalizarTexto(`${p.nombre} ${p.id}`).includes(q))
    );
    $('#prodEmpty').hidden = lista.length > 0;
    $('#prodList').innerHTML = lista.map((p, i) => {
      const img = p.imagenes.find(Boolean);
      const precio = enPromo(p)
        ? `<s>${cop(p.precio)}</s><span class="is-sale">${cop(p.precioOferta)}</span>`
        : cop(p.precio);
      return `
        <li class="prow${p.activo ? '' : ' is-hidden'}" data-id="${esc(p.id)}" style="animation-delay:${Math.min(i, 10) * 30}ms">
          <div class="prow__img">${img ? `<img src="${esc(vista(img))}" alt="" loading="lazy">` : ''}</div>
          <div class="prow__info">
            <p class="prow__name">${esc(p.nombre || 'Sin nombre')}</p>
            <p class="prow__meta">${esc(CATEGORIAS[p.categoria])} · Ref: ${esc(p.id)} · Tallas: ${esc(p.tallas.join(', '))}</p>
            <div class="prow__price">${precio}</div>
            <div class="prow__tags">${etiquetasHTML(p)}</div>
          </div>
          <div class="prow__actions">
            <button class="act act--icon" type="button" data-act="visible" title="${p.activo ? 'Ocultar de la tienda' : 'Mostrar en la tienda'}" aria-label="${p.activo ? 'Ocultar' : 'Mostrar'} ${esc(p.nombre)}">${icono(p.activo ? 'i-eye' : 'i-eye-off')}</button>
            <button class="act" type="button" data-act="editar" aria-label="Editar ${esc(p.nombre)}">${icono('i-edit')} Editar</button>
            <button class="act act--icon" type="button" data-act="duplicar" title="Duplicar" aria-label="Duplicar ${esc(p.nombre)}">${icono('i-copy')}</button>
            <button class="act act--icon act--danger" type="button" data-act="eliminar" title="Eliminar" aria-label="Eliminar ${esc(p.nombre)}">${icono('i-trash')}</button>
          </div>
        </li>`;
    }).join('');
  }

  async function persistirProductos(lista) {
    const guardados = await B.guardarProductos(lista.map(paraGuardar));
    state.productos = guardados.map(normalizarProductoAdmin);
    notificarTienda();
    renderLista();
  }

  async function accionLista(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || state.guardando) return;
    const id = btn.closest('.prow').dataset.id;
    const p = state.productos.find((x) => x.id === id);
    if (!p) return;
    const accion = btn.dataset.act;

    if (accion === 'editar') {
      abrirEditor(p);
      return;
    }

    state.guardando = true;
    try {
      if (accion === 'visible') {
        await persistirProductos(state.productos.map((x) => (x.id === id ? { ...x, activo: !x.activo } : x)));
        toast(p.activo ? `"${p.nombre}" quedó oculto en la tienda` : `"${p.nombre}" ya es visible en la tienda`);
      } else if (accion === 'duplicar') {
        const copia = { ...clonar(p), id: nuevoId(), nombre: `${p.nombre} (copia)`.slice(0, 80) };
        const idx = state.productos.findIndex((x) => x.id === id);
        const lista = state.productos.slice();
        lista.splice(idx + 1, 0, copia);
        await persistirProductos(lista);
        toast('Producto duplicado. Ajusta los detalles de la copia.');
        abrirEditor(state.productos.find((x) => x.id === copia.id));
      } else if (accion === 'eliminar') {
        const ok = await confirmar({
          titulo: 'Eliminar producto',
          texto: `"${p.nombre}" se borrará de la tienda. Esta acción no se puede deshacer.`,
          ok: 'ELIMINAR'
        });
        if (ok) {
          await persistirProductos(state.productos.filter((x) => x.id !== id));
          toast('Producto eliminado');
        }
      }
    } catch (ex) {
      toast(ex.message, 'error', 5000);
    } finally {
      state.guardando = false;
    }
  }

  /* ---------- Editor de producto ---------- */
  function abrirEditor(producto) {
    state.editandoId = producto ? producto.id : null;
    state.borrador = producto ? clonar(producto) : borradorVacio();
    state.original = JSON.stringify(state.borrador);
    const b = state.borrador;
    const f = $('#prodForm');

    $('#editorTitle').textContent = producto ? 'Editar producto' : 'Nuevo producto';
    f.elements.nombre.value = b.nombre;
    f.elements.descripcion.value = b.descripcion;
    f.elements.categoria.value = b.categoria;
    f.elements.precio.value = b.precio || '';
    f.elements.precioOferta.value = b.precioOferta || '';
    ['enPromocion', 'masVendido', 'nuevo', 'agotado', 'activo'].forEach((n) => { f.elements[n].checked = !!b[n]; });
    $$('.field.is-invalid', f).forEach((el) => el.classList.remove('is-invalid'));
    $$('.field__error', f).forEach((el) => { el.textContent = ''; });
    $('#imgError').textContent = '';
    $('#sizeError').textContent = '';
    $('#editorMsg').textContent = '';

    renderSlots();
    renderTallas();
    actualizarContador();
    actualizarPreview();

    $('#editor').hidden = false;
    document.body.classList.add('no-scroll');
    $('.editor').scrollTop = 0;
    setTimeout(() => f.elements.nombre.focus(), 60);
  }

  async function cerrarEditor(forzar = false) {
    if ($('#editor').hidden) return;
    if (!forzar && state.borrador && JSON.stringify(state.borrador) !== state.original) {
      const ok = await confirmar({
        titulo: 'Descartar cambios',
        texto: 'Tienes cambios sin guardar en este producto. ¿Quieres salir sin guardarlos?',
        ok: 'DESCARTAR'
      });
      if (!ok) return;
    }
    $('#editor').hidden = true;
    document.body.classList.remove('no-scroll');
    state.borrador = null;
    state.editandoId = null;
  }

  function slotHTML(src, i) {
    const local = src.startsWith('data:');
    return `
      <div class="img-slot" data-slot="${i}">
        <div class="img-slot__thumb" id="thumb${i}">
          <span class="img-slot__num">${i + 1}</span>
          ${src ? `<img src="${esc(vista(src))}" alt="Imagen ${i + 1}">` : icono('i-image')}
        </div>
        <div class="img-slot__body">
          <input type="url" data-img-url="${i}" value="${local ? '' : esc(src)}"
            placeholder="${local ? 'Imagen subida (guardada en este navegador)' : `URL de la imagen ${i + 1} (https://…)`}"
            aria-label="URL de la imagen ${i + 1}">
          <div class="img-slot__btns">
            <label class="btn btn--ghost btn--sm upload-btn">
              ${icono('i-upload')} SUBIR ARCHIVO
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-img-file="${i}" hidden>
            </label>
            ${src ? `<button class="act act--icon act--danger" type="button" data-img-clear="${i}" aria-label="Quitar imagen ${i + 1}" title="Quitar imagen">${icono('i-trash')}</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function renderSlots() {
    $('#imgSlots').innerHTML = state.borrador.imagenes.map(slotHTML).join('');
  }

  function actualizarMiniatura(i) {
    const src = state.borrador.imagenes[i];
    const thumb = $('#thumb' + i);
    if (!thumb) return;
    const valida = src && urlImagenValida(src);
    thumb.innerHTML = `<span class="img-slot__num">${i + 1}</span>` + (valida ? `<img src="${esc(vista(src))}" alt="Imagen ${i + 1}">` : icono('i-image'));
  }

  async function subirEnSlot(i, file) {
    const slot = $(`.img-slot[data-slot="${i}"]`);
    try {
      validarArchivo(file);
      if (slot) slot.classList.add('is-loading');
      const ruta = await B.subirImagen(file);
      if (!state.borrador) return;
      state.borrador.imagenes[i] = ruta;
      renderSlots();
      actualizarPreview();
      $('#imgError').textContent = '';
      toast(`Imagen ${i + 1} cargada`);
    } catch (ex) {
      toast(ex.message, 'error', 5000);
    } finally {
      if (slot) slot.classList.remove('is-loading');
    }
  }

  function renderTallas() {
    const b = state.borrador;
    const base = TALLAS[b.categoria];
    const extras = b.tallas.filter((t) => !base.includes(t));
    const todas = base.concat(extras);
    const completas = base.every((t) => b.tallas.includes(t));
    $('#sizePick').innerHTML =
      todas.map((t) => `<button class="size${b.tallas.includes(t) ? ' is-active' : ''}" type="button" data-talla="${esc(t)}" aria-pressed="${b.tallas.includes(t)}">${esc(t)}</button>`).join('') +
      (base.length > 1 ? `<button class="size size--all" type="button" data-talla-todas>${completas ? 'NINGUNA' : 'TODAS'}</button>` : '');
  }

  function actualizarContador() {
    $('#descCount').textContent = `${state.borrador.descripcion.length}/600`;
  }

  function tarjetaPreview(p) {
    const d = p.precioAnterior > p.precio ? Math.round((1 - p.precio / p.precioAnterior) * 100) : 0;
    const badges = p.agotado
      ? '<span class="badge badge--out">Agotado</span>'
      : (p.nuevo ? '<span class="badge badge--drop">Drop</span>' : '') +
        (p.masVendido ? '<span class="badge badge--hot">Hot</span>' : '') +
        (d ? `<span class="badge badge--sale">-${d}%</span>` : '');
    const img = p.imagenes[0];
    return `
      <article class="card${p.agotado ? ' is-out' : ''}">
        <div class="card__visual">
          <div class="card__media">
            ${img ? `<img src="${esc(vista(img))}" alt="">` : ''}
            ${p.imagenes[1] ? `<img class="card__alt" src="${esc(vista(p.imagenes[1]))}" alt="">` : ''}
            <span class="card__badges">${badges}</span>
          </div>
        </div>
        <div class="card__body">
          <p class="card__cat">${esc(CATEGORIAS[p.categoria])}</p>
          <h3 class="card__title">${esc(p.nombre || 'Nombre del producto')}</h3>
          <div class="price${d ? ' price--sale' : ''}">
            ${d ? `<s>${cop(p.precioAnterior)}</s>` : ''}<strong>${cop(p.precio)}</strong>${d ? `<span class="price__off">-${d}%</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  function actualizarPreview() {
    const b = state.borrador;
    if (!b) return;
    const guardable = paraGuardar(b);
    guardable.imagenes = guardable.imagenes.filter(urlImagenValida);
    const p = D.normalizarProducto(guardable);
    $('#prodPreview').innerHTML = tarjetaPreview(p);

    const estados = [];
    if (!b.activo) estados.push('Oculto en la tienda');
    if (b.agotado) estados.push('Se muestra como AGOTADO');
    if (b.nuevo) estados.push('Sale en "Nuevos Drops"');
    if (b.masVendido) estados.push('Sale en "Lo Más Vendido"');
    if (enPromo(b)) estados.push(`Sale en "Promociones" (-${pctDescuento(b)}%)`);
    $('#prodPreviewDetail').innerHTML = `
      <p><strong>Tallas:</strong></p>
      <div class="sizes">${b.tallas.length ? b.tallas.map((t) => `<span class="size">${esc(t)}</span>`).join('') : '<em>Sin tallas</em>'}</div>
      <p style="margin-top:12px">${estados.length ? esc(estados.join(' · ')) : 'Sin etiquetas especiales'}</p>
      <p style="margin-top:6px">${b.imagenes.filter(Boolean).length}/3 imágenes</p>`;

    const hint = $('#ofertaHint');
    if (b.precioOferta > 0 && b.precio > 0 && b.precioOferta < b.precio) {
      hint.textContent = `${Math.round((1 - b.precioOferta / b.precio) * 100)}% de descuento${b.enPromocion ? '' : ' (activa "En Promoción")'}`;
    } else {
      hint.textContent = 'Se aplica con "En Promoción" activo';
    }
  }
  const previewDiferida = debounce(actualizarPreview, 80);

  function errorCampo(nombre, mensaje) {
    const input = $('#prodForm').elements[nombre];
    const campo = input && input.closest('.field');
    if (!campo) return;
    campo.classList.toggle('is-invalid', !!mensaje);
    const el = $('.field__error', campo);
    if (el) el.textContent = mensaje || '';
  }

  function validarBorrador() {
    const b = state.borrador;
    let primero = null;
    const marcar = (cond, nombre, msg, el) => {
      if (nombre) errorCampo(nombre, cond ? msg : '');
      if (el) el.textContent = cond ? msg : '';
      if (cond && !primero) primero = nombre ? $('#prodForm').elements[nombre] : el;
    };
    marcar(b.nombre.trim().length < 2, 'nombre', 'Escribe el nombre del producto');
    marcar(!(b.precio > 0), 'precio', 'Indica el precio normal');
    marcar(b.enPromocion && !(b.precioOferta > 0 && b.precioOferta < b.precio), 'precioOferta',
      'Con "En Promoción" activo, el precio de oferta debe ser mayor a 0 y menor al precio normal');
    const imgs = b.imagenes.map((s) => s.trim()).filter(Boolean);
    const invalida = imgs.find((s) => !urlImagenValida(s));
    marcar(!imgs.length || !!invalida, null,
      invalida ? 'Hay una URL de imagen no válida (debe empezar con https://)' : 'Agrega al menos una imagen', $('#imgError'));
    marcar(!b.tallas.length, null, 'Selecciona al menos una talla', $('#sizeError'));
    if (primero) {
      primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (primero.focus) primero.focus({ preventScroll: true });
    }
    return !primero;
  }

  async function guardarProducto(e) {
    e.preventDefault();
    if (state.guardando || !state.borrador) return;
    $('#editorMsg').textContent = '';
    if (!validarBorrador()) {
      $('#editorMsg').textContent = 'Revisa los campos marcados antes de guardar.';
      return;
    }
    const producto = clonar(state.borrador);
    const idx = state.productos.findIndex((p) => p.id === state.editandoId);
    const lista = idx >= 0
      ? state.productos.map((p, i) => (i === idx ? producto : p))
      : [producto].concat(state.productos);
    const btn = $('#saveProduct');
    state.guardando = true;
    cargandoBoton(btn, true);
    try {
      await persistirProductos(lista);
      const esNuevo = idx < 0;
      await cerrarEditor(true);
      toast((esNuevo ? 'Producto creado y publicado' : 'Cambios guardados y publicados') + avisoDespliegue());
    } catch (ex) {
      $('#editorMsg').textContent = ex.message;
    } finally {
      state.guardando = false;
      cargandoBoton(btn, false);
    }
  }

  function enlazarEditor() {
    const form = $('#prodForm');
    const editor = $('#editor');

    form.addEventListener('submit', guardarProducto);

    form.addEventListener('input', (e) => {
      const b = state.borrador;
      if (!b) return;
      const t = e.target;
      if (t.dataset.imgUrl !== undefined) {
        const i = Number(t.dataset.imgUrl);
        b.imagenes[i] = t.value.trim();
        actualizarMiniatura(i);
        $('#imgError').textContent = '';
      } else if (t.type === 'checkbox') {
        b[t.name] = t.checked;
        if (t.name === 'enPromocion') errorCampo('precioOferta', '');
      } else if (t.name === 'precio' || t.name === 'precioOferta') {
        b[t.name] = entero(t.value);
        errorCampo(t.name, '');
      } else if (t.name === 'nombre' || t.name === 'descripcion') {
        b[t.name] = t.value;
        if (t.name === 'descripcion') actualizarContador();
        errorCampo(t.name, '');
      }
      previewDiferida();
    });

    form.addEventListener('change', (e) => {
      const b = state.borrador;
      if (!b) return;
      const t = e.target;
      if (t.name === 'categoria') {
        b.categoria = t.value;
        b.tallas = TALLAS[t.value].slice();
        renderTallas();
        $('#sizeError').textContent = '';
        actualizarPreview();
      } else if (t.type === 'checkbox') {
        b[t.name] = t.checked;
        actualizarPreview();
      } else if (t.dataset.imgFile !== undefined && t.files && t.files[0]) {
        subirEnSlot(Number(t.dataset.imgFile), t.files[0]);
        t.value = '';
      }
    });

    form.addEventListener('click', (e) => {
      const b = state.borrador;
      if (!b) return;
      const talla = e.target.closest('[data-talla]');
      if (talla) {
        const v = talla.dataset.talla;
        b.tallas = b.tallas.includes(v) ? b.tallas.filter((x) => x !== v) : b.tallas.concat(v);
        const orden = TALLAS[b.categoria];
        b.tallas.sort((x, y) => (orden.indexOf(x) + 1 || 99) - (orden.indexOf(y) + 1 || 99));
        renderTallas();
        $('#sizeError').textContent = '';
        actualizarPreview();
        return;
      }
      if (e.target.closest('[data-talla-todas]')) {
        const base = TALLAS[b.categoria];
        b.tallas = base.every((t) => b.tallas.includes(t)) ? [] : base.slice();
        renderTallas();
        actualizarPreview();
        return;
      }
      const limpiar = e.target.closest('[data-img-clear]');
      if (limpiar) {
        b.imagenes[Number(limpiar.dataset.imgClear)] = '';
        renderSlots();
        actualizarPreview();
      }
    });

    /* Arrastrar y soltar imágenes */
    const slots = $('#imgSlots');
    slots.addEventListener('dragover', (e) => {
      const slot = e.target.closest('.img-slot');
      if (!slot) return;
      e.preventDefault();
      slot.classList.add('is-drag');
    });
    slots.addEventListener('dragleave', (e) => {
      const slot = e.target.closest('.img-slot');
      if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('is-drag');
    });
    slots.addEventListener('drop', (e) => {
      const slot = e.target.closest('.img-slot');
      if (!slot) return;
      e.preventDefault();
      slot.classList.remove('is-drag');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) subirEnSlot(Number(slot.dataset.slot), file);
    });

    editor.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-editor]')) cerrarEditor();
    });
  }

  /* ---------- Configuración ---------- */
  function filaAnuncio(texto) {
    return `<div class="ann-row">
      <input type="text" maxlength="140" value="${esc(texto)}" placeholder="Ej. ENVÍO GRATIS POR COMPRAS DESDE $150.000" aria-label="Texto del anuncio" data-ann>
      <button class="act act--icon act--danger" type="button" data-ann-del aria-label="Quitar anuncio" title="Quitar">${icono('i-trash')}</button>
    </div>`;
  }

  function renderConfigForm() {
    const c = state.config;
    const h = c.hero || {};
    const f = $('#configForm');
    const anuncios = c.anuncios && c.anuncios.length ? c.anuncios : [''];
    $('#annList').innerHTML = anuncios.map(filaAnuncio).join('');
    f.elements.titulo.value = h.titulo || '';
    f.elements.etiqueta.value = h.etiqueta || '';
    f.elements.cta.value = h.cta || '';
    f.elements.subtitulo.value = h.subtitulo || '';
    f.elements.imagen.value = h.imagen && !h.imagen.startsWith('data:') ? h.imagen : '';
    f.elements.imagen.dataset.local = h.imagen && h.imagen.startsWith('data:') ? h.imagen : '';
    f.elements.whatsapp.value = c.whatsapp || '';
    f.elements.envioGratisDesde.value = c.envioGratisDesde || 0;
    f.elements.costoEnvio.value = c.costoEnvio || 0;
    $('#addAnn').disabled = anuncios.length >= MAX_ANUNCIOS;
    renderConfigPreview();
  }

  function leerConfigForm() {
    const f = $('#configForm');
    const imagen = f.elements.imagen.value.trim() || f.elements.imagen.dataset.local || '';
    return {
      ...state.config,
      anuncios: $$('[data-ann]').map((i) => i.value.trim()).filter(Boolean),
      whatsapp: f.elements.whatsapp.value.replace(/\D/g, ''),
      envioGratisDesde: entero(f.elements.envioGratisDesde.value),
      costoEnvio: entero(f.elements.costoEnvio.value),
      hero: {
        ...(state.config.hero || {}),
        titulo: f.elements.titulo.value.trim(),
        etiqueta: f.elements.etiqueta.value.trim(),
        cta: f.elements.cta.value.trim(),
        subtitulo: f.elements.subtitulo.value.trim(),
        imagen
      }
    };
  }

  function renderConfigPreview() {
    const c = leerConfigForm();
    const h = c.hero;
    $('#cfgPreview').innerHTML = `
      <div class="cfg-prev__bar">${esc(c.anuncios.join('  ✦  ') || 'Sin anuncios (la barra se oculta)')}</div>
      <div class="cfg-prev__hero">
        <div>
          ${h.etiqueta ? `<span class="cfg-prev__tag">${esc(h.etiqueta)}</span>` : ''}
          <p class="cfg-prev__title">${esc(h.titulo || 'Título')}</p>
          <p class="cfg-prev__sub">${esc(h.subtitulo)}</p>
          ${h.cta ? `<span class="cfg-prev__cta">${esc(h.cta)} →</span>` : ''}
        </div>
        <div class="cfg-prev__img">${h.imagen && urlImagenValida(h.imagen) ? `<img src="${esc(vista(h.imagen))}" alt="">` : ''}</div>
      </div>
      <div class="cfg-prev__wa">${icono('i-wa')} Pedidos a: <strong>${c.whatsapp ? '+' + esc(c.whatsapp) : 'sin número'}</strong></div>
      <div class="cfg-prev__wa">${icono('i-bolt')} ${c.envioGratisDesde > 0 ? `Envío gratis desde ${cop(c.envioGratisDesde)}` : 'Sin envío gratis'} · Envío ${cop(c.costoEnvio)}</div>`;
  }
  const configPreviewDiferida = debounce(renderConfigPreview, 100);

  async function guardarConfig(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const c = leerConfigForm();
    const campoWa = f.elements.whatsapp.closest('.field');
    const errWa = $('.field__error', campoWa);
    let error = '';
    if (!c.hero.titulo) {
      error = 'El título del banner es obligatorio';
      f.elements.titulo.focus();
    } else if (c.whatsapp.length < 10 || c.whatsapp.length > 15) {
      error = 'El WhatsApp debe tener entre 10 y 15 dígitos con indicativo (ej. 573001234567)';
      campoWa.classList.add('is-invalid');
      errWa.textContent = error;
      f.elements.whatsapp.focus();
    } else if (c.hero.imagen && !urlImagenValida(c.hero.imagen)) {
      error = 'La URL de la imagen del banner no es válida';
      f.elements.imagen.focus();
    }
    if (error) {
      toast(error, 'error', 5000);
      return;
    }
    campoWa.classList.remove('is-invalid');
    errWa.textContent = '';
    const btn = $('#saveConfig');
    cargandoBoton(btn, true);
    try {
      const guardada = await B.guardarConfig(c);
      state.config = D.normalizarConfig(guardada);
      notificarTienda();
      renderConfigForm();
      toast('Configuración guardada y publicada' + avisoDespliegue());
    } catch (ex) {
      toast(ex.message, 'error', 5000);
    } finally {
      cargandoBoton(btn, false);
    }
  }

  function enlazarConfig() {
    const f = $('#configForm');
    f.addEventListener('submit', guardarConfig);
    f.addEventListener('input', (e) => {
      if (e.target.name === 'imagen') e.target.dataset.local = '';
      if (e.target.name === 'whatsapp') {
        const campo = e.target.closest('.field');
        campo.classList.remove('is-invalid');
        $('.field__error', campo).textContent = '';
      }
      configPreviewDiferida();
    });
    $('#addAnn').addEventListener('click', () => {
      const n = $$('[data-ann]').length;
      if (n >= MAX_ANUNCIOS) return;
      $('#annList').insertAdjacentHTML('beforeend', filaAnuncio(''));
      $('#addAnn').disabled = n + 1 >= MAX_ANUNCIOS;
      $$('[data-ann]').pop().focus();
    });
    $('#annList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-ann-del]');
      if (!del) return;
      del.closest('.ann-row').remove();
      if (!$$('[data-ann]').length) $('#annList').insertAdjacentHTML('beforeend', filaAnuncio(''));
      $('#addAnn').disabled = $$('[data-ann]').length >= MAX_ANUNCIOS;
      renderConfigPreview();
    });
    $('#cImagenFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const ruta = await B.subirImagen(file);
        const input = f.elements.imagen;
        if (ruta.startsWith('data:')) {
          input.value = '';
          input.dataset.local = ruta;
          input.placeholder = 'Imagen subida (guardada en este navegador)';
        } else {
          input.value = ruta;
          input.dataset.local = '';
        }
        renderConfigPreview();
        toast('Imagen del banner cargada. Recuerda guardar.');
      } catch (ex) {
        toast(ex.message, 'error', 5000);
      }
    });
  }

  /* ---------- Seguridad ---------- */
  function fuerzaClave(c) {
    let s = 0;
    if (c.length >= 8) s++;
    if (c.length >= 12) s++;
    if (/[a-z]/.test(c) && /[A-Z]/.test(c)) s++;
    if (/\d/.test(c)) s++;
    if (/[^A-Za-z0-9]/.test(c)) s++;
    return s;
  }

  function errorCred(nombre, mensaje) {
    const input = $('#credForm').elements[nombre];
    const campo = input.closest('.field');
    campo.classList.toggle('is-invalid', !!mensaje);
    $('.field__error', campo).textContent = mensaje || '';
  }

  async function guardarCredenciales(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const usuarioNuevo = f.elements.usuarioNuevo.value.trim();
    const claveActual = f.elements.claveActual.value;
    const claveNueva = f.elements.claveNueva.value;
    const confirmacion = f.elements.confirmar.value;

    const errores = {
      usuarioNuevo: /^[A-Za-z0-9._@-]{4,40}$/.test(usuarioNuevo) ? '' : '4 a 40 caracteres: letras, números, punto, guion, guion bajo o @',
      claveActual: claveActual ? '' : 'Escribe tu contraseña actual',
      claveNueva: claveNueva.length >= 8 && /[A-Za-z]/.test(claveNueva) && /\d/.test(claveNueva) ? '' : 'Mínimo 8 caracteres con letras y números',
      confirmar: confirmacion === claveNueva ? '' : 'Las contraseñas no coinciden'
    };
    let primero = null;
    Object.keys(errores).forEach((k) => {
      errorCred(k, errores[k]);
      if (errores[k] && !primero) primero = f.elements[k];
    });
    if (primero) {
      primero.focus();
      return;
    }

    const btn = $('button[type="submit"]', f);
    cargandoBoton(btn, true);
    try {
      const usuario = await B.credenciales({ claveActual, usuarioNuevo, claveNueva });
      state.usuario = usuario;
      state.porDefecto = false;
      $('#userLabel').textContent = usuario;
      $('#credUser').textContent = usuario;
      $('#defaultAlert').hidden = true;
      f.reset();
      f.elements.usuarioNuevo.value = usuario;
      $('#passMeter').style.width = '0';
      toast('Credenciales actualizadas. Úsalas en tu próximo inicio de sesión.');
    } catch (ex) {
      if (/actual/i.test(ex.message)) errorCred('claveActual', ex.message);
      toast(ex.message, 'error', 5000);
    } finally {
      cargandoBoton(btn, false);
    }
  }

  async function renderDiagnostico() {
    const ul = $('#diagList');
    ul.innerHTML = '<li class="check"><span></span><span>Comprobando…</span></li>';
    try {
      const chequeos = await B.diagnostico();
      ul.innerHTML = chequeos.map((c) => `
        <li class="check ${c.ok ? 'check--ok' : 'check--bad'}">
          ${icono(c.ok ? 'i-check' : 'i-alert')}
          <span>${esc(c.nombre)}<small>${esc(c.detalle || '')}</small></span>
        </li>`).join('');
    } catch (ex) {
      ul.innerHTML = `<li class="check check--bad">${icono('i-alert')}<span>No se pudo comprobar<small>${esc(ex.message)}</small></span></li>`;
    }
  }

  function exportar() {
    const datos = {
      tienda: 'NØRTE',
      exportado: new Date().toISOString(),
      productos: state.productos.map(paraGuardar),
      config: state.config
    };
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `norte-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Respaldo descargado');
  }

  /* En el servidor, las imágenes guardadas en modo local (data:) se suben como archivos */
  async function subirImagenesLocales(productos) {
    if (state.modo === 'local') return productos;
    let n = 0;
    for (const p of productos) {
      if (!Array.isArray(p.imagenes)) continue;
      for (let i = 0; i < p.imagenes.length; i++) {
        const src = String(p.imagenes[i] || '');
        if (src.startsWith('data:image/')) {
          p.imagenes[i] = await B.subirImagen(dataURLaArchivo(src, `importada-${i}.jpg`));
          n++;
        }
      }
    }
    if (n) toast(`${n} imágenes locales subidas al servidor`);
    return productos;
  }

  async function importar(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const datos = JSON.parse(await file.text());
      const productos = Array.isArray(datos) ? datos : datos && datos.productos;
      if (!Array.isArray(productos)) throw new Error('El archivo no contiene una lista de productos válida');
      const ok = await confirmar({
        titulo: 'Importar respaldo',
        texto: `Se reemplazará el catálogo actual por ${productos.length} productos${datos.config ? ' y la configuración de la tienda' : ''}.`,
        ok: 'IMPORTAR'
      });
      if (!ok) return;
      const normalizados = productos.map(normalizarProductoAdmin);
      await subirImagenesLocales(normalizados);
      await persistirProductos(normalizados);
      if (datos.config && typeof datos.config === 'object') {
        state.config = D.normalizarConfig(await B.guardarConfig(datos.config));
        renderConfigForm();
        notificarTienda();
      }
      toast('Respaldo importado correctamente');
    } catch (ex) {
      toast(ex instanceof SyntaxError ? 'El archivo no es un JSON válido' : ex.message, 'error', 5000);
    }
  }

  async function restaurarSemilla() {
    const ok = await confirmar({
      titulo: 'Restaurar catálogo de ejemplo',
      texto: 'Se reemplazarán todos tus productos y la configuración por los 10 productos de ejemplo.',
      ok: 'RESTAURAR'
    });
    if (!ok) return;
    try {
      const semilla = D.semilla();
      await persistirProductos(semilla.productos.map(normalizarProductoAdmin));
      state.config = D.normalizarConfig(await B.guardarConfig(semilla.config));
      renderConfigForm();
      notificarTienda();
      toast('Catálogo de ejemplo restaurado');
    } catch (ex) {
      toast(ex.message, 'error', 5000);
    }
  }

  function enlazarSeguridad() {
    $('#credForm').addEventListener('submit', guardarCredenciales);
    $('#credForm').addEventListener('input', (e) => {
      if (e.target.name) errorCred(e.target.name, '');
      if (e.target.name === 'claveNueva') {
        const s = fuerzaClave(e.target.value);
        const colores = ['var(--hot)', 'var(--hot)', '#ffb020', '#ffb020', 'var(--accent)', 'var(--wa)'];
        const textos = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte', 'Muy fuerte'];
        const bar = $('#passMeter');
        bar.style.width = (s / 5) * 100 + '%';
        bar.style.background = colores[s];
        $('#passHint').textContent = e.target.value ? `Seguridad: ${textos[s]}` : 'Mínimo 8 caracteres con letras y números';
      }
    });
    $('#exportBtn').addEventListener('click', exportar);
    $('#importFile').addEventListener('change', importar);
    $('#seedBtn').addEventListener('click', restaurarSemilla);
  }

  /* ---------- Conexión con GitHub ---------- */
  async function alConectarGithub(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const err = $('#ghError');
    const btn = $('#ghBtn');
    err.hidden = true;
    cargandoBoton(btn, true);
    try {
      const cfg = await conectarGithub(f.elements.owner.value, f.elements.repo.value, f.elements.branch.value, f.elements.token.value);
      f.elements.token.value = '';
      await entrar();
      toast(`Conectado a ${cfg.owner}/${cfg.repo}. Ya puedes publicar cambios.`);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      cargandoBoton(btn, false);
    }
  }

  async function usarModoLocal() {
    try { sessionStorage.setItem(SS_MODO_LOCAL, '1'); } catch (e) { /* nada */ }
    state.modo = 'local';
    B = Local;
    try { sessionStorage.setItem(SS_SESION, state.usuario); } catch (e) { /* nada */ }
    await entrar();
    toast('Modo local: los cambios solo se verán en este navegador', 'info', 5000);
  }

  async function desconectarGithub() {
    const ok = await confirmar({
      titulo: 'Desconectar GitHub',
      texto: 'Se borrará el token de este navegador. Para volver a publicar tendrás que pegarlo de nuevo.',
      ok: 'DESCONECTAR'
    });
    if (!ok) return;
    try { localStorage.removeItem(LS_GH); } catch (e) { /* nada */ }
    state.shas = {};
    mostrarConexionGithub();
  }

  /* ---------- Eventos generales ---------- */
  function enlazarEventos() {
    $('#loginForm').addEventListener('submit', alEnviarLogin);
    $('#ghForm').addEventListener('submit', alConectarGithub);
    $('#ghLocal').addEventListener('click', usarModoLocal);
    $('#ghDisconnect').addEventListener('click', desconectarGithub);
    $('#logoutBtn').addEventListener('click', cerrarSesion);
    $('#newProduct').addEventListener('click', () => abrirEditor(null));
    $('#prodList').addEventListener('click', accionLista);
    $('#prodSearch').addEventListener('input', debounce((e) => {
      state.busqueda = e.target.value;
      renderLista();
    }, 150));
    $('#prodFilter').addEventListener('change', (e) => {
      state.filtro = e.target.value;
      renderLista();
    });

    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) cambiarTab(tab.dataset.tab);
      const ir = e.target.closest('[data-goto-tab]');
      if (ir) cambiarTab(ir.dataset.gotoTab);
      const ver = e.target.closest('[data-toggle-pass]');
      if (ver) {
        const input = document.getElementById(ver.dataset.togglePass);
        const mostrar = input.type === 'password';
        input.type = mostrar ? 'text' : 'password';
        ver.innerHTML = icono(mostrar ? 'i-eye-off' : 'i-eye');
        ver.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#editor').hidden && $('#confirmDlg').hidden) cerrarEditor();
    });

    /* Imágenes rotas en el panel */
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && !t.dataset.rota) {
        t.dataset.rota = '1';
        t.removeAttribute('src');
        t.alt = 'Imagen no disponible';
      }
    }, true);

    window.addEventListener('beforeunload', (e) => {
      if (state.borrador && JSON.stringify(state.borrador) !== state.original) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    enlazarEditor();
    enlazarConfig();
    enlazarSeguridad();
  }

  /* ---------- Arranque ---------- */
  async function arrancar() {
    enlazarEventos();
    const det = await detectarModo();
    state.modo = det.modo;
    B = { servidor: Servidor, github: Github, local: Local }[state.modo];
    pintarModo();

    try {
      const est = det.estado || await B.estado();
      if (est.autenticado) {
        state.usuario = est.usuario;
        state.csrf = est.csrf || '';
        state.porDefecto = !!est.porDefecto;
        await continuarTrasLogin();
      } else {
        mostrarLogin();
      }
    } catch (ex) {
      mostrarLogin(ex.message);
    }
  }

  /* API mínima para pruebas automatizadas */
  window.NorteAdmin = { state, sha256, Local, abrirEditor, cerrarEditor, persistirProductos, cambiarTab };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
