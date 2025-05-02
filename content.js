// --- START OF FILE content.js ---

console.log('[DM Tagger & Follow-up v1.4.1] Extension Loaded (Skool Page Features)'); // Updated log version

const defaultTags = ["Lead", "Follow Up", "Not Interested", "Hot Prospect", "Sales"];

// --- Helper to fetch image and convert to Data URL ---
async function fetchImageAsDataUrl(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
       console.warn("Invalid URL for image fetch:", url);
       return null; // Return null for invalid URLs
    }
    // Add a timestamp to try and bypass cache if necessary (optional)
    // const urlWithTimestamp = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    try {
        // Use 'cors' mode if necessary, though default 'no-cors' might be what's needed if Skool restricts
        const response = await fetch(url, { mode: 'cors', cache: 'no-cache' }); // Try 'cors' mode, adjust if needed
        if (!response.ok) {
            // Log specific HTTP error
            console.warn(`Failed to fetch image: ${response.status} ${response.statusText} for url: ${url}`);
            // Try fetching again without cache busting if the first attempt failed? (Optional)
            // const responseRetry = await fetch(url, { mode: 'cors' });
            // if (!responseRetry.ok) return null;
            // const blob = await responseRetry.blob(); // Use retry response
            return null; // Return null if fetch fails
        }
        const blob = await response.blob();
        // Check blob type if needed
        if (!blob.type.startsWith('image/')) {
             console.warn(`Fetched content is not an image: ${blob.type} for url: ${url}`);
             return null;
        }
        return new Promise((resolve) => { // Simplified Promise, reject isn't strictly needed here as we return null
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result); // Resolve with Data URL
            reader.onerror = (error) => {
                console.error(`FileReader error for ${url}:`, error);
                resolve(null); // Resolve with null on FileReader error
            };
            reader.readAsDataURL(blob);
        });
    }
    catch (error) {
        // Log network errors or other exceptions during fetch/blob handling
        console.error(`Fetch/Blob error for ${url}:`, error);
        return null; // Return null on any exception
    }
}

// Load stored data (Tags, Options, Followups)
function getStoredData(callback) {
  chrome.storage.local.get(['dm_tags', 'tag_options', 'dm_followups'], (res) => {
    const tags = res.dm_tags || {};
    const options = res.tag_options || [...defaultTags]; // Use a copy of defaults
    const followups = res.dm_followups || {};
    callback(tags, options, followups);
  });
}

// Save updated tag OPTIONS list to storage
function saveTagOptions(tagOptions) {
  chrome.storage.local.set({ tag_options: tagOptions }, () => {
     if (chrome.runtime.lastError) {
        console.error("Error saving tag options:", chrome.runtime.lastError);
     } else {
        console.log("Tag options saved.");
     }
  });
}


