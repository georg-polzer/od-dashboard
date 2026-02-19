const SHAPES_PATH = "data/deldd-5-border-traffic-internal-use-1771493885661-shapes.json";
const COUNTS_PATH = "data/deldd-5-border-traffic-internal-use-1771493885661-counts.csv";

const selectedZoneEl = document.getElementById("selected-zone");
const clearSelectionBtn = document.getElementById("clear-selection");
const minCountEl = document.getElementById("min-count");
const minCountValueEl = document.getElementById("min-count-value");
const maxArrowsEl = document.getElementById("max-arrows");
const maxArrowsValueEl = document.getElementById("max-arrows-value");
const minDistanceEl = document.getElementById("min-distance");
const minDistanceValueEl = document.getElementById("min-distance-value");
const maxDistanceEl = document.getElementById("max-distance");
const maxDistanceValueEl = document.getElementById("max-distance-value");
const outboundTotalEl = document.getElementById("outbound-total");
const inboundTotalEl = document.getElementById("inbound-total");
const connectedZonesEl = document.getElementById("connected-zones");
const showOutboundEl = document.getElementById("show-outbound");
const showInboundEl = document.getElementById("show-inbound");
const modeFilterEl = document.getElementById("mode-filter");
const hourFilterEl = document.getElementById("hour-filter");
const hoursAllEl = document.getElementById("hours-all");
const hoursNoneEl = document.getElementById("hours-none");
const hourSummaryEl = document.getElementById("hour-summary");
const resetFiltersEl = document.getElementById("reset-filters");

const zoneMeta = new Map();
const trips = [];
const selectedZoneIds = new Set();
let geoLayer;
let flowLinesLayer;
let flowArrowsLayer;

const map = L.map("map", { zoomControl: true });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

function parseCsv(text) {
  const parsed = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    console.error("CSV parse errors", parsed.errors.slice(0, 5));
  }
  return parsed.data;
}

function lineWeight(count, maxCount) {
  if (maxCount <= 0) {
    return 2;
  }
  const t = count / maxCount;
  return 1.5 + t * 10;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Math.round(value));
}

function baseStyle(feature) {
  const isSelected = selectedZoneIds.has(String(feature.id));
  return {
    color: isSelected ? "#0b3d2e" : "#597466",
    weight: isSelected ? 2.8 : 0.6,
    fillColor: isSelected ? "#7bb387" : "#b9d1be",
    fillOpacity: isSelected ? 0.42 : 0.2
  };
}

function addArrow(line, color, width) {
  const points = line.getLatLngs();
  if (!Array.isArray(points) || points.length < 2) {
    return;
  }

  const from = points[points.length - 2];
  const to = points[points.length - 1];
  const fromPx = map.latLngToLayerPoint(from);
  const toPx = map.latLngToLayerPoint(to);
  const angle = (Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x) * 180) / Math.PI;
  const size = Math.max(10, Math.round(width * 1.8));

  const icon = L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [0, size / 2],
    html: `<div class="flow-arrow-head" style="--arrow-size:${size}px;--arrow-color:${color};transform: translateY(-50%) rotate(${angle}deg);"></div>`
  });

  L.marker([to.lat, to.lng], {
    icon,
    interactive: false,
    keyboard: false
  }).addTo(flowArrowsLayer);
}

function closeAllFlowTooltips() {
  flowLinesLayer.eachLayer((layer) => {
    if (layer.closeTooltip) {
      layer.closeTooltip();
    }
  });
}

function attachLineHoverTooltip(line, html) {
  line.bindTooltip(html, { className: "flow-tooltip", sticky: false });
  line.on("mouseover", () => {
    closeAllFlowTooltips();
    line.openTooltip();
  });
  line.on("mouseout", () => {
    line.closeTooltip();
  });
}

function createOffsetSegment(start, end, referenceStart, referenceEnd, side) {
  const [lat1, lng1] = start;
  const [lat2, lng2] = end;
  const [rLat1, rLng1] = referenceStart;
  const [rLat2, rLng2] = referenceEnd;
  const dLat = rLat2 - rLat1;
  const dLng = rLng2 - rLng1;
  const dist = Math.hypot(dLat, dLng);

  if (!Number.isFinite(dist) || dist === 0) {
    return [start, end];
  }

  const normLat = -dLng / dist;
  const normLng = dLat / dist;
  const offset = Math.min(0.04, Math.max(0.005, dist * 0.03));
  const offLat = normLat * offset * side;
  const offLng = normLng * offset * side;

  return [
    [lat1 + offLat, lng1 + offLng],
    [lat2 + offLat, lng2 + offLng]
  ];
}

