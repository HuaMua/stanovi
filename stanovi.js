const entriesDiv = document.getElementById('entries');
const title = document.getElementById('title');
const status = document.getElementById('status');

// JSONBin.io configuration with fallback support
// Primary bin switches to fallback when >= 90KB (reserves space for comments)
// The app loads from both bins and merges the results
const API_KEY = '$2a$10$S0dGVfegNTRBt2VRn91SNOImoGkyfcc8nfF1BtPfbnAXRjAyieFKi';
const PRIMARY_BIN_ID = '686644268a456b7966ba8958';    // Original bin (full)
const FALLBACK_BIN_ID = '68b409ebae596e708fdd9573';   // New bin for overflow
const CONFIG_BIN_ID = '68b6d4e643b1c97be9345921';     // Frontend config bin
const DELETED_BIN_ID = '68b6e611ae596e708fe02006';    // Deleted entries tracking
const API_BASE = 'https://api.jsonbin.io/v3/b';

let entries = [];
let config = { notifications: { toggle: true } }; // Default config
let isLoading = false;
let isSaving = false;
let statusTimeout = null;

// Function to check if notifications are disabled
function areNotificationsDisabled() {
    return !config.notifications || !config.notifications.toggle;
}

// Image modal variables
let currentImages = [];
let currentImageIndex = 0;

// Track new entries added
let newEntriesCount = 0;
let newEntryIndices = new Set(); // Track indices of new entries for green border