// Observe DOM for DM opening - Keep this for Skool UI interaction
const observer = new MutationObserver((mutationsList, observer) => {
    // Use requestAnimationFrame to batch DOM reads/writes
    window.requestAnimationFrame(() => {
        const targetHeaderEl = document.querySelector(
            // Selector for DM header in Skool
             '.styled__BaseModalWrapper-sc-1la7f6z-0.Hbrnx.skool-ui-base-modal > div.styled__ModalContent-sc-1la7f6z-2.jijkFg > div.styled__ChatContainer-sc-f4viec-0.bTSofR > div.styled__BoxWrapper-sc-z75ylc-0.jRJTeG.Row-sc-w8j4n-0.jOeMQo > div.styled__ChatModalHeader-sc-f4viec-2.cLvaVt'
        );

        // Check if header exists, hasn't been processed yet, and doesn't already have our buttons
        if (targetHeaderEl && targetHeaderEl.dataset.taggerProcessing !== 'true' && !targetHeaderEl.querySelector('#tag-btn') && !targetHeaderEl.querySelector('#followup-btn')) {
            const profileLinkEl = targetHeaderEl.querySelector('a[href^="/@"]');
            const profileKey = profileLinkEl?.getAttribute('href');

            if (!profileKey) {
                console.warn("Could not find profile key in header.");
                return; // Exit if no key found
            }

            // Mark as processing to prevent multiple injections from rapid mutations
            targetHeaderEl.dataset.taggerProcessing = 'true';
            console.log(`Processing header for profile key: ${profileKey}`);

            getStoredData((storedTags, tagOptions, storedFollowups) => {
                // Check again if buttons were added by another mutation event while getting data
                if (!targetHeaderEl.querySelector('#tag-btn') && !targetHeaderEl.querySelector('#followup-btn')) {
                     injectFollowUpButton(targetHeaderEl, profileKey, storedFollowups, storedTags);
                     injectTagButton(targetHeaderEl, profileKey, storedTags, tagOptions);
                     console.log(`Buttons injected for ${profileKey}`);
                } else {
                    console.log(`Buttons already present for ${profileKey}, skipping injection.`);
                }
                 // Release processing flag after a short delay
                 setTimeout(() => {
                      if(targetHeaderEl) {
                          delete targetHeaderEl.dataset.taggerProcessing;
                          // console.log(`Processing flag removed for ${profileKey}`);
                      }
                 }, 150); // Increased delay slightly
            });
        }
    });
});

// Disconnect previous observer if script reloads (e.g., during development)
if (window.skoolTaggerObserver) {
    window.skoolTaggerObserver.disconnect();
}
window.skoolTaggerObserver = observer;

observer.observe(document.body, { childList: true, subtree: true });
console.log("Mutation observer started.");