function updateStats(zoneId, inbound, outbound) {
  if (!zoneId) {
    outboundTotalEl.textContent = "0";
    inboundTotalEl.textContent = "0";
    connectedZonesEl.textContent = "0";
    return;
  }

  const outboundTotal = outbound.reduce((sum, item) => sum + item.count, 0);
  const inboundTotal = inbound.reduce((sum, item) => sum + item.count, 0);
  const connected = new Set([...outbound.map((x) => x.otherId), ...inbound.map((x) => x.otherId)]);

  outboundTotalEl.textContent = formatNumber(outboundTotal);
  inboundTotalEl.textContent = formatNumber(inboundTotal);
  connectedZonesEl.textContent = formatNumber(connected.size);
}

function getSelectedHours() {
  const selected = new Set();
  for (const option of hourFilterEl.selectedOptions) {
    selected.add(Number(option.value));
  }
  return selected;
}

function getSelectedZoneIdList() {
  return Array.from(selectedZoneIds);
}

function updateSelectedZoneLabel() {
  const selectedIds = getSelectedZoneIdList();
  if (selectedIds.length === 0) {
    selectedZoneEl.textContent = "None";
    return;
  }
  if (selectedIds.length === 1) {
    const zone = zoneMeta.get(selectedIds[0]);
    selectedZoneEl.textContent = `${zone.name} (${zone.id})`;
    return;
  }
  selectedZoneEl.textContent = `${selectedIds.length} zones selected`;
}

function updateHourSummary() {
  const selectedCount = hourFilterEl.selectedOptions.length;
  hourSummaryEl.textContent = `${selectedCount} / 24 hours selected`;
}

function aggregateSelectedZoneFlows() {
  const selectedIds = getSelectedZoneIdList();
  if (selectedIds.length === 0) {
    return { inbound: [], outbound: [] };
  }

  const modeFilter = modeFilterEl.value;
  const selectedHours = getSelectedHours();
  const minDistance = Number(minDistanceEl.value);
  const maxDistance = Number(maxDistanceEl.value);
  if (selectedHours.size === 0) {
    return { inbound: [], outbound: [] };
  }

  if (selectedIds.length > 1) {
    const selectedIdSet = new Set(selectedIds);
    const betweenMap = new Map();
    for (const trip of trips) {
      if (modeFilter !== "all" && trip.mode !== modeFilter) {
        continue;
      }
      if (!selectedHours.has(trip.hour)) {
        continue;
      }
      if (trip.distanceKm < minDistance || trip.distanceKm > maxDistance) {
        continue;
      }
      if (!selectedIdSet.has(trip.startId) || !selectedIdSet.has(trip.endId) || trip.startId === trip.endId) {
        continue;
      }

      const key = `${trip.startId}|${trip.endId}`;
      betweenMap.set(key, (betweenMap.get(key) || 0) + trip.count);
    }

    const between = Array.from(betweenMap.entries()).map(([key, count]) => {
      const [startId, endId] = key.split("|");
      return { startId, endId, count };
    });
    return { inbound: between, outbound: [] };
  }

  const selectedZoneId = selectedIds[0];
  const outboundMap = new Map();
  const inboundMap = new Map();

  for (const trip of trips) {
    if (modeFilter !== "all" && trip.mode !== modeFilter) {
      continue;
    }
    if (!selectedHours.has(trip.hour)) {
      continue;
    }
    if (trip.distanceKm < minDistance || trip.distanceKm > maxDistance) {
      continue;
    }

    if (trip.startId === selectedZoneId) {
      outboundMap.set(trip.endId, (outboundMap.get(trip.endId) || 0) + trip.count);
    }
    if (trip.endId === selectedZoneId) {
      inboundMap.set(trip.startId, (inboundMap.get(trip.startId) || 0) + trip.count);
    }
  }

  const outbound = Array.from(outboundMap.entries()).map(([otherId, count]) => ({ otherId, count }));
  const inbound = Array.from(inboundMap.entries()).map(([otherId, count]) => ({ otherId, count }));
  return { inbound, outbound };
}

