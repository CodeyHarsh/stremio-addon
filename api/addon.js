const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const fetch = require("node-fetch");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const manifest = {
    id: "community.vidking.private",
    version: "1.0.4",
    name: "VidKing Private (Secure)",
    description: "Private Vercel Deployment",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

async function getStreamDetails(embedUrl) {
    console.log("🕵️ Analyzing:", embedUrl);
    let browser = null;
    
    try {
        // Setup Chromium for Vercel
        chromium.setGraphicsMode = false;
        
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        let videoUrl = null;

        // Sniff for m3u8 or mp4
        await page.setRequestInterception(true);
        page.on('request', req => {
            const rType = req.resourceType();
            if (['image', 'stylesheet', 'font'].includes(rType)) {
                req.abort();
            } else {
                const url = req.url();
                if ((url.includes('.m3u8') || url.includes('.mp4')) && !videoUrl) {
                    console.log("✅ Found:", url);
                    videoUrl = url;
                }
                req.continue();
            }
        });

        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        
        const startTime = Date.now();
        while (!videoUrl && Date.now() - startTime < 5000) {
            await new Promise(r => setTimeout(r, 500));
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
    // SECURITY: Get Key from Vercel Settings (Hidden from public)
    const API_KEY = process.env.TMDB_API_KEY; 
    
    if (!API_KEY) {
        console.log("❌ Error: TMDB_API_KEY is missing in Vercel Settings!");
        return { streams: [] };
    }

    const imdbId = args.id.split(":")[0];
    
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${API_KEY}&external_source=imdb_id`;
        const data = await (await fetch(findUrl)).json();
        
        let tmdbId = "";
        if (args.type === "movie" && data.movie_results?.[0]) tmdbId = data.movie_results[0].id;
        else if (args.type === "series" && data.tv_results?.[0]) tmdbId = data.tv_results[0].id;

        if (!tmdbId) return { streams: [] };

        const embedUrl = args.type === "movie" 
            ? `https://www.vidking.net/embed/movie/${tmdbId}`
            : `https://www.vidking.net/embed/tv/${tmdbId}/${args.id.split(":")[1]}/${args.id.split(":")[2]}`;

        const streamUrl = await getStreamDetails(embedUrl);

        if (!streamUrl) return { streams: [] };

        return {
            streams: [{
                title: "▶️ Play VidKing (Secure)",
                url: streamUrl,
                behaviorHints: {
                    notWebReady: true,
                    proxyHeaders: {
                        request: {
                            "Referer": "https://www.vidking.net/",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
                        }
                    }
                }
            }]
        };

    } catch (e) {
        return { streams: [] };
    }
});

// Vercel Handler
const router = getRouter(builder.getInterface());

module.exports = (req, res) => {
    if (req.url === '/') {
        res.redirect('/manifest.json');
        return;
    }
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};