// --- Tag Button Injection ---
function injectTagButton(targetHeaderEl, profileKey, storedTags, tagOptions) {
    // Ensure options is always an array
    const currentOptions = Array.isArray(tagOptions) ? tagOptions : [...defaultTags];

    const oldBtnWrapper = targetHeaderEl.querySelector('#tag-wrapper');
    if (oldBtnWrapper) oldBtnWrapper.remove();

    const existingTag = storedTags[profileKey]?.tag || 'Tag';

    const btn = document.createElement('button');
    btn.id = 'tag-btn';
    btn.innerText = existingTag;
    btn.dataset.profileKey = profileKey; // Store key for reference
    btn.style.cssText = `margin-left: 8px; background: #FFD700; color: black; padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; position: relative; z-index: 9998; white-space: nowrap; vertical-align: middle; line-height: normal; height: 30px; display: inline-flex; align-items: center;`;

    const dropdown = document.createElement('div');
    dropdown.id = 'tag-dropdown';
    dropdown.style.cssText = `position: absolute; top: 100%; left: 0; background: white; color: black; border: 1px solid #ccc; border-radius: 6px; padding: 5px; display: none; flex-direction: column; z-index: 10000; width: 160px; max-height: 250px; overflow-y: auto; box-shadow: 0 2px 5px rgba(0,0,0,0.2); margin-top: 2px;`;

    const renderTagDropdownItems = (dropdownEl, optionsToRender) => {
        dropdownEl.innerHTML = ''; // Clear previous items

        // Sort options alphabetically for display
        optionsToRender.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        optionsToRender.forEach(tag => {
            const option = document.createElement('div');
            option.innerText = tag;
            option.style.cssText = `padding: 8px 10px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 13px;`; // Added font-size
            option.onmouseover = () => option.style.backgroundColor = '#f0f0f0';
            option.onmouseout = () => option.style.backgroundColor = 'white';
            option.onclick = async (e) => {
                e.stopPropagation(); // Prevent body click listener
                await saveTag(profileKey, tag, btn); // Save the selected tag
                dropdownEl.style.display = 'none'; // Close dropdown
            };
            dropdownEl.appendChild(option);
        });

        // Untag Option
        const untagOption = document.createElement('div');
        untagOption.innerText = 'Untag';
        untagOption.style.cssText = `padding: 8px 10px; cursor: pointer; color: #dc3545; border-top: 1px solid #ccc; margin-top: 5px; font-size: 13px;`; // Added font-size
        untagOption.onmouseover = () => untagOption.style.backgroundColor = '#f8d7da';
        untagOption.onmouseout = () => untagOption.style.backgroundColor = 'white';
        untagOption.onclick = (e) => {
            e.stopPropagation();
            untagProfile(profileKey, btn); // Call untag function
            dropdownEl.style.display = 'none';
        };
        dropdownEl.appendChild(untagOption);

        // Add New Tag Option
        const addNew = document.createElement('div');
        addNew.innerText = '+ Add new tag';
        addNew.style.cssText = `padding: 8px 10px; cursor: pointer; font-weight: bold; border-top: 1px solid #ccc; margin-top: 5px; color: #007bff; font-size: 13px;`; // Added font-size
        addNew.onmouseover = () => addNew.style.backgroundColor = '#f0f0f0';
        addNew.onmouseout = () => addNew.style.backgroundColor = 'white';
        addNew.onclick = async (e) => {
            e.stopPropagation();
            const newTag = prompt('Enter new tag name:');
            if (newTag && newTag.trim()) {
                const trimmedTag = newTag.trim();
                // Get the latest options from storage before modifying
                chrome.storage.local.get('tag_options', (res) => {
                    let latestOptions = res.tag_options || [...defaultTags];
                    const optionsLower = latestOptions.map(o => o.toLowerCase());

                    if (!optionsLower.includes(trimmedTag.toLowerCase())) {
                        latestOptions.push(trimmedTag);
                        saveTagOptions(latestOptions); // Save the updated options list
                        // Update the dropdown UI immediately with the new list
                        renderTagDropdownItems(dropdown, latestOptions);
                        // Optionally save the new tag to the current profile immediately
                        // await saveTag(profileKey, trimmedTag, btn);
                    } else {
                        alert(`Tag "${trimmedTag}" already exists.`);
                    }
                });
            }
        };
        dropdownEl.appendChild(addNew);
    }

    // Initial rendering of dropdown items
    renderTagDropdownItems(dropdown, currentOptions);

    // Toggle dropdown display
    btn.onclick = (e) => {
        e.stopPropagation();
        // Close other dropdown if open
        const followupDropdown = targetHeaderEl.querySelector('#followup-dropdown');
        if (followupDropdown) followupDropdown.style.display = 'none';
        // Toggle current dropdown
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
        // Refresh dropdown content with latest options when opening
        if (dropdown.style.display === 'flex') {
             chrome.storage.local.get('tag_options', (res) => {
                  renderTagDropdownItems(dropdown, res.tag_options || [...defaultTags]);
             });
        }
    };

    // Wrapper div for positioning
    const wrapper = document.createElement('div');
    wrapper.id = 'tag-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block'; // Important for positioning
    wrapper.style.verticalAlign = 'middle';
    wrapper.appendChild(btn);
    wrapper.appendChild(dropdown);

    targetHeaderEl.appendChild(wrapper);

    // Add a single body click listener to close dropdowns if needed (careful with multiple observers)
    // This might be better handled within the observer or popup logic to avoid duplicates
    if (!document.body.dataset.dropdownListenerAdded) {
        document.body.addEventListener('click', (e) => {
            const openDropdowns = document.querySelectorAll('#tag-dropdown, #followup-dropdown');
            openDropdowns.forEach(dd => {
                // Close if clicked outside the dropdown's wrapper
                const wrapper = dd.closest('#tag-wrapper, #followup-wrapper');
                if (dd.style.display !== 'none' && wrapper && !wrapper.contains(e.target)) {
                    dd.style.display = 'none';
                }
            });
        }, true); // Use capture phase
        document.body.dataset.dropdownListenerAdded = 'true';
    }
}

