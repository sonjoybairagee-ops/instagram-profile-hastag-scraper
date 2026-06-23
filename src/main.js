import { Actor, log } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { extractSearchResults, extractBusinessData, extractReviews } from './extractor.js';

await Actor.init();

const input = await Actor.getInput();
const {
    searchQueries = [],
    directUrls = [],
    maxResultsPerQuery = 20,
    scrapeReviews = true,
    maxReviewsPerBusiness = 10,
    language = 'en',
    proxyConfiguration: proxyConfig,
} = input || {};

if (!searchQueries.length && !directUrls.length) {
    throw new Error('No input! Please provide searchQueries or directUrls.');
}

log.info('Starting Google Maps Business Scraper...', {
    searchQueries: searchQueries.length,
    directUrls: directUrls.length,
    maxResultsPerQuery,
});

const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
const requestQueue = await RequestQueue.open();

// Add search queries
for (const query of searchQueries) {
    const encoded = encodeURIComponent(query.trim());
    await requestQueue.addRequest({
        url: `https://www.google.com/maps/search/${encoded}/?hl=${language}`,
        userData: { type: 'SEARCH', query: query.trim() },
    });
}

// Add direct URLs
for (const url of directUrls) {
    await requestQueue.addRequest({
        url: url.trim(),
        userData: { type: 'BUSINESS', sourceLabel: `direct:${url}` },
    });
}

const crawler = new PlaywrightCrawler({
    requestQueue,
    proxyConfiguration,
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--lang=en-US',
            ],
        },
    },
    browserPoolOptions: {
        useFingerprints: true,
    },
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 180,
    maxRequestRetries: 3,

    async requestHandler({ page, request }) {
        const { type, query } = request.userData;

        // Block heavy resources
        await page.route('**/*.{mp4,mp3,woff,woff2,ttf}', (route) => route.abort());

        // Accept cookies if prompted
        try {
            await page.click('button[aria-label*="Accept"], button[id*="accept"], #L2AGLb', { timeout: 5000 });
            await page.waitForTimeout(1000);
        } catch {}

        // ── SEARCH page ──
        if (type === 'SEARCH') {
            log.info(`[SEARCH] "${query}" → ${request.url}`);

            try {
                await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                log.warning(`Navigation issue: ${e.message}`);
            }

            // Wait for results
            await page.waitForSelector(
                'a[href*="/maps/place/"], [role="feed"]',
                { timeout: 20000 }
            ).catch(() => log.warning('Results selector not found'));

            await page.waitForTimeout(2000);

            const businessUrls = await extractSearchResults(page, maxResultsPerQuery);
            log.info(`[SEARCH] "${query}" → ${businessUrls.length} businesses found`);

            for (const url of businessUrls) {
                await requestQueue.addRequest({
                    url,
                    userData: {
                        type: 'BUSINESS',
                        sourceLabel: `search:${query}`,
                    },
                    uniqueKey: url.split('?')[0],
                });
            }
            return;
        }

        // ── BUSINESS page ──
        if (type === 'BUSINESS') {
            log.info(`[BUSINESS] Processing: ${request.url}`);

            try {
                await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (e) {
                log.warning(`Navigation issue: ${e.message}`);
            }

            await page.waitForTimeout(2500);

            const business = await extractBusinessData(page, request.url);

            if (!business.name) {
                log.warning(`No business name found at ${request.url}`);
                return;
            }

            log.info(`✅ ${business.name} | ⭐ ${business.rating} | 📞 ${business.phone || 'N/A'} | 🌐 ${business.website || 'N/A'}`);

            // Scrape reviews
            let reviews = [];
            if (scrapeReviews && business.reviewCount > 0) {
                try {
                    reviews = await extractReviews(page, maxReviewsPerBusiness);
                    log.info(`   Reviews: ${reviews.length}`);
                } catch (e) {
                    log.warning(`Reviews failed: ${e.message}`);
                }
            }

            await Actor.pushData({
                ...business,
                reviews,
                sourceLabel: request.userData.sourceLabel,
            });
        }
    },

    failedRequestHandler({ request, error }) {
        log.error(`Failed: ${request.url} — ${error.message}`);
    },
});

await crawler.run();

const dataset = await Actor.openDataset();
const { itemCount } = await dataset.getInfo();
log.info(`✅ Done! Total businesses saved: ${itemCount}`);

await Actor.exit();
