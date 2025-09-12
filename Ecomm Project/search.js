// search.js
(function () {
  function norm(s) { return (s || "").trim().toLowerCase(); }

  async function loadDB() {
    // Use no-store so updates to search.json show without cache issues
    const res = await fetch("./search.json", { cache: "no-store" });
    // On file:// fetch, many browsers report status 0 and !ok
    if (!res.ok) {
      throw new Error("LOAD_DB_FAILED status=" + res.status);
    }
    return res.json();
  }

  function findExact(data, qn) {
    let exactModel = null, exactPart = null, exactSchematic = null;

    if (Array.isArray(data.models)) {
      exactModel = data.models.find(m =>
        norm(m.modelNumber) === qn ||
        (Array.isArray(m.aliases) && m.aliases.map(norm).includes(qn))
      ) || null;
    }

    if (Array.isArray(data.parts)) {
      exactPart = data.parts.find(p =>
        norm(p.number) === qn || norm(p.id) === qn
      ) || null;
    }

    // Optional top-level schematics array; you can omit it if all schematics live under models
    if (Array.isArray(data.schematics)) {
      exactSchematic = data.schematics.find(s =>
        norm(s.id) === qn || norm(s.name) === qn
      ) || null;
    }

    return { exactModel, exactPart, exactSchematic };
  }

  async function runSearch(query) {
    try {
      const raw = (query || "").trim();
      if (!raw) return;
      const qn = norm(raw);

      const data = await loadDB();
      const { exactModel, exactPart, exactSchematic } = findExact(data, qn);

      if (exactModel) {
        location.href = "model.html?id=" + encodeURIComponent(exactModel.id);
        return;
      }
      if (exactPart) {
        // product detail page for a single part (to be built)
        location.href = "product.html?id=" + encodeURIComponent(exactPart.id);
        return;
      }
      if (exactSchematic) {
        location.href = "schematic.html?id=" + encodeURIComponent(exactSchematic.id);
        return;
      }

      // No exact match yet; keep it simple for MVP
      alert("No exact match found for \"" + raw + "\".\nWe’ll add a results page next.");
    } catch (err) {
      console.error("[runSearch] Could not complete search:", err);
      alert(
        "Could not load search data.\n" +
        "If you opened this file directly, please run from a local web server.\n\n" +
        "Examples:\n" +
        " • VS Code → Live Server\n" +
        " • Python →  py -m http.server 8000\n" +
        " • Node →    npx http-server . -p 8000"
      );
    }
  }

  // Expose globally so index.html can call it
  window.runSearch = runSearch;
})();
