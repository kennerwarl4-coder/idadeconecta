/* Idade Conecta · interações da página
   - caneta: gera os círculos e setas "à mão" das ilustrações
   - simulador do hero
   - carrossel "Dá uma espiadinha"
   - aparições ao rolar
*/
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var r1 = function (n) { return Math.round(n * 10) / 10; };

  /* ---------- Caneta: círculos e setas desenhados à mão ---------- */
  // data-circle="cx cy rx ry"  → laço que não fecha certinho, como caneta de verdade
  function penCircle(cx, cy, rx, ry) {
    var p = function (a, b) { return r1(cx + rx * a) + ' ' + r1(cy + ry * b); };
    return 'M' + p(.92, -.62) +
      ' C' + p(.45, -1.12) + ' ' + p(-.98, -.98) + ' ' + p(-1.02, .08) +
      ' C' + p(-1.04, 1.02) + ' ' + p(.28, 1.16) + ' ' + p(.98, .46) +
      ' C' + p(1.18, .02) + ' ' + p(1.02, -.86) + ' ' + p(.42, -1.14);
  }
  // data-arrow="x1 y1 x2 y2 curva" → seta curva com ponta
  function penArrow(x1, y1, x2, y2, bend) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    var cx = (x1 + x2) / 2 - dy * bend, cy = (y1 + y2) / 2 + dx * bend;
    var a = Math.atan2(y2 - cy, x2 - cx), h = Math.min(16, len * .3), s = .48;
    return 'M' + x1 + ' ' + y1 + ' Q' + r1(cx) + ' ' + r1(cy) + ' ' + x2 + ' ' + y2 +
      ' M' + r1(x2 - h * Math.cos(a - s)) + ' ' + r1(y2 - h * Math.sin(a - s)) + ' L' + x2 + ' ' + y2 +
      ' L' + r1(x2 - h * Math.cos(a + s)) + ' ' + r1(y2 - h * Math.sin(a + s));
  }
  document.querySelectorAll('.pen').forEach(function (el) {
    var c = el.getAttribute('data-circle'), a = el.getAttribute('data-arrow'), v;
    if (c) { v = c.split(' ').map(Number); el.setAttribute('d', penCircle(v[0], v[1], v[2], v[3])); }
    if (a) { v = a.split(' ').map(Number); el.setAttribute('d', penArrow(v[0], v[1], v[2], v[3], v[4] || 0)); }
    el.setAttribute('pathLength', '1');
  });

  /* ---------- Aparições ao rolar ---------- */
  var revealEls = document.querySelectorAll('[data-reveal], .sheet');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: .18, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Simulador ---------- */
  var sim = document.getElementById('simulador');
  if (sim) {
    var svg = document.getElementById('simSvg');
    var note = document.getElementById('simNote');
    var say = document.getElementById('simSay');
    var stepLabel = document.getElementById('simStep');
    var again = document.getElementById('simAgain');
    var timerEl = document.getElementById('simTimer');
    var durEl = document.getElementById('simDur');
    var confetti = document.getElementById('confetti');
    var screens = svg.querySelectorAll('.scr');
    var step = 1, holdStart = 0, holdTick = null, holdAuto = null, msgTimer = null, holding = false;

    var TEXT = {
      1: 'Toque na conversa da sua neta, a Júlia.',
      2: 'Encoste o dedo no botão verde e <strong>segure</strong> para gravar o áudio.',
      3: 'Está gravando! Fale à vontade e <strong>solte o dedo</strong> para enviar.',
      4: 'Pronto! A sua neta recebeu.'
    };
    var END = '<small>Viu? É assim que cada guia funciona. E são mais de 500.</small>';

    function show(n) {
      step = n;
      screens.forEach(function (s) {
        var on = Number(s.getAttribute('data-scr')) === n;
        s.classList.toggle('is-on', on);
        s.classList.remove('is-drawn');
        s.querySelectorAll('.hot').forEach(function (h) { h.setAttribute('tabindex', on ? '0' : '-1'); });
      });
      // redesenha a caneta da tela nova
      var cur = svg.querySelector('.scr.is-on');
      requestAnimationFrame(function () { requestAnimationFrame(function () { cur.classList.add('is-drawn'); }); });
      stepLabel.textContent = n < 4 ? 'passo ' + n + ' de 4' : 'passo 4 de 4 ✓';
      say.innerHTML = TEXT[n] + (n === 4 ? END : '');
      note.classList.toggle('is-done', n === 4);
      again.hidden = n !== 4;
    }

    function hint(html) {
      clearTimeout(msgTimer);
      say.innerHTML = html;
      note.classList.remove('is-shake'); void note.offsetWidth; note.classList.add('is-shake');
      msgTimer = setTimeout(function () { if (step < 3) say.innerHTML = TEXT[step]; }, 2600);
    }

    function fmt(ms) { var s = Math.floor(ms / 1000); return '0:' + (s < 10 ? '0' : '') + s; }

    function startHold() {
      if (step !== 2 || holding) return;
      holding = true;
      holdStart = Date.now();
      clearTimeout(msgTimer);
      timerEl.textContent = '0:00';
      show(3);
      holdTick = setInterval(function () { timerEl.textContent = fmt(Date.now() - holdStart); }, 250);
      holdAuto = setTimeout(endHold, 6000); // segurou demais: envia sozinho
    }

    function endHold() {
      if (!holding) return;
      holding = false;
      clearInterval(holdTick); clearTimeout(holdAuto);
      var held = Date.now() - holdStart;
      if (held < 650) {
        show(2);
        hint('Foi rapidinho! <strong>Segure</strong> o dedo no botão por uns 2 segundinhos.');
        return;
      }
      durEl.textContent = fmt(Math.max(held, 1000));
      show(4);
      burst();
    }

    function burst() {
      if (reduceMotion) return;
      var colors = ['#C0392B', '#1F4E96', '#EFC63C', '#F9C9C0', '#2C6E58', '#FAD7A8'];
      var frag = document.createDocumentFragment();
      for (var i = 0; i < 36; i++) {
        var p = document.createElement('i');
        var ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 130;
        p.style.background = colors[i % colors.length];
        p.style.setProperty('--x', Math.round(Math.cos(ang) * dist) + 'px');
        p.style.setProperty('--y', Math.round(Math.sin(ang) * dist + 60) + 'px');
        p.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
        p.style.animationDelay = (Math.random() * .15) + 's';
        if (i % 3 === 0) { p.style.width = '8px'; p.style.height = '8px'; p.style.borderRadius = '50%'; }
        frag.appendChild(p);
      }
      confetti.innerHTML = '';
      confetti.appendChild(frag);
      setTimeout(function () { confetti.innerHTML = ''; }, 2200);
    }

    // toque no lugar certo / errado
    var justHeld = false;
    svg.addEventListener('click', function (e) {
      if (justHeld) { justHeld = false; return; } // clique que sobra depois de segurar o microfone
      var hot = e.target.closest('.hot');
      if (step === 1) {
        if (hot && hot.getAttribute('data-hot') === '1') show(2);
        else hint('Quase! É onde está o <strong>círculo vermelho</strong>.');
      } else if (step === 2 && !hot) {
        hint('Quase! É o <strong>botão verde</strong> lá embaixo, dentro do círculo.');
      }
    });

    // segurar o microfone (dedo ou mouse)
    var mic = svg.querySelector('[data-hot="2"]');
    mic.addEventListener('pointerdown', function (e) {
      if (step !== 2) return;
      e.preventDefault();
      justHeld = true;
      setTimeout(function () { justHeld = false; }, 8000);
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      startHold();
    });
    svg.addEventListener('pointerup', endHold);
    svg.addEventListener('pointercancel', endHold);
    window.addEventListener('blur', endHold);
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // teclado: Enter/Espaço
    svg.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var hot = e.target.closest('.hot');
      if (!hot) return;
      e.preventDefault();
      if (e.repeat) return;
      if (hot.getAttribute('data-hot') === '1' && step === 1) { show(2); focusHot(2); }
      else if (hot.getAttribute('data-hot') === '2') startHold();
    });
    // no document: ao trocar de tela o foco sai do botão, e o keyup precisa chegar mesmo assim
    document.addEventListener('keyup', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && holding) { endHold(); if (step === 2) focusHot(2); else again.focus(); }
    });
    function focusHot(n) { var h = svg.querySelector('[data-hot="' + n + '"]'); if (h && h.focus) h.focus(); }

    again.addEventListener('click', function () { show(1); focusHot(1); });

    // desenha a primeira caneta quando o simulador aparece
    if ('IntersectionObserver' in window) {
      var started = false;
      var simIo = new IntersectionObserver(function (en) {
        var vis = en[0].isIntersecting;
        sim.classList.toggle("is-off", !vis); // pausa as animações contínuas fora da tela
        if (vis && !started) { started = true; show(step); }
      }, { threshold: 0.2 });
      sim.classList.add("is-off");
      simIo.observe(sim);
    } else { show(1); }
  }

  /* ---------- Carrossel ---------- */
  var track = document.getElementById('peekTrack');
  if (track) {
    var items = track.children;
    var nowEl = document.getElementById('peekNow');
    var prev = document.querySelector('[data-peek="-1"]');
    var next = document.querySelector('[data-peek="1"]');
    document.getElementById('peekAll').textContent = items.length;

    // posições dos cartões medidas uma vez (e de novo só ao redimensionar)
    var stops = [], maxLeft = 0, shown = -1;
    var measure = function () {
      var pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
      stops = Array.prototype.map.call(items, function (el) { return el.offsetLeft - pad; });
      maxLeft = track.scrollWidth - track.clientWidth;
    };
    var current = function () {
      var left = track.scrollLeft, best = 0, bestD = Infinity;
      for (var i = 0; i < stops.length; i++) {
        var d = Math.abs(stops[i] - left);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };
    var update = function () {
      var i = current(), left = track.scrollLeft;
      if (i !== shown) { shown = i; nowEl.textContent = i + 1; }
      prev.disabled = left < 4;
      next.disabled = left >= maxLeft - 4;
    };
    var go = function (dir) {
      var i = Math.min(items.length - 1, Math.max(0, current() + dir));
      track.scrollTo({ left: stops[i], behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    measure();
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { measure(); update(); }, 150); });
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    });
    var raf = 0;
    track.addEventListener('scroll', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }


  /* ---------- Botões que levam ao card de oferta: rolagem suave ---------- */
  var offerCard = document.getElementById("oferta-card");
  if (offerCard) {
    Array.prototype.forEach.call(document.querySelectorAll("a[href=\"#oferta-card\"]"), function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        // desenha as seções do caminho para a posição final ficar exata
        document.documentElement.classList.add("cv-off");
        offerCard.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        if (history.replaceState) history.replaceState(null, "", "#oferta-card");
      });
    });
  }

  /* ---------- Checkout: leva junto as UTMs do anúncio ---------- */
  if (location.search) {
    Array.prototype.forEach.call(document.querySelectorAll('a[href="checkout.html"]'), function (link) {
      link.setAttribute('href', 'checkout.html' + location.search);
    });
  }

})();