// --- Save Tag Data ---
async function saveTag(key, tag, btn) {
    const container = btn.closest('.styled__ChatModalHeader-sc-f4viec-2');
    if (!container) { console.error("saveTag: Could not find parent header container."); return; }

    const usernameEl = container.querySelector('.styled__UserNameText-sc-24o0l3-1 span');
    const profilePicEl = container.querySelector('.styled__AvatarWrapper-sc-1ruw40r-0 img');
    const profileLinkEl = container.querySelector('a[href^="/@"]');

    if (!usernameEl || !profilePicEl || !profileLinkEl) {
        console.error("saveTag: Missing profile elements.");
        alert("Error: Could not find user info to save tag.");
        return; // Stop if essential info is missing
    }

    const fullName = usernameEl.innerText.trim();
    const profilePicUrl = profilePicEl.src; // Original URL
    const currentProfileKey = profileLinkEl.getAttribute('href');

    // Ensure we're using the correct key
    if (key !== currentProfileKey) {
        console.warn(`saveTag: Profile key mismatch. Header key: ${key}, Link key: ${currentProfileKey}. Using key from link.`);
        key = currentProfileKey;
    }
    const profileLink = 'https://www.skool.com' + key; // Construct full link

    // Attempt to fetch image as Data URL
    console.log(`Fetching image for ${fullName}: ${profilePicUrl}`);
    const profilePicDataUrl = await fetchImageAsDataUrl(profilePicUrl); // May return null

    if (profilePicDataUrl === null) {
        console.warn(`saveTag: Fetching image as Data URL failed for ${profilePicUrl}. Saving original URL only.`);
    } else {
        console.log(`saveTag: Successfully fetched image as Data URL for ${fullName}.`);
    }

    // Prepare the data object to save
    const tagDataToSave = {
        username: fullName,
        profileLink: profileLink,
        profilePic: profilePicUrl,       // Always save the original URL
        profilePicDataUrl: profilePicDataUrl, // Save the Data URL (or null if failed)
        tag: tag
    };

    // Save to storage
    return new Promise(resolve => {
        chrome.storage.local.get(['dm_tags'], (res) => {
            const tags = res.dm_tags || {};
            // Merge new data with existing data for the profile key, preserving other fields if any
            tags[key] = { ...(tags[key] || {}), ...tagDataToSave };

            chrome.storage.local.set({ dm_tags: tags }, () => {
                if (chrome.runtime.lastError) {
                    console.error("saveTag: Error saving tag data:", chrome.runtime.lastError);
                    alert("Error saving tag.");
                    resolve(); // Resolve promise even on error
                    return;
                }
                console.log('✅ Tag saved:', tags[key]);
                btn.innerText = tag; // Update button text
                resolve();
            });
        });
    });
}


// --- Untag Profile ---
function untagProfile(key, btn) {
     chrome.storage.local.get(['dm_tags'], (res) => {
        const tags = res.dm_tags || {};
        if (tags[key] && tags[key].tag) {
             // Remove only the tag property, keep other profile info
             delete tags[key].tag;
             chrome.storage.local.set({ dm_tags: tags }, () => {
                if (chrome.runtime.lastError) {
                    console.error("untagProfile: Error saving untagged data:", chrome.runtime.lastError);
                    alert("Error untagging profile.");
                    return;
                }
                console.log('✅ Profile untagged:', key);
                btn.innerText = 'Tag'; // Reset button text
             });
        } else {
             console.log('untagProfile: Profile or tag not found for key:', key);
             btn.innerText = 'Tag'; // Reset button text anyway
        }
     });
}


