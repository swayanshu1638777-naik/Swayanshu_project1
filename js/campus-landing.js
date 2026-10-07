document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const dockLink = event.target.closest("a[data-dock]");
    if (dockLink) {
        const destination = dockLink.getAttribute("href");
        if (!destination) return;
        if (destination.startsWith("#")) {
            window.location.hash = destination.slice(1);
        } else {
            window.location.assign(destination);
        }
        return;
    }

    if (event.target.closest(".liquid-button--explore")) {
        window.location.assign("login.html?role=Student");
        return;
    }

    if (event.target.closest(".liquid-button--play, .knob--about")) {
        window.location.hash = "features";
        return;
    }

    if (event.target.closest(".card--stove .knob")) {
        window.location.assign("student_performance.html");
    }
});
