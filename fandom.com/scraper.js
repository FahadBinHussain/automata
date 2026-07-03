const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url'); // Added for URL parsing

async function fetchHTML(url) {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (error) {
    console.error(`Error fetching URL: ${url}`, error);
    return null;
  }
}

// Updated getInfoboxData function
const getInfoboxData = ($, sourceName) => { // Pass $ as an argument
  const dataSourceKey = sourceName.replace(/ /g, '_'); // Normalize to underscore for data-source
  let element = $(`div[data-source="${dataSourceKey}"] > div.pi-data-value`).first();
  if (!element.length) {
    element = $(`div[data-source="${dataSourceKey}"] > div`).first(); // Broader match if .pi-data-value is not direct child
  }

  if (element.length) {
    let content = element.html();
    if (content === null) content = '';
    content = content.replace(/<br\s*\/?>/gi, ' ').replace(/<hr\s*\/?>/gi, ' '); // Convert <br>, <hr> to space
    content = $('<div>' + content + '</div>').text(); // Strip other HTML tags
    return content.replace(/\s+/g, ' ').trim() || null;
  }

  // Fallback: Find by h3 label text (case-insensitive)
  const labelText = sourceName.replace(/_/g, ' ').toLowerCase();
  let foundLabel = null;
  $('aside[role="complementary"] h3.pi-data-label').each((i, el) => {
    const h3 = $(el);
    if (h3.text().trim().toLowerCase() === labelText) {
      foundLabel = h3;
      return false; // Break .each
    }
  });
  // If not found with .pi-data-label, try any h3 in infobox
  if (!foundLabel) {
    $('aside[role="complementary"] h3').each((i, el) => {
        const h3 = $(el);
        if (h3.text().trim().toLowerCase() === labelText) {
          foundLabel = h3;
          return false; // Break .each
        }
    });
  }


  if (foundLabel) {
    let valueElement = foundLabel.nextAll('div.pi-data-value').first();
    if (!valueElement.length) {
      valueElement = foundLabel.next('div'); // Try immediate next div
    }
    if (!valueElement.length) { // More general next div search
        valueElement = foundLabel.next();
        while(valueElement.length && (!valueElement.is('div') || (valueElement.children('img, a.image').length > 0 && valueElement.text().trim() === ''))) {
            if (valueElement.is('div') && valueElement.text().trim() !== '') break;
            valueElement = valueElement.next();
        }
    }

    if (valueElement.length && valueElement.is('div')) {
      let content = valueElement.html();
      if (content === null) content = '';
      content = content.replace(/<br\s*\/?>/gi, ' ').replace(/<hr\s*\/?>/gi, ' ');
      content = $('<div>' + content + '</div>').text();
      return content.replace(/\s+/g, ' ').trim() || null;
    }
  }
  return null;
};

// Helper to find section headers (h2) more robustly
const findSectionHeader = ($, possibleNames) => { // Pass $ as an argument
  let headerElement = null;
  possibleNames.forEach(name => {
    if (headerElement && headerElement.length) return;

    const idName = name.replace(/\s+/g, '_');
    const idNameLower = idName.toLowerCase();

    // 1. Try by exact ID (case sensitive, then specific common Fandom patterns)
    headerElement = $(`h2#${idName}`);
    if (headerElement.length) return;
    headerElement = $(`h2#${name.replace(/ /g, '_')}`); // Exact name to ID
    if (headerElement.length) return;
    headerElement = $(`h2#${name.replace(/ /g, '_').toLowerCase()}`); // Lowercase name to ID
    if (headerElement.length) return;


    // 2. Try by span.mw-headline with ID
    headerElement = $(`h2 span.mw-headline#${idName}`).closest('h2');
    if (headerElement.length) return;
    headerElement = $(`h2 span.mw-headline#${idNameLower}`).closest('h2');
    if (headerElement.length) return;
    
    // 3. Try by h2 containing a span with the text or h2 text itself (case insensitive)
    $('h2').each((i, el) => {
        const h2 = $(el);
        const spanHeadline = h2.find('span.mw-headline');
        const h2TextOnly = h2.clone().children().remove().end().text().trim(); // Text of h2 itself, excluding children like edit buttons

        if (spanHeadline.length && spanHeadline.text().trim().toLowerCase() === name.toLowerCase()) {
            headerElement = h2;
            return false; 
        }
        if (h2TextOnly.toLowerCase() === name.toLowerCase()) {
            headerElement = h2;
            return false;
        }
    });
  });
  return headerElement && headerElement.length ? headerElement : null;
};