// --- Follow-up Button Injection ---
// (No changes needed in injectFollowUpButton itself based on this problem)
function injectFollowUpButton(targetHeaderEl, profileKey, storedFollowups, storedTags) {
    const oldBtnWrapper = targetHeaderEl.querySelector('#followup-wrapper');
    if (oldBtnWrapper) oldBtnWrapper.remove();

    const existingFollowup = storedFollowups[profileKey];
    let buttonText = 'Follow-up'; let titleText = 'Schedule a follow-up reminder';
    if (existingFollowup?.remindAt) {
        try {
            const remindDate = new Date(existingFollowup.remindAt);
            if (!isNaN(remindDate.getTime())) {
                const timeStr = remindDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = remindDate.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
                buttonText = `Follow-up: ${timeStr} ${dateStr}`;
                let notePreview = existingFollowup.notes ? ` | Notes: ${existingFollowup.notes.substring(0, 20)}${existingFollowup.notes.length > 20 ? '...' : ''}` : '';
                titleText = `Scheduled: ${remindDate.toLocaleString()}${notePreview}. Click to change/clear.`;
            } else {
                console.warn("Invalid date stored for followup:", existingFollowup.remindAt);
                titleText = "Invalid date scheduled. Click to clear/reschedule.";
                 buttonText = 'Follow-up (ERR)'; // Indicate error state
            }
        } catch (e) {
            console.error("Error formatting date:", e);
            titleText = "Error reading scheduled date. Click to clear/reschedule.";
            buttonText = 'Follow-up (ERR)';
        }
    }

    const btn = document.createElement('button');
    btn.id = 'followup-btn'; btn.innerText = buttonText; btn.title = titleText; btn.dataset.profileKey = profileKey;
    btn.style.cssText = `margin-left: 8px; background: #2928ff; color: white; padding: 6px 10px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; position: relative; z-index: 9999; white-space: nowrap; vertical-align: middle; height: 30px; display: inline-flex; align-items: center; overflow: hidden; text-overflow: ellipsis; max-width: 150px;`; // Changed background and color


    const dropdown = document.createElement('div');
    dropdown.id = 'followup-dropdown';
    dropdown.style.cssText = `position: absolute; top: 100%; left: 0; background: white; color: black; border: 1px solid #ccc; border-radius: 6px; padding: 15px; display: none; flex-direction: column; gap: 10px; z-index: 10000; width: 220px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); margin-top: 2px;`;

    const inputRow = document.createElement('div'); inputRow.style.cssText = 'display: flex; gap: 5px; align-items: center;';
    const timeInput = document.createElement('input'); timeInput.type = 'number'; timeInput.min = '1'; timeInput.placeholder = 'Time'; timeInput.style.cssText = `width: 70px; padding: 8px 10px; border: 1px solid #eaeaea; border-radius: 6px; font-size: 13px; box-sizing: border-box; background-color: #f7f7f7; color: #37352f; transition: border-color 0.2s ease, box-shadow 0.2s ease; font-family: 'Inter', Arial, sans-serif; -moz-appearance: textfield; appearance: textfield;`;
    timeInput.onfocus = () => {
        timeInput.style.borderColor = '#2928ff';
        timeInput.style.boxShadow = '0 0 0 2px rgba(41, 40, 255, 0.1)';
        timeInput.style.backgroundColor = '#ffffff';
    };
    timeInput.onblur = () => {
        timeInput.style.borderColor = '#eaeaea';
        timeInput.style.boxShadow = 'none';
        timeInput.style.backgroundColor = '#f7f7f7';
    };
    timeInput.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    const unitSelect = document.createElement('select'); const arrowSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%232928ff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`;
    unitSelect.style.cssText = `flex-grow: 1; padding: 8px 30px 8px 10px; border: 1px solid #eaeaea; border-radius: 6px; font-size: 13px; box-sizing: border-box; background-color: #f7f7f7; color: #37352f; transition: border-color 0.2s ease, box-shadow 0.2s ease; font-family: 'Inter', Arial, sans-serif; appearance: none; background-image: ${arrowSvg}; background-repeat: no-repeat; background-position: right 8px center; background-size: 16px;`;
    unitSelect.onfocus = () => {
        unitSelect.style.borderColor = '#2928ff';
        unitSelect.style.boxShadow = '0 0 0 2px rgba(41, 40, 255, 0.1)';
        unitSelect.style.backgroundColor = '#ffffff';
    };
    unitSelect.onblur = () => {
        unitSelect.style.borderColor = '#eaeaea';
        unitSelect.style.boxShadow = 'none';
        unitSelect.style.backgroundColor = '#f7f7f7';
    };
    ['Minutes', 'Hours', 'Days'].forEach(unit => { const option = document.createElement('option'); option.value = unit.toLowerCase(); option.textContent = unit; unitSelect.appendChild(option); }); unitSelect.value = 'hours';
    inputRow.appendChild(timeInput); inputRow.appendChild(unitSelect);

    const notesLabel = document.createElement('label');
    notesLabel.textContent = 'Notes:';
    notesLabel.style.cssText = 'font-size: 12px; font-weight: 500; margin-bottom: 4px; display: block; text-align: left; color: #6b7280;';
    const notesInput = document.createElement('textarea');
    notesInput.id = 'followup-notes-input';
    notesInput.placeholder = 'Optional: Add notes for the follow-up...';
    notesInput.rows = 3;
    notesInput.style.cssText = `width: 100%; padding: 8px 10px; border: 1px solid #eaeaea; border-radius: 6px; font-size: 13px; resize: vertical; box-sizing: border-box; margin-top: 0px; background-color: #f7f7f7; color: #37352f; min-height: 60px; transition: border-color 0.2s ease, box-shadow 0.2s ease; font-family: 'Inter', Arial, sans-serif;`; // Using Notion-like colors/styles
    notesInput.onfocus = () => {
        notesInput.style.borderColor = '#2928ff'; // Use accent color on focus
        notesInput.style.boxShadow = '0 0 0 2px rgba(41, 40, 255, 0.1)'; // Add focus ring
        notesInput.style.backgroundColor = '#ffffff'; // Slightly change background on focus
    };
    notesInput.onblur = () => {
        notesInput.style.borderColor = '#eaeaea'; // Revert border
        notesInput.style.boxShadow = 'none'; // Remove focus ring
        notesInput.style.backgroundColor = '#f7f7f7'; // Revert background
    };
    if (existingFollowup?.notes) { notesInput.value = existingFollowup.notes; }

    const scheduleBtn = document.createElement('button'); scheduleBtn.textContent = existingFollowup ? 'Reschedule' : 'Schedule Follow-up'; const scheduleBtnBaseBg = '#2928ff'; // Accent color
    const scheduleBtnHoverBg = '#2423cc'; // Darker accent color
    scheduleBtn.style.cssText = `padding: 9px 12px; background-color: ${scheduleBtnBaseBg}; color: white; border: none; border-radius: 6px; cursor: pointer; width: 100%; margin-top: 10px; font-weight: 500; font-size: 13px; transition: background-color 0.2s ease; font-family: 'Inter', Arial, sans-serif;`;
    scheduleBtn.onmouseover = () => { scheduleBtn.style.backgroundColor = scheduleBtnHoverBg; };
    scheduleBtn.onmouseout = () => { scheduleBtn.style.backgroundColor = scheduleBtnBaseBg; };
    scheduleBtn.onclick = async (e) => {
        e.stopPropagation();
        const timeValue = parseInt(timeInput.value, 10);
        const unitValue = unitSelect.value;
        const notesValue = notesInput.value.trim();
        if (!timeValue || timeValue <= 0) { alert('Please enter a valid positive number for the time.'); return; }
        await saveFollowUp(profileKey, timeValue, unitValue, notesValue, btn);
        dropdown.style.display = 'none';
    };

    dropdown.appendChild(inputRow);
    dropdown.appendChild(notesLabel);
    dropdown.appendChild(notesInput);
    dropdown.appendChild(scheduleBtn);

    if (existingFollowup) {
        const clearBtn = document.createElement('button'); clearBtn.textContent = 'Clear Follow-up'; const clearBtnBaseBg = '#fff1f0'; // Light red background (like delete buttons in popup)
        const clearBtnHoverBg = '#ffd4d4'; // Darker light red
        const clearBtnColor = '#ff4d4f'; // Danger color text
        clearBtn.style.cssText = `padding: 9px 12px; background-color: ${clearBtnBaseBg}; color: ${clearBtnColor}; border: none; border-radius: 6px; cursor: pointer; margin-top: 8px; width: 100%; font-weight: 500; font-size: 13px; transition: background-color 0.2s ease; font-family: 'Inter', Arial, sans-serif;`;
        clearBtn.onmouseover = () => { clearBtn.style.backgroundColor = clearBtnHoverBg; };
        clearBtn.onmouseout = () => { clearBtn.style.backgroundColor = clearBtnBaseBg; };
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            clearFollowUp(profileKey, btn);
            dropdown.style.display = 'none';
             notesInput.value = ''; // Clear notes field visually
        };
        dropdown.appendChild(clearBtn);
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        const tagDropdown = targetHeaderEl.querySelector('#tag-dropdown');
        if (tagDropdown) tagDropdown.style.display = 'none';
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
        // Pre-fill notes when opening if they exist
        if (dropdown.style.display === 'flex') {
             chrome.storage.local.get('dm_followups', (res) => {
                const currentFollowup = res.dm_followups?.[profileKey];
                 notesInput.value = currentFollowup?.notes || '';
             });
        }
    };

    const wrapper = document.createElement('div');
    wrapper.id = 'followup-wrapper';
    wrapper.style.position = 'relative'; wrapper.style.display = 'inline-block'; wrapper.style.verticalAlign = 'middle';
    wrapper.appendChild(btn); wrapper.appendChild(dropdown);
    targetHeaderEl.appendChild(wrapper);
}


