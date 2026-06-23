/**
 * Instagram Profile & Hashtag Scraper - Apify Actor
 * Uses network request interception to capture Instagram's GraphQL API responses
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, Log } from 'crawlee';

const log = new Log({ prefix: 'InstagramScraper' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = async (min = 2000, max = 5000) => {
    await sleep(Math.floor(Math.random() * (max - min + 1)) + min);
};

// ─── Cookie Setup ────────────────────────────────────────────────────────────

async function setCookies(context, cookies) {
    if (!cookies || cookies.length === 0) return;
    const formatted = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || '.instagram.com',
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: c.httpOnly || false,
        sameSite: 'None'
    }));
    await context.addCookies(formatted);
    log.info(`Set ${formatted.length} cookies successfully.`);
}

// ─── Dialog Dismisser ────────────────────────────────────────────────────────

async function dismissDialogs(page) {
    const selectors = [
        'text=Not Now',
        'text=Allow all cookies',
        'text=Accept All',
        'text=Only allow essential cookies'
    ];
    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
                await el.click();
                await sleep(800);
            }
        } catch (_) {}
    }
}

// ─── Network Interceptor ─────────────────────────────────────────────────────

function setupNetworkInterception(page, dataStore) {
    page.on('response', async (response) => {
        const url = response.url();
        try {
            // Intercept GraphQL API calls
            if (url.includes('/graphql/query') || url.includes('graphql?') ||
                url.includes('/api/v1/') || url.includes('__a=1')) {
                const ct = response.headers()['content-type'] || '';
                if (ct.includes('json')) {
                    const body = await response.json().catch(() => null);
                    if (body) dataStore.push(body);
                }
            }
            // Intercept profile page JSON
            if (url.includes('instagram.com') && url.includes('?__a=1')) {
                const body = await response.json().catch(() => null);
                if (body) dataStore.push(body);
            }
        } catch (_) {}
    });
}

// ─── Deep Search ─────────────────────────────────────────────────────────────

function deepSearch(obj, predicate, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== 'object') return null;
    if (predicate(obj)) return obj;
    for (const val of Object.values(obj)) {
        const result = deepSearch(val, predicate, depth + 1);
        if (result) return result;
    }
    return null;
}

function extractPostNode(node) {
    if (!node) return null;
    return {
        postId: node.id,
        shortCode: node.shortcode || node.code,
        postUrl: `https://www.instagram.com/p/${node.shortcode || node.code}/`,
        type: node.__typename || node.media_type,
        imageUrl: node.display_url || node.image_versions2?.candidates?.[0]?.url,
        thumbnailUrl: node.thumbnail_src || node.display_url,
        caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ||
                 node.caption?.text || '',
        likesCount: node.edge_media_preview_like?.count ||
                    node.edge_liked_by?.count ||
                    node.like_count || 0,
        commentsCount: node.edge_media_to_comment?.count ||
                       node.comment_count || 0,
        timestamp: node.taken_at_timestamp
            ? new Date(node.taken_at_timestamp * 1000).toISOString()
            : node.taken_at
            ? new Date(node.taken_at * 1000).toISOString()
            : null,
        isVideo: node.is_video || node.media_type === 2,
        videoViewCount: node.video_view_count || node.play_count || 0,
        locationName: node.location?.name || null,
        ownerUsername: node.owner?.username || node.user?.username,
        hashtags: (node.edge_media_to_caption?.edges?.[0]?.node?.text ||
                   node.caption?.text || '').match(/#[\w]+/g) || [],
    };
}

// ─── Profile Scraper ─────────────────────────────────────────────────────────

async function scrapeProfile(page, username, maxPosts) {
    log.info(`Scraping profile: @${username}`);
    const intercepted = [];
    setupNetworkInterception(page, intercepted);

    // Method 1: Load profile with ?__a=1&__d=dis for JSON response
    const apiUrl = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
    await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(3000);

    // Method 2: Try regular profile page
    const profileUrl = `https://www.instagram.com/${username}/`;
    await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await randomDelay(3000, 5000);
    await dismissDialogs(page);

    // Extract from page scripts
    const pageData = await page.evaluate(() => {
        // Try window._sharedData
        if (window._sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user) {
            return window._sharedData.entry_data.ProfilePage[0].graphql.user;
        }

        // Try __additionalDataLoaded
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const s of scripts) {
            const t = s.textContent || '';
            if (t.includes('edge_owner_to_timeline_media')) {
                try {
                    const match = t.match(/\{.*"edge_owner_to_timeline_media".*\}/s);
                    if (match) return JSON.parse(match[0]);
                } catch (_) {}
            }
        }

        // Try application/json scripts
        const jsonScripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
        for (const s of jsonScripts) {
            try {
                const json = JSON.parse(s.textContent);
                const search = (obj, d = 0) => {
                    if (d > 10 || !obj || typeof obj !== 'object') return null;
                    if (obj.username && (obj.edge_followed_by || obj.follower_count)) return obj;
                    if (obj.edge_owner_to_timeline_media) return obj;
                    for (const v of Object.values(obj)) {
                        const r = search(v, d + 1);
                        if (r) return r;
                    }
                    return null;
                };
                const found = search(json);
                if (found) return found;
            } catch (_) {}
        }

        // Fallback: parse meta
        const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
        const desc = meta('og:description') || '';
        const m = desc.match(/([\d,.KMB]+)\s*Followers/i);
        return {
            username: null,
            full_name: meta('og:title')?.replace(' • Instagram', '').trim(),
            followers: m?.[1],
            _fallback: true
        };
    });

    // Scroll to load posts
    await page.evaluate(() => window.scrollTo(0, 500));
    await sleep(2000);
    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(2500);
    }

    // Collect all post links from DOM
    const postLinks = await page.$$eval('a[href*="/p/"]', (els) =>
        [...new Set(els.map((e) => e.href).filter((h) => /\/p\/[A-Za-z0-9_-]+/.test(h)))]
    );

    log.info(`Found ${postLinks.length} post links on profile page`);

    // Parse user data
    let userData = pageData;
    let posts = [];

    // Extract posts from intercepted API responses
    for (const data of intercepted) {
        const timeline = deepSearch(data, (o) => o.edge_owner_to_timeline_media || o.edge_felix_video_timeline);
        if (timeline) {
            const edges = timeline.edge_owner_to_timeline_media?.edges ||
                          timeline.edge_felix_video_timeline?.edges || [];
            const extracted = edges.map((e) => extractPostNode(e.node)).filter(Boolean);
            posts.push(...extracted);
        }

        // Also search for user info
        const user = deepSearch(data, (o) => o.username && o.edge_followed_by);
        if (user && !userData?.username) userData = user;
    }

    // Extract from pageData if not from interception
    if (posts.length === 0 && userData?.edge_owner_to_timeline_media?.edges) {
        posts = userData.edge_owner_to_timeline_media.edges
            .map((e) => extractPostNode(e.node))
            .filter(Boolean);
    }

    // Use post links as fallback
    if (posts.length === 0 && postLinks.length > 0) {
        log.info('Using post links as fallback...');
        posts = postLinks.slice(0, maxPosts).map((url) => {
            const match = url.match(/\/p\/([A-Za-z0-9_-]+)/);
            return match ? { shortCode: match[1], postUrl: url } : null;
        }).filter(Boolean);
    }

    const followers = userData?.edge_followed_by?.count ||
                      userData?.follower_count ||
                      userData?.followers;

    log.info(`@${username} | Followers: ${followers} | Posts extracted: ${posts.length}`);

    return {
        type: 'profile',
        scrapedAt: new Date().toISOString(),
        profileUrl: `https://www.instagram.com/${username}/`,
        username: userData?.username || username,
        fullName: userData?.full_name,
        biography: userData?.biography,
        followers: followers,
        following: userData?.edge_follow?.count || userData?.following_count,
        postsCount: userData?.edge_owner_to_timeline_media?.count || userData?.media_count,
        isVerified: userData?.is_verified || false,
        isPrivate: userData?.is_private || false,
        profilePicUrl: userData?.profile_pic_url_hd || userData?.profile_pic_url,
        externalUrl: userData?.external_url,
        isBusiness: userData?.is_business_account || false,
        posts: posts.slice(0, maxPosts)
    };
}

// ─── Hashtag Scraper ─────────────────────────────────────────────────────────

async function scrapeHashtag(page, hashtag, maxPosts) {
    log.info(`Scraping hashtag: #${hashtag}`);
    const intercepted = [];
    setupNetworkInterception(page, intercepted);

    const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`;
    await page.goto(hashtagUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await randomDelay(3000, 5000);
    await dismissDialogs(page);

    // Scroll to load more
    for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(2500);
    }

    // Extract from page
    const pageData = await page.evaluate(() => {
        const jsonScripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
        for (const s of jsonScripts) {
            try {
                const json = JSON.parse(s.textContent);
                const search = (obj, d = 0) => {
                    if (d > 10 || !obj || typeof obj !== 'object') return null;
                    if (obj.name && obj.edge_hashtag_to_media) return obj;
                    if (obj.hashtag && (obj.hashtag.edge_hashtag_to_media || obj.hashtag.media)) return obj.hashtag;
                    for (const v of Object.values(obj)) {
                        const r = search(v, d + 1);
                        if (r) return r;
                    }
                    return null;
                };
                const found = search(json);
                if (found) return found;
            } catch (_) {}
        }
        return null;
    });

    let posts = [];
    let totalCount = null;

    // Extract from intercepted responses
    for (const data of intercepted) {
        const hashData = deepSearch(data, (o) =>
            (o.name || o.hashtag) && (o.edge_hashtag_to_media || o.media)
        );
        if (hashData) {
            const edges = hashData.edge_hashtag_to_media?.edges ||
                          hashData.edge_hashtag_to_top_posts?.edges || [];
            const extracted = edges.map((e) => ({
                ...extractPostNode(e.node),
                hashtag
            })).filter(Boolean);
            posts.push(...extracted);
            if (!totalCount) totalCount = hashData.edge_hashtag_to_media?.count;
        }
    }

    // Extract from pageData
    if (posts.length === 0 && pageData) {
        const edges = [
            ...(pageData.edge_hashtag_to_top_posts?.edges || []),
            ...(pageData.edge_hashtag_to_media?.edges || [])
        ];
        posts = edges.map((e) => ({ ...extractPostNode(e.node), hashtag })).filter(Boolean);
        totalCount = pageData.edge_hashtag_to_media?.count;
    }

    // Fallback: get post links from DOM
    if (posts.length === 0) {
        const links = await page.$$eval('a[href*="/p/"]', (els) =>
            [...new Set(els.map((e) => e.href).filter((h) => /\/p\/[A-Za-z0-9_-]+/.test(h)))]
        );
        posts = links.slice(0, maxPosts).map((url) => {
            const m = url.match(/\/p\/([A-Za-z0-9_-]+)/);
            return m ? { shortCode: m[1], postUrl: url, hashtag } : null;
        }).filter(Boolean);
    }

    // Remove duplicates
    const seen = new Set();
    posts = posts.filter((p) => {
        const key = p.shortCode || p.postUrl;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    log.info(`Hashtag #${hashtag} | Total: ${totalCount} | Scraped: ${posts.length}`);

    return {
        type: 'hashtag',
        scrapedAt: new Date().toISOString(),
        hashtag,
        hashtagUrl,
        totalPostsCount: totalCount,
        posts: posts.slice(0, maxPosts)
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

await Actor.init();

const input = await Actor.getInput() || {};
const {
    scrapeType = 'both',
    usernames = [],
    hashtags = [],
    maxPostsPerProfile = 12,
    maxPostsPerHashtag = 20,
    scrapeComments = false,
    proxy = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    loginCookies = []
} = input;

log.info('Config:', { scrapeType, usernames, hashtags, maxPostsPerProfile, maxPostsPerHashtag });

const proxyConfig = await Actor.createProxyConfiguration(proxy);

const crawler = new PlaywrightCrawler({
    proxyConfiguration: proxyConfig,
    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--lang=en-US'
            ]
        }
    },
    browserPoolOptions: { useFingerprints: true },
    maxConcurrency: 1,
    requestHandlerTimeoutSecs: 360,
    maxRequestRetries: 2,

    async requestHandler({ page, request }) {
        const { type, identifier } = request.userData;

        await page.setViewportSize({ width: 1366, height: 768 });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });

        // Set cookies on browser context
        if (loginCookies.length > 0) {
            await setCookies(page.context(), loginCookies);
        }

        try {
            let result;
            if (type === 'profile') {
                result = await scrapeProfile(page, identifier, maxPostsPerProfile);
            } else {
                result = await scrapeHashtag(page, identifier, maxPostsPerHashtag);
            }
            await Dataset.pushData(result);
            log.info(`✅ ${type} "${identifier}" saved | Posts: ${result.posts?.length}`);
        } catch (err) {
            log.error(`Failed ${type} "${identifier}": ${err.message}`);
            await Dataset.pushData({ type, identifier, error: err.message, scrapedAt: new Date().toISOString() });
        }
    },

    failedRequestHandler({ request, error }) {
        log.error(`Request failed: ${request.url} — ${error.message}`);
    }
});

const requests = [];

if (scrapeType === 'profile' || scrapeType === 'both') {
    for (const u of usernames) {
        const clean = u.replace(/^@/, '').trim();
        if (clean) requests.push({
            url: `https://www.instagram.com/${clean}/`,
            userData: { type: 'profile', identifier: clean }
        });
    }
}

if (scrapeType === 'hashtag' || scrapeType === 'both') {
    for (const t of hashtags) {
        const clean = t.replace(/^#/, '').trim();
        if (clean) requests.push({
            url: `https://www.instagram.com/explore/tags/${encodeURIComponent(clean)}/`,
            userData: { type: 'hashtag', identifier: clean }
        });
    }
}

if (requests.length === 0) {
    log.warning('No usernames or hashtags provided!');
    await Actor.exit();
}

log.info(`Starting ${requests.length} target(s)...`);
await crawler.run(requests);
log.info('🎉 Done! Check Dataset for results.');
await Actor.exit();