function formatDate(dateString) {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function getCurrentDateString() {
    return new Date().toISOString();
}

function setStatus(message, className = '', autoClear = false) {
    if (statusTimeout) {
        clearTimeout(statusTimeout);
    }

    status.textContent = message;
    status.className = className;

    if (autoClear && message) {
        statusTimeout = setTimeout(() => {
            status.textContent = '';
            status.className = '';
        }, 2000);
    }
}



async function loadData() {
    if (isLoading) return;
    isLoading = true;
    setStatus('Učitava...', 'loading', false);

    // Show spinner and hide filtering panel
    const spinner = document.getElementById('loading-spinner');
    const filteringPanel = document.getElementById('filtering-panel');
    if (spinner) {
        spinner.style.display = 'flex';
    }
    if (filteringPanel) {
        filteringPanel.style.display = 'none';
    }

    try {
        // Function to load entries from a specific bin
        async function loadFromBin(binId) {
            const response = await fetch(`${API_BASE}/${binId}`, {
                method: 'GET',
                headers: {
                    'X-Master-Key': API_KEY
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.record || [];
        }

        // Load from both bins in parallel
        console.log('Loading entries from both bins...');
        const [primaryResult, fallbackResult] = await Promise.allSettled([
            loadFromBin(PRIMARY_BIN_ID),
            loadFromBin(FALLBACK_BIN_ID)
        ]);

        // Combine entries from both bins
        let allEntries = [];

        if (primaryResult.status === 'fulfilled') {
            allEntries = allEntries.concat(primaryResult.value);
            console.log(`Loaded ${primaryResult.value.length} entries from primary bin`);
        } else {
            console.warn('Failed to load from primary bin:', primaryResult.reason);
        }

        if (fallbackResult.status === 'fulfilled') {
            allEntries = allEntries.concat(fallbackResult.value);
            console.log(`Loaded ${fallbackResult.value.length} entries from fallback bin`);
        } else {
            console.warn('Failed to load from fallback bin:', fallbackResult.reason);
        }

        // Remove duplicates based on URL (in case same entry exists in both bins)
        const uniqueEntries = [];
        const seenUrls = new Set();

        for (const entry of allEntries) {
            if (entry && Object.keys(entry).length > 0 && (entry.url || entry.title)) {
                if (entry.url && seenUrls.has(entry.url)) {
                    console.log('Skipping duplicate entry:', entry.url);
                    continue;
                }
                if (entry.url) {
                    seenUrls.add(entry.url);
                }
                uniqueEntries.push(entry);
            }
        }

        entries = uniqueEntries;

        // Clear new entry tracking on initial load
        newEntryIndices.clear();
        newEntriesCount = 0;

        saveEntriesToDOM();
        updateTitle();

        // Highlight entry from hash after rendering is complete
        setTimeout(highlightEntryFromHash, 100);

        // Create informative status message
        // Log detailed loading information to console
        const primaryCount = primaryResult.status === 'fulfilled' ? primaryResult.value.length : 0;
        const fallbackCount = fallbackResult.status === 'fulfilled' ? fallbackResult.value.length : 0;
        const duplicatesRemoved = allEntries.length - uniqueEntries.length;

        let consoleMessage = `Učitano ${entries.length} stavki`;
        if (primaryCount > 0 && fallbackCount > 0) {
            consoleMessage += ` (${primaryCount} + ${fallbackCount} iz 2 baze`;
            if (duplicatesRemoved > 0) {
                consoleMessage += `, ${duplicatesRemoved} duplikata uklonjeno`;
            }
            consoleMessage += ')';
        } else if (primaryCount > 0) {
            consoleMessage += ` (glavna baza)`;
        } else if (fallbackCount > 0) {
            consoleMessage += ` (rezervna baza)`;
        }

        console.log(consoleMessage);
        // Don't override status here, let updateTitle handle it
    } catch (error) {
        console.error('Error loading data:', error);
        setStatus('Nije uspjelo, pokusaj opet', 'error');
        entries = []; // Initialize with empty array on error
        saveEntriesToDOM();
        updateTitle();
    } finally {
        isLoading = false;

        // Hide spinner and show filtering panel
        const spinner = document.getElementById('loading-spinner');
        const filteringPanel = document.getElementById('filtering-panel');
        if (spinner) {
            spinner.style.display = 'none';
        }
        if (filteringPanel) {
            filteringPanel.style.display = 'block';
        }
    }
}

async function loadConfig() {
    try {
        console.log('Loading config from:', `${API_BASE}/${CONFIG_BIN_ID}/latest`);
        const response = await fetch(`${API_BASE}/${CONFIG_BIN_ID}/latest`, {
            headers: {
                'X-Master-Key': API_KEY
            }
        });

        if (response.ok) {
            const data = await response.json();
            let loadedConfig = data.record;

            // Handle case where JSONBin contains [{}] instead of proper object
            if (Array.isArray(loadedConfig) && loadedConfig.length > 0) {
                loadedConfig = loadedConfig[0];
            }

            // Ensure we have proper structure or use defaults
            if (!loadedConfig || typeof loadedConfig !== 'object' || Object.keys(loadedConfig).length === 0) {
                loadedConfig = { notifications: { toggle: true } };
            }

            // Ensure notifications object exists
            if (!loadedConfig.notifications) {
                loadedConfig.notifications = { toggle: true };
            }

            config = loadedConfig;
            console.log('Config loaded successfully:', config);

            // Update UI after config is loaded
            updateConfigUI();
        } else {
            console.error('Failed to load config. Status:', response.status, 'StatusText:', response.statusText);
            const errorText = await response.text();
            console.error('Error response:', errorText);
            console.log('Using default config:', config);

            // Update UI even with default config
            updateConfigUI();
        }
    } catch (error) {
        console.error('Error loading config:', error);
        console.log('Using default config:', config);

        // Update UI even with default config
        updateConfigUI();
    }
}

async function saveConfig() {
    try {
        console.log('Saving config:', config);
        const response = await fetch(`${API_BASE}/${CONFIG_BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': API_KEY
            },
            body: JSON.stringify(config)
        });

        if (response.ok) {
            const result = await response.json();
            console.log('Config saved successfully:', result);
        } else {
            console.error('Failed to save config. Status:', response.status, 'StatusText:', response.statusText);
            const errorText = await response.text();
            console.error('Error response:', errorText);
        }
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

async function trackDeletion(entry) {
    try {
        // Create deletion record with url, email, and title separated by &&
        const deletionRecord = `${entry.url || ''}&&${entry.email || ''}&&${entry.title || ''}`;

        // Load existing deletions
        let deletions = [];
        try {
            const response = await fetch(`${API_BASE}/${DELETED_BIN_ID}/latest`, {
                headers: {
                    'X-Master-Key': API_KEY
                }
            });

            if (response.ok) {
                const data = await response.json();
                deletions = data.record || [];
            }
        } catch (error) {
            console.warn('Could not load existing deletions, starting fresh:', error);
        }

        // Add new deletion record
        deletions.push(deletionRecord);

        // Save updated deletions
        const saveResponse = await fetch(`${API_BASE}/${DELETED_BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': API_KEY
            },
            body: JSON.stringify(deletions)
        });

        if (saveResponse.ok) {
            console.log('Deletion tracked successfully:', deletionRecord);
        } else {
            console.error('Failed to track deletion:', saveResponse.status);
        }
    } catch (error) {
        console.error('Error tracking deletion:', error);
    }
}

async function saveData() {
    if (isSaving) return;
    isSaving = true;
    setStatus('Čuva...', 'loading', false);

    try {
        // If no entries, save [{}] instead of empty array
        const dataToSave = entries.length === 0 ? [{}] : entries;

        const response = await fetch(`${API_BASE}/${PRIMARY_BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': API_KEY
            },
            body: JSON.stringify(dataToSave)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        setStatus('Automatski sačuvano');
    } catch (error) {
        console.error('Error saving data:', error);
        setStatus('Nije uspjelo, pokusaj opet', 'error');
    } finally {
        isSaving = false;
    }
}



function toggleComments(headerElement, contentId) {
    const content = document.getElementById(contentId);
    const arrow = headerElement.querySelector('.collapse-arrow');

    if (content.classList.contains('collapsed')) {
        // Expand
        const scrollHeight = content.scrollHeight;
        content.style.maxHeight = scrollHeight + 'px';
        content.classList.remove('collapsed');
        arrow.classList.remove('collapsed');
        console.log('Expanding comments:', contentId, 'to height:', scrollHeight);
    } else {
        // Collapse
        content.style.maxHeight = '0px';
        content.classList.add('collapsed');
        arrow.classList.add('collapsed');
        console.log('Collapsing comments:', contentId);
    }
}

function updateTitle() {
    // Keep title constant
    title.textContent = 'Stanovi';

    // Update status with count (no date)
    let statusText = '';
    if (newEntriesCount > 0) {
        statusText = `Podaci učitani (+${newEntriesCount} novih, ${entries.length} total)`;
    } else if (entries.length > 0) {
        statusText = `Podaci učitani (${entries.length} total)`;
    } else {
        statusText = 'Podaci učitani';
    }

    status.textContent = statusText;
    status.className = ''; // Remove loading class

    // Update stats info
    updateStatsInfo();
}

function updateStatsInfo() {
    const statsDiv = document.getElementById('stats-info');
    if (!statsDiv) return;

    // Only show duplicates info if there are any
    let statsText = '';
    const duplicates = findDuplicates();
    if (duplicates.length > 0) {
        statsText = `Duplikati: ${duplicates.length}`;

        // Create detailed duplicates info
        const duplicatesInfo = duplicates.map(dup =>
            `• ${dup.identifier} (${dup.count}x)`
        ).join(', ');

        statsText += ` (${duplicatesInfo})`;
    }

    statsDiv.textContent = statsText;
}

function findDuplicates() {
    const seen = {};
    const duplicates = [];

    entries.forEach(entry => {
        // Use URL as primary identifier, fall back to title
        let identifier = entry.url || entry.title || 'Unknown';

        // For PDF entries (no URL), use title
        if (!entry.url && entry.title) {
            identifier = entry.title;
        }

        // Clean up identifier for comparison
        identifier = identifier.trim();

        if (seen[identifier]) {
            seen[identifier].count++;
        } else {
            seen[identifier] = {
                identifier: identifier,
                count: 1,
                entries: [entry]
            };
        }
    });

    // Return only entries that appear more than once
    return Object.values(seen)
        .filter(item => item.count > 1)
        .map(item => ({
            identifier: item.identifier.length > 50 ?
                item.identifier.substring(0, 50) + '...' :
                item.identifier,
            count: item.count,
            fullIdentifier: item.identifier
        }));
}



function updateEntryModifiedDate(index) {
    entries[index].dateModified = getCurrentDateString();
}

function saveEntriesToDOM() {
    entriesDiv.innerHTML = '';
    // Display entries in reverse order (newest first) but keep original indices
    const reversedEntries = [...entries].reverse();

    reversedEntries.forEach((entry, reverseIndex) => {
        const index = entries.length - 1 - reverseIndex; // Get original index
        const wrapper = document.createElement('div');
        wrapper.className = 'entry';
        wrapper.dataset.entryIndex = index;

        // Add ID based on URL hash for anchor functionality
        const urlHash = generateUrlHash(entry.url);
        if (urlHash) {
            wrapper.id = urlHash;
        }

        // Add green border if this is a new entry
        if (newEntryIndices.has(index)) {
            wrapper.classList.add('new-entry');
        }

        // Date info (will be positioned later)
        const dateInfo = document.createElement('div');
        dateInfo.className = 'date-info';
        let dateText = '';
        if (entry.dateAdded) {
            dateText += formatDate(entry.dateAdded);
        }
        if (entry.dateModified && entry.dateModified !== entry.dateAdded) {
            dateText += ` | ${formatDate(entry.dateModified)}`;
        }
        dateInfo.textContent = dateText;

        // Links row: Separate title area and delete button
        const linksRow = document.createElement('div');
        linksRow.className = 'entry-links-row';
        linksRow.className = 'entry-links-container';

        // Copy URL button
        const copyBtn = document.createElement('button');
        copyBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
        `;
        copyBtn.className = 'map-link map-link-blue copy-link-btn';
        copyBtn.title = 'Copy link to entry';
        copyBtn.onclick = async (e) => {
            e.preventDefault();
            try {
                // Create URL with current location + entry anchor
                const currentUrl = window.location.origin + window.location.pathname;
                const entryUrl = urlHash ? `${currentUrl}#${urlHash}` : currentUrl;
                await navigator.clipboard.writeText(entryUrl);
                // Visual feedback
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '✓';
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                }, 1000);
            } catch (err) {
                console.error('Failed to copy URL:', err);
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                const currentUrl = window.location.origin + window.location.pathname;
                const entryUrl = urlHash ? `${currentUrl}#${urlHash}` : currentUrl;
                textArea.value = entryUrl;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);

                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '✓';
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                }, 1000);
            }
        };

        // Title and email container
        const titleContainer = document.createElement('div');
        titleContainer.className = 'entry-title-container';

        if (entry.url && entry.url.trim() !== '') {
            const titleLink = document.createElement('a');
            titleLink.textContent = entry.title || 'Bez naslova';
            titleLink.href = applyUrlReplacements(entry.url);
            titleLink.target = '_blank';
            titleLink.className = 'entry-title-link';
            titleContainer.appendChild(titleLink);


        } else {
            const titleSpan = document.createElement('span');
            titleSpan.textContent = `PDF: ${entry.title || 'Bez naslova'}`;
            titleSpan.className = 'entry-title-link';
            titleSpan.className = 'entry-title-span';
            titleContainer.appendChild(titleSpan);


        }

        // Add email title if available
        if (entry.emailTitle && entry.emailTitle.trim() !== '') {
            const emailTitleDiv = document.createElement('div');
            emailTitleDiv.className = 'entry-email-title';
            emailTitleDiv.textContent = `Email: ${entry.emailTitle}`;
            titleContainer.appendChild(emailTitleDiv);
        }

        // Delete button container
        const deleteContainer = document.createElement('div');
        deleteContainer.className = 'entry-delete-container';

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '×';
        deleteBtn.className = 'delete-btn icon-button';
        deleteBtn.onclick = async () => {
            const deletedEntry = entries[index];

            // Track deletion before removing from entries
            await trackDeletion(deletedEntry);

            entries.splice(index, 1);
            saveEntriesToDOM();
            updateTitle();
            // Save changes to remote storage
            await saveData();
        };

        deleteContainer.appendChild(deleteBtn);

        // Assemble the row
        linksRow.appendChild(copyBtn);
        linksRow.appendChild(titleContainer);
        linksRow.appendChild(deleteContainer);

        // Property Details Section
        const propertyDetails = document.createElement('div');
        propertyDetails.className = 'property-details';
        propertyDetails.className = 'entry-property-details';

        let detailsHTML = '<table class="property-details-table">';

        // Create address value with map links below it
        let addressValue = entry.address || '';
        if (entry.mapsMene || entry.mapsGrada) {
            addressValue += '<div class="map-links-container">';
            if (entry.mapsMene) {
                addressValue += `<a href="${entry.mapsMene}" target="_blank" class="map-link map-link-blue">Do Adisa</a>`;
            }
            if (entry.mapsGrada) {
                addressValue += `<a href="${entry.mapsGrada}" target="_blank" class="map-link map-link-blue">Do centra</a>`;
            }
            addressValue += '</div>';
        }

        const details = [
            { key: 'address', label: 'Adresa', value: addressValue },
            { key: 'flache', label: 'Površina', value: entry.flache },
            { key: 'zimmer', label: 'Sobe', value: entry.zimmer },
            { key: 'preis', label: 'Cijena', value: entry.preis },
            { key: 'monatlicheBelastung', label: 'BK', value: entry.monatlicheBelastung },
            { key: 'wohnflache', label: 'Površina', value: entry.wohnflache },
            { key: 'baujahr', label: 'Godina', value: entry.baujahr },
            { key: 'bauart', label: 'Tip', value: entry.bauart }
        ];

        // Show all columns, even if empty
        const visibleDetails = details;

        if (visibleDetails.length > 0) {
            // Header row with labels
            detailsHTML += '<tr class="property-details-row-header">';
            visibleDetails.forEach(detail => {
                detailsHTML += `<th class="property-details-header">${detail.label}</th>`;
            });
            detailsHTML += '</tr>';

            // Data row with values
            detailsHTML += '<tr class="property-details-row-data">';
            visibleDetails.forEach(detail => {
                const cellValue = detail.value || ''; // Handle empty/undefined values
                if (detail.key === 'address') {
                    // Address field with map links above the address text
                    detailsHTML += `<td class="property-details-cell">${cellValue}</td>`;
                } else {
                    // Escape HTML for other fields
                    detailsHTML += `<td class="property-details-cell">${cellValue}</td>`;
                }
            });
            detailsHTML += '</tr>';
        }

        detailsHTML += '</table>';
        propertyDetails.innerHTML = detailsHTML;

        // Add summary section below the table if summary exists
        if (entry.summary && entry.summary.trim() && entry.summary !== 'Sažetak nije dostupan' && entry.summary !== 'Greška pri generiranju sažetka') {
            const summaryDiv = document.createElement('div');
            summaryDiv.className = 'summary-container';
            summaryDiv.innerHTML = `<div class="summary-content">${entry.summary}</div>`;
            propertyDetails.appendChild(summaryDiv);
        }

        // Add image gallery if valid images exist
        const validImages = entry.images ? entry.images.filter(image =>
            image && (image.src || image.thumb) &&
            image.src !== 'undefined' && image.thumb !== 'undefined' &&
            image.src !== null && image.thumb !== null &&
            image.src !== '' && image.thumb !== ''
        ) : [];

        if (validImages.length > 0) {
            const galleryDiv = document.createElement('div');
            galleryDiv.className = 'entry-gallery-container';

            // Gallery header
            const galleryHeader = document.createElement('div');
            galleryHeader.className = 'entry-gallery-header';
            // Remove the header text - just create empty header for styling
            galleryHeader.textContent = '';
            galleryDiv.appendChild(galleryHeader);

            // Thumbnail container
            const thumbnailContainer = document.createElement('div');
            thumbnailContainer.className = 'entry-thumbnail-container';

            validImages.forEach((image, imgIndex) => {
                const thumbDiv = document.createElement('div');

                // Special styling for the special image (first one with isSpecial flag)
                const isSpecialImage = image.isSpecial === true;
                const borderColor = isSpecialImage ? '#007bff' : 'transparent';
                const borderWidth = isSpecialImage ? '3px' : '2px';

                thumbDiv.className = `entry-thumbnail-div ${isSpecialImage ? 'active' : ''}`;

                const thumbImg = document.createElement('img');
                thumbImg.src = image.thumb || image.src;
                thumbImg.className = 'entry-thumbnail-img';
                thumbImg.alt = `Slika ${imgIndex + 1}${isSpecialImage ? ' (Posebna)' : ''}`;

                // Add hover effect (different for special image)
                if (isSpecialImage) {
                    thumbDiv.onmouseenter = () => thumbDiv.style.borderColor = '#0056b3'; // Darker blue on hover
                    thumbDiv.onmouseleave = () => thumbDiv.style.borderColor = '#007bff'; // Return to blue
                } else {
                    thumbDiv.onmouseenter = () => thumbDiv.style.borderColor = '#007bff';
                    thumbDiv.onmouseleave = () => thumbDiv.style.borderColor = 'transparent';
                }

                // Add click handler to open modal (use original index in entry.images)
                const originalIndex = entry.images.indexOf(image);
                thumbDiv.onclick = () => openImageModal(entry.images, originalIndex, index);

                thumbDiv.appendChild(thumbImg);
                thumbnailContainer.appendChild(thumbDiv);
            });

            galleryDiv.appendChild(thumbnailContainer);
            propertyDetails.appendChild(galleryDiv);
        }

        // Adis Box
        const adisBox = document.createElement('div');
        adisBox.className = 'person-box adis';

        const hasAdisComments = (entry.evaluation && entry.evaluation.Adis && entry.evaluation.Adis.comment && entry.evaluation.Adis.comment.trim());
        const adisRating = (entry.evaluation && entry.evaluation.Adis && entry.evaluation.Adis.rating) || 0;
        const adisComment = (entry.evaluation && entry.evaluation.Adis && entry.evaluation.Adis.comment) || '';

        adisBox.innerHTML = `
                    <div class="person-header person-header-container" onclick="toggleComments(this, 'adis-comments-${index}')">
                        <div class="person-info-container">
                            <span class="collapse-arrow collapsed collapse-arrow-js ${hasAdisComments ? 'has-comment' : ''}">▼</span>
                            <span class="person-name ${hasAdisComments ? 'has-comment' : ''}">Adis</span>
                        </div>
                        <div class="rating-buttons rating-buttons-container">
                            ${[1, 2, 3, 4, 5].map(i =>
            `<button class="rating-btn ${i <= adisRating ? 'selected' : ''}" data-rating="${i}" onclick="event.stopPropagation()">★</button>`
        ).join('')}
                        </div>
                    </div>
                    <div id="adis-comments-${index}" class="comment-row collapsible-content collapsed comments-collapsible">
                        <div class="comment-group" style="width: 100%;">
                            <textarea class="comment-input" data-entry-index="${index}" data-field="evaluation.Adis.comment" style="width: 97%;">${adisComment}</textarea>
                        </div>
                    </div>
                `;

        // Add event listeners for Adis rating buttons
        const adisRatingButtons = adisBox.querySelectorAll('.rating-buttons .rating-btn');
        adisRatingButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering toggle
                const clickedRating = parseInt(btn.dataset.rating);

                // Remove all selected classes
                adisRatingButtons.forEach(b => b.classList.remove('selected'));

                // Add selected class to all stars up to and including clicked star
                adisRatingButtons.forEach((b, i) => {
                    if (i + 1 <= clickedRating) {
                        b.classList.add('selected');
                    }
                });

                // Initialize evaluation structure if needed
                if (!entries[index].evaluation) entries[index].evaluation = {};
                if (!entries[index].evaluation.Adis) entries[index].evaluation.Adis = {};

                const oldRating = entries[index].evaluation.Adis.rating;
                const newRating = clickedRating;
                entries[index].evaluation.Adis.rating = newRating;
                updateEntryModifiedDate(index);
                // Auto-save when rating changes
                await saveData();
                // Send notification only if rating actually changed
                if (oldRating !== newRating && !areNotificationsDisabled()) {
                    await sendCommentRatingNotification(index, 'rating', 'Adis', null, newRating);
                }
            });
        });

        // Add event listeners for Adis comment textareas
        const adisCommentTextareas = adisBox.querySelectorAll('textarea[data-field]');
        adisCommentTextareas.forEach(textarea => {
            let saveTimeout;
            let notificationTimeout;
            const originalValue = textarea.value;

            textarea.addEventListener('input', () => {
                const field = textarea.dataset.field;
                const newValue = textarea.value;
                entries[index][field] = newValue;
                updateEntryModifiedDate(index);

                // Debounced auto-save (wait 2 seconds after last change)
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    await saveData();
                }, 2000);

                // Debounced notification (wait 3 seconds after last change)
                clearTimeout(notificationTimeout);
                notificationTimeout = setTimeout(async () => {
                    // Only send notification if there's actual content and it changed from original
                    if (newValue.trim() && newValue.trim() !== originalValue.trim() && !areNotificationsDisabled()) {
                        await sendCommentRatingNotification(index, 'comment', 'Adis', field);
                    }
                }, 3000);
            });
        });

        // Roditelji Box
        const roditeljiBox = document.createElement('div');
        roditeljiBox.className = 'person-box roditelji';

        const hasRoditeljiComments = (entry.evaluation && entry.evaluation['Camila i Salih'] && entry.evaluation['Camila i Salih'].comment && entry.evaluation['Camila i Salih'].comment.trim());
        const roditeljiRating = (entry.evaluation && entry.evaluation['Camila i Salih'] && entry.evaluation['Camila i Salih'].rating) || 0;
        const roditeljiComment = (entry.evaluation && entry.evaluation['Camila i Salih'] && entry.evaluation['Camila i Salih'].comment) || '';

        roditeljiBox.innerHTML = `
                    <div class="person-header person-header-container" onclick="toggleComments(this, 'roditelji-comments-${index}')">
                        <div class="person-info-container">
                            <span class="collapse-arrow collapsed collapse-arrow-js ${hasRoditeljiComments ? 'has-comment' : ''}">▼</span>
                            <span class="person-name ${hasRoditeljiComments ? 'has-comment' : ''}">Camila i Salih</span>
                        </div>
                        <div class="rating-buttons rating-buttons-container" data-entry-index="${index}">
                            ${[1, 2, 3, 4, 5].map(i =>
            `<button class="rating-btn ${i <= roditeljiRating ? 'selected' : ''}" data-rating="${i}" onclick="event.stopPropagation()">★</button>`
        ).join('')}
                        </div>
                    </div>
                    <div id="roditelji-comments-${index}" class="comment-row collapsible-content collapsed comments-collapsible">
                        <div class="comment-group" style="width: 100%;">
                            <textarea class="comment-input" data-entry-index="${index}" data-field="evaluation.Camila i Salih.comment" style="width: 97%;">${roditeljiComment}</textarea>
                        </div>
                    </div>
                `;

        // Add event listeners for Roditelji rating buttons
        const ratingButtons = roditeljiBox.querySelectorAll('.rating-buttons .rating-btn');
        ratingButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering toggle
                const clickedRating = parseInt(btn.dataset.rating);

                // Remove all selected classes
                ratingButtons.forEach(b => b.classList.remove('selected'));

                // Add selected class to all stars up to and including clicked star
                ratingButtons.forEach((b, i) => {
                    if (i + 1 <= clickedRating) {
                        b.classList.add('selected');
                    }
                });

                // Initialize evaluation structure if needed
                if (!entries[index].evaluation) entries[index].evaluation = {};
                if (!entries[index].evaluation['Camila i Salih']) entries[index].evaluation['Camila i Salih'] = {};

                const oldRating = entries[index].evaluation['Camila i Salih'].rating;
                const newRating = clickedRating;
                entries[index].evaluation['Camila i Salih'].rating = newRating;
                updateEntryModifiedDate(index);
                // Auto-save when rating changes
                await saveData();
                // Send ntfy notification
                if (!areNotificationsDisabled()) {
                    await sendCommentRatingNotification(index, 'rating', 'Roditelji', null, newRating);
                }
            });
        });

        // Add event listeners for Roditelji comment textareas
        const commentTextareas = roditeljiBox.querySelectorAll('textarea[data-field]');
        commentTextareas.forEach(textarea => {
            let saveTimeout;
            let notificationTimeout;
            textarea.addEventListener('input', () => {
                const field = textarea.dataset.field;
                entries[index][field] = textarea.value;
                updateEntryModifiedDate(index);

                // Debounced auto-save (wait 2 seconds after last change)
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    await saveData();
                }, 2000);

                // Debounced notification (wait 3 seconds after last change to avoid spam)
                clearTimeout(notificationTimeout);
                notificationTimeout = setTimeout(async () => {
                    if (textarea.value.trim() && !areNotificationsDisabled()) { // Only send notification if comment is not empty
                        await sendCommentRatingNotification(index, 'comment', 'Roditelji', field);
                    }
                }, 3000);
            });
        });

        if (dateText) {
            wrapper.appendChild(dateInfo);
        }
        wrapper.appendChild(linksRow);
        wrapper.appendChild(propertyDetails);
        wrapper.appendChild(adisBox);
        wrapper.appendChild(roditeljiBox);

        // Add Termin section
        const terminDiv = document.createElement('div');
        terminDiv.className = 'termin';
        terminDiv.className = 'entry-termin-container';

        // Checkbox for "Kontaktirao"
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'entry-checkbox-container';

        const kontaktiraoCheckbox = document.createElement('input');
        kontaktiraoCheckbox.type = 'checkbox';
        kontaktiraoCheckbox.id = `kontaktirao-${index}`;
        kontaktiraoCheckbox.checked = entry.kontaktirao || false;
        kontaktiraoCheckbox.className = 'entry-kontaktirao-checkbox';

        const kontaktiraoLabel = document.createElement('label');
        kontaktiraoLabel.htmlFor = `kontaktirao-${index}`;
        kontaktiraoLabel.textContent = 'Kontaktirao';
        kontaktiraoLabel.className = 'entry-kontaktirao-label';

        // Check if kontaktirao is overdue (checked but no termin set after some time)
        if (entry.kontaktirao && (!entry.termin || entry.termin.trim() === '')) {
            // If kontaktirao is checked but no termin is set, consider it overdue
            kontaktiraoLabel.classList.add('overdue');
        }

        checkboxContainer.appendChild(kontaktiraoLabel);
        checkboxContainer.appendChild(kontaktiraoCheckbox);

        // Date input for "Termin"
        const terminContainer = document.createElement('div');
        terminContainer.className = 'entry-termin-input-container';

        const terminLabel = document.createElement('label');
        terminLabel.htmlFor = `termin-${index}`;
        terminLabel.textContent = 'Termin';
        terminLabel.className = 'entry-termin-label';

        const terminInput = document.createElement('input');
        terminInput.type = 'datetime-local';
        terminInput.id = `termin-${index}`;
        terminInput.value = entry.termin || '';
        terminInput.className = 'entry-termin-input';

        // Set has-value class if termin has a value and check if overdue
        if (entry.termin && entry.termin.trim() !== '') {
            terminInput.classList.add('has-value');

            // Check if termin date has passed
            const terminDate = new Date(entry.termin);
            const now = new Date();
            if (terminDate < now) {
                terminInput.classList.add('overdue');
            }
        }

        terminContainer.appendChild(terminLabel);
        terminContainer.appendChild(terminInput);

        terminDiv.appendChild(checkboxContainer);
        terminDiv.appendChild(terminContainer);

        // Add event listeners for notifications
        kontaktiraoCheckbox.addEventListener('change', async () => {
            const oldValue = entries[index].kontaktirao;
            const newValue = kontaktiraoCheckbox.checked;
            entries[index].kontaktirao = newValue;
            updateEntryModifiedDate(index);
            await saveData();

            // Send notification if value changed
            if (oldValue !== newValue && !areNotificationsDisabled()) {
                const statusText = newValue ? 'kontaktirao agenta' : 'otkazao kontakt sa agentom';
                await sendContactTerminNotification(index, 'kontaktirao', statusText);
            }
        });

        terminInput.addEventListener('change', async () => {
            const oldValue = entries[index].termin;
            const newValue = terminInput.value;
            entries[index].termin = newValue;
            updateEntryModifiedDate(index);
            await saveData();

            // Update has-value class for glow effect and check if overdue
            if (newValue && newValue.trim() !== '') {
                terminInput.classList.add('has-value');

                // Check if termin date has passed
                const terminDate = new Date(newValue);
                const now = new Date();
                if (terminDate < now) {
                    terminInput.classList.add('overdue');
                } else {
                    terminInput.classList.remove('overdue');
                }
            } else {
                terminInput.classList.remove('has-value');
                terminInput.classList.remove('overdue');
            }

            // Send notification if value changed
            if (oldValue !== newValue && !areNotificationsDisabled()) {
                const statusText = newValue ? `zakazao termin za ${newValue}` : 'uklonio termin';
                await sendContactTerminNotification(index, 'termin', statusText);
            }
        });

        // Agent Comments Box with Kontaktirao and Termin in header
        const agentBox = document.createElement('div');
        agentBox.className = 'person-box agent';

        const hasAgentComments = (entry.agent_coms && entry.agent_coms.trim());

        // Create contact information HTML
        let contactInfo = '';
        if (entry.kontaktIme || entry.kontaktTelefon || entry.kontaktEmail || entry.kontaktKompanija) {
            if (entry.kontaktIme) {
                contactInfo += `<span class="contact-name">${entry.kontaktIme}</span>`;
            }
            if (entry.kontaktKompanija) {
                contactInfo += `<span class="contact-company">${entry.kontaktKompanija}</span>`;
            }
            if (entry.kontaktTelefon) {
                contactInfo += `<a href="tel:${entry.kontaktTelefon}" class="contact-link">📞 ${entry.kontaktTelefon}</a>`;
            }
            if (entry.kontaktEmail) {
                contactInfo += `<a href="mailto:${entry.kontaktEmail}" class="contact-link">✉️ ${entry.kontaktEmail}</a>`;
            }
        }

        agentBox.innerHTML = `
                    <div class="person-header person-header-container" onclick="toggleComments(this, 'agent-comments-${index}')">
                        <div class="person-info-container">
                            <span class="collapse-arrow collapsed collapse-arrow-js ${hasAgentComments ? 'has-comment' : ''}">▼</span>
                            <span class="person-name ${hasAgentComments ? 'has-comment' : ''}">Agent</span>
                        </div>
                        <div class="entry-termin-container" onclick="event.stopPropagation()">
                            <div class="entry-checkbox-container">
                                <label for="kontaktirao-${index}" class="entry-kontaktirao-label">Kontaktirao</label>
                                <input type="checkbox" id="kontaktirao-${index}" class="entry-kontaktirao-checkbox" ${entry.kontaktirao ? 'checked' : ''}>
                            </div>
                            <div class="entry-termin-input-container">
                                <label for="termin-${index}" class="entry-termin-label">Termin</label>
                                <input type="datetime-local" id="termin-${index}" value="${entry.termin || ''}" class="entry-termin-input ${entry.termin && entry.termin.trim() !== '' ? 'has-value' : ''} ${entry.termin && entry.termin.trim() !== '' && new Date(entry.termin) < new Date() ? 'overdue' : ''}" onclick="event.stopPropagation()">
                            </div>
                        </div>
                    </div>
                    <div id="agent-comments-${index}" class="comment-row collapsible-content collapsed comments-collapsible" style="display: flex; flex-direction: column; gap: var(--space-sm);">
                        ${contactInfo ? `<div class="contact-container">${contactInfo}</div>` : ''}
                        <div class="comment-group" style="width: 100%;">
                            <textarea class="comment-input" data-entry-index="${index}" data-field="agent_coms" style="width: 97%;">${entry.agent_coms || ''}</textarea>
                        </div>
                    </div>
                `;

        // Add event listeners for checkbox and termin input
        agentBox.addEventListener('change', async (e) => {
            if (e.target.classList.contains('entry-kontaktirao-checkbox')) {
                const oldValue = entries[index].kontaktirao;
                const newValue = e.target.checked;
                entries[index].kontaktirao = newValue;
                updateEntryModifiedDate(index);
                await saveData();

                if (oldValue !== newValue && !areNotificationsDisabled()) {
                    const statusText = newValue ? 'kontaktirao' : 'uklonio kontakt';
                    await sendContactTerminNotification(index, 'kontakt', statusText);
                }
            } else if (e.target.classList.contains('entry-termin-input')) {
                const oldValue = entries[index].termin;
                const newValue = e.target.value;
                entries[index].termin = newValue;
                updateEntryModifiedDate(index);
                await saveData();

                // Update has-value class for glow effect and check if overdue
                if (newValue && newValue.trim() !== '') {
                    e.target.classList.add('has-value');

                    // Check if termin date has passed
                    const terminDate = new Date(newValue);
                    const now = new Date();
                    if (terminDate < now) {
                        e.target.classList.add('overdue');
                    } else {
                        e.target.classList.remove('overdue');
                    }
                } else {
                    e.target.classList.remove('has-value');
                    e.target.classList.remove('overdue');
                }

                if (oldValue !== newValue && !areNotificationsDisabled()) {
                    const statusText = newValue ? `zakazao termin za ${newValue}` : 'uklonio termin';
                    await sendContactTerminNotification(index, 'termin', statusText);
                }
            }
        });

        wrapper.appendChild(agentBox);

        // Zaključak Box
        const zakljucakBox = document.createElement('div');
        zakljucakBox.className = 'person-box zakljucak';

        const hasZakljucakComments = entry.conclusion && entry.conclusion.trim();
        const zakljucakComment = entry.conclusion || '';

        zakljucakBox.innerHTML = `
                    <div class="person-header person-header-container" onclick="toggleComments(this, 'zakljucak-comments-${index}')">
                        <div class="person-info-container">
                            <span class="collapse-arrow collapsed collapse-arrow-js ${hasZakljucakComments ? 'has-comment' : ''}">▼</span>
                            <span class="person-name ${hasZakljucakComments ? 'has-comment' : ''}">Zaključak</span>
                        </div>
                    </div>
                    <div id="zakljucak-comments-${index}" class="comment-row collapsible-content collapsed comments-collapsible" style="display: flex; flex-direction: column; gap: var(--space-sm);">
                        <div class="comment-group" style="width: 100%;">
                            <textarea class="comment-input" data-entry-index="${index}" data-field="conclusion" style="width: 97%;">${zakljucakComment}</textarea>
                        </div>
                    </div>
                `;

        wrapper.appendChild(zakljucakBox);

        entriesDiv.appendChild(wrapper);
    });

    // Setup comment input listeners after DOM is created
    setupCommentListeners();
}

