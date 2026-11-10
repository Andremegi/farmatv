
export default async (req) => {
  if (req.method !== "GET") {
    return Response.json(
      { error: "Método no permitido" },
      { status: 405 }
    );
  }

  try {
    // Variables privadas de Netlify
    const API_KEY = process.env.GOOGLE_API_KEY;

    const FOLDERS = {
      videos: {
        id: process.env.VIDEOS_FOLDER_ID,
        mime: "mimeType = 'video/mp4'"
      },
      news: {
        id: process.env.NEWS_FOLDER_ID,
        mime: "mimeType contains 'image/'"
      },
      promos: {
        id: process.env.PROMO_FOLDER_ID,
        mime: "mimeType contains 'image/'"
      },
      // Pausa entre vídeos: logo (imagen) + archivo de frases opcional
      // (Google Doc o .txt, una frase por línea)
      pause: {
        id: process.env.PAUSE_FOLDER_ID,
        mime: "mimeType contains 'image/' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'text/plain'"
      }
    };
    console.log("Carpetas configuradas:", {
  videos: Boolean(process.env.VIDEOS_FOLDER_ID),
  news: Boolean(process.env.NEWS_FOLDER_ID),
  promos: Boolean(process.env.PROMO_FOLDER_ID)
});
    // Identificar qué carpeta solicita la web
    const url = new URL(req.url);
    const type = url.searchParams.get("folder");
    const folder = FOLDERS[type];

    if (!folder || !folder.id) {
      return Response.json(
        { error: "Carpeta no válida o no configurada" },
        { status: 400 }
      );
    }

    if (!API_KEY) {
      return Response.json(
        { error: "API Key no configurada en Netlify" },
        { status: 500 }
      );
    }

    // Consultar Google Drive
    const query = `'${folder.id}' in parents and trashed = false and (${folder.mime})`;

    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,thumbnailLink)",
      pageSize: "100",
      orderBy: "name"
    });

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      {
        headers: {
          "X-Goog-Api-Key": API_KEY
        }
      }
    );

    if (!response.ok) {
      const errorDetails = await response.text();

      console.error(
        "Google Drive error:",
        response.status,
        errorDetails
      );

      return Response.json(
        { error: "Error consultando Google Drive" },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (type === "pause") {
      return Response.json(
        await buildPause(data.files || [], API_KEY),
        { headers: { "Cache-Control": "public, max-age=60" } }
      );
    }

    // URL de streaming directo (soporta Range requests, sin página de antivirus).
    // Se puede usar una clave aparte, restringida por dominio, para el navegador.
    const MEDIA_KEY = process.env.GOOGLE_MEDIA_KEY || API_KEY;
    const files = (data.files || []).map(f => ({
      ...f,
      src: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${MEDIA_KEY}`
    }));

    return Response.json(
      { files },
      {
        headers: {
          "Cache-Control": "public, max-age=60"
        }
      }
    );

  } catch (error) {
    console.error("Drive function error:", error);

    return Response.json(
      { error: "Error interno consultando Drive" },
      { status: 500 }
    );
  }
};


// Devuelve { logo: {id,name} | null, phrases: [..] } para la pausa entre vídeos
async function buildPause(files, apiKey) {
  const logo = files.find(f => f.mimeType.startsWith("image/")) || null;
  const textFile = files.find(f =>
    f.mimeType === "application/vnd.google-apps.document" || f.mimeType === "text/plain"
  );

  let phrases = [];
  if (textFile) {
    const base = `https://www.googleapis.com/drive/v3/files/${textFile.id}`;
    const url = textFile.mimeType === "text/plain"
      ? `${base}?alt=media`
      : `${base}/export?mimeType=text/plain`;
    const res = await fetch(url, { headers: { "X-Goog-Api-Key": apiKey } });
    if (res.ok) {
      phrases = (await res.text())
        .replace(/^\uFEFF/, "")          // marca BOM que añade Google Docs
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    } else {
      console.error("No se pudo leer el archivo de frases:", res.status, await res.text());
    }
  }

  return {
    logo: logo && { id: logo.id, name: logo.name },
    phrases
  };
}
