document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    if (event.target.closest(".liquid-button--explore")) {
        window.location.assign("login.html?role=Student");
        return;
    }

    if (event.target.closest(".liquid-button--play")) {
        const features = document.getElementById("features");
        if (!features) return;
        const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        window.scrollTo({ top: features.getBoundingClientRect().top + window.scrollY, behavior });
    }
});
