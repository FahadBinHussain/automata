const axios = require('axios');
const cheerio = require('cheerio');

// Hardcoded next-action ID (as requested)
const NEXT_ACTION_ID = '28417b2a8c56565e7953dccc20653cea74746d3a';

const config = {
    selectors: {
        book: {
            title: '.detailsBookContainer_bookName__pLCtW',
            summary: '.productSummary_summeryText__Pd_tX',
            mainImage: '.lookInside_imageContainer__A2WcA img', 
            listImages: '.bookImageThumbs_bookImageThumb__368gC img', 
        },
        // Add product selectors if needed for other page types
    },
    targetDimensions: '260X372',
    regex: {
        dimensionPart: /(\/(?:ProductNew\d+|product|book|Content)\/)\d+X\d+(\/.*)/i
    }
};

function getBookIdFromUrl(url) {
    try {
        const match = url.match(/\/book\/(\d+)\//);
        return match ? match[1] : null;
    } catch (e) {
        console.error('Error extracting book ID from URL:', e);
        return null;
    }
}

function modifyUrlToTargetDimensions(url, targetDimensions, dimensionRegex) {
    if (!url || typeof url !== 'string') return url;
    try {
        const match = url.match(dimensionRegex);
        if (match && match[1] && match[2]) {
            const currentDimensionInUrl = url.substring(url.indexOf(match[1]) + match[1].length, url.indexOf(match[2]));
            if (currentDimensionInUrl.toUpperCase() === targetDimensions.toUpperCase()) return url;
            const baseUrlPart = url.substring(0, url.indexOf(match[1]));
            return baseUrlPart + match[1] + targetDimensions + match[2];
        }
    } catch (e) { console.error(`Error modifying URL "${url}":`, e); }
    return url;
}

async function fetchSpecifications(bookUrl, bookId) {
    if (!bookId) {
        console.warn('No book ID provided for fetching specifications.');
        return null;
    }
    const payload = JSON.stringify([bookId]);
    const headers = {
        'accept': 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8',
        'next-action': NEXT_ACTION_ID,
        'origin': 'https://www.rokomari.com',
        'referer': bookUrl,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    try {
        console.log(`Fetching specifications via API for book ID: ${bookId}...`);
        const response = await axios.post(bookUrl, payload, { headers });
        if (response.data && typeof response.data === 'string') {
            const marker = "1:[";
            const startIndex = response.data.indexOf(marker);
            if (startIndex !== -1) {
                const jsonString = response.data.substring(startIndex + marker.length - 1);
                try {
                    const specs = JSON.parse(jsonString);
                    console.log('Successfully fetched and parsed specifications from API.');
                    return specs;
                } catch (parseError) {
                    console.error('Error parsing specifications JSON:', parseError, 'Attempted to parse:', jsonString);
                    return null;
                }
            } else {
                console.warn('Marker "1:[" not found in specifications API response string:', response.data);
                return null;
            }
        } else {
            console.warn('Unexpected response data type or empty response from specifications API:', typeof response.data);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching specifications from API for book ID ${bookId}:`, error.message);
        if (error.response) { console.error('Status:', error.response.status, 'Data:', error.response.data); }
        return null;
    }
}

async function scrapeRokomariBook(url) {
    const bookId = getBookIdFromUrl(url);
    let allData = { url, bookId, title: null, summary: null, mainImage: null, listImages: [], specifications: null, error: null };

    try {
        console.log(`Fetching main page HTML from ${url} with Axios...`);
        const pageResponse = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = pageResponse.data;
        const $ = cheerio.load(html);

        const currentSelectors = config.selectors.book; // Assuming 'book' for now

        // Extract Title
        allData.title = $(currentSelectors.title).first().text().trim();
        console.log(`Title (Cheerio): ${allData.title}`);

        // Extract Summary
        allData.summary = $(currentSelectors.summary).first().text().trim();
        console.log(`Summary (Cheerio): ${(allData.summary || '').substring(0,100)}...`);

        // Extract Main Image
        const rawMainImageUrl = $(currentSelectors.mainImage).first().attr('src') || $(currentSelectors.mainImage).first().attr('data-src');
        allData.mainImage = modifyUrlToTargetDimensions(rawMainImageUrl, config.targetDimensions, config.regex.dimensionPart);
        console.log(`Main Image (Cheerio, Modified): ${allData.mainImage}`);
        
        // Extract List Images
        $(currentSelectors.listImages).each((i, img) => {
            const rawSrc = $(img).attr('src') || $(img).attr('data-src');
            const modifiedSrc = modifyUrlToTargetDimensions(rawSrc, config.targetDimensions, config.regex.dimensionPart);
            if (modifiedSrc) {
                allData.listImages.push(modifiedSrc);
            }
        });
        console.log(`List Images (Cheerio, Modified): ${allData.listImages.length} found`);

        // Fetch specifications using Axios (as before)
        if (bookId) {
            allData.specifications = await fetchSpecifications(url, bookId);
        }

    } catch (error) {
        console.error(`An error occurred during the scraping process for ${url}: ${error.message}`);
        allData.error = error.message;
    }
    return allData;
}

// --- Example Usage ---
(async () => {
    const bookUrl = process.argv[2] || 'https://www.rokomari.com/book/48659/masud-rana-hacker-1-and-2';
    if (!bookUrl || !bookUrl.startsWith('http')) {
        console.error("Please provide a valid Rokomari book URL.");
        return;
    }
    console.log(`Starting full scrape for: ${bookUrl}`);
    const productData = await scrapeRokomariBook(bookUrl);
    console.log("\n--- Combined Extracted Data ---");
    console.log(JSON.stringify(productData, null, 2));
})(); 