function renderFlows() {
  flowLinesLayer.clearLayers();
  flowArrowsLayer.clearLayers();

  const selectedIds = getSelectedZoneIdList();
  if (selectedIds.length === 0) {
    updateStats(null, [], []);
    return;
  }

  const showOutbound = showOutboundEl.checked;
  const showInbound = showInboundEl.checked;
  const minCount = Number(minCountEl.value);
  const maxArrows = Number(maxArrowsEl.value);
  const selectedZoneId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedCenter = selectedZoneId ? zoneMeta.get(selectedZoneId).center : null;
  const { inbound: inboundRaw, outbound: outboundRaw } = aggregateSelectedZoneFlows();

  if (selectedIds.length > 1) {
    const betweenAll = inboundRaw
      .filter((x) => x.count >= minCount && zoneMeta.has(x.startId) && zoneMeta.has(x.endId))
      .sort((a, b) => b.count - a.count);

    const outbound = showOutbound
      ? betweenAll.filter((x) => x.startId < x.endId).slice(0, maxArrows)
      : [];
    const inbound = showInbound
      ? betweenAll.filter((x) => x.startId > x.endId).slice(0, maxArrows)
      : [];

    const outboundTotal = outbound.reduce((sum, item) => sum + item.count, 0);
    const inboundTotal = inbound.reduce((sum, item) => sum + item.count, 0);
    const connected = new Set();
    for (const item of [...outbound, ...inbound]) {
      connected.add(item.startId);
      connected.add(item.endId);
    }
    outboundTotalEl.textContent = formatNumber(outboundTotal);
    inboundTotalEl.textContent = formatNumber(inboundTotal);
    connectedZonesEl.textContent = formatNumber(connected.size);

    const allRendered = [...outbound, ...inbound];
    const maxCount = allRendered.length > 0 ? Math.max(...allRendered.map((x) => x.count)) : 1;

    for (const item of outbound) {
      const startCenter = zoneMeta.get(item.startId).center;
      const endCenter = zoneMeta.get(item.endId).center;
      const width = lineWeight(item.count, maxCount);
      const referenceStart = item.startId < item.endId ? startCenter : endCenter;
      const referenceEnd = item.startId < item.endId ? endCenter : startCenter;
      const side = item.startId < item.endId ? 1 : -1;
      const points = createOffsetSegment(startCenter, endCenter, referenceStart, referenceEnd, side);
      const line = L.polyline(points, {
        color: "#bf4f17",
        opacity: 0.75,
        weight: width
      }).addTo(flowLinesLayer);

      attachLineHoverTooltip(
        line,
        `${zoneMeta.get(item.startId).name} -> ${zoneMeta.get(item.endId).name}<br><b>${formatNumber(item.count)}</b> trips`
      );
      addArrow(line, "#bf4f17", width);
    }

    for (const item of inbound) {
      const startCenter = zoneMeta.get(item.startId).center;
      const endCenter = zoneMeta.get(item.endId).center;
      const width = lineWeight(item.count, maxCount);
      const referenceStart = item.startId < item.endId ? startCenter : endCenter;
      const referenceEnd = item.startId < item.endId ? endCenter : startCenter;
      const side = item.startId < item.endId ? 1 : -1;
      const points = createOffsetSegment(startCenter, endCenter, referenceStart, referenceEnd, side);
      const line = L.polyline(points, {
        color: "#2f6f73",
        opacity: 0.75,
        weight: width
      }).addTo(flowLinesLayer);

      attachLineHoverTooltip(
        line,
        `${zoneMeta.get(item.startId).name} -> ${zoneMeta.get(item.endId).name}<br><b>${formatNumber(item.count)}</b> trips`
      );
      addArrow(line, "#2f6f73", width);
    }
    return;
  }

  const outbound = showOutbound
    ? outboundRaw
        .filter((x) => x.count >= minCount && zoneMeta.has(x.otherId))
        .sort((a, b) => b.count - a.count)
        .slice(0, maxArrows)
    : [];

  const inbound = showInbound
    ? inboundRaw
        .filter((x) => x.count >= minCount && zoneMeta.has(x.otherId))
        .sort((a, b) => b.count - a.count)
        .slice(0, maxArrows)
    : [];

  updateStats(selectedZoneId, inbound, outbound);

  const allCounts = [...outbound.map((x) => x.count), ...inbound.map((x) => x.count)];
  const maxCount = allCounts.length > 0 ? Math.max(...allCounts) : 1;

  for (const item of outbound) {
    const endCenter = zoneMeta.get(item.otherId).center;
    const width = lineWeight(item.count, maxCount);
    const points = createOffsetSegment(selectedCenter, endCenter, selectedCenter, endCenter, 1);
    const line = L.polyline(points, {
      color: "#bf4f17",
      opacity: 0.75,
      weight: width
    }).addTo(flowLinesLayer);

    attachLineHoverTooltip(
      line,
      `${zoneMeta.get(selectedZoneId).name} -> ${zoneMeta.get(item.otherId).name}<br><b>${formatNumber(item.count)}</b> trips`,
    );
    addArrow(line, "#bf4f17", width);
  }

  for (const item of inbound) {
    const startCenter = zoneMeta.get(item.otherId).center;
    const width = lineWeight(item.count, maxCount);
    const points = createOffsetSegment(
      startCenter,
      selectedCenter,
      selectedCenter,
      startCenter,
      -1
    );
    const line = L.polyline(points, {
      color: "#2f6f73",
      opacity: 0.75,
      weight: width
    }).addTo(flowLinesLayer);

    attachLineHoverTooltip(
      line,
      `${zoneMeta.get(item.otherId).name} -> ${zoneMeta.get(selectedZoneId).name}<br><b>${formatNumber(item.count)}</b> trips`,
    );
    addArrow(line, "#2f6f73", width);
  }
}

