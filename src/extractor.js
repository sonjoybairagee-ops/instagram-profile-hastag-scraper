import { log } from 'apify';

/**
 * Extract business listing URLs from Google Maps search results page.
 */
export async function extractSearchResults(page, maxResults) {
    const urls = [];
    const seen = new Set();

    let prevCount = 0;
    let attempts = 0;

    while (urls.length < maxResults && attempts < 15) {
        // Collect all visible listing links
        const links = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
                .map(a => a.href)
                .filter(href => href.includes('/maps/place/'));
        });

        for (const link of links) {
            const clean = link.split('?')[0];
            if (!seen.has(clean)) {
                seen.add(clean);
                urls.push(link);
            }
            if (urls.length >= maxResults) break;
        }

        if (urls.length >= maxResults) break;

        // Scroll the results panel to load more
        const scrolled = await page.evaluate(() => {
            const panel = document.querySelector('[role="feed"], .m6QErb[aria-label], div[aria-label*="Results for"]');
            if (panel) {
                panel.scrollTop += 1200;
                return true;
            }
            window.scrollBy(0, 800);
            return false;
        });

        await page.waitForTimeout(2000 + Math.random() * 1000);

        // Check if no new results loaded
        if (urls.length === prevCount) {
            attempts++;
        } else {
            attempts = 0;
        }
        prevCount = urls.length;

        // Check for "end of results"
        const ended = await page.evaluate(() => {
            const el = document.querySelector('.HlvSq, [class*="noMore"], span.fontBodyMedium');
            return el?.textContent?.includes("You've reached the end") || false;
        });
        if (ended) break;
    }

    log.info(`Found ${urls.length} business URLs`);
    return urls.slice(0, maxResults);
}

/**
 * Extract full business details from a Google Maps place page.
 */
export async function extractBusinessData(page, url) {
    // Wait for business name to appear
    await page.waitForSelector('h1, [data-attrid="title"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    return await page.evaluate((pageUrl) => {
        const getText = (selector) =>
            document.querySelector(selector)?.textContent?.trim() || null;

        const getAttr = (selector, attr) =>
            document.querySelector(selector)?.getAttribute(attr) || null;

        // ── Name ──
        const name = getText('h1') || getText('[data-attrid="title"]');

        // ── Category ──
        const category = getText('button[jsaction*="category"], [data-attrid="kc:/local:all attributes"] span')
            || document.querySelector('.DkEaL, [class*="category"]')?.textContent?.trim()
            || null;

        // ── Rating & Reviews ──
        const ratingText = getText('[aria-label*="stars"], .F7nice span[aria-hidden="true"]');
        const rating = ratingText ? parseFloat(ratingText) : null;

        const reviewText = getText('[aria-label*="reviews"], .F7nice span[aria-label*="review"]')
            || getText('button[jsaction*="reviewChart"] span');
        const reviewCount = reviewText
            ? parseInt(reviewText.replace(/[^0-9]/g, ''), 10) || null
            : null;

        // ── Address ──
        const addressEl = document.querySelector('[data-item-id="address"] .Io6YTe, button[data-item-id="address"] .Io6YTe');
        const address = addressEl?.textContent?.trim() || null;

        // Parse city/country from address
        let city = null, country = null;
        if (address) {
            const parts = address.split(',').map(p => p.trim());
            city = parts.length >= 2 ? parts[parts.length - 2] : null;
            country = parts.length >= 1 ? parts[parts.length - 1] : null;
        }

        // ── Phone ──
        const phoneEl = document.querySelector('[data-item-id*="phone"] .Io6YTe, [aria-label*="phone"] .Io6YTe');
        const phone = phoneEl?.textContent?.trim() || null;

        // ── Website ──
        const websiteEl = document.querySelector('[data-item-id="authority"] .Io6YTe, a[data-item-id="authority"]');
        const website = websiteEl?.textContent?.trim()
            || document.querySelector('a[data-item-id="authority"]')?.getAttribute('href')
            || null;

        // ── Hours ──
        const hours = {};
        document.querySelectorAll('table.WgFkxc tr, [data-attrid*="hours"] tr').forEach(row => {
            const day = row.querySelector('td:first-child')?.textContent?.trim();
            const time = row.querySelector('td:last-child')?.textContent?.trim();
            if (day && time) hours[day] = time;
        });

        // Current open/closed status
        const openStatus = getText('[aria-label*="Open now"], [aria-label*="Closed"], .o0Svhf, [class*="openStatus"]')
            || getText('.ZDu9vd span, .MkV9 span');

        // ── Coordinates ──
        let lat = null, lng = null;
        try {
            const coordMatch = pageUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (coordMatch) {
                lat = parseFloat(coordMatch[1]);
                lng = parseFloat(coordMatch[2]);
            }
        } catch {}

        // ── Photos ──
        const photos = [];
        document.querySelectorAll('img[src*="googleusercontent.com/p/"], img[src*="lh5.googleusercontent"]').forEach(img => {
            const src = img.getAttribute('src');
            if (src && !photos.includes(src)) photos.push(src);
        });

        // ── Price level ──
        const priceLevel = getText('[aria-label*="Price"], .mgr77e span[aria-label]')
            || null;

        // ── Description ──
        const description = getText('[data-attrid="description"] span, .PYvSYb, .HlvSq')
            || null;

        // ── Plus code ──
        const plusCode = getText('[data-item-id="oloc"] .Io6YTe')
            || null;

        // ── Service options ──
        const serviceOptions = [];
        document.querySelectorAll('[class*="attribute"] span, .E0DTEd span').forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length < 50) serviceOptions.push(text);
        });

        // ── Amenities / highlights ──
        const amenities = [];
        document.querySelectorAll('[aria-label*="Has"] span, [class*="amenity"] span').forEach(el => {
            const text = el.textContent?.trim();
            if (text) amenities.push(text);
        });

        // ── Social profiles ──
        const socialLinks = {};
        document.querySelectorAll('a[href*="facebook.com"], a[href*="instagram.com"], a[href*="twitter.com"], a[href*="linkedin.com"]').forEach(a => {
            const href = a.getAttribute('href');
            if (href?.includes('facebook.com')) socialLinks.facebook = href;
            else if (href?.includes('instagram.com')) socialLinks.instagram = href;
            else if (href?.includes('twitter.com')) socialLinks.twitter = href;
            else if (href?.includes('linkedin.com')) socialLinks.linkedin = href;
        });

        // ── Google Maps place ID from URL ──
        const placeIdMatch = pageUrl.match(/place\/[^/]+\/([^/]+)/);
        const placeId = placeIdMatch?.[1]?.split('?')[0] || null;

        return {
            name,
            category,
            rating,
            reviewCount,
            address,
            city,
            country,
            phone,
            website,
            hours,
            openStatus,
            coordinates: lat && lng ? { lat, lng } : null,
            photos: [...new Set(photos)].slice(0, 10),
            priceLevel,
            description,
            plusCode,
            serviceOptions: [...new Set(serviceOptions)].slice(0, 20),
            amenities: [...new Set(amenities)].slice(0, 20),
            socialLinks,
            placeId,
            mapsUrl: pageUrl,
            scrapedAt: new Date().toISOString(),
        };
    }, url);
}

