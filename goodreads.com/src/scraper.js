const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeGoodreads(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { // Goodreads might block requests without a common user-agent
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);

    const bookDetails = {
        bookName: null,
        authors: [],
        imageUrl: null,
        bookSummary: null,
        publicationDate: null,
        publisher: null,
        genres: [],
        ratings: "0",
        averageRating: null,
        numberOfPages: null,
        language: null,
        seriesName: null,
        positionInSeries: null,
        characters: []
    };

    // --- BEGIN DIRECT CHARACTER EXTRACTION ---
    // This needs to come first to ensure we collect characters before anything else
    // This is the simplest and most reliable approach that works consistently
    $('a').each((i, element) => {
        const href = $(element).attr('href');
        if (href && href.includes('/characters/')) {
            const text = $(element).text().trim();
            if (text && !bookDetails.characters.includes(text)) {
                bookDetails.characters.push(text);
            }
        }
    });
    // --- END DIRECT CHARACTER EXTRACTION ---

    // --- BEGIN CHARACTERS SECTION EXTRACTION ---
    // Look for Characters section specifically
    $('dt').each((i, el) => {
        const label = $(el).text().trim();
        if (label === 'Characters') {
            const dd = $(el).next('dd');
            dd.find('a[href*="/characters/"]').each((idx, charEl) => {
                const charName = $(charEl).text().trim();
                if (charName && !bookDetails.characters.includes(charName)) {
                    bookDetails.characters.push(charName);
                }
            });
        }
    });
    // --- END CHARACTERS SECTION EXTRACTION ---

    // --- BEGIN __NEXT_DATA__ PARSING ---
    const nextDataScript = $('script#__NEXT_DATA__[type="application/json"]');
    let nextDataParsed = false;
    if (nextDataScript.length > 0) {
        try {
            // First try: Direct regex search for character data in the JSON string
            // This is more reliable than navigating the complex JSON structure
            const nextDataContent = nextDataScript.html();
            
            // Use a more comprehensive regex pattern to find all characters
            // This pattern looks for any character object in the JSON
            const charPattern = /"characters"\s*:\s*\[([\s\S]*?)\]/g;
            const charMatches = nextDataContent.match(charPattern);
            
            if (charMatches && charMatches.length > 0) {
                charMatches.forEach(characterArray => {
                    // Extract individual character objects from the array
                    const namePattern = /"name"\s*:\s*"([^"]+)"/g;
                    let nameMatch;
                    while ((nameMatch = namePattern.exec(characterArray)) !== null) {
                        if (nameMatch[1]) {
                            const charName = nameMatch[1];
                            if (!bookDetails.characters.includes(charName)) {
                                bookDetails.characters.push(charName);
                            }
                        }
                    }
                });
            }

            // Second try: Parse the JSON and navigate the structure
            const nextDataJson = JSON.parse(nextDataScript.html());
            // console.log("__NEXT_DATA__ found, attempting to parse props.pageProps.apolloState..."); // Debug log

            if (nextDataJson && nextDataJson.props && nextDataJson.props.pageProps && nextDataJson.props.pageProps.apolloState) {
                const apolloState = nextDataJson.props.pageProps.apolloState;
                // Iterate through the apolloState to find the main book object
                // This object often has a key like "Book:kca://book/amzn1.gr.book.v1.<some_id>"
                // Or it might be directly one of the more complex objects.

                for (const key in apolloState) {
                    if (apolloState.hasOwnProperty(key) && typeof apolloState[key] === 'object' && apolloState[key] !== null) {
                        const item = apolloState[key];

                        // Looking for a structure that contains 'details' and 'bookGenres' or 'title'/'name'
                        // This is an heuristic, as the exact key for the book is unknown
                        if (item.details && (item.bookGenres || item.title || item.name || item.work)) {
                            // console.log(\`Found potential book data in apolloState['\${key}']\`); // Debug log

                            // Publisher
                            if (item.details && item.details.publisher && !bookDetails.publisher) {
                                bookDetails.publisher = item.details.publisher;
                                // console.log("Publisher from __NEXT_DATA__:", bookDetails.publisher); // Debug
                                nextDataParsed = true;
                            }

                            // Language
                            if (item.details && item.details.language && item.details.language.name && !bookDetails.language) {
                                bookDetails.language = item.details.language.name;
                                // console.log("Language from __NEXT_DATA__:", bookDetails.language); // Debug
                                nextDataParsed = true;
                            }

                            // Number of Pages
                            if (item.details && item.details.numPages && !bookDetails.numberOfPages) {
                                bookDetails.numberOfPages = parseInt(item.details.numPages, 10);
                                // console.log("Num Pages from __NEXT_DATA__:", bookDetails.numberOfPages); // Debug
                                nextDataParsed = true;
                            }

                            // Genres
                            if (item.bookGenres && Array.isArray(item.bookGenres) && bookDetails.genres.length === 0) {
                                item.bookGenres.forEach(bg => {
                                    if (bg.genre && bg.genre.name) {
                                        bookDetails.genres.push(bg.genre.name);
                                    }
                                });
                                if (bookDetails.genres.length > 0) {
                                    // console.log("Genres from __NEXT_DATA__:", bookDetails.genres); // Debug
                                    nextDataParsed = true;
                                }
                            }

                            // Characters
                            // The structure of characters is now confirmed to be item.details.characters
                            // e.g., item.details.characters: [{"__typename":"Character","name":"Character Name"}]
                            if (item.details && item.details.characters && Array.isArray(item.details.characters)) {
                                item.details.characters.forEach(char => {
                                    if (char && char.name && !bookDetails.characters.includes(char.name)) {
                                        bookDetails.characters.push(char.name);
                                    }
                                });
                                if (bookDetails.characters.length > 0) {
                                    // console.log("Characters from __NEXT_DATA__:", bookDetails.characters); // Debug
                                    nextDataParsed = true;
                                }
                            }

                            // If we found critical data from this item, we can assume it's the main book data.
                            // We can break here to avoid processing other less relevant items in apolloState.
                            // This is an optimization and might need adjustment if main book data is spread across multiple apolloState items.
                            // REMOVING BREAK to ensure all of apolloState is processed, as characters might be in a different item.
                            // if (bookDetails.publisher && bookDetails.language && bookDetails.numberOfPages) {
                            //     break; 
                            // }
                        }
                    }
                }
            }
        } catch (e) {
            // console.error("Error parsing __NEXT_DATA__ JSON:", e.message);
            // Silently ignore if JSON is malformed or structure is not as expected
        }
    }
    // --- END __NEXT_DATA__ PARSING ---

    // Book Name
    bookDetails.bookName = $('h1[data-testid="bookTitle"]').text().trim();

    // Author Name - Get all authors
    const authorElements = $('span[data-testid="authorName"], .ContributorLink__name');
    if (authorElements.length > 0) {
        // Process all author elements
        authorElements.each((i, el) => {
            const authorName = $(el).text().trim();
            if (authorName && !bookDetails.authors.includes(authorName)) {
                bookDetails.authors.push(authorName);
            }
        });
    }
    
    // Try alternative methods if no authors found
    if (bookDetails.authors.length === 0) {
        // Fallback method: Look for author in NEXT_DATA
        if (nextDataScript.length > 0) {
            try {
                const nextDataJson = JSON.parse(nextDataScript.html());
                if (nextDataJson && nextDataJson.props && nextDataJson.props.pageProps && 
                    nextDataJson.props.pageProps.apolloState) {
                    
                    const apolloState = nextDataJson.props.pageProps.apolloState;
                    for (const key in apolloState) {
                        if (apolloState.hasOwnProperty(key) && 
                            typeof apolloState[key] === 'object' && 
                            apolloState[key] !== null) {
                            
                            const item = apolloState[key];
                            if (item.author && item.author.name) {
                                const authorName = item.author.name;
                                if (!bookDetails.authors.includes(authorName)) {
                                    bookDetails.authors.push(authorName);
                                }
                            } else if (item.authors && Array.isArray(item.authors)) {
                                // Extract all authors from the array
                                item.authors.forEach(author => {
                                    if (author.name && !bookDetails.authors.includes(author.name)) {
                                        bookDetails.authors.push(author.name);
                                    }
                                });
                            } else if (item.contributors && Array.isArray(item.contributors)) {
                                for (const contributor of item.contributors) {
                                    if (contributor.role === 'AUTHOR' && contributor.name && 
                                        !bookDetails.authors.includes(contributor.name)) {
                                        bookDetails.authors.push(contributor.name);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Silently ignore if JSON is malformed
            }
        }
    }
    
    // Additional fallback method for authors using book page title section links
    if (bookDetails.authors.length === 0) {
        // Look for author links near the book title
        const authorLinks = $('.BookPageTitleSection a[href*="/author/show/"]');
        if (authorLinks.length > 0) {
            authorLinks.each((i, el) => {
                const authorName = $(el).text().trim();
                if (authorName && !bookDetails.authors.includes(authorName)) {
                    bookDetails.authors.push(authorName);
                }
            });
        }
    }

    // Image URL
    bookDetails.imageUrl = $('.BookCover__image .ResponsiveImage').attr('src');

    // Book Summary
    let summary = '';
    
    // Try a more specific selector for the summary parts
    const descriptionContainer = $('.BookPageMetadataSection__description .DetailsLayoutRightParagraph__widthConstrained .Formatted');
    
    if (descriptionContainer.length > 0) {
        // Get the HTML content to preserve <br> tags
        const html = descriptionContainer.html();
        
        if (html) {
            // Replace <br> tags with newlines before extracting text
            const modifiedHtml = html.replace(/<br\s*\/?>/gi, '\n');
            
            // Load the modified HTML and extract text, which will now have newlines
            const $temp = cheerio.load(`<div>${modifiedHtml}</div>`);
            summary = $temp('div').text().trim();
        } else {
            // Fallback to direct text extraction if HTML is not available
            summary = descriptionContainer.text().trim();
        }
    }
    
    // Keep original formatting with preserved line breaks
    bookDetails.bookSummary = summary;

    // Publication Date & Publisher
    const publicationInfoText = $('[data-testid="publicationInfo"]').text().trim();
    const firstPublishedMatch = publicationInfoText.match(/First published\s+(.+)/);
    const publishedMatch = publicationInfoText.match(/Published\s+(.+)/);

    if (publishedMatch && publishedMatch[1]) {
        const parts = publishedMatch[1].split(/\s+by\s+/);
        bookDetails.publicationDate = parts[0].trim();
        if (parts.length > 1 && !bookDetails.publisher) { // Only set if not already from NEXT_DATA
            bookDetails.publisher = parts[1].trim();
        } else if (!bookDetails.publisher) {
            // If "by" is not there, it might be just the date
            bookDetails.publisher = null;
        }
    } else if (firstPublishedMatch && firstPublishedMatch[1]) {
        // "First published" usually doesn't list the publisher in the same line
        bookDetails.publicationDate = firstPublishedMatch[1].trim();
        if (!bookDetails.publisher) bookDetails.publisher = null; // Publisher might be elsewhere or not in this string
    } else {
        bookDetails.publicationDate = publicationInfoText; // Fallback
        if (!bookDetails.publisher) bookDetails.publisher = null;
    }

    // Attempt to find publisher if it's null and publication date was found
    if (!bookDetails.publisher && bookDetails.publicationDate && publicationInfoText.includes(' by ')) {
        const publisherString = publicationInfoText.substring(publicationInfoText.indexOf(' by ') + 4);
        if (publisherString) {
            bookDetails.publisher = publisherString.trim();
        }
    }
    // Another attempt for publisher if it's still null, look for a specific element
    if (!bookDetails.publisher) {
        const publisherElement = $('.BookDetails .PublisherLine [aria-label*="Publisher"]');
        if (publisherElement.length > 0) {
            bookDetails.publisher = publisherElement.text().replace(/Published by /, '').trim();
        }
    }
     // Attempt to get publisher specifically if still null (another fallback)
    if (!bookDetails.publisher) {
        const publisherFromInfo = $('[data-testid="publicationInfo"]').parent().find('a[href*="/publisher/"]').text().trim();
        if (publisherFromInfo) {
            bookDetails.publisher = publisherFromInfo;
        }
    }

    // Genres
    if (bookDetails.genres.length === 0) { // Only run if not populated by NEXT_DATA
        $('.BookPageMetadataSection__genres .Button__labelItem').each((i, el) => {
          bookDetails.genres.push($(el).text().trim());
        });
        // Remove "Show all genres" if present
        bookDetails.genres = bookDetails.genres.filter(genre => genre !== 'Show all genres' && genre !== '...more');
    }

    // Ratings
    const ratingsText = $('[data-testid="ratingsCount"]').text().trim();
    const ratingsMatch = ratingsText.match(/([\d,]+)/); // Extract numbers
    bookDetails.ratings = ratingsMatch ? ratingsMatch[1].replace(/,/g, '') : "0";

    let avgRating = $('.RatingStatistics__rating').text().trim();
    if (!avgRating) { // Fallback to data-testid
        avgRating = $('[data-testid="ratingValue"]').text().trim();
    }
    // Extract the first valid float-like number (e.g., 4.14 from "4.14" or "4.14 avg rating" or "Average rating 4.14")
    // More robust regex to find a float, even if surrounded by other text or duplicated.
    const avgRatingMatch = avgRating.match(/(\d{1,2}\.\d{1,2})/);
    if (avgRatingMatch && avgRatingMatch[0]) { // Use index 0 for the full match if only one group
        bookDetails.averageRating = avgRatingMatch[0];
    } else {
        bookDetails.averageRating = avgRating; // Fallback to the original text
    }

    // Number of Pages, Language, Series, Characters from "Book Details" section
    // Initialize if null (might have been set by NEXT_DATA)
    if (bookDetails.numberOfPages === null) bookDetails.numberOfPages = null;
    if (bookDetails.language === null) bookDetails.language = null;
    if (bookDetails.seriesName === null) bookDetails.seriesName = null;
    if (bookDetails.positionInSeries === null) bookDetails.positionInSeries = null;
    if (bookDetails.characters.length === 0) bookDetails.characters = [];

    let detailsFoundBySelectors = false; // Renamed from detailsFound to avoid conflict

    // Attempt to parse JSON-LD for structured data (like language, pages etc.)
    const ldJsonScript = $('script[type="application/ld+json"]');
    if (ldJsonScript.length > 0) {
        try {
            const jsonData = JSON.parse(ldJsonScript.html());
            if (jsonData) {
                if (jsonData.inLanguage && !bookDetails.language) { // Only set if not already from NEXT_DATA
                    bookDetails.language = jsonData.inLanguage;
                    detailsFoundBySelectors = true;
                }
                if (jsonData.numberOfPages && !bookDetails.numberOfPages) { // Only set if not already from NEXT_DATA
                    bookDetails.numberOfPages = parseInt(jsonData.numberOfPages, 10);
                    detailsFoundBySelectors = true;
                }
                // Extract author if not already found
                if (bookDetails.authors.length === 0 && jsonData.author) {
                    if (typeof jsonData.author === 'string') {
                        bookDetails.authors.push(jsonData.author);
                    } else if (typeof jsonData.author === 'object' && jsonData.author.name) {
                        bookDetails.authors.push(jsonData.author.name);
                    } else if (Array.isArray(jsonData.author)) {
                        // Process all authors in the array
                        jsonData.author.forEach(author => {
                            if (typeof author === 'string' && !bookDetails.authors.includes(author)) {
                                bookDetails.authors.push(author);
                            } else if (typeof author === 'object' && author.name && !bookDetails.authors.includes(author.name)) {
                                bookDetails.authors.push(author.name);
                            }
                        });
                    }
                }
                // Could also be a source for: jsonData.name, jsonData.image, jsonData.bookFormat
                // jsonData.author, jsonData.aggregateRating.ratingValue, jsonData.aggregateRating.ratingCount
            }
        } catch (e) {
            // console.error("Error parsing JSON-LD: ", e.message);
            // Silently ignore if JSON-LD is malformed or not found as expected
        }
    }

    // Log the HTML of potential details sections for debugging
    const keyDetailsHTML = $('div[data-testid="KeyDetails"]').html();
    // console.log("--- KeyDetails HTML ---");
    // console.log(keyDetailsHTML ? keyDetailsHTML.substring(0, 1000) : "KeyDetails not found or empty."); // Log first 1000 chars

    const featuredDetailsContainer = $('.BookDetails .FeaturedDetails');
    // console.log("--- FeaturedDetails HTML ---");
    // console.log(featuredDetailsContainer.length ? featuredDetailsContainer.html().substring(0,1000) : "FeaturedDetails not found or empty.");

    // Attempt 1: Using [data-testid="KeyDetails"] - We know this is not found for the test URL, but keep for other books
    if (!bookDetails.numberOfPages || !bookDetails.language || bookDetails.characters.length === 0 || !bookDetails.publisher) {
        $('div[data-testid="KeyDetails"] .DetailsLayoutRightItem__label').each((i, el) => {
            detailsFoundBySelectors = true; 
            const label = $(el).text().trim().toLowerCase();
            const valueElement = $(el).next('.DetailsLayoutRightItem__value');
            let valueText = valueElement.text().trim();

            // Goodreads sometimes puts extra info or links like "(first published ...)" or "...more"
            // We try to get the primary text before such additions.
            if (valueElement.find('.Button').length > 0) { // if there is a button like "...more"
                valueText = valueElement.clone().children().remove().end().text().trim();
            }

            if (label.includes('pages') && !bookDetails.numberOfPages) {
                const pagesMatch = valueText.match(/(\d+)/);
                if (pagesMatch && pagesMatch[1]) {
                    bookDetails.numberOfPages = parseInt(pagesMatch[1], 10);
                }
            } else if (label.includes('language') && !bookDetails.language) {
                bookDetails.language = valueText;
            } else if (label.includes('series')) { // Series not typically in NEXT_DATA, so always try
                const seriesAnchor = valueElement.find('a[href*="/series/"]');
                if (seriesAnchor.length > 0) {
                    const seriesFullText = seriesAnchor.text().trim();
                    // Regex to capture: Series Name (#Number) or Series Name
                    const seriesMatch = seriesFullText.match(/^(.*?)(?:\s*\(#([\d.]+)\))?$/);
                    if (seriesMatch && seriesMatch[1]) {
                        bookDetails.seriesName = seriesMatch[1].trim();
                        if (seriesMatch[2]) {
                            bookDetails.positionInSeries = seriesMatch[2];
                        }
                    }
                }
            } else if (label.includes('characters') && bookDetails.characters.length === 0) {
                // Improved character extraction
                console.log("Found characters label in KeyDetails");
                valueElement.find('a[href*="/characters/"]').each((idx, charEl) => {
                    const charName = $(charEl).text().trim();
                    if (charName) {
                        bookDetails.characters.push(charName);
                        console.log("Added character from KeyDetails:", charName);
                    }
                });
            }
            if (label.includes('publisher') && !bookDetails.publisher) {
                 // The value might contain "Published by XYZ" or just "XYZ"
                bookDetails.publisher = valueText.replace(/^Published by\s+/i, '').trim();
            }
        });
    }

    // Attempt 2: Parsing FeaturedDetails based on the new understanding (p tags with data-testid)
    if (featuredDetailsContainer.length > 0 && (!bookDetails.numberOfPages /* other checks if needed */)) {
        featuredDetailsContainer.find('p[data-testid]').each((i, el) => {
            const pElement = $(el);
            const testId = pElement.attr('data-testid');
            const textContent = pElement.text().trim();

            if (testId === 'pagesFormat' && !bookDetails.numberOfPages) {
                const pagesMatch = textContent.match(/(\d+)\s*pages/i);
                if (pagesMatch && pagesMatch[1]) {
                    bookDetails.numberOfPages = parseInt(pagesMatch[1], 10);
                    detailsFoundBySelectors = true;
                }
            } else if (testId === 'ISBN') { 
                // Potentially parse ISBN for other details if needed in future
                // e.g. if bookDetails.isbn is not set from __NEXT_DATA__
                // THIS BLOCK IS NOW MOOT as ISBN is removed
            }
            // Add other data-testid checks here if discovered for language, etc.
        });

        // Fallback for older structure if specific data-testids are not present but dt/dd are
        if (!bookDetails.numberOfPages && !bookDetails.language && featuredDetailsContainer.length > 0) { // Added featuredDetailsContainer.length check
            featuredDetailsContainer.find('dt').each((i, el) => {
                const labelText = $(el).text().trim().toLowerCase();
                const detailText = $(el).next('dd').text().trim();

                if (labelText.includes('pages') && !bookDetails.numberOfPages) {
                    const pagesMatch = detailText.match(/(\d+)/);
                    if (pagesMatch && pagesMatch[1]) {
                        bookDetails.numberOfPages = parseInt(pagesMatch[1], 10);
                        detailsFoundBySelectors = true;
                    }
                } else if (labelText.includes('language') && !bookDetails.language) {
                    bookDetails.language = detailText;
                    detailsFoundBySelectors = true;
                } else if (labelText.includes('series') && !bookDetails.seriesName) {
                    const seriesAnchor = $(el).next('dd').find('a[href*="/series/"]');
                     if (seriesAnchor.length > 0) {
                        const seriesFullText = seriesAnchor.text().trim();
                        const seriesMatch = seriesFullText.match(/^(.*?)(?:\s*\(#([\d.]+)\))?$/);
                        if (seriesMatch && seriesMatch[1]) {
                            bookDetails.seriesName = seriesMatch[1].trim();
                            if (seriesMatch[2]) {
                                bookDetails.positionInSeries = seriesMatch[2];
                            }
                            detailsFoundBySelectors = true;
                        }
                    }
                } else if (labelText.includes('characters') && bookDetails.characters.length === 0) {
                    $(el).next('dd').find('a[href*="/characters/"]').each((idx, charEl) => {
                        const charName = $(charEl).text().trim();
                        if (charName) {
                            bookDetails.characters.push(charName);
                            detailsFoundBySelectors = true; // Mark found
                        }
                    });
                } else if (labelText.includes('publisher') && !bookDetails.publisher) {
                    bookDetails.publisher = detailText.replace(/^Published by\s+/i, '').trim();
                    detailsFoundBySelectors = true; // Mark found
                }
            });
        }
    }

    // Final check for series details if not found by KeyDetails or other means
    if (!bookDetails.seriesName) {
        // Attempt 1: Selector that might have been user-provided or specific
        const seriesElementUser = $('.Text__subdued.Text__regular.Text__italic.Text__title3.Text > a[href*="/series/"]').first();
        if (seriesElementUser.length > 0) {
            const seriesText = seriesElementUser.text().trim();
            // Updated regex to capture more complex position formats
            const match = seriesText.match(/^(.*?)(?:[\s#]+([0-9.,\-]+))?$/);
            if (match && match[1]) {
                bookDetails.seriesName = match[1].trim();
                if (match[2]) {
                    bookDetails.positionInSeries = match[2].replace(/^#/, '').trim();
                }
                // Clean up common patterns like "(Series #X)" from the name if position is found
                if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`(#${bookDetails.positionInSeries})`)) {
                    bookDetails.seriesName = bookDetails.seriesName.replace(`(#${bookDetails.positionInSeries})`, '').trim();
                } else if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`#${bookDetails.positionInSeries}`)) {
                     bookDetails.seriesName = bookDetails.seriesName.replace(`#${bookDetails.positionInSeries}`, '').trim();
                }
                detailsFoundBySelectors = true; 
            }
        }

        // Attempt 2: FeaturedDetails selector (if first attempt failed)
        if (!bookDetails.seriesName) {
            const seriesLinkFeatured = $('.BookDetails .FeaturedDetails a[href*="/series/"]');
            if (seriesLinkFeatured.length > 0) {
                const seriesFullText = seriesLinkFeatured.first().text().trim();
                // Updated regex to capture more complex position formats
                const seriesMatch = seriesFullText.match(/^(.*?)(?:[\s#]+([0-9.,\-]+))?$/);
                if (seriesMatch && seriesMatch[1]) {
                    bookDetails.seriesName = seriesMatch[1].trim();
                    if (seriesMatch[2]) {
                        bookDetails.positionInSeries = seriesMatch[2].replace(/^#/, '').trim();
                    }
                     // Clean up common patterns
                    if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`(#${bookDetails.positionInSeries})`)) {
                        bookDetails.seriesName = bookDetails.seriesName.replace(`(#${bookDetails.positionInSeries})`, '').trim();
                    } else if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`#${bookDetails.positionInSeries}`)) {
                         bookDetails.seriesName = bookDetails.seriesName.replace(`#${bookDetails.positionInSeries}`, '').trim();
                    }
                    detailsFoundBySelectors = true;
                }
            }
        }
        
        // Attempt 3: Broader fallback (if previous attempts failed)
        if (!bookDetails.seriesName) {
            const seriesLinkGeneric = $('a[href*="/series/"][id*="bookSeries"]'); // Generic selector
            if (seriesLinkGeneric.length > 0) {
                const seriesText = seriesLinkGeneric.first().text().trim();
                // Updated regex to capture more complex position formats
                const match = seriesText.match(/^(.*?)(?:[\s#]+([0-9.,\-]+))?$/);
                if (match && match[1]) {
                    bookDetails.seriesName = match[1].trim();
                    if (match[2]) {
                        bookDetails.positionInSeries = match[2].replace(/^#/, '').trim();
                    }
                    // Clean up common patterns
                    if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`(#${bookDetails.positionInSeries})`)) {
                        bookDetails.seriesName = bookDetails.seriesName.replace(`(#${bookDetails.positionInSeries})`, '').trim();
                    } else if (bookDetails.positionInSeries && bookDetails.seriesName.includes(`#${bookDetails.positionInSeries}`)) {
                         bookDetails.seriesName = bookDetails.seriesName.replace(`#${bookDetails.positionInSeries}`, '').trim();
                    }
                    detailsFoundBySelectors = true;
                }
            }
        }
         // Further clean up if series name still has (#...) at the end after all attempts.
         if (bookDetails.seriesName && bookDetails.positionInSeries) {
            bookDetails.seriesName = bookDetails.seriesName.replace(new RegExp(`\s*\(#${bookDetails.positionInSeries}\)$`), '').trim();
            bookDetails.seriesName = bookDetails.seriesName.replace(new RegExp(`\s*#${bookDetails.positionInSeries}$`), '').trim();
         }
    }

    // Special handling for series with numbers in the name
    if (bookDetails.seriesName && !bookDetails.positionInSeries) {
        // Check for patterns like "Series Name #X" or "Series Name #X,Y"
        const numberMatch = bookDetails.seriesName.match(/#([0-9.,\-]+)$/);
        if (numberMatch && numberMatch[1]) {
            bookDetails.positionInSeries = numberMatch[1];
            // Remove the position from the series name
            bookDetails.seriesName = bookDetails.seriesName.replace(/#[0-9.,\-]+$/, '').trim();
        }
    }

    // Clean up empty character arrays
    if (bookDetails.characters && bookDetails.characters.length === 0) {
        // Keep it as an empty array, or set to null based on preference. Empty array is often better.
    }
    
    // Clean up series name - remove words like "ভলিউম" (Volume) and extract position properly
    if (bookDetails.seriesName) {
        // List of words to ignore in series names (can be expanded as needed)
        const ignoreWords = ['ভলিউম'];
        
        // Remove ignore words from series name
        let cleanedSeriesName = bookDetails.seriesName;
        ignoreWords.forEach(word => {
            cleanedSeriesName = cleanedSeriesName.replace(new RegExp(`\\s*${word}\\s*`, 'gi'), ' ');
        });
        
        // Extract position if it's in the format like "#1/1" or "1/1"
        const positionMatch = cleanedSeriesName.match(/(#?\s*)([\d\/\.\-]+)$/);
        if (positionMatch && positionMatch[2]) {
            if (!bookDetails.positionInSeries) {
                bookDetails.positionInSeries = positionMatch[2].trim();
            }
            // Remove the position part from the series name
            cleanedSeriesName = cleanedSeriesName.replace(/(#?\s*)([\d\/\.\-]+)$/, '').trim();
        }
        
        bookDetails.seriesName = cleanedSeriesName.trim();
    }
    
    // Format positionInSeries to add spaces after commas
    if (bookDetails.positionInSeries) {
        // Replace commas with comma+space
        bookDetails.positionInSeries = bookDetails.positionInSeries.replace(/,/g, ', ');
    }
    
    // Output as formatted JSON to preserve line breaks
    console.log(JSON.stringify(bookDetails, null, 2));
    return bookDetails;

  } catch (error) {
    console.error('Error scraping Goodreads:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      // console.error('Headers:', error.response.headers);
      // console.error('Data:', error.response.data); // Be careful logging full HTML data
    }
    return null;
  }
}

/**
 * Scrape book details from a Goodreads URL
 * 
 * @param {string} url - The Goodreads book URL to scrape
 * @returns {Promise<Object>} - A promise that resolves to a book details object with the following properties:
 *   @property {string} bookName - The name of the book
 *   @property {string[]} authors - An array of author names
 *   @property {string} imageUrl - URL to the book cover image
 *   @property {string} bookSummary - Summary/description of the book
 *   @property {string} publicationDate - Publication date of the book
 *   @property {string} publisher - Publisher of the book
 *   @property {string[]} genres - Array of genres the book belongs to
 *   @property {string} ratings - Number of ratings
 *   @property {string} averageRating - Average rating score
 *   @property {number} numberOfPages - Number of pages in the book
 *   @property {string} language - Language of the book
 *   @property {string} seriesName - Name of the series the book belongs to (if applicable)
 *   @property {string} positionInSeries - Position in the series (if applicable)
 *   @property {string[]} characters - Array of character names in the book
 */
module.exports = { scrapeGoodreads }; 