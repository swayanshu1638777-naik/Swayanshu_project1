document.addEventListener("DOMContentLoaded", () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const templeFrame = document.querySelector(".temple-world");
    let progressFrame = 0;
    let templeDocument = null;
    let templeSyncPending = false;
    let templeErrorReported = false;

    const updatePageProgress = () => {
        if (progressFrame) return;
        progressFrame = window.requestAnimationFrame(() => {
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            const progress = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
            document.documentElement.style.setProperty("--page-progress", String(progress));
            progressFrame = 0;
        });
    };

    updatePageProgress();
    window.addEventListener("scroll", updatePageProgress, { passive: true });
    window.addEventListener("resize", updatePageProgress);

    const reportTempleError = (message, error) => {
        document.body.dataset.templeState = "error";
        if (templeErrorReported) return;
        templeErrorReported = true;
        console.error(message, error ?? "");
    };

    const syncTempleScroll = () => {
        if (!templeDocument || templeSyncPending) return;
        templeSyncPending = true;

        window.requestAnimationFrame(() => {
            templeSyncPending = false;
            const sceneWindow = templeFrame.contentWindow;
            const world = sceneWindow?.__kage;
            if (!sceneWindow || !world?.renderer) return;

            const sceneSections = [...templeDocument.querySelectorAll("[data-cam]")];
            if (sceneSections.length < 2) {
                reportTempleError("The temple background has no camera chapters to synchronize.");
                return;
            }

            const sceneMax = Math.max(0, templeDocument.documentElement.scrollHeight - sceneWindow.innerHeight);
            const authoredStops = world.anchors?.();
            const sceneStops = authoredStops?.length === sceneSections.length
                ? authoredStops.slice()
                : sceneSections.map((section, index) => {
                    if (index === 0) return 0;
                    if (index === sceneSections.length - 1) return sceneMax;
                    return Math.min(
                        sceneMax,
                        Math.max(0, section.offsetTop + section.offsetHeight / 2 - sceneWindow.innerHeight / 2),
                    );
                });

            for (let index = 1; index < sceneStops.length; index++) {
                sceneStops[index] = Math.max(sceneStops[index], sceneStops[index - 1] + 1);
            }

            const pageMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            const pageProgress = !reduceMotion && pageMax > 0
                ? Math.min(1, Math.max(0, window.scrollY / pageMax))
                : 0;
            const scenePosition = sceneStops[0]
                + (sceneStops[1] - sceneStops[0]) * pageProgress * 0.35;

            if (Math.abs(sceneWindow.scrollY - scenePosition) > 1) {
                sceneWindow.scrollTo(0, scenePosition);
            }
        });
    };

    const initializeTempleBackground = () => {
        if (!templeFrame || templeDocument) return;

        try {
            const page = templeFrame.contentDocument;
            if (!page?.head || !page.querySelector("#gl")) {
                throw new Error("The local temple document or its WebGL canvas is missing.");
            }

            const sceneStyle = page.createElement("style");
            sceneStyle.textContent = `
                html { scroll-behavior: auto !important; scrollbar-width: none !important; }
                html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
                body, body.is-locked {
                    height: auto !important;
                    min-height: 100% !important;
                    overflow-x: hidden !important;
                    overflow-y: visible !important;
                }
                body { background: #05070a !important; }
                #pre, .nav, .page, .rail, #cursor { visibility: hidden !important; pointer-events: none !important; }
                #gl, #vignette, #grain, #fg-sky { visibility: visible !important; }
                #fg-sky, #fg-sky * { visibility: visible !important; }
                #gl { opacity: .64 !important; filter: grayscale(.62) saturate(.48) brightness(.76); }
                #vignette { opacity: .58 !important; }
                #grain { opacity: .025 !important; }
                #fg-sky { opacity: .46 !important; filter: grayscale(.72) saturate(.48) brightness(.82); }
            `;
            page.head.appendChild(sceneStyle);
            templeDocument = page;
            document.body.dataset.templeState = "loading";

            const startedAt = performance.now();
            const checkRenderer = () => {
                const sceneWindow = templeFrame.contentWindow;
                const world = sceneWindow?.__kage;
                if (world?.renderer && world?.camera && world?.scene) {
                    if (page.body.classList.contains("is-locked")) {
                        window.setTimeout(checkRenderer, 100);
                        return;
                    }
                    if (world.WORD?.group) world.WORD.group.visible = false;
                    sceneWindow.dispatchEvent(new Event("resize"));
                    document.body.dataset.templeState = "ready";
                    syncTempleScroll();
                    page.fonts.ready.then(() => {
                        sceneWindow.dispatchEvent(new Event("resize"));
                        syncTempleScroll();
                    });
                    return;
                }
                if (world?.fallback) {
                    reportTempleError("The authored temple background could not start its WebGL renderer.", world.error);
                    return;
                }
                if (performance.now() - startedAt > 15000) {
                    reportTempleError("The authored temple background renderer timed out.");
                    return;
                }
                window.setTimeout(checkRenderer, 200);
            };
            checkRenderer();
        } catch (error) {
            reportTempleError("The local temple background could not be initialized.", error);
        }
    };

    if (templeFrame) {
        templeFrame.addEventListener("load", initializeTempleBackground);
        templeFrame.addEventListener("error", () => {
            reportTempleError("The local temple background document failed to load.");
        });
        if (
            templeFrame.contentDocument?.readyState === "complete"
            && templeFrame.contentDocument.querySelector("#gl")
        ) {
            initializeTempleBackground();
        }
        window.addEventListener("scroll", syncTempleScroll, { passive: true });
        window.addEventListener("resize", syncTempleScroll);

        if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) {
            window.addEventListener("pointermove", (event) => {
                const sceneWindow = templeFrame.contentWindow;
                if (!sceneWindow) return;
                sceneWindow.dispatchEvent(new sceneWindow.PointerEvent("pointermove", {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    bubbles: true,
                }));
            }, { passive: true });
        }
    }

    const toggle = document.querySelector(".menu-toggle");
    const navigation = document.querySelector("#primary-navigation");

    if (toggle && navigation) {
        const closeNavigation = () => {
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", "Open navigation");
            navigation.classList.remove("is-open");
        };

        toggle.addEventListener("click", () => {
            const isOpen = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(isOpen));
            toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
            navigation.classList.toggle("is-open", isOpen);
        });

        navigation.addEventListener("click", (event) => {
            if (event.target instanceof Element && event.target.closest("a")) closeNavigation();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
                closeNavigation();
                toggle.focus();
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 640) closeNavigation();
        });
    }
});