// --- Save Follow Up ---
// Needs to fetch profile info when SAVING the follow-up
async function saveFollowUp(key, timeValue, unitValue, notes, btn) {
    const now = Date.now(); let remindAt; let unitMultiplier = 0;
    switch (unitValue) { case 'minutes': unitMultiplier = 60 * 1000; break; case 'hours': unitMultiplier = 60 * 60 * 1000; break; case 'days': unitMultiplier = 24 * 60 * 60 * 1000; break; default: console.error("Invalid unit:", unitValue); return; }
    remindAt = now + timeValue * unitMultiplier;
    const minRemindTime = now + 60000; // Ensure reminder is at least 1 minute in the future
    if (remindAt < minRemindTime) {
        console.warn("Calculated reminder time is too soon or in the past. Setting to minimum (1 minute).");
        remindAt = minRemindTime;
    }

    // Get profile info fresh when saving
    const container = btn.closest('.styled__ChatModalHeader-sc-f4viec-2');
    if (!container) { console.error("saveFollowUp: No header found."); alert("Error: Cannot find profile header to save follow-up."); return; }

    const usernameEl = container.querySelector('.styled__UserNameText-sc-24o0l3-1 span');
    const profilePicEl = container.querySelector('.styled__AvatarWrapper-sc-1ruw40r-0 img');
    const profileLinkEl = container.querySelector('a[href^="/@"]');

    if (!usernameEl || !profilePicEl || !profileLinkEl) { console.error("saveFollowUp: Missing profile elements in header."); alert("Error: Could not find user info to save follow-up."); return; }

    const fullName = usernameEl.innerText.trim();
    const profilePicUrl = profilePicEl.src;
    const currentProfileKey = profileLinkEl.getAttribute('href');
     if (key !== currentProfileKey) { console.warn("saveFollowUp: Profile key mismatch during save. Using key from link:", currentProfileKey); key = currentProfileKey; }
    const profileLink = 'https://www.skool.com' + key;

    // Fetch Data URL when saving the follow-up as well
    const profilePicDataUrl = await fetchImageAsDataUrl(profilePicUrl);
     if (profilePicDataUrl === null) { console.warn("saveFollowUp: Fetching image as Data URL failed when saving follow-up."); }

    // Prepare the profile data specifically for the follow-up storage
    const followupProfileInfo = {
        username: fullName,
        profileLink: profileLink,
        profilePic: profilePicUrl,       // Store original URL
        profilePicDataUrl: profilePicDataUrl // Store Data URL (or null)
    };

    const followupData = {
        profileKey: key,
        scheduledAt: now,
        remindAt: remindAt,
        profileData: followupProfileInfo,
        notes: notes || null // Store notes (or null if empty)
    };

    // Call the helper function to save data and schedule alarm
    await saveFollowUpData(followupData, btn);
}