function selectZone(zoneId) {
  if (selectedZoneIds.has(zoneId)) {
    selectedZoneIds.delete(zoneId);
  } else {
    selectedZoneIds.add(zoneId);
  }

  updateSelectedZoneLabel();
  geoLayer.setStyle(baseStyle);
  renderFlows();
}

function populateHourFilter() {
  for (let h = 0; h < 24; h += 1) {
    const option = document.createElement("option");
    option.value = String(h);
    option.textContent = `${String(h).padStart(2, "0")}:00`;
    option.selected = true;
    hourFilterEl.appendChild(option);
  }
  updateHourSummary();
}

function parseTrips(rows) {
  const activeZoneIds = new Set();
  let maxDistance = 0;

  for (const row of rows) {
    const startId = String(row.StartId ?? "").trim();
    const endId = String(row.EndId ?? "").trim();
    const count = Number(row.Count ?? 0);
    const hour = Number(row["Start Hour"] ?? Number.NaN);
    const distanceKm = Number(row.DistanceInKm ?? Number.NaN);
    const mode = String(row.Mot ?? "").trim();

    if (!startId || !endId || !zoneMeta.has(startId) || !zoneMeta.has(endId)) {
      continue;
    }
    if (
      !Number.isFinite(count) ||
      count <= 0 ||
      !Number.isFinite(hour) ||
      !Number.isFinite(distanceKm) ||
      distanceKm < 0
    ) {
      continue;
    }

    activeZoneIds.add(startId);
    activeZoneIds.add(endId);
    maxDistance = Math.max(maxDistance, distanceKm);
    trips.push({ startId, endId, count, hour, mode, distanceKm });
  }

  return { activeZoneIds, maxDistance };
}

