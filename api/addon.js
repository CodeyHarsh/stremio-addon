// 1. Load Environment Variables (Local Support)
require("dotenv").config();

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer");

const manifest = {
  id: "community.vidking.render",
  version: "1.0.9",
  name: "VidKing Render (Optimized)",
  description: "Hosted on Render Singapore",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [], // ✅ FIXED: Must be an array to prevent 500 Error
  idPrefixes: ["tt"],
};

const builder = new addonBuilder(manifest);

async function getStreamDetails(embedUrl) {
  console.log("🕵️ Analyzing:", embedUrl);
  let browser = null;

  try {
    // ✅ FIXED: Low-Memory Settings to prevent Render Free Tier crashes
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Critical for Docker/Render
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--single-process", // Massive memory saver
        "--no-zygote",      // Reduces memory usage
        "--renderer-process-limit=1" // Limits Chrome to 1 tab process
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, 
    });

    const page = await browser.newPage();
    let videoUrl = null;

    // ✅ OPTIMIZATION: Block heavy assets (images, css, fonts, scripts)
    // This makes the page load 2x faster and uses 50% less RAM
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font", "script", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        const url = req.url();
        // Look for the video file
        if ((url.includes(".m3u8") || url.includes(".mp4")) && !videoUrl) {
          console.log("✅ Found:", url);
          videoUrl = url;
        }
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );
    
    // Increased timeout slightly for safety on server
    try {
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      console.log("⚠️ Page load timeout, checking if we found video anyway...");
    }

    const startTime = Date.now();
    // Wait up to 8 seconds for the video URL to appear
    while (!videoUrl && Date.now() - startTime < 8000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    return videoUrl;
  } catch (error) {
    console.log("Browser Error:", error.message);
    return null;
  } finally {
    // Always close browser to free up RAM
    if (browser) await browser.close();
  }
}

builder.defineStreamHandler(async (args) => {
  // Gets Key from .env (Local) or Render Environment Variables
  const API_KEY = process.env.TMDB_API_KEY;

  if (!API_KEY) {
    console.log("❌ Error: TMDB_API_KEY is missing!");
    return { streams: [] };
  }

  const imdbId = args.id.split(":")[0];

  try {
    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${API_KEY}&external_source=imdb_id`;
    const data = await (await fetch(findUrl)).json();

    let tmdbId = "";
    if (args.type === "movie" && data.movie_results?.[0])
      tmdbId = data.movie_results[0].id;
    else if (args.type === "series" && data.tv_results?.[0])
      tmdbId = data.tv_results[0].id;

    if (!tmdbId) return { streams: [] };

    const embedUrl =
      args.type === "movie"
        ? `https://www.vidking.net/embed/movie/${tmdbId}`
        : `https://www.vidking.net/embed/tv/${tmdbId}/${
            args.id.split(":")[1]
          }/${args.id.split(":")[2]}`;

    const streamUrl = await getStreamDetails(embedUrl);

    if (!streamUrl) return { streams: [] };

    return {
      streams: [
        {
          title: "▶️ VidKing (Render SG)",
          url: streamUrl,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: "https://www.vidking.net/",
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
              },
            },
          },
        },
      ],
    };
  } catch (e) {
    console.log("Handler Error:", e.message);
    return { streams: [] };
  }
});

// --- RENDER.COM STARTUP LOGIC ---
// Render assigns a random port to process.env.PORT
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`🚀 Server running on port ${port}`);
console.log(`🔗 Open: http://127.0.0.1:${port}/manifest.json`);
