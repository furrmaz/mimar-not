// Tanıtım sayfası: demo oynatıcı ve doğrudan indirme bağlantıları.
(() => {
  // --- Demo oynatıcı: not yazılır, ardından program → plan → kesit → cephe → 3D sırayla gösterilir.
  const NOTES = `Ayşe - Murat Yılmaz, 2 çocuk. Urla'da 22x30 arsa, güney bahçe tarafı.
İmar: TAKS 0.25, KAKS 0.50, 2 kat, hmax 6.50.
Zemin: geniş salon, şömine olsun. Açık mutfak, ada tezgah, yanında kiler. Misafir wc. Murat evden çalışıyor -> küçük çalışma odası.
Üst kat: ebeveyn + giyinme + banyo, 2 çocuk odası, ortak banyo, bahçeye bakan balkon.
Modern ama sıcak, ahşap + taş. Beşik çatı.`;
  const player = document.getElementById("player");
  const pre = document.getElementById("pNotes");
  const frames = [...document.querySelectorAll("#pFrames .p-frame")];
  const steps = [...document.querySelectorAll("#pSteps li")];
  if (player && pre && frames.length) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0, run = 0, visible = false, started = false;
    const show = (i) => {
      frames.forEach((f, k) => f.classList.toggle("on", k === i));
      steps.forEach((s, k) => { s.classList.toggle("on", k === i); s.classList.toggle("done", k < i); });
    };
    const wait = (ms, id) => new Promise((ok) => { timer = setTimeout(() => ok(id === run), ms); });
    const until = async (id) => { while (!visible) { if (!(await wait(300, id))) return false; } return id === run; };
    async function play() {
      const id = ++run;
      clearTimeout(timer);
      show(-1);
      player.classList.remove("ready");
      if (reduce) { pre.textContent = NOTES; player.classList.add("ready"); show(1); return; }
      pre.textContent = "";
      for (let i = 0; i < NOTES.length; i += 2) {
        if (!(await until(id))) return;
        pre.textContent = NOTES.slice(0, i + 2);
        pre.scrollTop = pre.scrollHeight;
        if (!(await wait(18, id))) return;
      }
      if (!(await wait(500, id))) return;
      player.classList.add("ready");
      for (let k = 0; k < frames.length; k++) {
        if (!(await until(id))) return;
        show(k);
        if (!(await wait(k === 0 ? 3200 : k === frames.length - 1 ? 4000 : 2600, id))) return;
      }
    }
    steps.forEach((s, k) => s.addEventListener("click", () => { run++; clearTimeout(timer); pre.textContent = NOTES; player.classList.add("ready"); show(k); }));
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !started) { started = true; play(); }
    }, { threshold: 0.35 }).observe(player);
    document.getElementById("pReplay")?.addEventListener("click", () => play());
    if (reduce) { pre.textContent = NOTES; show(1); }
  }

  // --- Menü: kahraman alanından çıkınca opak olur.
  const nav = document.getElementById("nav");
  if (nav && document.body.classList.contains("home")) {
    const onScroll = () => nav.classList.toggle("solid", scrollY > 40);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // --- Kaydırınca belirme
  const els = document.querySelectorAll("main > section:not(.hero) > *, .grid article, .steps li, .plan");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => { el.classList.add("reveal"); io.observe(el); });
  }

  // --- İndirme: GitHub'daki son sürümün dosyalarına doğrudan bağlan. Olmazsa sürümler sayfası kalır.
  const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
  fetch("https://api.github.com/repos/furrmaz/mimar-not/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((rel) => {
      const assets = rel.assets || [];
      const pick = (re) => assets.find((a) => re.test(a.name));
      const set = (id, a) => {
        if (!a) return;
        const link = document.getElementById(id);
        const info = document.getElementById(id + "Info");
        link.href = a.browser_download_url;
        if (info) info.textContent = `${rel.tag_name || rel.name || ""} · ${mb(a.size)}`.replace(/^ · /, "");
      };
      set("dlWin", pick(/Kurulum.*\.exe$/i) || pick(/\.exe$/i));
      set("dlApk", pick(/\.apk$/i));
    })
    .catch(() => {});
})();
