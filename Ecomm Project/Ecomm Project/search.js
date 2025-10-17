/* =========================================================================
   search.js  —  CSV-backed Search (exact → fuzzy) + suggestions overlay
   -------------------------------------------------------------------------
   What this file does:
   - Loads & indexes CSVs (models, schematics, parts) into window.DB
   - runSearch(query):
       1) Tries exact matches (model #, part #/id, schematic id)
       2) If one unambiguous hit → navigates to that page
       3) Else → builds fuzzy suggestions (models / parts / schematics)
                and shows an overlay with clickable results
   - Auto-wires suggestions while typing on header/body inputs if present
   ========================================================================= */

/* ----------------------- CSV loader & lightweight DB -------------------- */
(function(){
  const DB = {
    ready: null,
    models: [],           // [{id, brand, modelNumber}]
    schematics: [],       // [{id, modelID, name, order, image}]
    parts: [],            // [{id, number, manufacturer, name, description, productStatus, inventory, price}]

    // Indexes for fast lookups (normalized keys)
    ix: {
      modelByKey: new Map(),       // key(modelNumber) -> model
      schematicByKey: new Map(),   // key(schematicId) -> schematic
      partByIdKey: new Map(),      // key(id) -> part
      partByNumberKey: new Map(),  // key(number) -> part
    },

    async init(){
      if (this.ready) return this.ready;
      this.ready = (async () => {
        const [modelsTxt, schemTxt, partsTxt] = await Promise.all([
          fetch('/models.csv', {cache:'no-store'}).then(r=>r.text()),
          fetch('/schematics.csv', {cache:'no-store'}).then(r=>r.text()),
          fetch('/parts.csv', {cache:'no-store'}).then(r=>r.text()),
        ]);
        this.models = parseCSV(modelsTxt);
        this.schematics = parseCSV(schemTxt);
        this.parts = parseCSV(partsTxt);

        // Normalize headers if any casing differences
        this.models = this.models.map(r => ({
          id: r.id || r.ID || r.modelID || r.modelId || r.model || r.modelNumber,
          brand: r.brand || r.Brand || '',
          modelNumber: r.modelNumber || r.model || r.id || ''
        }));

        this.schematics = this.schematics.map(r => ({
          id: r.id || r.ID || '',
          modelID: r.modelID || r.modelId || r.model || '',
          name: r.name || r.Name || '',
          order: toNum(r.order || r.Order),
          image: r.image || r.Image || ''
        }));

        this.parts = this.parts.map(r => ({
          id: r.id || r.ID || '',
          number: r.number || r.Number || '',
          manufacturer: r.manufacturer || r.Manufacturer || '',
          name: r.name || r.Name || '',
          description: r.description || r.Description || '',
          productStatus: r.productStatus || r.status || r.Status || '',
          inventory: toNum(r.inventory || r.Inventory),
          price: toNum(r.price || r.Price)
        }));

        // Build indexes
        const { modelByKey, schematicByKey, partByIdKey, partByNumberKey } = this.ix;
        for (const m of this.models){
          if (!m.modelNumber) continue;
          modelByKey.set(key(m.modelNumber), m);
          // some CSVs repeat id==modelNumber; index both just in case
          if (m.id) modelByKey.set(key(m.id), m);
        }
        for (const s of this.schematics){
          if (s.id) schematicByKey.set(key(s.id), s);
        }
        for (const p of this.parts){
          if (p.id) partByIdKey.set(key(p.id), p);
          if (p.number) partByNumberKey.set(key(p.number), p);
        }

        // Expose globally for pages that already import DB.*
        window.DB = {
          ...this,
          getModelById: async (id) => this.ix.modelByKey.get(key(id)),
          getSchematicById: async (id) => this.ix.schematicByKey.get(key(id)),
          getPartByIdOrNumber: async (idOrNum) => {
            const k = key(idOrNum);
            return this.ix.partByNumberKey.get(k) || this.ix.partByIdKey.get(k) || null;
          },
          listSchematicsForModel: async (modelId) => {
            const mid = (modelId || '').trim();
            return this.schematics
              .filter(s => (s.modelID || '').trim() === mid)
              .sort((a,b)=> (toNum(a.order)||0) - (toNum(b.order)||0) || a.id.localeCompare(b.id));
          },
          listPartsForSchematic: async (schemId) => {
            // This project uses a joined view via search.js when needed.
            // If you have schematic_parts.csv already loaded in another context,
            // keep your existing implementation. Here we only provide primitives.
            console.warn('DB.listPartsForSchematic should be provided elsewhere (kept as-is in your page scripts).');
            return [];
          }
        };
      })();
      return this.ready;
    }
  };

  // Helpers
  function toNum(v){
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function key(s){
    return String(s || '').toUpperCase().replace(/[\s\-_]/g,'').trim();
  }

  function parseCSV(text){
    // Robust CSV parser handling quotes and commas in fields
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;
    const pushField = () => { row.push(field); field=''; };
    const pushRow = () => { if (row.length>0 && !(row.length===1 && row[0]==='')) rows.push(row); row=[]; };

    while (i < text.length){
      const c = text[i];
      if (inQuotes){
        if (c === '"'){
          if (text[i+1] === '"'){ field+='"'; i+=2; continue; } // escaped quote
          inQuotes = false; i++; continue;
        } else {
          field += c; i++; continue;
        }
      } else {
        if (c === '"'){ inQuotes = true; i++; continue; }
        if (c === ','){ pushField(); i++; continue; }
        if (c === '\r'){
          if (text[i+1] === '\n'){ pushField(); pushRow(); i+=2; continue; }
          pushField(); pushRow(); i++; continue;
        }
        if (c === '\n'){ pushField(); pushRow(); i++; continue; }
        field += c; i++; continue;
      }
    }
    pushField(); pushRow();
    if (!rows.length) return [];

    const headers = rows[0].map(h => String(h).trim());
    const out = [];
    for (let r = 1; r < rows.length; r++){
      const obj = {};
      const rowVals = rows[r];
      for (let c = 0; c < headers.length; c++){
        obj[headers[c]] = rowVals[c] !== undefined ? rowVals[c] : '';
      }
      out.push(obj);
    }
    return out;
  }

  // expose DB early (init async)
  window.DB = window.DB || DB;
  DB.init();

  /* --------------------------- Search core logic ------------------------ */

  // Public API
  window.runSearch = async function runSearch(rawQuery){
    await DB.init();

    const qRaw = String(rawQuery || '').trim();
    if (!qRaw) return showToast('Enter a model or part number.');
    const q = key(qRaw);

    // 1) Exact hits (priority: model > part > schematic)
    const model = DB.ix.modelByKey.get(q);
    if (model) return go(`model.html?id=${encodeURIComponent(model.modelNumber || model.id)}`);

    const part = DB.ix.partByNumberKey.get(q) || DB.ix.partByIdKey.get(q);
    if (part) return go(`parts.html?id=${encodeURIComponent(part.number || part.id)}`);

    const schem = DB.ix.schematicByKey.get(q);
    if (schem) return go(`schematic.html?id=${encodeURIComponent(schem.id)}`);

    // 2) Strong prefix / substring hits (disambiguate first)
    const best = findBestCandidates(qRaw, DB);
    if (best.uniqueRoute){
      return go(best.uniqueRoute);
    }

    // 3) No single winner → show suggestions overlay
    if (best.totalFound > 0){
      openSuggestionsOverlay(qRaw, best);
    } else {
      openSuggestionsOverlay(qRaw, {models:[], parts:[], schematics:[], totalFound:0});
      showToast('No matches found. Try a different model/part number.');
    }
  };

  // attach typeahead to known inputs (optional, safe if not present)
  document.addEventListener('DOMContentLoaded', () => {
    const ids = ['header-search-input', 'hero-search-input'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('autocomplete','off');
      el.addEventListener('input', debounce(async (e) => {
        await DB.init();
        const val = e.target.value || '';
        const s = findBestCandidates(val, DB, {limitModels:5, limitParts:5, limitSchems:5});
        if (val.trim()){
          openSuggestionsOverlay(val, s, {anchor: el});
        } else {
          closeSuggestionsOverlay();
        }
      }, 120));
      el.addEventListener('blur', () => {
        // slight delay so click can register
        setTimeout(closeSuggestionsOverlay, 150);
      });
    });
  });

  /* ------------------------- Candidate generation ----------------------- */

  function findBestCandidates(query, DB, limits){
    const lim = {
      limitModels: 8,
      limitParts: 8,
      limitSchems: 5,
      ...limits
    };
    const qNorm = key(query);
    if (!qNorm) return {models:[], parts:[], schematics:[], totalFound:0};

    const scoredModels = [];
    for (const m of DB.models){
      const hay = m.modelNumber || m.id || '';
      const s = score(qNorm, hay);
      if (s > 0.55) scoredModels.push({score:s, label: m.modelNumber, sub: m.brand, route: `model.html?id=${encodeURIComponent(m.modelNumber || m.id)}`});
    }

    const scoredParts = [];
    for (const p of DB.parts){
      const primary = p.number || p.id || '';
      let s = score(qNorm, primary);
      // also consider name/description as weak signal
      if (s < 0.7 && (p.name || p.description)){
        const extra = Math.max(
          p.name ? scoreLoose(qNorm, p.name) : 0,
          p.description ? scoreLoose(qNorm, p.description) : 0
        ) * 0.9;
        s = Math.max(s, extra);
      }
      if (s > 0.55){
        scoredParts.push({
          score:s,
          label: primary,
          sub: p.name || p.description || '',
          route: `parts.html?id=${encodeURIComponent(primary)}`
        });
      }
    }

    const scoredSchems = [];
    for (const s of DB.schematics){
      const id = s.id || '';
      const nm = s.name || '';
      const combo = `${s.modelID || ''} ${nm} ${id}`;
      const sc = Math.max(score(qNorm, id), scoreLoose(qNorm, combo));
      if (sc > 0.6){
        scoredSchems.push({
          score: sc,
          label: nm || id,
          sub: s.modelID ? `Model ${s.modelID}` : '',
          route: `schematic.html?id=${encodeURIComponent(id)}`
        });
      }
    }

    scoredModels.sort((a,b)=> b.score - a.score);
    scoredParts.sort((a,b)=> b.score - a.score);
    scoredSchems.sort((a,b)=> b.score - a.score);

    const models = scoredModels.slice(0, lim.limitModels);
    const parts = scoredParts.slice(0, lim.limitParts);
    const schematics = scoredSchems.slice(0, lim.limitSchems);

    // If we have a very confident top hit and others are far behind, auto-route.
    const uniqueRoute = pickUniqueRoute(models, parts, schematics);

    return {
      models, parts, schematics,
      uniqueRoute,
      totalFound: models.length + parts.length + schematics.length
    };
  }

  function pickUniqueRoute(models, parts, schems){
    // Confidence heuristic: score gap > 0.12 and top score >= 0.9
    const top = [models[0], parts[0], schems[0]].filter(Boolean).sort((a,b)=> b.score - a.score)[0];
    const runnerUp = [models[1], parts[1], schems[1]].filter(Boolean).sort((a,b)=> b.score - a.score)[0];
    if (!top) return null;
    const gap = (top?.score || 0) - (runnerUp?.score || 0);
    if (top.score >= 0.9 && gap >= 0.12) return top.route;
    return null;
  }

  /* -------------------------- Scoring functions ------------------------- */

  function score(qKey, hayRaw){
    // Strong score: exact/prefix/substring + edit distance
    const hayKey = key(hayRaw);
    if (!hayKey) return 0;
    if (hayKey === qKey) return 1.0;
    if (hayKey.startsWith(qKey)) return 0.97 * (qKey.length / hayKey.length);
    if (hayKey.includes(qKey)) return 0.90 * (qKey.length / hayKey.length);

    const d = editDistance(qKey, hayKey);
    const maxLen = Math.max(qKey.length, hayKey.length);
    const sim = 1 - (d / maxLen);            // 0..1
    return sim * 0.85;                        // dampen fuzzy vs exact
  }

  function scoreLoose(qKey, text){
    const hay = key(text);
    if (!hay) return 0;
    if (hay.includes(qKey)) return 0.88 * (qKey.length / Math.max(hay.length, qKey.length));
    const d = editDistance(qKey, hay);
    const sim = 1 - (d / Math.max(qKey.length, hay.length));
    return sim * 0.75;
  }

  // Levenshtein (iterative, O(mn) but small strings here)
  function editDistance(a, b){
    const m = a.length, n = b.length;
    if (m === 0) return n; if (n === 0) return m;
    const dp = new Array(n+1);
    for (let j=0;j<=n;j++) dp[j]=j;
    for (let i=1;i<=m;i++){
      let prev = dp[0]; dp[0]=i;
      for (let j=1;j<=n;j++){
        const tmp = dp[j];
        if (a[i-1] === b[j-1]) dp[j]=prev;
        else dp[j]=Math.min(prev+1, dp[j]+1, dp[j-1]+1);
        prev = tmp;
      }
    }
    return dp[n];
  }

  /* ------------------------- Suggestions overlay UI --------------------- */

  let overlayEl = null;
  let overlayStyleInjected = false;

  function injectOverlayStyles(){
    if (overlayStyleInjected) return;
    overlayStyleInjected = true;
    const css = `
    .srch-ovl{position:fixed; inset:auto 0 0 0; top:80px; z-index:9999; display:flex; justify-content:center; pointer-events:none;}
    .srch-card{pointer-events:auto; max-width:960px; width:92%; background:#fff; border:1px solid #e5e7eb; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.12); padding:12px;}
    .srch-head{display:flex; align-items:center; gap:8px; padding:6px 8px 10px; border-bottom:1px solid #f0f2f4; font-weight:700;}
    .srch-body{display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; padding:10px 6px;}
    .srch-col h4{margin:0 0 6px; font-size:14px; color:#374151;}
    .srch-list{list-style:none; margin:0; padding:0; max-height:300px; overflow:auto;}
    .srch-item{padding:8px 8px; border-radius:8px; cursor:pointer; display:flex; flex-direction:column; gap:2px;}
    .srch-item:hover{background:#f8fafc;}
    .srch-label{font-weight:600; color:#111827;}
    .srch-sub{font-size:12px; color:#6b7280;}
    .srch-empty{color:#9ca3af; font-style:italic; font-size:12px;}
    .srch-close{margin-left:auto; background:#ef4444; color:#fff; border:none; border-radius:999px; padding:6px 10px; cursor:pointer;}
    @media (max-width: 900px){ .srch-body{grid-template-columns: 1fr;}}
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function openSuggestionsOverlay(query, buckets, opts={}){
    injectOverlayStyles();
    closeSuggestionsOverlay();

    overlayEl = document.createElement('div');
    overlayEl.className = 'srch-ovl';
    overlayEl.innerHTML = `
      <div class="srch-card">
        <div class="srch-head">
          <span>Search results for "<span>${escapeHTML(query)}</span>"</span>
          <button type="button" class="srch-close" title="Close">Close</button>
        </div>
        <div class="srch-body">
          ${renderBucket('Models', buckets.models)}
          ${renderBucket('Parts', buckets.parts)}
          ${renderBucket('Schematics', buckets.schematics)}
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('.srch-close').addEventListener('click', closeSuggestionsOverlay);

    // Click handlers
    overlayEl.querySelectorAll('.srch-item').forEach(li => {
      li.addEventListener('click', () => {
        const route = li.getAttribute('data-route');
        if (route) go(route);
      });
    });
  }

  function closeSuggestionsOverlay(){
    if (overlayEl && overlayEl.parentNode){
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  function renderBucket(title, items){
    if (!items || items.length === 0){
      return `
        <div class="srch-col">
          <h4>${title}</h4>
          <div class="srch-empty">No matches</div>
        </div>
      `;
    }
    const lis = items.map(it => `
      <li class="srch-item" data-route="${escapeAttr(it.route)}">
        <span class="srch-label">${escapeHTML(it.label)}</span>
        ${it.sub ? `<span class="srch-sub">${escapeHTML(it.sub)}</span>` : ''}
      </li>
    `).join('');
    return `
      <div class="srch-col">
        <h4>${title}</h4>
        <ul class="srch-list">${lis}</ul>
      </div>
    `;
  }

  function showToast(msg){
    // Minimal unobtrusive toast
    const el = document.createElement('div');
    el.style.position='fixed';
    el.style.left='50%';
    el.style.bottom='18px';
    el.style.transform='translateX(-50%)';
    el.style.background='#111827';
    el.style.color='#fff';
    el.style.padding='10px 14px';
    el.style.borderRadius='10px';
    el.style.boxShadow='0 8px 24px rgba(0,0,0,.25)';
    el.style.zIndex='99999';
    el.style.fontSize='14px';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(()=>{ try{document.body.removeChild(el);}catch{} }, 2000);
  }

  function go(url){ location.href = url; }

  function escapeHTML(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s){ return escapeHTML(s).replace(/"/g, '&quot;'); }

  function debounce(fn, ms){
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  }
})();