function setupCommentListeners() {
    // Handle all comment input changes
    document.querySelectorAll('.comment-input').forEach(input => {
        let saveTimeout;
        let notificationTimeout;

        input.addEventListener('input', async (e) => {
            const entryIndex = parseInt(e.target.dataset.entryIndex);
            const field = e.target.dataset.field;
            const newValue = e.target.value;

            let oldValue;
            let personType = '';

            // Handle nested evaluation fields
            if (field.startsWith('evaluation.')) {
                const parts = field.split('.');
                const personName = parts[1];
                const property = parts[2];

                // Initialize structure if needed
                if (!entries[entryIndex].evaluation) entries[entryIndex].evaluation = {};
                if (!entries[entryIndex].evaluation[personName]) entries[entryIndex].evaluation[personName] = {};

                oldValue = entries[entryIndex].evaluation[personName][property];
                entries[entryIndex].evaluation[personName][property] = newValue;

                // Determine person type for arrow update
                if (personName === 'Adis') personType = 'adis';
                else if (personName === 'Camila i Salih') personType = 'roditelji';
            } else if (field === 'agent_coms') {
                // Handle regular fields (like agent_coms)
                oldValue = entries[entryIndex][field];
                entries[entryIndex][field] = newValue;
                personType = 'agent';
            } else if (field === 'conclusion') {
                oldValue = entries[entryIndex][field];
                entries[entryIndex][field] = newValue;
                personType = 'zakljucak';
            }

            // Update collapse arrow and person name immediately
            if (personType) {
                const collapseArrow = document.querySelector(`#${personType}-comments-${entryIndex}`).previousElementSibling.querySelector('.collapse-arrow-js');
                const personName = document.querySelector(`#${personType}-comments-${entryIndex}`).previousElementSibling.querySelector('.person-name');

                if (collapseArrow) {
                    if (newValue && newValue.trim()) {
                        collapseArrow.classList.add('has-comment');
                    } else {
                        collapseArrow.classList.remove('has-comment');
                    }
                }

                if (personName) {
                    if (newValue && newValue.trim()) {
                        personName.classList.add('has-comment');
                    } else {
                        personName.classList.remove('has-comment');
                    }
                }
            }

            updateEntryModifiedDate(entryIndex);

            // Debounced auto-save (wait 2 seconds after last change)
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                await saveData();
            }, 2000);

            // Debounced notification (wait 3 seconds after last change to avoid spam)
            if (oldValue !== newValue) {
                clearTimeout(notificationTimeout);
                notificationTimeout = setTimeout(async () => {
                    let personName = '';
                    if (field.startsWith('evaluation.')) {
                        const parts = field.split('.');
                        personName = parts[1]; // 'Adis' or 'Camila i Salih'
                        if (personName === 'Camila i Salih') personName = 'Roditelji'; // For notification purposes
                    } else if (field === 'agent_coms') {
                        personName = 'Agent';
                    } else if (field === 'conclusion') {
                        personName = 'Zaključak';
                    }

                    if (personName && !areNotificationsDisabled()) {
                        await sendCommentRatingNotification(entryIndex, 'comment', personName, newValue);
                    }
                }, 3000);
            }
        });
    });
}

