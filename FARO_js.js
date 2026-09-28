import units from "./unidades.js";
import lineaCostaSpain from "./00_MapaBase/Linea_Costa_Espana.geojson" with { type: "json" };
import capitanias from "./00_MapaBase/Mar/Capitanias.geojson" with { type: "json" };
import capitaniasAreas from "./00_MapaBase/Mar/Capitanias_AreaTerritorial.geojson" with { type: "json" };
import srrSarMundiales from "./00_MapaBase/Mar/SRR_SARWorld.geojson" with { type: "json" };
const costaLayer = L.geoJSON(lineaCostaSpain);
const capitaniasLayer = L.geoJSON(capitanias);
const capitaniasAreasLayer = L.geoJSON(capitaniasAreas);
const srrSarMundialesLayer = L.geoJSON(srrSarMundiales);
const map = L.map("map");
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);
const esri = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 19, attribution: "Tiles &copy; Esri" },
);
const cartaENC = L.tileLayer.wms("https://ideihm.covam.es/wms/cartaENCp2", {
  layers: "ENC_ES2",
  format: "image/png",
  transparent: true,
  version: "1.3.0",
});
let sarId = 0;
let unidadPendienteSAR = null;

const aisAnimations = {};
const aisShipsData = {};
const vesselLayers = {
  salvamar: L.layerGroup().addTo(map),
  Buque_Polivalente: L.layerGroup().addTo(map),
  remolcador: L.layerGroup().addTo(map),
  helicoptero: L.layerGroup().addTo(map),
  pesquero: L.layerGroup().addTo(map),
  patrullera: L.layerGroup().addTo(map),
  otros: L.layerGroup().addTo(map),
};

// Descarga config del servidor cada 3 segundos
let lastUpdate = 0;

setInterval(async () => {
  try {
    const response = await fetch(
      "http://AQUI_LA_IP_SERVER:8080/ais_config.json",
      {
        cache: "no-store",
      },
    );

    if (!response.ok) return;

    const config = await response.json();
    updateAISMarkers(config.ships, config.geo_corners, 3000);
  } catch (error) {
    console.warn("[AIS]", error);
  }
}, 3000); // Descarga JSON cada 3 segundos

const layerControl = L.control
  .layers(
    //Basemaps
    {
      "OpenStreetMap": osm,
      "Esri Satélite": esri,
      "Carta ENC": cartaENC,
    },
    //Overlays
    {
      "Línea de costa España": costaLayer,
      "Capitanías": capitaniasLayer,
      "Áreas de Capitanías": capitaniasAreasLayer,
      "SRR SAR Mundiales": srrSarMundialesLayer,
    },
    { collapsed: false }, // options
  )
  .addTo(map);

// Herramienta dinámica de posición del cursor en latitud/longitud.
const MousePositionControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd: function () {
    const container = L.DomUtil.create(
      "div",
      "mouse-position-control leaflet-control",
    );
    container.innerHTML = "<b>Posición cursor</b><br>Lat: -- &nbsp; Lon: --";
    L.DomEvent.disableClickPropagation(container);
    return container;
  },
});
const mousePositionControl = new MousePositionControl().addTo(map);
map.on("mousemove", function (e) {
  const lat = e.latlng.lat.toFixed(6);
  const lon = e.latlng.lng.toFixed(6);
  mousePositionControl.getContainer().innerHTML =
    "<b>Posición cursor</b><br>Lat: " + lat + " &nbsp; Lon: " + lon;
});
map.on("mouseout", function () {
  mousePositionControl.getContainer().innerHTML =
    "<b>Posición cursor</b><br>Lat: -- &nbsp; Lon: --";
});

