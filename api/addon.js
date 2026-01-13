require("dotenv").config();
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer");

const manifest = {
  id: "community.vidking.render",
  version: "1.1.7", // Bumped version
  name: "VidKing Render (Click & Wait)",
  description: "Hosted on Render Singapore",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
};

const builder = new addonBuilder(manifest);

async function getStreamDetails(embedUrl) {
  console.log("🕵️ Analyzing:", embedUrl);
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--mute-audio",
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    });

    const page = await browser.newPage();
    let videoUrl = null;

    // ✅ SMART BLOCKING
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const rType = req.resourceType();
      const rUrl = req.url();

      // 1. Did we find the video file?
      if (rUrl.includes(".m3u8") || (rUrl.includes(".mp4") && !rUrl.includes("loader"))) {
        console.log("✅ Found stream:", rUrl);
        videoUrl = rUrl;
        req.abort(); // Stop loading immediately
        return;
      }

      // 2. BLOCK Visuals (Saves RAM)
      if (["image", "stylesheet", "font", "media"].includes(rType)) {
        req.abort();
      } 
      // 3. ALLOW Logic
      else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
    );

    // Load the page
    try {
      // Reduced timeout to fail faster if site is down
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch (e) {
      // Proceed even if timeout happens; elements might be there
    }

    // --- 🟢 NEW LOGIC: CLICK & WAIT ---
    
    // 1. Wait a tiny bit for iframes to populate
    await new Promise((r) => setTimeout(r, 1000));

    // 2. Loop through all frames (Main page + IFrames) to find the Play Button
    console.log("point👉 Attempting to click Play...");
    
    const frames = page.frames();
    for (const frame of frames) {
      try {
        await frame.evaluate(() => {
          // Common selectors for video players (VideoJS, JWPlayer, HTML5)
          const selectors = [
            ".vjs-big-play-button", 
            ".jw-display-icon-container", 
            ".play-button", 
            ".start-button",
            "button[aria-label='Play']",
            "video"
          ];
          
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              // Force a click event
              el.click();
              console.log("Clicked:", sel);
              return; // Stop after first click in this frame
            }
          }
        });
      } catch (e) {
        // Ignore cross-origin frame errors
      }
    }

    // 3. YOUR REQUEST: Let it play/load for 3 seconds
    console.log("⏳ Waiting 3s for network request...");
    await new Promise((r) => setTimeout(r, 3000));
    
    // --- 🔴 END NEW LOGIC ---

    // Final check loop (in case it took longer than 3s)
    const startTime = Date.now();
    while (!videoUrl && Date.now() - startTime < 5000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    return videoUrl;

  } catch (error) {
    console.log("Browser Error:", error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

builder.defineStreamHandler(async (args) => {
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
      // Note: Make sure this URL structure is correct for VidKing
        ? `https://www.vidking.net/embed/movie/${tmdbId}`
        : `https://www.vidking.net/embed/tv/${tmdbId}/${
            args.id.split(":")[1]
          }/${args.id.split(":")[2]}`;

    const streamUrl = await getStreamDetails(embedUrl);

    if (!streamUrl) {
        console.log("❌ No stream found for:", embedUrl);
        return { streams: [] };
    }

    return {
      streams: [
        {
          title: "▶️ VidKing (Render)",
          url: streamUrl,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                Referer: "https://www.vidking.net/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
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

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`🚀 Server running on port ${port}`);