// --- Save Follow Up Data Helper ---
// (No changes needed here, it receives the prepared followupData)
function saveFollowUpData(followupData, btn) {
    const key = followupData.profileKey;
    const remindAt = followupData.remindAt;
    console.log("saveFollowUpData: Saving:", JSON.stringify(followupData)); // Log the full data being saved

    return new Promise(resolve => {
        chrome.storage.local.get(['dm_followups'], (res) => {
            const followups = res.dm_followups || {};
            followups[key] = followupData; // Store the complete object

            chrome.storage.local.set({ dm_followups: followups }, () => {
                if (chrome.runtime.lastError) {
                    console.error("saveFollowUpData: Error saving follow-up:", chrome.runtime.lastError);
                    alert(`Error saving follow-up: ${chrome.runtime.lastError.message}`);
                    resolve(false);
                    return;
                }
                console.log('✅ Follow-up saved locally:', followupData);

                // Schedule alarm via background script
                chrome.runtime.sendMessage({ action: "scheduleAlarm", name: key, when: remindAt }, response => {
                    if (chrome.runtime.lastError) {
                        console.error("Alarm schedule message error:", chrome.runtime.lastError.message);
                        alert(`Follow-up saved, but scheduling the reminder failed: ${chrome.runtime.lastError.message}. Please check console.`);
                        resolve(false); // Indicate scheduling failed
                        return;
                    }
                    if (response && response.success) {
                        console.log("Alarm scheduled successfully via background.");
                        // Update button text and title
                        const remindDate = new Date(remindAt);
                        const timeStr = remindDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const dateStr = remindDate.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
                        let notePreview = followupData.notes ? ` | Notes: ${followupData.notes.substring(0, 20)}${followupData.notes.length > 20 ? '...' : ''}` : '';
                        btn.innerText = `Follow-up: ${timeStr} ${dateStr}`;
                        btn.title = `Scheduled: ${remindDate.toLocaleString()}${notePreview}. Click to change/clear.`;
                        resolve(true); // Indicate success
                    } else {
                        console.error("Background script failed to schedule alarm.", response?.error);
                        alert("Follow-up saved, but scheduling the reminder failed in background. Please check console.");
                        resolve(false); // Indicate scheduling failed
                    }
                });
            });
        });
    });
}


