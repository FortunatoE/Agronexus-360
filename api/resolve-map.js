import { currentUser } from "./_core.js";

function allowedGoogleHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "maps.app.goo.gl" ||
    host === "goo.gl" ||
    host.endsWith(".goo.gl") ||
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "google.com.br" ||
    host.endsWith(".google.com.br")
  );
}

function googleUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!allowedGoogleHost(url.hostname)) {
    throw new Error("Use um link do Google Maps para resolver o endereço.");
  }
  return url;
}

function decimalCoordinate(value) {
  const coordinate = Number(String(value || "").replace(",", "."));
  return Number.isFinite(coordinate) ? coordinate : null;
}

function coordinatesFrom(value) {
  const decoded = decodeURIComponent(String(value || ""));
  const patterns = [
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /(?:[?&](?:q|query|ll|destination|origin)=)(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = decimalCoordinate(match[1]);
    const longitude = decimalCoordinate(match[2]);
    if (
      latitude !== null &&
      longitude !== null &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }
  return null;
}

function placeFrom(url) {
  const query =
    url.searchParams.get("query") ||
    url.searchParams.get("q") ||
    url.searchParams.get("destination") ||
    "";
  if (query.trim()) return query.trim();
  const match = url.pathname.match(/\/maps\/(?:place|search)\/([^/?]+)/i);
  if (!match) return "";
  return decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
}

async function followGoogleMapsLink(value) {
  let url = googleUrl(value);
  let pageText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AgroNexus-360 Route Resolver/1.0",
      },
      redirect: "manual",
    });
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      url = googleUrl(new URL(location, url).toString());
      continue;
    }
    if (response.ok) {
      pageText = (await response.text()).slice(0, 300_000);
    }
    break;
  }
  return { pageText, url };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }
  try {
    const user = await currentUser(request);
    if (!user) {
      return response.status(401).json({ error: "Sessão expirada. Entre novamente." });
    }
    const sourceUrl = String(request.body?.url || "").trim();
    if (!sourceUrl) {
      return response.status(400).json({ error: "Informe o link do Google Maps." });
    }
    const { pageText, url } = await followGoogleMapsLink(sourceUrl);
    const coordinates = coordinatesFrom(`${url.toString()}\n${pageText}`);
    const place = placeFrom(url);
    if (!coordinates && !place) {
      return response.status(422).json({
        error: "O link foi aberto, mas não expôs coordenadas nem um endereço que possa ser usado na rota.",
      });
    }
    const query = coordinates
      ? `${coordinates.latitude.toFixed(6)},${coordinates.longitude.toFixed(6)}`
      : place;
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      coordinates,
      query,
      resolvedUrl: url.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível resolver o link do Google Maps.";
    return response.status(400).json({ error: message });
  }
}
