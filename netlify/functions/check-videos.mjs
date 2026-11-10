// Función programada: una vez al día compara los vídeos de Drive con los
// publicados en la web. Solo si hay cambios lanza un nuevo deploy
// (cada deploy gasta créditos de Netlify, así que no se hace si no hace falta).
//
// Necesita la variable BUILD_HOOK_URL (Netlify > Site configuration >
// Build & deploy > Build hooks).

export default async () => {
  const { GOOGLE_API_KEY, VIDEOS_FOLDER_ID, BUILD_HOOK_URL } = process.env;
  const SITE_URL = process.env.URL || "https://farmatv.netlify.app";

  if (!GOOGLE_API_KEY || !VIDEOS_FOLDER_ID || !BUILD_HOOK_URL) {
    console.error("Faltan GOOGLE_API_KEY, VIDEOS_FOLDER_ID o BUILD_HOOK_URL");
    return;
  }

  // Vídeos en Drive (solo la lista, no se descarga nada)
  const params = new URLSearchParams({
    q: `'${VIDEOS_FOLDER_ID}' in parents and trashed = false and mimeType = 'video/mp4'`,
    fields: "files(id)",
    pageSize: "100",
    key: GOOGLE_API_KEY
  });
  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!driveRes.ok) {
    console.error("Error consultando Drive:", driveRes.status, await driveRes.text());
    return;
  }
  const driveIds = ((await driveRes.json()).files || []).map(f => f.id).sort();

  // Vídeos publicados actualmente en la web
  let siteIds = [];
  try {
    const siteRes = await fetch(`${SITE_URL}/videos/list.json`);
    if (siteRes.ok) siteIds = ((await siteRes.json()).files || []).map(f => f.id).sort();
  } catch (error) {
    console.warn("No se pudo leer list.json publicado:", error);
  }

  if (JSON.stringify(driveIds) === JSON.stringify(siteIds)) {
    console.log("Sin cambios en los vídeos, no se hace deploy");
    return;
  }

  console.log("Cambios detectados en Drive, lanzando deploy...");
  const hook = await fetch(BUILD_HOOK_URL, { method: "POST" });
  console.log("Build hook:", hook.status);
};

// Todos los días a las 05:00 UTC (antes de abrir la farmacia)
export const config = { schedule: "0 5 * * *" };