// --- Clear Follow Up ---
// (No changes needed)
function clearFollowUp(key, btn) {
     chrome.storage.local.get(['dm_followups'], (res) => {
        const followups = res.dm_followups || {};
        if (followups[key]) {
            delete followups[key];
            chrome.storage.local.set({ dm_followups: followups }, () => {
                if (chrome.runtime.lastError) { console.error("clearFollowUp: Error saving cleared data:", chrome.runtime.lastError); alert("Error clearing follow-up."); return; }
                console.log('✅ Follow-up cleared locally:', key);
                btn.innerText = 'Follow-up'; btn.title = 'Schedule a follow-up reminder';
                // Send message to background to clear the corresponding alarm
                chrome.runtime.sendMessage({ action: "clearAlarm", name: key }, response => {
                     if (chrome.runtime.lastError) console.error("Alarm clear message error:", chrome.runtime.lastError.message);
                     else console.log("Alarm clear request sent.", response);
                });
            });
        } else {
             btn.innerText = 'Follow-up'; btn.title = 'Schedule a follow-up reminder';
             console.log("clearFollowUp: No local follow-up data found for key:", key);
             // Still attempt to clear alarm in case it's orphaned
             chrome.runtime.sendMessage({ action: "clearAlarm", name: key }, response => {
                  if (chrome.runtime.lastError) console.error("Orphaned alarm clear message error:", chrome.runtime.lastError.message);
                  else console.log("Orphaned alarm clear request sent.", response);
             });
        }
    });
}

// --- END OF FILE content.js ---