function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        s
      ],
  );
}
function iconFor(u) {
  if (u.img)
    return L.divIcon({
      className: "",
      html: `<div class="unit-icon"><img src="${u.img}" alt="${esc(u.name)}"></div>`,
      iconSize: [52, 52],
      iconAnchor: [26, 26],
      popupAnchor: [0, -25],
    });
  const initials = esc((u.short || u.name).slice(0, 2).toUpperCase());
  return L.divIcon({
    className: "",
    html: `<div class="unit-icon no-img">${initials}</div>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
    popupAnchor: [0, -25],
  });
}
function popupFor(u, idx) {
  const rows = [
    ["Unidad", u.name],
    ["Corto", u.short],
    ["Organismo", u.organismo],
    ["Estado", u.estado],
    ["Tipo/Modelo", u.tipo],
    ["Ubicación", u.ubicacion],
    ["MMSI", u.mmsi],,
  ].filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== "");
  const isLobeira = /lobeira/i.test(String(u.name || ""));
  const controls = isLobeira
    ? `<button class="move-btn" disabled>Buque objetivo Lobeira</button>`
    : `<button class="move-btn" id="move-btn-${idx}" onclick="startMoveToLobeira(${idx})">Navegar hacia Lobeira (30 min)</button>
       <div class="popup-controls">
         <button class="move-btn speed-btn" onclick="doubleSpeed(${idx})">Velocidad x2</button>
         <button class="move-btn speed-btn" onclick="stopDoubleSpeed(${idx})">Velocidad /2</button>
         <button class="move-btn stop-btn" onclick="stopTracking(${idx})">Parar tracking</button>
         <button class="move-btn reset-btn" onclick="returnToOriginal(${idx})">Volver al origen</button>
         </div>
      <button class="move-btn" id="sar-btn-${idx}" onclick="setAreaSAR(${idx})">Asignar área SAR</button>
       <div class="eta" id="eta-${idx}"></div>`;
  return `<div class="popup">${u.img ? `<img src="${u.img}" alt="${esc(u.name)}">` : ""}<h2>${esc(u.name)}</h2><table>${rows.map((r) => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join("")}</table>${controls}</div>`;
}

function popupForDraws(layer) {
  if (!layer) return;

  const type =
    layer instanceof L.Circle
      ? "circle"
      : layer instanceof L.Rectangle
        ? "rectangle"
        : layer instanceof L.Polygon
          ? "polygon"
          : layer instanceof L.Polyline
            ? "polyline"
            : null;

  if (!type) return;

  let infoText = "";
  if (type === "polygon" || type === "rectangle") {
    const latlngs = getFlatLatLngs(layer);
    const area = L.GeometryUtil.geodesicArea(latlngs);
    infoText = `Área: ${(area / 3429904).toFixed(2)} mn²`;
  } else if (type === "circle") {
    const radius = layer.getRadius();
    const area = Math.PI * radius * radius;
    infoText = `Área: ${(area / 3429904).toFixed(2)} mn²`;
  } else if (type === "polyline") {
    const latlngs = layer.getLatLngs();
    let distance = 0;
    for (let i = 1; i < latlngs.length; i++) {
      distance += latlngs[i - 1].distanceTo(latlngs[i]);
    }
    infoText = `Distancia: ${(distance / 1852).toFixed(2)} mn`;
  }

  if (type === "polygon" || type === "rectangle" || type === "circle") {
    const assignedName =
      layer.asignado &&
      Number.isInteger(layer.unidadAsignada) &&
      units[layer.unidadAsignada]
        ? esc(
            units[layer.unidadAsignada].name ||
              units[layer.unidadAsignada].short ||
              `Unidad ${layer.unidadAsignada}`,
          )
        : "No asignada";

    layer.bindPopup(
      `<div class="popup-draw-info"><strong>${esc(infoText)}</strong><br>Unidad asignada: ${assignedName}</div>`,
    );
  } else if (type === "polyline") {
    layer.bindPopup(
      `<div class="popup-draw-info"><strong>${esc(infoText)}</strong></div>`,
    );
  }
}

const group = L.featureGroup().addTo(map);

// Capa editable para dibujos del usuario: polígonos, puntos, círculos y textos.
const drawnItems = new L.FeatureGroup().addTo(map);
layerControl.addOverlay(drawnItems, "Dibujos y anotaciones");

const drawControl = new L.Control.Draw({
  position: "topleft",
  draw: {
    polyline: true,
    rectangle: true,
    circlemarker: false,
    polygon: {
      allowIntersection: false,
      showArea: true,
      shapeOptions: { color: "#2563eb", weight: 3, fillOpacity: 0.18 },
    },
    marker: true,
    circle: {
      shapeOptions: { color: "#dc2626", weight: 3, fillOpacity: 0.12 },
    },
  },
  edit: {
    featureGroup: drawnItems,
    edit: true,
    remove: true,
  },
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (event) {
  const layer = event.layer;
  layer.sarId = ++sarId;
  layer.asignado = false;
  if (
    event.layerType === "polygon" ||
    event.layerType === "rectangle" ||
    event.layerType === "circle"
  ) {
    layer.on("click", function () {
      if (unidadPendienteSAR === null) return;

      const idx = unidadPendienteSAR;

      if (layer.asignado) {
        setPopupStatus(idx, `El área SAR ${layer.sarId} ya está asignada.`);
        return;
      }

      layer.asignado = true;
      layer.unidadAsignada = idx;

      units[idx].sarLayer = layer;
      units[idx].sarId = layer.sarId;

      layer.setStyle({
        color: "green",
        fillColor: "green",
      });

      // AQUÍ SE LANZA LA NAVEGACIÓN AUTOMÁTICAMENTE

      navigateToSAR(idx);

      unidadPendienteSAR = null;
    });
  }
  if (
    event.layerType === "polygon" ||
    event.layerType === "rectangle" ||
    event.layerType === "circle" ||
    event.layerType === "polyline"
  ) {
    layer.on("click", function () {
      popupForDraws(layer);
      layer.openPopup();
    });
    popupForDraws(layer);
  }
  if (event.layerType === "marker") {
    const label = prompt("Nombre o comentario para el punto:", "Punto");
    if (label) layer.bindPopup("<b>" + esc(label) + "</b>");
  }
  drawnItems.addLayer(layer);
});

let textMode = false;
let textButtonEl = null;

function textIcon(text) {
  return L.divIcon({
    className: "",
    html: '<div class="text-label">' + esc(text) + "</div>",
    iconAnchor: [0, 0],
  });
}

function bindTextPopup(marker) {
  marker.bindPopup(function () {
    return (
      '<div class="text-popup"><b>Texto</b><br>' +
      esc(marker.options.text || "") +
      '<br><button onclick="editTextAnnotation(' +
      L.stamp(marker) +
      ')">Editar texto</button>' +
      '<button onclick="deleteTextAnnotation(' +
      L.stamp(marker) +
      ')">Borrar</button></div>'
    );
  });
}

function findDrawnLayerByStamp(stamp) {
  let found = null;
  drawnItems.eachLayer(function (layer) {
    if (L.stamp(layer) === stamp) found = layer;
  });
  return found;
}

function editTextAnnotation(stamp) {
  const marker = findDrawnLayerByStamp(stamp);
  if (!marker) return;
  const current = marker.options.text || "";
  const updated = prompt("Editar texto:", current);
  if (updated === null) return;
  marker.options.text = updated;
  marker.setIcon(textIcon(updated));
  bindTextPopup(marker);
  marker.openPopup();
}

function deleteTextAnnotation(stamp) {
  const marker = findDrawnLayerByStamp(stamp);
  if (marker) drawnItems.removeLayer(marker);
}

window.editTextAnnotation = editTextAnnotation;
window.deleteTextAnnotation = deleteTextAnnotation;

const TextControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const btn = L.DomUtil.create("a", "", container);
    btn.href = "#";
    btn.title = "Escribir texto sobre el mapa";
    btn.innerHTML = "T";
    btn.style.fontWeight = "bold";
    btn.style.fontSize = "17px";
    btn.style.lineHeight = "30px";
    textButtonEl = btn;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(btn, "click", function (e) {
      L.DomEvent.preventDefault(e);
      textMode = !textMode;
      if (textMode) {
        btn.classList.add("text-tool-active");
        map.getContainer().style.cursor = "crosshair";
      } else {
        btn.classList.remove("text-tool-active");
        map.getContainer().style.cursor = "";
      }
    });
    return container;
  },
});
map.addControl(new TextControl());

map.on("click", function (e) {
  if (!textMode) return;
  const text = prompt("Texto a escribir sobre el mapa:", "Texto");
  if (text) {
    const marker = L.marker(e.latlng, {
      icon: textIcon(text),
      draggable: true,
      text: text,
    });
    bindTextPopup(marker);
    drawnItems.addLayer(marker);
    marker.openPopup();
  }
  textMode = false;
  if (textButtonEl) textButtonEl.classList.remove("text-tool-active");
  map.getContainer().style.cursor = "";
});
const markers = [];
const animations = {};
const tracks = {};
const speedMultipliers = {};
const originalPositions = {};
const MOVE_DURATION_MS = 30 * 60 * 1000; // 30 minutos de tiempo real a velocidad normal
const ARRIVAL_RADIUS_M = 250; // inmediaciones del Lobeira
const lobeiraIndex = units.findIndex((u) =>
  /lobeira/i.test(String(u.name || "")),
);
const lobeira = lobeiraIndex >= 0 ? units[lobeiraIndex] : null;

function destinationNearLobeira(idx) {
  // Punto determinista alrededor del Lobeira para que las unidades no se solapen al llegar.
  const angle = (idx * 137.508 * Math.PI) / 180;
  const radius = ARRIVAL_RADIUS_M * (0.35 + (idx % 7) / 10);
  const dLat = (radius * Math.cos(angle)) / 111320;
  const dLon =
    (radius * Math.sin(angle)) /
    (111320 * Math.cos(((lobeira.lat || 0) * Math.PI) / 180));
  return L.latLng(lobeira.lat + dLat, lobeira.lon + dLon);
}

function isNearLobeira(idx) {
  if (!markers[idx] || !lobeira) return false;

  const current = markers[idx].getLatLng();
  const lobeiraPos = L.latLng(lobeira.lat, lobeira.lon);

  return current.distanceTo(lobeiraPos) <= ARRIVAL_RADIUS_M;
}

function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setPopupStatus(idx, text) {
  const eta = document.getElementById(`eta-${idx}`);
  if (eta) eta.textContent = text;
}

function setMoveButton(idx, text, disabled) {
  const btn = document.getElementById(`move-btn-${idx}`);
  if (btn) {
    btn.textContent = text;
    btn.disabled = !!disabled;
  }
}

function ensureTrack(idx, from) {
  if (!tracks[idx]) {
    tracks[idx] = L.polyline([from], {
      color: "#ff7800",
      weight: 3,
      opacity: 0.85,
      dashArray: "8,6",
    }).addTo(group);
    tracks[idx].bringToBack();
  }
}

function runAnimation(idx, from, to, durationMs) {
  if (!markers[idx]) return;
  if (animations[idx]) cancelAnimationFrame(animations[idx].frame);

  const marker = markers[idx];
  const start = performance.now();
  ensureTrack(idx, from);
  setMoveButton(idx, `Navegando x${speedMultipliers[idx] || 1}...`, true);

  function step(now) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const lat = from.lat + (to.lat - from.lat) * t;
    const lng = from.lng + (to.lng - from.lng) * t;
    const pos = L.latLng(lat, lng);

    //Este fragmento es para que el svg, osea la flecha del barco, rote en la dirección de movimiento
    if (animations[idx].prevPos) {
      const heading = calculateBearing(animations[idx].prevPos, pos);
      if (marker._icon) {
        const svg = marker._icon.querySelector("svg");
        if (svg) {
          svg.style.transform = `rotate(${heading}deg)`;
        }
      }
    }
    animations[idx].prevPos = pos;

    marker.setLatLng(pos);
    if (tracks[idx]) tracks[idx].addLatLng(pos);
    setPopupStatus(
      idx,
      t < 1
        ? `Tiempo restante: ${formatRemaining(durationMs - elapsed)} | Velocidad x${speedMultipliers[idx] || 1}`
        : "Llegada a las inmediaciones del Lobeira.",
    );

    if (t < 1) {
      animations[idx].frame = requestAnimationFrame(step);
    } else {
      delete animations[idx];
      setMoveButton(idx, "Llegada completada", true);
    }
  }

  animations[idx] = {
    frame: requestAnimationFrame(step),
    from: from,
    to: to,
    start: start,
    duration: durationMs,
    prevPos: from, // ← Inicializar pos anterior
  };
}

function calculateBearing(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dlon = ((to.lng - from.lng) * Math.PI) / 180;

  const y = Math.sin(dlon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);

  let bearing = Math.atan2(y, x);
  bearing = (bearing * 180) / Math.PI;
  bearing = (bearing + 360) % 360;

  return Math.round(bearing);
}

function startMoveToLobeira(idx) {
  if (!lobeira || idx === lobeiraIndex || !markers[idx]) return;

  if (animations[idx]) cancelAnimationFrame(animations[idx].frame);
  if (tracks[idx]) group.removeLayer(tracks[idx]);
  tracks[idx] = null;

  speedMultipliers[idx] = speedMultipliers[idx] || 1;
  const from = markers[idx].getLatLng();
  const to = destinationNearLobeira(idx);
  const durationMs = MOVE_DURATION_MS / speedMultipliers[idx];
  runAnimation(idx, from, to, durationMs);
}

/*function updateAISMarkers(ships, corners) {
  Object.entries(ships).forEach(([shipId, ship]) => {
    if (!ship.lat || !ship.lon) return;

    const latLng = L.latLng(ship.lat, ship.lon);

    const marker = L.marker(latLng, {
      icon: createAISIcon(ship.cog || 0, getAISColor(ship.ship_type)),
      title: ship.name || shipId,
    })
      .bindPopup(() => popupFor(ship, idx))(
        `
      <div>
        <b>${ship.name}</b><br>
        MMSI: ${ship.mmsi}<br>
        Tipo: ${ship.ship_type}<br>
        COG: ${ship.cog}°<br>
        ${ship.lat.toFixed(6)}, ${ship.lon.toFixed(6)}
      </div>
    `,
      )
      .addTo(map);
  });
}*/

// Función que renderiza los barcos del AIS XVR
function updateAISMarkers(ships, corners, animationDuration = 3000) {
  if (!ships || typeof ships !== "object") return;

  const currentShipIds = new Set(Object.keys(ships));
  const trackedShipIds = new Set(Object.keys(aisShipsData));

  // ┌─ ELIMINAR markers de barcos que ya no existen
  trackedShipIds.forEach((shipId) => {
    if (!currentShipIds.has(shipId)) {
      // Cancelar animación si está corriendo
      if (aisAnimations[shipId]) {
        cancelAnimationFrame(aisAnimations[shipId].frame);
        delete aisAnimations[shipId];
      }

      // Eliminar marker del mapa
      if (aisShipsData[shipId] && aisShipsData[shipId].marker) {
        const marker = aisShipsData[shipId].marker;
        if (marker && map) {
          map.removeLayer(marker);
        }
      }

      delete aisShipsData[shipId];
    }
  });

  // ┌─ ACTUALIZAR o CREAR markers
  Object.entries(ships).forEach(([shipId, ship]) => {
    if (!ship.lat || !ship.lon) return;

    const newLatLng = L.latLng(ship.lat, ship.lon);
    const color = getAISColor(ship.ship_type || "");

    // ┌─ Si marker ya existe
    if (aisShipsData[shipId]) {
      const oldData = aisShipsData[shipId];
      const oldLatLng = oldData.latLng;

      // Guardar datos antes de animar
      aisShipsData[shipId] = {
        ...oldData,
        latLng: newLatLng,
        color: color,
        ship: ship,
      };

      // Cancelar animación anterior si existe
      if (aisAnimations[shipId]) {
        cancelAnimationFrame(aisAnimations[shipId].frame);
      }

      // Iniciar nueva animación
      animateMarkerMovement(
        shipId,
        oldData.marker,
        oldLatLng,
        newLatLng,
        color,
        animationDuration,
      );
    } else {
      // ┌─ Crear marker nuevo (sin animación, es la primera vez)
      const marker = L.marker(newLatLng, {
        icon: createAISIcon(0, color),
        title: ship.name || shipId,
      })
        .bindPopup(() => popupFor(ship, shipId))(
          `
        <div style="font-family: monospace; font-size: 12px;">
          <b>${ship.name || shipId}</b><br>
          <table style="font-size: 11px;">
            <tr><td>MMSI:</td><td>${ship.mmsi || "?"}</td></tr>
            <tr><td>Tipo:</td><td>${ship.ship_type || "Unknown"}</td></tr>
            <tr><td>Posición:</td><td>${ship.lat.toFixed(6)}, ${ship.lon.toFixed(6)}</td></tr>
          </table>
        </div>
      `,
        )
        .addTo(map);

      // Almacenar
      aisShipsData[shipId] = {
        marker: marker,
        latLng: newLatLng,
        color: color,
        ship: ship,
      };
    }
  });
}

function createAISIcon(heading, color) {
  heading = heading || 0;
  color = color || "#808080";

  return L.divIcon({
    className: "",
    html: `
      <svg width="32" height="32" viewBox="0 0 24 24"
        style="transform: rotate(${heading}deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <path d="M12 1 L21 23 L12 18 L3 23 Z"
          fill="${color}" stroke="#000" stroke-width="1" />
      </svg>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

function getAISColor(tipo) {
  tipo = (tipo || "").toUpperCase();

  if (tipo.includes("SALVAMAR")) return "#ff6600";
  if (tipo.includes("BUQUE_POLIVALENTE")) return "#F5DD27";
  if (tipo.includes("HELICÓPTERO")) return "#00aa00";
  if (tipo.includes("REMOLCADOR")) return "#07fff3";
  if (tipo.includes("BUQUE")) return "#8000ff";
  if (tipo.includes("PESQUERO")) return "#8000ff";
  if (tipo.includes("CARGO")) return "#80f180";
  if (tipo.includes("TANKER")) return "#ff0000";
  if (tipo.includes("PASSENGER")) return "#004ad3";

  return "#808080";
}

function getLayerForType(tipo) {
  tipo = (tipo || "").toUpperCase();

  if (tipo.includes("SALVAMAR")) return vesselLayers.salvamar;
  if (tipo.includes("BUQUE_POLIVALENTE")) return vesselLayers.Buque_Polivalente;
  if (tipo.includes("HELICÓPTERO")) return vesselLayers.helicoptero;
  if (tipo.includes("REMOLCADOR")) return vesselLayers.remolcador;
  if (tipo.includes("PESQUERO")) return vesselLayers.pesquero;
  if (tipo.includes("CARGO")) return vesselLayers.cargo;
  if (tipo.includes("TANKER")) return vesselLayers.tanker;
  if (tipo.includes("PASSENGER")) return vesselLayers.passenger;

  return vesselLayers.otros;
}

function animateMarkerMovement(
  shipId,
  marker,
  fromLatLng,
  toLatLng,
  color,
  duration,
) {
  const startTime = performance.now();
  let animationFrame = null;

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Interpolar posición
    const lat = fromLatLng.lat + (toLatLng.lat - fromLatLng.lat) * progress;
    const lng = fromLatLng.lng + (toLatLng.lng - fromLatLng.lng) * progress;
    const currentLatLng = L.latLng(lat, lng);

    // Calcular bearing entre posición anterior y actual
    const heading = calculateBearing(fromLatLng, currentLatLng);

    // Actualizar marker
    marker.setLatLng(currentLatLng);
    marker.setIcon(createAISIcon(heading, color));

    // Actualizar popup con info actual
    const ship = aisShipsData[shipId].ship;
    marker.setPopupContent(
      `
      <div style="font-family: monospace; font-size: 12px;">
        <b>${ship.name || shipId}</b><br>
        <table style="font-size: 11px;">
          <tr><td>MMSI:</td><td>${ship.mmsi || "?"}</td></tr>
          <tr><td>Tipo:</td><td>${ship.ship_type || "Unknown"}</td></tr>
          <tr><td>Rumbo:</td><td>${heading}°</td></tr>
          <tr><td>Posición:</td><td>${lat.toFixed(6)}, ${lng.toFixed(6)}</td></tr>
        </table>
      </div>
    `,
    );

    // Continuar animación si no ha terminado
    if (progress < 1) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      // Animación terminada
      delete aisAnimations[shipId];
    }
  }

  animationFrame = requestAnimationFrame(animate);

  // Guardar referencia a la animación para cancelarla si es necesario
  aisAnimations[shipId] = {
    frame: animationFrame,
    startTime: startTime,
  };
}

/**
 * Limpia todos los markers AIS
 */
function clearAISMarkers() {
  // Cancelar todas las animaciones
  Object.entries(aisAnimations).forEach(([shipId, anim]) => {
    cancelAnimationFrame(anim.frame);
  });

  // Eliminar markers del mapa
  Object.entries(aisShipsData).forEach(([shipId, data]) => {
    if (data.marker && map) {
      map.removeLayer(data.marker);
    }
  });

  aisAnimations = {};
  aisShipsData = {};
}

function navigateToSAR(idx) {
  const sarLayer = units[idx].sarLayer;

  if (!sarLayer) {
    setPopupStatus(idx, "No tiene área SAR asignada.");
    return;
  }
  if (animations[idx]) cancelAnimationFrame(animations[idx].frame);
  if (tracks[idx]) group.removeLayer(tracks[idx]);
  tracks[idx] = null;

  const from = markers[idx].getLatLng();
  const to = sarLayer.getBounds().getCenter();
  const durationMs = MOVE_DURATION_MS / (speedMultipliers[idx] || 1);
  runAnimation(idx, from, to, durationMs);
  setPopupStatus(idx, `Navegando hacia el Área SAR ${units[idx].sarId}.`);
}

function setAreaSAR(idx) {
  if (!lobeira || idx === lobeiraIndex || !markers[idx]) return;

  unidadPendienteSAR = idx;

  setPopupStatus(idx, "Seleccione un polígono SAR haciendo clic sobre él.");
}

function doubleSpeed(idx) {
  if (!markers[idx] || idx === lobeiraIndex) return;
  speedMultipliers[idx] = (speedMultipliers[idx] || 1) * 2;

  if (animations[idx]) {
    const marker = markers[idx];
    const current = marker.getLatLng();
    const remainingRatio =
      1 -
      Math.min(
        1,
        (performance.now() - animations[idx].start) / animations[idx].duration,
      );
    const remainingMs = Math.max(
      1000,
      (animations[idx].duration * remainingRatio) / 2,
    );
    const to = animations[idx].to || destinationNearLobeira(idx);
    runAnimation(idx, current, to, remainingMs);
  } else {
    setPopupStatus(
      idx,
      `Velocidad preparada: x${speedMultipliers[idx]}. Al iniciar, el tiempo será ${formatRemaining(MOVE_DURATION_MS / speedMultipliers[idx])}.`,
    );
  }
}

function stopDoubleSpeed(idx) {
  if (!markers[idx] || idx === lobeiraIndex) return;
  speedMultipliers[idx] = (speedMultipliers[idx] || 1) / 2;
  if (animations[idx]) {
    const marker = markers[idx];
    const current = marker.getLatLng();
    const remainingRatio =
      1 -
      Math.min(
        1,
        (performance.now() - animations[idx].start) / animations[idx].duration,
      );
    const remainingMs = Math.max(
      1000,
      animations[idx].duration * remainingRatio * 2,
    );
    const to = animations[idx].to || destinationNearLobeira(idx);
    runAnimation(idx, current, to, remainingMs);
  } else {
    setPopupStatus(
      idx,
      `Velocidad preparada: x${speedMultipliers[idx]}. Al iniciar, el tiempo será ${formatRemaining(MOVE_DURATION_MS)}.`,
    );
  }
}

function stopTracking(idx) {
  if (animations[idx]) {
    cancelAnimationFrame(animations[idx].frame);
    delete animations[idx];
  }
  setMoveButton(idx, "Reanudar hacia Lobeira", false);
  setPopupStatus(
    idx,
    "Tracking dinámico detenido. La traza queda visible hasta reanudar o volver al origen.",
  );
}

function returnToOriginal(idx) {
  if (!markers[idx] || !originalPositions[idx]) return;
  if (animations[idx]) {
    cancelAnimationFrame(animations[idx].frame);
    delete animations[idx];
  }
  markers[idx].setLatLng(originalPositions[idx]);
  if (tracks[idx]) {
    group.removeLayer(tracks[idx]);
    tracks[idx] = null;
  }
  speedMultipliers[idx] = 1;
  setMoveButton(idx, "Navegar hacia Lobeira (30 min)", false);
  setPopupStatus(idx, "Unidad devuelta a la posición original de la capa.");
}

function getPolygonCenter(layer) {
  return layer.getBounds().getCenter();
}

function getFlatLatLngs(layer) {
  var latlngs = layer.getLatLngs();
  while (latlngs && !L.LineUtil.isFlat(latlngs)) {
    latlngs = latlngs[0];
  }
  return latlngs || [];
}

//Esta función es para que salga el área de los polígonos y círculos al editarlos
map.on("draw:edited", function (e) {
  var layers = e.layers;
  layers.eachLayer(function (layer) {
    var type =
      layer instanceof L.Circle
        ? "circle"
        : layer instanceof L.Rectangle
          ? "rectangle"
          : layer instanceof L.Polygon
            ? "polygon"
            : layer instanceof L.Polyline
              ? "polyline"
              : null;

    if (type === "polygon") {
      var latlngs = getFlatLatLngs(layer);
      var area = L.GeometryUtil.geodesicArea(latlngs);
      var areaMillasNauticas = (area / 3429904).toFixed(2);
      layer.bindPopup("Área: " + areaMillasNauticas + " mn²").openPopup();
    } else if (type === "polyline") {
      var latlngs = layer.getLatLngs();
      var distance = 0;
      for (var i = 1; i < latlngs.length; i++) {
        distance += latlngs[i - 1].distanceTo(latlngs[i]);
      }
      var distanceMillasNauticas = (distance / 1852).toFixed(2);
      layer
        .bindPopup("Distancia: " + distanceMillasNauticas + " mn")
        .openPopup();
    } else if (type === "circle") {
      var radius = layer.getRadius();
      var area = Math.PI * radius * radius;
      var areaMillasNauticas = (area / 3429904).toFixed(2);
      layer.bindPopup("Área: " + areaMillasNauticas + " mn²").openPopup();
    } else if (type === "rectangle") {
      var bounds = layer.getBounds();
      var area =
        bounds.getNorthEast().distanceTo(bounds.getSouthWest()) *
        bounds.getNorthWest().distanceTo(bounds.getSouthEast());
      var areaMillasNauticas = (area / 3429904).toFixed(2);
      layer.bindPopup("Área: " + areaMillasNauticas + " mn²").openPopup();
    }
  });
});

window.setAreaSAR = setAreaSAR;
window.startMoveToLobeira = startMoveToLobeira;
window.doubleSpeed = doubleSpeed;
window.stopTracking = stopTracking;
window.returnToOriginal = returnToOriginal;
window.stopDoubleSpeed = stopDoubleSpeed;
units.forEach((u, idx) => {
  if (typeof u.lat === "number" && typeof u.lon === "number") {
    const marker = L.marker([u.lat, u.lon], {
      icon: createAISIcon(u.cog || 0, getAISColor(u.tipo)), //Anteriormente iconFor(u) pero ahora usamos createAISIcon para flechas AIS
      title: u.name,
    }).bindPopup(() => popupFor(u, idx));
    const layer = getLayerForType(u.tipo);

    marker.addTo(layer);
    markers[idx] = marker;
    originalPositions[idx] = L.latLng(u.lat, u.lon);
    speedMultipliers[idx] = 1;
    marker.addTo(group);
  }
});

map.fitBounds(group.getBounds().pad(0.18));
L.control.scale({ imperial: false }).addTo(map);

//Filtro de capas de barcos por tipo
document.querySelectorAll("#vessel-filter-panel input").forEach((cb) => {
  cb.addEventListener("change", function () {
    const layer = vesselLayers[this.dataset.layer];

    if (this.checked) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  });
});

//Añadir el botón de filtro de barcos como un botón del menu leaflet
const FilterControl = L.Control.extend({
  options: {
    position: "topleft",
  },

  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar");
    const panel = document.getElementById("vessel-filter-panel");
    panel.classList.add("hidden");
    container.innerHTML = `
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path
      d="M12 1 L21 23 L12 18 L3 23 Z"
      fill="#ff0080"
      stroke="#000"
      stroke-width="1"
    />
  </svg>
`;

    container.style.background = "#ffffff";
    container.style.width = "30px";
    container.style.height = "30px";
    container.style.lineHeight = "30px";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.cursor = "pointer";

    L.DomEvent.on(container, "click", () => {
      panel.classList.toggle("hidden");
    });

    return container;
  },
});

map.addControl(new FilterControl());
