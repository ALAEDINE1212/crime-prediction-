const API_BASE = "https://crime-prediction-apii.onrender.com";


let map, hotspotLayer;

function setStatus(msg) {
    document.getElementById("status").textContent = msg;
}

function bboxString() {
    const b = map.getBounds();
    const latMin = b.getSouthWest().lat;
    const lonMin = b.getSouthWest().lng;
    const latMax = b.getNorthEast().lat;
    const lonMax = b.getNorthEast().lng;
    return `${latMin},${lonMin},${latMax},${lonMax}`;
}

function circleStyle() {
    return {
        radius: 6,
        color: "#ff3b30",
        weight: 1,
        fillColor: "#ff3b30",
        fillOpacity: 0.75,
    };
}

async function loadMonths() {
    try {
        setStatus("Loading months...");
        const res = await fetch(`${API_BASE}/months`);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();

        const months = data.forecast_months || [];
        const sel = document.getElementById("monthSelect");
        sel.innerHTML = "";

        for (const m of months) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            sel.appendChild(opt);
        }

        if (months.length > 0) {
            // auto-select latest month
            sel.selectedIndex = months.length - 1;
            setStatus(`Loaded ${months.length} months.`);
        } else {
            setStatus("No valid months returned. Check dataset history.");
        }
    } catch (e) {
        console.error(e);
        setStatus(`Failed to load months: ${e.message}`);
    }
}

async function loadHotspots() {
    try {
        const month = document.getElementById("monthSelect").value;
        const topPct = parseFloat(document.getElementById("topPct").value || "0.05");
        const useBbox = document.getElementById("useBbox").checked;

        if (!month) {
            setStatus("No month selected.");
            return;
        }

        setStatus("Loading hotspots...");
        let url = `${API_BASE}/predict?forecast_month=${encodeURIComponent(month)}&top_pct=${encodeURIComponent(topPct)}`;
        if (useBbox) url += `&bbox=${encodeURIComponent(bboxString())}`;

        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();

        hotspotLayer.clearLayers();

        const geojson = data.geojson || { type: "FeatureCollection", features: [] };

        L.geoJSON(geojson, {
            pointToLayer: (feature, latlng) => L.circleMarker(latlng, circleStyle()),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                const html = `
          <div>
            <div><b>Cell</b>: ${p.cell_id}</div>
            <div><b>Forecast</b>: ${p.forecast_month}</div>
            <div><b>Predicted</b>: ${Number(p.predicted_count).toFixed(2)}</div>
            <div><b>Actual</b>: ${p.actual_count === null ? "N/A" : Number(p.actual_count).toFixed(2)}</div>
          </div>`;
                layer.bindPopup(html);
            },
        }).addTo(hotspotLayer);

        const meta = data.meta || {};
        setStatus(`Done. Returned ${meta.returned_points || 0}/${meta.total_points || 0}.`);
    } catch (e) {
        console.error(e);
        setStatus(`Failed to load hotspots: ${e.message}`);
    }
}

async function predictPoint(lat, lon) {
    try {
        const month = document.getElementById("monthSelect").value;
        if (!month) return;

        const url = `${API_BASE}/predict_point?forecast_month=${encodeURIComponent(month)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();

        document.getElementById("clickInfo").textContent = JSON.stringify(data, null, 2);
    } catch (e) {
        console.error(e);
        document.getElementById("clickInfo").textContent = `Click query failed: ${e.message}`;
    }
}

function initMap() {
    map = L.map("map").setView([53.80, -1.55], 10);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    hotspotLayer = L.layerGroup().addTo(map);

    map.on("click", (e) => predictPoint(e.latlng.lat, e.latlng.lng));
}

document.getElementById("btnLoad").addEventListener("click", loadHotspots);

(async function main() {
    initMap();
    await loadMonths();
    await loadHotspots(); // auto-load
})();