// Handle rating button clicks for Adis
document.querySelectorAll('#adis-rating .rating-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('#adis-rating .rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAdisRating = btn.dataset.rating;
    };
});

// Handle rating button clicks for Roditelji
document.querySelectorAll('#roditelji-rating .rating-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('#roditelji-rating .rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedRoditeljiRating = btn.dataset.rating;
    };
});



// Image modal functions
function openImageModal(images, startIndex, entryIndex) {
    currentImages = images;
    currentImageIndex = startIndex;

    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const imageCounter = document.getElementById('imageCounter');

    modalImage.src = images[startIndex].src;
    imageCounter.textContent = `${startIndex + 1} / ${images.length}`;

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto'; // Restore scrolling
}

function previousImage() {
    if (currentImages.length === 0) return;
    currentImageIndex = (currentImageIndex - 1 + currentImages.length) % currentImages.length;
    updateModalImage();
}

function nextImage() {
    if (currentImages.length === 0) return;
    currentImageIndex = (currentImageIndex + 1) % currentImages.length;
    updateModalImage();
}

function updateModalImage() {
    const modalImage = document.getElementById('modalImage');
    const imageCounter = document.getElementById('imageCounter');

    modalImage.src = currentImages[currentImageIndex].src;
    imageCounter.textContent = `${currentImageIndex + 1} / ${currentImages.length}`;
}