async function init() {
  const [shapeRes, csvRes] = await Promise.all([fetch(SHAPES_PATH), fetch(COUNTS_PATH)]);
  const [shapeJson, csvText] = await Promise.all([shapeRes.json(), csvRes.text()]);

  for (const feature of shapeJson.features) {
    const id = String(feature.id);
    const name = feature.properties?.name || id;
    const lon = Number(feature.properties?.lon);
    const lat = Number(feature.properties?.lat);

    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    zoneMeta.set(id, { id, name, center: [lat, lon] });
  }

  populateHourFilter();
  const { activeZoneIds, maxDistance } = parseTrips(parseCsv(csvText));
  const roundedMaxDistance = Math.max(1, Math.ceil(maxDistance));
  minDistanceEl.max = String(roundedMaxDistance);
  maxDistanceEl.max = String(roundedMaxDistance);
  minDistanceEl.value = "0";
  maxDistanceEl.value = String(roundedMaxDistance);
  minDistanceValueEl.textContent = "0";
  maxDistanceValueEl.textContent = String(roundedMaxDistance);

  const filteredShapeJson = {
    ...shapeJson,
    features: shapeJson.features.filter((feature) => activeZoneIds.has(String(feature.id)))
  };

  geoLayer = L.geoJSON(filteredShapeJson, {
    style: baseStyle,
    onEachFeature: (feature, layer) => {
      const zoneId = String(feature.id);
      const name = zoneMeta.get(zoneId)?.name || zoneId;

      layer.bindTooltip(`${name} (${zoneId})`, { sticky: true });
      layer.on("click", () => selectZone(zoneId));
      layer.on("mouseover", () => {
        if (!selectedZoneIds.has(zoneId)) {
          layer.setStyle({ weight: 1.3, fillOpacity: 0.32 });
        }
      });
      layer.on("mouseout", () => {
        geoLayer.resetStyle(layer);
      });
    }
  }).addTo(map);

  flowLinesLayer = L.layerGroup().addTo(map);
  flowArrowsLayer = L.layerGroup().addTo(map);
  const bounds = geoLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [12, 12] });
  } else {
    map.setView([52.2, 9.6], 7);
  }

  clearSelectionBtn.addEventListener("click", () => {
    selectedZoneIds.clear();
    updateSelectedZoneLabel();
    geoLayer.setStyle(baseStyle);
    renderFlows();
  });

  minCountEl.addEventListener("input", () => {
    minCountValueEl.textContent = minCountEl.value;
    renderFlows();
  });
  maxArrowsEl.addEventListener("input", () => {
    maxArrowsValueEl.textContent = maxArrowsEl.value;
    renderFlows();
  });
  minDistanceEl.addEventListener("input", () => {
    if (Number(minDistanceEl.value) > Number(maxDistanceEl.value)) {
      maxDistanceEl.value = minDistanceEl.value;
      maxDistanceValueEl.textContent = maxDistanceEl.value;
    }
    minDistanceValueEl.textContent = minDistanceEl.value;
    renderFlows();
  });
  maxDistanceEl.addEventListener("input", () => {
    if (Number(maxDistanceEl.value) < Number(minDistanceEl.value)) {
      minDistanceEl.value = maxDistanceEl.value;
      minDistanceValueEl.textContent = minDistanceEl.value;
    }
    maxDistanceValueEl.textContent = maxDistanceEl.value;
    renderFlows();
  });

  showOutboundEl.addEventListener("change", renderFlows);
  showInboundEl.addEventListener("change", renderFlows);
  modeFilterEl.addEventListener("change", renderFlows);
  hourFilterEl.addEventListener("change", renderFlows);
  hourFilterEl.addEventListener("change", updateHourSummary);
  hourFilterEl.addEventListener("mousedown", (event) => {
    if (event.target.tagName !== "OPTION") {
      return;
    }
    event.preventDefault();
    const option = event.target;
    option.selected = !option.selected;
    updateHourSummary();
    renderFlows();
  });

  hoursAllEl.addEventListener("click", () => {
    for (const option of hourFilterEl.options) {
      option.selected = true;
    }
    updateHourSummary();
    renderFlows();
  });

  hoursNoneEl.addEventListener("click", () => {
    for (const option of hourFilterEl.options) {
      option.selected = false;
    }
    updateHourSummary();
    renderFlows();
  });

  resetFiltersEl.addEventListener("click", () => {
    showOutboundEl.checked = true;
    showInboundEl.checked = true;
    modeFilterEl.value = "all";
    minCountEl.value = "1";
    minCountValueEl.textContent = "1";
    maxArrowsEl.value = "80";
    maxArrowsValueEl.textContent = "80";
    minDistanceEl.value = minDistanceEl.min;
    maxDistanceEl.value = maxDistanceEl.max;
    minDistanceValueEl.textContent = minDistanceEl.value;
    maxDistanceValueEl.textContent = maxDistanceEl.value;
    for (const option of hourFilterEl.options) {
      option.selected = true;
    }
    updateHourSummary();
    renderFlows();
  });
}

init().catch((error) => {
  console.error(error);
  selectedZoneEl.textContent = "Failed to load data";
});
