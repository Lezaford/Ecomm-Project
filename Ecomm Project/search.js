async function runSearch(query) {
  const res = await fetch("search.json");
  const data = await res.json();

  const q = query.trim().toLowerCase();

  // Exact model match
  const model = data.models.find(m => m.modelNumber.toLowerCase() === q);
  if (model) {
    location.href = "model.html?id=" + encodeURIComponent(model.id);
    return;
  }

  // Exact part match
  const part = data.parts.find(p => p.number.toLowerCase() === q);
  if (part) {
    location.href = "part.html?id=" + encodeURIComponent(part.id);
    return;
  }

  // Otherwise show results (you could build a results.html dynamically)
  localStorage.setItem("lastSearchResults", JSON.stringify({ models: data.models, parts: data.parts, query }));
  location.href = "results.html";
}
