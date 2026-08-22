/* =============================================================
   La Mer — Masía Barcelona
   Interacciones de la página. Sin dependencias externas.
   ============================================================= */
(function () {
  "use strict";

  /* --- Año en el pie --------------------------------------- */
  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* --- Cabecera sólida al hacer scroll ---------------------- */
  var header = document.getElementById("header");

  function syncHeader() {
    if (!header) return;
    header.classList.toggle("is-solid", window.scrollY > 40);
  }

  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      syncHeader();
      ticking = false;
    });
  }, { passive: true });
  syncHeader();

  /* --- Menú móvil ------------------------------------------- */
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("nav");

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Abrir menú");
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });

    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) closeNav();
    });
  }

  /* --- Aparición progresiva de secciones -------------------- */
  var revealables = document.querySelectorAll(".reveal");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealables.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

    revealables.forEach(function (el) { observer.observe(el); });
  }

  /* --- Formulario de consulta -------------------------------
     La página es estática: componemos un mailto con los datos.
     ---------------------------------------------------------- */
  var form = document.getElementById("bookingForm");
  var status = document.getElementById("formStatus");

  function value(id) {
    var el = document.getElementById(id);
    return el && el.value ? el.value.trim() : "";
  }

  if (form) {
    // Fechas por defecto: mañana y pasado mañana.
    var entrada = document.getElementById("entrada");
    var salida = document.getElementById("salida");
    var today = new Date();

    function isoPlus(days) {
      var d = new Date(today.getTime() + days * 86400000);
      return d.toISOString().slice(0, 10);
    }

    if (entrada && salida) {
      entrada.min = isoPlus(0);
      salida.min = isoPlus(1);
      entrada.addEventListener("change", function () {
        if (!entrada.value) return;
        salida.min = entrada.value;
        if (salida.value && salida.value <= entrada.value) salida.value = "";
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var nombre = value("nombre");
      var email = value("email");

      if (!nombre || !email) {
        if (status) {
          status.style.color = "#8f4a2e";
          status.textContent = "Indique al menos su nombre y su correo electrónico.";
        }
        (nombre ? document.getElementById("email") : document.getElementById("nombre")).focus();
        return;
      }

      var lineas = [
        "Nombre: " + nombre,
        "Correo: " + email,
        "Entrada: " + (value("entrada") || "por concretar"),
        "Salida: " + (value("salida") || "por concretar"),
        "Personas: " + (value("personas") || "-"),
        "Motivo: " + value("motivo"),
        "",
        value("mensaje") || "(sin mensaje adicional)"
      ];

      var asunto = "Consulta de reserva - " + value("motivo") + " - " + nombre;
      var href = "mailto:contact@lamerbcn.com" +
        "?subject=" + encodeURIComponent(asunto) +
        "&body=" + encodeURIComponent(lineas.join("\n"));

      window.location.href = href;

      if (status) {
        status.style.color = "";
        status.textContent = "Abriendo su gestor de correo con la consulta preparada…";
      }
    });
  }
})();

/* =============================================================
   Fondos: parallax y fotografías reales opcionales
   ============================================================= */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Fotografías reales ------------------------------------
     Cada escena declara data-photo="img/loquesea.jpg". Si el
     archivo existe, se superpone a la ilustración; si no existe,
     no ocurre nada y la ilustración sigue siendo el fondo.
     Así, para poner fotos de verdad basta con dejarlas en img/
     con el nombre esperado: no hay que tocar el código.
     ----------------------------------------------------------- */
  Array.prototype.forEach.call(
    document.querySelectorAll("[data-photo]"),
    function (scene) {
      var src = scene.getAttribute("data-photo");
      if (!src) return;

      var probe = new Image();
      probe.onload = function () {
        var img = document.createElement("img");
        img.className = "scene__photo";
        img.src = src;
        img.alt = "";
        img.decoding = "async";
        img.setAttribute("aria-hidden", "true");
        scene.appendChild(img);
        window.requestAnimationFrame(function () {
          img.classList.add("is-loaded");
        });
      };
      // Si falla (lo normal mientras no haya fotos) no hacemos nada.
      probe.onerror = function () {};
      probe.src = src;
    }
  );

  /* --- Parallax ----------------------------------------------
     Las capas de fondo van escaladas un 16%, así que disponemos
     de un 8% de holgura a cada lado; nunca desplazamos más de un
     7,5% para que no asome el borde.
     ----------------------------------------------------------- */
  var scenes = document.querySelectorAll(".scene[data-parallax]");
  if (!scenes.length || reduce) return;

  var MAX_SHIFT_RATIO = 0.075;

  function update() {
    var vh = window.innerHeight;
    Array.prototype.forEach.call(scenes, function (scene) {
      var r = scene.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;

      var amount = parseFloat(scene.getAttribute("data-parallax")) || 0.5;
      // -1 cuando la escena entra por abajo, +1 cuando sale por arriba
      var progress = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      progress = Math.max(-1, Math.min(1, progress));

      var shift = -progress * r.height * MAX_SHIFT_RATIO * amount;
      scene.style.setProperty("--par", shift.toFixed(1) + "px");
    });
  }

  var queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(function () {
      update();
      queued = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();