async function scrapeFandomPage(url) {
  const html = await fetchHTML(url);
  if (!html) {
    return null;
  }

  const $ = cheerio.load(html);
  const scrapedData = {};

  // Extract Title
  scrapedData.title = $('h1.page-header__title').text().trim();
  if (!scrapedData.title) {
    scrapedData.title = $('aside[role="complementary"] h2.pi-title').first().text().trim();
  }
  if (!scrapedData.title) { // Even more generic title from infobox if others fail
      const infoboxTitle = $('aside[role="complementary"]').find('h2').first().text().trim();
      if (infoboxTitle && infoboxTitle.length < 70) { // Avoid long titles from non-title headers
          scrapedData.title = infoboxTitle;
      }
  }


  // Extract infobox data using the updated getInfoboxData
  scrapedData.author = getInfoboxData($, 'author');
  scrapedData.cover_artist = getInfoboxData($, 'cover_artist') || getInfoboxData($, 'cover artist');
  scrapedData.genre = getInfoboxData($, 'genre');
  scrapedData.based_on = getInfoboxData($, 'based_on') || getInfoboxData($, 'based on');
  scrapedData.publisher = getInfoboxData($, 'publisher');
  scrapedData.publication_date = getInfoboxData($, 'publication_date') || getInfoboxData($, 'release_date') || getInfoboxData($, 'publication date');
  scrapedData.pages = getInfoboxData($, 'pages');
  scrapedData.preceded_by = getInfoboxData($, 'preceded_by') || getInfoboxData($, 'preceded by');
  scrapedData.followed_by = getInfoboxData($, 'followed_by') || getInfoboxData($, 'followed by');

  // Extract Cover Image URL - Enhanced Selectors & Debugging
  let imageUrl = null;
  let imageElement = null;
  // console.log("--- Debugging Image Extraction ---"); // Debug line

  // Try common high-priority selectors first
  const selectors = [
    'div.wds-is-current.wds-tab__content .pi-image.pi-item a.image-thumbnail.image img',
    'div.wds-is-current.wds-tab__content .pi-image.pi-item img',
    'aside[role="complementary"] figure.pi-item.pi-image a.image img', 
    'aside[role="complementary"] div.pi-item.pi-image a.image img',
    'aside[role="complementary"] td.pi-image a.image img',
    'aside[role="complementary"] a.image.image-thumbnail img',
    'aside[role="complementary"] div.thumbimage img'
  ];

  for (const selector of selectors) {
    imageElement = $(selector).first();
    if (imageElement.length) {
      const src = imageElement.attr('src');
      // console.log(`[Debug] Selector '${selector}' found src: ${src}`); // Debug line
      if (src) {
        imageUrl = src;
        break;
      }
    }
  }

  // Fallback to any image in the infobox with data-image-name
  if (!imageUrl) {
    const userLink = $('div.wds-is-current.wds-tab__content .pi-image.pi-item a.image-thumbnail.image').first();
    if (userLink.length) {
        const href = userLink.attr('href');
        // console.log(`[Debug] User selector link found href: ${href}`); // Debug line
        if (href && (href.startsWith('http') || href.startsWith('//'))) { // Check if it looks like a direct image URL
            imageUrl = href;
        }
    }
  }
  
  if (!imageUrl) {
    imageElement = $('aside[role="complementary"] img[data-image-name]').first();
    if (imageElement.length) {
      const src = imageElement.attr('src');
      // console.log(`[Debug] Fallback 'img[data-image-name]' found src: ${src}`); // Debug line
      imageUrl = src;
    }
  }
  
  // More general fallback: first img in infobox that is likely a content image (non-SVG, in a link)
  if (!imageUrl) {
    $('aside[role="complementary"] img').each((i, el) => {
        const img = $(el);
        const src = img.attr('src');
        // console.log(`[Debug] General fallback iteration, src: ${src}`); // Debug line
        if (src && !src.toLowerCase().endsWith('.svg')) {
            if (img.closest('a.image').length || img.closest('a').length) {
                // console.log(`[Debug] General fallback (non-svg, in link) selected src: ${src}`); // Debug line
                imageUrl = src;
                return false; 
            }
        }
    });
  }

   // Aggressive final fallback: first image found in infobox, whatever it is.
   if (!imageUrl) {
    imageElement = $('aside[role="complementary"] img').first();
    if (imageElement.length) {
      const src = imageElement.attr('src');
      // console.log(`[Debug] Aggressive final fallback (first img in aside) found src: ${src}`); // Debug line
      imageUrl = src;
    }
  }
  // console.log("--- End Debugging Image Extraction ---"); // Debug line

    // Clean up Fandom image URLs (remove scaling parameters)
    if (imageUrl && imageUrl.includes('static.wikia.nocookie.net')) {
        try {
            const urlObj = new URL(imageUrl);
            urlObj.pathname = urlObj.pathname.replace(/\/scale-to-width-down\/\d+/g, ''); // Remove scaling path
            urlObj.pathname = urlObj.pathname.replace(/\/revision\/.*/, ''); // Remove /revision/... part
            urlObj.search = ''; // Remove query parameters like ?cb=
            imageUrl = urlObj.toString();
        } catch (e) {
            // If URL parsing fails, use the original imageUrl
            console.warn("Could not parse image URL for cleanup:", imageUrl, e.message);
        }
    }
  scrapedData.cover_image_url = imageUrl || null;

  // Extract Plot Summary using the updated findSectionHeader
  const plotHeader = findSectionHeader($, ['Plot summary', 'Summary', 'Synopsis']);
  if (plotHeader && plotHeader.length) {
    let plotSummary = '';
    let nextElement = plotHeader.next();
    while (nextElement.length && !nextElement.is('h2')) {
      if (nextElement.is('p')) {
        plotSummary += nextElement.text().trim() + '\n';
      }
      nextElement = nextElement.next();
    }
    scrapedData.plot_summary = plotSummary.trim() || null;
  } else {
      scrapedData.plot_summary = null;
  }

  // Extract Characters
  const charactersHeader = findSectionHeader($, ['Characters', 'Cast']);
  if (charactersHeader && charactersHeader.length) {
    const charactersList = [];
    let nextElement = charactersHeader.next();
    while(nextElement.length && !nextElement.is('h2')) {
        if (nextElement.is('ul') || nextElement.is('ol')) {
            nextElement.find('li').each((i, el) => {
                const charText = $(el).text().trim();
                if (charText) charactersList.push(charText);
            });
            // Consider only the first list under the header for now
            // To grab multiple lists, remove break and adjust logic
            break; 
        } else if (nextElement.is('p')) { 
            const pText = nextElement.text().trim();
            if (pText) charactersList.push(pText);
        }
        nextElement = nextElement.next();
    }
    scrapedData.characters = charactersList.length > 0 ? charactersList : null;
  } else {
      scrapedData.characters = null;
  }

  // Extract Locations
  const locationsHeader = findSectionHeader($, ['Locations', 'Setting']);
  if (locationsHeader && locationsHeader.length) {
    const locationsList = [];
     let nextElement = locationsHeader.next();
    while(nextElement.length && !nextElement.is('h2')) {
        if (nextElement.is('ul') || nextElement.is('ol')) {
            nextElement.find('li').each((i, el) => {
                const locText = $(el).text().trim();
                if (locText) locationsList.push(locText);
            });
            break; 
        } else if (nextElement.is('p')) {
             const pText = nextElement.text().trim();
            if (pText) locationsList.push(pText);
        }
        nextElement = nextElement.next();
    }
    scrapedData.locations = locationsList.length > 0 ? locationsList : null;
  } else {
    scrapedData.locations = null;
  }
  
  return scrapedData;
}

// Main execution (example usage)
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Please provide a Fandom URL as a command-line argument.");
    console.error("Example: node scraper.js <URL>");
    return;
  }
  // Trim the URL
  const urlToScrape = args[0].trim(); 
  
  try {
    const data = await scrapeFandomPage(urlToScrape);
    if (data) {
      // Instead of formatted output, just stringify the full object as JSON to stdout
      console.log(JSON.stringify(data));
    } else {
      // Use console.error for error messages so they don't interfere with JSON output
      console.error("Could not scrape data from the URL.");
      // Return empty JSON object if scraping failed
      console.log("{}");
    }
  } catch (error) {
    console.error("Error during scraping:", error);
    // Return empty JSON object on error
    console.log("{}");
  }
}

main(); 