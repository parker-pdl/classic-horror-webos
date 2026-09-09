/* ==========================================================
   Free Classic Movies & TV — web app

   One feed, fourteen rows, an HTML5 player. Everything the Roku
   channel does, minus the remote control.

   Two rules carried over from the channel deliberately:

     1. Poster art is only ever loaded from Parker's own buckets.
        Anything else in the feed renders as a title card. This is
        the same whitelist as PosterPolicy.brs — we do not hotlink
        artwork whose rights we cannot vouch for.

     2. A title with no artwork is not a broken card. It gets a
        serif title card tinted to its row, which is a design, not
        an apology.
   ========================================================== */

(function () {
    "use strict";

    const FEED_URL = "https://roku-feed.parkerdatalinktv.workers.dev/feed.json";

    /* House bumpers that run ahead of a full-length feature. Each entry
       lists the same file on two hosts: the custom domain first, the raw
       bucket as a standby if that ever stops resolving.

       Which one plays follows the row the film sits in — a horror feature
       gets the horror trailer, everything else gets the general intro. */
    const BUMPER_SETS = {
        horror: [
            // Cut from the 77-second original: the slow letter-by-letter
            // open is gone, everything from the title card on is intact,
            // including the full musical ending.
            "https://media.parkerdatalink.com/hellscape-trailer-46s.mp4",
            "https://pub-4a1ee3e926844caba75e0b33d0b2208d.r2.dev/hellscape-trailer-46s.mp4",
        ],
        general: [
            "https://media.parkerdatalink.com/5BIG.Intro.mp4",
            "https://pub-4a1ee3e926844caba75e0b33d0b2208d.r2.dev/5BIG.Intro.mp4",
        ],
    };

    // Rows the horror trailer must never run against, whatever else matches.
    const NO_HORROR_AD = ["cartoon", "animation", "saturday morning"];

    function bumpersFor(item) {
        const cat = (item._category || "").toLowerCase();

        if (NO_HORROR_AD.some(w => cat.indexOf(w) > -1)) return BUMPER_SETS.general;

        if (cat.indexOf("horror") > -1 || cat.indexOf("after dark") > -1 ||
            cat.indexOf("cult") > -1) {
            return BUMPER_SETS.horror;
        }
        return BUMPER_SETS.general;
    }

    // Nothing in the feed says how long a title runs, so the film itself
    // is asked before it plays. Forty minutes is the line between a short
    // and a feature; a cartoon should never carry an advert.
    const FEATURE_MIN_SECS = 40 * 60;
    const PROBE_TIMEOUT_MS = 9000;

    /* Mid-roll. Cartoons and other shorts carry no pre-roll — nobody sits
       through an advert to reach a seven-minute cartoon — so the break
       goes in the middle instead, once, at the halfway mark.

       The three house spots are served by the ad worker; one is picked
       at random per break. Empty the list to switch mid-rolls off. */
    const MIDROLL_HOST = "https://pdl-ads.parkerdatalinktv.workers.dev/media/";
    const MIDROLL = [
        "spot-classic-cartoons.mp4",
        "spot-horror-solitaire.mp4",
        "spot-horror-wallpapers.mp4",
    ].map(name => MIDROLL_HOST + name);

    /* One spot per break, chosen at random, so a viewer working through a
       reel of cartoons does not see the same fifteen seconds every time. */
    function pickMidroll() {
        return MIDROLL[Math.floor(Math.random() * MIDROLL.length)];
    }

    // Only worth interrupting something with a real middle to it.
    const MIDROLL_MIN_SECS = 4 * 60;
    const MIDROLL_MAX_SECS = FEATURE_MIN_SECS;   // features get the pre-roll
    const STORE_KEY = "chmovies.progress.v1";
    const RESUME_MIN = 30;      // seconds watched before we offer to resume
    const RESUME_DONE = 0.94;   // past this fraction, call it watched

    /* The native Android shell, when we are running inside it. In a
       plain browser this is undefined and every call below is skipped.
       The shell uses it to pull the banner out of the way while a film
       is playing, and to count films for its interstitial. */
    const SHELL = (typeof window !== "undefined" && window.MoviesAds) || null;

    function tellShell(method) {
        if (!SHELL || typeof SHELL[method] !== "function") return;
        try { SHELL[method](); } catch (e) { /* never break playback over an ad */ }
    }

    const app = document.getElementById("app");
    const searchBox = document.getElementById("search");

    let feed = null;
    // Two different rows legitimately carry the same film (Dementia is in
    // both Cult Corner and After Dark), so cards are looked up by a unique
    // placement key while watch progress stays keyed on the film's own id.
    let byKey = new Map();
    let byId = new Map();
    let progress = loadProgress();


    /* ------------------------------------------------------
       Persistence

       localStorage can throw outright (private mode, blocked
       site data), so every touch is wrapped.
       ------------------------------------------------------ */

    function loadProgress() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
        } catch (e) {
            return {};
        }
    }

    function saveProgress() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(progress));
        } catch (e) {
            /* Not being able to remember where you got to is survivable. */
        }
    }


    /* ------------------------------------------------------
       Poster policy — mirrors components/PosterPolicy.brs
       ------------------------------------------------------ */

    const APPROVED = [
        "pub-3ece269d2dd44298a19cc5f5355f7802.r2.dev/",
        "pub-4a1ee3e926844caba75e0b33d0b2208d.r2.dev/",
        "parkerdatalink.com/",
    ];

    function isApprovedPoster(url) {
        if (typeof url !== "string" || url === "") return false;
        const u = url.toLowerCase();
        return APPROVED.some(a => u.indexOf(a) > -1);
    }


    /* ------------------------------------------------------
       Category tint — mirrors glowForCategory in PosterItem.brs
       ------------------------------------------------------ */

    const TINTS = [
        ["animation", "#e0a93a"],
        ["comedy",    "#c9a25e"],
        ["noir",      "#6e8ca8"],
        ["western",   "#b5714a"],
        ["sci-fi",    "#9a6bb5"],
        ["silent",    "#c9a25e"],
        ["vault",     "#5fa8a0"],
        ["retro",     "#5fa8a0"],
        ["space",     "#5a7fc4"],
        ["after dark", "#b5544a"],
        ["cult",      "#9a6bb5"],
        ["cartoon",   "#e0a93a"],
        ["tv",        "#7fa3b8"],
    ];

    function tintFor(categoryTitle) {
        const c = (categoryTitle || "").toLowerCase();
        for (const [needle, colour] of TINTS) {
            if (c.indexOf(needle) > -1) return colour;
        }
        return "#b5544a";
    }


    /* ------------------------------------------------------
       Cards
       ------------------------------------------------------ */

    function cardFor(item) {
        const el = document.createElement("button");
        el.className = "card";
        el.type = "button";
        el.dataset.key = item._key;
        el.setAttribute("aria-label", item.title + (item.year ? ", " + item.year : ""));

        if (isApprovedPoster(item.poster)) {
            const img = document.createElement("img");
            img.src = item.poster;
            img.alt = "";
            img.loading = "lazy";
            img.decoding = "async";
            // A dead URL must not leave a blank rectangle behind.
            img.addEventListener("error", () => paintTitleCard(el, item), { once: true });
            el.appendChild(img);

            const cap = document.createElement("span");
            cap.className = "cap";
            cap.textContent = item.title;
            el.appendChild(cap);
        } else {
            paintTitleCard(el, item);
        }

        const p = progress[item.id];
        if (p && p.t > RESUME_MIN && p.d && p.t / p.d < RESUME_DONE) {
            const bar = document.createElement("span");
            bar.className = "progress";
            bar.style.width = Math.min(100, (p.t / p.d) * 100) + "%";
            el.appendChild(bar);
        }

        return el;
    }

    function paintTitleCard(el, item) {
        el.innerHTML = "";
        el.classList.add("titlecard");
        el.style.setProperty("--glow", hexToGlow(tintFor(item._category)));

        const t = document.createElement("span");
        t.className = "tc-title";
        t.textContent = item.title.toUpperCase();
        el.appendChild(t);

        if (item.year) {
            const y = document.createElement("span");
            y.className = "tc-year";
            y.textContent = item.year;
            el.appendChild(y);
        }
    }

    // The Roku glow is a soft wash, not a solid block of colour.
    function hexToGlow(hex) {
        const n = parseInt(hex.slice(1), 16);
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        return `rgba(${r}, ${g}, ${b}, 0.42)`;
    }


    /* ------------------------------------------------------
       Rendering
       ------------------------------------------------------ */

    function rowSection(title, items, useGrid) {
        const sec = document.createElement("section");
        sec.className = "row";

        const head = document.createElement("div");
        head.className = "row-head";
        const h = document.createElement("h2");
        h.textContent = title;
        const n = document.createElement("span");
        n.textContent = items.length + (items.length === 1 ? " title" : " titles");
        head.append(h, n);

        const strip = document.createElement("div");
        strip.className = useGrid ? "grid" : "rail";
        for (const item of items) strip.appendChild(cardFor(item));

        sec.append(head, strip);
        return sec;
    }

    function keepWatching() {
        const out = [];
        for (const [id, p] of Object.entries(progress)) {
            if (!p || !p.d || p.t <= RESUME_MIN) continue;
            if (p.t / p.d >= RESUME_DONE) continue;
            const item = byId.get(id);
            if (item) out.push({ item, at: p.at || 0 });
        }
        out.sort((a, b) => b.at - a.at);
        return out.slice(0, 12).map(x => x.item);
    }

    function renderHome() {
        app.innerHTML = "";

        const hero = document.createElement("section");
        hero.className = "hero";
        hero.innerHTML =
            '<h1>Classic Horror Movies</h1>' +
            '<p>Public-domain horror features, shorts and cult classics, ' +
            'restored from the archives and streaming free. No subscription, ' +
            'no sign-up — just press play.</p>' +
            '<span class="hero-count">' + byId.size + ' titles · ' +
            feed.categories.length + ' collections</span>';
        app.appendChild(hero);

        const resume = keepWatching();
        if (resume.length) app.appendChild(rowSection("Keep watching", resume, true));

        for (const cat of feed.categories) {
            if (!cat.items || !cat.items.length) continue;
            app.appendChild(rowSection(cat.title, cat.items, false));
        }
    }

    function renderSearch(q) {
        const needle = q.trim().toLowerCase();
        app.innerHTML = "";

        if (needle.length < 2) { renderHome(); return; }

        const hits = [];
        for (const item of byId.values()) {
            const hay = (item.title + " " + (item.year || "") + " " +
                         (item._category || "")).toLowerCase();
            if (hay.indexOf(needle) > -1) hits.push(item);
        }
        hits.sort((a, b) => a.title.localeCompare(b.title));

        if (!hits.length) {
            const p = document.createElement("p");
            p.className = "empty";
            p.textContent = 'Nothing matches "' + q.trim() + '".';
            app.appendChild(p);
            return;
        }

        app.appendChild(rowSection('Results for "' + q.trim() + '"', hits, true));
    }


    /* ------------------------------------------------------
       Detail sheet
       ------------------------------------------------------ */

    const sheet = document.getElementById("sheet");
    const sheetArt = document.getElementById("sheet-art");
    const sheetTitle = document.getElementById("sheet-title");
    const sheetMeta = document.getElementById("sheet-meta");
    const sheetDesc = document.getElementById("sheet-desc");
    const sheetLicence = document.getElementById("sheet-licence");
    const btnPlay = document.getElementById("btn-play");
    const btnRestart = document.getElementById("btn-restart");

    let current = null;
    let lastFocus = null;

    function openSheet(item) {
        current = item;
        lastFocus = document.activeElement;

        sheetArt.innerHTML = "";
        const art = cardFor(item);
        art.tabIndex = -1;
        sheetArt.appendChild(art);

        sheetTitle.textContent = item.title;
        sheetMeta.textContent = [item.year, item._category].filter(Boolean).join(" · ");
        sheetDesc.textContent = item.description || "";
        sheetLicence.textContent = item.license || "";

        const p = progress[item.id];
        const resumable = p && p.t > RESUME_MIN && p.d && p.t / p.d < RESUME_DONE;
        btnPlay.textContent = resumable ? "Resume · " + clock(p.t) : "Play";
        btnRestart.hidden = !resumable;

        sheet.hidden = false;
        document.body.classList.add("locked");
        btnPlay.focus();
    }

    function closeSheet() {
        sheet.hidden = true;
        document.body.classList.remove("locked");
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    function clock(secs) {
        const s = Math.floor(secs);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = s % 60;
        const pad = v => String(v).padStart(2, "0");
        return h ? h + ":" + pad(m) + ":" + pad(r) : m + ":" + pad(r);
    }


    /* ------------------------------------------------------
       Player
       ------------------------------------------------------ */

    const player = document.getElementById("player");
    const video = document.getElementById("video");
    const playerTitle = document.getElementById("player-title");
    const playerError = document.getElementById("player-error");
    const adBadge = document.getElementById("ad-badge");

    let bumperTimer = 0;
    let midrollAt = 0;        // seconds into the film; 0 means none scheduled
    let midrollDone = false;
    let resumeAfterBreak = 0;

    function play(item, fromStart) {
        current = item;

        playerTitle.textContent = item.title + (item.year ? " (" + item.year + ")" : "");
        playerError.hidden = true;
        adBadge.hidden = true;

        sheet.hidden = true;
        player.hidden = false;
        document.body.classList.add("locked");
        tellShell("playerOpened");

        midrollAt = 0;
        midrollDone = false;
        resumeAfterBreak = 0;

        probeDuration(item.streamUrl).then(secs => {
            if (current !== item) return;              // viewer moved on

            if (secs && secs >= FEATURE_MIN_SECS) {
                runBumper(item, fromStart);
                return;
            }

            if (MIDROLL.length && secs >= MIDROLL_MIN_SECS && secs < MIDROLL_MAX_SECS) {
                midrollAt = secs / 2;
            }
            startFeature(item, fromStart);
        });
    }

    /* Ask the file how long it is without showing anything. A HEAD would
       not tell us, and the metadata alone is a few kilobytes. */
    function probeDuration(url) {
        return new Promise(resolve => {
            const probe = document.createElement("video");
            probe.preload = "metadata";
            probe.muted = true;

            let done = false;
            const finish = v => {
                if (done) return;
                done = true;
                clearTimeout(t);
                probe.removeAttribute("src");
                try { probe.load(); } catch (e) { /* already torn down */ }
                resolve(v);
            };

            const t = setTimeout(() => finish(0), PROBE_TIMEOUT_MS);
            probe.addEventListener("loadedmetadata", () =>
                finish(isFinite(probe.duration) ? probe.duration : 0));
            probe.addEventListener("error", () => finish(0));

            probe.src = url;
        });
    }

    function runBumper(item, fromStart, which) {
        const list = bumpersFor(item);
        const idx = which || 0;
        if (idx >= list.length) { startFeature(item, fromStart); return; }

        adBadge.hidden = false;
        video.controls = false;
        video.src = list[idx];

        const goOn = () => {
            clearTimeout(bumperTimer);
            video.removeEventListener("ended", goOn);
            video.removeEventListener("error", onFail);
            if (current === item) startFeature(item, fromStart);
        };

        const onFail = () => {
            clearTimeout(bumperTimer);
            video.removeEventListener("ended", goOn);
            video.removeEventListener("error", onFail);
            // Try the other host before giving up on the bumper entirely.
            if (current === item) runBumper(item, fromStart, idx + 1);
        };

        // A bumper that will not start must never hold the film hostage.
        bumperTimer = setTimeout(() => {
            if (video.readyState < 2) onFail();
        }, 12000);

        video.addEventListener("ended", goOn);
        video.addEventListener("error", onFail);

        video.play().catch(() => {
            /* Autoplay blocked. Show the controls so the viewer can start it. */
            video.controls = true;
        });
    }

    function runMidroll(item) {
        midrollDone = true;
        resumeAfterBreak = video.currentTime;

        adBadge.hidden = false;
        video.controls = false;
        video.src = pickMidroll();

        const back = () => {
            clearTimeout(bumperTimer);
            video.removeEventListener("ended", back);
            video.removeEventListener("error", back);
            if (current !== item) return;
            startFeature(item, true, resumeAfterBreak);
        };

        // A break that will not load must hand the cartoon straight back.
        bumperTimer = setTimeout(() => { if (video.readyState < 2) back(); }, 12000);

        video.addEventListener("ended", back);
        video.addEventListener("error", back);
        video.play().catch(() => { video.controls = true; });
    }

    function startFeature(item, fromStart, seekOverride) {
        clearTimeout(bumperTimer);
        adBadge.hidden = true;
        video.controls = true;

        playerError.hidden = true;
        video.src = item.streamUrl;

        const p = progress[item.id];
        const seekTo = seekOverride ? seekOverride
            : ((!fromStart && p && p.t > RESUME_MIN &&
                p.d && p.t / p.d < RESUME_DONE) ? p.t : 0);

        if (seekTo) {
            // Seeking before metadata arrives is ignored, so wait for it.
            video.addEventListener("loadedmetadata", function once() {
                video.removeEventListener("loadedmetadata", once);
                try { video.currentTime = seekTo; } catch (e) { /* unseekable */ }
            });
        }

        video.play().catch(() => {
            /* Autoplay refused — the controls are right there. */
        });
    }

    function closePlayer() {
        clearTimeout(bumperTimer);
        midrollAt = 0;
        midrollDone = false;
        adBadge.hidden = true;
        video.controls = true;
        recordProgress();
        video.pause();
        video.removeAttribute("src");
        video.load();

        player.hidden = true;
        document.body.classList.remove("locked");
        tellShell("playerClosed");

        // Repaint so the new resume bar shows up straight away.
        if (searchBox.value.trim().length >= 2) renderSearch(searchBox.value);
        else renderHome();
    }

    function recordProgress() {
        if (!current || !video.duration || !isFinite(video.duration)) return;
        if (!adBadge.hidden) return;          // the bumper is not the film
        progress[current.id] = {
            t: video.currentTime,
            d: video.duration,
            at: Date.now(),
        };
        saveProgress();
    }

    let tick = 0;
    video.addEventListener("timeupdate", () => {
        if (midrollAt && !midrollDone && adBadge.hidden &&
            current && video.currentTime >= midrollAt) {
            runMidroll(current);
            return;
        }

        // Once every five seconds is plenty; localStorage writes are sync.
        if (Date.now() - tick < 5000) return;
        tick = Date.now();
        recordProgress();
    });

    video.addEventListener("ended", () => {
        if (!adBadge.hidden) return;          // that was the bumper, not the film
        if (current) {
            progress[current.id] = { t: video.duration, d: video.duration, at: Date.now() };
            saveProgress();
        }
    });

    video.addEventListener("error", () => {
        if (!adBadge.hidden) return;          // bumper failures are handled above
        playerError.hidden = false;
        playerError.textContent =
            "This one would not load. The archive copy may be offline — try another title.";
    });


    /* ------------------------------------------------------
       Wiring
       ------------------------------------------------------ */

    app.addEventListener("click", e => {
        const card = e.target.closest(".card");
        if (!card || !card.dataset.key) return;
        const item = byKey.get(card.dataset.key);
        if (item) openSheet(item);
    });

    sheet.addEventListener("click", e => {
        if (e.target.closest("[data-close]")) closeSheet();
    });

    btnPlay.addEventListener("click", () => { if (current) play(current, false); });
    btnRestart.addEventListener("click", () => { if (current) play(current, true); });
    document.getElementById("player-close").addEventListener("click", closePlayer);

    document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (!player.hidden) closePlayer();
        else if (!sheet.hidden) closeSheet();
    });

    let searchTimer = 0;
    searchBox.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderSearch(searchBox.value), 140);
    });

    document.getElementById("brand-home").addEventListener("click", e => {
        e.preventDefault();
        searchBox.value = "";
        renderHome();
        window.scrollTo({ top: 0, behavior: "smooth" });
    });


    /* ------------------------------------------------------
       Boot
       ------------------------------------------------------ */

    fetch(FEED_URL)
        .then(r => {
            if (!r.ok) throw new Error("feed " + r.status);
            return r.json();
        })
        .then(data => {
            feed = data;
            feed.categories = (feed.categories || []).map(cat => {
                const seen = new Set();
                const items = [];
                (cat.items || []).forEach((item, i) => {
                    // The feed lists "Lucky Str" twice inside Retro Rewind.
                    // A row should never show the same film twice.
                    if (seen.has(item.id)) return;
                    seen.add(item.id);

                    item._category = cat.title;
                    item._key = cat.title + "#" + i;
                    byKey.set(item._key, item);
                    if (!byId.has(item.id)) byId.set(item.id, item);
                    items.push(item);
                });
                return Object.assign({}, cat, { items: items });
            });
            searchBox.placeholder = "Search " + byId.size + " titles…";
            renderHome();
        })
        .catch(err => {
            app.innerHTML =
                '<p class="empty">The catalogue did not load. ' +
                'Check your connection and refresh.</p>';
            console.error(err);
        });

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("service-worker.js").catch(() => {});
        });
    }
})();
