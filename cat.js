// 读书小猫：一只靠你学英语长大的猫。这一版只存在本机（localStorage），不上云。
// 别的模块不直接调这里的函数，只往 document 上发事件（btr:lookup / btr:wordSaved /
// btr:reviewCorrect / btr:pageFlip），这里监听着赚鱼干、做反应——小猫关掉或删掉，
// 原来的功能完全不受影响。
// 小猫有两种出场方式：阅读页里 #catCompanion 是角落的桌宠（能拖、能收起，只陪读不喂食）；
// 首页"小猫"tab 里 #catStage 是大号的猫，在那儿喂鱼干、看体重和排行榜。
(function () {
  const KEY = "readingCat";
  const CAT_NAME = "团子";
  const IDLE_MS = 3 * 60 * 1000;

  function load() {
    try {
      return Object.assign({ fish: 0, weight: 2000, muted: false, hidden: false, pos: null }, JSON.parse(localStorage.getItem(KEY)));
    } catch {
      return { fish: 0, weight: 2000, muted: false, hidden: false, pos: null };
    }
  }
  let state = load();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }

  // ---------- 声音：全部用 Web Audio 现场合成，没有音频文件 ----------
  let ac = null;
  function audio() {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume(); // iPad 上第一次要在点击里唤醒
    return ac;
  }
  function tone(type, f0, f1, dur, peak, delay = 0) {
    if (state.muted) return;
    const c = audio(), t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sounds = {
    pop: () => tone("sine", 700, 280, 0.08, 0.22),
    ding: () => {
      tone("sine", 1320, 1320, 0.3, 0.16);
      tone("sine", 1760, 1760, 0.35, 0.11, 0.07);
    },
    aah: () => tone("triangle", 520, 780, 0.22, 0.18),
    nom: () => [0, 0.16, 0.32].forEach((d, i) => tone("sine", 560 + i * 40, 820 + i * 60, 0.09, 0.2, d)),
    meow: () => {
      if (state.muted) return;
      const c = audio(), t = c.currentTime;
      const o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(640, t);
      o.frequency.linearRampToValueAtTime(1040, t + 0.14);
      o.frequency.linearRampToValueAtTime(760, t + 0.42);
      lfo.frequency.value = 8;
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      bp.type = "bandpass";
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(1100, t);
      bp.frequency.linearRampToValueAtTime(1800, t + 0.15);
      bp.frequency.linearRampToValueAtTime(1200, t + 0.42);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      o.connect(bp).connect(g).connect(c.destination);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.5);
      lfo.stop(t + 0.5);
    },
  };

  // ---------- 赚鱼干：任何页面都在记，不依赖陪读形象在不在 ----------
  function addFish(n, label) {
    state.fish += n;
    save();
    react("catch", label);
    refreshPanel();
  }
  document.addEventListener("btr:wordSaved", () => addFish(1, "+1 小鱼干"));
  document.addEventListener("btr:reviewCorrect", () => addFish(1, "+1 小鱼干"));

  // ---------- 陪读形象 ----------
  const SVG = `<svg viewBox="0 0 220 220" aria-hidden="true"><g class="rcAll">
  <path class="rcTail o" d="M140 198 C168 204 182 186 176 168 C173 160 164 160 166 168"/>
  <path d="M166 168 C163 160 173 158 176 166" fill="#D9B48F"/>
  <path d="M72 204 C62 186 66 160 84 150 C96 144 124 144 136 150 C154 160 158 186 148 204 Z" fill="#FFF8EE"/>
  <path class="o" d="M72 204 C62 186 66 160 84 150 C96 144 124 144 136 150 C154 160 158 186 148 204 Z"/>
  <ellipse cx="90" cy="206" rx="14" ry="9" fill="#FFF8EE"/><ellipse class="o" cx="90" cy="206" rx="14" ry="9"/>
  <ellipse cx="130" cy="206" rx="14" ry="9" fill="#FFF8EE"/><ellipse class="o" cx="130" cy="206" rx="14" ry="9"/>
  <path class="o" d="M86 210 L86 205 M94 210 L94 205 M126 210 L126 205 M134 210 L134 205" style="stroke-width:2"/>
  <path d="M122 172 C132 168 142 172 140 182 C138 190 126 190 122 184 Z" fill="#FFF8EE"/>
  <path class="o" d="M122 172 C132 168 142 172 140 182 C138 190 126 190 122 184"/>
  <g class="rcHead"><g transform="translate(0 14)">
    <g class="rcEars">
      <path d="M58 84 C52 60 56 40 64 36 C74 40 88 54 92 64 Z" fill="#D9B48F"/>
      <path d="M162 84 C168 60 164 40 156 36 C146 40 132 54 128 64 Z" fill="#FFF8EE"/>
      <path d="M150 50 C156 46 159 54 158 66 L146 60 Z" fill="#F4C0D1"/>
      <path class="o" d="M58 84 C52 60 56 40 64 36 C74 40 88 54 92 64"/>
      <path class="o" d="M162 84 C168 60 164 40 156 36 C146 40 132 54 128 64"/>
    </g>
    <path d="M44 104 C40 74 70 58 110 58 C150 58 180 74 176 104 C173 128 146 140 110 140 C74 140 47 128 44 104 Z" fill="#FFF8EE"/>
    <path d="M48 96 C52 74 70 62 96 60 C92 74 92 90 98 104 C84 118 60 116 48 96 Z" fill="#D9B48F"/>
    <path class="o" d="M44 104 C40 74 70 58 110 58 C150 58 180 74 176 104 C173 128 146 140 110 140 C74 140 47 128 44 104 Z"/>
    <ellipse class="rcEye" cx="88" cy="102" rx="5.6" ry="7.6" fill="#2C2C2A"/>
    <ellipse class="rcEye" cx="132" cy="102" rx="5.6" ry="7.6" fill="#2C2C2A"/>
    <circle class="rcEye" cx="90.3" cy="98.6" r="2" fill="#fff"/>
    <circle class="rcEye" cx="134.3" cy="98.6" r="2" fill="#fff"/>
    <path class="o rcSleepEye" d="M80 104 Q88 110 96 104 M124 104 Q132 110 140 104" style="stroke-width:2.6"/>
    <path d="M107 110 L113 110 L110 113 Z" fill="#D4537E" stroke="#5B4636" stroke-width="1.4" stroke-linejoin="round"/>
    <path class="o rcMouth" d="M103 116 Q106.5 120 110 116 Q113.5 120 117 116" style="stroke-width:2.2"/>
    <ellipse class="rcMouthOpen" cx="110" cy="119" rx="6.5" ry="6" fill="#993556" stroke="#5B4636" stroke-width="2"/>
    <ellipse cx="72" cy="116" rx="10" ry="5.5" fill="#F4C0D1" opacity=".8"/>
    <ellipse cx="148" cy="116" rx="10" ry="5.5" fill="#F4C0D1" opacity=".8"/>
  </g></g>
  <g class="rcWave">
    <path d="M84 168 C78 156 80 142 88 140 C96 140 98 152 94 166 Z" fill="#FFF8EE"/>
    <path class="o" d="M84 168 C78 156 80 142 88 140 C96 140 98 152 94 166"/>
    <path class="o" d="M85 145 L85 149 M90 144 L90 148" style="stroke-width:1.8"/>
  </g>
  <g class="rcFish"><g transform="translate(102 128)"><path d="M0 5 C4 0 12 0 16 5 C12 10 4 10 0 5 Z M16 5 L22 1 L22 9 Z" fill="#85B7EB" stroke="#5B4636" stroke-width="1.6" stroke-linejoin="round"/><circle cx="4" cy="4.5" r="1" fill="#2C2C2A"/></g></g>
  <text class="rcZzz" x="160" y="44" font-size="22" fill="#8a7a66">z z</text>
</g></svg>`;

  const companionMount = document.getElementById("catCompanion");
  const stageMount = document.getElementById("catStage");
  const mount = companionMount || stageMount;
  let el = null;
  let idleTimer = null;

  function flash(cls, ms) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el && el.classList.remove(cls), ms);
  }
  function popText(text) {
    if (!el) return;
    const s = document.createElement("span");
    s.className = "rcPop";
    s.textContent = text;
    el.appendChild(s);
    setTimeout(() => s.remove(), 1250);
  }
  function wake() {
    if (el) el.classList.remove("sleep");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => el && el.classList.add("sleep"), IDLE_MS);
  }

  function react(kind, label) {
    if (!el) return;
    wake();
    if (kind === "lookup") flash("perk", 1200); // 查词很频繁，不出声
    else if (kind === "catch") {
      flash("open", 700);
      flash("catch", 460);
      sounds.ding();
      popText(label);
    } else if (kind === "tap") {
      sounds.pop();
      flash("squish", 200);
      flash("waving", 680);
      setTimeout(sounds.meow, 90);
      popText("喵～");
    }
  }

  function render() {
    if (!mount) return;
    mount.innerHTML = "";
    el = null;
    if (stageMount) {
      el = document.createElement("div");
      el.className = "readingCat big";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${CAT_NAME}，点一下摸摸它`);
      el.innerHTML = SVG;
      el.addEventListener("click", () => react("tap"));
      mount.appendChild(el);
      wake();
      return;
    }
    if (state.hidden) {
      const back = document.createElement("button");
      back.className = "readingCatBack";
      back.title = "叫小猫回来";
      back.setAttribute("aria-label", "叫小猫回来");
      back.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="#5B4636"><ellipse cx="12" cy="15.5" rx="4.6" ry="3.8"/><circle cx="6.3" cy="10.2" r="2"/><circle cx="9.8" cy="6.8" r="2"/><circle cx="14.2" cy="6.8" r="2"/><circle cx="17.7" cy="10.2" r="2"/></svg>';
      back.addEventListener("click", () => {
        state.hidden = false;
        save();
        render();
        react("tap");
      });
      mount.appendChild(back);
      return;
    }
    el = document.createElement("div");
    el.className = "readingCat";
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "陪读小猫，点一下摸摸它");
    el.innerHTML = SVG;
    if (state.pos) {
      el.style.left = `${Math.min(state.pos.x, innerWidth - 92)}px`;
      el.style.top = `${Math.min(state.pos.y, innerHeight - 88)}px`;
      el.style.bottom = "auto";
    }
    mount.appendChild(el);
    bindDrag(el);
    wake();
  }

  // 拖动换位置；没怎么动就当成"点了一下"；按住不动 0.7 秒收起（再点爪印叫回来）。
  // 收起用长按不用双击：iPad 上双击不一定派发 dblclick
  function bindDrag(node) {
    let start = null;
    let holdTimer = null;
    node.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); // 别让翻页库把这次按下当成翻页手势
      const r = node.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
      try {
        node.setPointerCapture(e.pointerId);
      } catch {}
      holdTimer = setTimeout(() => {
        start = null;
        state.hidden = true;
        save();
        render();
      }, 700);
    });
    node.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      clearTimeout(holdTimer);
      start.moved = true;
      node.style.bottom = "auto";
      node.style.left = `${Math.max(0, Math.min(innerWidth - 92, start.left + dx))}px`;
      node.style.top = `${Math.max(0, Math.min(innerHeight - 88, start.top + dy))}px`;
    });
    node.addEventListener("pointerup", () => {
      clearTimeout(holdTimer);
      if (!start) return;
      if (start.moved) {
        state.pos = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
        save();
      } else react("tap");
      start = null;
    });
    node.addEventListener("pointercancel", () => {
      clearTimeout(holdTimer);
      start = null;
    });
  }

  document.addEventListener("btr:lookup", () => react("lookup"));
  document.addEventListener("btr:pageFlip", wake);
  document.addEventListener("pointerdown", wake, true);

  // ---------- "小猫"页面：喂鱼干、体重、排行榜 ----------
  let feeding = false;
  function feed() {
    if (!el || feeding) return;
    wake();
    if (state.fish <= 0) {
      sounds.pop();
      popText("没有小鱼干了，去读书吧");
      return;
    }
    feeding = true;
    state.fish--;
    save();
    refreshPanel();
    el.classList.add("open", "catch");
    sounds.aah();
    setTimeout(() => {
      el.classList.remove("catch");
      el.classList.add("chew");
      sounds.nom();
    }, 460);
    setTimeout(() => {
      el.classList.remove("chew", "open");
      state.weight += 10;
      save();
      refreshPanel();
      popText("+10 克");
      flash("squish", 200);
      feeding = false;
    }, 1060);
  }

  const $ = (id) => document.getElementById(id);
  function refreshPanel() {
    if (!$("catFish")) return;
    $("catFish").textContent = state.fish;
    $("catWeight").textContent = `${state.weight.toLocaleString()} 克`;
    $("catFeedBtn").setAttribute("aria-label", `喂一条小鱼干，还剩 ${state.fish} 条`);
    $("catMuteBtn").textContent = state.muted ? "声音：关" : "声音：开";
    // 排行榜按体重排。现在只有一只猫，以后解锁了新猫（或者有了别的用户）往这个数组里加就行
    const cats = [{ name: CAT_NAME, weight: state.weight }].sort((a, b) => b.weight - a.weight);
    $("catBoard").innerHTML = cats
      .map((c, i) => `<li><span class="rank">${i + 1}</span><span class="name">${c.name}</span><span class="kg">${c.weight.toLocaleString()} 克</span></li>`)
      .join("");
  }
  if ($("catFeedBtn")) {
    $("catFeedBtn").addEventListener("click", feed);
    $("catMuteBtn").addEventListener("click", () => {
      state.muted = !state.muted;
      save();
      refreshPanel();
      sounds.pop();
    });
    refreshPanel();
  }

  render();

  // 给"我的小猫"页面（下一步）和静音开关用
  window.readingCat = {
    get state() {
      return state;
    },
    setMuted(m) {
      state.muted = m;
      save();
    },
    sounds,
  };
})();