/**
 * Extract reviews from the reviews panel.
 */
export async function extractReviews(page, maxReviews) {
    // Click the Reviews tab
    try {
        const reviewTab = await page.$('button[aria-label*="Reviews"], [data-tab-index="1"]');
        if (reviewTab) {
            await reviewTab.click();
            await page.waitForTimeout(2000);
        }
    } catch {}

    // Scroll to load more reviews
    let prevCount = 0;
    for (let i = 0; i < 10; i++) {
        const count = await page.evaluate(() =>
            document.querySelectorAll('[data-review-id], .jftiEf').length
        );
        if (count >= maxReviews || count === prevCount) break;
        prevCount = count;

        await page.evaluate(() => {
            const panel = document.querySelector('.m6QErb.DxyBCb, [role="main"]');
            if (panel) panel.scrollTop += 1000;
        });
        await page.waitForTimeout(1500);
    }

    // Expand "More" links
    await page.evaluate(() => {
        document.querySelectorAll('button[aria-label*="See more"], .w8nwRe').forEach(btn => btn.click());
    });
    await page.waitForTimeout(500);

    return await page.evaluate((max) => {
        const reviews = [];
        document.querySelectorAll('[data-review-id], .jftiEf').forEach(el => {
            if (reviews.length >= max) return;

            const ratingEl = el.querySelector('[aria-label*="stars"] span, .kvMYJc');
            const ratingMatch = ratingEl?.getAttribute('aria-label')?.match(/(\d)/);

            reviews.push({
                reviewId: el.getAttribute('data-review-id') || null,
                author: el.querySelector('.d4r55, .NhBTye span')?.textContent?.trim() || null,
                authorUrl: el.querySelector('a.WNxzHc, a[data-href*="contrib"]')?.getAttribute('href') || null,
                rating: ratingMatch ? parseInt(ratingMatch[1]) : null,
                date: el.querySelector('.rsqaWe, .xRkPPb span')?.textContent?.trim() || null,
                text: el.querySelector('.wiI7pd, .MyEned span')?.textContent?.trim() || null,
                ownerReply: el.querySelector('.CDe7pd .wiI7pd')?.textContent?.trim() || null,
                photos: Array.from(el.querySelectorAll('img[src*="googleusercontent"]'))
                    .map(img => img.getAttribute('src')).filter(Boolean),
                likes: el.querySelector('[aria-label*="helpful"] span')?.textContent?.trim() || null,
            });
        });
        return reviews;
    }, maxReviews);
}
