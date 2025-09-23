// search.js — CSV-backed data + indexes + routing
// CSVs expected alongside this file:
//   models.csv            => id,brand,modelNumber
//   schematics.csv        => id,modelID,name,order,image
//   schematic_parts.csv   => schematicID,diagramNo,order,partID
//   parts.csv             => id,number,manufacturer,name,description,productStatus,inventory,price
//
// Serve via a local web server (e.g., VS Code Live Server) so fetch() can read the CSVs.

(function () {
  "use strict";

  /* ========================
     Helpers
  ========================= */
  function stripBOM(text) { return text.replace(/^\uFEFF/, ""); }
  function norm(s)       { return String(s || "").trim().toLowerCase(); }
  function toInt(v)      { const n = parseInt(String(v || "").trim(), 10); return Number.isFinite(n) ? n : null; }

  // Accept "$1,234.56" or "1234.56"; clamp 0..999.99; return Number or null
  function parseMoneyUSD(v) {
    const s = String(v || "").replace(/[^0-9.]/g, "");
    if (!s) return null;
    let n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n < 0) n = 0;
    if (n > 999.99) n = 999.99;
    return Math.round(n * 100) / 100;
  }

  // Parse CSV into array of objects with canonical, case/space-insensitive keys.
  // Canonicalization: lowercase, remove spaces/underscores (e.g., "Model ID" -> "modelid")
  function parseCSV(text) {
    text = stripBOM(text);
    const rows = [];
    let field = "", row = [], i = 0, inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ",") { row.push(field); field = ""; i++; continue; }
        if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        if (c === "\r") { if (text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        field += c; i++; continue;
      }
    }
    row.push(field); rows.push(row);
    while (rows.length && rows[rows.length - 1].every(v => v === "")) rows.pop();
    if (!rows.length) return [];

    const rawHeaders = rows[0].map(h => String(h || ""));
    const headers = rawHeaders.map(h => h.toLowerCase().replace(/[\s_]+/g, "")); // canonical headers

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        const key = headers[c];
        const val = (line[c] ?? "").trim();
        obj[key] = val;
      }
      out.push(obj);
    }
    return out;
  }

  async function fetchText(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status + " loading " + path);
    return res.text();
  }

  /* ========================
     DB load + indexes (cached)
  ========================= */
  let _cache = null;

  async function load() {
    if (_cache) return _cache;

    const [modelsTxt, schemsTxt, linksTxt, partsTxt] = await Promise.all([
      fetchText("models.csv"),
      fetchText("schematics.csv"),
      fetchText("schematic_parts.csv"),
      fetchText("parts.csv")
    ]);

    const modelsRows = parseCSV(modelsTxt);
    const schemsRows = parseCSV(schemsTxt);
    const linksRows  = parseCSV(linksTxt);
    const partsRows  = parseCSV(partsTxt);

    // models.csv: id,brand,modelNumber
    const models = modelsRows.map(r => ({
      id:          (r.id || "").trim(),
      brand:       (r.brand || "").trim(),
      modelNumber: (r.modelnumber || "").trim()
    })).filter(m => m.id || m.modelNumber);

    // schematics.csv: id,modelID,name,order,image  (normalize to modelId)
    const schematics = schemsRows.map(r => ({
      id:      (r.id || "").trim(),
      modelId: (r.modelid || "").trim(),
      name:    (r.name || "").trim(),
      order:   toInt(r.order) ?? 0,
      image:   (r.image || "").trim()
    })).filter(s => s.id && s.modelId);

    // schematic_parts.csv: schematicID,diagramNo,Order,partID
    const schematicParts = linksRows.map(r => ({
      schematicId: (r.schematicid || "").trim(),
      diagramNo:   toInt(r.diagramno) ?? 0,
      order:       toInt(r.order) ?? 0,
      partId:      (r.partid || "").trim()
    })).filter(l => l.schematicId && l.partId);

    // parts.csv: id,number,manufacturer,name,description,productStatus,inventory,price
    const parts = partsRows.map(r => ({
      id:            (r.id || "").trim(),
      number:        (r.number || r.id || "").trim(),
      manufacturer:  (r.manufacturer || "").trim(),
      name:          (r.name || "").trim(),
      description:   (r.description || "").trim(),
      productStatus: (r.productstatus || "").trim(),
      inventory:     toInt(r.inventory) ?? 0,
      price:         parseMoneyUSD(r.price)
    })).filter(p => p.id || p.number);

    // ---- Indexes ----
    // Models
    const modelsById     = Object.create(null);
    const modelsByNumber = Object.create(null); // normalized modelNumber -> model
    models.forEach(m => {
      if (m.id) modelsById[m.id] = m;
      if (m.modelNumber) {
        const k = norm(m.modelNumber);
        modelsByNumber[k] = m;
        // Also allow modelNumber as a direct ID alias (useful if pages pass ?id=<modelNumber>)
        if (!modelsById[m.modelNumber]) modelsById[m.modelNumber] = m;
      }
    });

    // Schematics
    const schemsById    = Object.create(null);
    const schemsByModel = Object.create(null); // modelId -> [schematics]
    schematics.forEach(s => {
      schemsById[s.id] = s;
      if (!schemsByModel[s.modelId]) schemsByModel[s.modelId] = [];
      schemsByModel[s.modelId].push(s);
    });
    Object.values(schemsByModel).forEach(list => list.sort((a,b) => (a.order - b.order) || a.id.localeCompare(b.id)));

    // Parts
    const partsById      = Object.create(null);       // exact id (case-sensitive)
    const partsByIdLower = Object.create(null);       // id lowercased
    const partsByNumber  = Object.create(null);       // normalized number -> part
    parts.forEach(p => {
      if (p.id) { partsById[p.id] = p; partsByIdLower[norm(p.id)] = p; }
      if (p.number) partsByNumber[norm(p.number)] = p;
    });

    // Links
    const linkBySchematic = Object.create(null); // schematicId -> [{diagramNo, order, partId}]
    schematicParts.forEach(l => {
      if (!linkBySchematic[l.schematicId]) linkBySchematic[l.schematicId] = [];
      linkBySchematic[l.schematicId].push(l);
    });
    Object.values(linkBySchematic).forEach(list =>
      list.sort((a,b) => (a.order - b.order) || (a.diagramNo - b.diagramNo) || a.partId.localeCompare(b.partId))
    );

    // Helpful console summary
    if (!models.length)     console.warn("[DB] 0 models loaded (check models.csv headers/content)");
    if (!schematics.length) console.warn("[DB] 0 schematics loaded (check schematics.csv headers/content)");
    if (!parts.length)      console.warn("[DB] 0 parts loaded (check parts.csv headers/content)");

    _cache = {
      // data
      models, schematics, schematicParts, parts,
      // indexes
      modelsById, modelsByNumber,
      schemsById, schemsByModel,
      partsById, partsByIdLower, partsByNumber,
      linkBySchematic
    };
    return _cache;
  }

  /* ========================
     Public DB helpers (used by pages)
  ========================= */
  async function getModelById(id) {
    const db = await load();
    return db.modelsById[id] || null;
  }

  async function getModelByNumberOrAlias(q) {
    const db = await load();
    return db.modelsByNumber[norm(q)] || null; // no aliases column in your CSV
  }

  async function listSchematicsByModelId(modelId) {
    const db = await load();
    return db.schemsByModel[modelId] || [];
  }

  async function getSchematicById(id) {
    const db = await load();
    return db.schemsById[id] || null;
  }

  // Returns rows joined to parts for a schematic:
  // [{ diagramNo, order, partId, part }]
  async function listPartsForSchematic(schematicId) {
    const db = await load();
    const links = db.linkBySchematic[schematicId] || [];
    return links.map(l => ({
      diagramNo: l.diagramNo,
      order: l.order,
      partId: l.partId,
      part: db.partsById[l.partId] || db.partsByIdLower[norm(l.partId)] || db.partsByNumber[norm(l.partId)] || null
    }));
  }

  async function getPartByIdOrNumber(x) {
    const db = await load();
    const k = norm(x);
    return db.partsById[x] || db.partsByIdLower[k] || db.partsByNumber[k] || null;
  }

  /* ========================
     Search & routing
  ========================= */
  async function runSearch(query) {
    const q = (query || "").trim();
    if (!q) return;
    try {
      const db = await load();
      const k = norm(q);

      // MODEL by modelNumber (exact, case-insensitive)
      const model = db.modelsByNumber[k];
      if (model) {
        const modelId = model.modelNumber || model.id; // schematics.csv uses modelID matching this
        location.href = "model.html?id=" + encodeURIComponent(modelId);
        return;
      }

      // PART by id or number
      const part = db.partsById[q] || db.partsByIdLower[k] || db.partsByNumber[k];
      if (part) {
        location.href = "product.html?id=" + encodeURIComponent(part.id);
        return;
      }

      // SCHEMATIC by id or exact name (case-insensitive)
      const schematic = db.schemsById[q] ||
        Object.values(db.schemsById).find(s => norm(s.name) === k);
      if (schematic) {
        location.href = "schematic.html?id=" + encodeURIComponent(schematic.id);
        return;
      }

      alert('No exact match found for "' + q + '".');
    } catch (err) {
      console.error("runSearch error:", err);
      alert("Could not load CSV data. Make sure you’re serving via Live Server / localhost and CSV filenames are correct.");
    }
  }

  // Expose in global scope
  window.DB = {
    load,
    getModelById, getModelByNumberOrAlias,
    listSchematicsByModelId, getSchematicById,
    listPartsForSchematic, getPartByIdOrNumber
  };
  window.runSearch = runSearch;
})();