// Keyboard navigation for modal
document.addEventListener('keydown', function (e) {
    const modal = document.getElementById('imageModal');
    if (modal.style.display === 'block') {
        if (e.key === 'Escape') {
            closeImageModal();
        } else if (e.key === 'ArrowLeft') {
            previousImage();
        } else if (e.key === 'ArrowRight') {
            nextImage();
        }
    }
});

// Click outside image to close modal
document.getElementById('imageModal').addEventListener('click', function (e) {
    if (e.target === this) {
        closeImageModal();
    }
});

// Update functionality
async function updateData() {
    if (isLoading) return;

    const updateBtn = document.getElementById('update-btn');
    const originalText = updateBtn.textContent;
    const spinner = document.getElementById('loading-spinner');

    try {
        updateBtn.textContent = 'Učitava...';
        updateBtn.disabled = true;
        setStatus('Dohvaćam najnovije podatke...', 'loading');

        // Show spinner and hide filtering panel
        const filteringPanel = document.getElementById('filtering-panel');
        if (spinner) {
            spinner.style.display = 'flex';
        }
        if (filteringPanel) {
            filteringPanel.style.display = 'none';
        }

        const currentCount = entries.length;

        const response = await fetch(`${API_BASE}/${PRIMARY_BIN_ID}`, {
            method: 'GET',
            headers: {
                'X-Master-Key': API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let loadedEntries = data.record || [];

        // Filter out empty objects
        loadedEntries = loadedEntries.filter(entry => entry && Object.keys(entry).length > 0 && (entry.url || entry.title));

        // Calculate new entries added
        newEntriesCount = Math.max(0, loadedEntries.length - currentCount);

        // Track indices of new entries for green border styling
        newEntryIndices.clear();
        if (newEntriesCount > 0) {
            // New entries are at the end of the array (most recent)
            for (let i = currentCount; i < loadedEntries.length; i++) {
                newEntryIndices.add(i);
            }
        }

        entries = loadedEntries;
        saveEntriesToDOM();
        updateTitle();

        if (newEntriesCount > 0) {
            setStatus(`Učitano ${newEntriesCount} novih unosa`);

            // Clear green borders after 30 seconds
            setTimeout(() => {
                newEntryIndices.clear();
                saveEntriesToDOM(); // Re-render without green borders
            }, 30000);
        } else {
            setStatus('Nema novih unosa');
        }

    } catch (error) {
        console.error('Error updating data:', error);
        setStatus('Nije uspjelo, pokusaj opet', 'error');
    } finally {
        updateBtn.textContent = originalText;
        updateBtn.disabled = false;

        // Hide spinner and show filtering panel
        const filteringPanel = document.getElementById('filtering-panel');
        if (spinner) {
            spinner.style.display = 'none';
        }
        if (filteringPanel) {
            filteringPanel.style.display = 'block';
        }
    }
}

// Update button event listener
document.getElementById('update-btn').onclick = updateData;

// Auto-save functionality - no manual save button needed

// URL Replacement functionality
let urlReplacements = {};

// Load replacement mappings from localStorage
function loadUrlReplacements() {
    const saved = localStorage.getItem('urlReplacements');
    if (saved) {
        urlReplacements = JSON.parse(saved);
    }
}

// Save replacement mappings to localStorage
function saveUrlReplacements() {
    localStorage.setItem('urlReplacements', JSON.stringify(urlReplacements));
}

// Apply URL replacements to a URL string
function applyUrlReplacements(url) {
    let modifiedUrl = url;
    for (const [oldString, newString] of Object.entries(urlReplacements)) {
        if (oldString && newString) {
            modifiedUrl = modifiedUrl.replace(new RegExp(oldString, 'g'), newString);
        }
    }
    return modifiedUrl;
}

// Toggle URL replacement panel
function toggleUrlReplacementPanel() {
    const panel = document.getElementById('url-replacement-panel');
    panel.classList.toggle('show');

    // Load current values if panel is being shown
    if (panel.classList.contains('show')) {
        loadCurrentReplacementValues();
    }
}

// Load current replacement values into inputs
function loadCurrentReplacementValues() {
    const oldStringInput = document.getElementById('old-string');
    const newStringInput = document.getElementById('new-string');

    // Get the first replacement if any exists
    const entries = Object.entries(urlReplacements);
    if (entries.length > 0) {
        oldStringInput.value = entries[0][0];
        newStringInput.value = entries[0][1];
    }
}

// Save replacement on input change
function saveCurrentReplacement() {
    const oldString = document.getElementById('old-string').value.trim();
    const newString = document.getElementById('new-string').value.trim();

    // Clear all previous replacements and set new one
    urlReplacements = {};
    if (oldString) {
        urlReplacements[oldString] = newString;
    }

    saveUrlReplacements();

    // Re-render entries to apply new replacements
    saveEntriesToDOM();
}

// Event listeners for URL replacement
document.getElementById('title').onclick = toggleUrlReplacementPanel;
document.getElementById('old-string').onblur = saveCurrentReplacement;
document.getElementById('new-string').onblur = saveCurrentReplacement;

// Initialize URL replacements
loadUrlReplacements();

// Function to generate hash from URL
function generateUrlHash(url) {
    if (!url) return null;
    // Simple hash function using the URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return 'entry-' + Math.abs(hash).toString(16);
}

// Function to highlight entry based on URL hash
function highlightEntryFromHash() {
    const hash = window.location.hash.substring(1); // Remove the #
    if (hash) {
        // Remove existing highlights
        document.querySelectorAll('.entry.highlighted').forEach(el => {
            el.classList.remove('highlighted');
        });

        // Highlight the target entry
        const targetEntry = document.getElementById(hash);
        if (targetEntry) {
            targetEntry.classList.add('highlighted');
            targetEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Listen for hash changes
window.addEventListener('hashchange', highlightEntryFromHash);
window.addEventListener('load', () => {
    // Wait for entries to be loaded and rendered before highlighting
    setTimeout(highlightEntryFromHash, 500);
});

// NTFY.SH Notification System
let ntfyWebSocket = null;
let ntfyReconnectTimeout = null;
let ntfyReconnectAttempts = 0;
const maxReconnectAttempts = 5;

function updateNtfyStatus(text, connected = false) {
    const indicator = document.getElementById('ntfy-indicator');

    if (indicator) {
        indicator.textContent = connected ? '🟢' : '🔴';
    }
}

let notificationHistory = [];

// Function to convert URLs in text to clickable links
function makeLinksClickable(text) {
    // Regular expression to match URLs
    const urlRegex = /(https?:\/\/[^\s\n]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" class="auto-link">$1</a>');
}

function addToNotificationsList(title, message, type = 'info') {
    const notificationsList = document.getElementById('notifications-list');
    const timestamp = new Date().toLocaleTimeString('hr-HR');

    // Add to history
    notificationHistory.unshift({ title, message, type, timestamp });

    // Clear "no notifications" message
    const emptyMessage = notificationsList.querySelector('.notifications-empty');
    if (emptyMessage) {
        emptyMessage.remove();
    }

    const notificationItem = document.createElement('div');
    notificationItem.className = 'entry-notification-item';
    // Set border color based on type
    if (type === 'error') {
        notificationItem.style.borderLeftColor = '#f44336';
    } else if (type === 'warning') {
        notificationItem.style.borderLeftColor = '#ff9800';
    } else {
        notificationItem.style.borderLeftColor = '#4CAF50';
    }

    // Make links clickable in the message
    const processedMessage = makeLinksClickable(message);

    // Create delete button with trash icon
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
    `;
    deleteBtn.className = 'entry-notification-delete';

    // Add click handler to delete this notification
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Remove from DOM with animation
        notificationItem.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        notificationItem.style.opacity = '0';
        notificationItem.style.transform = 'translateX(100%)';

        setTimeout(() => {
            if (notificationItem.parentNode) {
                notificationItem.parentNode.removeChild(notificationItem);

                // Remove from history array
                const itemIndex = Array.from(notificationsList.children).indexOf(notificationItem);
                if (itemIndex >= 0 && itemIndex < notificationHistory.length) {
                    notificationHistory.splice(itemIndex, 1);
                }

                // Show "no notifications" message if list is empty
                if (notificationsList.children.length === 0) {
                    notificationsList.innerHTML = `
                                <div class="notifications-empty">
                                    Nema novih notifikacija
                                </div>
                            `;
                }
            }
        }, 300);
    });

    notificationItem.innerHTML = `
                <div class="notification-item-title">${title}</div>
                <div class="notification-item-content">${processedMessage}</div>
                <div class="notification-item-timestamp">${timestamp}</div>
            `;

    // Append delete button after setting innerHTML
    notificationItem.appendChild(deleteBtn);

    notificationsList.insertBefore(notificationItem, notificationsList.firstChild);

    // Limit to 50 notifications
    while (notificationsList.children.length > 50) {
        notificationsList.removeChild(notificationsList.lastChild);
        // Also remove from history
        if (notificationHistory.length > 50) {
            notificationHistory.splice(50);
        }
    }
}

function clearNotifications() {
    const notificationsList = document.getElementById('notifications-list');
    notificationsList.innerHTML = `
                <div class="notifications-empty">
                    Nema novih notifikacija
                </div>
            `;
    notificationHistory = [];
}

function showNtfyPopup(title, message, type = 'info') {
    // Only add to notifications list - no popup
    addToNotificationsList(title, message, type);
}

function connectToNtfy() {
    if (ntfyWebSocket && (ntfyWebSocket.readyState === WebSocket.CONNECTING || ntfyWebSocket.readyState === WebSocket.OPEN)) {
        return;
    }

    updateNtfyStatus('', false);
    console.log('🔔 Connecting to ntfy.sh WebSocket...');

    try {
        // Use Server-Sent Events instead of WebSocket as it's more reliable
        const eventSource = new EventSource('https://ntfy.sh/stanovi/sse');

        eventSource.onopen = function () {
            console.log('🔔 Connected to ntfy.sh SSE');
            updateNtfyStatus('', true);
            ntfyReconnectAttempts = 0;

            // Clear any pending reconnect
            if (ntfyReconnectTimeout) {
                clearTimeout(ntfyReconnectTimeout);
                ntfyReconnectTimeout = null;
            }
        };

        eventSource.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);
                console.log('🔔 Received notification:', data);

                // Add to notification panel only
                if (data.title && data.message) {
                    addToNotificationsList(data.title, data.message);
                }
            } catch (error) {
                console.warn('🔔 Failed to parse notification:', error);
            }
        };

        eventSource.onerror = function (error) {
            console.error('🔔 ntfy.sh SSE error:', error);
            updateNtfyStatus('', false);
            eventSource.close();

            // Attempt to reconnect
            if (ntfyReconnectAttempts < maxReconnectAttempts) {
                ntfyReconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, ntfyReconnectAttempts), 30000);

                updateNtfyStatus('', false);

                ntfyReconnectTimeout = setTimeout(() => {
                    connectToNtfy();
                }, delay);
            } else {
                updateNtfyStatus('', false);
            }
        };

        // Store reference for cleanup
        window.ntfyEventSource = eventSource;

    } catch (error) {
        console.error('🔔 Failed to connect to ntfy.sh:', error);
        updateNtfyStatus('', false);
    }
}

// No browser notifications needed - using panel only

// Testing Functions
const templates = {
    property: {
        title: "Novi Stan",
        message: "🏠 Title: Moderni apartman u centru\nAddress: Mariahilfer Str. 123, 1070 Vienna\nPrice: €450,000\n\n🔗 https://htmlpreview.github.io/?https://github.com/HuaMua/stanovi/blob/main/stanovi.html#entry-abc123",
        type: "info"
    },
    error: {
        title: "Greška Sistema",
        message: "❌ Neuspješno povezivanje sa JSONBin API\n\nMolimo pokušajte ponovo za nekoliko minuta.",
        type: "error"
    },
    warning: {
        title: "Upozorenje",
        message: "⚠️ Baza podataka je skoro puna\n\nPreporučuje se arhiviranje starih unosa.",
        type: "warning"
    },
    info: {
        title: "Informacija",
        message: "ℹ️ Sistem je uspješno ažuriran\n\nNove funkcionalnosti su dostupne.",
        type: "info"
    },
    custom: {
        title: "HTML Test",
        message: "<b>Bold text</b>\n<i>Italic text</i>\n<u>Underlined text</u>\n\n<a href='#'>Link test</a>\n\n<span style='color: red;'>Crveni tekst</span>",
        type: "info"
    }
};

function loadTemplate() {
    const select = document.getElementById('template-select');
    const template = templates[select.value];

    if (template) {
        document.getElementById('test-title').value = template.title;
        document.getElementById('test-message').value = template.message;
        document.getElementById('test-type').value = template.type;
    }
}

function sendTestNotification() {
    const title = document.getElementById('test-title').value || 'Test Naslov';
    const message = document.getElementById('test-message').value || 'Test poruka';
    const type = document.getElementById('test-type').value;

    // Show the notification locally
    showNtfyPopup(title, message, type);

    console.log('🧪 Test notification sent:', { title, message, type });
}

async function sendToNtfy() {
    const title = document.getElementById('test-title').value || 'Test Naslov';
    const message = document.getElementById('test-message').value || 'Test poruka';

    try {
        console.log('🚀 Sending to ntfy.sh with:', { title, message });

        const response = await fetch('https://ntfy.sh/stanovi', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Title': title,
                'Tags': 'test,stanovi',
                'Priority': '4',
                'Actions': 'view, Otvori stanovi.html, https://htmlpreview.github.io/?https://github.com/HuaMua/stanovi/blob/main/stanovi.html'
            },
            body: message
        });

        console.log('📡 Response status:', response.status);
        console.log('📡 Response headers:', [...response.headers.entries()]);

        if (response.ok) {
            const responseText = await response.text();
            console.log('📡 Response body:', responseText);
            showNtfyPopup('✅ Uspješno', 'Poruka je poslana na ntfy.sh/stanovi', 'info');
            console.log('✅ Message sent to ntfy.sh successfully');
        } else {
            const errorText = await response.text();
            console.error('❌ Error response:', errorText);
            showNtfyPopup('❌ Greška', `Neuspješno slanje: ${response.status}`, 'error');
            console.error('❌ Failed to send to ntfy.sh:', response.status);
        }
    } catch (error) {
        showNtfyPopup('❌ Greška', 'Neuspješno povezivanje sa ntfy.sh', 'error');
        console.error('❌ Error sending to ntfy.sh:', error);
    }
}

async function sendSimpleTest() {
    try {
        console.log('🔧 Sending simple test to ntfy.sh...');

        const response = await fetch('https://ntfy.sh/stanovi', {
            method: 'POST',
            body: 'Test poruka sa Android app - ako vidis ovo, sve radi!'
        });

        console.log('📡 Simple test response:', response.status);

        if (response.ok) {
            showNtfyPopup('✅ Test Poslat', 'Jednostavan test je poslat. Provjeri Android app!', 'info');
            console.log('✅ Simple test sent successfully');
        } else {
            showNtfyPopup('❌ Test Neuspješan', `Status: ${response.status}`, 'error');
        }
    } catch (error) {
        showNtfyPopup('❌ Test Error', 'Neuspješno slanje simple test', 'error');
        console.error('❌ Simple test error:', error);
    }
}

async function checkTopicStatus() {
    try {
        console.log('🔍 Checking topic status...');

        // Try to fetch the topic page to see if it exists
        const response = await fetch('https://ntfy.sh/stanovi', {
            method: 'GET'
        });

        console.log('📡 Topic status response:', response.status);

        if (response.ok) {
            showNtfyPopup('✅ Topic OK', 'Topic "stanovi" postoji na ntfy.sh', 'info');

            // Send a ping message
            const pingResponse = await fetch('https://ntfy.sh/stanovi', {
                method: 'POST',
                headers: {
                    'Title': 'Ping Test',
                    'Tags': 'ping',
                    'Priority': '1'
                },
                body: 'Ping test sa web stranice - ' + new Date().toLocaleTimeString()
            });

            if (pingResponse.ok) {
                console.log('✅ Ping sent successfully');
            }
        } else {
            showNtfyPopup('❌ Topic Problem', `Topic response: ${response.status}`, 'error');
        }
    } catch (error) {
        showNtfyPopup('❌ Check Error', 'Neuspješno provjera topic status', 'error');
        console.error('❌ Topic check error:', error);
    }
}

// Start ntfy connection when page loads
setTimeout(connectToNtfy, 1000);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.ntfyEventSource) {
        window.ntfyEventSource.close();
    }
    if (ntfyReconnectTimeout) {
        clearTimeout(ntfyReconnectTimeout);
    }
});

// Function to send notification for contact/termin changes
async function sendContactTerminNotification(entryIndex, changeType, statusText) {
    if (areNotificationsDisabled()) return;

    try {
        const entry = entries[entryIndex];
        if (!entry) return;

        const title = entry.title || 'Property';
        const address = entry.address || 'Unknown address';

        // Generate URL hash for the anchor
        const url = entry.url || '';
        let urlHash = null;
        if (url) {
            let hash = 0;
            for (let i = 0; i < url.length; i++) {
                const char = url.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            urlHash = 'entry-' + Math.abs(hash).toString(16);
        }

        // Create notification message with anchored title (no URL)
        const notificationTitle = `Kontakt - ${changeType === 'kontaktirao' ? 'Status' : 'Termin'}`;
        const anchoredTitle = urlHash ? `<a href="#${urlHash}">${title}</a>` : title;
        const notificationMessage = `📞 ${statusText}\n\n🏠 ${anchoredTitle}\n📍 ${address}`;

        // Send notification
        fetch('https://ntfy.sh/stanovi', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Title': notificationTitle,
                'Tags': 'contact,termin',
                'Priority': '3'
            },
            body: notificationMessage
        }).then(response => {
            if (response.ok) {
                console.log('📤 Contact/Termin notification sent successfully');
            } else {
                console.warn('⚠️ Failed to send contact/termin notification:', response.status);
            }
        }).catch(error => {
            console.warn('⚠️ Failed to send contact/termin notification:', error);
        });
    } catch (error) {
        console.warn('Failed to send contact/termin notification:', error);
    }
}

// Function to send notification for comment/rating changes
async function sendCommentRatingNotification(entryIndex, changeType, person, field = null, value = null) {
    if (areNotificationsDisabled()) return;

    try {
        const entry = entries[entryIndex];
        if (!entry) return;

        const title = entry.title || 'Property';
        const address = entry.address || 'Unknown address';

        // Generate URL hash for the anchor
        const url = entry.url || '';
        let urlHash = null;
        if (url) {
            let hash = 0;
            for (let i = 0; i < url.length; i++) {
                const char = url.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            urlHash = 'entry-' + Math.abs(hash).toString(16);
        }

        // Create notification message based on change type (no URLs)
        let notificationMessage = '';
        let notificationTitle = '';
        const anchoredTitle = urlHash ? `<a href="#${urlHash}">${title}</a>` : title;

        if (changeType === 'rating') {
            notificationTitle = `${person} - Ocjena`;
            notificationMessage = `⭐ ${person} je ocjenio stan sa ${value}/5\n\n🏠 ${anchoredTitle}\n📍 ${address}`;
        } else if (changeType === 'comment') {
            const commentType = field === 'adisNegativno' || field === 'roditeljiNegativno' ? 'negativni' : 'pozitivni';
            notificationTitle = `${person} - Komentar`;
            notificationMessage = `💬 ${person} je dodao ${commentType} komentar\n\n🏠 ${anchoredTitle}\n📍 ${address}`;
        }

        // Send notification
        fetch('https://ntfy.sh/stanovi', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Title': notificationTitle,
                'Tags': 'comment,rating',
                'Priority': '3'
            },
            body: notificationMessage
        }).then(response => {
            if (response.ok) {
                console.log('✅ Comment/rating notification sent to ntfy.sh/stanovi');
            } else {
                console.warn('⚠️ Failed to send comment/rating notification:', response.status);
            }
        }).catch(error => {
            console.warn('⚠️ Failed to send comment/rating notification:', error);
        });
    } catch (error) {
        console.warn('Failed to send comment/rating notification:', error);
    }
}

// Check URL parameter and show testing panel if needed
function checkTestingParameter() {
    const urlParams = new URLSearchParams(window.location.search);
    const testingParam = urlParams.get('testing');

    if (testingParam === 'true') {
        const testingPanel = document.getElementById('testing-panel');
        if (testingPanel) {
            testingPanel.style.display = 'block';
            console.log('🧪 Testing panel enabled via URL parameter');
        }
    }
}

// Filter state
let activeFilters = {
    starRating: null,
    kontaktirao: false,
    termin: false
};

// Filter functionality
function setupFilters() {
    // Star rating filter
    const starFilterButtons = document.querySelectorAll('.star-filter-btn');
    starFilterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const rating = parseInt(btn.dataset.rating);

            if (activeFilters.starRating === rating) {
                // Reset if clicking the same star
                activeFilters.starRating = null;
                updateStarFilterDisplay();
            } else {
                // Set new rating filter
                activeFilters.starRating = rating;
                updateStarFilterDisplay();
            }

            applyFilters();
        });

        // Add hover effects
        btn.addEventListener('mouseenter', () => {
            const hoverRating = parseInt(btn.dataset.rating);
            updateStarFilterDisplay(hoverRating);
        });

        btn.addEventListener('mouseleave', () => {
            updateStarFilterDisplay();
        });
    });

    // Kontaktirao filter
    const kontaktiraoFilter = document.getElementById('kontaktirao-filter');
    kontaktiraoFilter.addEventListener('change', () => {
        activeFilters.kontaktirao = kontaktiraoFilter.checked;
        applyFilters();
    });

    // Termin filter
    const terminFilter = document.getElementById('termin-filter');
    terminFilter.addEventListener('change', () => {
        activeFilters.termin = terminFilter.checked;
        applyFilters();
    });


}

function updateStarFilterDisplay(hoverRating = null) {
    const starFilterButtons = document.querySelectorAll('.star-filter-btn');
    starFilterButtons.forEach((btn, index) => {
        const btnRating = parseInt(btn.dataset.rating);

        // Determine which rating to display (hover takes precedence)
        const displayRating = hoverRating || activeFilters.starRating;

        if (displayRating && btnRating <= displayRating) {
            if (hoverRating && btnRating <= hoverRating) {
                // Hover preview - slightly different color
                btn.style.color = '#ffeb3b'; // Lighter gold for hover preview
            } else if (activeFilters.starRating && btnRating <= activeFilters.starRating) {
                // Active filter - normal gold
                btn.style.color = '#ffc107'; // Gold color for active stars
            } else {
                btn.style.color = '#ddd'; // Gray for inactive stars
            }
        } else {
            btn.style.color = '#ddd'; // Gray for inactive stars
        }
    });
}

function applyFilters() {
    const entriesDiv = document.getElementById('entries');
    const allEntries = entriesDiv.querySelectorAll('.entry');
    let visibleCount = 0;

    allEntries.forEach((entryDiv) => {
        const entryIndex = parseInt(entryDiv.dataset.entryIndex);
        const entry = entries[entryIndex];
        let shouldShow = true;

        if (!entry) {
            console.warn(`Entry not found for index ${entryIndex}`);
            entryDiv.style.display = 'none';
            return;
        }

        // Star rating filter
        if (activeFilters.starRating !== null) {
            const adisRating = parseInt(entry.adisOcjena) || 0;
            const roditeljiRating = parseInt(entry.roditeljiOcjena) || 0;
            const maxRating = Math.max(adisRating, roditeljiRating);

            if (maxRating < activeFilters.starRating) {
                shouldShow = false;
            }
        }

        // Kontaktirao filter
        if (activeFilters.kontaktirao && !entry.kontaktirao) {
            shouldShow = false;
        }

        // Termin filter
        if (activeFilters.termin && (!entry.termin || entry.termin.trim() === '')) {
            shouldShow = false;
        }

        // Show/hide entry
        entryDiv.style.display = shouldShow ? 'block' : 'none';
        if (shouldShow) visibleCount++;
    });

    // Debug information
    console.log(`Filter applied: ${visibleCount} entries visible out of ${entries.length}`);
    if (activeFilters.kontaktirao) {
        const kontaktiraoEntries = entries.filter(e => e.kontaktirao);
        console.log(`Kontaktirao filter active: ${kontaktiraoEntries.length} entries have kontaktirao=true`);
        kontaktiraoEntries.forEach((entry, i) => {
            console.log(`Entry ${i}: kontaktirao=${entry.kontaktirao}, title="${entry.title}"`);
        });
    }
}

// Hide notification panel immediately to prevent flash
updateNotificationPanelVisibility();

// Load data and config on page load
loadData();
loadConfig();

// Check testing parameter
checkTestingParameter();

// Setup filters after a delay to ensure DOM is ready
setTimeout(setupFilters, 100);

// Config modal functions
function openConfigModal() {
    const modal = document.getElementById('configModal');
    modal.classList.add('open');
    updateConfigUI();
}

function closeConfigModal() {
    const modal = document.getElementById('configModal');
    modal.classList.remove('open');
}

function updateConfigUI() {
    const notificationsToggle = document.getElementById('notifications-toggle');
    if (notificationsToggle && config.notifications) {
        notificationsToggle.checked = config.notifications.toggle;
    }

    // Update notification panel visibility
    updateNotificationPanelVisibility();
}

function updateNotificationPanelVisibility() {
    const notificationPanel = document.getElementById('notifications-panel');
    if (notificationPanel) {
        if (areNotificationsDisabled()) {
            notificationPanel.style.display = 'none';
        } else {
            notificationPanel.style.display = 'block';
        }
    }
}

// Notification panel toggle functionality
document.addEventListener('DOMContentLoaded', function () {
    const notificationPanel = document.getElementById('notifications-panel');

    if (notificationPanel) {
        notificationPanel.addEventListener('click', function (e) {
            // Don't toggle if clicking on buttons or interactive elements
            if (e.target.tagName === 'BUTTON' ||
                e.target.closest('button') ||
                e.target.closest('.notification-actions') ||
                e.target.closest('#notifications-list')) {
                return;
            }

            // Toggle expanded class
            this.classList.toggle('expanded');
        });

        // Close panel when clicking outside (only when expanded)
        document.addEventListener('click', function (e) {
            if (!notificationPanel.contains(e.target) && notificationPanel.classList.contains('expanded')) {
                notificationPanel.classList.remove('expanded');
            }
        });
    }

    // Config button event listener
    const configBtn = document.getElementById('config-btn');
    if (configBtn) {
        configBtn.addEventListener('click', openConfigModal);
    }

    // Config modal backdrop click to close
    const configModal = document.getElementById('configModal');
    if (configModal) {
        const backdrop = configModal.querySelector('.config-modal-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', closeConfigModal);
        }
    }

    // Update notification panel visibility on DOM ready
    updateNotificationPanelVisibility();

    // Notifications toggle change handler
    const notificationsToggle = document.getElementById('notifications-toggle');
    if (notificationsToggle) {
        notificationsToggle.addEventListener('change', async (e) => {
            // Ensure config.notifications exists
            if (!config.notifications) {
                config.notifications = {};
            }
            config.notifications.toggle = e.target.checked;
            await saveConfig();

            // Update notification panel visibility immediately
            updateNotificationPanelVisibility();
        });
    }
});
